import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommandPalette } from "@/components/command/CommandPalette";

// Mirrors test/components/customers/DraftEmailPanel.test.tsx's indirection
// pattern: top-level trackable mock, module factory forwards to it. No
// next/navigation mock here — the component is deliberately router-free (no
// useRouter/refresh anywhere), so there's nothing to stub.
const runCommand = vi.fn();
vi.mock("@/lib/command/actions", () => ({
  runCommand: (...args: unknown[]) => runCommand(...args),
}));

beforeEach(() => {
  runCommand.mockReset();
});

const HELP_EXAMPLES = ["who owes me money", "how's my runway", "show at-risk customers"];

/** Mirrors DraftEmailPanel.test.tsx's waitForEnabledButton: useTransition's
 *  isPending isn't guaranteed to have flipped back to false by the time an
 *  awaited mock resolves, so wait for the button to actually re-enable
 *  before asserting on post-submit state. */
async function waitForEnabledButton(name: RegExp): Promise<HTMLElement> {
  const btn = await screen.findByRole("button", { name });
  await waitFor(() => expect(btn).toBeEnabled());
  return btn;
}

function ask(question: string) {
  fireEvent.change(screen.getByLabelText(/ask a question/i), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /^ask$/i }));
}

describe("CommandPalette — empty state / help chips", () => {
  it("renders a chip for every helpExamples entry before any query", () => {
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    for (const example of HELP_EXAMPLES) {
      expect(screen.getByRole("button", { name: example })).toBeInTheDocument();
    }
  });

  it("clicking a help chip fills the input but does not call runCommand", () => {
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    fireEvent.click(screen.getByRole("button", { name: "how's my runway" }));

    expect(screen.getByLabelText(/ask a question/i)).toHaveValue("how's my runway");
    expect(runCommand).not.toHaveBeenCalled();
  });
});

describe("CommandPalette — submit", () => {
  it("calls runCommand with the typed question on Ask click", async () => {
    runCommand.mockResolvedValue({ ok: true, result: { kind: "stat", label: "L", value: "V" }, command: "runway" });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("how's my runway");

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith({ question: "how's my runway" }));
  });

  it("calls runCommand on Enter key press in the input", async () => {
    runCommand.mockResolvedValue({ ok: true, result: { kind: "stat", label: "L", value: "V" }, command: "runway" });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    const input = screen.getByLabelText(/ask a question/i);
    fireEvent.change(input, { target: { value: "who owes me money" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(runCommand).toHaveBeenCalledWith({ question: "who owes me money" }));
  });

  it("disables the Ask button while a request is pending", async () => {
    let resolvePending!: (v: unknown) => void;
    runCommand.mockReturnValue(
      new Promise((resolve) => {
        resolvePending = resolve;
      }),
    );
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("how's my runway");

    await waitFor(() => expect(screen.getByRole("button", { name: /asking/i })).toBeDisabled());

    resolvePending({ ok: true, result: { kind: "stat", label: "L", value: "V" }, command: "runway" });
    await waitForEnabledButton(/^ask$/i);
  });
});

describe("CommandPalette — stat result", () => {
  it("renders the value, label, and optional detail", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: { kind: "stat", label: "Cash runway", value: "6 months", detail: "based on trailing profit" },
      command: "runway",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("how's my runway");

    expect(await screen.findByText("6 months")).toBeInTheDocument();
    expect(screen.getByText("Cash runway")).toBeInTheDocument();
    expect(screen.getByText("based on trailing profit")).toBeInTheDocument();
  });
});

describe("CommandPalette — table result", () => {
  it("renders rows and wraps the first cell of a linked row in an anchor to its href", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: {
        kind: "table",
        title: "Overdue invoices",
        columns: ["Invoice", "Customer", "Balance"],
        rows: [["INV-1", "Tanaka", "$100.00"]],
        links: ["/invoices/9302/edit"],
      },
      command: "overdue_invoices",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("who owes me money");

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Invoice")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "INV-1" });
    expect(link).toHaveAttribute("href", "/invoices/9302/edit");
    expect(screen.getByText("Tanaka")).toBeInTheDocument();
  });

  it("renders a graceful message instead of a bare table when rows is empty", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: { kind: "table", title: "At-risk customers", columns: ["Customer"], rows: [] },
      command: "at_risk_customers",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("show at-risk customers");

    expect(await screen.findByText("Nothing to show for that")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("CommandPalette — list result", () => {
  it("renders items and an optional link", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: {
        kind: "list",
        title: "Yuki Tanaka",
        items: [
          { text: "Yuki Tanaka", href: "/customers/2204/edit" },
          { text: "Outstanding balance: $500.00" },
        ],
      },
      command: "customer_lookup",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("what's the story with Tanaka");

    const link = await screen.findByRole("link", { name: "Yuki Tanaka" });
    expect(link).toHaveAttribute("href", "/customers/2204/edit");
    expect(screen.getByText("Outstanding balance: $500.00")).toBeInTheDocument();
  });

  it("renders a graceful message instead of a bare list when items is empty", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: { kind: "list", title: "Recent activity", items: [] },
      command: "recent_activity",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("what happened this week");

    expect(await screen.findByText("Nothing to show for that")).toBeInTheDocument();
  });
});

describe("CommandPalette — help result (router miss)", () => {
  it("renders the intro and example chips from a help-kind result", async () => {
    runCommand.mockResolvedValue({
      ok: true,
      result: { kind: "help", intro: "Not sure what you mean. Try one of these:", examples: ["how's my runway"] },
      command: "help",
    });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("asdf gibberish");

    expect(await screen.findByText("Not sure what you mean. Try one of these:")).toBeInTheDocument();
    // Two chips now render with this exact name: the always-present empty-state
    // chip built from the helpExamples prop, and the new result's own chip.
    // The empty-state block is replaced by history once a result lands, so
    // exactly one should remain.
    expect(screen.getAllByRole("button", { name: "how's my runway" })).toHaveLength(1);
  });
});

describe("CommandPalette — error", () => {
  it("renders the action's error message under role=alert and does not add it to history", async () => {
    runCommand.mockResolvedValue({ ok: false, error: "Couldn't run that — try again" });
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);
    ask("how's my runway");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't run that — try again");
    // No result landed, so the empty-state help chips are still showing.
    expect(screen.getByRole("button", { name: "who owes me money" })).toBeInTheDocument();
  });
});

describe("CommandPalette — history", () => {
  it("keeps only the last 3 results, most recent first", async () => {
    render(<CommandPalette helpExamples={HELP_EXAMPLES} />);

    for (const [q, value] of [
      ["question one", "1"],
      ["question two", "2"],
      ["question three", "3"],
      ["question four", "4"],
    ] as const) {
      runCommand.mockResolvedValueOnce({ ok: true, result: { kind: "stat", label: "L", value }, command: "runway" });
      ask(q);
      await screen.findByText(value);
    }

    expect(screen.queryByText("question one")).toBeNull();
    const questions = screen.getAllByText(/^question (two|three|four)$/);
    expect(questions.map((n) => n.textContent)).toEqual(["question four", "question three", "question two"]);
  });
});
