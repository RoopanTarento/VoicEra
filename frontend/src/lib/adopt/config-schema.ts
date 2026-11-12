import type { ApplicationDef, ConfigField } from "./types";

export type FieldErrors = Record<string, string>;

export interface ValidationResult {
  errors: FieldErrors;
  /** Things that do not block saving but will show up in readiness. */
  warnings: { key: string; message: string }[];
  complete: boolean;
}

type Row = Record<string, unknown>;

const SENSITIVE = /aadhaar|aadhar|\bpan\b|passport|password|\botp\b|one[- ]time|\bpin number\b|card number|account number|cvv|bank/i;

export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function toTimeMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function validateField(f: ConfigField, v: unknown, errors: FieldErrors) {
  const label = f.label;
  switch (f.kind) {
    case "text":
    case "textarea": {
      const s = typeof v === "string" ? v.trim() : "";
      if (f.required && s === "") {
        errors[f.key] = `${label} is required.`;
        return;
      }
      if (s === "" && !f.pattern) return;
      if (f.minLength && s.length < f.minLength && s !== "") {
        errors[f.key] = `${label} should be at least ${f.minLength} characters.`;
        return;
      }
      if (f.maxLength && s.length > f.maxLength) {
        errors[f.key] = `${label} should be at most ${f.maxLength} characters.`;
        return;
      }
      if (f.pattern && !new RegExp(f.pattern.regex).test(s)) {
        errors[f.key] = f.pattern.message;
      }
      return;
    }
    case "languages":
    case "tags": {
      const arr = Array.isArray(v) ? v : [];
      const min = f.minTags ?? (f.required ? 1 : 0);
      if (arr.length < min) errors[f.key] = `Choose at least ${min}.`;
      return;
    }
    case "select": {
      if (isBlank(v)) {
        if (f.required) errors[f.key] = `${label}: choose an option.`;
        return;
      }
      if (f.options && !f.options.some((o) => o.value === v)) {
        errors[f.key] = `${label}: choose one of the listed options.`;
      }
      return;
    }
    case "number": {
      if (v === "" || v === undefined || v === null) {
        if (f.required) errors[f.key] = `${label} is required.`;
        return;
      }
      const n = Number(v);
      if (!Number.isFinite(n)) {
        errors[f.key] = `${label} must be a number.`;
        return;
      }
      if (f.min !== undefined && n < f.min) errors[f.key] = `${label} must be at least ${f.min}.`;
      else if (f.max !== undefined && n > f.max) errors[f.key] = `${label} must be at most ${f.max}.`;
      return;
    }
    case "time": {
      if (isBlank(v)) {
        if (f.required) errors[f.key] = `${label} is required.`;
        return;
      }
      if (toTimeMinutes(v) === null) errors[f.key] = `${label} must be a time such as 09:30.`;
      return;
    }
    case "date": {
      if (isBlank(v)) {
        if (f.required) errors[f.key] = `${label} is required.`;
        return;
      }
      const d = new Date(`${v}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        errors[f.key] = `${label} must be a valid date.`;
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) errors[f.key] = `${label} cannot be in the past.`;
      return;
    }
    case "rows": {
      const rows = Array.isArray(v) ? (v as Row[]) : [];
      const cols = f.columns ?? [];
      const nonEmpty = rows.filter((r) => cols.some((c) => !isBlank(r[c.key])));
      const min = f.minRows ?? (f.required ? 1 : 0);
      if (nonEmpty.length < min) {
        errors[f.key] = `Add at least ${min} ${min === 1 ? "row" : "rows"}.`;
      }
      rows.forEach((r, i) => {
        const touched = cols.some((c) => !isBlank(r[c.key]));
        if (!touched) return;
        cols.forEach((c) => {
          const cell = r[c.key];
          const optionalCol = c.kind === "select" || c.key === "rule";
          if (c.kind === "number") {
            const n = Number(cell);
            if (isBlank(cell) || !Number.isFinite(n) || n <= 0) {
              errors[`${f.key}.${i}.${c.key}`] = `${c.label} must be a number above zero.`;
            }
          } else if (!optionalCol && isBlank(cell)) {
            errors[`${f.key}.${i}.${c.key}`] = `${c.label} is required.`;
          }
        });
      });
      return;
    }
    case "toggle":
      return;
  }
}

export function validateConfig(app: ApplicationDef, config: Record<string, unknown>): ValidationResult {
  const errors: FieldErrors = {};
  const warnings: ValidationResult["warnings"] = [];

  for (const section of app.configSections) {
    for (const f of section.fields) validateField(f, config[f.key], errors);
  }

  // Time windows must make sense.
  const pairs: [string, string, string][] = [
    ["handoffStart", "handoffEnd", "Staff available from must be earlier than until."],
    ["callStart", "callEnd", "Do not call before must be earlier than do not call after."],
  ];
  for (const [a, b, msg] of pairs) {
    const x = toTimeMinutes(config[a]);
    const y = toTimeMinutes(config[b]);
    if (x !== null && y !== null && x >= y && !errors[b]) errors[b] = msg;
  }

  // Calls should not start before 07:00 or run after 21:00. A policy nudge, not a law.
  const cs = toTimeMinutes(config.callStart);
  const ce = toTimeMinutes(config.callEnd);
  if (cs !== null && cs < 7 * 60) warnings.push({ key: "callStart", message: "Calls before 07:00 are likely to be unwelcome. Check your calling-hours policy." });
  if (ce !== null && ce > 21 * 60) warnings.push({ key: "callEnd", message: "Calls after 21:00 are likely to be unwelcome. Check your calling-hours policy." });

  // Application-specific checks.
  if (app.id === "form-filling") {
    const fields = Array.isArray(config.fields) ? (config.fields as Row[]) : [];
    fields.forEach((r, i) => {
      if (typeof r.label === "string" && SENSITIVE.test(r.label)) {
        errors[`fields.${i}.label`] =
          "This looks like sensitive information such as an identity number, password or one-time code. The agent should not collect it by voice.";
      }
    });
    if (config.destination === "webhook" && isBlank(config.endpointUrl)) {
      errors.endpointUrl = "Enter the endpoint address, or choose 'Held for staff to review'.";
    }
    if (config.destination === "webhook") {
      warnings.push({ key: "destination", message: "Sending to an endpoint needs API calling, which is not yet available in the product." });
    }
  }
  if (app.id === "surveys") {
    if (config.consentBasis === "unsure") {
      warnings.push({ key: "consentBasis", message: "The basis for calling is not settled. Resolve this before any real calls." });
    }
    const qs = Array.isArray(config.questions) ? (config.questions as Row[]) : [];
    if (qs.length > 10) warnings.push({ key: "questions", message: "More than 10 questions is long for a phone call. Expect people to drop out." });
  }
  if (app.id === "application-support" && config.statusSource === "api") {
    warnings.push({ key: "statusSource", message: "Reading status from your system needs API calling, which is not yet available in the product." });
  }

  // Sample content still in place: rows left exactly as the defaults, or text marked "(sample)".
  for (const section of app.configSections) {
    for (const f of section.fields) {
      const val = config[f.key];
      const def = app.defaults[f.key];
      const untouchedRows =
        f.kind === "rows" && Array.isArray(def) && def.length > 0 && JSON.stringify(val) === JSON.stringify(def);
      const marked = /\(sample\)/i.test(JSON.stringify(val) ?? "");
      if (untouchedRows || marked) {
        warnings.push({
          key: f.key,
          message: `Sample entries are still in place in "${f.label}". Replace them with your own approved content.`,
        });
      }
    }
  }

  return { errors, warnings, complete: Object.keys(errors).length === 0 };
}

/** Removes entirely blank rows before saving. */
export function cleanConfig(app: ApplicationDef, config: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  for (const s of app.configSections) {
    for (const f of s.fields) {
      if (f.kind === "rows" && Array.isArray(next[f.key])) {
        const cols = f.columns ?? [];
        next[f.key] = (next[f.key] as Row[]).filter((r) => cols.some((c) => !isBlank(r[c.key])));
      }
      if (typeof next[f.key] === "string") next[f.key] = (next[f.key] as string).trim();
    }
  }
  return next;
}

/** Share of required fields that are valid, for progress displays. */
export function configProgress(app: ApplicationDef, config: Record<string, unknown>) {
  const { errors } = validateConfig(app, config);
  let total = 0;
  let failing = 0;
  for (const s of app.configSections) {
    for (const f of s.fields) {
      const needed = f.required || (f.minRows ?? 0) > 0 || (f.minTags ?? 0) > 0;
      if (!needed) continue;
      total += 1;
      if (Object.keys(errors).some((k) => k === f.key || k.startsWith(`${f.key}.`))) failing += 1;
    }
  }
  return { total, valid: total - failing };
}

export function sectionStatus(
  app: ApplicationDef,
  sectionId: string,
  config: Record<string, unknown>,
): "complete" | "incomplete" {
  const { errors } = validateConfig(app, config);
  const section = app.configSections.find((s) => s.id === sectionId);
  if (!section) return "incomplete";
  const bad = section.fields.some((f) =>
    Object.keys(errors).some((k) => k === f.key || k.startsWith(`${f.key}.`)),
  );
  return bad ? "incomplete" : "complete";
}
