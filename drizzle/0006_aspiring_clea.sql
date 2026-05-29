-- schema-only; no seed data in this migration.
-- Adds the partial composite index that backs the slice-4 widened deals OR
-- clause (the visibility_circle_id IN (...) branch). Spec §2.3.
-- See docs/superpowers/plans/2026-05-28-aiya-circles-slice-4.md for context.
-- DO NOT REGENERATE — this file's header would be overwritten by `npm run db:generate`.
CREATE INDEX "deals_visibility_circle_idx" ON "deals" USING btree ("visibility_circle_id","status","created_at" DESC NULLS LAST) WHERE "deals"."visibility_circle_id" IS NOT NULL;
