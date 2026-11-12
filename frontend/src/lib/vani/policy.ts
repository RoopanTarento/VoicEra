import { ACCESS_GROUPS, COMPONENT_BY_ID, HOSTING_OPTIONS, type Asr } from "./catalog";
import { langFit } from "./recommend";
import { PACKAGES } from "./catalog";
import type { Hosting, OpenItemRecord, Requirements, Selection } from "./types";

/**
 * Policy checks. Each one says what it checks, why it matters and how to clear it.
 * PASS needs nothing. CHECK needs a confirmation. OPEN needs a decision or missing input.
 */

export type CheckStatus = "pass" | "check" | "open";
export type ResolveKind = "notice" | "retention" | "support" | "dr" | "pii" | "recording" | "accept" | "none";

export interface PolicyCheck {
  id: string;
  title: string;
  status: CheckStatus;
  what: string;
  why: string;
  how: string;
  resolve: ResolveKind;
  /** The user's decision, if any. */
  record?: OpenItemRecord;
  /** Status after decisions: pass, or still needing attention. */
  effective: "pass" | "accepted" | "check" | "open";
}

const accessLabel = (id: string) => ACCESS_GROUPS.find((a) => a.id === id)?.label ?? id;

function raw(r: Requirements, h: Hosting, sel: Selection | null): Omit<PolicyCheck, "record" | "effective">[] {
  const out: Omit<PolicyCheck, "record" | "effective">[] = [];
  const hostLabel = HOSTING_OPTIONS.find((o) => o.id === h.kind)?.label ?? h.kind;
  const comps = sel ? [sel.asr, sel.llm, sel.tts, sel.telephony].map((id) => COMPONENT_BY_ID[id]) : [];
  const abroad = comps.filter((c) => c && !c.inCountry);

  // Data location
  if (!h.inCountry) {
    out.push({ id: "data-location", title: "Data location", status: "check", resolve: "accept", what: `Data may be processed outside India (${hostLabel}, ${h.region}).`, why: "Some departments must keep citizen data inside the country.", how: "Confirm that processing outside India is permitted, or turn on \"Data must stay in-country\" in Hosting & data." });
  } else if (abroad.length) {
    out.push({ id: "data-location", title: "Data location", status: "open", resolve: "none", what: `${abroad.length === 1 ? "A component runs" : `${abroad.length} components run`} outside India.`, why: "You asked that data stay in-country.", how: "Choose a component that runs in India on the Configure step." });
  } else {
    out.push({ id: "data-location", title: "Data location", status: "pass", resolve: "none", what: `Everything runs on ${hostLabel.toLowerCase()} in ${h.region}.`, why: "Data stays in India as required.", how: "Nothing to do." });
  }

  // PII redaction
  if (h.transcripts === "none") {
    out.push({ id: "pii-redaction", title: "PII detection and redaction", status: "pass", resolve: "none", what: "No transcripts are stored, so there is nothing to redact.", why: "Personal details are not kept after the call.", how: "Nothing to do." });
  } else if (h.pii.length === 0) {
    out.push({ id: "pii-redaction", title: "PII detection and redaction", status: "open", resolve: "pii", what: `Transcripts are stored (${h.transcripts === "full" ? "full" : "redacted"}), but no PII types are selected.`, why: "Phone numbers, names and ID numbers would be kept as spoken.", how: "Choose which details to detect and redact." });
  } else {
    const asr = sel ? (COMPONENT_BY_ID[sel.asr] as Asr) : null;
    const weak = sel && asr ? r.languages.filter((l) => asr.langs[l] !== "tested") : [];
    if (weak.length) {
      out.push({ id: "pii-redaction", title: "PII detection and redaction", status: "check", resolve: "accept", what: `Redaction is tested for most languages, but not for ${weak.length} of yours.`, why: "Spoken numbers and names are easier to miss in languages the system has not been tested on.", how: "Run a review of sample redacted transcripts, then confirm." });
    } else {
      out.push({ id: "pii-redaction", title: "PII detection and redaction", status: "pass", resolve: "none", what: `${h.pii.length} PII type${h.pii.length === 1 ? "" : "s"} detected and ${h.transcripts === "full" ? "flagged" : "redacted"} before storage.`, why: "Personal details are removed before anything is kept.", how: "Nothing to do." });
    }
  }

  // Caller notice
  out.push(h.callerNotice.trim()
    ? { id: "caller-notice", title: "Caller notice", status: "pass", resolve: "none", what: "A notice is read to callers at the start of every call.", why: "Callers should know they are speaking to an automated assistant.", how: "Nothing to do." }
    : { id: "caller-notice", title: "Caller notice", status: "open", resolve: "notice", what: "No caller notice has been written.", why: "Callers should be told that the call is handled by an assistant and may be recorded.", how: "Write the notice, or start from the sample text." });

  // Recording consent
  if (h.recording === "off") out.push({ id: "recording-consent", title: "Recording consent", status: "pass", resolve: "none", what: "Calls are not recorded.", why: "No audio is kept.", how: "Nothing to do." });
  else if (h.recording === "always" ) out.push({ id: "recording-consent", title: "Recording consent", status: "open", resolve: "recording", what: "Every call is recorded with no choice for the caller.", why: "Recording without consent may not be allowed for your service.", how: "Record only with consent, or accept the risk with a reason." });
  else out.push(h.callerNotice.trim()
    ? { id: "recording-consent", title: "Recording consent", status: "pass", resolve: "none", what: "Calls are recorded only when the caller agrees.", why: "Consent is asked in the caller notice.", how: "Nothing to do." }
    : { id: "recording-consent", title: "Recording consent", status: "check", resolve: "notice", what: "Recording needs consent, but the notice has not been written.", why: "Consent has to be asked before recording.", how: "Write the caller notice." });

  // Retention
  const keeps = (Object.entries(h.retention) as [string, Hosting["retention"][keyof Hosting["retention"]]][]).filter(([k, v]) => v.days !== null && (k !== "recordings" || h.recording !== "off") && (k !== "transcripts" || h.transcripts !== "none"));
  if (keeps.length === 0 || h.retentionConfirmedBy) out.push({ id: "retention", title: "Retention periods", status: "pass", resolve: "none", what: keeps.length ? `${keeps.length} retention period${keeps.length === 1 ? "" : "s"} confirmed by ${h.retentionConfirmedBy}.` : "Nothing is stored beyond the call.", why: "Data is deleted when it is no longer needed.", how: "Nothing to do." });
  else out.push({ id: "retention", title: "Retention periods", status: "check", resolve: "retention", what: `${keeps.length} retention period${keeps.length === 1 ? "" : "s"} set, not yet confirmed.`, why: "Retention is a legal decision. Someone accountable should confirm it.", how: "Confirm the periods against your records policy." });

  // Full transcript access
  if (h.transcripts === "full") {
    const who = accessLabel(h.retention.transcripts.access);
    out.push(h.retention.transcripts.access === "nobody" || h.retention.transcripts.access === "auditors"
      ? { id: "full-transcripts", title: "Full transcript access", status: "pass", resolve: "none", what: `Full transcripts are readable by ${who.toLowerCase()} only.`, why: "Unredacted text can contain personal details.", how: "Nothing to do." }
      : { id: "full-transcripts", title: "Full transcript access", status: "check", resolve: "accept", what: `Full, unredacted transcripts are readable by ${who.toLowerCase()}.`, why: "Unredacted text can contain personal details, so access should be narrow.", how: "Limit access to auditors, or confirm the wider access with a reason." });
  }

  // Availability and DR
  if (h.availability >= 99.9) out.push(h.disasterRecovery
    ? { id: "disaster-recovery", title: "Disaster recovery", status: "pass", resolve: "none", what: `A recovery site is included for ${h.availability}% availability.`, why: "High availability needs a second site.", how: "Nothing to do." }
    : { id: "disaster-recovery", title: "Disaster recovery", status: "open", resolve: "dr", what: `${h.availability}% availability needs a recovery site, which is not included.`, why: "A single site cannot honestly promise this level.", how: "Add disaster recovery, or lower the availability target." });

  // Support model
  out.push(h.support === "unset"
    ? { id: "support-model", title: "Support model", status: "open", resolve: "support", what: "No support model has been chosen.", why: "The quote assumes business-hours support until you choose.", how: "Choose who answers when something breaks." }
    : { id: "support-model", title: "Support model", status: "pass", resolve: "none", what: "A support model is chosen.", why: "Someone is accountable when something breaks.", how: "Nothing to do." });

  // Dialects, code switching
  if (sel) {
    const asr = COMPONENT_BY_ID[sel.asr] as Asr;
    if (r.dialects && !asr.dialectsTested) out.push({ id: "dialects", title: "Dialect performance", status: "check", resolve: "accept", what: "Dialects matter to you, but the speech model has no dialect benchmark.", why: "Accuracy on regional speech may be lower than the headline numbers.", how: "Run a pilot on real calls, or confirm that you accept this for launch." });
    if (r.codeSwitching && !asr.codeSwitch) out.push({ id: "code-switching", title: "Mixed-language speech", status: "check", resolve: "accept", what: "Callers mix languages, but the speech model has no tested support for it.", why: "Switching mid-sentence is where recognition fails most often.", how: "Pilot with real calls, or confirm that you accept this for launch." });
    const pkg = PACKAGES.find((p) => p.selection.asr === sel.asr && p.selection.llm === sel.llm && p.selection.tts === sel.tts);
    for (const l of r.languages) {
      const f = langFit(pkg ?? PACKAGES[0], sel, l);
      if (f.level === "partial") out.push({ id: `bench-${l}`, title: `${f.name} benchmark`, status: "check", resolve: "accept", what: `${f.name} is supported but not benchmarked end to end on this stack.`, why: "Parts are tested on their own, not together.", how: "Pilot on real calls, or confirm that you accept this for launch." });
    }
  }
  return out;
}

export function policyChecks(r: Requirements, h: Hosting, sel: Selection | null, items: Record<string, OpenItemRecord> = {}): PolicyCheck[] {
  return raw(r, h, sel).map((c) => {
    const record = items[c.id];
    const effective: PolicyCheck["effective"] = c.status === "pass" ? "pass" : record && record.state !== "open" ? "accepted" : c.status;
    return { ...c, record, effective };
  });
}

export const unresolvedChecks = (checks: PolicyCheck[]) => checks.filter((c) => c.effective === "check" || c.effective === "open");
export const policySummary = (checks: PolicyCheck[]) => ({
  pass: checks.filter((c) => c.effective === "pass").length,
  accepted: checks.filter((c) => c.effective === "accepted").length,
  check: checks.filter((c) => c.effective === "check").length,
  open: checks.filter((c) => c.effective === "open").length,
  total: checks.length,
});
