"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Download, Expand, FileText, LayoutList, MessageSquareText, Presentation, Printer, Shrink } from "lucide-react";
import { PACKAGE_NAME, type Depth } from "@/lib/adopt/builder/catalog";
import { buildDeck, deckToMarkdown, type Block, type Slide } from "@/lib/adopt/builder/deck";
import { buildPack } from "@/lib/adopt/builder/pack";
import { buildPitch } from "@/lib/adopt/builder/pitch";
import { costFor } from "@/lib/adopt/builder/pricing";
import { recommend, selectionFor } from "@/lib/adopt/builder/profile";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { makeZip } from "@/lib/adopt/advisor/zip";
import { Tag, download } from "./parts";

const WHO_DOT: Record<string, string> = { you: "var(--vb-amber)", voicera: "var(--vb-accent)", it: "var(--vb-violet)", both: "var(--vb-mint)" };

export function PitchStage() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const p = state.profile;
  const rec = recommend(p);
  const sel = state.sel ?? selectionFor(p, rec.startAt);
  const deck = buildDeck(p, pb, sel);
  const n = deck.slides.length;

  const [i, setI] = useState(0);
  const [mode, setMode] = useState<"present" | "read">("present");
  const [notes, setNotes] = useState(false);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const idx = Math.min(i, n - 1);
  const go = (d: number) => setI((v) => Math.max(0, Math.min(n - 1, v + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (mode !== "present") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); setI((v) => Math.min(n - 1, v + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setI((v) => Math.max(0, v - 1)); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(n - 1);
      else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
    };
    const onFs = () => setFull(!!document.fullscreenElement);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [mode, n]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.();
  };

  const cost = costFor(sel, pb);
  const pitch = buildPitch(p, pb, sel, cost, rec);
  const pack = () => download(`${(p.department || "voicera").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voicera"}-handover.zip`, makeZip(buildPack({ profile: p, sel, pb, cost, rec, pitch })), "application/zip");
  const md = deckToMarkdown(deck);

  return (
    <div ref={stage} className={`vb-unclip flex h-full min-h-0 flex-col ${full ? "bg-[var(--vb-bg)]" : ""}`}>
      <div className="vb-noprint flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--vb-line)] px-4 py-2.5 md:px-6">
        <div className="min-w-0">
          <p className="vb-eyebrow">The elevated pitch</p>
          <p className="vb-muted text-[12.5px] tabular-nums">{mode === "present" ? `Slide ${idx + 1} of ${n}` : `${n} slides`}</p>
        </div>
        <div role="group" aria-label="How to view the pitch" className="hidden items-center rounded-full border border-[var(--vb-line-strong)] p-0.5 md:flex">
          {([["present", "Present", Presentation], ["read", "Read all", LayoutList]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${mode === id ? "bg-[var(--vb-ink)] text-[var(--vb-on-ink)]" : "text-[var(--vb-body)] hover:text-[var(--vb-ink)]"}`}><Icon className="size-3.5" aria-hidden />{label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={notes} onClick={() => setNotes((v) => !v)} className="vb-btn vb-btn-ghost vb-btn-sm"><MessageSquareText className="size-3.5" aria-hidden /> Presenter notes</button>
          <button type="button" onClick={toggleFull} className="vb-btn vb-btn-ghost vb-btn-sm hidden md:inline-flex">{full ? <Shrink className="size-3.5" aria-hidden /> : <Expand className="size-3.5" aria-hidden />}{full ? "Exit full screen" : "Full screen"}</button>
          <button type="button" onClick={() => window.print()} className="vb-btn vb-btn-ghost vb-btn-sm"><Printer className="size-3.5" aria-hidden /> Print or PDF</button>
          <button type="button" onClick={() => download("voicera-pitch-deck.md", md, "text/markdown")} className="vb-btn vb-btn-ghost vb-btn-sm"><Download className="size-3.5" aria-hidden /> .md</button>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1600); }} className="vb-btn vb-btn-ghost vb-btn-sm"><Copy className="size-3.5" aria-hidden /> {copied ? "Copied" : "Copy"}</button>
        </div>
      </div>

      <div className="vb-scroll vb-unclip min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
        <div className={`vb-unclip mx-auto flex max-w-[1180px] flex-col ${mode === "read" ? "gap-6" : "min-h-full"}`}>
          {deck.slides.map((s, k) => {
            const visible = mode === "read" || k === idx;
            return (
              <div key={s.id} className={`${visible ? "" : "hidden print:block"} ${mode === "present" ? "flex-1" : ""}`}>
                <SlideView slide={s} index={k} total={n} fill={mode === "present"} onPack={pack} onQuote={() => actions.patch({ stage: "cost", costTab: "quote" })} />
                {notes ? (
                  <aside className="vb-noprint vb-card mt-3 p-5" aria-label={`Presenter notes for slide ${k + 1}`}>
                    <p className="vb-eyebrow flex items-center gap-2"><FileText className="size-3.5" aria-hidden /> How to give this slide</p>
                    <ul className="mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">{s.notes.map((t) => <li key={t}>{t}</li>)}</ul>
                  </aside>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {mode === "present" ? (
        <div className="vb-noprint flex shrink-0 items-center justify-between gap-4 border-t border-[var(--vb-line)] px-4 py-3 md:px-6">
          <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => go(-1)} disabled={idx === 0}><ArrowLeft className="size-3.5" aria-hidden /> Back</button>
          <div className="vb-scroll flex max-w-[50%] items-center gap-1.5 overflow-x-auto" role="group" aria-label="Slides">
            {deck.slides.map((s, k) => <button key={s.id} type="button" aria-label={`Slide ${k + 1}: ${s.title}`} aria-current={k === idx ? "step" : undefined} onClick={() => setI(k)} className={`h-2 shrink-0 rounded-full transition-all ${k === idx ? "w-6 bg-[var(--vb-accent-strong)]" : "w-2 bg-[var(--vb-line-strong)] hover:bg-[var(--vb-muted)]"}`} />)}
          </div>
          <button type="button" className="vb-btn vb-btn-primary vb-btn-sm" onClick={() => go(1)} disabled={idx === n - 1}>Next <ArrowRight className="size-3.5" aria-hidden /></button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ a slide */

function SlideView({ slide, index, total, fill, onPack, onQuote }: { slide: Slide; index: number; total: number; fill: boolean; onPack: () => void; onQuote: () => void }) {
  const cover = slide.id === "cover" || slide.id === "close";
  return (
    <section aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`} className={`vb-slide p-7 md:p-14 ${fill ? "min-h-[min(640px,calc(100dvh-230px))]" : ""} ${cover ? "flex flex-col justify-center" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <p className="vb-eyebrow">{slide.kicker}</p>
        <p className="vb-mono vb-muted text-[11px] tabular-nums">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</p>
      </div>
      <h2 className={`vb-serif mt-4 leading-[1.08] ${cover ? "text-[40px] md:text-[64px]" : "text-[30px] md:text-[46px]"}`}>{slide.title}</h2>
      <div className="mt-7 flex flex-col gap-7">
        {slide.blocks.map((b, k) => <BlockView key={k} b={b} onPack={onPack} onQuote={onQuote} />)}
      </div>
    </section>
  );
}

function BlockView({ b, onPack, onQuote }: { b: Block; onPack: () => void; onQuote: () => void }) {
  switch (b.type) {
    case "lead": return <p className="vb-body max-w-[62ch] text-[17px] leading-relaxed md:text-[19px]">{b.text}</p>;

    case "bullets": return <ul className="flex max-w-[70ch] flex-col gap-4">{b.items.map((t) => <li key={t} className="flex gap-3.5 text-[17px] leading-relaxed md:text-[19px]"><span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-[var(--vb-accent)]" aria-hidden />{t}</li>)}</ul>;

    case "facts": return <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{b.items.map((f) => <div key={f.k} className="vb-tile p-5"><dt className="vb-eyebrow">{f.k}</dt><dd className="vb-serif mt-2 text-[26px] leading-tight md:text-[32px]">{f.v}</dd>{f.sub ? <dd className="vb-muted mt-1 text-[13px] leading-snug">{f.sub}</dd> : null}</div>)}</dl>;

    case "pillars": return <div className="grid gap-4 md:grid-cols-3">{b.items.map((x, k) => <div key={x.title} className="vb-tile p-6"><span className="vb-mono flex size-8 items-center justify-center rounded-full bg-[var(--vb-accent-soft)] text-[12px] text-[var(--vb-accent)]">{k + 1}</span><h3 className="mt-4 text-[19px] font-semibold leading-snug">{x.title}</h3><p className="vb-body mt-2 text-[15px] leading-relaxed">{x.text}</p></div>)}</div>;

    case "chat": return (
      <div className="vb-tile mx-auto w-full max-w-[720px] p-5 md:p-6">
        <p className="vb-eyebrow">{b.title}</p>
        <p className="vb-muted mt-1 text-[13px]">{b.context}</p>
        <ol className="mt-4 flex flex-col gap-3">
          {b.turns.map((t, k) => t.who === "note" ? (
            <li key={k} className="vb-muted text-[12.5px] italic">{t.text}</li>
          ) : (
            <li key={k} className={`flex ${t.who === "citizen" ? "justify-end" : ""}`}>
              <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14.5px] leading-relaxed ${t.who === "citizen" ? "rounded-br-sm bg-[var(--vb-accent-strong)] text-white" : "rounded-bl-sm bg-[var(--vb-surface-3)]"}`}><span className="sr-only">{t.who === "agent" ? "VoicERA: " : "Citizen: "}</span>{t.text}</p>
            </li>
          ))}
        </ol>
      </div>
    );

    case "pipeline": return (
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {b.nodes.map((n, k) => (
          <li key={n.id} className="vb-tile p-4">
            <div className="flex items-start justify-between gap-2"><span className="vb-mono flex size-6 items-center justify-center rounded-full bg-[var(--vb-surface-3)] text-[11px]">{k + 1}</span>{n.chip ? <Tag tone={/not set|Price|Quoted/i.test(n.chip) ? "warn" : /standard|No separate|number/i.test(n.chip) ? "ok" : "info"}>{n.chip}</Tag> : null}</div>
            <p className="mt-3 text-[16px] font-semibold leading-tight">{n.name}</p>
            <p className="vb-mono vb-muted mt-0.5 text-[9.5px] uppercase tracking-[0.12em]">{n.tech}</p>
            <p className="mt-2 text-[14.5px] leading-snug">{n.choice}</p>
          </li>
        ))}
      </ol>
    );

    case "reasons": return (
      <ul className="flex flex-col">
        {b.items.map((r) => (
          <li key={r.layer} className="grid gap-x-8 gap-y-1 border-b border-[var(--vb-line)] py-4 last:border-0 md:grid-cols-[220px_minmax(0,1fr)]">
            <div><p className="vb-eyebrow">{r.layer}</p><p className="mt-1 text-[16px] font-semibold leading-snug">{r.choice}</p></div>
            <div><p className="text-[14.5px] leading-relaxed">{r.why}</p>{r.caution ? <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--vb-amber)]">Check first: {r.caution}</p> : null}</div>
          </li>
        ))}
      </ul>
    );

    case "package": return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="vb-eyebrow">Your canvas is</p>
          <p className="vb-serif mt-1 text-[34px] leading-tight">{b.label}</p>
          <ul className="mt-5 flex flex-col gap-3">{b.reasons.map((r) => <li key={r} className="flex gap-3 text-[15px] leading-relaxed"><span className="mt-[8px] size-1.5 shrink-0 rounded-full bg-[var(--vb-accent)]" aria-hidden />{r}</li>)}</ul>
          <div className="mt-6 flex flex-wrap gap-2" aria-label="What is included">{b.capabilities.map((c) => <span key={c} className="vb-tag">{c}</span>)}</div>
        </div>
        <ol className="flex flex-col gap-3" aria-label="The path">
          {(["deploy", "connect", "orchestrate"] as Depth[]).map((d, k) => {
            const on = b.path.includes(d);
            return (
              <li key={d} className={`vb-tile flex items-center gap-4 p-4 ${d === b.want ? "!border-[var(--vb-accent)]" : ""} ${on ? "" : "opacity-45"}`}>
                <span className="vb-mono flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--vb-surface-3)] text-[12px]">{k + 1}</span>
                <div className="min-w-0 flex-1"><p className="text-[17px] font-semibold">{PACKAGE_NAME[d]}</p></div>
                {d === b.startAt && b.startAt !== b.want ? <Tag tone="info">Start here</Tag> : null}
                {d === b.want ? <Tag tone="ok">{b.startAt === b.want ? "Your package" : "Heading for"}</Tag> : null}
              </li>
            );
          })}
        </ol>
      </div>
    );

    case "money": return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="vb-eyebrow">{b.complete ? "Indicative total" : "Known so far"}</p>
          <p className="vb-serif mt-1 text-[56px] leading-none tabular-nums md:text-[76px]">{b.total}</p>
          {b.budget ? <p className="vb-body mt-3 text-[15px]">{b.budget}.</p> : null}
          {b.perCall ? <p className="mt-3"><Tag tone="info">Usage: {b.perCall}</Tag></p> : null}
          <ul className="mt-6 flex flex-col">{b.rows.map((r) => <li key={r.k} className="flex items-baseline justify-between gap-4 border-b border-[var(--vb-line)] py-3 text-[15px] last:border-0"><span>{r.k}{r.note ? <span className="ml-2 text-[12.5px] text-[var(--vb-amber)]">{r.note}</span> : null}</span><span className="font-semibold tabular-nums">{r.v}</span></li>)}</ul>
          <button type="button" onClick={onQuote} className="vb-btn vb-btn-ghost vb-btn-sm vb-noprint mt-5">Open the itemised quote <ArrowRight className="size-3.5" aria-hidden /></button>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <p className="vb-eyebrow">If the volume were different</p>
            <table className="mt-2 w-full border-collapse text-[14.5px]"><thead><tr className="vb-eyebrow text-left"><th className="border-b border-[var(--vb-line)] py-2 font-normal">Calls a month</th><th className="border-b border-[var(--vb-line)] py-2 text-right font-normal">Total known</th></tr></thead>
              <tbody>{b.scenarios.map((s) => <tr key={s.calls} className={s.planned ? "font-semibold" : ""}><td className="border-b border-[var(--vb-line)] py-2.5 tabular-nums">{s.calls}{s.planned ? <span className="vb-tag ml-2">Your plan</span> : null}</td><td className="border-b border-[var(--vb-line)] py-2.5 text-right tabular-nums">{s.total}</td></tr>)}</tbody></table>
          </div>
          {b.open.length ? (
            <div className="rounded-2xl border border-[var(--vb-amber)]/40 bg-[var(--vb-amber-soft)] p-5">
              <p className="text-[14px] font-semibold">Not priced yet</p>
              <p className="vb-body mt-1 text-[13.5px] leading-snug">Waiting for a quote from VoicERA. Not free, and not zero.</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[14px]">{b.open.map((o) => <li key={o}>{o}</li>)}</ul>
            </div>
          ) : <p className="vb-body text-[14px]">Every line is priced.</p>}
        </div>
      </div>
    );

    case "ladder": return b.steps.length === 0 ? (
      <p className="vb-body max-w-[62ch] text-[17px] leading-relaxed">From here, growth is more use cases, more languages and more departments on the same platform.</p>
    ) : (
      <div className="flex flex-col gap-4">
        <p className="vb-muted text-[14px]">You are at <span className="font-semibold text-[var(--vb-ink)]">{b.here}</span>.</p>
        <ul className="grid gap-4 md:grid-cols-2">
          {b.steps.map((s) => (
            <li key={s.to} className="vb-tile p-6">
              <p className="vb-eyebrow">Move up to</p>
              <p className="vb-serif mt-1 text-[30px] leading-none">{s.to}</p>
              <p className="vb-muted mt-1 text-[13px]">Typically {s.launch.toLowerCase()}</p>
              <ul className="mt-4 flex flex-col gap-1.5">{s.gains.map((g) => <li key={g} className="flex gap-2.5 text-[14.5px]"><Check className="mt-0.5 size-4 shrink-0 text-[var(--vb-accent)]" aria-hidden />{g}</li>)}</ul>
              <p className="vb-body mt-4 border-t border-[var(--vb-line)] pt-3 text-[13.5px] leading-snug">{s.price}.</p>
            </li>
          ))}
        </ul>
        <p className="vb-body text-[14px]">The content, languages, telephony and dashboard carry over. Only the connection into your systems grows.</p>
      </div>
    );

    case "stages": return (
      <ol className="grid gap-3 md:grid-cols-2">
        {b.items.map((s) => (
          <li key={s.n} className="vb-tile relative overflow-hidden p-4 pl-6">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ background: WHO_DOT[s.who] }} />
            <div className="flex items-start justify-between gap-3"><p className="text-[15.5px] font-semibold leading-snug"><span className="vb-mono vb-muted mr-2 text-[12px]">{s.n}</span>{s.title}</p><Tag>{s.whoLabel}</Tag></div>
            <p className="vb-muted mt-1.5 text-[13px] leading-snug">{s.timing}{s.documented ? <span className="vb-tag ok ml-2">Documented</span> : null}</p>
          </li>
        ))}
      </ol>
    );

    case "two": return (
      <div className="grid gap-6 md:grid-cols-2">
        {[b.left, b.right].map((c) => (
          <div key={c.title} className="vb-tile p-6">
            <h3 className="text-[18px] font-semibold">{c.title}</h3>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed">{c.items.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        ))}
      </div>
    );

    case "close": return (
      <div className="flex flex-col gap-6">
        <p className="vb-body max-w-[58ch] text-[18px] leading-relaxed md:text-[21px]">{b.text}</p>
        <div className="vb-noprint flex flex-wrap gap-3">
          <button type="button" className="vb-btn vb-btn-primary" onClick={onPack}><Download className="size-4" aria-hidden /> {b.actions[0]}</button>
          <button type="button" className="vb-btn vb-btn-ghost" onClick={onQuote}>{b.actions[1]}</button>
        </div>
        <p className="vb-muted text-[13.5px]">{b.actions[2]}.</p>
      </div>
    );
  }
}
