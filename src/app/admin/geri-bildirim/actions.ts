"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { done, str } from "@/lib/form";

export async function setFeedbackStatus(fd: FormData) {
  const admin = await requireAdmin("feedback");
  const id = str(fd, "id");
  const status = str(fd, "status") as "open" | "resolved" | "dismissed";
  if (!["open", "resolved", "dismissed"].includes(status)) return;
  await db.update(feedback).set({ status, resolvedBy: status === "open" ? null : admin.email }).where(eq(feedback.id, id));
  await audit(admin, "feedback.update", id, { status });
  revalidatePath("/admin", "layout");
  done(str(fd, "back") || "/admin/geri-bildirim", status === "resolved" ? "Çözüldü olarak işaretlendi." : status === "dismissed" ? "Yoksayıldı." : "Yeniden açıldı.");
}
