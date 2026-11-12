"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

function AddMemberRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // An invitation token carries over; a bare org link lands on the signup
    // page's "joining needs an invitation" notice.
    const params = new URLSearchParams();
    const invite = searchParams.get("invite");
    const org = searchParams.get("org");
    if (invite) params.set("invite", invite);
    else if (org) params.set("org", org);
    const qs = params.toString();
    router.replace(qs ? `/signup?${qs}` : "/signup");
  }, [router, searchParams]);

  return (
    <main className="flex min-h-screen w-full items-center justify-center">
      <Spinner />
    </main>
  );
}

/** Legacy invite links redirect to the signup page. */
export default function AddMemberPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen w-full items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <AddMemberRedirect />
    </Suspense>
  );
}
