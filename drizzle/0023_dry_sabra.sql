CREATE TABLE "drafting_prefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"tone" text,
	"signature" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "style_note" text;--> statement-breakpoint
ALTER TABLE "drafting_prefs" ADD CONSTRAINT "drafting_prefs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drafting_prefs_org_unique" ON "drafting_prefs" USING btree ("org_id");