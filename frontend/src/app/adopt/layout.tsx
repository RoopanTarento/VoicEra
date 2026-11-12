import type { Metadata } from "next";
import { AdoptShell } from "@/components/adopt/AdoptShell";

export const metadata: Metadata = {
  title: {
    default: "VoicERA for government",
    template: "%s | VoicERA for government",
  },
  description:
    "Choose a government service, hear how it would sound, and plan a VoicERA deployment. Describe it. Hear it. Deploy it.",
};

export default function AdoptLayout({ children }: { children: React.ReactNode }) {
  return <AdoptShell>{children}</AdoptShell>;
}
