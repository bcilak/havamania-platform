/*
 * İlk kurulum. Tekrar çalıştırmak güvenlidir: var olan kayıtlar atlanır.
 *   - Süper admin (ADMIN_EMAIL / ADMIN_PASSWORD)
 *   - Havamania Asistan botu + ilk yayın (v1)
 *   - CMS: sitenin bugünkü içeriği
 *   - Bilgi tabanı: temel soru-cevaplar ve site içeriği
 *   - Örnek konuşmalar (SEED_DEMO=0 ile atlanır). Panodan tek tıkla silinir.
 */
import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import { db, sqlClient } from "../src/db/index";
import {
  adminUsers,
  appUsers,
  attachments,
  bots,
  cmsDocuments,
  conversations,
  corrections,
  feedback,
  kbSources,
  messages,
  type ChatMode,
  type Platform,
  type SourceRecord,
  type ToolCallRecord,
} from "../src/db/schema";
import { processSource } from "../src/lib/ai/ingest";
import { publishDraft } from "../src/lib/bot";
import { defaultBotConfig } from "../src/lib/bot-config";
import { landingToText } from "../src/lib/cms/flatten";
import { defaultLandingContent } from "../src/lib/cms/schema";
import { encrypt, randomToken } from "../src/lib/crypto";
import { storage } from "../src/lib/storage";

const log = (s: string) => console.log(`  ${s}`);

/* ---------- Admin ---------- */
const email = (process.env.ADMIN_EMAIL || "admin@havamania.local").toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const [{ n: adminCount }] = await db.select({ n: count() }).from(adminUsers);
if (adminCount === 0) {
  if (!password || password.length < 8) throw new Error("ADMIN_PASSWORD en az 8 karakter olmalı (.env.local).");
  await db.insert(adminUsers).values({ email, name: "Havamania Admin", role: "super_admin", passwordHash: await bcrypt.hash(password, 11) });
  log(`Süper admin oluşturuldu: ${email}`);
} else log("Admin zaten var, atlandı.");

/* ---------- Bot ---------- */
let [bot] = await db.select().from(bots).limit(1);
if (!bot) {
  [bot] = await db
    .insert(bots)
    .values({
      name: "Havamania Asistan",
      publicKey: `hm_pk_${randomToken(12)}`,
      tokenSecretEnc: encrypt(randomToken(32)),
      allowAnonymous: true,
      draftConfig: defaultBotConfig(),
    })
    .returning();
  log(`Bot oluşturuldu: ${bot.publicKey}`);
} else log(`Bot zaten var: ${bot.publicKey}`);

/* ---------- CMS ---------- */
const [cms] = await db.select().from(cmsDocuments).where(eq(cmsDocuments.id, "landing"));
if (!cms) {
  const content = defaultLandingContent();
  await db.insert(cmsDocuments).values({ id: "landing", draft: content, published: content, publishedAt: new Date(), publishedBy: "kurulum" });
  log("Site içeriği CMS'e aktarıldı.");
}

