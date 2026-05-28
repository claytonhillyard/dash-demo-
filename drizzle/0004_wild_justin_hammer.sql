-- DO NOT REGENERATE: this migration contains a hand-appended AIYA seed block.
-- Re-running `npm run db:generate` will overwrite this file and silently delete
-- the INSERT INTO orgs (...) statement. See plans/2026-05-28-aiya-multi-tenant-foundation-slice-3.md.
CREATE TABLE "orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_uniq" UNIQUE("slug")
);
--> statement-breakpoint
-- AIYA seed: must run before the tenanted-table FK constraints below, otherwise
-- ALTER TABLE fails on prod because existing rows reference org_id=1 with no
-- matching parent row. Seeded idempotently so re-running the migration is safe.
INSERT INTO "orgs" ("id", "name", "slug")
VALUES (1, 'AIYA Designs', 'aiya')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('orgs', 'id'),
  GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM "orgs"))
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diamond_index_history" ADD CONSTRAINT "diamond_index_history_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diamond_matrix_prices" ADD CONSTRAINT "diamond_matrix_prices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diamond_price_points" ADD CONSTRAINT "diamond_price_points_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;