import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { ConfirmButton, CopyButton, SubmitButton } from "@/components/client";
import { Badge, checkboxCls, Field, Flash, inputCls, PageHeader, Panel, selectCls, TableWrap, td, th } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/form";
import { fmtRelative } from "@/lib/format";
import { ROLE_META, ROLES } from "@/lib/roles";
import { createUser, reset2fa, resetPassword, updateUser } from "./actions";

export const metadata = { title: "Kullanıcılar" };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin("users");
  const sp = await searchParams;
  const users = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
  const jar = await cookies();
  let temp: { email: string; password: string } | null = null;
  try {
    temp = JSON.parse(jar.get("hm_temp_pw")?.value ?? "null");
  } catch {
    temp = null;
  }

  return (
    <>
      <PageHeader title="Kullanıcılar" description="Panele erişebilen ekip üyeleri ve rolleri." />
      <Flash sp={sp} />
      {temp && (
        <div className="mb-5 rounded-xl border border-warn/40 bg-warn-soft p-4">
          <div className="text-sm font-medium">{temp.email} için geçici şifre</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-surface px-3 py-1.5 font-mono text-sm">{temp.password}</code>
            <CopyButton text={temp.password} />
          </div>
          <p className="mt-2 text-xs text-muted">Bu şifre yalnızca 2 dakika boyunca burada görünür. Kullanıcıya güvenli bir kanaldan iletin; ilk girişte Hesabım sayfasından değiştirmesini isteyin.</p>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Kullanıcı</th>
            <th className={th}>Rol</th>
            <th className={th}>Durum</th>
            <th className={th}>Son giriş</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td className={td}>
                <div className="font-medium">
                  {u.name} {u.id === admin.id && <span className="text-xs font-normal text-muted">(siz)</span>}
                </div>
                <div className="text-xs text-muted">{u.email}</div>
              </td>
              <td className={td} colSpan={2}>
                <form action={updateUser} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={u.id} />
                  <select name="role" defaultValue={u.role} aria-label="Rol" className={`${selectCls} h-8 w-auto`}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_META[r].label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-[13px]">
                    <input type="checkbox" name="active" defaultChecked={u.active} className={checkboxCls} /> Aktif
                  </label>
                  {u.totpEnabled ? <Badge tone="good">2FA açık</Badge> : <Badge>2FA kapalı</Badge>}
                  <SubmitButton variant="ghost" size="sm">
                    Kaydet
                  </SubmitButton>
                </form>
              </td>
              <td className={`${td} whitespace-nowrap text-muted`}>{fmtRelative(u.lastLoginAt)}</td>
              <td className={`${td} text-right`}>
                <div className="flex justify-end gap-1">
                  <form action={resetPassword}>
                    <input type="hidden" name="id" value={u.id} />
                    <ConfirmButton variant="secondary" confirmText="Şifre sıfırlansın mı?">
                      Şifre sıfırla
                    </ConfirmButton>
                  </form>
                  {u.totpEnabled && (
                    <form action={reset2fa}>
                      <input type="hidden" name="id" value={u.id} />
                      <ConfirmButton variant="secondary" confirmText="2FA sıfırlansın mı?">
                        2FA sıfırla
                      </ConfirmButton>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Kullanıcı ekle" description="Geçici bir şifre oluşturulur ve bir kez gösterilir.">
          <form action={createUser} className="grid gap-3">
            <Field label="Ad soyad" htmlFor="name">
              <input id="name" name="name" required className={inputCls} />
            </Field>
            <Field label="E-posta" htmlFor="email">
              <input id="email" name="email" type="email" required className={inputCls} />
            </Field>
            <Field label="Rol" htmlFor="role">
              <select id="role" name="role" defaultValue="trainer" className={selectCls}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].label}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton pendingText="Ekleniyor…">Ekle</SubmitButton>
          </form>
        </Panel>
        <Panel title="Roller">
          <dl className="grid gap-3 text-sm">
            {ROLES.map((r) => (
              <div key={r}>
                <dt className="font-medium">{ROLE_META[r].label}</dt>
                <dd className="text-muted">{ROLE_META[r].description}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </>
  );
}
