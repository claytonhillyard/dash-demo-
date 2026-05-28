CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"subject" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"posted_by_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deals_org_status_created_idx" ON "deals" USING btree ("org_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deals_org_kind_idx" ON "deals" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "deals_org_category_idx" ON "deals" USING btree ("org_id","category");