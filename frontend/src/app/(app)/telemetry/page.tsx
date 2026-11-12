"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Telemetry } from "@/components/dashboard/Telemetry";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

function TelemetryPageInner() {
  const { notify, toastNode } = useToast();
  const searchParams = useSearchParams();
  const callId = searchParams.get("call");

  return (
    <>
      <Telemetry onNotify={notify} initialCallId={callId} />
      {toastNode}
    </>
  );
}

export default function TelemetryPage() {
  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="telemetry:read" what="view call telemetry">
        <Suspense fallback={null}>
          <TelemetryPageInner />
        </Suspense>
      </RequirePermission>
    </main>
  );
}
