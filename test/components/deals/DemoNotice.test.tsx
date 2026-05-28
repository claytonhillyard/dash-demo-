import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoNotice } from "@/components/deals/DemoNotice";

describe("DemoNotice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("renders nothing when not in demo mode", () => {
    const { container } = render(<DemoNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the disabled-changes banner in demo mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    render(<DemoNotice />);
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
    expect(screen.getByText(/changes are disabled/i)).toBeInTheDocument();
  });
});
