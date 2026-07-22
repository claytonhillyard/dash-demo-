// Combines the two template files' concerns into one, per task 30-3: the
// RSC page-render harness of test/app/customers-import-page.test.tsx, plus
// the interactive wizard behavior of test/components/customers/import/
// ImportWizard.test.tsx (slice 26, THE templates). This file runs under the
// project's default jsdom environment (deliberately no environment-override
// docblock, unlike customers-import-page.test.tsx) — renderToString works
// fine under jsdom too, and the interactive tests below need real DOM +
// fireEvent. NOTE: do not spell out that override directive in this comment
// (Vitest's docblock scanner matches it anywhere in the leading comment
// block, even inside prose describing it) — that's what broke this file the
// first time it was written.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { InvoiceImportPreview, InvoiceImportCommitResult } from "@/lib/invoices/import/actions";

afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/auth/getCurrentOrgId", () => ({
  getCurrentOrgId: vi.fn(async () => 1),
}));
vi.mock("@/db/client", () => ({
  ensureDbReady: vi.fn(async () => ({}) as never),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/customers/import/ImportWizard.test.tsx's
// indirection pattern: top-level trackable mocks, module factory just
// forwards to them.
const previewInvoiceImport = vi.fn();
const commitInvoiceImport = vi.fn();
vi.mock("@/lib/invoices/import/actions", () => ({
  previewInvoiceImport: (...args: unknown[]) => previewInvoiceImport(...args),
  commitInvoiceImport: (...args: unknown[]) => commitInvoiceImport(...args),
}));

import ImportInvoicesPage from "@/app/(admin)/invoices/import/page";
import { ImportWizard } from "@/components/invoices/import/ImportWizard";

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  previewInvoiceImport.mockReset();
  commitInvoiceImport.mockReset();
});

describe("/invoices/import RSC", () => {
  it("renders in the demo harness: page title, file input, and back link", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const html = renderToString(await ImportInvoicesPage());
    expect(html).toContain("Import invoice history");
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".csv,text/csv"');
    expect(html).toContain('href="/invoices"');
  });
});

// jsdom 25 (this repo's vitest environment) does not implement
// File.prototype.text() (empirically confirmed on the customers-import
// template: `typeof new File([...]).text === "undefined"`), so every
// interactive test below injects a deterministic `readFile` that ignores the
// File object's real bytes and resolves with whatever csvText the test wants
// previewInvoiceImport/commitInvoiceImport to see. Production code never
// passes this prop and gets the real `(f) => f.text()` default.
function makeReadFile(text: string) {
  return vi.fn(async (_file: File) => text);
}

function pickFile(name = "winjewel-invoices.csv"): File {
  return new File(["placeholder"], name, { type: "text/csv" });
}

function selectFile(file: File = pickFile()) {
  const input = screen.getByLabelText(/csv file/i);
  fireEvent.change(input, { target: { files: [file] } });
}

// Same useTransition timing gotcha as the ImportWizard template: isPending
// isn't guaranteed to flip back to false in the same commit as the state
// updates made inside an async transition callback, so a click on a still-
// disabled Commit button can silently no-op. Wait for it to actually enable
// before clicking.
async function waitForEnabledCommitButton(): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name: /commit/i });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

function okPreview(
  overrides: Partial<Extract<InvoiceImportPreview, { ok: true }>> = {},
): InvoiceImportPreview {
  return {
    ok: true,
    totalRows: 4,
    importable: 2,
    duplicates: 1,
    skipped: 1,
    sampleImportable: [
      { rowIndex: 1, invoiceNumber: "WJ-1001", customerLabel: "Alice Nakamura" },
      { rowIndex: 2, invoiceNumber: "WJ-1002", customerLabel: "Bob Ito" },
    ],
    sampleDuplicates: [
      {
        rowIndex: 3,
        invoiceNumber: "WJ-1003",
        customerLabel: "Alice Nakamura",
        reason: "duplicate invoice number",
      },
    ],
    sampleSkipped: [
      {
        rowIndex: 4,
        invoiceNumber: "WJ-1004",
        customerLabel: undefined,
        reason: "customer not found — import customers first",
      },
    ],
    ...overrides,
  };
}

