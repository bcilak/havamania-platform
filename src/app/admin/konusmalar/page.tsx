import Link from "next/link";
import { and, desc, eq, gte, gt, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { Camera, Flag, MessagesSquare, ThumbsDown } from "lucide-react";
import { db } from "@/db";
import { appUsers, conversations, messages, type ChatMode, type Platform } from "@/db/schema";
import { Badge, btn, EmptyState, Flash, inputCls, ModeBadge, PageHeader, selectCls, TableWrap, td, th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { BRIDGE_DEVICE_ID } from "@/lib/bridge/keys-core";
import { MODES, MODE_META } from "@/lib/bot-config";
import { param, type SearchParams } from "@/lib/form";
import { fmtInt, fmtRelative, fmtUsd, maskId, PLATFORM_LABEL } from "@/lib/format";
import { healthRestricted, maskPii, piiText } from "@/lib/pii-mask";
import { can } from "@/lib/roles";

export const metadata = { title: "Konuşmalar" };
const PAGE = 40;

export default async function ConversationsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("conversations");
  const sp = await searchParams;
  const pii = can(admin.role, "pii");
  const rawQ = param(sp, "q");
  // Kişisel veri görmeyen rol telefon/e-posta/koordinat deseniyle arayarak mesajlarda kişisel veri sorgulayamaz:
  // desen kontrolüne ek olarak, harf/rakam dışı karakterler atılınca 3'ten uzun rakam dizisi ya da "@" içeren sorgu engellenir.
  const searchBlocked = !pii && (maskPii(rawQ) !== rawQ || /\d{4,}/.test(rawQ.replace(/[^\p{L}\p{N}]/gu, "")) || rawQ.includes("@"));
  const q = searchBlocked ? "" : rawQ;
  // ILIKE jokerleri (\ % _) her rol için kaçışlanır; "_" ile hane hane çıkarım yapılamaz (PostgreSQL varsayılan kaçış karakteri \).
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const mode = param(sp, "mod") as ChatMode | "";
  const platform = param(sp, "platform") as Platform | "";
  const state = param(sp, "durum");
  const source = param(sp, "kaynak");
  const range = param(sp, "aralik") || "30";
  const page = Math.max(1, Number(param(sp, "sayfa")) || 1);

  const where: SQL[] = [];
  if (platform) where.push(eq(conversations.platform, platform));
  else where.push(ne(conversations.platform, "playground"));
  if (mode && MODES.includes(mode)) where.push(eq(conversations.mode, mode));
  // Kaynak: köprü (mobil backend, sunucudan sunucuya) ya da widget/web ve test alanı.
  const bridgeUsers = db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.deviceId, BRIDGE_DEVICE_ID));
  if (source === "kopru") where.push(inArray(conversations.appUserId, bridgeUsers));
  if (source === "widget") where.push(or(isNull(conversations.appUserId), notInArray(conversations.appUserId, bridgeUsers))!);
  if (range !== "tumu") where.push(gte(conversations.lastMessageAt, sql`now() - make_interval(days => ${Number(range) || 30})`));
  if (state === "olumsuz") where.push(gt(conversations.negativeCount, 0));
  if (state === "isaretli") where.push(eq(conversations.flagged, true));
  if (state === "fotografli") where.push(gt(conversations.photoCount, 0));
  if (state === "cevapsiz")
    where.push(inArray(conversations.id, db.select({ id: messages.conversationId }).from(messages).where(eq(messages.unanswered, true))));
  // Engellenen arama filtresiz tüm listeyi döndürmez; sonuç boş kalır (arama kutusu da boş basılır).
  if (searchBlocked) where.push(sql`false`);
  if (q) {
    // Sağlık işaretli konuşmalar içerik aramasıyla yetkisiz rolden "var/yok" diye sorgulanamaz.
    if (!pii) where.push(eq(conversations.healthContext, false));
    where.push(
      or(
        ilike(conversations.title, like),
        inArray(conversations.id, db.select({ id: messages.conversationId }).from(messages).where(ilike(messages.content, like))),
      )!,
    );
  }

  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(and(...where));
  const rows = await db
    .select({ c: conversations, deviceId: appUsers.deviceId, externalUserId: appUsers.externalUserId })
    .from(conversations)
    .leftJoin(appUsers, eq(appUsers.id, conversations.appUserId))
    .where(and(...where))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, mod: mode, platform, durum: state, kaynak: source, aralik: range })) if (v) u.set(k, v);
    u.set("sayfa", String(p));
    return `?${u}`;
  };

  return (
    <>
      <PageHeader title="Konuşmalar" description="Mobil uygulama ve web üzerinden asistanla yapılan tüm yazışmalar." />
      <Flash sp={sp} />
      {searchBlocked && (
        <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm" role="status">
          Rolünüz gereği telefon, e-posta, numara ve konum içeren aramalar yapılamaz.
        </p>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Mesajlarda ara…" aria-label="Ara" className={`${inputCls} w-full sm:w-64`} />
        <select name="mod" defaultValue={mode} aria-label="Mod" className={`${selectCls} w-auto`}>
          <option value="">Tüm modlar</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_META[m].label}
            </option>
          ))}
        </select>
        <select name="platform" defaultValue={platform} aria-label="Platform" className={`${selectCls} w-auto`}>
          <option value="">Tüm platformlar</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
          <option value="web">Web</option>
          <option value="playground">Test alanı</option>
        </select>
        <select name="kaynak" defaultValue={source} aria-label="Kaynak" className={`${selectCls} w-auto`}>
          <option value="">Tüm kaynaklar</option>
          <option value="kopru">Mobil (native, köprü)</option>
          <option value="widget">Widget / web</option>
        </select>
        <select name="durum" defaultValue={state} aria-label="Durum" className={`${selectCls} w-auto`}>
          <option value="">Hepsi</option>
          <option value="olumsuz">Olumsuz geri bildirim alan</option>
          <option value="cevapsiz">Karşılığı bulunamayan soru içeren</option>
          <option value="fotografli">Fotoğraflı</option>
          <option value="isaretli">İşaretli</option>
        </select>
        <select name="aralik" defaultValue={range} aria-label="Tarih aralığı" className={`${selectCls} w-auto`}>
          <option value="7">Son 7 gün</option>
          <option value="30">Son 30 gün</option>
          <option value="90">Son 90 gün</option>
          <option value="tumu">Tüm zamanlar</option>
        </select>
        <button className={btn("secondary")}>Uygula</button>
        {(q || mode || platform || state || source || range !== "30") && (
          <Link href="/admin/konusmalar" className={btn("ghost")}>
            Temizle
          </Link>
        )}
      </form>

      {rows.length ? (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Konuşma</th>
                <th className={th}>Mod</th>
                <th className={th}>Platform</th>
                <th className={th}>Kullanıcı</th>
                <th className={`${th} text-right`}>Mesaj</th>
                <th className={`${th} text-right`}>Maliyet</th>
                <th className={th}>Son mesaj</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, deviceId, externalUserId }) => (
                <tr key={c.id} className="hover:bg-sunken/60">
                  <td className={td}>
                    <Link href={`/admin/konusmalar/${c.id}`} className="font-medium hover:text-accent">
                      {healthRestricted(pii, c.healthContext) ? "İçerik gizli (sağlık bilgisi içerebilir)" : c.title ? piiText(pii, c.title) : "Başlıksız"}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.isDemo && <Badge>Örnek</Badge>}
                      {deviceId === BRIDGE_DEVICE_ID && <Badge tone="accent">Mobil (native)</Badge>}
                      {c.negativeCount > 0 && (
                        <Badge tone="bad">
                          <ThumbsDown className="size-3" /> {c.negativeCount}
                        </Badge>
                      )}
                      {c.photoCount > 0 && (
                        <Badge tone="accent">
                          <Camera className="size-3" /> {c.photoCount}
                        </Badge>
                      )}
                      {c.flagged && (
                        <Badge tone="warn">
                          <Flag className="size-3" /> İşaretli
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className={td}>
                    <ModeBadge mode={c.mode} />
                  </td>
                  <td className={`${td} text-muted`}>{PLATFORM_LABEL[c.platform]}</td>
                  <td className={`${td} font-mono text-xs text-muted`}>
                    {c.platform === "playground" ? "—" : pii ? (externalUserId ?? deviceId ?? "—") : maskId(externalUserId ?? deviceId)}
                  </td>
                  <td className={`${td} tabular text-right`}>{fmtInt(c.messageCount)}</td>
                  <td className={`${td} tabular text-right text-muted`}>{fmtUsd(c.costUsd)}</td>
                  <td className={`${td} whitespace-nowrap text-muted`}>{fmtRelative(c.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span className="tabular">
              {fmtInt(total)} konuşma · sayfa {page}/{pages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link className={btn("secondary", "sm")} href={qs(page - 1)}>
                  Önceki
                </Link>
              )}
              {page < pages && (
                <Link className={btn("secondary", "sm")} href={qs(page + 1)}>
                  Sonraki
                </Link>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-line bg-surface">
          <EmptyState icon={MessagesSquare} title={searchBlocked || q || mode || platform || state || source ? "Filtreye uyan konuşma yok" : "Henüz konuşma yok"}>
            {searchBlocked || q || mode || platform || state || source
              ? "Filtreleri değiştirmeyi ya da tarih aralığını genişletmeyi deneyin."
              : "Asistan uygulamaya gömüldüğünde konuşmalar burada listelenecek. Bu arada Test alanında deneyebilirsiniz."}
          </EmptyState>
        </div>
      )}
    </>
  );
}
