import type { Metadata } from "next";
import { TryFlow } from "@/components/try/TryFlow";

export const metadata: Metadata = {
  title: "VoicEra · Build a voice agent",
  description: "Build a voice agent and talk to it in a minute. No sign-up: pick what it should do, choose a language, and try a call in your browser.",
};

/** The home page is the no-login flow; sign-in lives at /signin. */
export default function HomePage() {
  return <TryFlow />;
}
