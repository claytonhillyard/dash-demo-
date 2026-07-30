import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DraftEmailPanel } from "@/components/customers/DraftEmailPanel";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/invoices/SendInvoicePanel.test.tsx's indirection
// pattern: top-level trackable mocks, module factory just forwards to them.
// DRAFT_INTENTS/DraftIntent are a plain const/type imported by the component
// straight from "@/lib/drafting/generate" (not mocked here) — see that
// module's own doc comment on why it's a runtime array, not just a type.
const draftEmail = vi.fn();
const sendDraft = vi.fn();
const saveDraftingPrefs = vi.fn();
const saveCustomerStyleNote = vi.fn();
vi.mock("@/lib/drafting/actions", () => ({
  draftEmail: (...args: unknown[]) => draftEmail(...args),
  sendDraft: (...args: unknown[]) => sendDraft(...args),
  saveDraftingPrefs: (...args: unknown[]) => saveDraftingPrefs(...args),
  saveCustomerStyleNote: (...args: unknown[]) => saveCustomerStyleNote(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  draftEmail.mockReset();
  sendDraft.mockReset();
  saveDraftingPrefs.mockReset();
  saveCustomerStyleNote.mockReset();
});

type PanelProps = {
  customerId: number;
  customerName: string;
  hasEmail: boolean;
  styleNote: string | null;
  prefsTone: string | null;
  prefsSignature: string | null;
};

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    customerId: 2204,
    customerName: "Yuki Tanaka",
    hasEmail: true,
    styleNote: null,
    prefsTone: null,
    prefsSignature: null,
    ...overrides,
  };
}

/**
 * Mirrors test/components/invoices/PaymentsPanel.test.tsx's
 * waitForEnabledButton: useTransition's `isPending` isn't guaranteed to flip
 * back to `false` in the same commit React makes the state update inside an
 * async transition callback visible, so a click that lands on a
 * still-disabled button silently no-ops. Wait for the target button to
 * actually be enabled before clicking it.
 */
async function waitForEnabledButton(name: RegExp): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

/** Drives the Compose section to a populated draft area: stubs draftEmail's
 *  resolved value (once), clicks Generate, and waits for the subject input
 *  (rendered only once ok:true lands) to appear. Shared by every test below
 *  the compose section since they all need a draft on screen first. */
async function generateDraft(
  overrides: Partial<{ subject: string; body: string; simulated: boolean }> = {},
) {
  draftEmail.mockResolvedValueOnce({
    ok: true,
    subject: "Subject line",
    body: "Body text",
    simulated: false,
    ...overrides,
  });
  fireEvent.click(await waitForEnabledButton(/^generate$/i));
  await screen.findByLabelText(/draft subject/i);
}

describe("DraftEmailPanel — compose", () => {
  it("renders an intent select with humanized labels for the three DRAFT_INTENTS", () => {
    render(<DraftEmailPanel {...panelProps()} />);
    const select = screen.getByLabelText(/draft intent/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["Follow up", "Payment reminder", "Thank you"]);
  });

  it("generate populates editable subject and body inputs from draftEmail's response", async () => {
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft({ subject: "Following up, Yuki Tanaka", body: "Hi Yuki,\n\nJust checking in." });

    expect(screen.getByLabelText(/draft subject/i)).toHaveValue("Following up, Yuki Tanaka");
    expect(screen.getByLabelText(/draft body/i)).toHaveValue("Hi Yuki,\n\nJust checking in.");
  });

  it("calls draftEmail with the selected intent, trimmed instruction, and customerId", async () => {
    draftEmail.mockResolvedValue({ ok: true, subject: "S", body: "B", simulated: false });
    render(<DraftEmailPanel {...panelProps({ customerId: 9302 })} />);

    fireEvent.change(screen.getByLabelText(/draft intent/i), {
      target: { value: "payment_reminder" },
    });
    fireEvent.change(screen.getByLabelText(/draft instruction/i), {
      target: { value: "  mention the discount  " },
    });
    fireEvent.click(await waitForEnabledButton(/^generate$/i));

    await waitFor(() =>
      expect(draftEmail).toHaveBeenCalledWith({
        customerId: 9302,
        intent: "payment_reminder",
        instruction: "mention the discount",
      }),
    );
  });

  it("shows the simulated-draft note when draftEmail returns simulated: true", async () => {
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft({ simulated: true });

    expect(
      await screen.findByText("Simulated draft — set AI_GATEWAY_API_KEY for live drafting"),
    ).toBeInTheDocument();
  });

  it("renders the action's error message under role=alert when draftEmail fails", async () => {
    draftEmail.mockResolvedValue({ ok: false, error: "Couldn't generate a draft — try again" });
    render(<DraftEmailPanel {...panelProps()} />);
    fireEvent.click(await waitForEnabledButton(/^generate$/i));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't generate a draft — try again",
    );
  });
});

