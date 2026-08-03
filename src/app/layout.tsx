import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import { WebVitalsReporter } from "@/components/observability/WebVitalsReporter";

// Inter stays the UI face — deliberately. It is the strongest available
// typeface for dense tabular data, and swapping the body font of a 25-page
// data terminal buys character at the cost of metric shifts everywhere. The
// character comes from the display face + the numerics instead (C-9 audit).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// Engraved serif for the AIYA wordmark + display headings — a jewelry house
// reads refined/serif, not techno-geometric. Newsreader replaces Cormorant
// Garamond: Cormorant's hairline strokes visually disintegrate at the ~20px
// this is actually used at, while Newsreader holds its weight at UI sizes.
const display = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata = {
  title: "AIYA Designs — Command Center",
  description:
    "Operating dashboard for AIYA Designs: inventory, deals, customers, invoices, payments and cash position in one view.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <WebVitalsReporter />
        {children}
      </body>
    </html>
  );
}
