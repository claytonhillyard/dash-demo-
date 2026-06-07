import { z } from "zod";

export const postInventoryBidInput = z.object({
  inventoryItemId: z.number().int().positive(),
  priceCents: z.number().int().positive(),
  currency: z.enum(["USD", "EUR", "INR", "JPY"]).default("USD"),
  notes: z.string().trim().max(500, "Notes too long").optional(),
  // Slice 18b: how many units of the item this bid is for. No upper cap in
  // the schema — canBidOnItem (post time) and the locked accept transaction
  // are the sources of truth. default(1) preserves slice-18 caller back-compat.
  quantityRequested: z.number().int().positive().default(1),
});
export type PostInventoryBidInput = z.infer<typeof postInventoryBidInput>;

export const acceptInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type AcceptInventoryBidInput = z.infer<typeof acceptInventoryBidInput>;

export const rejectInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type RejectInventoryBidInput = z.infer<typeof rejectInventoryBidInput>;

export const withdrawInventoryBidInput = z.object({
  bidId: z.number().int().positive(),
});
export type WithdrawInventoryBidInput = z.infer<typeof withdrawInventoryBidInput>;

export const setInventoryItemBidModeInput = z.object({
  inventoryItemId: z.number().int().positive(),
  mode: z.enum(["single", "history"]).nullable(),
});
export type SetInventoryItemBidModeInput = z.infer<typeof setInventoryItemBidModeInput>;
