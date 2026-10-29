"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

const AeroShards = dynamic(() => import("@/components/react-bits/AeroShards"), { ssr: false });

// === Hooks

const COMPACT_QUERY: string = "(max-width: 767px)";

function subscribeToNothing(): () => void {
  return () => {};
}

function subscribeToCompact(onChange: () => void): () => void {
  const query: MediaQueryList = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useWebGpuAvailable(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => "gpu" in navigator,
    () => false,
  );
}

function useCompactViewport(): boolean {
  return useSyncExternalStore(
    subscribeToCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}

// === Component

export function HeroBackdrop(): React.JSX.Element {
  const webGpu: boolean = useWebGpuAvailable();
  const compact: boolean = useCompactViewport();
  const [failed, setFailed] = useState<boolean>(false);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-1/4 right-[-10%] size-[42rem] rounded-full bg-violet-deep/30 blur-[120px]" />
      <div className="absolute top-1/3 right-1/4 size-[22rem] rounded-full bg-brand/15 blur-[110px]" />
      <div className="absolute -bottom-1/3 -left-1/4 size-[36rem] rounded-full bg-violet/10 blur-[120px]" />
      {webGpu && !failed ? (
        <AeroShards
          className="absolute inset-0"
          shardColor="#4B1DEF"
          accentColor="#F7931A"
          placement={compact ? "full" : "right"}
          material="glass"
          markers="plus"
          count={compact ? 520 : 1300}
          depthOfField={0.75}
          vignette={compact ? 0.45 : 0.3}
          glow={0.4}
          mouseInteraction={!compact}
          pulseOnClick
          holdToGather={false}
          dpr={compact ? 1.5 : 2}
          onError={() => setFailed(true)}
        />
      ) : null}
      <div className="absolute inset-0 bg-linear-to-r from-canvas via-canvas/75 to-transparent lg:via-canvas/40" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-canvas" />
    </div>
  );
}
