import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db =
  | ReturnType<typeof drizzleNeon<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS "revenue_months" (
  "id" serial PRIMARY KEY NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "revenue_months_year_month_uniq" UNIQUE("year","month")
);
CREATE TABLE IF NOT EXISTS "revenue_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "occurred_on" date NOT NULL,
  "amount_cents" integer NOT NULL,
  "memo" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "profit_months" (
  "id" serial PRIMARY KEY NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profit_months_year_month_uniq" UNIQUE("year","month")
);
CREATE TABLE IF NOT EXISTS "clients" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "value_cents" integer DEFAULT 0 NOT NULL,
  "acquired_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "employees" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "hired_on" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "projection_assumptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "base_year" integer NOT NULL,
  "base_revenue_cents" integer NOT NULL,
  "cagr_pct" integer NOT NULL,
  "per_year_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
`;

let singleton: Db | null = null;

export function getDb(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (url) {
    singleton = drizzleNeon(neon(url), { schema });
  } else {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    // Best-effort local bootstrap so a fresh dev machine works without a manual migrate step.
    void client.exec(DDL);
    singleton = db;
  }
  return singleton;
}

/** Fresh, isolated, migrated in-memory pglite for a single test. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await client.exec(DDL);
  return { db, close: () => client.close() };
}

export { sql };
