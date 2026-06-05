CREATE TABLE "deal_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"from_org_id" integer NOT NULL,
	"from_org_label" text NOT NULL,
	"body" text NOT NULL,
	"thread_mode" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_thread_reads" (
	"org_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deal_thread_reads_org_id_deal_id_pk" PRIMARY KEY("org_id","deal_id")
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "thread_mode" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_from_org_id_orgs_id_fk" FOREIGN KEY ("from_org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_thread_reads" ADD CONSTRAINT "deal_thread_reads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_thread_reads" ADD CONSTRAINT "deal_thread_reads_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_messages_deal_created_idx" ON "deal_messages" USING btree ("deal_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deal_messages_from_org_created_idx" ON "deal_messages" USING btree ("from_org_id","created_at" DESC NULLS LAST);