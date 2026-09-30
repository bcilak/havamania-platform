import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { btn, PageHeader, selectCls, TableWrap, td, th } from "@/components/ui";
import { AUDIT_LABELS } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { param, type SearchParams } from "@/lib/form";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Denetim kaydı" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("audit");
  const sp = await searchParams;
  const action = param(sp, "islem");
  const page = Math.max(1, Number(param(sp, "sayfa")) || 1);
  const where = action ? eq(auditLog.action, action) : undefined;
  const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(where);
  const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.createdAt)).limit(PAGE).offset((page - 1) * PAGE);
  const q = (p: number) => `?${new URLSearchParams({ ...(action ? { islem: action } : {}), sayfa: String(p) })}`;

  return (
    <>
      <PageHeader title="Denetim kaydı" description="Paneldeki önemli işlemler: kim, neyi, ne zaman yaptı. Kayıtlar silinemez." />
      <form className="mb-4 flex gap-2">
        <select name="islem" defaultValue={action} className={`${selectCls} w-auto`} aria-label="İşlem">
          <option value="">Tüm işlemler</option>
          {Object.entries(AUDIT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className={btn("secondary")}>Uygula</button>
      </form>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Zaman</th>
            <th className={th}>Kişi</th>
            <th className={th}>İşlem</th>
            <th className={th}>Hedef</th>
            <th className={th}>Ayrıntı</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtDateTime(r.createdAt)}</td>
              <td className={td}>{r.actorEmail}</td>
              <td className={td}>{AUDIT_LABELS[r.action] ?? r.action}</td>
              <td className={`${td} font-mono text-xs text-muted`}>{r.target ?? "—"}</td>
              <td className={`${td} max-w-sm font-mono text-xs break-all text-muted`}>{r.detail ? JSON.stringify(r.detail) : ""}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className={`${td} text-muted`}>
                Kayıt yok.
              </td>
            </tr>
          )}
        </tbody>
      </TableWrap>
      {total > PAGE && (
        <div className="mt-4 flex justify-end gap-2">
          {page > 1 && (
            <Link className={btn("secondary", "sm")} href={q(page - 1)}>
              Önceki
            </Link>
          )}
          {page * PAGE < total && (
            <Link className={btn("secondary", "sm")} href={q(page + 1)}>
              Sonraki
            </Link>
          )}
        </div>
      )}
    </>
  );
}
