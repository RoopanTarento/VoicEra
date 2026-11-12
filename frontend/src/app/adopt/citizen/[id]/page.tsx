import type { Metadata } from "next";
import { Container } from "@/components/adopt/ui";
import { CitizenJourney } from "@/components/adopt/CitizenJourney";
import { APPLICATIONS } from "@/lib/adopt/applications";

export function generateStaticParams() {
  return APPLICATIONS.map((a) => ({ id: a.id }));
}

export const metadata: Metadata = { title: "Citizen view" };

export default async function CitizenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Container>
      <CitizenJourney id={id} />
    </Container>
  );
}
