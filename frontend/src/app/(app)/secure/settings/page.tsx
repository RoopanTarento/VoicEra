"use client";

import { SecureSettings } from "@/components/secure/SecureSettings";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureSettingsPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="security:read" what="view security settings">
        <SecureSettings onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
