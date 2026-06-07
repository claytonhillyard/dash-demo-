// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostInventoryBidForm } from "@/components/inventory/PostInventoryBidForm";

describe("PostInventoryBidForm — slice 18b", () => {
  it("renders an 'Available: N units' hint", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    expect(screen.getByText(/available: 5 units/i)).toBeTruthy();
  });

  it("pluralizes 1 unit correctly", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={1}
        postInventoryBid={vi.fn()}
      />,
    );
    expect(screen.getByText(/available: 1 unit$/i)).toBeTruthy();
  });

  it("disables submit when quantity exceeds available stock", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "100" } });
    const submit = screen.getByRole("button", { name: /place bid/i });
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toMatch(/cannot bid for more than 5/i);
  });

  it("passes quantityRequested through to the action", async () => {
    const post = vi.fn(async () => ({ ok: true as const }));
    render(
      <PostInventoryBidForm
        inventoryItemId={42}
        availableQuantity={10}
        postInventoryBid={post}
      />,
    );
    fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /place bid/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      inventoryItemId: 42,
      priceCents: 10000,
      quantityRequested: 3,
    }));
  });

  it("defaults quantity to 1", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={5}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    expect(qty.value).toBe("1");
  });

  it("has max attribute set to availableQuantity", () => {
    render(
      <PostInventoryBidForm
        inventoryItemId={1}
        availableQuantity={50}
        postInventoryBid={vi.fn()}
      />,
    );
    const qty = screen.getByLabelText("quantity") as HTMLInputElement;
    expect(qty.max).toBe("50");
  });
});
