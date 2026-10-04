import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { Sidebar, type NavGroup } from "@/components/admin/Sidebar";
import { requireAdmin } from "@/lib/auth";
import { can, ROLE_META, type Permission } from "@/lib/roles";
import { logout } from "@/app/login/actions";

export const metadata = { title: { default: "Pano", template: "%s · Havamania Panel" } };

type Item = NavGroup["items"][number] & { perm?: Permission };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const allowed = (i: Item) => !i.perm || can(admin.role, i.perm);

  let openFeedback = 0;
  if (can(admin.role, "feedback")) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(eq(feedback.status, "open"), eq(feedback.rating, -1)));
    openFeedback = row?.n ?? 0;
  }

  const groups: { label: string | null; items: Item[] }[] = [
    { label: null, items: [{ href: "/admin", label: "Pano", icon: "dashboard" }] },
    {
      label: "İçerik",
      items: [
        { href: "/admin/icerik", label: "Site sayfaları", icon: "cms", perm: "cms" },
        { href: "/admin/medya", label: "Medya kütüphanesi", icon: "media", perm: "media" },
        { href: "/admin/yasal", label: "Yasal sayfalar", icon: "legal", perm: "cms" },
      ],
    },
    {
      label: "Asistan",
      items: [
        { href: "/admin/konusmalar", label: "Konuşmalar", icon: "conversations", perm: "conversations" },
        { href: "/admin/fotograflar", label: "Fotoğraflar", icon: "photos", perm: "photos" },
        { href: "/admin/geri-bildirim", label: "Geri bildirim", icon: "feedback", perm: "feedback", badge: openFeedback },
      ],
    },
    {
      label: "Eğitim",
      items: [
        { href: "/admin/egitim/bilgi-tabani", label: "Bilgi tabanı", icon: "kb", perm: "training" },
        { href: "/admin/egitim/kisilik", label: "Kişilik ve ton", icon: "persona", perm: "training" },
        { href: "/admin/egitim/duzeltmeler", label: "Düzeltmeler", icon: "corrections", perm: "training" },
        { href: "/admin/egitim/test", label: "Test alanı", icon: "test", perm: "training" },
      ],
    },
    {
      label: "Yayın",
      items: [{ href: "/admin/yayin", label: "Sürümler ve gömme", icon: "publish", perm: "publish" }],
    },
    {
      label: "Yönetim",
      items: [
        { href: "/admin/ayarlar/modeller", label: "Modeller", icon: "models", perm: "models" },
        { href: "/admin/ayarlar/entegrasyon", label: "Veri entegrasyonu", icon: "integration", perm: "integration" },
        { href: "/admin/ayarlar/kullanicilar", label: "Kullanıcılar", icon: "users", perm: "users" },
        { href: "/admin/ayarlar/kvkk", label: "KVKK", icon: "kvkk", perm: "kvkk" },
        { href: "/admin/ayarlar/denetim", label: "Denetim kaydı", icon: "audit", perm: "audit" },
      ],
    },
  ];

  const visible: NavGroup[] = groups
    .map((g) => ({ label: g.label, items: g.items.filter(allowed).map(({ perm: _perm, ...rest }) => rest) }))
    .filter((g) => g.items.length);

  return (
    <div className="min-h-dvh bg-ground text-ink lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <Sidebar groups={visible} user={{ name: admin.name, roleLabel: ROLE_META[admin.role].label }} logout={logout} />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-[1160px]">{children}</div>
      </main>
    </div>
  );
}
