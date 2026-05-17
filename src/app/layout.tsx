import "./globals.css";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Orbitron } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const orbitron = Orbitron({ subsets: ["latin"], variable: "--font-display" });

export const metadata = { title: "CEO Command Center" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} ${orbitron.variable}`}>
      <body>{children}</body>
    </html>
  );
}
