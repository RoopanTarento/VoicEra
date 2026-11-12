import type { Metadata } from "next";
import { ReadinessPage } from "@/components/adopt/ReadinessPage";

export const metadata: Metadata = { title: "Readiness" };

export default function Page() {
  return <ReadinessPage />;
}
