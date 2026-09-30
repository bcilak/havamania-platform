"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-6 text-center text-ink">
      <div className="max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Bir şeyler ters gitti</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyin; sorun sürerse bizimle iletişime geçin.
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-faint">Hata kodu: {error.digest}</p>}
        <button onClick={reset} className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover">
          Tekrar dene
        </button>
      </div>
    </main>
  );
}
