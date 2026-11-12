"use client";

import { ArrowDown, ArrowLeft, BarChart3, BookOpen, Brain, Ear, Globe, Phone, PhoneOutgoing, Plug, User, Volume2, type LucideIcon } from "lucide-react";
import { MODULE_BY_ID, RATES, modelCategory, type Canvas, type CanvasCost } from "@/lib/adopt/advisor/canvas";
import { inr } from "@/lib/adopt/advisor/cost";

type Tone = "plain" | "ok" | "warn" | "danger";

const BADGE: Record<Tone, string> = {
  plain: "bg-v-surface-sunk text-v-body",
  ok: "bg-v-pale text-v-accent-deep",
  warn: "bg-v-warn-tint text-v-warn-ink",
  danger: "bg-v-danger-pale text-v-danger-deep",
};

function Badge({ tone = "plain", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`inline-block rounded-v-md px-2 py-1 text-[12px] font-semibold leading-snug ${BADGE[tone]}`}>{children}</span>;
}

function Node({ icon: Icon, title, sub, badge, dashed }: { icon: LucideIcon; title: string; sub?: string; badge?: React.ReactNode; dashed?: boolean }) {
  return (
    <div className={`flex items-start gap-3 rounded-v-xl border bg-white px-4 py-3 ${dashed ? "border-dashed border-v-line-strong" : "border-v-line"}`}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-v-md bg-v-surface-sunk text-v-fg"><Icon className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium leading-snug">{title}</p>
        {sub ? <p className="text-[12.5px] leading-snug text-v-muted">{sub}</p> : null}
        {badge ? <div className="mt-1.5">{badge}</div> : null}
      </div>
    </div>
  );
}

const Down = () => <div className="flex justify-center text-v-line-strong" aria-hidden><ArrowDown className="size-4" /></div>;

/**
 * How a call flows, and which charge pays for which part.
 * With a canvas it shows that person's own build and amounts. Without one it shows the general picture and the rates.
 * The per-minute rate is end to end, so it is drawn around the whole "VoicERA runs the call" box,
 * not split between listening, thinking and speaking: the package document gives no such split.
 */
