import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try a scheme agent · VoicEra",
  description: "Build a voice agent that tells citizens which government schemes they qualify for. Try it free, no sign-up.",
};

export default function TryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
