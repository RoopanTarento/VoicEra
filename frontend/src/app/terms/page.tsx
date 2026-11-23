import type { Metadata } from "next";
import { LegalPage } from "@/components/try/LegalPage";

export const metadata: Metadata = { title: "Terms of use · VoicEra" };

export default function TermsPage() {
  return <LegalPage title="Terms of use" />;
}
