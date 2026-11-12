import { Suspense } from "react";
import { AuthProvider } from "@/components/AuthProvider";
import { AppSidebar } from "@/components/AppSidebar";
import { WalkthroughProvider } from "@/components/walkthrough";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { DemoBanner } from "@/components/DemoBanner";
import { AdopterStatusBanner, PermissionsProvider } from "@/components/PermissionsProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <WalkthroughProvider>
          <CopilotProvider>
            <DemoBanner />
            <AdopterStatusBanner />
            <div className="flex min-h-screen bg-v-bg">
              <div className="sticky top-0 h-screen shrink-0">
                <Suspense fallback={<div className="h-full w-16 border-r border-v-line bg-v-panel" />}>
                  <AppSidebar />
                </Suspense>
              </div>
              <main className="min-w-0 flex-1 px-[34px] py-[30px]">{children}</main>
            </div>
          </CopilotProvider>
        </WalkthroughProvider>
      </PermissionsProvider>
    </AuthProvider>
  );
}
