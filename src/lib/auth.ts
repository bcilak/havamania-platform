import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { adminUsers, type AdminRole } from "@/db/schema";
import { can, type Permission } from "./roles";
import { ADMIN_COOKIE, verifyAdminSession } from "./session";

export type CurrentAdmin = { id: string; email: string; name: string; role: AdminRole };

/** Oturum çerezini doğrular ve kullanıcının hâlâ aktif olduğunu veritabanından teyit eder. */
export const getAdmin = cache(async (): Promise<CurrentAdmin | null> => {
  const jar = await cookies();
  const session = await verifyAdminSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db
    .select({ id: adminUsers.id, email: adminUsers.email, name: adminUsers.name, role: adminUsers.role, active: adminUsers.active })
    .from(adminUsers)
    .where(eq(adminUsers.id, session.sub));
  if (!user || !user.active) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
});

/** Sayfalarda ve server action'larda kullanılır. Yetki yoksa yönlendirir. */
export async function requireAdmin(permission?: Permission): Promise<CurrentAdmin> {
  const admin = await getAdmin();
  if (!admin) redirect("/login");
  if (permission && !can(admin.role, permission)) redirect("/admin?hata=yetki");
  return admin;
}
