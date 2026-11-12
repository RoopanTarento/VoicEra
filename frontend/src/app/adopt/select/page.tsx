import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { Selection } from "@/components/adopt/Selection";

export const metadata: Metadata = { title: "Find your fit" };

export default function SelectPage() {
  return (
    <Container>
      <Selection />
    </Container>
  );
}
