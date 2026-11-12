import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { PocBuilder } from "@/components/adopt/advisor/PocBuilder";

export const metadata: Metadata = { title: "Scheme Discovery proof of concept" };

export default function PocPage() {
  return (
    <Container>
      <PocBuilder />
    </Container>
  );
}
