import { z } from "zod";

const SLUG_RE = /^[a-z0-9-]+$/;

export const createCircleInput = z.object({
  name: z.string().trim().min(1, "name is required").max(120, "name too long"),
  slug: z.string().trim().min(1, "slug is required").max(64, "slug too long")
    .regex(SLUG_RE, "slug must be lowercase letters, digits, or hyphens"),
});
export type CreateCircleInput = z.infer<typeof createCircleInput>;

export const inviteOrgToCircleInput = z.object({
  circleId: z.number().int().positive(),
  toOrgSlug: z.string().trim().min(1, "slug is required").max(64, "slug too long")
    .regex(SLUG_RE, "slug must be lowercase letters, digits, or hyphens"),
});
export type InviteOrgToCircleInput = z.infer<typeof inviteOrgToCircleInput>;

// Token format check: minimum length is 16 (much smaller than the 36 chars of
// a v4 UUID), maximum 128. We deliberately do NOT pin to UUID format so a
// future token format change doesn't require an action-layer rewrite.
export const tokenInput = z.object({
  token: z.string().trim().min(16).max(128),
});
export type TokenInput = z.infer<typeof tokenInput>;

export const removeOrgFromCircleInput = z.object({
  circleId: z.number().int().positive(),
  orgId: z.number().int().positive(), // the TARGET org being removed (NOT the session orgId)
});
export type RemoveOrgFromCircleInput = z.infer<typeof removeOrgFromCircleInput>;

export const leaveCircleInput = z.object({
  circleId: z.number().int().positive(),
});
export type LeaveCircleInput = z.infer<typeof leaveCircleInput>;
