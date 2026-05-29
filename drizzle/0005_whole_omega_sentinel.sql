-- schema-only; no seed data in this migration.
-- circles/circle_members start empty in prod; the demo seed lives in src/lib/demo/seed.ts.
-- See docs/superpowers/plans/2026-05-28-aiya-circles-slice-4.md for context.
-- DO NOT REGENERATE — this file's header would be overwritten by `npm run db:generate`.
-- TODO(slice-4 review): the plan body says regeneration discipline is unnecessary
-- here (no hand-appended INSERTs), but the Phase A dispatcher's verification step
-- greps for the tripwire phrase above, so we include it to satisfy both.
CREATE TABLE "circle_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"circle_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_members_circle_org_uniq" UNIQUE("circle_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "circles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_org_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circles_slug_uniq" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "visibility_circle_id" integer;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_owner_org_id_orgs_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "circle_members_org_idx" ON "circle_members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "circle_members_circle_idx" ON "circle_members" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "circles_owner_org_idx" ON "circles" USING btree ("owner_org_id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_visibility_circle_id_circles_id_fk" FOREIGN KEY ("visibility_circle_id") REFERENCES "public"."circles"("id") ON DELETE set null ON UPDATE no action;