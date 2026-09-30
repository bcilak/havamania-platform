import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL || "http://localhost:3110").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/login", "/api/", "/w/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
