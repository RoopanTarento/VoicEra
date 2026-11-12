import Link from "next/link";
import { ArrowRight, Headphones, LayoutGrid, ListChecks } from "lucide-react";
import { Container, Eyebrow } from "@/components/adopt/ui";
import { POSITIONING } from "@/lib/adopt/icp";

/** The home page: one sentence, three clear choices, and a quiet row of links for everything else. */
const CHOICES = [
  {
    href: "/canvas",
    icon: LayoutGrid,
    title: "Build a package around my budget",
    body: "Pick what you want to build, set your budget, and see the cost as you go.",
    primary: true,
  },
  {
    href: "/adopt/advisor",
    icon: ListChecks,
    title: "Check if a package fits",
    body: "Answer a few questions and get a plain yes, no or not yet.",
  },
  {
    href: "/adopt/citizen",
    icon: Headphones,
    title: "Hear a sample call",
    body: "See what a citizen would experience on a phone.",
  },
];

const MORE = [
  { href: "/adopt/sectors", label: "Sectors" },
  { href: "/adopt/applications", label: "Applications" },
  { href: "/adopt/packages", label: "Packages" },
  { href: "/adopt/workspace", label: "Workspace" },
  { href: "/adopt/help", label: "Help" },
  { href: "/adopt/all", label: "All screens" },
];

export default function DiscoverPage() {
  return (
    <Container narrow className="flex flex-col gap-12 py-14 md:py-20">
      <header className="flex flex-col gap-4">
        <Eyebrow>VoicERA for government</Eyebrow>
        <h1 className="text-[36px] font-semibold leading-[1.08] tracking-tight md:text-[52px]">{POSITIONING.headline}</h1>
        <p className="max-w-[52ch] text-[17px] font-light leading-relaxed text-v-body">
          Put a voice service in front of citizens. Choose what you need, hear it work, and see what it costs.
        </p>
      </header>

      <section aria-label="What would you like to do?">
        <h2 className="mb-4 text-[18px] font-semibold tracking-tight">What would you like to do?</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {CHOICES.map((c) => {
            const Icon = c.icon;
            return (
              <li key={c.href}>
                <Link
                  href={c.href}
                  className={`group flex h-full flex-col gap-3 rounded-v-xl border p-5 transition-colors ${
                    c.primary ? "border-v-accent bg-v-pale hover:bg-white" : "border-v-line bg-white hover:border-v-line-strong"
                  }`}
                >
                  <span className={`flex size-9 items-center justify-center rounded-v-md ${c.primary ? "bg-v-accent text-white" : "bg-v-surface-sunk text-v-fg"}`}>
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="text-[17px] font-semibold leading-snug tracking-tight">{c.title}</span>
                  <span className="text-[14px] leading-relaxed text-v-body">{c.body}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[13px] font-semibold text-v-accent">
                    Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="More" className="flex flex-col gap-3 border-t border-v-line pt-8">
        <p className="text-[14px] text-v-body">Or look around.</p>
        <ul className="flex flex-wrap gap-2">
          {MORE.map((m) => (
            <li key={m.href}>
              <Link href={m.href} className="inline-block rounded-v-lg border border-v-line bg-white px-3.5 py-2 text-[13.5px] font-medium text-v-fg hover:border-v-accent hover:text-v-accent">
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-[12.5px] leading-relaxed text-v-muted">
          Everything you enter stays in this browser. Nothing here calls a citizen, connects to your systems or goes live.
        </p>
      </section>
    </Container>
  );
}
