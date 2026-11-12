"use client";

import { Integrations } from "@/components/dashboard/Integrations";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function IntegrationsPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="integrations:read" what="manage integrations">
        <Integrations onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
