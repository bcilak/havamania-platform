import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import { CopyButton, SubmitButton } from "@/components/client";
import { Badge, Field, Flash, inputCls, KeyValue, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { decryptOrNull } from "@/lib/crypto";
import type { SearchParams } from "@/lib/form";
import { fmtDateTime } from "@/lib/format";
import { ROLE_META } from "@/lib/roles";
import { totpUri } from "@/lib/totp";
import { changePassword, confirm2fa, disable2fa, start2fa } from "./actions";

export const metadata = { title: "Hesabım" };

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const [u] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  const pendingSecret = !u.totpEnabled ? decryptOrNull(u.totpSecretEnc) : null;

  return (
    <>
      <PageHeader title="Hesabım" />
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Bilgiler">
          <KeyValue
            items={[
              ["Ad", u.name],
              ["E-posta", u.email],
              ["Rol", ROLE_META[u.role].label],
              ["Son giriş", fmtDateTime(u.lastLoginAt)],
            ]}
          />
        </Panel>
        <Panel title="Şifre değiştir">
          <form action={changePassword} className="grid gap-3">
            <Field label="Mevcut şifre" htmlFor="current">
              <input id="current" name="current" type="password" autoComplete="current-password" required className={inputCls} />
            </Field>
            <Field label="Yeni şifre" htmlFor="next" hint="En az 10 karakter.">
              <input id="next" name="next" type="password" autoComplete="new-password" minLength={10} required className={inputCls} />
            </Field>
            <Field label="Yeni şifre (tekrar)" htmlFor="repeat">
              <input id="repeat" name="repeat" type="password" autoComplete="new-password" required className={inputCls} />
            </Field>
            <SubmitButton pendingText="Değiştiriliyor…">Şifreyi değiştir</SubmitButton>
          </form>
        </Panel>
        <Panel
          title={
            <span className="flex items-center gap-2">
              İki adımlı doğrulama {u.totpEnabled ? <Badge tone="good">Açık</Badge> : <Badge>Kapalı</Badge>}
            </span>
          }
          description="Girişte şifreye ek olarak Google Authenticator, 1Password gibi bir uygulamadaki 6 haneli kod istenir."
        >
          {u.totpEnabled ? (
            <form action={disable2fa} className="flex flex-wrap items-end gap-2">
              <Field label="Kapatmak için güncel kod" htmlFor="code-off">
                <input id="code-off" name="code" inputMode="numeric" autoComplete="one-time-code" required className={`${inputCls} tabular w-36`} />
              </Field>
              <SubmitButton variant="danger">Kapat</SubmitButton>
            </form>
          ) : pendingSecret ? (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <div className="text-[13px] font-medium">1. Bu anahtarı uygulamanıza ekleyin</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 font-mono text-sm tracking-wider">{pendingSecret}</code>
                  <CopyButton text={pendingSecret} />
                </div>
                <a href={totpUri(pendingSecret, u.email)} className="text-xs text-accent underline">
                  Telefonda açıyorsanız uygulamaya doğrudan ekleyin
                </a>
              </div>
              <form action={confirm2fa} className="flex flex-wrap items-end gap-2">
                <Field label="2. Uygulamadaki kodu girin" htmlFor="code-on">
                  <input id="code-on" name="code" inputMode="numeric" autoComplete="one-time-code" required className={`${inputCls} tabular w-36`} />
                </Field>
                <SubmitButton>Doğrula ve aç</SubmitButton>
              </form>
            </div>
          ) : (
            <form action={start2fa}>
              <SubmitButton>Kurmaya başla</SubmitButton>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}
