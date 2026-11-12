"use client";

import { SecureAudit } from "@/components/secure/SecureAudit";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureAuditPage() {
  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="audit:read" what="view the security audit trail">
        <SecureAudit />
      </RequirePermission>
    </main>
  );
}
