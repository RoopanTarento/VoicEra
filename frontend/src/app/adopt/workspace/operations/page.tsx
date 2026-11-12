import type { Metadata } from "next";
import { OperationsPage } from "@/components/adopt/OperationsPage";

export const metadata: Metadata = { title: "Operations" };

export default function Page() {
  return <OperationsPage />;
}
