# Slice 22 Phase D — Completion Plan

**Date:** 2026-06-08
**Author:** Clayton (resuming session)
**Branch:** `feature/slice-22-customers` (head `4b141d4`)
**Target:** merge to `main` + Netlify auto-deploy + ROADMAP update

This plan is self-contained. A fresh session reading it should be able to ship slice 22 with no other context. Assumes `docs/HANDOFF.md` has been skimmed.

---

## Pre-flight (≤ 2 min)

```bash
# 0a. Make sure you're at the repo root
cd "/Users/claytonhillyard/Downloads/dashboard project /root"

# 0b. Confirm branch state
git fetch origin
git log --oneline main..origin/feature/slice-22-customers | head -15
# Expect 13 commits — schema, queries, actions, tests, demo seed, UI, RSC pages,
# sidebar nav, migration regen, review fixes, Nav test mock.

# 0c. Confirm no uncommitted work on main
git status --short
# Expect: clean. If files are tracked, stop and resolve before merging.
```

If pre-flight surfaces anything unexpected, STOP. Read `docs/HANDOFF.md` for context.

---

## Step 1 — Confirm full vitest is green

A vitest full-suite run was started at the end of the previous session.

```bash
# Check the output file for the final summary
tail -10 /private/tmp/claude-501/-Users-claytonhillyard-Downloads-dashboard-project--root/8a166f8f-1ed7-40fb-b52a-0a1334501631/tasks/bnxr6msgy.output
```

Expect: `Test Files NN passed (NN)` and `Tests MMM passed (MMM)` with **zero failures**. If anything failed, fix in the worktree before continuing.

**If the task is no longer running and the file was rotated**, re-run from inside the worktree:
```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-22-customers"
npx vitest run 2>&1 | tee /tmp/slice22-final-verify.log | tail -10
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
```
Takes ~7 min.

---

## Step 2 — Confirm tsc is green (sanity)

```bash
cd "/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/slice-22-customers"
npx tsc --noEmit
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
```

Expect: zero output, exit 0. Was already green at last check (`bli6tfrn9`, `bojeemcpp`).

---

## Step 3 — Merge into main

```bash
git merge --no-ff origin/feature/slice-22-customers -m "$(cat <<'EOF'
Merge slice 22: Customers + CRM panel (CORE)

Generic customer roster — every tenant gets it regardless of vertical
module. Foundation for slices 24 (activity feed per-customer), 25 (email
alerts), 36 (customer health score), 37 (AI drafting with personality
memory), and the WinJewel migration arc (26-30).

Phase A — schema + migration 0016 + getCustomers (org-scoped + free-text
ILIKE on name/business_name/email/phone) + getCustomerById (owner-only).

Phase B — Zod schemas (create/update/delete) + 3 server actions with
runWithUser pattern + ForbiddenError on 0-row update/delete (cross-org
defense-in-depth) + authz truth-table tests.

Phase C — DEMO_CUSTOMERS seed (10 international AIYA-flavored entries) +
CustomersTable RSC + CustomerForm client component + 3 RSC pages
(/customers, /customers/new, /customers/[id]/edit) + sidebar nav entry +
component tests.

Review fixes — externalRef closed off from form/schemas/actions (reserved
for slice 26 WinJewel import as UPSERT idempotency key) + Sentry/log PII
scrub via safeErrShape() + Postgres unique-violation friendly mapping +
migration smoke test + symmetric Sentry action tags + NavItem extracted
as client component using usePathname (active state actually moves).

Deferred MINORs tracked in follow-up task #92: address fieldset toggle,
in-form delete modal (replace window.confirm), per-row delete in
CustomersTable, SQL wildcard escaping in search, addressInput strictness.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Verify the merge SHA and capture it for later:

```bash
SLICE_22_SHA=$(git rev-parse HEAD)
echo "Slice 22 merge: $SLICE_22_SHA"
```

---

## Step 4 — Push main (triggers Netlify auto-deploy)

```bash
git push origin main
```

Netlify webhook fires; deploy starts within ~30 seconds. The site is `https://idesign-dash-demo.netlify.app`.

---

## Step 5 — Update ROADMAP §9 (mark slice 22 shipped)

Edit `docs/ROADMAP.md` §9 active table:

| Before | After |
|---|---|
| `| 22 \| Customers + CRM panel \| core \| Phase A committed (worktree) \| **this tab** \| Foundation for slices 24/25/26-30 \|` | `| 22 \| Customers + CRM panel \| core \| shipped: <SLICE_22_SHA> \| this-tab \| 4 phases. 13 commits. Review fixes applied. MINORs tracked as #92. \|` |

Then commit + push the ROADMAP update:
```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark slice 22 (Customers) shipped"
git push origin main
```

---

## Step 6 — Update task tracker

Mark these completed:
- #35 Slice 22 — root task
- #59 Slice 22 Phase C — UI work
- #60 Slice 22 Phase D — this completion

