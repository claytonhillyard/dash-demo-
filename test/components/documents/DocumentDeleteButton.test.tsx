import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentDeleteButton } from "@/components/documents/DocumentDeleteButton";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const deleteDocument = vi.fn();
vi.mock("@/lib/documents/actions", () => ({
  deleteDocument: (...args: unknown[]) => deleteDocument(...args),
}));

beforeEach(() => {
  refresh.mockReset();
  deleteDocument.mockReset();
});

describe("DocumentDeleteButton — initial state", () => {
  it("shows a Delete button and does not call deleteDocument", () => {
    render(<DocumentDeleteButton id={9602} title="Master Consignment Agreement" />);
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});

describe("DocumentDeleteButton — two-step confirm", () => {
  it("requires a Confirm click before calling deleteDocument, then refreshes on success", async () => {
    deleteDocument.mockResolvedValueOnce({ ok: true });
    render(<DocumentDeleteButton id={9602} title="Master Consignment Agreement" />);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(deleteDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 9602 }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("Cancel returns to the initial state without calling deleteDocument", () => {
    render(<DocumentDeleteButton id={9602} title="Master Consignment Agreement" />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("shows an error alert on {ok:false} and does not refresh", async () => {
    deleteDocument.mockResolvedValueOnce({ ok: false, error: "Forbidden" });
    render(<DocumentDeleteButton id={9602} title="Master Consignment Agreement" />);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/forbidden/i);
    expect(refresh).not.toHaveBeenCalled();
  });
});