export function FlowDiagram({ c, cost }: { c?: Canvas; cost?: CanvasCost }) {
  const on = (id: string) => (c ? c.modules.includes(id) : false);
  const cat = c ? modelCategory(c) : "open";
  const usage = cost?.core.usageTotal ?? null;
  const minuteTone: Tone = cat === "open" ? "ok" : "warn";
  const minuteText = !c
    ? `${`₹${RATES.perMinuteOpen.toFixed(2)}`} a minute with open-source models`
    : cat === "open"
      ? `₹${RATES.perMinuteOpen.toFixed(2)} a minute${usage !== null ? ` · ${inr(usage)} planned` : ""}`
      : cat === "proprietary" ? "Price not supplied" : "Choose models to price this";
  const modelsText = !c ? "Models of your choice" : cat === "open" ? "Open-source models" : cat === "proprietary" ? "Proprietary models" : "Models not chosen yet";

  const reach: { icon: LucideIcon; title: string; sub: string; badge?: React.ReactNode }[] = [];
  if (!c) {
    reach.push({ icon: Phone, title: "A phone number or a browser link", sub: "Citizens ring it or talk from a web page", badge: <Badge>₹{RATES.perNumber} per phone number</Badge> });
  } else {
    if (on("ch-in")) reach.push({ icon: Phone, title: "A phone number", sub: "Citizens dial it", badge: <Badge>{c.numbers} × ₹{RATES.perNumber} = {inr(c.numbers * RATES.perNumber)}</Badge> });
    if (on("ch-out")) reach.push({ icon: PhoneOutgoing, title: "Your phone list", sub: "VoicERA calls the citizens on it", badge: <Badge>You supply the list</Badge> });
    if (on("ch-web")) reach.push({ icon: Globe, title: "A browser link", sub: "Talk from a web page", badge: <Badge>No separate charge documented</Badge> });
    if (on("ch-own")) reach.push({ icon: Phone, title: "Your own telephony provider", sub: "Documented as 2 to 4 weeks, case by case", badge: <Badge tone="warn">Price not supplied</Badge> });
    if (reach.length === 0) reach.push({ icon: Phone, title: "No way in yet", sub: "Add a phone number, a phone list or a browser link", badge: <Badge tone="warn">Nothing to reach it by</Badge> });
  }

  const systems = c ? c.modules.filter((id) => MODULE_BY_ID[id]?.lane === "connect") : [];
  const showSystems = !c || systems.length > 0;
  const files = c ? (on("kn-files") ? `${c.kb.count} text file${c.kb.count === 1 ? "" : "s"}` : null) : "Up to 10 text files";

  return (
    <div role="group" aria-label="How a call flows and what you pay for" className="flex flex-col gap-2">
      <div className="rounded-v-xl border border-v-line bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13.5px] font-medium">Setup of your agent and campaign</span>
          <Badge tone="plain">₹{PLATINUM_SETUP} once</Badge>
        </div>
      </div>

      <Node icon={User} title="The citizen" sub="Speaks in their own language" />
      <Down />
      <div className="flex flex-col gap-2">
        {reach.map((r) => <Node key={r.title} icon={r.icon} title={r.title} sub={r.sub} badge={r.badge} />)}
      </div>
      <Down />

      <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_auto_190px]">
        <div className="rounded-v-xl bg-v-fg px-4 py-4 text-white">
          <p className="font-mono text-[10px] uppercase tracking-[.14em] text-white/70">VoicERA runs the call</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {[{ i: Ear, t: "Listens", s: "Understands the citizen" }, { i: Brain, t: "Thinks", s: "Decides, using your content" }, { i: Volume2, t: "Speaks", s: "Answers in their language" }].map((x) => (
              <li key={x.t} className="flex items-start gap-2.5 rounded-v-lg bg-white/10 px-3 py-2.5">
                <x.i className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span><span className="block text-[14px] font-medium leading-snug">{x.t}</span><span className="block text-[12px] leading-snug text-white/75">{x.s}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-white/75">{modelsText}{c ? ` · ${c.languages.length} language${c.languages.length === 1 ? "" : "s"}` : ""}</p>
          <div className="mt-3">
            <span className={`inline-block rounded-v-md px-2 py-1 text-[12px] font-semibold leading-snug ${minuteTone === "ok" ? "bg-white text-v-accent-deep" : "bg-v-warn-tint text-v-warn-ink"}`}>{minuteText}</span>
            <p className="mt-1.5 text-[12px] leading-snug text-white/75">{cat === "open" || !c ? "This covers listening, thinking, speaking and the phone line." : "Open-source models are the only per-minute price in the package document."}</p>
          </div>
        </div>
        <div className="hidden justify-center text-v-line-strong md:flex" aria-hidden><ArrowLeft className="size-4" /></div>
        <div className="flex flex-col gap-2">
          {files !== null ? <Node icon={BookOpen} title="Your approved content" sub={files} badge={<Badge>You supply it</Badge>} /> : <Node icon={BookOpen} title="Your approved content" sub="No knowledge files yet" dashed />}
          {showSystems ? <Node icon={Plug} dashed title="Your department systems" sub="Not in the package" badge={<Badge tone="danger">{c ? "Needs a quote" : "Separate assessment"}</Badge>} /> : null}
        </div>
      </div>

      <Down />
      <Node icon={BarChart3} title="Dashboard and analysis" sub="Calls attempted, connected, dropped and completed, and an analysis after each campaign" badge={<Badge>No separate charge documented</Badge>} />
    </div>
  );
}

const PLATINUM_SETUP = RATES.setup.toLocaleString("en-IN");
