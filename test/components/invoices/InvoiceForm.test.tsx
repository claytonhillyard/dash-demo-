import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import type { InvoiceDetail } from "@/db/invoices";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/watchlists/WatchToggle.test.tsx's indirection
// pattern: top-level trackable mocks, module factory just forwards to them.
const createInvoice = vi.fn();
const updateInvoice = vi.fn();
vi.mock("@/lib/invoices/actions", () => ({
  createInvoice: (...args: unknown[]) => createInvoice(...args),
  updateInvoice: (...args: unknown[]) => updateInvoice(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  createInvoice.mockReset();
  updateInvoice.mockReset();
});

const CUSTOMERS = [
  { id: 2201, name: "Priya Mehta" },
  { id: 2204, name: "Yuki Tanaka" },
];

function existingInvoice(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: 9301,
    customerId: 2201,
    invoiceNumber: "INV-2026-0003",
    status: "draft",
    billTo: { name: "Priya Mehta" },
    issueDate: null,
    dueDate: "2026-08-15",
    currency: "USD",
    subtotalCents: 2234,
    taxRateBps: 825,
    taxCents: 184,
    totalCents: 2418,
    notes: "Deliver to the Mumbai showroom.",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z"),
    sentAt: null,
    sentTo: null,
    items: [
      {
        id: 9401,
        position: 0,
        description: "18K Gold Ring Setting",
        quantity: 1,
        unitPriceCents: 1234,
        lineTotalCents: 1234,
      },
      {
        id: 9402,
        position: 1,
        description: "Ring sizing",
        quantity: 2,
        unitPriceCents: 500,
        lineTotalCents: 1000,
      },
    ],
    payments: [],
    paidCents: 0,
    balanceCents: 2418,
    ...over,
  };
}

describe("InvoiceForm — create mode", () => {
  it("renders one empty line-item row and lists the customer options", () => {
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    expect(screen.getAllByLabelText(/description/i)).toHaveLength(1);

    const select = screen.getByLabelText("customer") as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.options[0].textContent).toBe("Priya Mehta");
    expect(select.options[1].textContent).toBe("Yuki Tanaka");
    expect(select.value).toBe("2201"); // defaults to the first customer

    expect(screen.getByRole("button", { name: /create invoice/i })).toBeInTheDocument();
  });

  it("Add item appends a new empty row", () => {
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    expect(screen.getAllByLabelText(/description/i)).toHaveLength(2);
  });

  it("disables Remove when only one row remains", () => {
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    expect(screen.getByLabelText(/remove line 1/i)).toBeDisabled();
  });

  it("keeps the remaining rows' values stable when the middle row is removed (keyed, not index)", () => {
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    const descriptions = screen.getAllByLabelText(/description/i);
    expect(descriptions).toHaveLength(3);
    fireEvent.change(descriptions[0], { target: { value: "Row A" } });
    fireEvent.change(descriptions[1], { target: { value: "Row B" } });
    fireEvent.change(descriptions[2], { target: { value: "Row C" } });

    // Remove the MIDDLE row (Row B).
    fireEvent.click(screen.getByLabelText(/remove line 2/i));

    const remaining = screen.getAllByLabelText(/description/i) as HTMLInputElement[];
    expect(remaining).toHaveLength(2);
    expect(remaining[0].value).toBe("Row A");
    expect(remaining[1].value).toBe("Row C");
  });

  it("recomputes live totals when quantity/price change (2 x $10.00 + 0% -> $20.00)", () => {
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    fireEvent.change(screen.getByLabelText(/line 1 quantity/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/line 1 unit price/i), { target: { value: "10.00" } });

    expect(screen.getByTestId("line-total-0")).toHaveTextContent("$20.00");
    expect(screen.getByTestId("invoice-subtotal")).toHaveTextContent("$20.00");
    expect(screen.getByTestId("invoice-tax")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$20.00");
  });

  it("converts percent->bps and dollars->cents at submit", async () => {
    createInvoice.mockResolvedValueOnce({ ok: true, id: 42 });
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);

    fireEvent.change(screen.getByLabelText(/line 1 description/i), {
      target: { value: "  Diamond ring  " },
    });
    fireEvent.change(screen.getByLabelText(/line 1 quantity/i), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/line 1 unit price/i), { target: { value: "1234.56" } });
    fireEvent.change(screen.getByLabelText(/tax rate/i), { target: { value: "8.25" } });

    fireEvent.click(screen.getByRole("button", { name: /create invoice/i }));

    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    const payload = createInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.customerId).toBe(2201);
    expect(payload.taxRateBps).toBe(825);
    const items = payload.items as Array<Record<string, unknown>>;
    expect(items[0].description).toBe("Diamond ring");
    expect(items[0].quantity).toBe(3);
    expect(items[0].unitPriceCents).toBe(123456);
    expect(payload.id).toBeUndefined();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/invoices"));
  });

  it("omits invoiceNumber from the payload when left blank", async () => {
    createInvoice.mockResolvedValueOnce({ ok: true, id: 1 });
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    fireEvent.click(screen.getByRole("button", { name: /create invoice/i }));

    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    expect(createInvoice.mock.calls[0][0].invoiceNumber).toBeUndefined();
  });

  it("includes a typed invoiceNumber in the payload", async () => {
    createInvoice.mockResolvedValueOnce({ ok: true, id: 1 });
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    expect(screen.getByLabelText(/invoice number/i)).toHaveAttribute(
      "placeholder",
      "auto (INV-YYYY-NNNN)",
    );
    fireEvent.change(screen.getByLabelText(/invoice number/i), {
      target: { value: "INV-2026-9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create invoice/i }));

    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    expect(createInvoice.mock.calls[0][0].invoiceNumber).toBe("INV-2026-9999");
  });

  it("renders the action's error message under role=alert and does not navigate", async () => {
    createInvoice.mockResolvedValueOnce({ ok: false, error: "Forbidden" });
    render(<InvoiceForm mode="create" customers={CUSTOMERS} />);
    fireEvent.click(screen.getByRole("button", { name: /create invoice/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/forbidden/i);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("InvoiceForm — edit mode", () => {
  it("prefills fields and line items from the invoice (dollars shown as decimal strings)", () => {
    render(<InvoiceForm mode="edit" invoice={existingInvoice()} customers={CUSTOMERS} />);

    expect((screen.getByLabelText("customer") as HTMLSelectElement).value).toBe("2201");
    expect((screen.getByLabelText(/due date/i) as HTMLInputElement).value).toBe("2026-08-15");
    expect((screen.getByLabelText(/tax rate/i) as HTMLInputElement).value).toBe("8.25");
    expect((screen.getByLabelText(/invoice number/i) as HTMLInputElement).value).toBe(
      "INV-2026-0003",
    );
    expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe(
      "Deliver to the Mumbai showroom.",
    );

    const descriptions = screen.getAllByLabelText(/description/i) as HTMLInputElement[];
    expect(descriptions).toHaveLength(2);
    expect(descriptions[0].value).toBe("18K Gold Ring Setting");
    expect(descriptions[1].value).toBe("Ring sizing");

    const quantities = screen.getAllByLabelText(/quantity/i) as HTMLInputElement[];
    expect(quantities[0].value).toBe("1");
    expect(quantities[1].value).toBe("2");

    const prices = screen.getAllByLabelText(/unit price/i) as HTMLInputElement[];
    expect(prices[0].value).toBe("12.34");
    expect(prices[1].value).toBe("5.00");

    expect(screen.getByTestId("invoice-total")).toHaveTextContent("$24.18");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });

  it("submits updateInvoice with the existing id and refreshes instead of navigating", async () => {
    updateInvoice.mockResolvedValueOnce({ ok: true });
    render(<InvoiceForm mode="edit" invoice={existingInvoice()} customers={CUSTOMERS} />);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(1));
    const payload = updateInvoice.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe(9301);
    expect(payload.customerId).toBe(2201);

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(createInvoice).not.toHaveBeenCalled();
  });

  it("renders the action's error message under role=alert on update failure", async () => {
    updateInvoice.mockResolvedValueOnce({ ok: false, error: "Server error" });
    render(<InvoiceForm mode="edit" invoice={existingInvoice()} customers={CUSTOMERS} />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/server error/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
