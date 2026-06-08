-- Slice C-1 (module-skeleton): add orgs.module_id so the shell can identify
-- which vertical module each tenant runs. NULL = "core only" tenant. Non-NULL
-- value matches a key in src/modules/registry.ts (e.g. "aiya-jewelry"). The
-- registry is empty in C-1; AIYA's manifest lands in C-2. See docs/MODULES.md
-- §6.1 + §9 Phase M1.
ALTER TABLE "orgs" ADD COLUMN "module_id" text;