"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SecureVault } from "@/components/secure/SecureVault";
import { useToast } from "@/components/ui/useToast";
import { RequirePermission } from "@/components/PermissionsProvider";

function SecureVaultPageInner() {
  const { notify, toastNode } = useToast();
  const searchParams = useSearchParams();

  return (
    <>
      <SecureVault onNotify={notify} initialBatch={searchParams.get("batch")} />
      {toastNode}
    </>
  );
}

export default function SecureVaultPage() {
  return (
    <main className="flex w-full flex-col gap-6">
      <RequirePermission permission="contacts:read" what="browse the contact vault">
        <Suspense fallback={null}>
          <SecureVaultPageInner />
        </Suspense>
      </RequirePermission>
    </main>
  );
}
