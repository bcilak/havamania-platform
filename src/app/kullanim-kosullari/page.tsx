import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

// Metin panelden gelir; derlemede veritabanına bağlanılmaz.
export const dynamic = "force-dynamic";
export const generateMetadata = () => legalMetadata("terms");

export default function TermsPage() {
  return <LegalPage slug="terms" />;
}
