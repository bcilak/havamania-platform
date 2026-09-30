import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { ChatApp, type ModeInfo } from "@/components/chat/ChatApp";
import { getBotByPublicKey, getPublishedVersion } from "@/lib/bot";
import { MODE_DISCLAIMERS, MODES, TOOLS } from "@/lib/bot-config";

export const metadata: Metadata = { title: { absolute: "Havamania Asistan" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

/** Mobil uygulamanın WebView'da, web sitelerinin iframe'de açtığı sohbet ekranı. */
export default async function WidgetPage({ params }: { params: Promise<{ botKey: string }> }) {
  const { botKey } = await params;
  const bot = await getBotByPublicKey(botKey);
  if (!bot) notFound();
  const published = await getPublishedVersion(bot);
  if (!published) {
    return (
      <main className="grid h-dvh place-items-center bg-ground p-6 text-center text-ink">
        <div>
          <p className="text-[15px] font-medium">Asistan hazırlanıyor</p>
          <p className="mt-1 text-sm text-muted">Çok yakında burada olacak.</p>
        </div>
      </main>
    );
  }
  const cfg = published.config;
  const modes: ModeInfo[] = MODES.filter((m) => cfg.modes[m].enabled).map((m) => ({
    id: m,
    label: cfg.modes[m].label,
    greeting: cfg.modes[m].greeting,
    suggestions: cfg.modes[m].suggestions,
    disclaimer: MODE_DISCLAIMERS[m],
  }));
  return (
    <main className="h-dvh overflow-hidden bg-ground text-ink">
      <ChatApp
        variant="widget"
        botKey={bot.publicKey}
        modes={modes}
        initialMode={modes[0]?.id ?? "genel"}
        photosEnabled={cfg.photosEnabled}
        maxPhotoMb={cfg.maxPhotoMb}
        toolLabels={Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label]))}
      />
    </main>
  );
}
