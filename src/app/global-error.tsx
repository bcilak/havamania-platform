"use client";

/* Kök düzenin kendisi çökerse gösterilir; bu yüzden kendi <html>'ini taşır. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", background: "#f5f5f7", color: "#1d1d1f" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Bir şeyler ters gitti</h1>
            <p style={{ color: "#5c5c61", marginTop: 8 }}>Lütfen birazdan tekrar deneyin.</p>
            <button onClick={reset} style={{ marginTop: 20, height: 40, padding: "0 20px", border: 0, borderRadius: 999, background: "#0071e3", color: "#fff", fontSize: 14, cursor: "pointer" }}>
              Tekrar dene
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
