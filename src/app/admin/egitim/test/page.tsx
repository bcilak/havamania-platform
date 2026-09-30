import Link from "next/link";
import { ChatApp, type ModeInfo } from "@/components/chat/ChatApp";
import { Notice, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getMainBot } from "@/lib/bot";
import { MODE_DISCLAIMERS, MODES, TOOLS } from "@/lib/bot-config";

export const metadata = { title: "Test alanı" };

export default async function PlaygroundPage() {
  await requireAdmin("training");
  const bot = await getMainBot();
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
        description="Taslaktaki ayarlarla ve hazır olan tüm bilgi tabanı kaynaklarıyla sohbet edin. Her cevabın altında kullanılan kaynakları, araç çağrılarını ve maliyeti görürsünüz."
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
      <div className="h-[min(760px,calc(100dvh-220px))] min-h-[480px] overflow-hidden rounded-2xl border border-line">
        <ChatApp
          variant="playground"
          modes={modes}
          initialMode={modes[0]?.id ?? "genel"}
          photosEnabled={cfg.photosEnabled}
          maxPhotoMb={cfg.maxPhotoMb}
          toolLabels={Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label]))}
        />
      </div>
    </>
  );
}
