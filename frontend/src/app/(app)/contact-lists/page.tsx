"use client";

import { ContactLists } from "@/components/dashboard/ContactLists";
import { RequirePermission } from "@/components/PermissionsProvider";
import { useToast } from "@/components/ui/useToast";

export default function ContactListsPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="lists:read" what="see contact lists">
        <ContactLists onNotify={notify} />
      </RequirePermission>
      {toastNode}
    </main>
  );
}
