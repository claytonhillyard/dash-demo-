CREATE TABLE "watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"actor" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"notify_email" text NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlists_org_actor_entity_unique" ON "watchlists" USING btree ("org_id","actor","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "watchlists_org_entity_idx" ON "watchlists" USING btree ("org_id","entity_type","entity_id");