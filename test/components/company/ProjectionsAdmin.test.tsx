import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectionsAdmin } from "@/components/company/ProjectionsAdmin";

describe("ProjectionsAdmin", () => {
  it("prefills from existing assumptions and saves cents", async () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(
      <ProjectionsAdmin
        initial={{ baseYear: 2026, baseRevenueCents: 100_00, cagrPct: 15, perYearOverrides: {} }}
        saveAction={save}
      />
    );
    expect((screen.getByLabelText(/base revenue/i) as HTMLInputElement).value).toBe("100");
    fireEvent.click(screen.getByRole("button", { name: /save projection/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        baseYear: 2026,
        baseRevenueCents: 100_00,
        cagrPct: 15,
        perYearOverrides: {},
      })
    );
  });

  it("shows an empty/first-run hint when there are no assumptions yet", () => {
    const save = vi.fn(async () => ({ ok: true as const }));
    render(<ProjectionsAdmin initial={null} saveAction={save} />);
    expect(screen.getByText(/set your first projection/i)).toBeInTheDocument();
  });

  it("surfaces an action error", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "cagrPct: too big" }));
    render(<ProjectionsAdmin initial={null} saveAction={save} />);
    fireEvent.click(screen.getByRole("button", { name: /save projection/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too big/i));
  });
});
