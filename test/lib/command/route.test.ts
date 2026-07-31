import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/generateAiText", () => ({ generateAiText: vi.fn() }));

import { generateAiText } from "@/lib/ai/generateAiText";
import { routeByRules, routeCommand } from "@/lib/command/route";
import { COMMANDS, type CommandId } from "@/lib/command/registry";

/**
 * Router tests (spec §4, §7 rows 2-3). `routeByRules` is pure — no mocks
 * needed. `routeCommand`'s AI path is exercised entirely against a mocked
 * `generateAiText` seam (same mocking shape as test/lib/drafting/
 * generate.test.ts): these tests never hit a real model or the DB.
 */

// ---------------------------------------------------------------------------
// routeByRules — example phrasings.
// ---------------------------------------------------------------------------

describe("routeByRules — every command's own example phrasings route back to it", () => {
  // The ONE deliberate exception: overdue_invoices.examples[0] is the
  // literal string "who owes me money" (landed in 35a-1's registry.ts,
  // unchanged here), but the 35a-2 routing correction (below) sends that
  // exact phrase to unpaid_by_customer instead. Every other example, for
  // every command including overdue_invoices' remaining four, still
  // self-routes.
  const KNOWN_EXCEPTIONS = new Set(["who owes me money"]);

  it("loops COMMANDS and asserts each example self-routes", () => {
    for (const id of Object.keys(COMMANDS) as CommandId[]) {
      for (const example of COMMANDS[id].examples) {
        if (KNOWN_EXCEPTIONS.has(example)) continue;
        const routed = routeByRules(example);
        expect(routed.id, `"${example}" should route to ${id}, got ${routed.id}`).toBe(id);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The routing correction — "owes money" vs "is late" (task 35a-2's explicit
// controller decision, overriding spec §3's table phrasing).
// ---------------------------------------------------------------------------

describe("routeByRules — the owed-vs-overdue routing correction", () => {
  it('"who owes me money" routes to unpaid_by_customer, NOT overdue_invoices (despite being overdue_invoices.examples[0] verbatim)', () => {
    expect(COMMANDS.overdue_invoices.examples[0]).toBe("who owes me money"); // pin the landed fact this test overrides
    expect(routeByRules("who owes me money")).toEqual({
      id: "unpaid_by_customer",
      params: {},
    });
  });

  it('"money owed" routes to unpaid_by_customer', () => {
    expect(routeByRules("money owed").id).toBe("unpaid_by_customer");
  });

  it('"outstanding balances" routes to unpaid_by_customer (not receivables_summary)', () => {
    expect(routeByRules("outstanding balances").id).toBe("unpaid_by_customer");
  });

  it('"overdue invoices" routes to overdue_invoices (explicit lateness word)', () => {
    expect(routeByRules("overdue invoices")).toEqual({
      id: "overdue_invoices",
      params: {},
    });
  });

  it('"who\'s late on paying" routes to overdue_invoices (explicit lateness word)', () => {
    expect(routeByRules("who's late on paying").id).toBe("overdue_invoices");
  });

  it('bare "how much is outstanding" still routes to receivables_summary (own example, unaffected by the correction)', () => {
    expect(routeByRules("how much is outstanding").id).toBe("receivables_summary");
  });
});

// ---------------------------------------------------------------------------
// Keyword variants beyond the registry's own examples.
// ---------------------------------------------------------------------------

describe("routeByRules — keyword variants", () => {
  it.each([
    ["cash", "runway"],
    ["what's my burn", "runway"],
    ["churn", "at_risk_customers"],
    ["trend", "revenue_trend"],
    ["receivables", "receivables_summary"],
  ] as const)('"%s" routes to %s', (question, expected) => {
    expect(routeByRules(question).id).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Integer param extraction.
// ---------------------------------------------------------------------------

describe("routeByRules — integer param heuristics", () => {
  it("recent_activity: first integer becomes days", () => {
    expect(routeByRules("what happened in the last 3 days")).toEqual({
      id: "recent_activity",
      params: { days: 3 },
    });
  });

  it("recent_activity: an out-of-range integer clamps to 90", () => {
    const routed = routeByRules("recent activity over the last 200 days");
    expect(routed).toEqual({ id: "recent_activity", params: { days: 90 } });
  });

  it("recent_activity: no integer present omits days (executor default applies)", () => {
    expect(routeByRules("show recent activity")).toEqual({
      id: "recent_activity",
      params: {},
    });
  });

  it("overdue_invoices: first integer becomes minDays", () => {
    expect(routeByRules("overdue invoices more than 15 days late")).toEqual({
      id: "overdue_invoices",
      params: { minDays: 15 },
    });
  });
});

// ---------------------------------------------------------------------------
// customer_lookup query extraction.
// ---------------------------------------------------------------------------

describe("routeByRules — customer_lookup query extraction", () => {
  it('"what\'s the story with Tanaka" -> query "tanaka"', () => {
    expect(routeByRules("what's the story with Tanaka")).toEqual({
      id: "customer_lookup",
      params: { query: "tanaka" },
    });
  });

  it('"look up Mehta Diamonds" -> query contains both words, nothing else', () => {
    const routed = routeByRules("look up Mehta Diamonds");
    expect(routed.id).toBe("customer_lookup");
    if (routed.id !== "customer_lookup") throw new Error("unreachable");
    expect(routed.params).toEqual({ query: "mehta diamonds" });
  });

  it('"who is Priya Mehta" -> the who-is phrase keyword + proper-noun residual both fire; query "priya mehta"', () => {
    expect(routeByRules("who is Priya Mehta")).toEqual({
      id: "customer_lookup",
      params: { query: "priya mehta" },
    });
  });
});

// ---------------------------------------------------------------------------
// Degenerate inputs.
// ---------------------------------------------------------------------------

describe("routeByRules — degenerate inputs fall back to help", () => {
  it("gibberish with no recognizable vocabulary -> help", () => {
    expect(routeByRules("zzxxqq flibberflobber")).toEqual({ id: "help" });
  });

  it("empty string -> help", () => {
    expect(routeByRules("")).toEqual({ id: "help" });
  });

  it("whitespace-only -> help", () => {
    expect(routeByRules("   ")).toEqual({ id: "help" });
  });

  it("a deliberately constructed tie between two commands -> help, not an arbitrary pick", () => {
    // "balances" (unpaid_by_customer keyword, +2, +1 example) and "late"
    // (overdue_invoices keyword, +2, +1 example) each score exactly 3 with
    // zero overlap into any other command's vocabulary — an intentional
    // synthetic tie, not a real phrasing, to prove ties resolve to help
    // rather than an arbitrary winner.
    expect(routeByRules("balances late")).toEqual({ id: "help" });
  });
});

// ---------------------------------------------------------------------------
// routeCommand — AI path (mocked seam) + parse defense.
// ---------------------------------------------------------------------------

describe("routeCommand — AI path", () => {
  beforeEach(() => {
    vi.mocked(generateAiText).mockReset();
  });

  it("clean JSON routes exactly as given (Zod-parsed, defaults filled in)", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: '{"command":"customer_lookup","params":{"query":"Tanaka"}}',
      model: "anthropic/claude-haiku-4.5",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("irrelevant — the mock decides", 1);
    expect(routed).toEqual({ id: "customer_lookup", params: { query: "Tanaka" } });
  });

  it("fenced JSON (```json ... ```) still parses", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: '```json\n{"command":"revenue_trend","params":{}}\n```',
      model: "m",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("q", 1);
    expect(routed).toEqual({ id: "revenue_trend", params: {} });
  });

  it("JSON with prose wrapped around it still parses", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: 'Sure, here you go: {"command":"runway","params":{}} — hope that helps!',
      model: "m",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("q", 1);
    expect(routed).toEqual({ id: "runway", params: {} });
  });

  it("nested braces inside a JSON string value don't desync the balanced-brace scan", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: '{"command":"customer_lookup","params":{"query":"ask about {special} orders"}}',
      model: "m",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("q", 1);
    expect(routed).toEqual({
      id: "customer_lookup",
      params: { query: "ask about {special} orders" },
    });
  });

  it("an unknown command id falls back to routeByRules(question)", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: '{"command":"delete_everything","params":{}}',
      model: "m",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("how's my runway", 1);
    expect(routed).toEqual(routeByRules("how's my runway"));
    expect(routed.id).toBe("runway");
  });

  it("Zod-invalid params fall back to routeByRules(question)", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      text: '{"command":"overdue_invoices","params":{"minDays":"not-a-number"}}',
      model: "m",
      simulated: false,
      durationMs: 5,
    });
    const routed = await routeCommand("show at-risk customers", 1);
    expect(routed).toEqual(routeByRules("show at-risk customers"));
    expect(routed.id).toBe("at_risk_customers");
  });

  it("a seam error falls back to routeByRules(question)", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: false,
      error: "unavailable",
      durationMs: 5,
    });
    const routed = await routeCommand("recent activity", 1);
    expect(routed).toEqual(routeByRules("recent activity"));
  });

  it("a simulated response falls back to routeByRules(question) — the seam's own text is never used", async () => {
    vi.mocked(generateAiText).mockResolvedValueOnce({
      ok: true,
      simulated: true,
      // Deliberately valid JSON for a DIFFERENT command than the rules
      // match, so a wrong result here proves the simulated text leaked in.
      text: '{"command":"runway","params":{}}',
      model: "simulated",
      durationMs: 1,
    });
    const routed = await routeCommand("show at-risk customers", 1);
    expect(routed).toEqual(routeByRules("show at-risk customers"));
    expect(routed.id).toBe("at_risk_customers");
  });

  it("the seam itself rejecting unexpectedly falls back to routeByRules(question), never throws", async () => {
    vi.mocked(generateAiText).mockRejectedValueOnce(new Error("boom"));
    const routed = await routeCommand("how's my runway", 1);
    expect(routed).toEqual(routeByRules("how's my runway"));
  });
});

