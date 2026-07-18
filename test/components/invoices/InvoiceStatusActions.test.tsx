import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoiceStatusActions } from "@/components/invoices/InvoiceStatusActions";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/watchlists/WatchToggle.test.tsx's indirection
// pattern: top-level trackable mocks, module factory just forwards to them.
const issueInvoice = vi.fn();
const voidInvoice = vi.fn();
vi.mock("@/lib/invoices/actions", () => ({
  issueInvoice: (...args: unknown[]) => issueInvoice(...args),
  voidInvoice: (...args: unknown[]) => voidInvoice(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  issueInvoice.mockReset();
  voidInvoice.mockReset();
});

describe("InvoiceStatusActions — draft", () => {
  it("renders both Issue and Void buttons", () => {
    render(<InvoiceStatusActions id={9301} status="draft" />);
    expect(screen.getByRole("button", { name: /issue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument();
  });

  it("calls issueInvoice with the id and refreshes on success", async () => {
    issueInvoice.mockResolvedValue({ ok: true });
    render(<InvoiceStatusActions id={9301} status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /issue/i }));

    await waitFor(() => expect(issueInvoice).toHaveBeenCalledTimes(1));
    expect(issueInvoice).toHaveBeenCalledWith({ id: 9301 });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(voidInvoice).not.toHaveBeenCalled();
  });

  it("renders the action's error message under role=alert on issue failure", async () => {
    issueInvoice.mockResolvedValue({ ok: false, error: "Forbidden" });
    render(<InvoiceStatusActions id={9301} status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /issue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/forbidden/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("calls voidInvoice with the id and refreshes on success", async () => {
    voidInvoice.mockResolvedValue({ ok: true });
    render(<InvoiceStatusActions id={9301} status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /void/i }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledTimes(1));
    expect(voidInvoice).toHaveBeenCalledWith({ id: 9301 });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe("InvoiceStatusActions — issued", () => {
  it("renders only the Void button (no Issue)", () => {
    render(<InvoiceStatusActions id={9302} status="issued" />);
    expect(screen.queryByRole("button", { name: /issue/i })).toBeNull();
    expect(screen.getByRole("button", { name: /void/i })).toBeInTheDocument();
  });

  it("calls voidInvoice with the id and refreshes on success", async () => {
    voidInvoice.mockResolvedValue({ ok: true });
    render(<InvoiceStatusActions id={9302} status="issued" />);
    fireEvent.click(screen.getByRole("button", { name: /void/i }));

    await waitFor(() => expect(voidInvoice).toHaveBeenCalledTimes(1));
    expect(voidInvoice).toHaveBeenCalledWith({ id: 9302 });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("renders the action's error message under role=alert on void failure", async () => {
    voidInvoice.mockResolvedValue({ ok: false, error: "Server error" });
    render(<InvoiceStatusActions id={9302} status="issued" />);
    fireEvent.click(screen.getByRole("button", { name: /void/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/server error/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("InvoiceStatusActions — void", () => {
  it("renders nothing — void is terminal, no actions available", () => {
    const { container } = render(<InvoiceStatusActions id={9303} status="void" />);
    expect(container).toBeEmptyDOMElement();
  });
});
