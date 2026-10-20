import type { Metadata } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "OpenDeal",
    template: "%s · OpenDeal",
  },
  description:
    "Bitcoin-native commerce coordination with verifiable deals, 2-of-3 escrow, and no server keys.",
  applicationName: "OpenDeal",
  authors: [{ name: "OpenDeal" }],
  creator: "OpenDeal",
  keywords: [
    "OpenDeal",
    "Bitcoin",
    "multisig",
    "escrow",
    "peer-to-peer commerce",
    "Nostr",
  ],
  icons: {
    icon: [{ url: "/favicon_io/favicon.ico" }, { url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "OpenDeal",
    title: "OpenDeal",
    description:
      "Bitcoin-native commerce coordination with verifiable deals, 2-of-3 escrow, and no server keys.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenDeal",
    description:
      "Bitcoin-native commerce coordination with verifiable deals, 2-of-3 escrow, and no server keys.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrument.variable} ${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