Mark these still in_progress (they were ALREADY completed; tracker was lagging):
- #57 already completed (Phase A)
- #58 already completed (Phase B)

Open new task:
- #92 — "Slice 22 polish follow-up: in-form delete modal, address fieldset toggle, per-row delete, SQL wildcard escape in search, addressInput strictness, back-port Sentry PII scrub to other slices' actions.ts"

---

## Step 7 — Verify Netlify deploy

Wait 2-3 minutes after the push, then:

```bash
# Check the deploy status (if Netlify CLI is wired)
# netlify deploy:list

# Or hit the live URL
curl -sI https://idesign-dash-demo.netlify.app/customers | head -5
```

Open the deploy in a browser and confirm:
- [ ] Sidebar shows "Customers" entry with the gold dot when active
- [ ] Sidebar's "Dashboard" entry now correctly toggles active when you're on `/`
- [ ] `/customers` shows the 10 demo customers (Priya Mehta, Jean-Marc Auclair, etc.) with search box
- [ ] Searching for "Mehta" filters to ~1 match
- [ ] Clicking a row opens the edit page with prefilled fields
- [ ] **No** "External ref" input visible in the edit form (regression check on the BLOCKER fix)
- [ ] Edit form Delete button is the subtle text link in edit mode
- [ ] Web Vitals fire to Sentry (network tab shows `/sentry/` post requests)

If anything is broken on the live deploy:
1. Capture the browser console + network error
2. Rollback to the previous Netlify deploy via the Netlify UI ("Publish deploy" on the prior commit)
3. Diagnose, fix, re-deploy

---

## Step 8 — Clean up

```bash
# Local branch cleanup — slice 22 merged so the local branch can go
git branch -D slice-C-1-module-skeleton 2>/dev/null
git push origin --delete slice-C-1-module-skeleton 2>/dev/null

# Worktrees
git worktree remove .worktrees/slice-C-1-module-skeleton 2>/dev/null
# Keep slice-22-customers around for a day in case rollback needed.
# Delete after the next merge to main without rollback:
# git worktree remove .worktrees/slice-22-customers
```

---

## Step 9 — Announce + sync the other tab

If the other tab is active, it MUST pull the ROADMAP update before claiming the next slice. Add a heads-up note to `docs/ROADMAP.md` §9 if helpful — e.g. "slice 22 just landed; next-tab-to-claim picks from queue".

---

## Step 10 — Pick the next slice

ROADMAP §9 queued in priority order. Top candidates:

| # | Title | Layer | Why this next |
|---|---|---|---|
| 24 | Activity feed panel (audit log) | core | Unlocks slice 36 (Customer health score) + 38 (Anomaly sentinel). Now that customers exist, per-customer audit rows make sense. |
| 23 | AI image-to-listing (Vercel AI Gateway) | core | Foundation for AI-leveraged features. Requires slice 32 (AI Gateway) first OR can be folded into 32. |
| 25 | Watchlists + Resend emails | core | Establishes the Resend infra reused by slices 28/33/38/41. |
| 32 | Vercel AI Gateway provider integration | core | Foundation slice. Unblocks ~7 downstream AI slices. |

**My recommendation:** **slice 32 (AI Gateway)** next. It's small (provider wiring + tag setup + latency tracking via Sentry), and unblocks the highest-leverage downstream slices. Then either 24 (activity feed) or 35 (AI Command Layer) depending on whether you want the audit infrastructure first or the natural-language interface first.

Alternative: pick a cleanup slice — **C-2 (extract AIYA jewelry components to `src/modules/aiya-jewelry/`)** is mostly mechanical and starts proving the module pattern works in real code. ~30 min of work.

---

## Rollback plan (if Phase D goes wrong)

```bash
# If Netlify deploy is broken: rollback via Netlify UI to previous successful deploy.

# If main is poisoned (something else in the merge broke):
cd "/Users/claytonhillyard/Downloads/dashboard project /root"
git reset --hard 743a766      # Pre-slice-22 main
git push --force-with-lease origin main
# Then re-investigate in the worktree before merging again.
```

Don't `--force-push` to main without first restoring origin's reflog of the prior state — slice C-1 commit `743a766` is the rollback target.

---

## Done condition

Slice 22 Phase D is "done" when:
- [x] `feature/slice-22-customers` merged into `main` with `--no-ff`
- [x] Main pushed; Netlify auto-deploy succeeded
- [x] `https://idesign-dash-demo.netlify.app/customers` renders the demo seed
- [x] No "External ref" field visible in the edit form (BLOCKER regression check)
- [x] Sidebar active state moves as you navigate
- [x] `docs/ROADMAP.md` §9 row 22 says `shipped: <sha>`
- [x] Task tracker #35, #59, #60 marked completed
- [x] Task #92 (MINOR polish follow-up) opened

When all 8 are checked, slice 22 is shipped. Pick the next slice from §10.
