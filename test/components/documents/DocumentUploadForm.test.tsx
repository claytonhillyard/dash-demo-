import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentUploadForm } from "@/components/documents/DocumentUploadForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// Mirrors test/components/watchlists/WatchToggle.test.tsx's indirection
// pattern: top-level trackable mock, module factory just forwards to it.
const uploadDocument = vi.fn();
vi.mock("@/lib/documents/actions", () => ({
  uploadDocument: (...args: unknown[]) => uploadDocument(...args),
}));

beforeEach(() => {
  refresh.mockReset();
  uploadDocument.mockReset();
});

// Unlike the CSV import wizards, this form submits the raw File straight
// into FormData rather than reading its text client-side, so the
// jsdom-missing-File.prototype.text() seam those wizards need (readFile)
// doesn't apply here — a plain File works as a FormData value in jsdom.
function pickFile(name = "nda.pdf", type = "application/pdf"): File {
  return new File(["placeholder"], name, { type });
}

function fillForm({
  file = pickFile(),
  title = "NDA with Acme",
  docType,
}: { file?: File | null; title?: string; docType?: string } = {}) {
  if (file) {
    fireEvent.change(screen.getByLabelText(/document file/i), {
      target: { files: [file] },
    });
  }
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: title } });
  if (docType) {
    fireEvent.change(screen.getByLabelText(/document type/i), { target: { value: docType } });
  }
}

describe("DocumentUploadForm — idle", () => {
  it("renders the file input, title input, docType select, and an enabled submit button", () => {
    render(<DocumentUploadForm />);
    expect(screen.getByLabelText(/document file/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/document type/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload/i })).toBeEnabled();
    expect(uploadDocument).not.toHaveBeenCalled();
  });
});

describe("DocumentUploadForm — submit", () => {
  it("builds FormData with the file, title, and docType, and calls uploadDocument", async () => {
    uploadDocument.mockResolvedValueOnce({ ok: true, id: 42 });
    render(<DocumentUploadForm />);
    fillForm({ title: "NDA with Acme", docType: "nda" });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1));
    const fd = uploadDocument.mock.calls[0][0] as FormData;
    expect(fd.get("title")).toBe("NDA with Acme");
    expect(fd.get("docType")).toBe("nda");
    const file = fd.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("nda.pdf");
  });

  it("clears the title/file inputs, shows a success line, and refreshes on {ok:true}", async () => {
    uploadDocument.mockResolvedValueOnce({ ok: true, id: 42 });
    render(<DocumentUploadForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe("");
  });

  it("shows an error alert and does not refresh on {ok:false}", async () => {
    uploadDocument.mockResolvedValueOnce({
      ok: false,
      error: "Unsupported file — upload a PDF or image",
    });
    render(<DocumentUploadForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported file/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables the submit button while the upload is pending", async () => {
    let resolve!: (v: { ok: true; id: number }) => void;
    uploadDocument.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<DocumentUploadForm />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled());
    resolve({ ok: true, id: 1 });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
