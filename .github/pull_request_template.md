## Linked backlog item

<!-- Link the story, tech-debt, spike, or impediment this PR resolves.
     e.g. "Closes #42" or "Relates to #38" -->

## Type of change

<!-- Keep only the lines that apply -->

- 📖 Story (new feature / capability)
- 🐛 Bug fix
- 🧹 Tech debt / refactor
- 🔬 Spike output
- 🚧 Impediment resolution
- 📄 Documentation only
- 🏗️ Build / CI / tooling

## What changed and why

<!-- Brief description of what this PR does and the reasoning behind the approach.
     Focus on *why* - the code speaks for itself. -->

## Pre-submission checklist

**Complete all items before requesting a review.**

### Correctness

- [ ] `deno check src/` passes with zero type errors
- [ ] `deno test` passes (or new tests added covering the changed behaviour)
- [ ] No `any` casts introduced without an explanatory comment

### Tool surface contract

- [ ] The public `scrum_*` tool names are unchanged (or the change is intentional and documented in README)
- [ ] Input/output shapes of affected tools are backward-compatible (or breaking change is called out below)
- [ ] `scrum_orient` still returns all vocabulary the agent depends on

### Architecture

- [ ] Change respects the layer dependency direction: `tools → use-cases → domain ← adapters`
- [ ] No use-case or domain code imports from `src/adapters/` or `src/services/`
- [ ] New logic lands in the correct layer (domain rules in `src/domain/`, GitHub specifics in `src/adapters/github/`)

### Hygiene

- [ ] No dead code, commented-out blocks, or debug logs left in
- [ ] PR scope is focused - one concern per PR

## Breaking changes

<!-- If any tool input/output shape, tool name, or config key changes, describe it here
     and confirm README § Tool Surface has been updated. -->

_None_

## Notes for reviewer

<!-- Anything that would help the reviewer understand context, trade-offs made,
     or areas where a second opinion is especially welcome. -->
