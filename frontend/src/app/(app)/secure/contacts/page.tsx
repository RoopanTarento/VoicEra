"use client";

import { SecureContacts } from "@/components/secure/SecureContacts";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

export default function SecureContactsPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="contacts:write" what="upload protected contacts">
        <SecureContacts onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
