"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAdopt } from "@/lib/adopt/state";
import type { ApplicationId, PackageId } from "@/lib/adopt/types";

/** Starts the guided selection with a segment and/or application already chosen. */
export function PlanButton({
  segmentId,
  applicationId,
  label = "Plan this",
  variant = "primary",
}: {
  segmentId?: string;
  applicationId?: ApplicationId;
  label?: string;
  variant?: "primary" | "outline" | "dark";
}) {
  const router = useRouter();
  const { actions } = useAdopt();
  return (
    <Button
      variant={variant}
      onClick={() => {
        if (segmentId) actions.setAnswer("segmentId", segmentId);
        if (applicationId) {
          // Pick the objective that maps to this application so the question is already answered.
          const objective: Record<ApplicationId, string> = {
            grievance: "report",
            "scheme-discovery": "schemes",
            surveys: "survey",
            "form-filling": "form",
            "application-support": "application",
          };
          actions.setAnswer("objective", objective[applicationId]);
        }
        // Resume at the first unanswered question rather than the start.
        actions.resumeAtFirstUnanswered();
        router.push("/adopt/select");
      }}
    >
      {label}
      <ArrowRight className="size-3.5" strokeWidth={2.2} aria-hidden />
    </Button>
  );
}

/** Starts a workspace directly with a chosen application and package. */
export function StartWorkspaceButton({
  applicationId,
  packageId,
  label = "Open the workspace",
  variant = "primary",
}: {
  applicationId: ApplicationId;
  packageId: PackageId;
  label?: string;
  variant?: "primary" | "outline" | "dark";
}) {
  const router = useRouter();
  const { actions } = useAdopt();
  return (
    <Button
      variant={variant}
      onClick={() => {
        actions.startWorkspace(applicationId, packageId);
        router.push("/adopt/workspace");
      }}
    >
      {label}
      <ArrowRight className="size-3.5" strokeWidth={2.2} aria-hidden />
    </Button>
  );
}
