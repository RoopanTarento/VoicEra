"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Minus, Sparkles } from "lucide-react";
import { CAPABILITIES, DEPTHS, PACKAGE_CARDS, PACKAGE_NAME, capabilitiesOfDepth, depthRank, type Depth } from "@/lib/adopt/builder/catalog";
import { costFor, inr, rate } from "@/lib/adopt/builder/pricing";
import { recommend, selectionFor, labelsOfUseCases } from "@/lib/adopt/builder/profile";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { Fold, Tag } from "./parts";

export function Packages() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const p = state.profile;
  const rec = recommend(p);

  if (!p.useCases.length) {
    return (
      <div className="mx-auto flex h-full max-w-[560px] flex-col items-start justify-center gap-5 px-6">
        <p className="vb-eyebrow">Your package</p>
        <h1 className="vb-serif text-[38px] leading-tight">Tell me what you want to solve first.</h1>
        <p className="vb-body text-[16px] leading-relaxed">The package depends on what you want citizens to do, and whether it must connect to your systems. A few quick questions are all it takes.</p>
        <button type="button" className="vb-btn vb-btn-primary" onClick={() => actions.goto("discover")}><ArrowLeft className="size-4" aria-hidden /> Back to the questions</button>
      </div>
    );
  }

  const price = (d: Depth) => {
    const c = costFor(selectionFor(p, d), pb);
    return { known: c.knownTotal, quoted: c.unresolved.some((u) => u.id === "setup") };
  };

  return (
    <div className="vb-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-12 px-5 py-10 md:px-8 md:py-14">
        {/* the recommendation */}
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="rec-h" className="vb-card relative overflow-hidden p-7 md:p-10">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[var(--vb-accent-strong)] opacity-[0.12] blur-3xl" />
          <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="vb-eyebrow">For {labelsOfUseCases(p).join(", ").toLowerCase()}</p>
                <Tag tone={rec.confidence === "clear" ? "ok" : "warn"}>{rec.confidence === "clear" ? "Clear fit" : rec.confidence === "leaning" ? "Leaning, a few things open" : "Early, tell me more"}</Tag>
              </div>
              <p className="mt-5 text-[15px] vb-body">We recommend</p>
              <h1 id="rec-h" className="vb-serif mt-1 text-[56px] leading-none md:text-[72px]">{PACKAGE_NAME[rec.want]}</h1>
              <p className="vb-body mt-4 max-w-[46ch] text-[17px] leading-relaxed">{PACKAGE_CARDS[rec.want].tagline}</p>

              <ul className="mt-6 flex flex-col gap-3">
                {rec.reasons.slice(0, 4).map((r, i) => (
                  <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--vb-accent)]" aria-hidden />
                    <span>{r.text}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" className="vb-btn vb-btn-primary" onClick={() => actions.choosePackage(rec.startAt)}>
                  {rec.startAt === rec.want ? `Build ${PACKAGE_NAME[rec.want]} on the canvas` : `Start with ${PACKAGE_NAME[rec.startAt]}`} <ArrowRight className="size-4" aria-hidden />
                </button>
                {rec.startAt !== rec.want ? <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.choosePackage(rec.want)}>Go straight to {PACKAGE_NAME[rec.want]}</button> : null}
              </div>
            </div>

            <Path rec={rec} />
          </div>
        </motion.section>

        {rec.cautions.length || rec.unknowns.length ? (
          <Fold title="Things to know before you decide" summary={`${rec.cautions.length + rec.unknowns.length} point${rec.cautions.length + rec.unknowns.length === 1 ? "" : "s"}, each from your answers or the documents`}>
            <ul className="flex flex-col gap-3">
              {rec.cautions.map((c) => (
                <li key={c.rule} className="flex gap-3 text-[14.5px] leading-relaxed"><Tag tone={c.tone === "warn" ? "warn" : "info"}>{c.tone === "warn" ? "Check" : "Note"}</Tag><span>{c.text}</span></li>
              ))}
              {rec.unknowns.map((u) => (
                <li key={u} className="flex gap-3 text-[14.5px] leading-relaxed"><Tag>Open</Tag><span>{u}. Answering it would sharpen this recommendation.</span></li>
              ))}
            </ul>
          </Fold>
        ) : null}

        {/* all packages */}
        <section aria-labelledby="all-h" className="flex flex-col gap-5">
          <div>
            <p className="vb-eyebrow">The three packages</p>
            <h2 id="all-h" className="vb-serif mt-2 text-[32px] leading-tight">One platform, three depths of connection.</h2>
            <p className="vb-body mt-2 max-w-[60ch] text-[15px] leading-relaxed">They differ only in how far VoicERA connects into your own systems. Whatever you start with, you can move up later without starting again.</p>
          </div>
          <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {DEPTHS.map((d) => {
              const c = PACKAGE_CARDS[d];
              const pr = price(d);
              const fit = d === rec.want ? "Best fit" : d === rec.startAt ? "Where to start" : null;
              return (
                <li key={d} className={`vb-card flex flex-col gap-4 p-6 ${fit ? "!border-[var(--vb-accent)]" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="vb-serif text-[28px] leading-none">{c.name}</h3>
                    {fit ? <Tag tone="info">{fit}</Tag> : null}
                  </div>
                  <p className="vb-body text-[14px] leading-relaxed">{c.tagline}</p>
                  <dl className="flex flex-col gap-2.5 border-t vb-hair pt-4 text-[13.5px]">
                    <Row k="Best for" v={c.bestFor} />
                    <Row k="Connects to your systems" v={c.integration} />
                    <Row k="Typical launch" v={c.launch} />
                    <Row k="One-time" v={pr.quoted ? "Implementation quoted by VoicERA" : `${inr(pb.setup[d])} setup`} />
                  </dl>
                  <ul className="flex flex-col gap-1.5 text-[13.5px]">
                    {PACKAGE_CARDS[d].gains.slice(0, 3).map((g) => <li key={g} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-[var(--vb-accent)]" aria-hidden /><span className="vb-body">{g}</span></li>)}
                  </ul>
                  <button type="button" className="vb-btn vb-btn-ghost mt-auto" onClick={() => actions.choosePackage(d)}>Choose {c.name}</button>
                </li>
              );
            })}
            <li className="vb-card flex flex-col gap-4 !border-dashed p-6">
              <h3 className="vb-serif text-[28px] leading-none">Custom</h3>
              <p className="vb-body text-[14px] leading-relaxed">Start from any package and change any layer: a different model, your own telephony, a live handover, live data from your portal.</p>
              <p className="vb-muted text-[13.5px] leading-relaxed">On the canvas the label updates as you go, for example &ldquo;Connect plus 2 from Orchestrate&rdquo;. The documents give no price for the Connect and Orchestrate parts, so a custom package is quoted by VoicERA.</p>
              <button type="button" className="vb-btn vb-btn-ghost mt-auto" onClick={() => actions.choosePackage(null)}><Sparkles className="size-4" aria-hidden /> Build a custom package</button>
            </li>
          </ul>
        </section>

        <Fold title="Compare what each package includes" summary="Read across for one capability, down for one package">
          <div className="vb-scroll overflow-x-auto">
            <table className="vb-table min-w-[520px]">
              <thead><tr><th>Capability</th>{DEPTHS.map((d) => <th key={d} className="text-center">{PACKAGE_NAME[d]}</th>)}</tr></thead>
              <tbody>
                {CAPABILITIES.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    {DEPTHS.map((d) => (
                      <td key={d} className="text-center">{capabilitiesOfDepth(d).includes(c.id) ? <Check className="mx-auto size-4 text-[var(--vb-accent)]" aria-label="Included" /> : <Minus className="vb-muted mx-auto size-4" aria-label="Not included" />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="vb-muted mt-3 text-[12.5px]">From the ICP&apos;s own description of each package. Timings are typical ranges, not commitments. Usage is {rate(pb.usageRate, pb.usageUnit)} at every depth.</p>
        </Fold>

        <div className="flex flex-wrap items-center gap-3 pb-6">
          <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.goto("discover")}><ArrowLeft className="size-4" aria-hidden /> Back to the conversation</button>
          <span className="vb-muted text-[13px]">You can change any answer, or ask more questions, at any time.</span>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="vb-eyebrow">{k}</dt>
      <dd className="mt-0.5 leading-snug">{v}</dd>
    </div>
  );
}

/** The ladder from where to start to where to end up. */
function Path({ rec }: { rec: ReturnType<typeof recommend> }) {
  return (
    <div aria-label="Your path" className="flex flex-col justify-center">
      <p className="vb-eyebrow">{rec.startAt === rec.want ? "Where you land" : "Your path"}</p>
      <ol className="mt-4 flex flex-col">
        {DEPTHS.map((d, i) => {
          const inPath = rec.path.includes(d);
          const isStart = d === rec.startAt;
          const isWant = d === rec.want;
          const dim = depthRank(d) > depthRank(rec.want) && !inPath;
          return (
            <li key={d} className="relative flex gap-4 pb-6 last:pb-0">
              {i < DEPTHS.length - 1 ? <span aria-hidden className={`absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px ${inPath && depthRank(d) < depthRank(rec.want) ? "bg-[var(--vb-accent)]" : "bg-[var(--vb-line-strong)]"}`} /> : null}
              <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-[12px] ${isWant ? "border-[var(--vb-accent)] bg-[var(--vb-accent-strong)] text-white vb-pulse" : inPath ? "border-[var(--vb-accent)] text-[var(--vb-accent)]" : "border-[var(--vb-line-strong)] text-[var(--vb-muted)]"}`}>{i + 1}</span>
              <div className={dim ? "opacity-40" : ""}>
                <p className="text-[16px] font-semibold leading-tight">{PACKAGE_NAME[d]}</p>
                <p className="vb-muted text-[13px]">{PACKAGE_CARDS[d].launch} · {PACKAGE_CARDS[d].integration.toLowerCase()}</p>
                {isStart && rec.startAt !== rec.want ? <span className="vb-tag info mt-1.5">Start here</span> : null}
                {isWant ? <span className="vb-tag ok mt-1.5">{rec.startAt === rec.want ? "Your package" : "Where you grow to"}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {rec.startAt !== rec.want ? <p className="vb-body mt-5 text-[13.5px] leading-relaxed">The same platform at every step, so your content, languages and telephony carry over. Only the connection into your systems grows.</p> : null}
    </div>
  );
}
