import { LEGAL_DOCS } from "@thumbcade/legal";
import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Imprint", description: "Who provides Thumbcade and how to reach us." };

export default function Imprint() {
  return <LegalDocView doc={LEGAL_DOCS.imprint} />;
}
