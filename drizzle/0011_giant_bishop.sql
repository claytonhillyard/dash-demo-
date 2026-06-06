-- schema-only; no seed data in this migration.
-- inventory_items.visibility_circle_id starts NULL for every existing row;
-- the demo seed lives in src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-06-06-aiya-tradenet-inventory-slice-15.md for context.
ALTER TABLE "inventory_items" ADD COLUMN "visibility_circle_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_visibility_circle_id_circles_id_fk" FOREIGN KEY ("visibility_circle_id") REFERENCES "public"."circles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_visibility_circle_idx" ON "inventory_items" USING btree ("visibility_circle_id","org_id") WHERE "inventory_items"."visibility_circle_id" IS NOT NULL;