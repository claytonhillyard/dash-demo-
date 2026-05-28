import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostDealForm } from "@/components/deals/PostDealForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PostDealForm", () => {
  it("submits trimmed + cents-converted payload to the action", async () => {
    const postAction = vi.fn(async (_input: unknown) => ({ ok: true as const }));
    render(<PostDealForm postAction={postAction} />);
    fireEvent.change(screen.getByLabelText("kind"), { target: { value: "BUY" } });
    fireEvent.change(screen.getByLabelText("category"), { target: { value: "Metal" } });
    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "  18k chain lot  " } });
    fireEvent.change(screen.getByLabelText("quantity"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "8750" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));

    await waitFor(() => expect(postAction).toHaveBeenCalledTimes(1));
    expect(postAction.mock.calls[0][0]).toMatchObject({
      kind: "BUY",
      category: "Metal",
      subject: "18k chain lot",
      quantity: 5,
      priceCents: 875000,
    });
  });

  it("surfaces an action error", async () => {
    const postAction = vi.fn(async () => ({
      ok: false as const, error: "Demo mode — changes are disabled",
    }));
    render(<PostDealForm postAction={postAction} />);
    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/demo mode/i);
  });

  it("clears the form on success", async () => {
    const postAction = vi.fn(async (_input: unknown) => ({ ok: true as const }));
    render(<PostDealForm postAction={postAction} />);
    const subject = screen.getByLabelText("subject") as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Emerald" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /post deal/i }));
    await waitFor(() => expect(subject.value).toBe(""));
  });
});
