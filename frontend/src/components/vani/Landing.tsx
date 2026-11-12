"use client";

import { ArrowRight, Check, FileText, Languages, Lock, ScrollText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useVani } from "./provider";
import { Logo } from "./ui";

const STAGES = [
  { id: "req", label: "Requirements", lines: [["Service", "Citizen Support Helpline"], ["Languages", "Hindi, English"], ["Volume", "50,000 calls a month, 3 min"], ["Target", "Replies in 1 to 2 seconds"]] },
  { id: "ai", label: "AI reasoning", lines: [["Rule", "Data must stay in India"], ["Excluded", "1 package runs abroad"], ["Compared", "7 packages that qualify"], ["Weighed", "Cost, quality, speed, language fit"]] },
  { id: "stack", label: "Technology stack", lines: [["Speech", "Tested for Hindi and English"], ["Model", "Handles transactional calls"], ["Voice", "Natural, not streamed"], ["Telephony", "Carries inbound calls"]] },
  { id: "cost", label: "Cost", lines: [["Per month", "Itemised, line by line"], ["Setup", "One time, shown separately"], ["Budget", "90% of the ceiling"], ["Per minute", "Worked out, not guessed"]] },
  { id: "deploy", label: "Deployment", lines: [["Hosting", "Government cloud, Mumbai"], ["Privacy", "PII redacted before storage"], ["Checks", "Policy items to clear"], ["Quote", "Ready to submit for approval"]] },
];

