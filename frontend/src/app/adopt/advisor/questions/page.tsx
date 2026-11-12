import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { Wizard } from "@/components/adopt/advisor/Wizard";

export const metadata: Metadata = { title: "Advisor questions" };

export default function QuestionsPage() {
  return (
    <Container>
      <Wizard />
    </Container>
  );
}
