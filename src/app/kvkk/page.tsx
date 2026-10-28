import { LegalPage, legalMetadata } from "@/components/legal/LegalPage";

// Metin panelden gelir; derlemede veritabanına bağlanılmaz.
export const dynamic = "force-dynamic";
export const generateMetadata = () => legalMetadata("kvkk");

export default function KvkkPage() {
  return <LegalPage slug="kvkk" />;
}
