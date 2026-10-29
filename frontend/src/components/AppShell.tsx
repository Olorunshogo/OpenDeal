import { ApiStatusBanner } from "./ApiStatusBanner";
import { SiteHeader } from "./layout/SiteHeader";
import { SessionBar } from "./SessionBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-12">
        <ApiStatusBanner />
        {children}
      </main>
      <footer className="border-t border-line bg-canvas-deep/40 px-4 py-6 sm:px-6 lg:px-12">
        <SessionBar />
      </footer>
    </div>
  );
}
