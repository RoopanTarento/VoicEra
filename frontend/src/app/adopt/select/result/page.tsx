import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { Result } from "@/components/adopt/Result";

export const metadata: Metadata = { title: "Your recommendation" };

export default function ResultPage() {
  return (
    <Container>
      <Result />
    </Container>
  );
}