function Pipeline() {
  const [i, setI] = useState(0);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const id = requestAnimationFrame(() => setReduce(m.matches));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % STAGES.length), 2600);
    return () => clearInterval(t);
  }, [reduce]);
  const s = STAGES[i];
  return (
    <div className="va-card va-card--raised" style={{ overflow: "hidden" }} aria-label="How a package comes together">
      <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <span className="eyebrow">How a package comes together</span>
        <span className="va-badge">Sample</span>
      </div>
      <ol className="px-5 pt-5 pb-1 flex items-start" aria-label="Stages">
        {STAGES.map((st, n) => (
          <li key={st.id} className="flex items-start flex-1 last:flex-none min-w-0">
            <button type="button" onClick={() => setI(n)} className="flex flex-col items-center gap-2" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", width: 56 }} aria-label={`${st.label}${n === i ? " (current)" : ""}`} aria-current={n === i ? "step" : undefined}>
              <span className="grid place-content-center" style={{ width: 26, height: 26, borderRadius: "50%", border: `1.5px solid ${n <= i ? "var(--ink)" : "var(--line-strong)"}`, background: n < i ? "var(--solid)" : "var(--surface)", color: n < i ? "var(--on-solid)" : n === i ? "var(--ink)" : "var(--muted)", fontSize: 11.5, fontWeight: 600, boxShadow: n === i ? "0 0 0 4px var(--accent-soft)" : "none", transition: "all 0.3s" }}>
                {n < i ? <Check size={13} strokeWidth={3} aria-hidden /> : n + 1}
              </span>
              <span className="hidden sm:block text-center" style={{ fontSize: 11, lineHeight: 1.25, color: n === i ? "var(--ink)" : "var(--muted)", fontWeight: n === i ? 600 : 500 }}>{st.label}</span>
            </button>
            {n < STAGES.length - 1 && <span className="va-stepline mt-[13px]" aria-hidden><i style={{ transform: `scaleX(${n < i ? 1 : 0})` }} /></span>}
          </li>
        ))}
      </ol>
      <div className="px-5 pb-5 pt-4 sm:pt-5" aria-live="off">
        <div className="sm:hidden eyebrow mb-3 ink">{s.label}</div>
        <dl key={s.id} className="m-0" style={{ display: "grid", gap: 0 }}>
          {s.lines.map(([k, v], n) => (
            <div key={k} className="va-rise flex items-baseline justify-between gap-4 py-2.5" style={{ borderTop: "1px solid var(--line)", animationDelay: `${n * 70}ms` }}>
              <dt className="muted" style={{ fontSize: 13 }}>{k}</dt>
              <dd className="m-0 ink text-right" style={{ fontSize: 13.5, fontWeight: 500 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const FLOW = [
  { n: "01", t: "Say what you need", d: "Who calls, in which languages, how many, how fast, and what you can spend. Every answer updates a live estimate, so you see the effect of a choice as you make it." },
  { n: "02", t: "Set the data rules", d: "Where it runs, whether data stays in India, what is recorded, what is redacted and for how long it is kept. Policy checks tell you what is clear and what still needs a decision." },
  { n: "03", t: "Read the recommendation", d: "A package with a fit score, the reasons behind it, the trade-offs, and three alternatives to compare. Nothing is a black box." },
  { n: "04", t: "Configure and price it", d: "Swap any layer and watch the cost, speed and compatibility move. Every change can be undone or saved as a version." },
  { n: "05", t: "Get a quote you can send", d: "A complete document with the configuration, usage assumptions, evidence, cost, governance and open items. Submit it for approval, then set up the agent." },
];

export default function Landing() {
  const { status } = useVani();
  const authed = status === "authed";
  const start = authed ? "/vani/app/packages/new" : "/vani/signup";
  return (
    <div>
      <header className="sticky top-0 z-30" style={{ background: "color-mix(in srgb, var(--bg) 88%, transparent)", backdropFilter: "blur(10px)", borderBottom: "1px solid var(--line)" }}>
        <div className="mx-auto flex items-center justify-between gap-4 px-5 sm:px-8" style={{ maxWidth: 1180, height: 60 }}>
          <Link href="/vani" aria-label="Vani Anuvaad home" style={{ textDecoration: "none" }}><Logo /></Link>
          <nav aria-label="Main" className="hidden md:flex items-center gap-7" style={{ fontSize: 13.5 }}>
            <a href="#platform" style={{ color: "var(--body)", textDecoration: "none" }}>Platform</a>
            <a href="#privacy" style={{ color: "var(--body)", textDecoration: "none" }}>Privacy</a>
            <a href="#explain" style={{ color: "var(--body)", textDecoration: "none" }}>Explainability</a>
          </nav>
          <div className="flex items-center gap-2">
            {authed ? <Link href="/vani/app" className="va-btn va-btn--secondary va-btn--sm">Open workspace</Link> : <Link href="/vani/signin" className="va-btn va-btn--ghost va-btn--sm">Sign in</Link>}
            <Link href={start} className="va-btn va-btn--primary va-btn--sm hidden sm:inline-flex">Create a package</Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto px-5 sm:px-8 pt-14 sm:pt-24 pb-16 sm:pb-24 grid gap-12 lg:gap-16 lg:grid-cols-[1.05fr_0.95fr] items-center" style={{ maxWidth: 1180 }}>
          <div>
            <p className="eyebrow mb-5">Voice AI package design</p>
            <h1 className="serif" style={{ fontSize: "clamp(38px, 5.4vw, 62px)", lineHeight: 1.04, color: "var(--ink)" }}>Design the right Voice AI package for your workload.</h1>
            <p className="mt-6" style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 520 }}>
              Tell us what your service needs: the languages callers speak, how fast replies should be, where data may live, how many calls you expect and what you can spend. Vani Anuvaad recommends a package, shows why, and prices it line by line.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={start} className="va-btn va-btn--primary va-btn--lg">Create a package <ArrowRight size={16} aria-hidden /></Link>
              <a href="#platform" className="va-btn va-btn--secondary va-btn--lg">Explore platform</a>
            </div>
            <p className="mt-6 muted" style={{ fontSize: 12.5 }}>Prototype with sample data. Providers are real names; rates and benchmarks are illustrative.</p>
          </div>
          <Pipeline />
        </section>

        <section id="platform" className="mx-auto px-5 sm:px-8 py-16 sm:py-24" style={{ maxWidth: 1180, borderTop: "1px solid var(--line)" }}>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="eyebrow mb-4">The platform</p>
              <h2 className="serif" style={{ fontSize: "clamp(28px, 3.4vw, 40px)", lineHeight: 1.12 }}>Five steps from a brief to a quote.</h2>
              <p className="mt-4" style={{ maxWidth: 380 }}>Your progress is saved at every step. Go back whenever you like; nothing you entered is lost.</p>
            </div>
            <ol className="m-0 p-0 list-none">
              {FLOW.map((f) => (
                <li key={f.n} className="grid gap-x-6 py-6 sm:grid-cols-[56px_1fr]" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="mono muted" style={{ fontSize: 13 }}>{f.n}</span>
                  <div><h3 style={{ fontSize: 17 }}>{f.t}</h3><p className="mt-1.5" style={{ maxWidth: 560 }}>{f.d}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="privacy" style={{ background: "var(--sunken)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
          <div className="mx-auto px-5 sm:px-8 py-16 sm:py-24 grid gap-12 lg:grid-cols-2 items-center" style={{ maxWidth: 1180 }}>
            <div>
              <p className="eyebrow mb-4">Privacy is an input, not an afterthought</p>
              <h2 className="serif" style={{ fontSize: "clamp(28px, 3.4vw, 40px)", lineHeight: 1.12 }}>Decide what is kept before a single call is made.</h2>
              <p className="mt-4" style={{ maxWidth: 460 }}>Choose what is recorded, what is redacted and who may read it. See the path a call takes from the caller to storage, and clear every policy check before you can submit.</p>
              <ul className="mt-6 grid gap-3 p-0 m-0 list-none">
                {[[Lock, "Data stays in India when you say so, and packages that break the rule are excluded."], [ShieldCheck, "Personal details are detected and removed before anything is stored."], [ScrollText, "Retention, access and decisions are written to an audit log."]].map(([Icon, t], n) => {
                  const I = Icon as typeof Lock;
                  return <li key={n} className="flex gap-3"><I size={18} className="flex-none mt-0.5 ink" aria-hidden /><span>{t as string}</span></li>;
                })}
              </ul>
            </div>
            <div className="va-card va-card--pad" aria-label="Example of the privacy path">
              <p className="eyebrow mb-4">What happens to a call</p>
              <ol className="m-0 p-0 list-none">
                {[["Call", "Caller hears the notice"], ["Transcription", "Speech becomes text"], ["PII detection", "Names, phone and ID numbers found"], ["Redaction", "Replaced with labels such as [PHONE]"], ["Storage", "Kept for 90 days, auditors only"]].map(([a, b], n, arr) => (
                  <li key={a} className="flex gap-4">
                    <div className="flex flex-col items-center"><span className="grid place-content-center mono" style={{ width: 24, height: 24, borderRadius: 6, border: "1px solid var(--line-strong)", fontSize: 11, color: "var(--muted)" }}>{n + 1}</span>{n < arr.length - 1 && <span style={{ width: 1.5, flex: 1, minHeight: 20, background: "var(--line-strong)" }} />}</div>
                    <div className="pb-5"><div className="ink" style={{ fontWeight: 600, fontSize: 13 }}>{a}</div><div style={{ fontSize: 13 }}>{b}</div></div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="explain" className="mx-auto px-5 sm:px-8 py-16 sm:py-24" style={{ maxWidth: 1180 }}>
          <div className="grid gap-12 lg:grid-cols-2 items-start">
            <div className="va-card va-card--pad" aria-label="Example of an explained recommendation">
              <div className="flex items-baseline justify-between"><span className="eyebrow">Example recommendation</span><span className="va-badge">Sample</span></div>
              <div className="mt-4 flex items-baseline gap-3"><span className="serif" style={{ fontSize: 44, color: "var(--ink)", lineHeight: 1 }}>92%</span><span className="muted">fit, based on 9 of 9 answers</span></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2" style={{ fontSize: 13 }}>
                <div><div className="eyebrow mb-2">Why it fits</div><ul className="m-0 pl-4 grid gap-1.5"><li>Tested for both languages</li><li>Runs on government cloud, data stays in India</li><li>Meets the 1 to 2 second target</li></ul></div>
                <div><div className="eyebrow mb-2">Trade-offs</div><ul className="m-0 pl-4 grid gap-1.5"><li>Costs more than the cheapest option</li><li>Speech is not streamed</li></ul></div>
              </div>
            </div>
            <div>
              <p className="eyebrow mb-4">Explainability</p>
              <h2 className="serif" style={{ fontSize: "clamp(28px, 3.4vw, 40px)", lineHeight: 1.12 }}>Every recommendation shows its working.</h2>
              <p className="mt-4" style={{ maxWidth: 460 }}>Open any part of the stack to see the provider, the model, how well it is tested for your languages, and what it costs. Choose a different option and everything recalculates.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[[Languages, "Language coverage shown per language: tested, partly tested or not benchmarked."], [FileText, "A quote with the evidence, assumptions and open items written down."]].map(([Icon, t], n) => { const I = Icon as typeof Lock; return <div key={n} className="flex gap-3" style={{ fontSize: 13.5 }}><I size={18} className="flex-none mt-0.5 ink" aria-hidden /><span>{t as string}</span></div>; })}
              </div>
            </div>
          </div>
        </section>

        <section style={{ borderTop: "1px solid var(--line)" }}>
          <div className="mx-auto px-5 sm:px-8 py-16 sm:py-20 flex flex-wrap items-center justify-between gap-6" style={{ maxWidth: 1180 }}>
            <h2 className="serif" style={{ fontSize: "clamp(26px, 3vw, 36px)", maxWidth: 560 }}>Start with what you know. The rest can wait.</h2>
            <Link href={start} className="va-btn va-btn--primary va-btn--lg">Create a package <ArrowRight size={16} aria-hidden /></Link>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: "1px solid var(--line)" }}>
        <div className="mx-auto px-5 sm:px-8 py-8 flex flex-wrap items-center justify-between gap-4 muted" style={{ maxWidth: 1180, fontSize: 12.5 }}>
          <Logo size={18} />
          <span>Prototype. All data is sample data kept in this browser. Rates and benchmarks are illustrative.</span>
        </div>
      </footer>
    </div>
  );
}
