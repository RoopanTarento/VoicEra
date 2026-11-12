"use client";

import { useAdopt } from "./state";
import { APPLICATION_BY_ID } from "./applications";
import { computeReadiness } from "./readiness";

/** The workspace's application and readiness, for pages that sit inside the workspace shell. */
export function useWorkspace() {
  const adopt = useAdopt();
  const ws = adopt.state.workspace;
  const app = ws.applicationId ? APPLICATION_BY_ID[ws.applicationId] : null;
  const readiness = app ? computeReadiness(app, ws, adopt.state.answers) : null;
  return { ...adopt, ws, app, readiness };
}
