import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendInvoicePanel } from "@/components/invoices/SendInvoicePanel";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// Mirrors test/components/invoices/InvoiceStatusActions.test.tsx's
// indirection pattern: top-level trackable mock, module factory forwards.
const sendInvoice = vi.fn();
vi.mock("@/lib/invoices/actions", () => ({
  sendInvoice: (...args: unknown[]) => sendInvoice(...args),
}));

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  sendInvoice.mockReset();
});

type PanelProps = {
  id: number;
  billToEmail: string | null;
  sentAt: Date | null;
  sentTo: string | null;
};

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    id: 9302,
    billToEmail: "billto@example.com",
    sentAt: null,
    sentTo: null,
    ...overrides,
  };
}

describe("SendInvoicePanel", () => {
  it("prefills the email input from billToEmail", () => {
    render(<SendInvoicePanel {...panelProps({ billToEmail: "yuki@example.jp" })} />);
    expect(screen.getByLabelText(/recipient email/i)).toHaveValue("yuki@example.jp");
  });

  it("sends the typed override as toEmail", async () => {
    sendInvoice.mockResolvedValue({ ok: true });
    render(<SendInvoicePanel {...panelProps({ billToEmail: "billto@example.com" })} />);
    fireEvent.change(screen.getByLabelText(/recipient email/i), {
      target: { value: "override@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sendInvoice).toHaveBeenCalledWith({ id: 9302, toEmail: "override@example.com" }),
    );
  });

  it("sends toEmail undefined (never an empty string) when the input is cleared", async () => {
    sendInvoice.mockResolvedValue({ ok: true });
    render(<SendInvoicePanel {...panelProps({ billToEmail: "billto@example.com" })} />);
    fireEvent.change(screen.getByLabelText(/recipient email/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(sendInvoice).toHaveBeenCalledWith({ id: 9302, toEmail: undefined }),
    );
  });

  it("shows the simulated note and does not refresh on {ok:true, simulated:true}", async () => {
    sendInvoice.mockResolvedValue({ ok: true, simulated: true });
    render(<SendInvoicePanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(
      await screen.findByText("Simulated — set RESEND_API_KEY for live sends"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the router on a real ({ok:true}) send", async () => {
    sendInvoice.mockResolvedValue({ ok: true });
    render(<SendInvoicePanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/simulated/i)).toBeNull();
  });

  it("renders the action's error message under role=alert on failure", async () => {
    sendInvoice.mockResolvedValue({ ok: false, error: "Only issued invoices can be sent" });
    render(<SendInvoicePanel {...panelProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only issued invoices can be sent",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders the sent-state line with relative time and recipient when sentAt/sentTo are set", () => {
    render(
      <SendInvoicePanel
        {...panelProps({
          sentAt: new Date(Date.now() - 2 * 60 * 1000),
          sentTo: "y.tanaka@ginzapearl.jp",
        })}
      />,
    );
    const line = screen.getByTestId("invoice-sent-state");
    expect(line).toHaveTextContent(/ago/);
    expect(line).toHaveTextContent("y.tanaka@ginzapearl.jp");
  });

  it("renders no sent-state line when sentAt is null", () => {
    render(<SendInvoicePanel {...panelProps({ sentAt: null, sentTo: null })} />);
    expect(screen.queryByTestId("invoice-sent-state")).toBeNull();
  });
});
