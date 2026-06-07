CREATE TABLE "deal_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"uploaded_by_org_id" integer NOT NULL,
	"kind" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_attachments" ADD CONSTRAINT "deal_attachments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_attachments" ADD CONSTRAINT "deal_attachments_uploaded_by_org_id_orgs_id_fk" FOREIGN KEY ("uploaded_by_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_attachments_storage_key_unique" ON "deal_attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "deal_attachments_deal_kind_created_idx" ON "deal_attachments" USING btree ("deal_id","kind","created_at");