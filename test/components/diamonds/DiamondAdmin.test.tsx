import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DiamondAdmin, type PricePointRow } from "@/components/diamonds/DiamondAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const points: PricePointRow[] = [];

it("submits a CSV import", async () => {
  const importAction = vi.fn(async (_raw: unknown) => ({ ok: true as const, imported: 1 }));
  const savePoint = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deletePoint = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<DiamondAdmin points={points} importAction={importAction}
    savePoint={savePoint} deletePoint={deletePoint} />);
  fireEvent.change(screen.getByLabelText("csv"), {
    target: { value: "carat_band,color,clarity,price_per_carat\n1.00-1.49,G,VS1,8000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /import/i }));
  await waitFor(() => expect(importAction).toHaveBeenCalledTimes(1));
  expect(importAction.mock.calls[0][0]).toMatchObject({ sheet: "natural", shape: "round" });
});

it("surfaces an import error", async () => {
  const importAction = vi.fn(async (_raw: unknown) => ({ ok: false as const, error: "line 2: unknown color" }));
  const savePoint = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deletePoint = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<DiamondAdmin points={points} importAction={importAction}
    savePoint={savePoint} deletePoint={deletePoint} />);
  fireEvent.change(screen.getByLabelText("csv"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: /import/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/unknown color/);
});
