"use client";

import { SecureOverview } from "@/components/secure/SecureOverview";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureOverviewPage() {
  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="security:read" what="view VoicEra Secure">
        <SecureOverview />
      </RequirePermission>
    </main>
  );
}
