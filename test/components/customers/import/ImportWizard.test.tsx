import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ImportWizard } from "@/components/customers/import/ImportWizard";
import type { ImportPreview } from "@/lib/customers/import/actions";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/watchlists/WatchToggle.test.tsx's indirection
// pattern: top-level trackable mocks, module factory just forwards to them.
const previewImport = vi.fn();
const commitImport = vi.fn();
vi.mock("@/lib/customers/import/actions", () => ({
  previewImport: (...args: unknown[]) => previewImport(...args),
  commitImport: (...args: unknown[]) => commitImport(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  previewImport.mockReset();
  commitImport.mockReset();
});

// jsdom 25 (this repo's vitest environment) does not implement
// File.prototype.text() (empirically confirmed: `typeof new File([...]).text
// === "undefined"`), so every test injects a deterministic `readFile` that
// ignores the File object's real bytes and resolves with whatever csvText
// the test wants `previewImport`/`commitImport` to see. Production code never
// passes this prop and gets the real `(f) => f.text()` default.
function makeReadFile(text: string) {
  return vi.fn(async (_file: File) => text);
}

/** The File's actual content is irrelevant once readFile is injected — only
 *  its presence (to trigger onChange) and, for the oversize test, its `size`
 *  matter. */
function pickFile(name = "winjewel-customers.csv"): File {
  return new File(["placeholder"], name, { type: "text/csv" });
}

function selectFile(file: File = pickFile()) {
  const input = screen.getByLabelText(/csv file/i);
  fireEvent.change(input, { target: { files: [file] } });
}

/**
 * useTransition's `isPending` is not guaranteed to flip back to `false` in
 * the SAME commit as the state updates made inside an async transition
 * callback — React 18 does not formally support async `startTransition`
 * callbacks (ImportWizard's handleFileChange/handleCommit await
 * readFile/previewImport/commitImport inside theirs, matching WatchToggle's
 * existing convention). In practice this means the preview data can already
 * be visible in the DOM while the Commit/Cancel buttons are still
 * momentarily `disabled`. Tests that need to CLICK one of those buttons (as
 * opposed to just reading preview data) wait for it to actually become
 * enabled first, so the click can't land on a still-disabled element and
 * silently no-op — that failure mode is exactly what showed up as a flaky
 * "commitImport called 0 times" before this helper was introduced.
 */
async function waitForEnabledCommitButton(): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name: /commit/i });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

function okPreview(overrides: Partial<Extract<ImportPreview, { ok: true }>> = {}): ImportPreview {
  return {
    ok: true,
    totalRows: 3,
    validCount: 2,
    invalidCount: 1,
    wouldCreate: 2,
    wouldUpdate: 0,
    sample: [
      { rowIndex: 1, ok: true, name: "Alice", externalRef: "WJ-1" },
      { rowIndex: 2, ok: true, name: "Bob", externalRef: "WJ-2" },
      { rowIndex: 3, ok: false, errors: ["Row 3: name is required"] },
    ],
    ...overrides,
  };
}

describe("ImportWizard — idle", () => {
  it("renders the file input and no preview table yet", () => {
    render(<ImportWizard readFile={makeReadFile("")} />);
    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(previewImport).not.toHaveBeenCalled();
  });
});

describe("ImportWizard — oversize file (client-side check)", () => {
  it("shows an inline error and never calls previewImport", async () => {
    render(<ImportWizard readFile={makeReadFile("Customer ID,Name\nWJ-1,Alice\n")} />);
    const oversized = pickFile();
    Object.defineProperty(oversized, "size", { value: 5 * 1024 * 1024 + 1 });

    selectFile(oversized);

    expect(await screen.findByRole("alert")).toHaveTextContent(/5 ?mb/i);
    expect(previewImport).not.toHaveBeenCalled();
    // Input stays put so the user can pick a smaller file.
    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
  });
});

