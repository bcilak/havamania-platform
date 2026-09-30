import { redirect } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { SubmitButton } from "@/components/client";
import { Field, inputCls } from "@/components/ui";
import { getAdmin } from "@/lib/auth";
import { param, type SearchParams } from "@/lib/form";
import { login, verifyCode } from "./actions";

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (await getAdmin()) redirect("/admin");
  const sp = await searchParams;
  const error = param(sp, "hata");
  const next = param(sp, "sonra");
  const codeStep = param(sp, "adim") === "kod";

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-4 py-10 text-ink">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="rounded-xl bg-white px-3 py-2 ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/havamania-logo.png" alt="Havamania" className="h-8 w-auto" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{codeStep ? "Doğrulama kodu" : "Panele giriş"}</h1>
            <p className="mt-1 text-sm text-muted">
              {codeStep ? "Doğrulama uygulamanızdaki 6 haneli kodu girin." : "Havamania yönetim paneli"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-ink">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
              {error}
            </div>
          )}
          {codeStep ? (
            <form action={verifyCode} className="grid gap-4">
              <input type="hidden" name="sonra" value={next} />
              <Field label="Kod" htmlFor="code">
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  required
                  autoFocus
                  className={`${inputCls} tabular text-center text-lg tracking-[0.3em]`}
                />
              </Field>
              <SubmitButton pendingText="Doğrulanıyor…" className="w-full">
                Doğrula ve giriş yap
              </SubmitButton>
              <a href="/login" className="text-center text-[13px] text-muted hover:text-ink">
                Farklı bir hesapla giriş yap
              </a>
            </form>
          ) : (
            <form action={login} className="grid gap-4">
              <input type="hidden" name="sonra" value={next} />
              <Field label="E-posta" htmlFor="email">
                <input id="email" name="email" type="email" autoComplete="username" required autoFocus className={inputCls} />
              </Field>
              <Field label="Şifre" htmlFor="password">
                <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
              </Field>
              <SubmitButton pendingText="Giriş yapılıyor…" className="w-full">
                Giriş yap
              </SubmitButton>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted">© Altıkod Digital Solutions</p>
      </div>
    </main>
  );
}
