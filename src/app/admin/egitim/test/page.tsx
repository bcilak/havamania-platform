import Link from "next/link";
import { PlaygroundShell, type VersionOption } from "@/components/admin/PlaygroundShell";
import type { ModeInfo } from "@/components/chat/ChatApp";
import { Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot, listVersions } from "@/lib/bot";
import { MODE_DISCLAIMERS, MODES, TOOLS } from "@/lib/bot-config";

export const metadata = { title: "Test alanı" };

/** Adres: ?hedef=yayin (yayındaki sürüm) ya da ?surum=<sürüm kimliği>. Listede olmayan değer yok sayılır, taslak açılır. */
export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("training");
  const sp = await searchParams;
  const bot = await getMainBot();
  const versions: VersionOption[] = (await listVersions(bot.id)).map((v) => ({
    id: v.id,
    number: v.number,
    note: v.note,
    published: v.id === bot.publishedVersionId,
  }));
  const surum = typeof sp.surum === "string" ? sp.surum : "";
  const initialSelection =
    sp.hedef === "yayin" && versions.some((v) => v.published) ? "published" : versions.some((v) => v.id === surum) ? `v:${surum}` : "draft";

  const cfg = bot.draftConfig;
  const modes: ModeInfo[] = MODES.filter((m) => cfg.modes[m].enabled).map((m) => ({
    id: m,
    label: cfg.modes[m].label,
    greeting: cfg.modes[m].greeting,
    suggestions: cfg.modes[m].suggestions,
    disclaimer: MODE_DISCLAIMERS[m],
  }));
  const missing = MODES.filter((m) => cfg.modes[m].enabled && !(cfg.modes[m].providerId && cfg.modes[m].model));

  return (
    <>
      <PageHeader
        title="Test alanı"
        description="Taslaktaki, yayındaki ya da seçtiğiniz bir sürümdeki ayarlarla sohbet edin. Her cevabın altında kullanılan kaynakları, araç çağrılarını ve maliyeti görürsünüz. Test konuşmaları istatistiklere girmez."
      />
      {missing.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {missing.map((m) => cfg.modes[m].label).join(", ")} için henüz model seçilmedi.{" "}
            <Link href="/admin/egitim/kisilik" className="font-medium text-accent underline">
              Kişilik ve ton
            </Link>{" "}
            sayfasından seçin (önce{" "}
            <Link href="/admin/ayarlar/modeller" className="font-medium text-accent underline">
              bir sağlayıcı ekleyin
            </Link>
            ).
          </Notice>
        </div>
      )}
      <PlaygroundShell
        versions={versions}
        initialSelection={initialSelection}
        modes={modes}
        initialMode={modes[0]?.id ?? "genel"}
        photosEnabled={cfg.photosEnabled}
        maxPhotoMb={cfg.maxPhotoMb}
        toolLabels={Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label]))}
      />
    </>
  );
}
