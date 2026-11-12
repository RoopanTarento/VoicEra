import { PLATINUM } from "./source";

/**
 * Cost estimate from the documented commercial terms only:
 *   one-time setup Rs. 50,000
 *   Rs. 500 per phone number requested
 *   open-source models Rs. 0.50 a minute, end to end including telephony
 *   proprietary models: depends on the model, pricing table not supplied
 * No tax, rental, recurring fee or other charge is added, because none is documented.
 *
 * Money is held in paise (integers) so the arithmetic is exact.
 */

export type ModelCategory = "open" | "proprietary" | "unknown";

export interface CostInput {
  numbers: number | null;
  minutes: number | null;
  /** True when the person typed a planning figure rather than a known one. */
  minutesIsAssumption?: boolean;
  category: ModelCategory;
}

export interface CostLine {
  id: string;
  label: string;
  /** Rupees. Null when it cannot be calculated. */
  amount: number | null;
  basis: string;
  kind: "one-time" | "usage";
  status: "known" | "unresolved";
}

export interface CostResult {
  valid: boolean;
  errors: { numbers?: string; minutes?: string };
  lines: CostLine[];
  oneTimeTotal: number | null;
  usageTotal: number | null;
  /** Known total. When usage is unresolved this is the one-time total only. */
  knownTotal: number | null;
  totalIsComplete: boolean;
  totalLabel: string;
  /** If the open-source rate applied. Only a what-if when the category is not open-source. */
  ifOpenSourceUsage: number | null;
  unresolvedNote: string | null;
  assumptions: string[];
}

const C = PLATINUM.commercial;
const SETUP_PAISE = C.oneTimeSetupInr.value * 100;
const NUMBER_PAISE = C.perNumberInr.value * 100;
const OPEN_PAISE_PER_MIN = Math.round(C.openSourcePerMinuteInr.value * 100);

export function validateCostInput(i: CostInput): CostResult["errors"] {
  const e: CostResult["errors"] = {};
  if (i.numbers !== null) {
    if (!Number.isFinite(i.numbers) || i.numbers < 0) e.numbers = "Enter zero or more numbers.";
    else if (!Number.isInteger(i.numbers)) e.numbers = "Enter a whole number of phone numbers.";
    else if (i.numbers > 10000) e.numbers = "Enter 10,000 or fewer.";
  }
  if (i.minutes !== null) {
    if (!Number.isFinite(i.minutes) || i.minutes < 0) e.minutes = "Enter zero or more minutes.";
    else if (i.minutes > 1e9) e.minutes = "That is more than we can calculate.";
  }
  return e;
}

const rupees = (paise: number) => paise / 100;

export function inr(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "Not calculated";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function calculateCost(i: CostInput): CostResult {
  const errors = validateCostInput(i);
  const valid = Object.keys(errors).length === 0;
  const assumptions: string[] = [
    "Only the documented charges are included. No tax, number rental, recurring fee or charge for extra integrations is added, because none is in the package document.",
    "Billing is through Bhashini.",
  ];
  const lines: CostLine[] = [];

  lines.push({
    id: "setup",
    label: "One-time setup",
    amount: rupees(SETUP_PAISE),
    basis: "Rs. 50,000, once",
    kind: "one-time",
    status: "known",
  });

  let numbersPaise: number | null = null;
  if (valid && i.numbers !== null) numbersPaise = i.numbers * NUMBER_PAISE;
  lines.push({
    id: "numbers",
    label: "Phone numbers",
    amount: numbersPaise === null ? null : rupees(numbersPaise),
    basis: i.numbers === null ? "Rs. 500 for each number requested. Enter how many." : `${i.numbers} × Rs. 500`,
    kind: "one-time",
    status: numbersPaise === null ? "unresolved" : "known",
  });

  let usagePaise: number | null = null;
  let usageStatus: CostLine["status"] = "unresolved";
  let usageBasis: string;
  let unresolvedNote: string | null = null;
  let ifOpen: number | null = null;

  if (valid && i.minutes !== null) ifOpen = rupees(Math.round(i.minutes * OPEN_PAISE_PER_MIN));

  if (i.category === "open") {
    if (valid && i.minutes !== null) {
      usagePaise = Math.round(i.minutes * OPEN_PAISE_PER_MIN);
      usageStatus = "known";
      usageBasis = `${i.minutes.toLocaleString("en-IN")} minutes × Rs. 0.50`;
    } else {
      usageBasis = "Rs. 0.50 a minute. Enter your expected billable minutes.";
      unresolvedNote = "Enter expected billable minutes to see the usage cost.";
    }
  } else if (i.category === "proprietary") {
    usageBasis = "Depends on the model chosen";
    unresolvedNote = "Usage cost requires model selection and confirmation of the applicable pricing.";
  } else {
    usageBasis = "Depends on whether open-source or proprietary models are used";
    unresolvedNote = "Choose the model type to see the usage cost. Open-source models are Rs. 0.50 a minute. Proprietary pricing has not been supplied.";
  }

  lines.push({
    id: "usage",
    label: "Calls, per minute",
    amount: usagePaise === null ? null : rupees(usagePaise),
    basis: usageBasis,
    kind: "usage",
    status: usageStatus,
  });

  if (i.minutesIsAssumption && i.minutes !== null) {
    assumptions.push(`The ${i.minutes.toLocaleString("en-IN")} minutes are a planning assumption, not a measured figure. Change them as soon as you know more.`);
  }

  const oneTimePaise = numbersPaise === null ? null : SETUP_PAISE + numbersPaise;
  const oneTimeKnownOnly = SETUP_PAISE + (numbersPaise ?? 0);
  const complete = valid && numbersPaise !== null && usagePaise !== null;
  const knownTotalPaise = complete ? oneTimeKnownOnly + (usagePaise as number) : oneTimeKnownOnly;

  return {
    valid,
    errors,
    lines,
    oneTimeTotal: oneTimePaise === null ? rupees(oneTimeKnownOnly) : rupees(oneTimePaise),
    usageTotal: usagePaise === null ? null : rupees(usagePaise),
    knownTotal: valid ? rupees(knownTotalPaise) : null,
    totalIsComplete: complete,
    totalLabel: complete
      ? "Indicative total"
      : numbersPaise === null
        ? "Known so far (setup only, numbers not entered)"
        : "Known so far (excludes usage)",
    ifOpenSourceUsage: i.category === "open" ? null : ifOpen,
    unresolvedNote,
    assumptions,
  };
}

/**
 * Starting values for the estimator, taken from the answers. Numbers is 1 only when the
 * person said citizens will call a new number from the package. Minutes are calls a month
 * times the average length, only when both were given. Nothing else is assumed.
 */
export function defaultCostInput(a: { values: Record<string, unknown> }): CostInput {
  const ns = a.values.numberSource;
  const calls = Number(a.values.callsPerMonth);
  const avg = Number(a.values.avgMinutes);
  const have = a.values.callsPerMonth !== undefined && a.values.avgMinutes !== undefined && Number.isFinite(calls) && Number.isFinite(avg);
  return {
    numbers: ns === "new" ? 1 : null,
    minutes: have ? Math.round(calls * avg * 100) / 100 : null,
    minutesIsAssumption: false,
    category: "unknown",
  };
}
