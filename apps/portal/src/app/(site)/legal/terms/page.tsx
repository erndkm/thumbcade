import { LEGAL_DOCS } from "@thumbcade/legal";
import type { Metadata } from "next";
import { LegalDocView } from "@/components/legal/legal-doc";

export const metadata: Metadata = { title: "Terms of Service", description: "The rules for playing and publishing on Thumbcade." };

export default function Terms() {
  return <LegalDocView doc={LEGAL_DOCS.terms} />;
}
