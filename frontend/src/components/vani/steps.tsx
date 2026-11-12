"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { STEPS, type StepId } from "@/lib/vani/types";
import { Page } from "./page";
import { RequirementsStep } from "./step1";
import { HostingStep } from "./step2";
import { RecommendationStep } from "./step3";
import { ConfigureStep } from "./step4";
import { QuoteStep } from "./step5";
import { usePackage } from "./workspace";
import { Alert } from "./ui";

export function RedirectToStep() {
  const { pkg } = usePackage();
  const router = useRouter();
  useEffect(() => { router.replace(`/vani/app/packages/${pkg.id}/${pkg.step}`); }, [pkg.id, pkg.step, router]);
  return null;
}

export function StepRouter() {
  const { step } = useParams<{ step: string }>();
  const { pkg } = usePackage();
  const router = useRouter();
  const id = STEPS.find((s) => s.id === step)?.id as StepId | undefined;
  // A step is open once the one before it has been reached. Otherwise send the person to where they are.
  const idx = id ? STEPS.findIndex((s) => s.id === id) : -1;
  const allowed = idx === 0 || (idx > 0 && pkg.reached.includes(STEPS[idx - 1].id));
  useEffect(() => { if (id && !allowed) router.replace(`/vani/app/packages/${pkg.id}/${pkg.step}`); }, [id, allowed, pkg.id, pkg.step, router]);
  if (!id) return <Page><Alert tone="warn" title="That step doesn't exist">Use the steps at the top to move around.</Alert></Page>;
  if (!allowed) return null;
  return (
    <Page wide>
      {id === "requirements" && <RequirementsStep />}
      {id === "hosting" && <HostingStep />}
      {id === "recommendation" && <RecommendationStep />}
      {id === "configure" && <ConfigureStep />}
      {id === "quote" && <QuoteStep />}
    </Page>
  );
}
