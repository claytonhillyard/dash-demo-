// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import CommandPage from "@/app/(admin)/command/page";
import { HELP_EXAMPLES } from "@/lib/command/registry";

/**
 * /command RSC render (spec §7 row 6, task 35a-3). Unlike the other
 * test/app/*.test.tsx page tests, this page makes no session/db calls of its
 * own (runCommand handles auth on submit, client-side) — so there's nothing
 * to mock here, just a plain synchronous render. CommandPalette is a client
 * component, but renderToString still produces its initial (pre-hydration)
 * HTML with no router mock needed since the component is router-free.
 */
describe("/command RSC", () => {
  it("renders the title, the palette's placeholder, and help chips sourced from HELP_EXAMPLES", () => {
    const html = renderToString(CommandPage());

    expect(html).toContain("Command");
    expect(html).toContain("Ask about customers, invoices, cash");
    // Sourced from the same registry export the page itself imports, so this
    // can't silently drift from the catalog.
    expect(html).toContain(HELP_EXAMPLES[0]);
  });
});
