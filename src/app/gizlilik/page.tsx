import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

// Metin panelden gelir; derlemede veritabanına bağlanılmaz.
export const dynamic = "force-dynamic";
export const generateMetadata = () => legalMetadata("privacy");

export default function PrivacyPage() {
  return <LegalPage slug="privacy" />;
}
