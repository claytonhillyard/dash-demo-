CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"retail_price_cents" integer DEFAULT 0 NOT NULL,
	"metal" text,
	"weight_mg" integer,
	"carat_x100" integer,
	"cut" text,
	"color" text,
	"clarity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
