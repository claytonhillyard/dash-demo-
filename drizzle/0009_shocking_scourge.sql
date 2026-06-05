CREATE TABLE "bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"bidder_org_id" integer NOT NULL,
	"bidder_org_label" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"bid_mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "bid_mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_org_id_orgs_id_fk" FOREIGN KEY ("bidder_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_deal_created_idx" ON "bids" USING btree ("deal_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bids_bidder_status_idx" ON "bids" USING btree ("bidder_org_id","status");--> statement-breakpoint
CREATE INDEX "bids_pending_by_deal_idx" ON "bids" USING btree ("deal_id","status") WHERE "bids"."status" = 'pending';