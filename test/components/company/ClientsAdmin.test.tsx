import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ClientsAdmin } from "@/components/company/ClientsAdmin";

describe("ClientsAdmin", () => {
  it("shows an 'Add your first' empty state when there are no clients", () => {
    const create = vi.fn(async () => ({ ok: true as const }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<ClientsAdmin clients={[]} createAction={create} deleteAction={del} />);
    expect(screen.getByText(/add your first client/i)).toBeInTheDocument();
  });

  it("surfaces a server validation error, never failing silently", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "name: name is required" }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<ClientsAdmin clients={[]} createAction={create} deleteAction={del} />);
    fireEvent.change(screen.getByLabelText(/acquired/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /add client/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/name is required/i));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("lists existing clients with their status", () => {
    const create = vi.fn(async () => ({ ok: true as const }));
    const del = vi.fn(async () => ({ ok: true as const }));
    render(
      <ClientsAdmin
        clients={[{ id: 1, name: "Acme", status: "active", valueCents: 500_00, acquiredOn: "2026-01-01" }]}
        createAction={create}
        deleteAction={del}
      />
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    // Scope to the client list: "active" also appears as a <select> option in the form.
    expect(within(screen.getByRole("list")).getByText("active")).toBeInTheDocument();
    expect(screen.queryByText(/add your first client/i)).not.toBeInTheDocument();
  });
});
