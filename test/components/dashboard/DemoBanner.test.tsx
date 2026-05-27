import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/dashboard/DemoBanner";

afterEach(() => vi.unstubAllEnvs());

describe("DemoBanner", () => {
  it("renders nothing when not in demo mode", () => {
    const { container } = render(<DemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders the demo strip in demo mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    render(<DemoBanner />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/simulated data/i)).toBeInTheDocument();
  });
});
