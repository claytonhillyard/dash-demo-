import { HELP_EXAMPLES } from "@/lib/command/registry";
import { CommandPalette } from "@/components/command/CommandPalette";

export const dynamic = "force-dynamic";

/**
 * /command — read-only AI command palette shell (slice 35a-3, spec §6). A
 * deliberately thin server component: no session/db calls of its own (unlike
 * most admin pages in this tree) so it stays demo-harness compatible without
 * any mocking — `runCommand` (src/lib/command/actions.ts) enforces the
 * session itself when the palette actually submits a question. The only
 * server-side touch of src/lib/command/registry.ts anywhere in the page tree
 * is this `HELP_EXAMPLES` import (a plain string array, safe to compute at
 * module load) passed down as a prop; CommandPalette itself never imports
 * that module at runtime.
 */
export default function CommandPage() {
  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4">
        <h1 className="font-display text-xl tracking-widest text-gold">Command</h1>
        <p className="mt-1 text-sm text-text/50">
          Ask a question in plain English — answers are pulled straight from your own data.
        </p>
      </header>
      <CommandPalette helpExamples={HELP_EXAMPLES} />
    </main>
  );
}
