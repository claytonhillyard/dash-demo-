import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CustomersTable, type CustomerRowView } from "@/components/customers/CustomersTable";

function cust(overrides: Partial<CustomerRowView> = {}): CustomerRowView {
  return {
    id: 1,
    name: "Alice",
    businessName: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    externalRef: null,
    firstSeenAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    health: { score: 82, band: "healthy" },
    ...overrides,
  };
}

describe("CustomersTable", () => {
  it("renders the empty state when the customer list is empty", () => {
    render(<CustomersTable customers={[]} />);
    expect(screen.getByText(/no customers yet/i)).toBeInTheDocument();
    // Empty state links to /customers/new
    const cta = screen.getByRole("link", { name: /add your first customer/i });
    expect(cta).toHaveAttribute("href", "/customers/new");
  });

  it("renders one row per customer with the name as a link to /customers/[id]/edit", () => {
    const { container } = render(
      <CustomersTable
        customers={[
          cust({ id: 11, name: "Priya Mehta", businessName: "Mehta Diamonds" }),
          cust({ id: 12, name: "Anita Sharma", email: "anita@example.com" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId(/^customer-row-/);
    expect(rows).toHaveLength(2);

    const mehtaLink = screen.getByRole("link", { name: /edit customer priya mehta/i });
    expect(mehtaLink).toHaveAttribute("href", "/customers/11/edit");

    const sharmaLink = screen.getByRole("link", { name: /edit customer anita sharma/i });
    expect(sharmaLink).toHaveAttribute("href", "/customers/12/edit");

    expect(within(rows[0]).getByText("Mehta Diamonds")).toBeInTheDocument();
    expect(within(rows[1]).getByText("anita@example.com")).toBeInTheDocument();

    // One HealthBadge per row
    expect(container.querySelectorAll("[data-health-band]")).toHaveLength(2);
  });

  it("renders an em-dash for empty optional fields (matches DealList convention)", () => {
    const { container } = render(
      <CustomersTable
        customers={[
          cust({ id: 13, name: "Walk-in", businessName: null, email: null, phone: null }),
        ]}
      />,
    );
    // Three dashes — businessName, email, phone
    const dashes = container.querySelectorAll(".text-text\\/30");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });

  it("search form submits via GET to /customers and pre-fills with the current query", () => {
    render(<CustomersTable customers={[]} searchQuery="mehta" />);
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/customers");
    const input = screen.getByLabelText(/search customers/i) as HTMLInputElement;
    expect(input.name).toBe("q");
    expect(input.defaultValue).toBe("mehta");
  });

  it("shows a Clear link only when a search query is active", () => {
    const { rerender } = render(<CustomersTable customers={[]} />);
    expect(screen.queryByRole("link", { name: /^clear$/i })).toBeNull();
    rerender(<CustomersTable customers={[]} searchQuery="x" />);
    const clear = screen.getByRole("link", { name: /^clear$/i });
    expect(clear).toHaveAttribute("href", "/customers");
  });
});
