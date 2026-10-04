import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Havamania", template: "%s · Havamania Panel" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Landing, hidrasyondan önce <html>'e "hm-js" sınıfını ekler; bu fark beklenen bir durum.
    <html lang="tr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
