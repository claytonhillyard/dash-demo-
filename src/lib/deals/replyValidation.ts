import { z } from "zod";

export const postDealMessageInput = z.object({
  dealId: z.number().int().positive(),
  body: z.string().trim().min(1, "Message cannot be empty").max(2000, "Message is too long"),
});
export type PostDealMessageInput = z.infer<typeof postDealMessageInput>;

export const setDealThreadModeInput = z.object({
  dealId: z.number().int().positive(),
  mode: z.enum(["private", "group"]),
});
export type SetDealThreadModeInput = z.infer<typeof setDealThreadModeInput>;

export const deleteDealMessageInput = z.object({
  messageId: z.number().int().positive(),
});
export type DeleteDealMessageInput = z.infer<typeof deleteDealMessageInput>;

export const markDealThreadReadInput = z.object({
  dealId: z.number().int().positive(),
});
export type MarkDealThreadReadInput = z.infer<typeof markDealThreadReadInput>;
