"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { getCampaignResultsAnalytics, type CampaignAnalytics, type CampaignSurveyResults } from "@/lib/api/campaigns";
import { formatDuration } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "var(--v-muted)" };
const TOOLTIP = { borderRadius: 8, borderColor: "var(--v-line)", fontSize: 12.5 };

const ENGINE_LABELS: Record<string, string> = {
  llm: "AI analysis",
  rules: "Basic analysis (built-in rules)",
};

const SENTIMENTS: { key: CampaignAnalytics["sentiments"][number]["key"]; label: string; color: string }[] = [
  { key: "positive", label: "Positive", color: "var(--v-success)" },
  { key: "neutral", label: "Neutral", color: "var(--v-line-strong)" },
  { key: "negative", label: "Negative", color: "var(--v-danger)" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[.08em] text-v-muted">{children}</span>;
}

/** "AI analysis · 12 calls" (one engine) or both engines with their counts. */
function engineLine(engines: Record<string, number>): string {
  const entries = Object.entries(engines).filter(([, n]) => n > 0);
  if (entries.length === 0) return "";
  if (entries.length === 1) return ENGINE_LABELS[entries[0]![0]] ?? entries[0]![0];
  return entries.map(([k, n]) => `${ENGINE_LABELS[k] ?? k} (${n.toLocaleString()} calls)`).join(" · ");
}

function SentimentSplit({ sentiments }: { sentiments: CampaignAnalytics["sentiments"] }) {
  const counts = Object.fromEntries(sentiments.map((s) => [s.key, s.count]));
  const total = sentiments.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) return <p className="text-sm font-light text-v-muted">No answered calls analysed yet.</p>;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-v-track">
        {SENTIMENTS.map((s) =>
          counts[s.key] ? (
            <div key={s.key} style={{ width: `${(counts[s.key]! / total) * 100}%`, background: s.color }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-v-muted">
        {SENTIMENTS.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium tabular-nums text-v-fg">
              {Math.round(((counts[s.key] ?? 0) / total) * 100)}%
            </span>
            <span className="tabular-nums">({(counts[s.key] ?? 0).toLocaleString()})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const RATINGS = ["1", "2", "3", "4", "5"];

/** Five small columns, one per rating, scaled to the most common rating. */
function RatingDistribution({ distribution }: { distribution: Record<string, number> }) {
  const max = Math.max(1, ...RATINGS.map((r) => distribution[r] ?? 0));
  return (
    <div className="flex items-end gap-1" aria-label="Ratings from 1 to 5">
      {RATINGS.map((r) => {
        const n = distribution[r] ?? 0;
        return (
          <span key={r} className="flex flex-col items-center gap-0.5" title={`${n.toLocaleString()} rated ${r}`}>
            <span className="flex h-7 w-4 items-end overflow-hidden rounded-[3px] bg-v-track">
              <span className="w-full bg-v-accent" style={{ height: `${(n / max) * 100}%` }} />
            </span>
            <span className="text-[10px] tabular-nums text-v-muted">{r}</span>
          </span>
        );
      })}
    </div>
  );
}

function SurveyResults({ survey }: { survey: CampaignSurveyResults }) {
  return (
    <div className="flex flex-col gap-4 rounded-v-md border border-v-line bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Survey results</SectionLabel>
        <span className="text-xs text-v-muted">
          {survey.name} · {survey.responses.toLocaleString()} {survey.responses === 1 ? "response" : "responses"} ·{" "}
          {survey.completed.toLocaleString()} completed
        </span>
      </div>

      {survey.questions.length === 0 ? (
        <p className="text-sm font-light text-v-muted">No answers yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-v-hairline">
          {survey.questions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13px]">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-light leading-relaxed">{q.text}</span>
                <span className="text-xs text-v-muted">
                  {q.answered.toLocaleString()} {q.answered === 1 ? "answer" : "answers"}
                </span>
              </span>
              {q.kind === "rating" ? (
                <span className="flex shrink-0 items-end gap-3">
                  <span className="text-[15px] font-semibold tabular-nums">
                    {q.average != null ? q.average.toFixed(1) : "–"}
                    <span className="text-xs font-normal text-v-muted"> / 5</span>
                  </span>
                  {q.distribution ? <RatingDistribution distribution={q.distribution} /> : null}
                </span>
              ) : q.kind === "yes_no" ? (
                <span className="flex w-40 shrink-0 flex-col items-end gap-1">
                  <span className="text-[15px] font-semibold tabular-nums">
                    {q.yes_percent != null ? `${Math.round(q.yes_percent)}%` : "–"}
                    <span className="text-xs font-normal text-v-muted"> yes</span>
                  </span>
                  <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-v-track">
                    <span className="bg-v-accent" style={{ width: `${q.yes_percent ?? 0}%` }} />
                  </span>
                </span>
              ) : (
                <span className="shrink-0 text-xs text-v-muted">Open answer</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-v-line pt-4">
        <SectionLabel>Common complaints</SectionLabel>
        {survey.themes.length === 0 ? (
          <p className="text-sm font-light text-v-muted">No complaint themes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-v-hairline">
            {survey.themes.map((t) => (
              <li key={t.theme} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                <span className="font-light leading-relaxed">{t.theme}</span>
                <span className="shrink-0 tabular-nums text-v-muted">
                  {t.calls.toLocaleString()} {t.calls === 1 ? "call" : "calls"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Problem types callers reported to a Support or Utilisation agent. */
function ProblemResults({ data }: { data: CampaignAnalytics }) {
  const issues = data.issues ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-4">
      <div className="flex flex-col gap-1">
        <SectionLabel>Problems reported</SectionLabel>
        <span className="text-xs font-light text-v-muted">
          {(data.issues_reported ?? 0).toLocaleString()} {data.issues_reported === 1 ? "caller" : "callers"} reported a
          problem. The agent pointed them to the scheme&apos;s helpline and the government grievance portal.
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="text-sm font-light text-v-muted">No problem types recognised yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-v-hairline">
          {issues.map((t) => (
            <li key={t.theme} className="flex items-start justify-between gap-3 py-2 text-[13px]">
              <span className="font-light leading-relaxed">{t.theme}</span>
              <span className="shrink-0 tabular-nums text-v-muted">
                {t.calls.toLocaleString()} {t.calls === 1 ? "call" : "calls"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PATH_LABELS: Record<string, string> = {
  awareness: "Awareness",
  discovery: "Discovery",
  enrolment: "Enrolment",
  utilisation: "Utilisation",
  support: "Support",
  feedback: "Feedback",
};

/** Calls where the agent took another intent's path because the person needed it. */
function SwitchedPaths({ paths }: { paths: { intent: string; calls: number }[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-4">
      <div className="flex flex-col gap-1">
        <SectionLabel>Calls that switched path</SectionLabel>
        <span className="text-xs font-light text-v-muted">
          The person turned out to need something else, so the agent followed that path.
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-v-hairline">
        {paths.map((p) => (
          <li key={p.intent} className="flex items-start justify-between gap-3 py-2 text-[13px]">
            <span className="font-light leading-relaxed">{PATH_LABELS[p.intent] ?? p.intent}</span>
            <span className="shrink-0 tabular-nums text-v-muted">
              {p.calls.toLocaleString()} {p.calls === 1 ? "call" : "calls"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The fourth headline number, chosen by what the campaign's agent is for. */
function HeadlineCard({ data }: { data: CampaignAnalytics }) {
  const share = (n: number) => `${data.calls_answered ? Math.round((n / data.calls_answered) * 100) : 0}%`;
  const note = (n: number) => `${n.toLocaleString()} of answered calls`;
  // A survey campaign has no "interested" outcome: completion is its headline number.
  if (data.survey) return <StatCard label="Survey completed" value={share(data.survey.completed)} note={note(data.survey.completed)} />;
  if (data.intent === "support" || data.intent === "utilisation") {
    const n = data.issues_reported ?? 0;
    return <StatCard label="Problems reported" value={share(n)} note={note(n)} />;
  }
  return (
    <StatCard
      label={data.intent === "enrolment" ? "Will apply" : "Interested"}
      value={`${data.interest_rate}%`}
      note={note(data.interested)}
    />
  );
}

/** Post-campaign results: reach, outcomes, sentiment and what callers said about the agent. */
export function CampaignResults({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getCampaignResultsAnalytics(campaignId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError("");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load results.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, version]);

  function refresh() {
    setLoading(true);
    setVersion((v) => v + 1);
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[15px] font-semibold">Results</span>
      <IconButton aria-label="Refresh results" disabled={loading} onClick={refresh} className="size-[30px]">
        <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
      </IconButton>
    </div>
  );

  if (loading && !data) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <div className="flex items-center gap-2 text-sm text-v-muted">
          <Spinner light={false} /> Loading results…
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <p className="text-sm text-v-danger">{error}</p>
      </section>
    );
  }

  if (!data || data.calls_attempted === 0) {
    return (
      <section className="flex flex-col gap-3">
        {header}
        <div className="flex flex-col items-center gap-1 rounded-v-md border border-dashed border-v-line bg-white p-8 text-center">
          <span className="text-sm font-semibold">No calls yet</span>
          <span className="text-xs font-light text-v-muted">Results appear here once the campaign places calls.</span>
        </div>
      </section>
    );
  }

  const engines = engineLine(data.analysis_engines);

  return (
    <section className="flex flex-col gap-4">
      {header}
      {error ? <p className="text-sm text-v-danger">{error}</p> : null}

      {data.synthetic_transcripts > 0 ? (
        <p className="flex items-start gap-2 rounded-v-md border border-v-warn-tint bg-v-warn-tint px-3.5 py-2.5 text-xs text-v-warn-ink">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          {data.synthetic_transcripts.toLocaleString()} {data.synthetic_transcripts === 1 ? "call" : "calls"} used
          made-up test transcripts from the mock provider, not real conversations.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Calls made"
          value={data.calls_attempted.toLocaleString()}
          note={`${data.contacts_processed.toLocaleString()} of ${data.contacts_total.toLocaleString()} contacts`}
        />
        <StatCard
          label="Answered"
          value={`${data.answer_rate}%`}
          note={`${data.calls_answered.toLocaleString()} calls`}
        />
        <StatCard
          label="Avg duration"
          value={formatDuration(data.avg_duration_seconds)}
          note={`${data.total_talk_minutes.toLocaleString()} min talk time`}
        />
        <HeadlineCard data={data} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-v-md border border-v-line bg-white p-4">
          <SectionLabel>Outcomes</SectionLabel>
          {data.outcomes.length === 0 ? (
            <p className="text-sm font-light text-v-muted">No calls analysed yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, data.outcomes.length * 34)}>
              <BarChart data={data.outcomes} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--v-line)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="label" width={112} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--v-soft)" }} />
                <Bar dataKey="count" name="Calls" fill="var(--v-accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="flex flex-col gap-5 rounded-v-md border border-v-line bg-white p-4">
          <div className="flex flex-col gap-3">
            <SectionLabel>Sentiment</SectionLabel>
            <SentimentSplit sentiments={data.sentiments} />
          </div>
          <div className="flex flex-col gap-2 border-t border-v-line pt-4">
            <SectionLabel>Agent feedback</SectionLabel>
            {data.feedback_themes.length === 0 ? (
              <p className="text-sm font-light text-v-muted">No feedback themes yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-v-hairline">
                {data.feedback_themes.map((t) => (
                  <li key={t.code} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                    <span className="font-light leading-relaxed">{t.text}</span>
                    <span className="shrink-0 tabular-nums text-v-muted">
                      {t.calls.toLocaleString()} {t.calls === 1 ? "call" : "calls"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {data.intent === "support" || data.intent === "utilisation" || (data.issues_reported ?? 0) > 0 ? (
        <ProblemResults data={data} />
      ) : null}

      {data.switched_paths && data.switched_paths.length > 0 ? <SwitchedPaths paths={data.switched_paths} /> : null}

      {data.survey ? <SurveyResults survey={data.survey} /> : null}

      <p className="text-xs font-light text-v-muted">
        {data.analysed_calls.toLocaleString()} of {data.calls_attempted.toLocaleString()} calls analysed
        {engines ? ` · ${engines}` : ""}
      </p>
    </section>
  );
}
