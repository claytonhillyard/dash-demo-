import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FormStatus } from "@/components/company/FormStatus";

describe("FormStatus — slice-1b behavior preserved", () => {
  it("renders nothing by default", () => {
    const { container } = render(<FormStatus />);
    expect(container.firstChild).toBeNull();
  });

  it("renders error with role=alert", () => {
    render(<FormStatus error="boom" />);
    const el = screen.getByRole("alert");
    expect(el.textContent).toBe("boom");
  });

  it("renders Saved. for ok=true", () => {
    render(<FormStatus ok />);
    expect(screen.getByText("Saved.")).toBeInTheDocument();
  });
});

describe("FormStatus — slice-5 duplicate branch", () => {
  it("renders the duplicate-week hint when duplicate=true", () => {
    render(<FormStatus duplicate />);
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
  });

  it("duplicate takes precedence over ok (the action returns both)", () => {
    render(<FormStatus ok duplicate />);
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    // Should NOT also show the generic "Saved." copy.
    expect(() => screen.getByText("Saved.")).toThrow();
  });

  it("error still takes precedence over duplicate", () => {
    render(<FormStatus error="boom" duplicate />);
    expect(screen.getByRole("alert").textContent).toBe("boom");
  });
});
