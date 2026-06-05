-- schema-only; no seed data in this migration.
-- website_snapshots starts empty in prod; the demo seed lives in
-- src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-05-28-aiya-website-overview-slice-5.md for context.
CREATE TABLE "website_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"week_start" date NOT NULL,
	"visitors" integer NOT NULL,
	"unique_visitors" integer NOT NULL,
	"page_views" integer NOT NULL,
	"avg_session_duration_seconds" integer NOT NULL,
	"bounce_rate_percent" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "website_snapshots_org_week_uniq" UNIQUE("org_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "website_snapshots" ADD CONSTRAINT "website_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "website_snapshots_org_week_idx" ON "website_snapshots" USING btree ("org_id","week_start" DESC NULLS LAST);