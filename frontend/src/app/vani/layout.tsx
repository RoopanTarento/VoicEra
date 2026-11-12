import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { VaniProvider } from "@/components/vani/provider";
import "./vani.css";

const sans = Inter({ variable: "--font-vani-sans", subsets: ["latin"], display: "swap" });
const serif = Newsreader({ variable: "--font-vani-serif", subsets: ["latin"], display: "swap", weight: ["400", "500"], style: ["normal", "italic"] });
const mono = JetBrains_Mono({ variable: "--font-vani-mono", subsets: ["latin"], display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Vani Anuvaad", template: "%s · Vani Anuvaad" },
  description: "Design, configure and price the right Voice AI package for your workload, with the privacy rules built in.",
};

/** Runs before first paint so a remembered theme never flashes the wrong colours. */
const THEME_SCRIPT = `try{var t=localStorage.getItem('vani.theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.vaTheme=d?'dark':'light'}catch(e){document.documentElement.dataset.vaTheme='light'}`;

export default function VaniLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <div className={`va ${sans.variable} ${serif.variable} ${mono.variable} min-h-dvh`} style={{ position: "relative" }}>
        <a className="va-skip" href="#main">Skip to content</a>
        <VaniProvider>{children}</VaniProvider>
      </div>
    </>
  );
}
