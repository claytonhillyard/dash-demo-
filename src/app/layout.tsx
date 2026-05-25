import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// Engraved luxury serif for the AIYA wordmark + display headings — a jewelry
// house reads as refined/serif, not techno-geometric.
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

export const metadata = { title: "AIYA Designs — Command Center" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