// ---------------------------------------------------------------------------
// Structural: zero business data in the prompt — the review-probe claim
// from docs/superpowers/plans/2026-07-23-command-palette-slice-35a.md's
// Final verification section.
// ---------------------------------------------------------------------------

describe("routeCommand — the prompt's only dynamic content is the question", () => {
  beforeEach(() => {
    vi.mocked(generateAiText).mockReset();
  });

  it("two different questions produce identical `system` and call shape, differing ONLY in `prompt`", async () => {
    vi.mocked(generateAiText).mockResolvedValue({
      ok: true,
      text: '{"command":"help","params":{}}',
      model: "m",
      simulated: false,
      durationMs: 1,
    });

    await routeCommand("question one", 42);
    await routeCommand("a totally different second question", 42);

    const calls = vi.mocked(generateAiText).mock.calls;
    expect(calls).toHaveLength(2);
    const [firstArg] = calls[0]!;
    const [secondArg] = calls[1]!;

    expect(firstArg.system).toBe(secondArg.system);
    expect(firstArg.prompt).toBe("question one");
    expect(secondArg.prompt).toBe("a totally different second question");

    // The system message never embeds either question's text.
    expect(firstArg.system).not.toContain("question one");
    expect(firstArg.system).not.toContain("a totally different second question");

    // Every field but `prompt` (and the org-tagged `user`, a structured
    // field, not prose) is identical across the two calls.
    expect({ ...firstArg, prompt: undefined, user: undefined }).toEqual({
      ...secondArg,
      prompt: undefined,
      user: undefined,
    });

    expect(firstArg.feature).toBe("command-layer");
    expect(firstArg.tier).toBe("fast");
    expect(firstArg.maxOutputTokens).toBe(200);
    expect(firstArg.user).toBe("org:42");
  });

  it("the static catalog names every command id", async () => {
    vi.mocked(generateAiText).mockResolvedValue({
      ok: true,
      text: '{"command":"help","params":{}}',
      model: "m",
      simulated: false,
      durationMs: 1,
    });
    await routeCommand("anything", 1);
    const system = vi.mocked(generateAiText).mock.calls[0]![0].system!;
    for (const id of Object.keys(COMMANDS)) {
      expect(system).toContain(id);
    }
  });
});
