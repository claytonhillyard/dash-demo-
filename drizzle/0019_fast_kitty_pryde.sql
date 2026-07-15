CREATE TABLE "customer_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"score" integer NOT NULL,
	"band" text NOT NULL,
	"components" jsonb NOT NULL,
	"captured_on" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_health_snapshots" ADD CONSTRAINT "customer_health_snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_health_snapshots_org_customer_day_unique" ON "customer_health_snapshots" USING btree ("org_id","customer_id","captured_on");--> statement-breakpoint
CREATE INDEX "customer_health_snapshots_org_customer_idx" ON "customer_health_snapshots" USING btree ("org_id","customer_id","captured_on" DESC NULLS LAST);