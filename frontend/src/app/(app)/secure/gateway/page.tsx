"use client";

import { SecureGateway } from "@/components/secure/SecureGateway";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureGatewayPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="gateway:read" what="view the secure gateway">
        <SecureGateway onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
