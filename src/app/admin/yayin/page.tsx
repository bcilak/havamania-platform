import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { ExternalLink, Rocket } from "lucide-react";
import { db } from "@/db";
import { kbSources } from "@/db/schema";
import { ConfirmButton, CopyButton, SubmitButton } from "@/components/client";
import { Badge, btn, checkboxCls, EmptyState, Field, Flash, inputCls, KeyValue, Notice, PageHeader, Panel, TableWrap, td, th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion, listVersions } from "@/lib/bot";
import { MODES, TONES, type BotConfig } from "@/lib/bot-config";
import { decryptOrNull, maskSecret } from "@/lib/crypto";
import { param, type SearchParams } from "@/lib/form";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/roles";
import { publish, regenerateSecret, rollback, saveAccess } from "./actions";

export const metadata = { title: "Sürümler ve gömme" };

function diff(a: BotConfig | null, b: BotConfig): string[] {
  if (!a) return ["İlk yayın"];
  const out: string[] = [];
  for (const m of MODES) {
    const x = a.modes[m];
    const y = b.modes[m];
    const label = y.label;
    if (x.enabled !== y.enabled) out.push(`${label}: ${y.enabled ? "açıldı" : "kapatıldı"}`);
    if (x.instructions !== y.instructions) out.push(`${label}: talimat değişti`);
    if (x.tone !== y.tone) out.push(`${label}: üslup ${TONES[x.tone]?.label} → ${TONES[y.tone]?.label}`);
    if (x.model !== y.model || x.providerId !== y.providerId) out.push(`${label}: model ${x.model ?? "yok"} → ${y.model ?? "yok"}`);
    if (x.temperature !== y.temperature) out.push(`${label}: temperature ${x.temperature} → ${y.temperature}`);
    if ([...x.tools].sort().join() !== [...y.tools].sort().join()) out.push(`${label}: araçlar değişti`);
    if (x.greeting !== y.greeting || x.suggestions.join() !== y.suggestions.join() || x.label !== y.label) out.push(`${label}: karşılama/öneriler değişti`);
  }
  if (a.guardrails !== b.guardrails) out.push("Ortak kurallar değişti");
  for (const k of ["historyWindow", "maxMessagesPerDay", "photosEnabled", "maxPhotoMb", "retrievalTopK", "fallbackMessage"] as const) {
    if (a[k] !== b[k]) out.push(`${k}: ${a[k]} → ${b[k]}`);
  }
  return out;
}

async function readSdk(file: string, botKey: string, appUrl: string): Promise<string> {
  try {
    const text = await fs.readFile(path.join(process.cwd(), "sdk", file), "utf8");
    return text.replaceAll("https://havamania.com", appUrl).replaceAll("hm_pk_BOT_ANAHTARI", botKey);
  } catch {
    return `// sdk/${file} bulunamadı`;
  }
}

