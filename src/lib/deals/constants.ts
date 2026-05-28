export const DEAL_KINDS = ["BUY", "SELL"] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

export const DEAL_CATEGORIES = ["Diamond", "Gem", "Metal", "Finished", "Other"] as const;
export type DealCategory = (typeof DEAL_CATEGORIES)[number];

export const DEAL_STATUSES = ["Open", "Filled", "Withdrawn"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];
