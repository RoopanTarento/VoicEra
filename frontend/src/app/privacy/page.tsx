import type { Metadata } from "next";
import { LegalPage } from "@/components/try/LegalPage";

export const metadata: Metadata = { title: "Privacy policy · VoicEra" };

export default function PrivacyPage() {
  return <LegalPage title="Privacy policy" />;
}
