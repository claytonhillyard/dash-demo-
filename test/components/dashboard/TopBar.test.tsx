import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TopBar } from "@/components/dashboard/TopBar";

describe("TopBar", () => {
  it("shows AIYA branding and greeting, not the old wordmark", () => {
    render(<TopBar />);
    expect(screen.getAllByText(/AIYA/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Good Morning/i)).toBeInTheDocument();
    expect(screen.queryByText(/CHILLY\.AI/i)).not.toBeInTheDocument();
  });
});