export default async function PublishPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("publish");
  const sp = await searchParams;
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const versions = await listVersions(bot.id);
  const sources = await db.select({ id: kbSources.id, title: kbSources.title, status: kbSources.status }).from(kbSources).where(eq(kbSources.botId, bot.id));
  const readyIds = new Set(sources.filter((s) => s.status === "ready").map((s) => s.id));
  const pubIds = new Set(published?.kbSourceIds ?? []);
  const added = sources.filter((s) => readyIds.has(s.id) && !pubIds.has(s.id));
  const removed = [...pubIds].filter((id) => !readyIds.has(id)).length;
  const changes = diff(published?.config ?? null, bot.draftConfig);
  const appUrl = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  const secret = param(sp, "anahtar") === "goster" && can(admin.role, "users") ? decryptOrNull(bot.tokenSecretEnc) : null;

  const [swift, kotlin] = await Promise.all([readSdk("ios/HavamaniaChat.swift", bot.publicKey, appUrl), readSdk("android/HavamaniaChat.kt", bot.publicKey, appUrl)]);
  const swiftUsage = `let chat = HavamaniaChat(
    botKey: "${bot.publicKey}",
    userToken: session.chatToken,   // backend'inizin imzaladığı token (anonimse nil)
    mode: .agro,
    location: .init(lat: 39.65, lon: 27.88, name: "Balıkesir")
)
chat.onClose = { print("sohbet kapandı") }
present(chat.viewController, animated: true)`;
  const kotlinUsage = `HavamaniaChat.open(
    context = this,
    botKey = "${bot.publicKey}",
    userToken = session.chatToken,  // anonimse null
    mode = HavamaniaChat.Mode.AGRO,
    location = HavamaniaChat.Location(39.65, 27.88, "Balıkesir")
)`;
  const webSnippet = `<script src="${appUrl}/widget.js" data-bot="${bot.publicKey}" defer></script>`;
  const tokenSnippet = `// Uygulama backend'iniz (Node.js, jose paketi)
import { SignJWT } from "jose";

const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)            // uygulamadaki kullanıcı kimliği
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.HAVAMANIA_CHAT_SECRET));`;

  return (
    <>
      <PageHeader
        title="Sürümler ve gömme"
        description="Taslakta yaptığınız değişiklikler yayınlanana kadar kullanıcılara ulaşmaz. Gömme kodu sürüm numarası değil bot anahtarı içerdiği için her yayında uygulamayı güncellemeniz gerekmez."
      />
      <Flash sp={sp} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Yayındaki sürüm">
          {published ? (
            <div className="grid gap-3">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tracking-tight">v{published.number}</span>
                <Badge tone="good">Yayında</Badge>
              </div>
              <KeyValue
                items={[
                  ["Yayınlanma", fmtDateTime(published.publishedAt)],
                  ["Yayınlayan", published.publishedBy ?? "—"],
                  ["Not", published.note ?? "—"],
                  ["Bilgi tabanı", `${published.kbSourceIds.length} kaynak`],
                ]}
              />
            </div>
          ) : (
            <EmptyState icon={Rocket} title="Henüz yayınlanmadı">
              Uygulamadaki sohbet ekranı ilk yayına kadar &ldquo;Asistan henüz yayınlanmadı&rdquo; der.
            </EmptyState>
          )}
        </Panel>

        <Panel title="Taslaktaki değişiklikler" description="Yayınla dediğinizde bunlar kullanıcılara ulaşır.">
          {changes.length || added.length || removed ? (
            <ul className="mb-4 grid gap-1.5 text-sm">
              {changes.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="text-accent">•</span>
                  {c}
                </li>
              ))}
              {added.length > 0 && (
                <li className="flex gap-2">
                  <span className="text-accent">•</span>
                  Bilgi tabanına {added.length} yeni kaynak: {added.slice(0, 3).map((s) => s.title).join(", ")}
                  {added.length > 3 ? "…" : ""}
                </li>
              )}
              {removed > 0 && (
                <li className="flex gap-2">
                  <span className="text-accent">•</span>
                  {removed} kaynak kaldırılacak
                </li>
              )}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-muted">Taslak, yayındaki sürümle aynı.</p>
          )}
          <form action={publish} className="flex flex-wrap items-end gap-2">
            <Field label="Sürüm notu (isteğe bağlı)" htmlFor="note" className="min-w-0 flex-1">
              <input id="note" name="note" placeholder="Örn. Agro tonu samimi yapıldı" className={inputCls} />
            </Field>
            <SubmitButton pendingText="Yayınlanıyor…">
              <Rocket className="size-4" /> Yayınla
            </SubmitButton>
          </form>
        </Panel>
      </div>

      {versions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[15px] font-semibold">Sürüm geçmişi</h2>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Sürüm</th>
                <th className={th}>Tarih</th>
                <th className={th}>Yayınlayan</th>
                <th className={th}>Not</th>
                <th className={`${th} text-right`}>Kaynak</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className={`${td} font-semibold`}>
                    v{v.number} {v.id === bot.publishedVersionId && <Badge tone="good">Yayında</Badge>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(v.publishedAt)}</td>
                  <td className={`${td} text-muted`}>{v.publishedBy}</td>
                  <td className={td}>{v.note ?? <span className="text-faint">—</span>}</td>
                  <td className={`${td} tabular text-right`}>{v.kbSourceIds.length}</td>
                  <td className={`${td} text-right`}>
                    {v.id !== bot.publishedVersionId && (
                      <form action={rollback}>
                        <input type="hidden" name="versionId" value={v.id} />
                        <ConfirmButton variant="secondary" confirmText={`v${v.number} yayınlansın mı?`}>
                          Bu sürüme dön
                        </ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </section>
      )}

      <h2 id="gomme" className="mb-1 scroll-mt-6 text-xl font-semibold tracking-tight">
        Gömme
      </h2>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Mobil uygulama sohbeti bir WebView içinde açar. Aşağıdaki Swift ve Kotlin dosyalarını projeye ekleyin; kimlik, konum ve fotoğraf seçimi bu dosyaların içinde hazır.
      </p>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Panel title="Bot anahtarı" description="Herkese açık bir anahtardır; uygulamaya gömülmesi güvenlidir.">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 font-mono text-sm">{bot.publicKey}</code>
            <CopyButton text={bot.publicKey} />
          </div>
          <a href={`/w/${bot.publicKey}?platform=web&deviceId=panel-onizleme`} target="_blank" className={`${btn("secondary", "sm")} mt-3`}>
            <ExternalLink className="size-3.5" /> Sohbet ekranını aç
          </a>
        </Panel>
        <Panel title="Kullanıcı kimliği" description="Uygulamanız giriş yapmış kullanıcıyı kısa ömürlü bir token ile tanıtır. Böylece konuşma geçmişi cihazlar arasında korunur ve KVKK silme talepleri kullanıcı bazında yapılabilir.">
          <div className="grid gap-4">
            <form action={saveAccess} className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="allowAnonymous" defaultChecked={bot.allowAnonymous} className={checkboxCls} />
                Token olmadan (yalnızca cihaz kimliğiyle) erişime izin ver
              </label>
              <SubmitButton variant="secondary" size="sm">
                Kaydet
              </SubmitButton>
            </form>
            <div className="grid gap-2">
              <div className="text-[13px] font-medium">Token imzalama anahtarı (HS256)</div>
              {secret ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-warn-soft px-3 py-2 font-mono text-sm">{secret}</code>
                  <CopyButton text={secret} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded-lg bg-sunken px-3 py-2 font-mono text-sm">{bot.tokenSecretEnc ? maskSecret(decryptOrNull(bot.tokenSecretEnc)) : "oluşturulmadı"}</code>
                  {bot.tokenSecretEnc && can(admin.role, "users") && (
                    <Link href="/admin/yayin?anahtar=goster#gomme" className={btn("ghost", "sm")}>
                      Göster
                    </Link>
                  )}
                </div>
              )}
              {can(admin.role, "users") && (
                <form action={regenerateSecret}>
                  <ConfirmButton variant="secondary" confirmText="Eski token'lar geçersiz olacak. Devam?">
                    {bot.tokenSecretEnc ? "Yeni anahtar oluştur" : "Anahtar oluştur"}
                  </ConfirmButton>
                </form>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4">
        {[
          { title: "iOS · kullanım", lang: "Swift", code: swiftUsage },
          { title: "Android · kullanım", lang: "Kotlin", code: kotlinUsage },
          { title: "Web sitesi", lang: "HTML", code: webSnippet },
          { title: "Uygulama backend'i · token imzalama", lang: "JavaScript", code: tokenSnippet },
        ].map((s) => (
          <Panel key={s.title} title={s.title} actions={<CopyButton text={s.code} />} bodyClassName="p-0">
            <pre className="overflow-x-auto bg-[#0b1b2b] p-4 font-mono text-[12.5px] leading-relaxed text-[#e3ecf6]">{s.code}</pre>
          </Panel>
        ))}
        <Panel title="HavamaniaChat.swift" description="Projeye ekleyin. Info.plist'e NSCameraUsageDescription ve NSPhotoLibraryUsageDescription gerekir." actions={<CopyButton text={swift} label="Dosyayı kopyala" />} bodyClassName="p-0">
          <pre className="max-h-96 overflow-auto bg-[#0b1b2b] p-4 font-mono text-[12px] leading-relaxed text-[#e3ecf6]">{swift}</pre>
        </Panel>
        <Panel title="HavamaniaChat.kt" description="Projeye ekleyin ve AndroidManifest'e HavamaniaChatActivity'yi tanımlayın (dosyanın başında örnek var)." actions={<CopyButton text={kotlin} label="Dosyayı kopyala" />} bodyClassName="p-0">
          <pre className="max-h-96 overflow-auto bg-[#0b1b2b] p-4 font-mono text-[12px] leading-relaxed text-[#e3ecf6]">{kotlin}</pre>
        </Panel>
        <Notice>
          Mobil uygulama bilgilerini (kullanıcı girişi, backend, veri API) paylaştığınızda bu kodları uygulamanın mimarisine göre birlikte uyarlayacağız.
        </Notice>
      </div>
    </>
  );
}
