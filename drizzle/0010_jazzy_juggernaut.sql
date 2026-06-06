-- schema-only; no seed data in this migration.
-- circle_invitations starts empty in prod; the demo seed lives in
-- src/lib/demo/seed.ts and never touches the DB.
-- See docs/superpowers/plans/2026-06-05-aiya-circle-onboarding-slice-4c.md for context.
CREATE TABLE "circle_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"circle_id" integer NOT NULL,
	"from_org_id" integer NOT NULL,
	"to_org_slug" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "circle_invitations_token_uniq" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "circle_invitations" ADD CONSTRAINT "circle_invitations_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_invitations" ADD CONSTRAINT "circle_invitations_from_org_id_orgs_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "circle_invitations_pending_uniq" ON "circle_invitations" USING btree ("circle_id","to_org_slug") WHERE "circle_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "circle_invitations_to_slug_status_idx" ON "circle_invitations" USING btree ("to_org_slug","status");--> statement-breakpoint
CREATE INDEX "circle_invitations_from_org_status_idx" ON "circle_invitations" USING btree ("from_org_id","status");