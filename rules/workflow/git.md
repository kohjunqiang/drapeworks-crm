# Git & Commits

## Branching

Single `main` branch. Commit straight to `main` for solo work. If the user joins a team workflow, switch to per-phase branches (`phase-3-fabrics`) with PRs.

## Commit cadence

- Commit per **logical unit of work**, not per phase
- A phase will typically have 5-15 commits
- Don't make WIP commits with broken code — the build should pass at every commit
- Migrations should be in a commit with their associated code changes (so a rollback or bisect is clean)

## Commit message style

Conventional Commits prefixes:

| Prefix | When |
|---|---|
| `feat:` | new functionality |
| `fix:` | bug fix |
| `refactor:` | code reshape without behaviour change |
| `chore:` | tooling, deps, config |
| `db:` | migration files only |
| `docs:` | docs changes (prototype updates, spec edits) |
| `style:` | formatting, css-only changes |
| `test:` | test additions |

Format:

```
<prefix>(<scope>): <imperative summary, lowercase, no trailing period>

Optional body explaining the WHY, wrapped at ~72 chars.

Closes #123  (if relevant)
```

Examples:

```
feat(fabrics): add CRUD dialog with shadcn Form and Zod validation

db(orders): add fulfilment_status enum and order_status_events table

fix(consultation-form): clear day/night curtain fields when switching room to toilet
```

## What goes in the body

- The WHY, not the WHAT (the diff shows the what)
- Any non-obvious decisions
- Links to specs / issues
- "Breaking change" notice if relevant

## What NOT to do

- **Never add a `Co-Authored-By: Claude` trailer** (or any AI attribution) to a commit
  message or PR body. This overrides the default Claude Code behaviour.
- Never `git commit -am 'fixes'` style — no useful info
- Never commit secrets (`.env*`, `*.pem`, etc.) — they're already in `.gitignore`; double-check
- Never `--amend` a pushed commit (rewrites history; breaks bisect)
- Never `--force` push to `main`
- Never use `--no-verify` to skip pre-commit hooks unless the user explicitly asks

## Inspecting before committing

Always run before `git commit`:

```bash
git status                 # any unintended files?
git diff --staged          # review what's actually going in
```

If migrations are included, also check:
```bash
ls supabase/migrations/    # confirm only intended files added
```

## After committing migrations

If the commit includes a migration that's been pushed to Supabase, also regenerate types and amend / new-commit the regenerated `src/lib/supabase/types.ts`. Don't merge a PR where types and migrations are out of sync.

## .gitignore (already configured)

```
node_modules
.next
.env*
!.env.example
.DS_Store
*.tsbuildinfo
```

If you add a new artifact directory (e.g. `coverage/`), add it to `.gitignore`.

## Forbidden

- Committing secrets
- Force-pushing to `main`
- Skipping commit hooks
- `git add .` without a `git status` check first
- Committing generated `src/lib/supabase/types.ts` that's out of sync with the migrations in the same commit
