import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { AdvisorResult } from "@/components/adopt/advisor/AdvisorResult";

export const metadata: Metadata = { title: "Advisor recommendation" };

export default function ResultPage() {
  return (
    <Container>
      <AdvisorResult />
    </Container>
  );
}
