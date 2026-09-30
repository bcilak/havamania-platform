import type { AdminRole } from "@/db/schema";

export type Permission =
  | "cms"
  | "media"
  | "conversations"
  | "photos"
  | "feedback"
  | "training"
  | "publish"
  | "models"
  | "users"
  | "kvkk"
  | "audit"
  | "integration"
  /** Cihaz kimliği, kullanıcı kimliği, konum gibi kişisel verileri maskesiz görme. */
  | "pii";

const ALL: Permission[] = [
  "cms",
  "media",
  "conversations",
  "photos",
  "feedback",
  "training",
  "publish",
  "models",
  "users",
  "kvkk",
  "audit",
  "integration",
  "pii",
];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  super_admin: ALL,
  editor: ["cms", "media"],
  trainer: ["conversations", "photos", "feedback", "training", "publish", "pii"],
  support: ["conversations", "photos", "feedback"],
};

export const ROLE_META: Record<AdminRole, { label: string; description: string }> = {
  super_admin: { label: "Süper admin", description: "Her şeye erişir: modeller, kullanıcılar, KVKK ve denetim kaydı dahil." },
  editor: { label: "İçerik editörü", description: "Site içeriğini ve medya kütüphanesini yönetir." },
  trainer: { label: "Bot eğitmeni", description: "Konuşmaları inceler, botu eğitir, test eder ve yayınlar." },
  support: { label: "Destek", description: "Konuşmaları ve fotoğrafları görür; kişisel veriler maskelidir." },
};

export const ROLES = Object.keys(ROLE_META) as AdminRole[];

export function can(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
