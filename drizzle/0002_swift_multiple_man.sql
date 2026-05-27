CREATE TABLE "diamond_index_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"series" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diamond_matrix_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"sheet" text NOT NULL,
	"shape" text NOT NULL,
	"color" text NOT NULL,
	"clarity" text NOT NULL,
	"carat_band" text NOT NULL,
	"price_per_carat_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diamond_matrix_cell_uniq" UNIQUE("org_id","sheet","shape","color","clarity","carat_band")
);
--> statement-breakpoint
CREATE TABLE "diamond_price_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"price_per_carat_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
