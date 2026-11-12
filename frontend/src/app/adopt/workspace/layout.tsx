import { WorkspaceShell } from "@/components/adopt/WorkspaceShell";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
