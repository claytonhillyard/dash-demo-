/**
 * Drafting intents live in their own dependency-free module (the
 * payments/types.ts precedent) so the client-side DraftEmailPanel can import
 * them without pulling `generate.ts`'s server graph (the ai SDK + Sentry)
 * into the bundle. Tree-shaking happened to keep the bundle clean when the
 * panel imported from generate.ts directly, but that depended on every
 * module in that graph staying side-effect-free forever — this makes the
 * boundary structural instead of accidental (slice-37 review F5).
 */
export const DRAFT_INTENTS = ["follow_up", "payment_reminder", "thank_you"] as const;
export type DraftIntent = (typeof DRAFT_INTENTS)[number];