describe("DraftEmailPanel — draft area / send", () => {
  it("sends the user-EDITED body, not the originally generated body", async () => {
    sendDraft.mockResolvedValue({ ok: true });
    render(<DraftEmailPanel {...panelProps({ customerId: 2204 })} />);
    await generateDraft({ subject: "Following up", body: "Original body" });

    fireEvent.change(screen.getByLabelText(/draft body/i), {
      target: { value: "Edited body text" },
    });
    fireEvent.click(await waitForEnabledButton(/^send$/i));

    await waitFor(() =>
      expect(sendDraft).toHaveBeenCalledWith({
        customerId: 2204,
        subject: "Following up",
        body: "Edited body text",
      }),
    );
  });

  it("disables Send and shows a muted note when hasEmail is false", async () => {
    render(<DraftEmailPanel {...panelProps({ hasEmail: false })} />);
    await generateDraft();

    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    expect(screen.getByText(/no email on file/i)).toBeInTheDocument();
  });

  it("shows the simulated-send note when sendDraft returns simulated: true", async () => {
    sendDraft.mockResolvedValue({ ok: true, simulated: true });
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft();
    fireEvent.click(await waitForEnabledButton(/^send$/i));

    expect(
      await screen.findByText("Simulated — set RESEND_API_KEY for live sends"),
    ).toBeInTheDocument();
  });

  it("renders the action's error message under role=alert when sendDraft fails", async () => {
    sendDraft.mockResolvedValue({ ok: false, error: "No email on file for this customer" });
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft();
    fireEvent.click(await waitForEnabledButton(/^send$/i));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No email on file for this customer",
    );
  });
});

describe("DraftEmailPanel — copy", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("copies subject + body via navigator.clipboard.writeText and shows a Copied state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft({ subject: "Hello", body: "World" });

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello\n\nWorld"));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
  });

  it("falls back to a Copy unavailable message when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<DraftEmailPanel {...panelProps()} />);
    await generateDraft();

    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByText(/copy unavailable/i)).toBeInTheDocument();
  });
});

describe("DraftEmailPanel — voice section", () => {
  it("saves org tone + signature via saveDraftingPrefs with typed values", async () => {
    saveDraftingPrefs.mockResolvedValue({ ok: true });
    render(<DraftEmailPanel {...panelProps({ prefsTone: null, prefsSignature: null })} />);

    fireEvent.click(await waitForEnabledButton(/voice settings/i));
    fireEvent.change(screen.getByLabelText(/org tone/i), {
      target: { value: "Warm and concise" },
    });
    fireEvent.change(screen.getByLabelText(/org signature/i), {
      target: { value: "— Clayton" },
    });
    fireEvent.click(await waitForEnabledButton(/^save voice$/i));

    await waitFor(() =>
      expect(saveDraftingPrefs).toHaveBeenCalledWith({
        tone: "Warm and concise",
        signature: "— Clayton",
      }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("saves the per-customer style note via saveCustomerStyleNote with the customerId", async () => {
    saveCustomerStyleNote.mockResolvedValue({ ok: true });
    render(<DraftEmailPanel {...panelProps({ customerId: 2204, styleNote: null })} />);

    fireEvent.click(await waitForEnabledButton(/voice settings/i));
    fireEvent.change(screen.getByLabelText(/customer style note/i), {
      target: { value: "Prefers concise, no small talk" },
    });
    fireEvent.click(await waitForEnabledButton(/^save note$/i));

    await waitFor(() =>
      expect(saveCustomerStyleNote).toHaveBeenCalledWith({
        customerId: 2204,
        styleNote: "Prefers concise, no small talk",
      }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });
});