describe("ImportWizard (invoices) — preview success", () => {
  it("renders counts, sample tables with a reason, and an enabled Commit button", async () => {
    previewInvoiceImport.mockResolvedValueOnce(okPreview());
    render(<ImportWizard readFile={makeReadFile("Invoice No,Total\nWJ-1001,100\n")} />);

    selectFile();

    await waitFor(() =>
      expect(previewInvoiceImport).toHaveBeenCalledWith({
        csvText: "Invoice No,Total\nWJ-1001,100\n",
      }),
    );

    expect(await screen.findByTestId("stat-totalRows")).toHaveTextContent("4");
    expect(screen.getByTestId("stat-importable")).toHaveTextContent("2");
    expect(screen.getByTestId("stat-duplicates")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-skipped")).toHaveTextContent("1");

    // A sample reason from each non-empty class renders.
    expect(screen.getByText("duplicate invoice number")).toBeInTheDocument();
    expect(screen.getByText("customer not found — import customers first")).toBeInTheDocument();

    const tables = screen.getAllByRole("table");
    expect(within(tables[0]).getByText("WJ-1001")).toBeInTheDocument();

    await waitForEnabledCommitButton();

    // The file input is gone once a preview is showing — Start over is the way back.
    expect(screen.queryByLabelText(/csv file/i)).toBeNull();
  });

  it("disables the Commit button when importable is 0", async () => {
    previewInvoiceImport.mockResolvedValueOnce(
      okPreview({
        importable: 0,
        duplicates: 0,
        skipped: 4,
        sampleImportable: [],
      }),
    );
    render(<ImportWizard readFile={makeReadFile("x")} />);
    selectFile();

    const commitBtn = await screen.findByRole("button", { name: /commit/i });
    expect(commitBtn).toBeDisabled();
  });

  it("Start over resets back to the idle file-input state", async () => {
    previewInvoiceImport.mockResolvedValueOnce(okPreview());
    render(<ImportWizard readFile={makeReadFile("x")} />);
    selectFile();

    await waitForEnabledCommitButton();
    fireEvent.click(screen.getByRole("button", { name: /start over/i }));

    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ImportWizard (invoices) — preview error", () => {
  it("renders the action's error message under role=alert and stays at idle", async () => {
    previewInvoiceImport.mockResolvedValueOnce({
      ok: false,
      error: "CSV is missing required column(s): Invoice No",
    });
    render(<ImportWizard readFile={makeReadFile("bogus")} />);
    selectFile();

    expect(await screen.findByRole("alert")).toHaveTextContent(/missing required column/i);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByLabelText(/csv file/i)).toBeInTheDocument();
  });
});

describe("ImportWizard (invoices) — commit success", () => {
  it("calls commitInvoiceImport with the SAME csvText read at preview time and shows the result panel numbers", async () => {
    const csvText = "Invoice No,Total\nWJ-1001,100\nWJ-1002,200\n";
    previewInvoiceImport.mockResolvedValueOnce(okPreview());
    commitInvoiceImport.mockResolvedValueOnce({
      ok: true,
      created: 2,
      payments: 1,
      duplicates: 1,
      skipped: 1,
    } satisfies InvoiceImportCommitResult);

    render(<ImportWizard readFile={makeReadFile(csvText)} />);
    selectFile();

    const commitBtn = await waitForEnabledCommitButton();
    fireEvent.click(commitBtn);

    await waitFor(() => expect(commitInvoiceImport).toHaveBeenCalledWith({ csvText }));

    expect(
      await screen.findByText(/Imported 2 invoices \(1 payment, 1 duplicate, 1 skipped\)/i),
    ).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: /back to invoices/i });
    expect(backLink).toHaveAttribute("href", "/invoices");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("ImportWizard (invoices) — readFile seam", () => {
  it("uses the injected readFile instead of the File object's own .text()", async () => {
    previewInvoiceImport.mockResolvedValueOnce(okPreview());
    const injectedText = "Invoice No,Total\nWJ-9001,500\n";
    const readFile = makeReadFile(injectedText);

    // A File whose real .text() would reject if ever called — proves the
    // component never falls back to it once a readFile prop is supplied.
    const file = pickFile();
    Object.defineProperty(file, "text", {
      value: () => Promise.reject(new Error("real File.text() must not be called")),
    });

    render(<ImportWizard readFile={readFile} />);
    selectFile(file);

    await waitFor(() => expect(readFile).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(previewInvoiceImport).toHaveBeenCalledWith({ csvText: injectedText }),
    );
    expect(await screen.findByTestId("stat-totalRows")).toBeInTheDocument();
  });
});
