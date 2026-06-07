CREATE TABLE "inventory_bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventory_item_id" integer NOT NULL,
	"bidder_org_id" integer NOT NULL,
	"bidder_org_label" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "bid_mode" text;--> statement-breakpoint
ALTER TABLE "inventory_bids" ADD CONSTRAINT "inventory_bids_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_bids" ADD CONSTRAINT "inventory_bids_bidder_org_id_orgs_id_fk" FOREIGN KEY ("bidder_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_bids_item_created_idx" ON "inventory_bids" USING btree ("inventory_item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_bids_bidder_created_idx" ON "inventory_bids" USING btree ("bidder_org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inventory_bids_pending_by_item_idx" ON "inventory_bids" USING btree ("inventory_item_id","status") WHERE "inventory_bids"."status" = 'pending';