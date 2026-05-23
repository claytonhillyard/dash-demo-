import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MonthAmountAdmin } from "@/components/company/MonthAmountAdmin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("MonthAmountAdmin", () => {
  it("submits cents (dollars times 100) to the action", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<MonthAmountAdmin title="Revenue (manual bucket)" saveAction={save} rows={[]} />);
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: "2026" } });
    fireEvent.change(screen.getByLabelText(/month/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ year: 2026, month: 4, amountCents: 100000 }));
  });

  it("surfaces an action error", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "month: too big" }));
    render(<MonthAmountAdmin title="Profit" saveAction={save} rows={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too big/i));
  });

  it("shows an empty state when no months entered", () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<MonthAmountAdmin title="Profit" saveAction={save} rows={[]} />);
    expect(screen.getByText(/no months entered yet/i)).toBeInTheDocument();
  });
});
