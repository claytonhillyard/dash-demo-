import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rows: InventoryRow[] = [];

it("shows an empty state and submits a new item", async () => {
  // Typed args so `mock.calls[0][0]` (the submitted payload) is introspectable.
  const createAction = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deleteAction = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<InventoryAdmin items={rows} createAction={createAction} deleteAction={deleteAction} />);

  expect(screen.getByText(/add your first item/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Solitaire" } });
  fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));

  await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
  expect(createAction.mock.calls[0][0]).toMatchObject({ name: "Solitaire", quantity: 3 });
});

it("surfaces an action error", async () => {
  const createAction = vi.fn(async () => ({ ok: false as const, error: "name is required" }));
  const deleteAction = vi.fn(async () => ({ ok: true as const }));
  render(<InventoryAdmin items={rows} createAction={createAction} deleteAction={deleteAction} />);
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("name is required");
});
