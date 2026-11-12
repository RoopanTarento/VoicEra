import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container, PageIntro, Section } from "@/components/adopt/ui";

export const metadata: Metadata = { title: "All screens" };

const GROUPS: { title: string; note: string; links: { href: string; label: string; desc: string }[] }[] = [
  {
    title: "Start here",
    note: "If you only open one thing, open the Composer. There is nothing to answer.",
    links: [
      { href: "/compose", label: "VoicERA Composer", desc: "Build the call from blocks, by drag and drop or a click. The package rules judge what you build as you build it, and say what to remove." },
      { href: "/studio", label: "VoicERA Studio", desc: "The same idea as a conversation: describe the service, and it asks only what could change the answer." },
      { href: "/adopt/advisor/poc", label: "Scheme Discovery proof of concept", desc: "Guided walkthrough. Load a worked example to see it all in a minute." },
      { href: "/adopt/advisor", label: "Package advisor", desc: "Describe your need, answer only what matters, get a recommendation." },
    ],
  },
  {
    title: "Package advisor",
    note: "Checks your needs against the VoicEra Fully Loaded (Platinum) package.",
    links: [
      { href: "/adopt/advisor/questions", label: "Advisor questions", desc: "The adaptive wizard." },
      { href: "/adopt/advisor/result", label: "Advisor recommendation", desc: "Mapping, checklist, risks, plan, cost, reasoning, exports." },
      { href: "/adopt/advisor/faq", label: "FAQ and data governance", desc: "What the package document answers, and what it does not." },
    ],
  },
  {
    title: "Discover and choose",
    note: "The original experience.",
    links: [
      { href: "/adopt", label: "Discover", desc: "Landing page." },
      { href: "/adopt/sectors", label: "Sectors", desc: "Segments from the ICP." },
      { href: "/adopt/applications", label: "Applications", desc: "The five ready-made applications." },
      { href: "/adopt/packages", label: "Packages", desc: "Deploy, Connect and Orchestrate compared." },
      { href: "/adopt/select", label: "Find your fit", desc: "Guided selection and recommendation." },
    ],
  },
  {
    title: "Try it",
    note: "See how a conversation would go.",
    links: [
      { href: "/adopt/citizen", label: "Citizen view", desc: "Play each application as the person on the phone." },
      { href: "/adopt/workspace", label: "Workspace", desc: "Configure, test, check readiness, rehearse, monitor." },
    ],
  },
  {
    title: "Reference",
    note: "",
    links: [
      { href: "/adopt/platform", label: "What the platform includes", desc: "What is available today and what is not." },
      { href: "/adopt/help", label: "Help and support", desc: "FAQ and glossary." },
    ],
  },
];

export default function AllScreensPage() {
  return (
    <Container>
      <PageIntro eyebrow="All screens" title="Everything in one place">
        <p>Every screen of the adopter experience, grouped by what you want to do. Everything runs in your browser and nothing is sent anywhere.</p>
      </PageIntro>
      {GROUPS.map((g) => (
        <Section key={g.title} id={g.title.toLowerCase().replace(/\W+/g, "-")} title={g.title} intro={g.note || undefined} className="border-b border-v-line last:border-0">
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="group flex h-full flex-col gap-1.5 rounded-v-xl border border-v-line bg-v-panel p-4 shadow-[var(--v-shadow-card)] transition-colors hover:border-v-accent">
                  <span className="flex items-center justify-between gap-2 text-[15px] font-semibold">
                    {l.label}
                    <ArrowRight className="size-4 shrink-0 text-v-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="text-[13px] leading-relaxed text-v-body">{l.desc}</span>
                  <span className="mt-auto pt-1 font-mono text-[10.5px] text-v-muted">{l.href}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ))}
    </Container>
  );
}
