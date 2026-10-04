import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

// Metin panelden gelir; derlemede veritabanına bağlanılmaz.
export const dynamic = "force-dynamic";
export const generateMetadata = () => legalMetadata("deletion");

export default function DeletionPage() {
  return <LegalPage slug="deletion" />;
}
