import { LEGAL_DOCS } from "@thumbcade/legal";
import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Community guidelines", description: "How we keep Thumbcade fun and fair for everyone." };

export default function Guidelines() {
  return <LegalDocView doc={LEGAL_DOCS.guidelines} />;
}
