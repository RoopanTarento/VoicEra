"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowRight, BarChart3, BookOpen, Brain, Check, Ear, Info, Minus, Phone, Plug, Plus, RotateCcw, Server, TriangleAlert, User, UserCheck, Volume2, X, type LucideIcon } from "lucide-react";
import {
  DEPTHS, LANGUAGES, LAYER_BY_ID, OPTION_BY_ID, OTHER_LANGUAGE_NOTE, PACKAGE_NAME, TELEPHONY_PARTNERS_SAMPLE, TELEPHONY_TECH, USE_CASE_BY_ID, optionsFor, reasonFor,
  type LayerId, type Option, type UseCaseId,
} from "@/lib/adopt/builder/catalog";
import { classify, notesFor, type Selection } from "@/lib/adopt/builder/canvas";
import { chipFor, costFor, inr, rate } from "@/lib/adopt/builder/pricing";
import { recommend } from "@/lib/adopt/builder/profile";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { NumInput, TIER_TAG, Tag } from "./parts";

const ICON: Record<LayerId | "citizen", LucideIcon> = { citizen: User, channel: Phone, listen: Ear, think: Brain, speak: Volume2, know: BookOpen, act: Plug, handoff: UserCheck, watch: BarChart3, host: Server };

function chosenId(s: Selection, l: LayerId): string {
  return ({ channel: s.channel, listen: s.listen, think: s.think, speak: s.speak, know: s.know, act: s.act, handoff: s.handoff, watch: "w-dash", host: s.host } as Record<LayerId, string>)[l];
}

