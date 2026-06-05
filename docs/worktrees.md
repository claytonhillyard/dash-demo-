# Worktree workflow

Each in-progress feature slice gets its own git worktree under `.worktrees/`. The main worktree at `/root` is reserved for coordination — pulling, merging, pushing. **Do not edit feature code in `/root`** while a feature worktree is open for that work; it defeats the isolation and is how we lost mid-flight edits during slice 10.

## Why

Multiple agents can be active concurrently against the same repo (e.g. a "Chilly" parallel session and an interactive Claude session). Without worktrees, both share `/root`'s working tree, and one agent's `git checkout` silently overwrites the other's uncommitted edits. With worktrees, each agent edits in its own physical directory; `.git/` is shared but working trees aren't.

## Convention

- Path: `.worktrees/<slug>` (relative to project root)
- Branch: `feature/<slug>` (created off `main`)
- Slug: short kebab-case description with the slice number — e.g. `slice-16-bidding`, `aiya-polish-observability-11`

## Setup a new worktree

From `/root`:

```bash
git fetch origin
git pull --ff-only origin main
git worktree add .worktrees/<slug> -b feature/<slug>
cd .worktrees/<slug>
ln -sf ../../.env .env           # so `npm run dev` and migrations find env vars
ln -sf ../../node_modules node_modules   # avoid a second 700MB install
```

The two symlinks keep dependencies and env in sync with `/root` automatically. If a worktree ever needs a *different* dependency set (slice-specific install), break the symlink and run `npm install` locally inside the worktree.

## Finish a worktree

From `/root` (NOT from inside the worktree):

```bash
git pull --ff-only origin main
git merge --no-ff feature/<slug> -m "Merge <slug>: <one-line summary>"
git push origin main
git worktree remove .worktrees/<slug>
git branch -d feature/<slug>
```

## When you're done with a slice mid-merge

If you `cd` into a worktree, commit work, and then need to leave it for review — that's fine. The worktree persists across sessions. Just do all merge/push operations from `/root`. The reverse (editing in `/root` while a worktree is open for that feature) is what breaks.

## Tooling agents

Spawned implementer / reviewer subagents should be told their working directory explicitly in the prompt:

> Working directory: `/Users/claytonhillyard/Downloads/dashboard project /root/.worktrees/<slug>` — do NOT switch to `/root` for any reason.

This stops them from accidentally running `git checkout main` and stomping a sibling agent's work.
