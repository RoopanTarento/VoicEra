import type { Metadata } from "next";
import { DeployPage } from "@/components/adopt/DeployPage";

export const metadata: Metadata = { title: "Deployment centre" };

export default function Page() {
  return <DeployPage />;
}
