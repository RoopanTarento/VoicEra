import type { Metadata } from "next";
import { TestPage } from "@/components/adopt/TestPage";

export const metadata: Metadata = { title: "Conversation testing" };

export default function Page() {
  return <TestPage />;
}
