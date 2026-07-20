import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PaymentsPanel } from "@/components/invoices/PaymentsPanel";
import { toUtcDay } from "@/lib/sentinel/capture";
import type { InvoiceStatus } from "@/db/invoices";
import type { PaymentRow } from "@/db/payments";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/invoices/SendInvoicePanel.test.tsx's indirection
// pattern: top-level trackable mocks, module factory just forwards to them.
const recordPayment = vi.fn();
const deletePayment = vi.fn();
vi.mock("@/lib/payments/actions", () => ({
  recordPayment: (...args: unknown[]) => recordPayment(...args),
  deletePayment: (...args: unknown[]) => deletePayment(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  recordPayment.mockReset();
  deletePayment.mockReset();
});

type PanelProps = {
  invoiceId: number;
  status: InvoiceStatus;
  payments: PaymentRow[];
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  currency: string;
};

function paymentRow(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 1,
    amountCents: 200_000,
    method: "card",
    receivedDate: "2026-07-10",
    note: null,
    createdAt: new Date("2026-07-10T12:00:00Z"),
    ...overrides,
  };
}

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    invoiceId: 9302,
    status: "issued",
    payments: [paymentRow()],
    totalCents: 500_000,
    paidCents: 200_000,
    balanceCents: 300_000,
    currency: "USD",
    ...overrides,
  };
}

/**
 * Mirrors test/components/customers/import/ImportWizard.test.tsx's
 * waitForEnabledCommitButton: useTransition's `isPending` isn't guaranteed
 * to flip back to `false` in the same commit React makes the state update
 * inside an async transition callback visible, so a click that lands on a
 * still-disabled button silently no-ops. Wait for the target button to
 * actually be enabled before clicking it.
 */
async function waitForEnabledButton(name: RegExp): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

describe("PaymentsPanel — summary", () => {
  it("renders the paid/total/remaining summary line", () => {
    render(<PaymentsPanel {...panelProps()} />);
    expect(
      screen.getByText("Paid $2,000.00 of $5,000.00 — $3,000.00 remaining"),
    ).toBeInTheDocument();
  });

  it("shows the green Paid in full badge and hides the record form when balance is 0", () => {
    render(
      <PaymentsPanel
        {...panelProps({
          paidCents: 500_000,
          balanceCents: 0,
          payments: [paymentRow({ amountCents: 500_000 })],
        })}
      />,
    );
    const badge = screen.getByText("Paid in full");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toMatch(/text-ok/);
    expect(screen.queryByLabelText(/payment amount/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /record payment/i })).toBeNull();
  });
});

describe("PaymentsPanel — void status", () => {
  it("hides the record form but keeps history and delete controls read-only", () => {
    render(<PaymentsPanel {...panelProps({ status: "void" })} />);
    expect(screen.queryByLabelText(/payment amount/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /record payment/i })).toBeNull();
    expect(screen.getByText(/2026-07-10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });
});

describe("PaymentsPanel — record form", () => {
  it("submits amount converted from dollars to cents, including cents precision", async () => {
    recordPayment.mockResolvedValue({ ok: true });
    render(<PaymentsPanel {...panelProps()} />);

    fireEvent.change(screen.getByLabelText(/payment amount/i), { target: { value: "12.34" } });
    fireEvent.change(screen.getByLabelText(/payment method/i), { target: { value: "wire" } });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() =>
      expect(recordPayment).toHaveBeenCalledWith({
        invoiceId: 9302,
        amountCents: 1234,
        method: "wire",
        receivedDate: expect.any(String),
        note: undefined,
      }),
    );
  });

  it("defaults the received-date input to UTC today", () => {
    render(<PaymentsPanel {...panelProps()} />);
    const input = screen.getByLabelText(/received date/i) as HTMLInputElement;
    expect(input.value).toBe(toUtcDay(new Date()));
  });

  it("refreshes the router after a successful record", async () => {
    recordPayment.mockResolvedValue({ ok: true });
    render(<PaymentsPanel {...panelProps()} />);
    fireEvent.change(screen.getByLabelText(/payment amount/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("renders the action's error message under role=alert on failure", async () => {
    recordPayment.mockResolvedValue({
      ok: false,
      error: "Payment exceeds the remaining balance ($3,000.00 left)",
    });
    render(<PaymentsPanel {...panelProps()} />);
    fireEvent.change(screen.getByLabelText(/payment amount/i), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment exceeds the remaining balance ($3,000.00 left)",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("PaymentsPanel — delete", () => {
  it("deletes a payment only after the two-step confirm (no window.confirm)", async () => {
    deletePayment.mockResolvedValue({ ok: true });
    render(<PaymentsPanel {...panelProps({ payments: [paymentRow({ id: 77 })] })} />);

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(deletePayment).not.toHaveBeenCalled();

    const confirmBtn = await waitForEnabledButton(/^confirm$/i);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(deletePayment).toHaveBeenCalledWith({ id: 77 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
