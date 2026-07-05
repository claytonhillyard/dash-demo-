import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WatchToggle } from "@/components/watchlists/WatchToggle";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const watchEntity = vi.fn();
const unwatchEntity = vi.fn();
vi.mock("@/lib/watchlists/actions", () => ({
  watchEntity: (...args: unknown[]) => watchEntity(...args),
  unwatchEntity: (...args: unknown[]) => unwatchEntity(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  watchEntity.mockReset();
  unwatchEntity.mockReset();
});

describe("WatchToggle — unwatched state", () => {
  it("renders an email input and a Watch button", () => {
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: false, notifyEmail: null }}
      />,
    );
    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe("email");
    expect(input.placeholder).toBe("you@example.com");
    expect(screen.getByRole("button", { name: /watch/i })).toBeInTheDocument();
    expect(screen.queryByText(/watching/i)).toBeNull();
  });

  it("submits the typed email and calls watchEntity with entityType/entityId/notifyEmail", async () => {
    watchEntity.mockResolvedValue({ ok: true });
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: false, notifyEmail: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "owner@aiya.demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));

    await waitFor(() => expect(watchEntity).toHaveBeenCalledTimes(1));
    expect(watchEntity).toHaveBeenCalledWith({
      entityType: "customer",
      entityId: 2201,
      notifyEmail: "owner@aiya.demo",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("renders the action's error message under role=alert on failure", async () => {
    watchEntity.mockResolvedValue({ ok: false, error: "Server error" });
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: false, notifyEmail: null }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "owner@aiya.demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/server error/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("WatchToggle — watched state", () => {
  it("renders a Watching label and an Unwatch button, no email input", () => {
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: true, notifyEmail: "owner@aiya.demo" }}
      />,
    );
    expect(screen.getByText(/watching/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unwatch/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it("calls unwatchEntity with entityType/entityId on click", async () => {
    unwatchEntity.mockResolvedValue({ ok: true });
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: true, notifyEmail: "owner@aiya.demo" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unwatch/i }));

    await waitFor(() => expect(unwatchEntity).toHaveBeenCalledTimes(1));
    expect(unwatchEntity).toHaveBeenCalledWith({
      entityType: "customer",
      entityId: 2201,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("renders the action's error message under role=alert on unwatch failure", async () => {
    unwatchEntity.mockResolvedValue({ ok: false, error: "Server error" });
    render(
      <WatchToggle
        entityType="customer"
        entityId={2201}
        initial={{ watching: true, notifyEmail: "owner@aiya.demo" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unwatch/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/server error/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
