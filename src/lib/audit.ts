import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { CurrentAdmin } from "./auth";

export async function audit(
  actor: Pick<CurrentAdmin, "id" | "email"> | null,
  action: string,
  target?: string | null,
  detail?: Record<string, unknown>,
) {
  await db.insert(auditLog).values({
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? "sistem",
    action,
    target: target ?? null,
    detail: detail ?? null,
  });
}

export const AUDIT_LABELS: Record<string, string> = {
  "auth.login": "Giriş yaptı",
  "auth.logout": "Çıkış yaptı",
  "auth.2fa_enabled": "İki adımlı doğrulamayı açtı",
  "auth.2fa_disabled": "İki adımlı doğrulamayı kapattı",
  "user.create": "Kullanıcı ekledi",
  "user.update": "Kullanıcıyı güncelledi",
  "user.password_reset": "Şifre sıfırladı",
  "provider.create": "Model sağlayıcısı ekledi",
  "provider.update": "Model sağlayıcısını güncelledi",
  "provider.delete": "Model sağlayıcısını sildi",
  "embedding.update": "Embedding ayarını değiştirdi",
  "kb.reindex": "Bilgi tabanını yeniden indeksledi",
  "integration.update": "Havamania veri API ayarını değiştirdi",
  "bot.config": "Asistan ayarlarını düzenledi",
  "bot.publish": "Asistanı yayınladı",
  "bot.rollback": "Önceki sürüme döndü",
  "bot.version_note": "Sürüm notunu düzenledi",
  "bot.embed": "Gömme ayarlarını değiştirdi",
  "bot.token_secret": "Kullanıcı token anahtarını yeniledi",
  "kb.create": "Bilgi tabanına kaynak ekledi",
  "kb.delete": "Bilgi tabanından kaynak sildi",
  "kb.update": "Bilgi tabanı kaynağını düzenledi",
  "correction.create": "Düzeltme ekledi",
  "eval.case_create": "Test senaryosu ekledi",
  "eval.case_update": "Test senaryosunu düzenledi",
  "eval.case_delete": "Test senaryosunu sildi",
  "eval.run_start": "Test senaryosu koşusu başlattı",
  "eval.run_cancel": "Test senaryosu koşusunu iptal etti",
  "eval.run_delete": "Test senaryosu koşusunu ve sonuçlarını sildi",
  "feedback.update": "Geri bildirimi güncelledi",
  "conversation.flag": "Konuşmayı işaretledi",
  "conversation.delete": "Konuşmayı sildi",
  "photo.hide": "Fotoğrafı gizledi",
  "photo.show": "Fotoğrafı yeniden gösterdi",
  "photo.delete": "Fotoğrafı sildi",
  "cms.save": "Site içeriğini kaydetti",
  "cms.publish": "Site içeriğini yayınladı",
  "media.upload": "Medya yükledi",
  "media.delete": "Medya sildi",
  "kvkk.update": "KVKK ayarlarını değiştirdi",
  "kvkk.delete_user": "Silme talebini işledi",
  "kvkk.cleanup": "Saklama süresi temizliğini çalıştırdı",
  "demo.delete": "Örnek verileri sildi",
};
