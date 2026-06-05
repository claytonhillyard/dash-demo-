import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WebsiteAdmin } from "@/components/website/WebsiteAdmin";
import type { WebsiteSnapshotRow } from "@/db/website";

// TODO(slice-5 review): The plan's original test code used
// `await Promise.resolve(); await Promise.resolve();` to wait for the
// async form submit handler. Under React 19's reconciler that pattern
// is unreliable for state updates that occur after an awaited async
// action — the assertions race the re-render. Adapted to waitFor()
// for the two affected tests; behavioral semantics are unchanged.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeRow(over: Partial<WebsiteSnapshotRow> = {}): WebsiteSnapshotRow {
  return {
    id: 1, orgId: 1, weekStart: "2026-05-25",
    visitors: 5000, uniqueVisitors: 3500, pageViews: 18000,
    avgSessionDurationSeconds: 210, bounceRatePercent: 42,
    createdAt: new Date("2026-05-25T12:00:00Z"),
    updatedAt: new Date("2026-05-25T12:00:00Z"),
    ...over,
  };
}

describe("WebsiteAdmin — form fields", () => {
  it("renders all 6 form inputs", () => {
    render(<WebsiteAdmin
      rows={[]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByLabelText(/week start/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^visitors$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unique visitors/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/page views/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/avg session/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/bounce rate/i)).toBeInTheDocument();
  });

  it("form submit calls createAction with the typed payload", async () => {
    const create = vi.fn(async (_raw: unknown) => ({ ok: true as const }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);

    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "3500" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "18000" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "210" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "42" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);

    await Promise.resolve();
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.weekStart).toBe("2026-05-25");
    expect(arg.visitors).toBe(5000);
    expect(arg.uniqueVisitors).toBe(3500);
    expect(arg.pageViews).toBe(18000);
    expect(arg.avgSessionDurationSeconds).toBe(210);
    expect(arg.bounceRatePercent).toBe(42);
  });
});

describe("WebsiteAdmin — server response handling", () => {
  it("renders the error message when createAction returns { ok: false, error }", async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: "boom" }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("boom");
    });
  });

  it("renders the duplicate-week hint when createAction returns { ok: true, duplicate: true }", async () => {
    const create = vi.fn(async () => ({ ok: true as const, duplicate: true as const }));
    render(<WebsiteAdmin
      rows={[]}
      createAction={create}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    fireEvent.change(screen.getByLabelText(/week start/i), { target: { value: "2026-05-25" } });
    fireEvent.change(screen.getByLabelText(/^visitors$/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/unique visitors/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/page views/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/avg session/i), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/bounce rate/i), { target: { value: "1" } });
    fireEvent.submit(screen.getByRole("button", { name: /add snapshot/i }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Saved.")).toBeNull();
  });
});

describe("WebsiteAdmin — table rendering", () => {
  it("renders an empty-state row when no snapshots exist", () => {
    render(<WebsiteAdmin
      rows={[]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
  });

  it("renders one row per snapshot with weekStart visible", () => {
    const rows = [
      makeRow({ id: 1, weekStart: "2026-05-25" }),
      makeRow({ id: 2, weekStart: "2026-05-18" }),
      makeRow({ id: 3, weekStart: "2026-05-11" }),
    ];
    render(<WebsiteAdmin
      rows={rows}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText("2026-05-25")).toBeInTheDocument();
    expect(screen.getByText("2026-05-18")).toBeInTheDocument();
    expect(screen.getByText("2026-05-11")).toBeInTheDocument();
  });

  it("delete button triggers deleteAction with the row id", async () => {
    const del = vi.fn(async () => ({ ok: true as const }));
    render(<WebsiteAdmin
      rows={[makeRow({ id: 42 })]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={del}
    />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await Promise.resolve(); await Promise.resolve();
    expect(del).toHaveBeenCalledWith(42);
  });

  it("each row renders uniqueVisitors (which the dashboard panel deliberately omits)", () => {
    render(<WebsiteAdmin
      rows={[makeRow({ uniqueVisitors: 3501 })]}
      createAction={async () => ({ ok: true })}
      updateAction={async () => ({ ok: true })}
      deleteAction={async () => ({ ok: true })}
    />);
    expect(screen.getByText("3,501")).toBeInTheDocument();
  });
});
