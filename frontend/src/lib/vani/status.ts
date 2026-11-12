import { STEPS, stepIndex, type PackageRecord } from "./types";

export type PkgState = "draft" | "submitted" | "approved";
export const stateOf = (p: PackageRecord): PkgState => p.quote?.state ?? "draft";
export const STATE_LABEL: Record<PkgState, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved" };
export const stepLabel = (p: PackageRecord) => STEPS[stepIndex(p.step)]?.label ?? "Requirements";
export const stepProgress = (p: PackageRecord) => Math.round(((Math.max(stepIndex(p.step), ...p.reached.map(stepIndex)) + 1) / STEPS.length) * 100);
export const returned = (p: PackageRecord) => p.quote?.state === "draft" && p.quote.events.some((e) => e.action === "returned" || e.action === "withdrawn") && p.quote.events[p.quote.events.length - 1].action !== "created";
