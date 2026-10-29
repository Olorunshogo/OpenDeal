import type { SegmentOption, SelectOption, StepperStep, TimelineEntry } from "@/components/ui";

// === Types

export interface ColorToken {
  name: string;
  className: string;
  value: string;
  role: string;
}

export interface ColorGroup {
  title: string;
  tokens: ColorToken[];
}

export interface TypeSample {
  name: string;
  className: string;
  sample: string;
}

// === Tokens

export const COLOR_GROUPS: ColorGroup[] = [
  {
    title: "Base",
    tokens: [
      { name: "canvas", className: "bg-canvas", value: "#07060A", role: "Page background" },
      { name: "canvas-deep", className: "bg-canvas-deep", value: "#040207", role: "Deepest black, backdrops" },
      { name: "surface", className: "bg-surface", value: "#0F0D14", role: "Solid cards, dialogs" },
      { name: "elevated", className: "bg-elevated", value: "#17141F", role: "Menus, tooltips" },
    ],
  },
  {
    title: "Brand",
    tokens: [
      { name: "brand", className: "bg-brand", value: "#F7931A", role: "Primary action, key figures" },
      { name: "brand-soft", className: "bg-brand-soft", value: "#FDBA74", role: "Hover, highlights" },
      { name: "violet", className: "bg-violet", value: "#8B5CF6", role: "Focus, secondary accent" },
      { name: "violet-deep", className: "bg-violet-deep", value: "#4B1DEF", role: "Glows, atmosphere" },
      { name: "violet-soft", className: "bg-violet-soft", value: "#DEB6FF", role: "Text on violet" },
    ],
  },
  {
    title: "Ink",
    tokens: [
      { name: "ink", className: "bg-ink", value: "#F5F3F7", role: "Primary text" },
      { name: "ink-muted", className: "bg-ink-muted", value: "#A39FA9", role: "Secondary text" },
      { name: "ink-subtle", className: "bg-ink-subtle", value: "#6E6A78", role: "Hints, metadata" },
    ],
  },
  {
    title: "Feedback",
    tokens: [
      { name: "ok", className: "bg-ok", value: "#34D399", role: "Success, settled" },
      { name: "warn", className: "bg-warn", value: "#FACC15", role: "Caution, degraded" },
      { name: "danger", className: "bg-danger", value: "#F43F5E", role: "Errors, destructive" },
    ],
  },
];

export const TYPE_SCALE: TypeSample[] = [
  { name: "Display XL · Sora", className: "font-display text-4xl font-semibold sm:text-6xl", sample: "Escrow neither side controls" },
  { name: "Display · Sora", className: "font-display text-3xl font-semibold sm:text-4xl", sample: "Used laptop, 50,000 sats" },
  { name: "Heading · Sora", className: "font-display text-lg font-semibold", sample: "Settlement PSBT" },
  { name: "Body · Figtree", className: "text-base text-ink-muted", sample: "Both parties sign the same canonical agreement before funding." },
  { name: "Small · Figtree", className: "text-sm text-ink-muted", sample: "Review outputs and fee before you sign." },
  { name: "Mono · JetBrains Mono", className: "font-mono text-xs", sample: "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080" },
];

// === Sample data

export const NETWORK_OPTIONS: SelectOption[] = [
  { value: "regtest", label: "Regtest", description: "Local chain, test coins" },
  { value: "testnet", label: "Testnet", description: "Public test network" },
  { value: "signet", label: "Signet", description: "Signed test network" },
  { value: "bitcoin", label: "Mainnet", description: "Real funds", disabled: true },
];

export const CONTACT_OPTIONS: SelectOption[] = [
  { value: "02a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", label: "Ada (buyer)", description: "02a1b2…7e8f90" },
  { value: "03f0e1d2c3b4a5968778695a4b3c2d1e0f0e1d2c3b4a5968778695a4b3c2d1e0f", label: "Tunde (buyer)", description: "03f0e1…2d1e0f" },
  { value: "02c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00", label: "Mira (mediator)", description: "02c0ff…ffee00" },
];

export type SettlementPurposeOption = "payout_seller" | "refund_buyer";

export const PURPOSE_OPTIONS: SegmentOption<SettlementPurposeOption>[] = [
  { value: "payout_seller", label: "Payout seller" },
  { value: "refund_buyer", label: "Refund buyer" },
];

export const LIFECYCLE_STEPS: StepperStep[] = [
  { id: "agree", label: "Agree", description: "Both sign the terms" },
  { id: "fund", label: "Fund", description: "Escrow confirmed" },
  { id: "deliver", label: "Deliver", description: "Shipped and accepted" },
  { id: "settle", label: "Settle", description: "2-of-3 PSBT broadcast" },
];

export const TIMELINE_SAMPLE: TimelineEntry[] = [
  { id: 1, title: "Deal created", meta: "Seller · 10:02", tone: "neutral" },
  { id: 2, title: "Agreement signed by both parties", meta: "Buyer · 10:05", tone: "violet" },
  { id: 3, title: "Escrow funded, 1 confirmation", meta: "Chain · 10:11", tone: "brand" },
  { id: 4, title: "Settled to the seller", meta: "Chain · 10:40", tone: "ok" },
];

export const SAMPLE_TXID: string = "4d3c2b1a0f9e8d7c6b5a49382716f5e4d3c2b1a0f9e8d7c6b5a49382716f5e4";

export const STATUS_SAMPLES: string[] = ["draft", "agreed", "funded", "shipped", "disputed", "settled", "refunded"];
