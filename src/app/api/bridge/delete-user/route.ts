import { audit } from "@/lib/audit";
import { bridgeJson } from "@/lib/bridge/errors";
import { readBody, withBridge } from "@/lib/bridge/guard";
import { parseDeleteUser } from "@/lib/bridge/schema";
import { deleteUserData } from "@/lib/kvkk";

export const runtime = "nodejs";

/**
 * Kullanıcının bu bottaki tüm kaydını siler (köprü kaydı ve aynı kimlikle imzalı widget kayıtları). İdempotent:
 * kullanıcı yoksa 0, 0 döner. `user_id` denetim kaydına girmez; silme talebinde maskelenmiş yazılır.
 */
export async function POST(request: Request) {
  return withBridge(request, async ({ auth }) => {
    const body = await readBody(request, parseDeleteUser);
    if (!body.ok) return body.response;

    const r = await deleteUserData({
      botId: auth.botId,
      identifier: body.value.user_id,
      type: "external_user",
      requestedBy: `köprü:••••${auth.hint}`,
    });
    await audit(null, "kvkk.delete_user", "bridge", { found: r.found, conversations: r.conversations, photos: r.photos, keyHint: auth.hint });
    return bridgeJson({ deleted_conversations: r.conversations, deleted_photos: r.photos });
  });
}
