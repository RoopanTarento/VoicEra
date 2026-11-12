"use client";

import { PlatformAdopters } from "@/components/platform/PlatformAdopters";
import { useToast } from "@/components/ui/useToast";

export default function PlatformAdoptersPage() {
  const { notify, toastNode } = useToast();

  return (
    <main className="flex w-full flex-col gap-6">
      <PlatformAdopters onNotify={notify} />
      {toastNode}
    </main>
  );
}
