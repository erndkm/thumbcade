import { LEGAL_DOCS } from "@thumbcade/legal";
import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Privacy Policy", description: "What Thumbcade processes about you, why, and your rights." };

export default function Privacy() {
  return <LegalDocView doc={LEGAL_DOCS.privacy} />;
}
