import type { Metadata } from "next";
import { WorkspaceOverview } from "@/components/adopt/WorkspaceOverview";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return <WorkspaceOverview />;
}
