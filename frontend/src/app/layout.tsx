import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "VoicEra",
  description: "VoicEra",
  icons: {
    icon: "/voicera-logo.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Browser extensions (screen recorders, translators, password managers) add attributes to
    // <html> and <body> before React loads, which triggers a hydration warning on every refresh.
    // These two elements are static, so the warning is safe to suppress here.
    <html
      lang="en"
      className={`${jakarta.variable} ${ibmPlexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>{children}</body>
    </html>
  );
}
