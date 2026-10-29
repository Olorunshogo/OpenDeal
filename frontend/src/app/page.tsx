import { SiteHeader } from "@/components/layout/SiteHeader";
import { SessionBar } from "@/components/SessionBar";
import { AudienceSplit } from "@/components/home/AudienceSplit";
import { FinalCta } from "@/components/home/FinalCta";
import { Hero } from "@/components/home/Hero";
import { HowItWorks } from "@/components/home/HowItWorks";
import { TrustGrid } from "@/components/home/TrustGrid";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader transparent />
      <main className="flex flex-1 flex-col">
        <Hero />
        <TrustGrid />
        <HowItWorks />
        <AudienceSplit />
        <FinalCta />
      </main>
      <footer className="border-t border-line bg-canvas-deep/40 px-4 py-6 sm:px-6 lg:px-12">
        <SessionBar />
      </footer>
    </div>
  );
}
