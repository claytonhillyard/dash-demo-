"use client";
import type { ReactNode } from "react";
import { useQuotesPoll } from "@/hooks/useQuotesPoll";

export function QuotesProvider({ children }: { children: ReactNode }) {
  useQuotesPoll();
  return <>{children}</>;
}
