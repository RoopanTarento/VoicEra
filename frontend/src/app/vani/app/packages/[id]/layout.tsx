import { PackageWorkspace } from "@/components/vani/workspace";

export default function PackageLayout({ children }: { children: React.ReactNode }) {
  return <PackageWorkspace>{children}</PackageWorkspace>;
}
