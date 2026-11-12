"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Download, FileText, Package } from "lucide-react";
import { OPTION_BY_ID, PACKAGE_CARDS, PACKAGE_NAME } from "@/lib/adopt/builder/catalog";
import { classify } from "@/lib/adopt/builder/canvas";
import { CHECKS, WHO_LABEL, bringList, stagesFor, type Who } from "@/lib/adopt/builder/deploy";
import { buildPack } from "@/lib/adopt/builder/pack";
import { buildPitch } from "@/lib/adopt/builder/pitch";
import { costFor, inr } from "@/lib/adopt/builder/pricing";
import { recommend } from "@/lib/adopt/builder/profile";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { makeZip } from "@/lib/adopt/advisor/zip";
import { OPEN_ITEMS } from "@/lib/adopt/builder/kb";
import { Fold, Tag, download } from "./parts";

const LANE: Record<Who, { dot: string; tag: "info" | "plain" | "warn" | "ok" }> = {
  you: { dot: "var(--vb-amber)", tag: "warn" },
  voicera: { dot: "var(--vb-accent)", tag: "info" },
  it: { dot: "var(--vb-violet)", tag: "plain" },
  both: { dot: "var(--vb-mint)", tag: "ok" },
};

export function DeployStage() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const sel = state.sel;
  if (!sel) return null;
  const p = state.profile;
  const cls = classify(sel);
  const cost = costFor(sel, pb);
  const rec = recommend(p);
  const stages = stagesFor(sel);
  const bring = bringList(sel, p);
  const inHand = bring.filter((b) => state.bring[b.id] === "yes").length;
  const ticked = CHECKS.filter((c) => state.checks[c.id]).length;
  const pitch = buildPitch(p, pb, sel, cost, rec);
  const youStages = stages.filter((s) => s.who === "you" || s.who === "both").length;
  const files = () => buildPack({ profile: p, sel, pb, cost, rec, pitch });
  const slug = (p.department || "voicera-package").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voicera-package";
  const pack = () => download(`${slug}-handover.zip`, makeZip(files()), "application/zip");

  return (
    <div className="vb-scroll h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-8 md:px-8 md:py-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-10">
          <header>
            <p className="vb-eyebrow">Deploy</p>
            <h1 className="vb-serif mt-3 text-[40px] leading-[1.08] md:text-[56px]">From a decision to a live service.</h1>
            <p className="vb-body mt-4 max-w-[60ch] text-[16px] leading-relaxed">This is the path from here to launch for your {cls.key === "custom" ? "custom" : PACKAGE_NAME[cls.key]} package: who does each step, what it takes, and what you end up with. Nothing here is deployed by this page. The VoicERA team sets it up, hosted on {OPTION_BY_ID[sel.host]?.name.replace("Hosted on ", "") ?? "Bhashini"}.</p>

            <dl className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Fact k="Typical launch" v={PACKAGE_CARDS[cls.needs].launch} />
              <Fact k="Steps" v={String(stages.length)} />
              <Fact k="You take part in" v={`${youStages} of ${stages.length}`} />
              <Fact k="Known cost" v={inr(cost.knownTotal)} />
            </dl>
            <p className="vb-muted mt-3 text-[12.5px] leading-relaxed">Typical ranges, not commitments. Your own approvals, integration access and content review set the real date.{sel.channel === "ch-own" ? " Your own telephony adds 2 to 4 weeks, case by case." : ""}</p>
          </header>

          <section aria-labelledby="glance-h">
            <h2 id="glance-h" className="vb-eyebrow mb-3">At a glance</h2>
            <ol className="flex flex-wrap items-center gap-1.5" aria-label="The steps, coloured by who does them">
              {stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span title={`${s.title}: ${WHO_LABEL[s.who]}`} className="flex size-8 items-center justify-center rounded-lg font-mono text-[12px] font-semibold text-[var(--vb-on-solid)]" style={{ background: LANE[s.who].dot }}>{i + 1}</span>
                  {i < stages.length - 1 ? <span className="h-px w-3 bg-[var(--vb-line-strong)]" aria-hidden /> : null}
                </li>
              ))}
            </ol>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
              {(["you", "voicera", "it", "both"] as Who[]).filter((w) => stages.some((s) => s.who === w)).map((w) => (
                <li key={w} className="flex items-center gap-2"><span className="size-3 rounded-[4px]" style={{ background: LANE[w].dot }} aria-hidden />{WHO_LABEL[w]}</li>
              ))}
            </ul>
          </section>

          <ol className="flex flex-col gap-3" aria-label="The steps">
            {stages.map((s, i) => (
              <motion.li key={s.id} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} className="vb-card relative flex gap-4 overflow-hidden p-5 md:p-6">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: LANE[s.who].dot }} />
                <span className="vb-mono flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--vb-surface-3)] text-[13px]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-[17px] font-semibold leading-snug">{s.title}</h3><Tag tone={LANE[s.who].tag}>{WHO_LABEL[s.who]}</Tag></div>
                  <p className="vb-body mt-1.5 text-[14.5px] leading-relaxed">{s.plain}</p>
                  <dl className="mt-3 grid gap-x-8 gap-y-2 text-[13.5px] sm:grid-cols-2">
                    <div><dt className="vb-eyebrow">Timing</dt><dd className="mt-0.5 leading-snug">{s.timing}{s.documented ? <span className="vb-tag ok ml-2">Documented</span> : null}</dd></div>
                    <div><dt className="vb-eyebrow">You end up with</dt><dd className="mt-0.5 leading-snug">{s.deliverable}</dd></div>
                  </dl>
                </div>
              </motion.li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3 pb-6">
            <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.goto("cost")}><ArrowLeft className="size-4" aria-hidden /> Back to the cost</button>
            <button type="button" className="vb-btn vb-btn-primary" onClick={pack}><Download className="size-4" aria-hidden /> Download the hand-over pack</button>
            <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.goto("pitch")}>Present the full pitch <ArrowRight className="size-4" aria-hidden /></button>
          </div>
        </div>

        {/* the side column */}
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-5rem)] lg:self-start lg:overflow-y-auto lg:pr-1 vb-scroll">
          <section className="vb-sheet p-6" aria-labelledby="pack-h">
            <div className="flex items-center gap-2"><Package className="size-4" aria-hidden /><h2 id="pack-h" className="vb-eyebrow">Hand-over pack</h2></div>
            <p className="vb-serif mt-2 text-[24px] leading-tight">Everything the VoicERA team needs to start.</p>
            <ul className="mt-4 flex flex-col gap-1.5">
              {files().map((f) => <li key={f.name} className="flex items-center justify-between gap-3 rounded-lg bg-[rgba(22,24,29,0.05)] px-3 py-2 text-[13px]"><span className="vb-mono truncate">{f.name}</span><span className="vb-muted shrink-0">{(f.content.length / 1024).toFixed(1)} KB</span></li>)}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="vb-btn vb-btn-accent vb-btn-sm" onClick={pack}><Download className="size-3.5" aria-hidden /> Pack (.zip)</button>
              <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => download("voicera-pitch.md", files()[0].content, "text/markdown")}><FileText className="size-3.5" aria-hidden /> Pitch only</button>
            </div>
            <p className="vb-muted mt-3 text-[12px] leading-relaxed">Generated in your browser. Not an order and not a quote. Model names are placeholders until the actual list is confirmed.</p>
          </section>

          <Fold title="What you bring" summary={`${inHand} of ${bring.length} in hand`} defaultOpen>
            <div className="vb-bar mb-4" role="progressbar" aria-label="Items in hand" aria-valuemin={0} aria-valuemax={bring.length} aria-valuenow={inHand}><i style={{ width: `${bring.length ? (inHand / bring.length) * 100 : 0}%` }} /></div>
            <ul className="flex flex-col gap-4">
              {bring.map((b) => (
                <li key={b.id}>
                  <p className="text-[14px] font-medium leading-snug">{b.label}</p>
                  <p className="vb-muted text-[12.5px] leading-snug">{b.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={b.label}>
                    {(["yes", "no", "unsure"] as const).map((v) => (
                      <button key={v} type="button" aria-pressed={state.bring[b.id] === v} onClick={() => actions.setBring(b.id, v)} className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${state.bring[b.id] === v ? "border-[var(--vb-accent)] bg-[var(--vb-accent-soft)]" : "border-[var(--vb-line-strong)] text-[var(--vb-body)] hover:text-[var(--vb-ink)]"}`}>{v === "yes" ? "In hand" : v === "no" ? "Not yet" : "Not sure"}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Fold>

          <Fold title="Check before launch" summary={`${ticked} of ${CHECKS.length} ticked`}>
            <p className="vb-body mb-3 text-[13.5px] leading-relaxed">Tick each one only after you have seen it on a real test call. These are your own confirmations, kept in this browser.</p>
            <ul className="flex flex-col gap-2">
              {CHECKS.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--vb-line)] px-3.5 py-3 transition-colors has-[:checked]:border-[var(--vb-accent)] has-[:checked]:bg-[var(--vb-accent-soft)]">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[var(--vb-accent-strong)]" checked={!!state.checks[c.id]} onChange={(e) => actions.tick(c.id, e.target.checked)} />
                    <span><span className="block text-[13.5px] font-medium leading-snug">{c.label}</span><span className="vb-muted block text-[12.5px] leading-snug">{c.detail}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </Fold>

          <Fold title="Questions to confirm" summary={`${OPEN_ITEMS.length + p.openQuestions.length} on your list`}>
            <ul className="vb-body flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">
              {OPEN_ITEMS.map((o) => <li key={o}>{o}</li>)}
            </ul>
            {p.openQuestions.length ? (
              <>
                <p className="vb-eyebrow mb-2 mt-4">Your own questions</p>
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">{p.openQuestions.map((o) => <li key={o}>{o}</li>)}</ul>
              </>
            ) : null}
            <p className="vb-muted mt-3 text-[12.5px]">All of these go in the pack, in <span className="vb-mono">06-questions-to-confirm.md</span>.</p>
          </Fold>
        </aside>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return <div className="vb-card-2 p-4"><dt className="vb-eyebrow">{k}</dt><dd className="mt-1.5 text-[18px] font-semibold leading-tight">{v}</dd></div>;
}
