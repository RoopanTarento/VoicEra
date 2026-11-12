import type { Metadata } from "next";
import "./builder.css";

export const metadata: Metadata = {
  title: "VoicERA Package Builder",
  description: "Find the right VoicERA package, build it on a canvas, see exactly what it costs, grow it later, and see how it goes live.",
};

/** Runs before the first paint, so a remembered light theme never flashes dark. Dark is the default. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('voicera.builder.theme');document.documentElement.dataset.vbTheme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.vbTheme='dark'}`;

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <div className="vb vb-ambient vb-unclip h-dvh overflow-hidden">{children}</div>
    </>
  );
}
