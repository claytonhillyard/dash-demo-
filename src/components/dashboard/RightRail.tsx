import type { ReactNode } from "react";
export function RightRail({ children }: { children?: ReactNode }) {
  return <aside className="w-64 shrink-0 space-y-3 bg-surface p-3">{children}</aside>;
}
