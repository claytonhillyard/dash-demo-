import { z } from "zod";

/** uploadDealAttachment takes FormData, not a typed JSON object, so its
 *  validation is split: dealId + kind + altText are field-parsed; the
 *  file is binary and validated separately by attachmentMime + size cap. */
export const uploadAttachmentMetaInput = z.object({
  dealId: z.number().int().positive(),
  kind: z.enum(["image", "cert"]),
  altText: z.string().trim().max(280).optional(),
});
export type UploadAttachmentMetaInput = z.infer<typeof uploadAttachmentMetaInput>;

export const deleteAttachmentInput = z.object({
  attachmentId: z.number().int().positive(),
});
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentInput>;