/* ---------- Bilgi tabanı ---------- */
const [{ n: kbCount }] = await db.select({ n: count() }).from(kbSources);
if (kbCount === 0) {
  const qa: [string, string, ChatMode | "all"][] = [
    [
      "Havamania nedir?",
      "Havamania, dağınık atmosferik veriyi (sıcaklık, hissedilen, UV, rüzgâr, nem, görüş, basınç) tek bir panelde birleştiren bir hava durumu ve seyahat asistanıdır. Seyahat planlayıcı konfor skoru hesaplar; Agro ve Fly modları tarım ve uçuş için özelleşmiş veriler sunar.",
      "all",
    ],
    [
      "Premium üyelik neler içerir?",
      "Premium; hava, tarla ve uçuş için özelleştirilmiş gelişmiş analizler, tüm iletişim tonlarıyla tam yapay zekâ kişiselleştirmesi, seyahat ve sezon hafızası sunan arşiv özellikleri ve ruh haline ve mevsime göre özel temalar içerir.",
      "all",
    ],
    [
      "Konfor skoru nasıl hesaplanır?",
      "Seyahat planlayıcı; sıcaklık, hissedilen sıcaklık, nem, yağış olasılığı, rüzgâr ve UV indeksini birleştirerek 0–100 arası bir konfor skoru üretir. %80 ve üzeri açık hava etkinlikleri için çok uygun kabul edilir.",
      "genel",
    ],
    [
      "İlaçlama için uygun hava koşulları nelerdir?",
      "İlaçlama için rüzgâr hızı 8 km/sa altında olmalı, önümüzdeki 6 saatte yağış beklenmemeli ve sıcaklık 25°C'yi geçmemeli. En uygun saatler genellikle sabah 06:00–09:00 arasıdır. Ürün etiketindeki talimatlar her zaman önceliklidir.",
      "agro",
    ],
    [
      "Don riski ne zaman yüksektir?",
      "Açık ve rüzgârsız gecelerde sıcaklık 2°C'nin altına düştüğünde don riski yüksektir. Hassas ürünler için örtü, gece sulaması ya da rüzgâr makinesi önerilir.",
      "agro",
    ],
    [
      "Fly modu resmî meteoroloji brifinginin yerine geçer mi?",
      "Hayır. Fly modu rota üzerindeki türbülans, rüzgâr, jet akımı ve buzlanmayı sade bir dille özetler; uçuş planlaması için resmî METAR, TAF, SIGMET ve NOTAM kaynakları esas alınmalıdır.",
      "fly",
    ],
  ];
  const created = await db
    .insert(kbSources)
    .values(
      qa.map(([question, answer, mode]) => ({
        botId: bot.id,
        type: "qa" as const,
        mode,
        title: question,
        question,
        answer,
        priority: 5,
        createdBy: "kurulum",
      })),
    )
    .returning();
  const [cmsSource] = await db
    .insert(kbSources)
    .values({ botId: bot.id, type: "cms", mode: "all", title: "Havamania web sitesi içeriği", answer: landingToText(defaultLandingContent()), createdBy: "kurulum" })
    .returning();
  for (const s of [...created, cmsSource]) await processSource(s.id);
  log(`Bilgi tabanı: ${created.length} soru-cevap + site içeriği işlendi (tam metin araması).`);
}

/* ---------- İlk yayın ---------- */
if (!bot.publishedVersionId) {
  const v = await publishDraft(bot, "kurulum", "İlk kurulum");
  log(`v${v.number} yayınlandı (${v.kbSourceIds.length} kaynak). Model seçilince sohbet çalışır.`);
}

