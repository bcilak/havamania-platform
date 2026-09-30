import Link from "next/link";

export const metadata = { title: { absolute: "Sayfa bulunamadı · Havamania" } };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-6 text-center text-ink">
      <div className="max-w-sm">
        <p className="text-sm font-semibold tracking-wide text-accent">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Aradığınız sayfa burada değil</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Bağlantı eskimiş ya da yanlış yazılmış olabilir.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover">
          Ana sayfaya dön
        </Link>
      </div>
    </main>
  );
}
