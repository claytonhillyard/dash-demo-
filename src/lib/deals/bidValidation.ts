import { z } from "zod";

export const postBidInput = z.object({
  dealId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
});
export type PostBidInput = z.infer<typeof postBidInput>;

export const acceptBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type AcceptBidInput = z.infer<typeof acceptBidInput>;

export const rejectBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type RejectBidInput = z.infer<typeof rejectBidInput>;

export const withdrawBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type WithdrawBidInput = z.infer<typeof withdrawBidInput>;

export const setDealBidModeInput = z.object({
  dealId: z.number().int().positive(),
  mode: z.enum(["single", "history"]),
});
export type SetDealBidModeInput = z.infer<typeof setDealBidModeInput>;
