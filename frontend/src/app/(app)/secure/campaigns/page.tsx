"use client";

import { SecureCampaigns } from "@/components/secure/SecureCampaigns";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureCampaignsPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="security:read" what="view secure campaigns">
        <SecureCampaigns onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
