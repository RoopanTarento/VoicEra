import type { Metadata } from "next";
import Link from "next/link";
import { VoicEraMark } from "@/components/ui/VoicEraMark";
import { CanvasReset } from "@/components/canvas/CanvasReset";

export const metadata: Metadata = {
  title: "VoicERA Canvas",
  description: "Start from your budget, build a custom voice package on a canvas, see the cost as you go, and follow it through to deployment.",
};

export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-v-bg text-v-fg">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-v-line bg-v-panel px-4 md:px-6">
        <Link href="/canvas" className="flex items-center gap-2.5" aria-label="VoicERA Canvas">
          <VoicEraMark size={22} className="text-v-fg" />
          <span className="text-[14px] font-semibold tracking-tight">VoicERA</span>
          <span className="rounded-v-sm border border-v-line px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Canvas</span>
        </Link>
        <nav aria-label="Canvas" className="flex items-center gap-4 text-[12.5px] text-v-body">
          <Link href="/adopt/all" className="hover:text-v-accent">All screens</Link>
          <CanvasReset />
        </nav>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
