import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthBadge } from "@/components/customers/HealthBadge";
import type { HealthBand } from "@/lib/customers/healthScore";

describe("HealthBadge", () => {
  const cases: { band: HealthBand; dotClass: string; label: string }[] = [
    { band: "healthy", dotClass: "bg-emerald-400", label: "Healthy" },
    { band: "watch", dotClass: "bg-amber-300", label: "Watch" },
    { band: "at_risk", dotClass: "bg-rose-400", label: "At risk" },
  ];

  it.each(cases)(
    "renders the $band band with dot color, score text, and title",
    ({ band, dotClass, label }) => {
      const { container } = render(<HealthBadge score={82} band={band} />);

      const badge = container.querySelector(`[data-health-band="${band}"]`);
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("title", label);

      const dot = badge!.querySelector("span");
      expect(dot).toHaveClass(dotClass);

      expect(screen.getByText("82")).toBeInTheDocument();
    },
  );
});
