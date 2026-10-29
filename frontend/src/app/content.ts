import {
  Eye,
  FileSignature,
  KeyRound,
  Lock,
  PackageCheck,
  ShieldAlert,
  ShieldQuestion,
  SplitSquareVertical,
  type LucideIcon,
} from "lucide-react";

// === Types

export interface HeroContent {
  badge: string;
  headline: string;
  highlight: string;
  body: string;
  primaryCta: { href: string; label: string };
  secondaryCta: { href: string; label: string };
}

export interface StatItem {
  value: number;
  from: number;
  suffix?: string;
  label: string;
}

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface AudienceItem {
  role: string;
  headline: string;
  body: string;
}

export interface SectionIntro {
  eyebrow: string;
  title: string;
}

export interface FinalCtaContent {
  title: string;
  body: string;
  primaryCta: { href: string; label: string };
  secondaryCta: { href: string; label: string };
}

// === Hero

export const HERO: HeroContent = {
  badge: "Bitcoin coordination · regtest experimental",
  headline: "Escrow that neither side",
  highlight: "controls alone.",
  body: "Signed deal agreements. 2-of-3 multisig escrow. The API coordinates the deal; it never holds your keys.",
  primaryCta: { href: "/deals/new", label: "Start a deal" },
  secondaryCta: { href: "/mediator", label: "Mediator desk" },
};

export const STATS: StatItem[] = [
  { value: 2, from: 0, suffix: " of 3", label: "signatures move the escrow" },
  { value: 0, from: 3, label: "keys held by the OpenDeal API" },
  { value: 1, from: 0, label: "canonical agreement both parties sign" },
];

// === Trust

export const TRUST_INTRO: SectionIntro = {
  eyebrow: "Why trust the escrow",
  title: "Nobody, including us, can move the coins alone.",
};

export const TRUST_POINTS: FeatureItem[] = [
  {
    icon: KeyRound,
    title: "Your keys, your signature",
    body: "Agreement signing and PSBT signing both happen with a local secp256k1 secret. It never touches the API.",
  },
  {
    icon: SplitSquareVertical,
    title: "2-of-3, enforced on-chain",
    body: "Buyer, seller, mediator. Any two of the three signatures move the escrow. One signature alone never can, and neither can the API.",
  },
  {
    icon: Eye,
    title: "Review before you sign",
    body: "The PSBT panel decodes outputs, destination, and fee before finalize is even enabled.",
  },
  {
    icon: ShieldAlert,
    title: "Honest about what's missing",
    body: "Regtest experimental. No external security review of the Bitcoin crate yet, and mainnet stays blocked until one exists.",
  },
];

// === How it works

export const STEPS_INTRO: SectionIntro = {
  eyebrow: "How it works",
  title: "Four steps. No step gives the API your keys.",
};

export const STEPS: FeatureItem[] = [
  {
    icon: FileSignature,
    title: "Agree",
    body: "Seller proposes title, amount, and a buyer and mediator pubkey. Both parties sign the same canonical agreement, and its hash becomes the deal's receipt chain.",
  },
  {
    icon: Lock,
    title: "Fund escrow",
    body: "The three pubkeys build a 2-of-3 P2WSH address off-chain. Funds move on-chain; the API coordinates state, it never holds a key.",
  },
  {
    icon: PackageCheck,
    title: "Deliver, then release",
    body: "Seller ships, buyer accepts. Either party proposes a settlement PSBT, which is reviewed line by line before anyone signs.",
  },
  {
    icon: ShieldQuestion,
    title: "Dispute, if needed",
    body: "A mediator's decision updates recommended payout. It still takes two of the three signatures to actually move the Bitcoin.",
  },
];

// === Audiences

export const AUDIENCE_INTRO: SectionIntro = {
  eyebrow: "Who it's for",
  title: "Three roles. Two signatures. One honest outcome.",
};

export const AUDIENCES: AudienceItem[] = [
  {
    role: "Seller",
    headline: "Get paid without trusting a platform",
    body: "Propose terms, get the buyer's signature, and ship once the escrow is funded and confirmed. Payout is a 2-of-3 settlement you can inspect before you sign.",
  },
  {
    role: "Buyer",
    headline: "Pay into escrow, not into a stranger",
    body: "Your funds sit in a 2-of-3 address until you accept delivery. If something goes wrong, a mediator can weigh in, but still can't move coins alone.",
  },
  {
    role: "Mediator",
    headline: "Decide the outcome, not the custody",
    body: "A mediator's ruling recommends release or refund. The actual Bitcoin still needs two real signatures. The role carries judgment, not unilateral power.",
  },
];

// === Final call to action

export const FINAL_CTA: FinalCtaContent = {
  title: "Start a deal where the agreement is the contract.",
  body: "Regtest experimental. Bring a buyer and a mediator pubkey, or open the mediator desk to see the other side of a dispute.",
  primaryCta: { href: "/deals/new", label: "Start a deal" },
  secondaryCta: { href: "/market", label: "Browse the market" },
};