describe("ImportWizard — preview success", () => {
  it("renders counts, the first-20 sample table, and an enabled Commit button", async () => {
    previewImport.mockResolvedValueOnce(okPreview());
    render(<ImportWizard readFile={makeReadFile("Customer ID,Name\nWJ-1,Alice\n")} />);

    selectFile();

    await waitFor(() =>
      expect(previewImport).toHaveBeenCalledWith({ csvText: "Customer ID,Name\nWJ-1,Alice\n" }),
    );

    expect(await screen.findByTestId("stat-totalRows")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-validCount")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-invalidCount")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-wouldCreate")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-wouldUpdate")).toHaveTextContent("0");

    const table = screen.getByRole("table");
    expect(within(table).getByText("Alice")).toBeInTheDocument();
    expect(within(table).getByText("WJ-2")).toBeInTheDocument();
    expect(within(table).getByText(/name is required/i)).toBeInTheDocument();

    await waitForEnabledCommitButton();

    // The file input is gone once a preview is showing — Cancel is the way back.
    expect(screen.queryByLabelText(/csv file/i)).toBeNull();
  });

  it("disables the Commit button when validCount is 0", async () => {
    previewImport.mockResolvedValueOnce(
      okPreview({ validCount: 0, invalidCount: 3, wouldCreate: 0, wouldUpdate: 0 }),
    );
    render(<ImportWizard readFile={makeReadFile("x")} />);
    selectFile();

    const commitBtn = await screen.findByRole("button", { name: /commit/i });
    expect(commitBtn).toBeDisabled();
  });

  it("Cancel resets back to the idle file-input state", async () => {
    previewImport.mockResolvedValueOnce(okPreview());
    render(<ImportWizard readFile={makeReadFile("x")} />);
    selectFile();

    // Cancel shares the same `pending` gate as Commit — wait for that to
    // settle too (see waitForEnabledCommitButton's doc comment).
    await waitForEnabledCommitButton();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ImportWizard — preview error", () => {
  it("renders the action's error message under role=alert and stays at idle", async () => {
    previewImport.mockResolvedValueOnce({
      ok: false,
      error: "CSV is missing required column(s): externalRef, name",
    });
    render(<ImportWizard readFile={makeReadFile("bogus")} />);
    selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent(/missing required column/i);
    expect(screen.queryByRole("table")).toBeNull();
    // File input remains so the user can pick a corrected file.
    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
  });
});

describe("ImportWizard — commit success", () => {
  it("calls commitImport with the SAME csvText read at preview time, shows the result banner, and refreshes", async () => {
    const csvText = "Customer ID,Name\nWJ-1,Alice\nWJ-2,Bob\n";
    previewImport.mockResolvedValueOnce(okPreview());
    commitImport.mockResolvedValueOnce({ ok: true, created: 2, updated: 0, skipped: 1 });

    render(<ImportWizard readFile={makeReadFile(csvText)} />);
    selectFile();

    const commitBtn = await waitForEnabledCommitButton();
    fireEvent.click(commitBtn);

    await waitFor(() => expect(commitImport).toHaveBeenCalledWith({ csvText }));

    expect(
      await screen.findByText(/Imported 3 \(2 new, 0 updated, 1 skipped\)/i),
    ).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to customers/i });
    expect(backLink).toHaveAttribute("href", "/customers");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Preview UI is gone once we're at the done state.
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ImportWizard — commit error", () => {
  it("renders the error under role=alert, keeps the preview visible, and does not refresh", async () => {
    previewImport.mockResolvedValueOnce(okPreview());
    commitImport.mockResolvedValueOnce({ ok: false, error: "Server error" });

    render(<ImportWizard readFile={makeReadFile("x")} />);
    selectFile();

    const commitBtn = await waitForEnabledCommitButton();
    fireEvent.click(commitBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(/server error/i);
    // Preview + Commit button are still there so the user can retry without
    // re-uploading the file.
    expect(screen.getByRole("button", { name: /commit/i })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
