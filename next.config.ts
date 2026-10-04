import type { NextConfig } from "next";

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(), geolocation=(), payment=(), usb=()" },
];

// Panel ve giriş başka sitelerin iframe'ine alınamaz (clickjacking).
const noFrame = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // Docker/VPS dağıtımı için kendi kendine yeten çıktı (.next/standalone).
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // Bilgi tabanı (20 MB) ve medya (10 MB) yüklemeleri server action ile gelir; varsayılan 1 MB.
    serverActions: { bodySizeLimit: "25mb" },
    // /admin istekleri proxy'den geçer; varsayılan 10 MB'ta gövde kesilirdi.
    proxyClientMaxBodySize: "25mb",
  },
  // Mağazalarda ve eski sitede kullanılan İngilizce adresler Türkçe sayfalara gider.
  async redirects() {
    return [
      { source: "/privacy", destination: "/gizlilik", permanent: true },
      { source: "/privacy-policy", destination: "/gizlilik", permanent: true },
      { source: "/terms", destination: "/kullanim-kosullari", permanent: true },
      { source: "/delete-account", destination: "/hesap-silme", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: common },
      { source: "/admin/:path*", headers: noFrame },
      { source: "/admin", headers: noFrame },
      { source: "/login", headers: noFrame },
      // /w/* bilerek iframe'e açık: web sitelerindeki widget.js onu gömer.
    ];
  },
};

export default nextConfig;
