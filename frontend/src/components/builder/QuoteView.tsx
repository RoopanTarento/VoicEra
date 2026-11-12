"use client";

import { ArrowLeft, Download, Printer } from "lucide-react";
import { buildQuote, quoteToCsv, quoteToMarkdown, type QuoteRow } from "@/lib/adopt/builder/quote";
import { inr, rate, type Source } from "@/lib/adopt/builder/pricing";
import { useBuilder, usePrices } from "@/lib/adopt/builder/store";
import { Tag, download } from "./parts";

const SOURCE_LABEL: Record<Source, string> = { document: "Package document", provider: "Set by VoicERA", adopter: "Your figure", unset: "Not priced yet" };

function Status({ r }: { r: QuoteRow }) {
  if (r.status === "open") return <Tag tone="warn">Not priced yet</Tag>;
  if (r.status === "yours") return <Tag>Your figure</Tag>;
  return <Tag tone={r.source === "document" ? "ok" : "info"}>{SOURCE_LABEL[r.source]}</Tag>;
}

/** The cost as a quotation: sections, quantities, rates, amounts and a status on every row. */
export function QuoteView() {
  const { state, actions } = useBuilder();
  const { pb } = usePrices();
  const sel = state.sel;
  if (!sel) return null;
  const q = buildQuote(sel, pb);
  const p = state.profile;
  const slug = (p.department || "voicera-quote").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voicera-quote";
  const sections = q.sections;

  return (
    <div className="flex flex-col gap-6">
      <div className="vb-noprint flex flex-wrap items-center gap-2">
        <button type="button" className="vb-btn vb-btn-primary vb-btn-sm" onClick={() => window.print()}><Printer className="size-3.5" aria-hidden /> Print or save as PDF</button>
        <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => download(`${slug}-quote.csv`, quoteToCsv(q), "text/csv")}><Download className="size-3.5" aria-hidden /> Spreadsheet (.csv)</button>
        <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={() => download(`${slug}-quote.md`, quoteToMarkdown(q, p.department), "text/markdown")}><Download className="size-3.5" aria-hidden /> Document (.md)</button>
      </div>

      <article className="vb-sheet vb-quote-doc p-6 md:p-10" aria-label="Itemised quotation">
        {/* header */}
        <header className="flex flex-col gap-6 border-b border-[var(--vb-paper-line)] pb-7 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="vb-eyebrow">VoicERA · Indicative quotation</p>
            <h2 className="vb-serif mt-2 text-[34px] leading-none md:text-[42px]">Quotation</h2>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
              <dt className="vb-muted">Prepared for</dt><dd className="font-medium">{p.department || "Your department"}</dd>
              <dt className="vb-muted">Package</dt><dd className="font-medium">{q.packageLabel}</dd>
              <dt className="vb-muted">Date</dt><dd>{q.date}</dd>
              <dt className="vb-muted">Planning period</dt><dd>{q.period} month{q.period === 1 ? "" : "s"}{q.callsPerMonth ? `, ${q.callsPerMonth.toLocaleString("en-IN")} calls a month` : ", volume not set"}</dd>
              <dt className="vb-muted">Usage price</dt><dd>{rate(pb.usageRate, pb.usageUnit)}</dd>
            </dl>
          </div>
          <div className="md:text-right">
            <p className="vb-eyebrow">{q.complete ? "Indicative total" : "Known so far"}</p>
            <p className="vb-serif mt-1 text-[44px] leading-none tabular-nums md:text-[56px]">{inr(q.grand)}</p>
            {!q.complete ? <p className="mt-2 text-[13px] font-medium text-[var(--vb-amber)]">{q.openRows} row{q.openRows === 1 ? "" : "s"} not priced yet, so this is not the full cost</p> : <p className="vb-muted mt-2 text-[13px]">Every row is priced.</p>}
          </div>
        </header>

        {/* sections */}
        <div className="mt-8 flex flex-col gap-9">
          {sections.map((s, i) => (
            <section key={s.id} aria-labelledby={`q-${s.id}`}>
              <div className="flex items-baseline justify-between gap-4">
                <div><h3 id={`q-${s.id}`} className="text-[18px] font-semibold"><span className="vb-mono vb-muted mr-2 text-[12px]">{String.fromCharCode(65 + i)}</span>{s.title}</h3><p className="vb-muted text-[13px]">{s.blurb}</p></div>
                <p className="shrink-0 text-[15px] font-semibold tabular-nums">{inr(s.subtotal)}{s.open ? <span className="vb-muted text-[12px] font-normal"> known</span> : null}</p>
              </div>
              <div className="vb-scroll mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-[14px]">
                  <thead>
                    <tr className="vb-eyebrow text-left">
                      <th className="border-b border-[var(--vb-paper-line)] py-2 pr-3 font-normal">Item</th>
                      <th className="border-b border-[var(--vb-paper-line)] py-2 pr-3 text-right font-normal">Quantity</th>
                      <th className="border-b border-[var(--vb-paper-line)] py-2 pr-3 text-right font-normal">Rate</th>
                      <th className="border-b border-[var(--vb-paper-line)] py-2 pr-3 font-normal">Status</th>
                      <th className="border-b border-[var(--vb-paper-line)] py-2 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="border-b border-[var(--vb-paper-line)] py-3 pr-3"><p className="font-medium leading-snug">{r.item}</p><p className="vb-muted mt-0.5 max-w-[46ch] text-[12.5px] leading-snug">{r.status === "open" ? r.detail : r.qty !== null && r.rate !== null ? `${r.qty.toLocaleString("en-IN")} ${r.unit} × ${inr(r.rate)}` : r.detail}</p></td>
                        <td className="border-b border-[var(--vb-paper-line)] py-3 pr-3 text-right tabular-nums">{r.qty !== null ? r.qty.toLocaleString("en-IN") : "-"}<span className="vb-muted block text-[11.5px]">{r.qty !== null ? r.unit : ""}</span></td>
                        <td className="border-b border-[var(--vb-paper-line)] py-3 pr-3 text-right tabular-nums">{r.rate !== null ? inr(r.rate) : "-"}</td>
                        <td className="border-b border-[var(--vb-paper-line)] py-3 pr-3"><Status r={r} /></td>
                        <td className={`border-b border-[var(--vb-paper-line)] py-3 text-right font-medium tabular-nums ${r.amount === null ? "text-[var(--vb-amber)]" : ""}`}>{r.amount === null ? "To be quoted" : inr(r.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4} className="py-3 pr-3 text-right text-[13px] font-semibold">Subtotal{s.open ? " (priced rows only)" : ""}</td>
                      <td className="py-3 text-right text-[15px] font-semibold tabular-nums">{inr(s.subtotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>

        {/* totals */}
        <section aria-label="Totals" className="mt-8 ml-auto max-w-[420px] rounded-2xl bg-[rgba(20,22,26,0.05)] p-5">
          <dl className="flex flex-col gap-2 text-[14.5px]">
            <div className="flex justify-between gap-6"><dt>Known total</dt><dd className="tabular-nums">{inr(q.knownTotal)}</dd></div>
            {q.yourTotal > 0 ? <div className="flex justify-between gap-6"><dt>Your own figures</dt><dd className="tabular-nums">{inr(q.yourTotal)}</dd></div> : null}
            <div className="flex justify-between gap-6 border-t border-[var(--vb-paper-line)] pt-3 text-[18px] font-semibold"><dt>{q.complete ? "Total" : "Total so far"}</dt><dd className="tabular-nums">{inr(q.grand)}</dd></div>
          </dl>
          {q.openRows ? <p className="mt-3 text-[12.5px] leading-snug text-[var(--vb-amber)]">{q.openRows} row{q.openRows === 1 ? "" : "s"} marked &ldquo;To be quoted&rdquo; are not in this total. They are not free and not zero.</p> : null}
        </section>

        {/* unit economics */}
        <section aria-labelledby="q-unit" className="mt-10">
          <h3 id="q-unit" className="text-[18px] font-semibold">What a call costs</h3>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Usage price", rate(pb.usageRate, pb.usageUnit)],
              [pb.usageUnit === "call" ? "Per 1,000 calls" : "Per 1,000 minutes", q.per1000 !== null ? inr(q.per1000) : pb.usageRate === null ? "Not set" : inr(Math.round(pb.usageRate * 1000 * 100) / 100)],
              ["Monthly run rate", q.monthlyRun !== null ? inr(q.monthlyRun) : "Add volume"],
              ["One-time, once", inr(sections.find((s) => s.id === "once")?.subtotal ?? 0)],
            ].map(([k, v]) => <div key={k} className="rounded-xl border border-[var(--vb-paper-line)] p-4"><dt className="vb-eyebrow">{k}</dt><dd className="mt-1.5 text-[18px] font-semibold tabular-nums">{v}</dd></div>)}
          </dl>
        </section>

        <section aria-labelledby="q-cover" className="mt-10 grid gap-8 md:grid-cols-2">
          <div>
            <h3 id="q-cover" className="text-[16px] font-semibold">What the usage price covers</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">{q.covered.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div>
            <h3 className="text-[16px] font-semibold">Included, no separate charge documented</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed">{q.included.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        </section>

        {/* volume ladder */}
        <section aria-labelledby="q-ladder" className="mt-10">
          <h3 id="q-ladder" className="text-[18px] font-semibold">If the volume were different</h3>
          <p className="vb-muted text-[13px]">The same build over {q.period} month{q.period === 1 ? "" : "s"}. Rows not priced yet stay out of every total.</p>
          <div className="vb-scroll mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[14px]">
              <thead><tr className="vb-eyebrow text-left"><th className="border-b border-[var(--vb-paper-line)] py-2 font-normal">Calls a month</th><th className="border-b border-[var(--vb-paper-line)] py-2 text-right font-normal">Usage</th><th className="border-b border-[var(--vb-paper-line)] py-2 text-right font-normal">Total known</th></tr></thead>
              <tbody>
                {q.scenarios.map((s) => (
                  <tr key={s.callsPerMonth} className={s.planned ? "font-semibold" : ""}>
                    <td className="border-b border-[var(--vb-paper-line)] py-2.5 tabular-nums">{s.callsPerMonth.toLocaleString("en-IN")}{s.planned ? <span className="vb-tag ml-2">Your plan</span> : null}</td>
                    <td className="border-b border-[var(--vb-paper-line)] py-2.5 text-right tabular-nums">{inr(s.usage)}</td>
                    <td className="border-b border-[var(--vb-paper-line)] py-2.5 text-right tabular-nums">{inr(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="q-notes" className="mt-10 border-t border-[var(--vb-paper-line)] pt-6">
          <h3 id="q-notes" className="text-[15px] font-semibold">How to read this quotation</h3>
          <ul className="vb-body mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed">{q.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="vb-muted mt-4 text-[12.5px]">Indicative. Not an order and not an offer. Prices marked Package document are from the supplied VoicERA package document; Set by VoicERA were set by the provider; Your figure is yours.</p>
        </section>
      </article>

      <div className="vb-noprint flex flex-wrap items-center gap-3 pb-6">
        <button type="button" className="vb-btn vb-btn-ghost" onClick={() => actions.patch({ costTab: "cost" })}><ArrowLeft className="size-4" aria-hidden /> Back to the summary</button>
      </div>
    </div>
  );
}
