import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Nav } from "@/components/dashboard/Nav";

describe("Nav", () => {
  it("lists the AIYA business sections", () => {
    render(<Nav />);
    for (const label of ["Dashboard", "TradeNet Exchange", "Inventory", "Diamonds",
      "Gold & Metals", "Crypto Wallet", "Converter Hub", "Settings"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
  it("marks Dashboard as the active section", () => {
    render(<Nav />);
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-current", "page");
  });
  it("links the Inventory section to /inventory", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Inventory" });
    expect(link).toHaveAttribute("href", "/inventory");
  });
  it("links Orders & Deals to /deals", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Orders & Deals" });
    expect(link).toHaveAttribute("href", "/deals");
  });
  it("links Customers to /customers (slice 22)", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Customers" });
    expect(link).toHaveAttribute("href", "/customers");
  });
});
