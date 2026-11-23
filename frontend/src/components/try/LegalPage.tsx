import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/ui/VoicEraMark";

/** Terms / Privacy page shell. The text is to be written; until then the page
 * says so plainly instead of linking nowhere. */
export function LegalPage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-v-bg text-v-fg">
      <header className="border-b border-v-line bg-white">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="VoicEra home">
            <LogoMark size={30} />
            <span className="text-[16px] font-semibold tracking-tight">VoicEra</span>
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-v-muted-2 hover:text-v-fg">
            <ArrowLeft className="size-4" strokeWidth={1.9} />
            Back
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-14 sm:px-6">
        <h1 className="m-0 text-[32px] font-semibold tracking-tight sm:text-[40px]">{title}</h1>
        <div className="mt-6 flex flex-col gap-4 text-[15.5px] leading-relaxed text-v-muted-2">
          {children ?? (
            <p className="m-0 rounded-v-xl border border-v-line bg-white px-5 py-4">
              We&apos;re writing this page. It will be published here before VoicEra opens to the public.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
