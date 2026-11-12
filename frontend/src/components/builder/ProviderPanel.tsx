"use client";

import { motion } from "framer-motion";
import { RotateCcw, X } from "lucide-react";
import { OPTIONS, type Depth } from "@/lib/adopt/builder/catalog";
import { DOCUMENT_PRICES, inr, rate, sourceOfNumber, sourceOfSetup, sourceOfUsage, type PriceBook, type Source } from "@/lib/adopt/builder/pricing";
import { usePrices } from "@/lib/adopt/builder/store";
import { NumInput, Tag } from "./parts";

const SRC: Record<Source, { label: string; tone: "ok" | "info" | "warn" | "plain" }> = {
  document: { label: "From the package document", tone: "ok" },
  provider: { label: "Set by you", tone: "info" },
  adopter: { label: "Adopter", tone: "plain" },
  unset: { label: "Not set", tone: "warn" },
};

const money = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);

function Field({ label, value, onChange, source, hint, step = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; source?: Source; hint?: string; step?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <NumInput label={label} prefix="₹" step={step} value={value} onChange={(v) => onChange(money(v))} hint={hint} />
      {source ? <div><Tag tone={SRC[source].tone}>{SRC[source].label}</Tag></div> : null}
    </div>
  );
}

/** The provider's price book. Every price in the builder reads from here, and a blank stays blank. */
export function ProviderPanel({ onClose }: { onClose: () => void }) {
  const { pb, set, restore } = usePrices();
  const up = (patch: Partial<PriceBook>) => set((p) => ({ ...p, ...patch }));
  const priced = OPTIONS.filter((o) => o.tier === "proprietary" || o.tier === "confirm");
  const hosts = OPTIONS.filter((o) => o.layer === "host" && o.id !== "host-bhashini");

  return (
    <>
      <motion.button type="button" aria-label="Close the price book" className="vb-scrim fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside role="dialog" aria-modal="true" aria-label="Provider price book" className="vb-drawer vb-scroll fixed inset-y-0 right-0 z-[60] flex w-full max-w-[500px] flex-col overflow-y-auto" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.2 }}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--vb-line)] bg-[var(--vb-bg-2)] px-6 py-5">
          <div>
            <p className="vb-eyebrow">Provider view</p>
            <h2 className="vb-serif mt-1 text-[26px] leading-tight">Price book</h2>
            <p className="vb-body mt-1 text-[13.5px] leading-relaxed">Every price in the builder reads from here. Leave a field empty and it stays &ldquo;not set&rdquo; in the cost, never a guess.</p>
          </div>
          <button type="button" onClick={onClose} className="vb-btn vb-btn-ghost vb-btn-sm !h-9 !w-9 !px-0" aria-label="Close"><X className="size-4" aria-hidden /></button>
        </div>

        <div className="flex flex-col gap-8 px-6 py-6">
          <section className="flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Usage</h3>
            <div role="radiogroup" aria-label="What usage is charged by" className="flex w-fit rounded-full border border-[var(--vb-line-strong)] p-0.5">
              {(["call", "minute"] as const).map((u) => (
                <button key={u} type="button" role="radio" aria-checked={pb.usageUnit === u} onClick={() => up({ usageUnit: u })} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${pb.usageUnit === u ? "bg-[var(--vb-ink)] text-[var(--vb-on-ink)]" : "text-[var(--vb-body)]"}`}>Per {u}</button>
              ))}
            </div>
            <Field label={`Standard usage price, per ${pb.usageUnit}`} value={pb.usageRate} step={0.01} onChange={(v) => up({ usageRate: v })} source={sourceOfUsage(pb)} hint={`Covers the platform, the phone line and open-source models. Now ${rate(pb.usageRate, pb.usageUnit)}. The package document had ${inr(DOCUMENT_PRICES.openPerMinute)} a minute.`} />
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">One-time</h3>
            {(["deploy", "connect", "orchestrate"] as Depth[]).map((d) => (
              <Field key={d} label={`Setup and implementation, ${d[0].toUpperCase()}${d.slice(1)}`} value={pb.setup[d]} step={1000} onChange={(v) => up({ setup: { ...pb.setup, [d]: v } })} source={sourceOfSetup(d, pb)} hint={d === "deploy" ? `The package document gives ${inr(DOCUMENT_PRICES.setupDeploy)}.` : "Project-based. The documents give no price."} />
            ))}
            <Field label="Each phone number" value={pb.perNumber} onChange={(v) => up({ perNumber: v })} source={sourceOfNumber(pb)} hint={`The package document gives ${inr(DOCUMENT_PRICES.perNumber)}.`} />
            <Field label="Connecting the adopter's own telephony provider" value={pb.ownTelephonySetup} step={1000} onChange={(v) => up({ ownTelephonySetup: v })} source={pb.ownTelephonySetup === null ? "unset" : "provider"} />
            <Field label="Conversation and language testing" value={pb.evaluationOneTime} step={1000} onChange={(v) => up({ evaluationOneTime: v })} source={pb.evaluationOneTime === null ? "unset" : "provider"} />
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Annual</h3>
            <Field label="Managed operations, a year" value={pb.managedOpsAnnual} step={1000} onChange={(v) => up({ managedOpsAnnual: v })} source={pb.managedOpsAnnual === null ? "unset" : "provider"} />
            <Field label="Platform licence, a year" value={pb.licenceAnnual} step={1000} onChange={(v) => up({ licenceAnnual: v })} source={pb.licenceAnnual === null ? "unset" : "provider"} hint="Listed in the ICP with no amount. Empty means none is added." />
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Models, extra per {pb.usageUnit}</h3>
            <p className="vb-muted -mt-2 text-[13px] leading-relaxed">Added on top of the standard price when an adopter chooses the model. Open-source models need no entry.</p>
            {priced.map((o) => (
              <Field key={o.id} label={`${o.name}, ${o.layer === "listen" ? "listening" : o.layer === "think" ? "thinking" : "speaking"}`} value={pb.modelExtra[o.id] ?? null} step={0.01} onChange={(v) => up({ modelExtra: { ...pb.modelExtra, [o.id]: v } })} source={(pb.modelExtra[o.id] ?? null) === null ? "unset" : "provider"} hint={o.tier === "confirm" ? "Listed without detail. Set a price, or leave it to be confirmed." : undefined} />
            ))}
            <Field label="Connecting an adopter's own model, per unit" value={pb.ownFee} step={0.01} onChange={(v) => up({ ownFee: v })} source={pb.ownFee === null ? "unset" : "provider"} />
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Hosting beyond Bhashini, one-time</h3>
            {hosts.map((o) => <Field key={o.id} label={o.name} value={pb.hostExtra[o.id] ?? null} step={1000} onChange={(v) => up({ hostExtra: { ...pb.hostExtra, [o.id]: v } })} source={(pb.hostExtra[o.id] ?? null) === null ? "unset" : "provider"} />)}
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t vb-hair pt-5">
            <button type="button" className="vb-btn vb-btn-ghost vb-btn-sm" onClick={restore}><RotateCcw className="size-3.5" aria-hidden /> Restore defaults</button>
            <span className="vb-muted text-[12.5px]">Saved in this browser.</span>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