/* ---------- Örnek veriler ---------- */
const [{ n: demoCount }] = await db.select({ n: count() }).from(conversations).where(eq(conversations.isDemo, true));
if (process.env.SEED_DEMO !== "0" && demoCount === 0) {
  const leafSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#6b8f4e"/><path d="M60 330 C 120 120, 280 60, 350 70 C 330 150, 260 300, 60 330 Z" fill="#9cc56a" stroke="#4d6b33" stroke-width="4"/><path d="M60 330 L 330 90" stroke="#4d6b33" stroke-width="3"/><g fill="#e0c33c" opacity=".9"><circle cx="190" cy="190" r="14"/><circle cx="230" cy="160" r="9"/><circle cx="160" cy="240" r="11"/><circle cx="260" cy="130" r="7"/><ellipse cx="210" cy="220" rx="16" ry="8"/></g><text x="16" y="384" font-family="sans-serif" font-size="16" fill="#fff" opacity=".75">Örnek fotoğraf</text></svg>`;
  const fieldSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="170" fill="#a9d3ef"/><rect y="170" width="400" height="230" fill="#b98e5a"/><g stroke="#8a6437" stroke-width="3" opacity=".7"><path d="M0 210 L400 200"/><path d="M0 250 L400 236"/><path d="M0 300 L400 280"/><path d="M0 360 L400 330"/></g><g stroke="#6d4a26" stroke-width="2" opacity=".6" fill="none"><path d="M80 260 l20 18 l-8 22"/><path d="M250 300 l24 10 l6 26"/><path d="M170 340 l-18 20"/></g><circle cx="330" cy="70" r="30" fill="#fff3b0"/><text x="16" y="384" font-family="sans-serif" font-size="16" fill="#fff" opacity=".8">Örnek fotoğraf</text></svg>`;

  const users = await db
    .insert(appUsers)
    .values(
      (
        [
          ["demo-ios-7F3A21C9", "usr_10482", "ios", "2.4.1"],
          ["demo-and-5B8E1D04", "usr_22917", "android", "2.4.0"],
          ["demo-and-9C2F6A11", null, "android", "2.3.8"],
          ["demo-web-3E7B90D2", null, "web", null],
          ["demo-ios-A41C77E0", "usr_30561", "ios", "2.4.1"],
        ] as const
      ).map(([deviceId, externalUserId, platform, appVersion]) => ({
        botId: bot.id,
        deviceId,
        externalUserId,
        platform: platform as Platform,
        appVersion,
        locale: "tr-TR",
        consentVersion: 1,
        consentAt: new Date(Date.now() - 20 * 86400_000),
        isDemo: true,
      })),
    )
    .returning();

  const MODEL = "anthropic/claude-sonnet-5";
  type Turn = {
    user: string;
    photo?: "leaf" | "field";
    reply: string;
    tools?: ToolCallRecord[];
    sources?: SourceRecord[];
    rating?: 1 | -1;
    comment?: string;
    unanswered?: boolean;
  };
  type Demo = { daysAgo: number; mode: ChatMode; user: number; turns: Turn[] };

  const wx = (loc: string, extra: Record<string, unknown>) => ({ ok: true, data: { location: loc, ...extra } });
  const src = (title: string, snippet: string, score: number): SourceRecord => ({ sourceId: "00000000-0000-0000-0000-000000000000", title, snippet, score });

  const demos: Demo[] = [
    {
      daysAgo: 0.08,
      mode: "genel",
      user: 0,
      turns: [
        {
          user: "Bugün Balıkesir'de şemsiye gerekir mi?",
          tools: [
            { name: "current_weather", input: { location: "Balıkesir" }, output: wx("Balıkesir", { temp: 24, feels_like: 25, humidity: 58, wind_kmh: 14, uv: 6 }) },
            { name: "forecast", input: { location: "Balıkesir", days: 1 }, output: wx("Balıkesir", { hourly_precip_prob: { "15:00": 20, "18:00": 35, "21:00": 10 } }) },
          ],
          reply:
            "Şu an Balıkesir'de 24°, hissedilen 25°. Öğleden sonra yağış olasılığı %20, akşam 18:00 civarı %35'e çıkıyor.\n\nAkşam dışarıda olacaksan küçük bir şemsiye almanı öneririm; gündüz için gerek yok. UV 6, öğlen saatlerinde güneş kremi faydalı olur.",
          rating: 1,
        },
      ],
    },
    {
      daysAgo: 0.4,
      mode: "agro",
      user: 1,
      turns: [
        {
          user: "Buğday yapraklarında sarı lekeler var, ne olabilir?",
          photo: "leaf",
          reply:
            "Fotoğrafta yaprak üzerinde dağınık, yuvarlak sarı lekeler görünüyor. Bu belirtiler pas hastalığı, besin eksikliği ya da çevresel strese işaret edebilir; fotoğraftan kesin teşhis koymam doğru olmaz.\n\nBölgenizdeki ziraat mühendisine ya da il tarım müdürlüğüne yaprak örneği göstermenizi öneririm. Son günlerde nem yüksek ve geceler serin geçtiyse mantar kaynaklı hastalık olasılığı artar.",
          rating: -1,
          comment: "Hangi ilacı kullanacağımı söylemedi",
        },
      ],
    },
    {
      daysAgo: 1.1,
      mode: "fly",
      user: 4,
      turns: [
        {
          user: "IST → ESB FL350'de türbülans var mı?",
          tools: [
            {
              name: "flight_weather",
              input: { origin: "LTFM", destination: "LTAC", flightLevel: 350 },
              output: wx("LTFM-LTAC", { turbulence: [{ from: "FL300", to: "FL360", level: "orta" }], jet_stream: { level: "FL340", speed_kt: 120 }, icing: "düşük" }),
            },
          ],
          reply:
            "Rotada **FL300–360 arasında orta türbülans** bekleniyor; jet akımı FL340 civarında, yaklaşık 120 kt baş rüzgârı.\n\n- FL380'e çıkabilirsen rüzgâr zayıflıyor, daha pürüzsüz bir seyir olur.\n- Buzlanma riski düşük, yalnızca tırmanışta hafif.",
          rating: 1,
        },
      ],
    },
    {
      daysAgo: 1.4,
      mode: "genel",
      user: 3,
      turns: [
        {
          user: "Hafta sonu Kaz Dağları'nda kamp yapılır mı?",
          tools: [{ name: "forecast", input: { location: "Kaz Dağları", days: 3 }, output: wx("Kaz Dağları", { days: [{ day: "Cumartesi", min: 11, max: 22, precip_prob: 10 }, { day: "Pazar", min: 12, max: 23, precip_prob: 15 }] }) }],
          reply: "Cumartesi ve pazar kamp için uygun görünüyor: gündüz 22–23°, geceleri 11–12°. Yağış olasılığı %10–15. Geceler serin, uyku tulumunu ona göre seç.",
        },
      ],
    },
    {
      daysAgo: 2.2,
      mode: "agro",
      user: 2,
      turns: [
        {
          user: "Salı sabahı ilaçlama yapabilir miyim?",
          tools: [{ name: "agro_conditions", input: { location: "Konya", crop: "buğday", days: 3 }, output: wx("Konya", { spraying_windows: [{ day: "Salı", from: "06:00", to: "09:00", wind_kmh: 6, precip_prob: 0 }] }) }],
          sources: [src("İlaçlama için uygun hava koşulları nelerdir?", "İlaçlama için rüzgâr hızı 8 km/sa altında olmalı, önümüzdeki 6 saatte yağış beklenmemeli…", 0.82)],
          reply: "Evet, Salı 06:00–09:00 arası uygun: rüzgâr 6 km/sa, yağış beklenmiyor. 09:00'dan sonra rüzgâr artıyor, işi sabah erken bitirmeni öneririm.",
          rating: 1,
        },
      ],
    },
    {
      daysAgo: 3.3,
      mode: "genel",
      user: 0,
      turns: [
        {
          user: "Premium üyelik ne sağlıyor?",
          sources: [src("Premium üyelik neler içerir?", "Premium; hava, tarla ve uçuş için özelleştirilmiş gelişmiş analizler…", 0.91)],
          reply:
            "Premium'da şunlar var:\n- Hava, tarla ve uçuş için gelişmiş analizler\n- Tüm iletişim tonlarıyla tam kişiselleştirme\n- Seyahat ve sezon hafızası (arşiv)\n- Ruh haline ve mevsime göre özel temalar",
        },
      ],
    },
    {
      daysAgo: 4.2,
      mode: "fly",
      user: 4,
      turns: [
        {
          user: "Yarın sabah Sabiha'dan kalkışta buzlanma riski?",
          tools: [{ name: "flight_weather", input: { origin: "LTFJ", destination: "LTFJ", flightLevel: 120 }, output: wx("LTFJ", { icing: [{ from: "FL080", to: "FL140", level: "hafif" }], freezing_level_ft: 7800 }) }],
          reply: "Donma seviyesi yaklaşık 7.800 ft. FL080–140 arasında hafif buzlanma bekleniyor; tırmanışta kısa süreli. Resmî TAF ve SIGMET'i kalkıştan önce mutlaka kontrol et.",
        },
      ],
    },
    {
      daysAgo: 5.1,
      mode: "genel",
      user: 1,
      turns: [
        {
          user: "Nisan'da Kapadokya balon turu için hava nasıl olur?",
          reply:
            "Nisan'da Kapadokya'da sabahlar serin (2–8°), gündüz 15–18° civarı olur. Balon uçuşları rüzgâra çok bağlıdır ve sabah erken saatte yapılır; bahar aylarında iptal oranı kışa göre düşüktür. Kesin tarih verirsen uçuş gününe yakın bir tahminle yardımcı olabilirim.",
          unanswered: true,
          rating: -1,
          comment: "Tarih sormadan genel bilgi verdi",
        },
      ],
    },
    {
      daysAgo: 6.3,
      mode: "agro",
      user: 1,
      turns: [
        {
          user: "Toprak bu kadar kuru, sulamalı mıyım?",
          photo: "field",
          tools: [{ name: "agro_conditions", input: { location: "Konya", days: 5 }, output: wx("Konya", { soil_moisture_pct: 18, eto_mm: 4.1, precip_48h_prob: 10 }) }],
          reply: "Fotoğrafta yüzeyde belirgin çatlaklar var. Toprak nemi %18, günlük buharlaşma 4,1 mm ve önümüzdeki 48 saatte yağış beklenmiyor. Bu şartlarda sulama yapmanı öneririm; akşam saatlerinde sulamak buharlaşma kaybını azaltır.",
          rating: 1,
        },
      ],
    },
    {
      daysAgo: 8.2,
      mode: "genel",
      user: 2,
      turns: [
        {
          user: "Bu uygulamada Agro modu ne işe yarıyor?",
          sources: [src("Havamania web sitesi içeriği", "Agro Modu: Tarlanın ham verisi. Toprak, rüzgâr, don riski…", 0.77)],
          reply: "Agro modu hava verisini tarımsal karara çevirir: don riski, toprak nemi, buharlaşma, ilaçlama ve hasat için en uygun zaman pencereleri. Ürününü ve bölgeni yazarsan haftalık bir plan çıkarabilirim.",
        },
      ],
    },
    {
      daysAgo: 10.4,
      mode: "genel",
      user: 3,
      turns: [
        {
          user: "Rüzgâr 40 km/sa olursa bisiklet sürmek tehlikeli mi?",
          reply: "40 km/sa rüzgâr bisiklet için zorlayıcıdır; özellikle yan rüzgârda dengeyi kaybetme riski artar. Deneyimli değilsen o gün sürüşü ertelemen daha güvenli olur.",
          unanswered: true,
        },
      ],
    },
    {
      daysAgo: 12.1,
      mode: "agro",
      user: 0,
      turns: [
        {
          user: "Zeytin hasadı için bu hafta hangi gün uygun?",
          tools: [{ name: "agro_conditions", input: { location: "Ayvalık", crop: "zeytin", days: 7 }, output: wx("Ayvalık", { harvest_score: [{ day: "Perşembe", score: 8 }, { day: "Cuma", score: 6 }] }) }],
          reply: "Bu hafta en uygun gün **Perşembe** (hasat skoru 8/10): kuru ve rüzgârsız. Cuma akşamdan itibaren nem artıyor.",
        },
      ],
    },
    {
      daysAgo: 13.2,
      mode: "fly",
      user: 4,
      turns: [
        {
          user: "Bulut tabanı 1500 ft ise VFR uçulur mu?",
          reply:
            "Bu kararı ben veremem. VFR minimumları hava sahası sınıfına ve yerel kurallara göre değişir; kararı güncel METAR/TAF ve SHGM kurallarına göre sen ya da uçuş hareket birimi vermelisin. İstersen rotan için bulut tabanı ve görüş verisini özetleyebilirim.",
          unanswered: true,
        },
      ],
    },
  ];

  let photoCount = 0;
  for (const d of demos) {
    const start = new Date(Date.now() - d.daysAgo * 86400_000);
    const id = crypto.randomUUID();
    let t = start.getTime();
    const tick = (s: number) => new Date((t += s * 1000));
    await db.insert(conversations).values({
      id,
      botId: bot.id,
      appUserId: users[d.user].id,
      mode: d.mode,
      platform: users[d.user].platform,
      versionNumber: 1,
      title: d.turns[0].user.slice(0, 80),
      isDemo: true,
      startedAt: start,
      lastMessageAt: start,
    });
    let msgCount = 0;
    let photos = 0;
    let neg = 0;
    let inTok = 0;
    let outTok = 0;
    for (const turn of d.turns) {
      const [u] = await db.insert(messages).values({ conversationId: id, role: "user", content: turn.user, createdAt: tick(5) }).returning();
      msgCount++;
      if (turn.photo) {
        const key = `photos/demo/${crypto.randomUUID()}.svg`;
        await storage.put(key, new TextEncoder().encode(turn.photo === "leaf" ? leafSvg : fieldSvg), "image/svg+xml");
        await db.insert(attachments).values({
          conversationId: id,
          messageId: u.id,
          appUserId: users[d.user].id,
          storageKey: key,
          mediaType: "image/svg+xml",
          size: (turn.photo === "leaf" ? leafSvg : fieldSvg).length,
          isDemo: true,
          createdAt: u.createdAt,
        });
        photos++;
        photoCount++;
      }
      const i = 1400 + Math.round(Math.random() * 900);
      const o = 90 + Math.round(turn.reply.length / 3.2);
      inTok += i;
      outTok += o;
      const [a] = await db
        .insert(messages)
        .values({
          conversationId: id,
          role: "assistant",
          content: turn.reply,
          toolCalls: turn.tools ?? [],
          sources: turn.sources ?? [],
          unanswered: Boolean(turn.unanswered),
          model: MODEL,
          inputTokens: i,
          outputTokens: o,
          costUsd: 0,
          latencyMs: 1800 + Math.round(Math.random() * 2600),
          createdAt: tick(4),
        })
        .returning();
      msgCount++;
      if (turn.rating) {
        await db.insert(feedback).values({ messageId: a.id, conversationId: id, rating: turn.rating, comment: turn.comment ?? null, createdAt: tick(20) });
        if (turn.rating === -1) neg++;
      }
    }
    await db
      .update(conversations)
      .set({ messageCount: msgCount, photoCount: photos, negativeCount: neg, inputTokens: inTok, outputTokens: outTok, lastMessageAt: new Date(t) })
      .where(eq(conversations.id, id));
  }

  // Bir örnek düzeltme: bisiklet sorusuna ekibin onayladığı cevap.
  const [bike] = await db.select().from(conversations).where(eq(conversations.title, "Rüzgâr 40 km/sa olursa bisiklet sürmek tehlikeli mi?"));
  if (bike) {
    const question = "Rüzgârlı havada bisiklet sürmek güvenli mi?";
    const answer =
      "Rüzgâr 25 km/sa altında genelde sorun yoktur. 25–40 km/sa arasında yan rüzgâra dikkat edilmeli, açık alanlardan ve köprülerden kaçınılmalıdır. 40 km/sa üzerinde sürüş önerilmez. Havamania'daki anlık rüzgâr ve hamle değerlerine bakın.";
    const [s] = await db
      .insert(kbSources)
      .values({ botId: bot.id, type: "correction", mode: "genel", title: question, question, answer, priority: 10, createdBy: email })
      .returning();
    await db.insert(corrections).values({ conversationId: bike.id, mode: "genel", question, correctAnswer: answer, kbSourceId: s.id, createdBy: email });
    await processSource(s.id);
  }
  log(`Örnek veriler: ${demos.length} konuşma, ${users.length} kullanıcı, ${photoCount} fotoğraf.`);
} else if (demoCount > 0) log("Örnek veriler zaten var, atlandı.");

await sqlClient.end();

console.log(`
Hazır.
  Panel:        ${process.env.APP_URL || "http://localhost:3110"}/admin
  E-posta:      ${email}
  Şifre:        .env.local içindeki ADMIN_PASSWORD
  Bot anahtarı: ${bot.publicKey}
`);
