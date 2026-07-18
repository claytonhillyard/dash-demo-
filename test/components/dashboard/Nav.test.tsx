import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// NavItem (slice 22 review fix) calls usePathname() to compute active state.
// Default to "/" so the "Dashboard is active" assertion below continues to
// pass — Dashboard's href is "/" which equals pathname.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

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
  it("links Activity to /activity (slice 24c)", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Activity" });
    expect(link).toHaveAttribute("href", "/activity");
  });
  it("links Watchlists to /watchlists (slice 25)", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Watchlists" });
    expect(link).toHaveAttribute("href", "/watchlists");
  });
  it("links Invoices to /invoices (slice 27)", () => {
    render(<Nav />);
    const link = screen.getByRole("link", { name: "Invoices" });
    expect(link).toHaveAttribute("href", "/invoices");
  });
});
