import type { Metadata } from "next";
import Link from "next/link";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { StudioReset } from "@/components/studio/StudioReset";

export const metadata: Metadata = {
  title: "VoicERA Studio",
  description: "Describe a voice service in your own words. The studio works out what it needs and draws it as you go.",
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-v-bg text-v-fg">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-v-line bg-v-panel px-4 md:px-6">
        <Link href="/studio" className="flex items-center gap-2.5" aria-label="VoicERA Studio">
          <VoicEraMark size={22} className="text-v-fg" />
          <span className="text-[14px] font-semibold tracking-tight">VoicERA</span>
          <span className="rounded-v-sm border border-v-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Studio</span>
        </Link>
        <nav aria-label="Studio" className="flex items-center gap-4 text-[12.5px] text-v-body">
          <Link href="/adopt/all" className="hover:text-v-accent">All screens</Link>
          <Link href="/adopt/advisor/result" className="hidden hover:text-v-accent sm:inline">Full recommendation</Link>
          <StudioReset />
        </nav>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
