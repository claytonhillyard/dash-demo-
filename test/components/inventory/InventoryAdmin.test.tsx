import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InventoryAdmin, type InventoryRow } from "@/components/inventory/InventoryAdmin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rows: InventoryRow[] = [];

it("shows an empty state and submits a new item", async () => {
  // Typed args so `mock.calls[0][0]` (the submitted payload) is introspectable.
  const createAction = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const updateAction = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
  const deleteAction = vi.fn(async (_id: number) => ({ ok: true as const }));
  render(<InventoryAdmin
    items={rows}
    createAction={createAction}
    updateAction={updateAction}
    deleteAction={deleteAction}
    circles={[]}
    circleNamesById={new Map()}
  />);

  expect(screen.getByText(/add your first item/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("name"), { target: { value: "Solitaire" } });
  fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));

  await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
  expect(createAction.mock.calls[0][0]).toMatchObject({ name: "Solitaire", quantity: 3 });
});

it("surfaces an action error", async () => {
  const createAction = vi.fn(async () => ({ ok: false as const, error: "name is required" }));
  const updateAction = vi.fn(async () => ({ ok: true as const }));
  const deleteAction = vi.fn(async () => ({ ok: true as const }));
  render(<InventoryAdmin
    items={rows}
    createAction={createAction}
    updateAction={updateAction}
    deleteAction={deleteAction}
    circles={[]}
    circleNamesById={new Map()}
  />);
  fireEvent.click(screen.getByRole("button", { name: /add item/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("name is required");
});

const baseItem = {
  id: 1, category: "Diamonds" as const, name: "Round 1.02ct G/VS1",
  quantity: 1, status: "in_stock", unitCostCents: 0, retailPriceCents: 1240000,
  visibilityCircleId: null as number | null,
};

describe("InventoryAdmin slice 15", () => {
  it("renders the per-row Share dropdown with the right default", () => {
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    const select = screen.getByLabelText(/share Round 1.02/i) as HTMLSelectElement;
    expect(select.value).toBe("7");
  });

  it("renders the Shared via [Circle] badge on shared rows", () => {
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    // TODO(slice-15 review): badge text "Trusted Partners" collides with the
    // dropdown <option> text; use getAllByText + length check until a
    // data-testid is added to the badge (slice 4 DealRoomPanel pattern).
    const matches = screen.getAllByText("Trusted Partners");
    expect(matches.length).toBeGreaterThanOrEqual(2); // option + badge
    // Badge specifically (rendered as <span> with the Shared-with title).
    expect(document.querySelector('span[title="Shared with Trusted Partners"]'))
      .not.toBeNull();
  });

  it("XSS guard: circle name is rendered as text, never HTML", () => {
    const xss = "<script>alert(1)</script>";
    render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 7 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: xss }]}
      circleNamesById={new Map([[7, xss]])}
    />);
    // TODO(slice-15 review): text collides between <option> and <span>; use
    // getAllByText to confirm the literal string appears at least once.
    expect(screen.getAllByText(xss).length).toBeGreaterThanOrEqual(1);
    // No <script> element in the rendered DOM.
    expect(document.querySelector("script")).toBeNull();
  });

  it("name-leak guard: unknown circle id renders no badge", () => {
    const { container } = render(<InventoryAdmin
      items={[{ ...baseItem, visibilityCircleId: 999 }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={vi.fn(async () => ({ ok: true as const }))}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[]}
      circleNamesById={new Map()}
    />);
    expect(container.querySelector(".text-gold\\/80")).toBeNull();
  });

  it("changing the dropdown fires updateAction with the new visibilityCircleId", async () => {
    const updateAction = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    render(<InventoryAdmin
      items={[{ ...baseItem }]}
      createAction={vi.fn(async () => ({ ok: true as const }))}
      updateAction={updateAction}
      deleteAction={vi.fn(async () => ({ ok: true as const }))}
      circles={[{ id: 7, name: "Trusted Partners" }]}
      circleNamesById={new Map([[7, "Trusted Partners"]])}
    />);
    const select = screen.getByLabelText(/share Round 1.02/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "7" } });
    // Wait microtask for the action call.
    await Promise.resolve();
    expect(updateAction).toHaveBeenCalledTimes(1);
    const arg = updateAction.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.id).toBe(1);
    expect(arg.visibilityCircleId).toBe(7);
  });
});
