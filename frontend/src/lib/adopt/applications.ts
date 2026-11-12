import type { ApplicationDef, ApplicationId, Segment } from "./types";
import { grievance } from "./apps/grievance";
import { schemeDiscovery } from "./apps/scheme-discovery";
import { surveys } from "./apps/surveys";
import { formFilling } from "./apps/form-filling";
import { applicationSupport } from "./apps/application-support";
import { SEGMENTS } from "./icp";

export { LANGUAGES } from "./apps/common";

/** Order follows the ICP's list of five ready-to-deploy applications. */
export const APPLICATIONS: ApplicationDef[] = [
  grievance,
  schemeDiscovery,
  surveys,
  formFilling,
  applicationSupport,
];

export const APPLICATION_BY_ID = Object.fromEntries(
  APPLICATIONS.map((a) => [a.id, a]),
) as Record<ApplicationId, ApplicationDef>;

export function getApplication(id: string | null | undefined): ApplicationDef | undefined {
  return id ? APPLICATION_BY_ID[id as ApplicationId] : undefined;
}

export function applicationsForSegment(segmentId: string | undefined): ApplicationDef[] {
  const seg = SEGMENTS.find((s) => s.id === segmentId);
  if (!seg) return APPLICATIONS;
  return seg.applications.map((id) => APPLICATION_BY_ID[id]);
}

export function segmentsForApplication(id: ApplicationId): Segment[] {
  return SEGMENTS.filter((s) => s.applications.includes(id));
}
