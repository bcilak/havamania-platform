import Link from "next/link";
import { count, desc, eq, and, ne } from "drizzle-orm";
import { ArrowRight, CircleCheck, Circle, MessagesSquare } from "lucide-react";
import { db } from "@/db";
import { conversations, feedback, messages, providers } from "@/db/schema";
import { BarList, DailyColumns, StatTile } from "@/components/admin/charts";
import { ConfirmButton } from "@/components/client";
import { Badge, btn, EmptyState, Flash, ModeBadge, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, getPublishedVersion } from "@/lib/bot";
import { MODES, MODE_META } from "@/lib/bot-config";
import type { SearchParams } from "@/lib/form";
import { fmtInt, fmtRelative, fmtUsd, PLATFORM_LABEL, truncate } from "@/lib/format";
import { can } from "@/lib/roles";
import { getSetting } from "@/lib/settings";
import { breakdown, dailyConversations, periodStats, unansweredQuestions } from "@/lib/stats";
import { deleteDemoData } from "./actions";

export const metadata = { title: "Pano" };

function change(now: number, prev: number): number | null {
  if (!prev) return null;
  return (now - prev) / prev;
}

async function setupChecklist() {
  const bot = await getMainBot();
  const published = await getPublishedVersion(bot);
  const [{ n: providerCount }] = await db.select({ n: count() }).from(providers);
  const cfg = published?.config ?? bot.draftConfig;
  const modelsSet = MODES.every((m) => !cfg.modes[m].enabled || (cfg.modes[m].providerId && cfg.modes[m].model));
  const embedding = await getSetting("embedding");
  const integration = await getSetting("integration");
  const [{ n: demo }] = await db.select({ n: count() }).from(conversations).where(eq(conversations.isDemo, true));
  return {
    items: [
      { done: providerCount > 0, label: "Bir yapay zekâ sağlayıcısı ekleyin", href: "/admin/ayarlar/modeller" },
      { done: modelsSet, label: "Her mod için bir model seçin ve yayınlayın", href: "/admin/egitim/kisilik" },
      { done: Boolean(embedding.providerId && embedding.model), label: "Bilgi tabanı için embedding modelini seçin (isteğe bağlı)", href: "/admin/ayarlar/modeller#embedding" },
      { done: Boolean(integration.baseUrl), label: "Havamania veri API'sini bağlayın", href: "/admin/ayarlar/entegrasyon" },
      { done: Boolean(bot.tokenSecretEnc) || !bot.allowAnonymous, label: "Kullanıcı token anahtarını uygulama backend'inize verin", href: "/admin/yayin#gomme" },
    ],
    demo,
  };
}

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const seesAssistant = can(admin.role, "conversations");

  if (!seesAssistant) {
    return (
      <>
        <PageHeader title={`Merhaba, ${admin.name.split(" ")[0]}`} description="Site içeriğini ve medyayı buradan yönetebilirsiniz." />
        <Flash sp={sp} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/admin/icerik" className="rounded-xl border border-line bg-surface p-5 hover:border-accent">
            <div className="font-semibold">Site sayfaları</div>
            <p className="mt-1 text-sm text-muted">Landing sayfasının metinlerini, sahneleri ve Premium bölümünü düzenleyin.</p>
          </Link>
          <Link href="/admin/medya" className="rounded-xl border border-line bg-surface p-5 hover:border-accent">
            <div className="font-semibold">Medya kütüphanesi</div>
            <p className="mt-1 text-sm text-muted">Logo ve görselleri yükleyin, bağlantılarını kopyalayın.</p>
          </Link>
        </div>
      </>
    );
  }

  const [now, prev, daily, split, recent, openFb, unanswered, setup] = await Promise.all([
    periodStats(7),
    periodStats(7, 7),
    dailyConversations(14),
    breakdown(7),
    db.select().from(conversations).where(ne(conversations.platform, "playground")).orderBy(desc(conversations.lastMessageAt)).limit(6),
    db
      .select({ id: feedback.id, messageId: feedback.messageId, conversationId: feedback.conversationId, comment: feedback.comment, createdAt: feedback.createdAt, content: messages.content })
      .from(feedback)
      .innerJoin(messages, eq(messages.id, feedback.messageId))
      .where(and(eq(feedback.status, "open"), eq(feedback.rating, -1)))
      .orderBy(desc(feedback.createdAt))
      .limit(5),
    unansweredQuestions(5),
    setupChecklist(),
  ]);

  const negRate = now.assistant ? now.negative / now.assistant : 0;
  const prevNegRate = prev.assistant ? prev.negative / prev.assistant : 0;
  const remaining = setup.items.filter((i) => !i.done).length;
  const modeCounts = MODES.map((m) => ({ key: m, label: <ModeBadge mode={m} />, value: split.modes.find((r) => r.key === m)?.n ?? 0 }));
  const platformCounts = (["ios", "android", "web"] as const).map((p) => ({
    key: p,
    label: PLATFORM_LABEL[p],
    value: split.platforms.find((r) => r.key === p)?.n ?? 0,
  }));

  return (
    <>
      <PageHeader title="Pano" description="Son 7 günde asistanın kullanımı ve ilgilenmeniz gereken konular." />
      <Flash sp={sp} />

      {(remaining > 0 || setup.demo > 0) && (
        <Panel
          className="mb-6"
          title={remaining > 0 ? `Kurulum: ${setup.items.length - remaining} / ${setup.items.length} tamam` : "Kurulum tamam"}
          description="Panelin tüm özellikleri hazır. Canlıya çıkmadan önce aşağıdaki ayarları tamamlayın."
          actions={
            setup.demo > 0 && can(admin.role, "kvkk") ? (
              <form action={deleteDemoData} className="flex items-center gap-2">
                <Badge tone="warn">{setup.demo} örnek konuşma</Badge>
                <ConfirmButton confirmText="Tümü silinsin mi?">Örnek verileri sil</ConfirmButton>
              </form>
            ) : null
          }
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {setup.items.map((i) => (
              <li key={i.label}>
                <Link href={i.href} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-sunken">
                  {i.done ? <CircleCheck className="size-4 shrink-0 text-good" /> : <Circle className="size-4 shrink-0 text-faint" />}
                  <span className={i.done ? "text-muted line-through decoration-line-strong" : ""}>{i.label}</span>
                  {!i.done && <ArrowRight className="ml-auto size-3.5 text-faint group-hover:text-accent" />}
                </Link>
              </li>
            ))}
          </ul>
          {setup.demo > 0 && (
            <p className="mt-3 text-xs text-muted">
              Konuşmalar, fotoğraflar ve geri bildirim listelerindeki örnek kayıtlar &ldquo;Örnek&rdquo; etiketiyle işaretli; ekranları görmeniz için eklendi.
            </p>
          )}
        </Panel>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Konuşmalar" value={fmtInt(now.conversations)} delta={change(now.conversations, prev.conversations)} />
        <StatTile label="Aktif kullanıcılar" value={fmtInt(now.users)} delta={change(now.users, prev.users)} />
        <StatTile
          label="Olumsuz geri bildirim"
          value={`%${(negRate * 100).toFixed(1).replace(".", ",")}`}
          delta={prevNegRate ? (negRate - prevNegRate) / prevNegRate : null}
          upIsGood={false}
          hint={`${fmtInt(now.negative)} / ${fmtInt(now.assistant)} cevap`}
        />
        <StatTile label="Model maliyeti" value={fmtUsd(now.cost)} delta={change(now.cost, prev.cost)} upIsGood={false} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel title="Günlük konuşmalar" description="Son 14 gün, test alanı hariç">
          <DailyColumns data={daily} />
        </Panel>
        <Panel title="Dağılım" description="Son 7 gün">
          <div className="grid gap-6">
            <div>
              <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Mod</h3>
              <BarList items={modeCounts} />
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Platform</h3>
              <BarList items={platformCounts} />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Son konuşmalar"
          bodyClassName="p-0"
          actions={
            <Link href="/admin/konusmalar" className={btn("ghost", "sm")}>
              Tümü
            </Link>
          }
        >
          {recent.length ? (
            <ul className="divide-y divide-line">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/konusmalar/${c.id}`} className="block px-5 py-3 hover:bg-sunken">
                    <div className="truncate text-sm font-medium">{c.title || "Başlıksız"}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      <ModeBadge mode={c.mode} />
                      <span>·</span>
                      <span>{PLATFORM_LABEL[c.platform]}</span>
                      <span className="ml-auto">{fmtRelative(c.lastMessageAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={MessagesSquare} title="Henüz konuşma yok">
              Asistan uygulamaya gömüldüğünde konuşmalar burada görünecek.
            </EmptyState>
          )}
        </Panel>

        <Panel
          title="Açık olumsuz geri bildirimler"
          bodyClassName="p-0"
          actions={
            <Link href="/admin/geri-bildirim" className={btn("ghost", "sm")}>
              Tümü
            </Link>
          }
        >
          {openFb.length ? (
            <ul className="divide-y divide-line">
              {openFb.map((f) => (
                <li key={f.id}>
                  <Link href={`/admin/konusmalar/${f.conversationId}#m-${f.messageId}`} className="block px-5 py-3 hover:bg-sunken">
                    <div className="line-clamp-2 text-sm">{f.comment ? `“${f.comment}”` : truncate(f.content, 110)}</div>
                    <div className="mt-1 text-xs text-muted">{fmtRelative(f.createdAt)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Bekleyen olumsuz geri bildirim yok.</p>
          )}
        </Panel>

        <Panel
          title="Bilgi tabanında karşılığı olmayanlar"
          description="Bot kaynak bulamadı ve araç kullanmadı. Eğitim için iyi adaylar."
          bodyClassName="p-0"
        >
          {unanswered.length ? (
            <ul className="divide-y divide-line">
              {unanswered.map((u) => (
                <li key={u.id} className="px-5 py-3">
                  <div className="line-clamp-2 text-sm">{u.question || "(fotoğraf)"}</div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <span className="text-muted">{MODE_META[u.mode as keyof typeof MODE_META]?.label}</span>
                    <Link href={`/admin/konusmalar/${u.conversation_id}#m-${u.id}`} className="text-accent hover:underline">
                      Konuşma
                    </Link>
                    <Link
                      href={`/admin/egitim/bilgi-tabani?soru=${encodeURIComponent(u.question ?? "")}&mod=${u.mode}#sss`}
                      className="text-accent hover:underline"
                    >
                      SSS'ye ekle
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Tüm sorular bir kaynağa ya da araca dayanıyor.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
