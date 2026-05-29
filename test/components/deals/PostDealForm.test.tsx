import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("PostDealForm — dropdown hidden when no circles", () => {
  it("does NOT render the visibility dropdown when circles=[]", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={[]} />);
    expect(screen.queryByLabelText(/visibility/i)).toBeNull();
  });

  it("does NOT render the visibility dropdown when circles prop is omitted", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} />);
    expect(screen.queryByLabelText(/visibility/i)).toBeNull();
  });
});

describe("PostDealForm — dropdown renders + submits", () => {
  const circles = [
    { id: 42, name: "AIYA Trusted Partners" },
    { id: 43, name: "Mumbai Cutters" },
  ];

  beforeEach(() => vi.clearAllMocks());

  it('renders "Private" as the default selected option', () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={circles} />);
    const select = screen.getByLabelText("visibility") as HTMLSelectElement;
    expect(select.value).toBe(""); // "" maps to null in the submit payload
    expect(select.options[0].textContent).toBe("Private (your org only)");
  });

  it("renders one <option> per circle", () => {
    render(<PostDealForm postAction={async () => ({ ok: true })} circles={circles} />);
    const select = screen.getByLabelText("visibility") as HTMLSelectElement;
    expect(select.options).toHaveLength(3); // Private + 2 circles
    expect(select.options[1].textContent).toBe("AIYA Trusted Partners");
    expect(select.options[2].textContent).toBe("Mumbai Cutters");
  });

  it("submits visibilityCircleId: null by default (Private)", async () => {
    // TODO(slice-4 review): plan's `vi.fn(async () => ...)` made the mock arg
    // tuple `never`, so `post.mock.calls[0][0]` failed tsc. Adding `_raw: unknown`
    // restores the slice-2 typing pattern; behavior is unchanged.
    const post = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    render(<PostDealForm postAction={post} circles={circles} />);

    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "5" } });
    fireEvent.submit(screen.getByRole("button", { name: /post deal/i }).closest("form")!);

    // wait microtask for the async submit
    await Promise.resolve();
    await Promise.resolve();

    expect(post).toHaveBeenCalledTimes(1);
    const arg = post.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.visibilityCircleId).toBeNull();
  });

  it("submits the selected circle id when a non-Private option is chosen", async () => {
    // TODO(slice-4 review): plan's `vi.fn(async () => ...)` made the mock arg
    // tuple `never`, so `post.mock.calls[0][0]` failed tsc. Adding `_raw: unknown`
    // restores the slice-2 typing pattern; behavior is unchanged.
    const post = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    render(<PostDealForm postAction={post} circles={circles} />);

    fireEvent.change(screen.getByLabelText("subject"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("price"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("visibility"), { target: { value: "43" } });
    fireEvent.submit(screen.getByRole("button", { name: /post deal/i }).closest("form")!);

    await Promise.resolve();
    await Promise.resolve();

    const arg = post.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.visibilityCircleId).toBe(43);
  });
});
