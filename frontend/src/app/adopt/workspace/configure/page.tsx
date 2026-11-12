import type { Metadata } from "next";
import { ConfigurePage } from "@/components/adopt/ConfigurePage";

export const metadata: Metadata = { title: "Service configuration" };

export default function Page() {
  return <ConfigurePage />;
}
