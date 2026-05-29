# Rules

Focused rule files Claude should consult before writing code in this repo. Each file is short and tactical — open the relevant one(s) before starting work.

## Structure

```
rules/
  code/        # how to write the code
    typescript.md         strict mode, generated types, money handling
    components.md         RSC vs Client, file layout, props patterns
    forms.md              RHF + Zod, discriminated unions, shadcn Form
    server-actions.md     canonical action shape, role guards, revalidation

  data/        # how to work with the database
    migrations.md         naming, push, type-gen workflow
    rls.md                policies, helper functions, parent-gated patterns
    storage.md            buckets, signed URLs, upload/read/delete flows
    queries.md            select with joins, RPC usage, type-safe selects

  ui/          # how it should look and behave
    design-tokens.md      colours, status mapping, spacing rhythm
    responsive.md         mobile-first, breakpoints, table-vs-cards pattern
    shadcn.md             primitive usage, icons, toasts, accessibility

  workflow/    # how to ship it
    git.md                commit style, branching, secrets hygiene
    deploy.md             Railway flow, Dockerfile, migration order
    verification.md       per-phase checklists, RLS testing, mobile QA
```

## When to open which file

| Doing this... | Read these |
|---|---|
| Adding/editing a React component | `code/components.md`, `ui/shadcn.md`, `ui/design-tokens.md`, `ui/responsive.md` |
| Writing a Server Action | `code/server-actions.md`, `data/rls.md`, `data/queries.md` |
| Building a form | `code/forms.md`, `ui/shadcn.md` |
| Writing a migration | `data/migrations.md`, `data/rls.md` |
| Working with photos | `data/storage.md` |
| Querying the DB from RSC | `data/queries.md` |
| Styling anything | `ui/design-tokens.md`, `ui/responsive.md` |
| Touching types | `code/typescript.md` |
| Committing | `workflow/git.md` |
| Deploying | `workflow/deploy.md`, `workflow/verification.md` |
| Declaring a phase done | `workflow/verification.md` |

## Priority order if rules conflict

1. The current phase spec (`docs/specs/phase-N-*.md`) — most specific wins
2. `CLAUDE.md` non-negotiables — listed at the repo root
3. These rule files
4. The prototype (`docs/prototype/`) for UX
5. Sensible defaults

If a rule blocks progress because a phase explicitly overrides it, the phase wins — but call it out in the commit message so it's traceable.