export function CanvasStage() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const sel = state.sel;
  const [open, setOpen] = useState<LayerId | null>(null);
  const [lens, setLens] = useState<UseCaseId | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!sel) return null;
  const p = state.profile;
  const rec = recommend(p);
  const cls = classify(sel);
  const cost = costFor(sel, pb);
  const useCases = (lens ? [lens, ...p.useCases.filter((u) => u !== lens)] : p.useCases) as UseCaseId[];
  const notes = notesFor(sel, p.useCases).filter((n) => n.tone !== "ok");
  const notesBy = (l: LayerId) => notes.filter((n) => n.layer === l);
  const baseDepth = state.base ?? rec.startAt;

  const node = (l: LayerId) => {
    const o = OPTION_BY_ID[chosenId(sel, l)];
    const chip = o ? chipFor(o, pb) : null;
    return (
      <NodeCard
        key={l}
        layer={l}
        choice={o?.name ?? "Not chosen"}
        sub={l === "channel" ? [sel.inbound ? "Citizens call us" : "", sel.outbound ? "we call citizens" : ""].filter(Boolean).join(" · ") : l === "listen" || l === "speak" ? `${sel.languages.length} language${sel.languages.length === 1 ? "" : "s"}` : l === "watch" ? [sel.managedOps ? "Managed operations" : "", sel.evaluation ? "Testing" : ""].filter(Boolean).join(", ") : o?.maker && o.maker !== o.name ? o.maker : undefined}
        chip={chip}
        notes={notesBy(l)}
        open={open === l}
        onOpen={() => setOpen(open === l ? null : l)}
      />
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--vb-line)] px-5 py-3 md:px-8">
        <div className="min-w-0">
          <p className="vb-eyebrow">Your canvas</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="vb-serif text-[22px] leading-none">{cls.key === "custom" ? "Custom" : PACKAGE_NAME[cls.key]}</span>
            {cls.key === "custom" ? <Tag tone="warn">{cls.label}</Tag> : <Tag tone="ok">Matches the package</Tag>}
          </div>
        </div>

        <div role="group" aria-label="Start from a package" className="flex items-center rounded-full border border-[var(--vb-line-strong)] p-0.5">
          {DEPTHS.map((d) => (
            <button key={d} type="button" aria-pressed={cls.key === d} onClick={() => actions.moveTo(d)} className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${cls.key === d ? "bg-[var(--vb-ink)] text-[var(--vb-on-ink)]" : "text-[var(--vb-body)] hover:text-[var(--vb-ink)]"}`}>{PACKAGE_NAME[d]}</button>
          ))}
        </div>

        {p.useCases.length > 1 ? (
          <label className="flex items-center gap-2 text-[13px]">
            <span className="vb-muted">Reasons for</span>
            <select className="vb-input !h-9 !w-auto !py-0 !text-[13px]" value={lens ?? p.useCases[0]} onChange={(e) => setLens(e.target.value as UseCaseId)} aria-label="Show the reasons for this use case">
              {p.useCases.map((u) => <option key={u} value={u}>{USE_CASE_BY_ID[u].label}</option>)}
            </select>
          </label>
        ) : p.useCases[0] ? <span className="vb-muted text-[13px]">Reasons for <span className="text-[var(--vb-ink)]">{USE_CASE_BY_ID[p.useCases[0]].label.toLowerCase()}</span></span> : null}

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setOpen("listen")} className="vb-tag cursor-pointer hover:brightness-125">{sel.languages.slice(0, 3).join(", ")}{sel.languages.length > 3 ? ` +${sel.languages.length - 3}` : ""}</button>
          <button type="button" onClick={actions.resetCanvas} className="vb-btn vb-btn-ghost vb-btn-sm"><RotateCcw className="size-3.5" aria-hidden /> Reset to {PACKAGE_NAME[baseDepth]}</button>
        </div>
      </div>

      {/* the pipeline */}
      <div className="vb-scroll vb-dots min-h-0 flex-1 overflow-y-auto px-5 py-8 md:px-8">
        <div className="mx-auto max-w-[1180px]">
          <p className="vb-muted mb-5 max-w-[64ch] text-[14px] leading-relaxed">This is the path of a call. Tap any step to see your options, what each costs, and why you might choose it. You do not need to know the technical terms: each step says what it does in plain words.</p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5 lg:gap-x-6 lg:gap-y-0">
            <Pipe first><NodeCard static layer="citizen" choice="The citizen" sub={`Speaks ${sel.languages.slice(0, 2).join(" or ") || "their language"}`} chip={null} notes={[]} open={false} onOpen={() => undefined} /></Pipe>
            <Pipe>{node("channel")}</Pipe>
            <Pipe>{node("listen")}</Pipe>
            <Pipe>{node("think")}</Pipe>
            <Pipe last>{node("speak")}</Pipe>

            <div className="hidden lg:col-span-3 lg:col-start-3 lg:block" aria-hidden>
              <svg viewBox="0 0 300 48" preserveAspectRatio="none" className="h-12 w-full">
                <g fill="none" strokeWidth="1.5" className="vb-flow" style={{ vectorEffect: "non-scaling-stroke" }}>
                  <path d="M150 0 V22" vectorEffect="non-scaling-stroke" /><path d="M50 22 H250" vectorEffect="non-scaling-stroke" /><path d="M50 22 V48" vectorEffect="non-scaling-stroke" /><path d="M150 22 V48" vectorEffect="non-scaling-stroke" /><path d="M250 22 V48" vectorEffect="non-scaling-stroke" />
                </g>
              </svg>
            </div>

            <div className="mt-2 lg:col-start-3 lg:mt-0">{node("know")}</div>
            <div className="mt-2 lg:col-start-4 lg:mt-0">{node("act")}</div>
            <div className="mt-2 lg:col-start-5 lg:mt-0">{node("handoff")}</div>
          </div>

          <div className="vb-card mt-8 p-4 md:p-5">
            <p className="vb-eyebrow mb-3">The platform underneath</p>
            <div className="grid gap-3 md:grid-cols-2">
              {node("watch")}
              {node("host")}
            </div>
          </div>
        </div>
      </div>

      {/* bottom bar */}
      <div className="relative shrink-0 border-t border-[var(--vb-line)] bg-[var(--vb-bg-2)]/85 px-5 py-3 backdrop-blur md:px-8">
        <AnimatePresence>
          {notesOpen && notes.length ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="vb-card absolute inset-x-5 bottom-full z-20 mb-2 max-h-[50dvh] overflow-y-auto p-4 md:inset-x-8 md:left-auto md:w-[460px]">
              <p className="vb-eyebrow mb-3">Worth a look</p>
              <ul className="flex flex-col gap-3">
                {notes.map((n, i) => (
                  <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                    {n.tone === "warn" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--vb-amber)]" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-[var(--vb-accent)]" aria-hidden />}
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-live="polite">
            <div>
              <p className="vb-serif text-[26px] leading-none tabular-nums">{inr(cost.knownTotal)}</p>
              <p className="vb-muted mt-1 text-[12px]">{cost.unresolved.length ? `known so far · ${cost.unresolved.length} not priced` : "known total"}</p>
            </div>
            {cost.budget.state !== "none" ? <Tag tone={cost.budget.state === "short" ? "bad" : cost.budget.state === "fits" ? "ok" : "warn"}>{cost.budget.state === "short" ? "Over budget" : cost.budget.state === "fits" ? "Within budget" : "Within budget so far"}</Tag> : null}
            {notes.length ? <button type="button" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen} className="vb-tag warn cursor-pointer hover:brightness-125">{notes.length} thing{notes.length === 1 ? "" : "s"} to look at</button> : null}
          </div>
          <button type="button" className="vb-btn vb-btn-primary" onClick={() => actions.goto("cost")}>See the cost <ArrowRight className="size-4" aria-hidden /></button>
        </div>
      </div>

      <AnimatePresence>
        {open ? <LayerDrawer key={open} layer={open} sel={sel} useCases={useCases} onClose={() => setOpen(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ nodes */

/** A cell of the first row, with an animated arrow into the next. */
function Pipe({ children, first, last }: { children: React.ReactNode; first?: boolean; last?: boolean }) {
  return (
    <div className="relative">
      {children}
      {!last ? (
        <>
          <span aria-hidden className="pointer-events-none absolute -right-6 top-1/2 hidden w-6 -translate-y-1/2 lg:block">
            <svg viewBox="0 0 24 12" className="w-full"><path d="M0 6 H20" fill="none" strokeWidth="1.5" className="vb-flow" /><path d="M17 2 L22 6 L17 10" fill="none" stroke="var(--vb-accent)" strokeWidth="1.5" /></svg>
          </span>
          <span aria-hidden className="mt-2 flex justify-center text-[var(--vb-line-strong)] lg:hidden"><ArrowDown className="size-4" /></span>
        </>
      ) : null}
      {first ? null : null}
    </div>
  );
}

function NodeCard({ layer, choice, sub, chip, notes, open, onOpen, static: isStatic }: { layer: LayerId | "citizen"; choice: string; sub?: string; chip: { text: string; tone: "ok" | "info" | "warn" } | null; notes: { tone: string }[]; open: boolean; onOpen: () => void; static?: boolean }) {
  const Icon = ICON[layer];
  const meta = layer === "citizen" ? { name: "Start", tech: "A call begins" } : { name: LAYER_BY_ID[layer].name, tech: LAYER_BY_ID[layer].tech };
  const warn = notes.some((n) => n.tone === "warn");
  return (
    <button type="button" onClick={onOpen} aria-expanded={isStatic ? undefined : open} disabled={isStatic} className={`vb-node ${isStatic ? "vb-node-static" : ""}`} aria-label={isStatic ? undefined : `${meta.name}. ${choice}. Open the options.`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--vb-surface-3)]"><Icon className="size-[18px]" aria-hidden /></span>
        {notes.length ? <span className={`mt-1 size-2 rounded-full ${warn ? "bg-[var(--vb-amber)]" : "bg-[var(--vb-accent)]"}`} aria-hidden /> : null}
      </div>
      <p className="mt-3 text-[15px] font-semibold leading-tight">{meta.name}</p>
      <p className="vb-mono vb-muted mt-0.5 text-[9.5px] uppercase tracking-[0.12em]">{meta.tech}</p>
      <p className="mt-2.5 text-[14px] leading-snug">{choice}</p>
      {sub ? <p className="vb-muted mt-0.5 text-[12.5px] leading-snug">{sub}</p> : null}
      {chip ? <span className={`vb-tag mt-3 ${chip.tone === "ok" ? "ok" : chip.tone === "warn" ? "warn" : "info"}`}>{chip.text}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ the drawer */

function LayerDrawer({ layer, sel, useCases, onClose }: { layer: LayerId; sel: Selection; useCases: UseCaseId[]; onClose: () => void }) {
  const { actions } = useBuilder();
  const { pb } = usePrices();
  const L = LAYER_BY_ID[layer];
  const Icon = ICON[layer];
  const current = chosenId(sel, layer);
  const opts = optionsFor(layer);

  return (
    <>
      <motion.button type="button" aria-label="Close" className="vb-scrim absolute inset-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside role="dialog" aria-modal="true" aria-label={L.name} className="vb-drawer vb-scroll absolute inset-y-0 right-0 z-40 flex w-full max-w-[480px] flex-col overflow-y-auto" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.2 }}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--vb-line)] bg-[var(--vb-bg-2)] px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--vb-surface-3)]"><Icon className="size-5" aria-hidden /></span>
            <div>
              <h2 className="vb-serif text-[24px] leading-tight">{L.name}</h2>
              <p className="vb-mono vb-muted mt-0.5 text-[10px] uppercase tracking-[0.12em]">{L.tech}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="vb-btn vb-btn-ghost vb-btn-sm !h-9 !w-9 !px-0" aria-label="Close"><X className="size-4" aria-hidden /></button>
        </div>

        <div className="flex flex-col gap-6 px-6 py-6">
          <div>
            <p className="text-[15px] leading-relaxed">{L.does}</p>
            <p className="vb-muted mt-2 text-[13.5px] leading-relaxed">{L.whyItMatters}</p>
          </div>

          {layer === "channel" ? <ChannelControls sel={sel} /> : null}
          {layer === "listen" || layer === "speak" ? <Languages sel={sel} /> : null}
          {layer === "watch" ? <WatchControls sel={sel} /> : null}

          {layer !== "watch" ? (
            <div role="radiogroup" aria-label={`${L.name} options`} className="flex flex-col gap-3">
              {opts.map((o) => (
                <OptionCard key={o.id} o={o} selected={current === o.id} useCases={useCases} sel={sel} onPick={() => actions.setLayer(layer, o.id)} />
              ))}
            </div>
          ) : null}

          {layer === "think" || layer === "listen" || layer === "speak" ? (
            <p className="vb-muted text-[12.5px] leading-relaxed">The standard usage price is {rate(pb.usageRate, pb.usageUnit)}. It covers the platform, the phone line and open-source models. A commercial or unclassified model is priced on top of it once a price is set.</p>
          ) : null}
        </div>
      </motion.aside>
    </>
  );
}

function OptionCard({ o, selected, useCases, sel, onPick }: { o: Option; selected: boolean; useCases: UseCaseId[]; sel: Selection; onPick: () => void }) {
  const { actions } = useBuilder();
  const { pb } = usePrices();
  const tier = TIER_TAG[o.tier];
  const chip = chipFor(o, pb);
  const why = reasonFor(o, useCases);
  const own = o.tier === "own" && selected;
  const layer = o.layer;
  return (
    <div className={`rounded-2xl border transition-colors ${selected ? "border-[var(--vb-accent)] bg-[var(--vb-accent-soft)]" : "border-[var(--vb-line)] bg-[var(--vb-surface-2)] hover:border-[var(--vb-line-strong)]"}`}>
      <button type="button" role="radio" aria-checked={selected} onClick={onPick} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="vb-mark" aria-hidden style={selected ? { background: "var(--vb-accent)", borderColor: "var(--vb-accent)" } : undefined}>{selected ? <Check className="size-3.5" strokeWidth={3} /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold leading-snug">{o.name}</span>
            <Tag tone={tier.tone}>{tier.label}</Tag>
          </span>
          {o.maker ? <span className="vb-muted block text-[12.5px]">{o.maker}</span> : null}
          <span className="vb-body mt-1 block text-[13.5px] leading-snug">{o.plain}</span>
          <span className={`vb-tag mt-2.5 ${chip.tone === "ok" ? "ok" : chip.tone === "warn" ? "warn" : "info"}`}>{chip.text}</span>
        </span>
      </button>

      {selected ? (
        <div className="flex flex-col gap-3 border-t border-[var(--vb-line)] px-4 pb-4 pt-3.5">
          <div>
            <p className="vb-eyebrow">{why.specific ? `Why this, for ${USE_CASE_BY_ID[useCases[0]].label.toLowerCase()}` : "Why choose this"}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed">{why.text}</p>
          </div>
          <div>
            <p className="vb-eyebrow">Check before you rely on it</p>
            <p className="vb-body mt-1.5 text-[13.5px] leading-relaxed">{o.check}</p>
          </div>
          {own ? (
            <div className="rounded-xl bg-[var(--vb-surface)] p-3.5">
              <NumInput label={`Your provider's cost per ${pb.usageUnit}`} prefix="₹" step={0.01} value={sel.ownFigures[layer] ?? null} onChange={(v) => actions.setOwnFigure(layer, v)} hint="Yours to enter. It appears in your total, labelled as your figure. VoicERA's fee for connecting it is not defined yet." />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ChannelControls({ sel }: { sel: Selection }) {
  const { actions } = useBuilder();
  const { pb } = usePrices();
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Who starts the call" className="grid gap-2.5 sm:grid-cols-2">
        <button type="button" aria-pressed={sel.inbound} onClick={() => actions.patchSel({ inbound: !sel.inbound, numbers: !sel.inbound && sel.channel !== "ch-browser" ? Math.max(1, sel.numbers) : sel.inbound ? 0 : sel.numbers })} className="vb-choice"><span className="vb-mark sq" aria-hidden>{sel.inbound ? <Check className="size-3.5" strokeWidth={3} /> : null}</span><span><span className="block text-[14.5px] font-medium">Citizens call us</span><span className="vb-muted block text-[12.5px]">An inbound line</span></span></button>
        <button type="button" aria-pressed={sel.outbound} onClick={() => actions.patchSel({ outbound: !sel.outbound })} className="vb-choice"><span className="vb-mark sq" aria-hidden>{sel.outbound ? <Check className="size-3.5" strokeWidth={3} /> : null}</span><span><span className="block text-[14.5px] font-medium">We call citizens</span><span className="vb-muted block text-[12.5px]">Campaigns and reminders</span></span></button>
      </div>
      {sel.channel !== "ch-browser" ? (
        <div className="vb-card-2 flex items-center justify-between gap-3 p-4">
          <div><p className="text-[14px] font-medium">Phone numbers</p><p className="vb-muted text-[12.5px]">{pb.perNumber === null ? "Price not set" : `${inr(pb.perNumber)} each, once`}</p></div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="One fewer number" disabled={sel.numbers <= 0} onClick={() => actions.patchSel({ numbers: Math.max(0, sel.numbers - 1) })} className="vb-btn vb-btn-ghost vb-btn-sm !h-9 !w-9 !px-0"><Minus className="size-4" aria-hidden /></button>
            <span className="w-8 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">{sel.numbers}</span>
            <button type="button" aria-label="One more number" disabled={sel.numbers >= 100} onClick={() => actions.patchSel({ numbers: Math.min(100, sel.numbers + 1) })} className="vb-btn vb-btn-ghost vb-btn-sm !h-9 !w-9 !px-0"><Plus className="size-4" aria-hidden /></button>
          </div>
        </div>
      ) : null}
      <p className="vb-muted text-[12.5px] leading-relaxed">Telephony partners named in the documents, as samples: {TELEPHONY_PARTNERS_SAMPLE.join(", ")}. Technologies: {TELEPHONY_TECH.join(", ")}.</p>
    </div>
  );
}

function Languages({ sel }: { sel: Selection }) {
  const { actions } = useBuilder();
  return (
    <div>
      <p className="text-[13.5px] font-semibold">Languages <span className="vb-muted font-normal">· shared by listening and speaking</span></p>
      <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Languages">
        {LANGUAGES.map((l) => {
          const on = sel.languages.includes(l);
          return <button key={l} type="button" aria-pressed={on} onClick={() => actions.toggleLanguage(l)} className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors ${on ? "border-[var(--vb-accent)] bg-[var(--vb-accent-soft)] text-[var(--vb-ink)]" : "border-[var(--vb-line-strong)] text-[var(--vb-body)] hover:text-[var(--vb-ink)]"}`}>{l}</button>;
        })}
      </div>
      <p className="vb-muted mt-2 text-[12.5px] leading-relaxed">All eleven are documented. {OTHER_LANGUAGE_NOTE} A caller can switch language mid-call.</p>
    </div>
  );
}

function WatchControls({ sel }: { sel: Selection }) {
  const { actions } = useBuilder();
  const { pb } = usePrices();
  return (
    <div className="flex flex-col gap-3">
      <div className="vb-card-2 flex items-start gap-3 p-4"><span className="vb-mark" style={{ background: "var(--vb-accent)", borderColor: "var(--vb-accent)" }} aria-hidden><Check className="size-3.5" strokeWidth={3} /></span><div><p className="text-[15px] font-semibold">Dashboard and analysis</p><p className="vb-body mt-1 text-[13.5px] leading-relaxed">Calls attempted, connected, dropped and completed, average call length, and an analysis after a campaign. Survey answers download as a table.</p><span className="vb-tag ok mt-2">Included</span></div></div>
      <button type="button" aria-pressed={sel.managedOps} onClick={() => actions.patchSel({ managedOps: !sel.managedOps })} className="vb-choice"><span className="vb-mark sq" aria-hidden>{sel.managedOps ? <Check className="size-3.5" strokeWidth={3} /> : null}</span><span><span className="block text-[14.5px] font-medium">Managed operations</span><span className="vb-body block text-[13px]">Monitoring, optimisation, campaign operations and support, as an annual service.</span><span className="vb-tag warn mt-2">{pb.managedOpsAnnual === null ? "Price not set" : `${inr(pb.managedOpsAnnual)} a year`}</span></span></button>
      <button type="button" aria-pressed={sel.evaluation} onClick={() => actions.patchSel({ evaluation: !sel.evaluation })} className="vb-choice"><span className="vb-mark sq" aria-hidden>{sel.evaluation ? <Check className="size-3.5" strokeWidth={3} /> : null}</span><span><span className="block text-[14.5px] font-medium">Conversation and language testing</span><span className="vb-body block text-[13px]">Structured testing of the agent in your languages before launch, as the ICP describes.</span><span className="vb-tag warn mt-2">{pb.evaluationOneTime === null ? "Price not set" : inr(pb.evaluationOneTime)}</span></span></button>
    </div>
  );
}
