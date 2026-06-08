import { z } from "zod";

/**
 * JSONB address shape. All sub-fields optional. Empty object → undefined at
 * parse time, so we never store `address: {}` in the DB. Country is enforced
 * as ISO 3166-1 alpha-2 (two upper-case letters).
 *
 * Notes on XSS: text fields are rendered by React, which escapes by default,
 * so we don't strip HTML here — defense-in-depth lives at the render layer.
 */
export const addressInput = z
  .object({
    street1: z.string().trim().min(1).max(200).optional(),
    street2: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    zip: z.string().trim().min(1).max(20).optional(),
    country: z
      .string()
      .trim()
      .regex(/^[A-Z]{2}$/, "country must be ISO 3166-1 alpha-2")
      .optional(),
  })
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const hasAny = Object.values(v).some(
      (s) => s !== undefined && s !== null && s !== "",
    );
    return hasAny ? v : undefined;
  });

export const createCustomerInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  businessName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email("Invalid email").max(254).optional(),
  phone: z.string().trim().min(1).max(50).optional(),
  address: addressInput,
  notes: z.string().trim().min(1).max(2000).optional(),
  externalRef: z.string().trim().min(1).max(100).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerInput>;

export const updateCustomerInput = createCustomerInput.extend({
  id: z.number().int().positive(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerInput>;

export const deleteCustomerInput = z.object({
  id: z.number().int().positive(),
});
export type DeleteCustomerInput = z.infer<typeof deleteCustomerInput>;
