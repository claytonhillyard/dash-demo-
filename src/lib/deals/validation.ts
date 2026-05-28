import { z } from "zod";
import { DEAL_KINDS, DEAL_CATEGORIES } from "./constants";

export const postDealInput = z.object({
  kind: z.enum(DEAL_KINDS),
  category: z.enum(DEAL_CATEGORIES),
  subject: z.string().trim().min(1, "subject is required").max(280, "subject must be 280 characters or fewer"),
  quantity: z.number().int().min(1),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional().default("USD"),
});
export type PostDealInput = z.infer<typeof postDealInput>;

export const updateDealStatusInput = z.object({
  id: z.number().int(),
  // status is narrowed to terminal states only — "Open" is the insert default,
  // not a valid update target. Re-opening requires an audit trail (slice 2g).
  status: z.enum(["Filled", "Withdrawn"]),
});
export type UpdateDealStatusInput = z.infer<typeof updateDealStatusInput>;

export { firstZodError } from "@/lib/company/validation";
