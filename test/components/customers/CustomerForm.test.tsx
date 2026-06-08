import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CustomerForm } from "@/components/customers/CustomerForm";
import type { CustomerView } from "@/db/customers";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function existingCustomer(over: Partial<CustomerView> = {}): CustomerView {
  return {
    id: 42,
    name: "Priya Mehta",
    businessName: "Mehta Diamonds Pvt Ltd",
    email: "priya@mehtadiamonds.in",
    phone: "+91 22 5555 1100",
    address: {
      street1: "12 Opera House",
      city: "Mumbai",
      state: "MH",
      zip: "400004",
      country: "IN",
    },
    notes: "Long-time wholesale partner.",
    externalRef: "WJ-10421",
    firstSeenAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});

describe("CustomerForm — create mode", () => {
  it("renders blank fields with no Delete button", () => {
    const action = vi.fn(async (_raw: unknown) => ({ ok: true as const, id: 7 }));
    render(<CustomerForm mode="create" action={action} />);
    expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("business name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("email") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText(/delete customer/i)).toBeNull();
    expect(screen.getByRole("button", { name: /create customer/i })).toBeInTheDocument();
  });

  it("submits a trimmed, normalized payload and routes to /customers/[id]/edit on success", async () => {
    const action = vi.fn(async (_raw: unknown) => ({ ok: true as const, id: 99 }));
    render(<CustomerForm mode="create" action={action} />);
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "  Acme Buyer  " },
    });
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: " acme@example.com " },
    });
    fireEvent.change(screen.getByLabelText("city"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const payload = action.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.name).toBe("Acme Buyer");
    expect(payload.email).toBe("acme@example.com");
    expect((payload.address as Record<string, unknown>).city).toBe("Paris");
    // empty optional fields drop out as `undefined`
    expect(payload.businessName).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    // create payload never carries an id
    expect(payload.id).toBeUndefined();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers/99/edit"));
  });

  it("renders the action's error message under role=alert and does not navigate", async () => {
    const action = vi.fn(async (_raw: unknown) => ({
      ok: false as const,
      error: "Demo mode — changes are disabled",
    }));
    render(<CustomerForm mode="create" action={action} />);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/demo mode/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("disables submit when name is empty", () => {
    const action = vi.fn(async (_raw: unknown) => ({ ok: true as const, id: 1 }));
    render(<CustomerForm mode="create" action={action} />);
    const btn = screen.getByRole("button", { name: /create customer/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "x" } });
    expect(btn.disabled).toBe(false);
  });
});

describe("CustomerForm — edit mode", () => {
  it("prefills every field from the supplied customer (including address)", () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    render(
      <CustomerForm
        mode="edit"
        action={action}
        initial={existingCustomer()}
      />,
    );
    expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("Priya Mehta");
    expect((screen.getByLabelText("business name") as HTMLInputElement).value).toBe(
      "Mehta Diamonds Pvt Ltd",
    );
    expect((screen.getByLabelText("email") as HTMLInputElement).value).toBe(
      "priya@mehtadiamonds.in",
    );
    expect((screen.getByLabelText("phone") as HTMLInputElement).value).toBe("+91 22 5555 1100");
    expect((screen.getByLabelText("street1") as HTMLInputElement).value).toBe("12 Opera House");
    expect((screen.getByLabelText("city") as HTMLInputElement).value).toBe("Mumbai");
    expect((screen.getByLabelText("country") as HTMLSelectElement).value).toBe("IN");
    expect((screen.getByLabelText("notes") as HTMLTextAreaElement).value).toBe(
      "Long-time wholesale partner.",
    );
    expect((screen.getByLabelText("external ref") as HTMLInputElement).value).toBe("WJ-10421");
  });

  it("submits with the existing id and calls router.refresh on success", async () => {
    const action = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    render(
      <CustomerForm
        mode="edit"
        action={action}
        initial={existingCustomer()}
      />,
    );
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Priya M" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const payload = action.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.id).toBe(42);
    expect(payload.name).toBe("Priya M");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("renders the Delete button only when deleteAction is wired", () => {
    const action = vi.fn(async () => ({ ok: true as const }));

    const { rerender } = render(
      <CustomerForm mode="edit" action={action} initial={existingCustomer()} />,
    );
    expect(screen.queryByLabelText(/delete customer/i)).toBeNull();

    const del = vi.fn(async () => ({ ok: true as const }));
    rerender(
      <CustomerForm
        mode="edit"
        action={action}
        initial={existingCustomer()}
        deleteAction={del}
      />,
    );
    expect(screen.getByLabelText(/delete customer/i)).toBeInTheDocument();
  });

  it("Delete button confirms, calls deleteAction with the id, then routes to /customers", async () => {
    const action = vi.fn(async () => ({ ok: true as const }));
    const del = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <CustomerForm
        mode="edit"
        action={action}
        initial={existingCustomer()}
        deleteAction={del}
      />,
    );
    fireEvent.click(screen.getByLabelText(/delete customer/i));

    await waitFor(() => expect(del).toHaveBeenCalledWith({ id: 42 }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    confirmSpy.mockRestore();
  });
});
