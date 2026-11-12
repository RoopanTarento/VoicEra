import type { Metadata } from "next";
import { KnowledgePage } from "@/components/adopt/KnowledgePage";

export const metadata: Metadata = { title: "Knowledge and systems" };

export default function Page() {
  return <KnowledgePage />;
}
