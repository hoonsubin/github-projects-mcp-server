# AGENT.md

Guidance for coding agents working in this repository. Concise by design — see linked documents for depth.

## Reference Documents

- `README.md`: Project vision, domain model, tool surface design, interaction patterns.
- `docs/proj-diagram.md`: Current module dependency diagram and unused export tracking (project ToC).
- `.github/scrum/config.yml`: Team/sprint definitions, vocabulary, DoD rules, autonomy settings.
- `skill/scrum-master-agent/SKILL.md`: Agentic Scrum prompts and ceremony playbooks.

## Tech Stack

- `Deno.js`: Use `deno task <task name>` command. Available tasks: `deno.json`.
- `express.js` and `stdio` MCP: Tool meant to be called by agents first. Not a web application.

## Context Management Rules

- Read Limit: Max 500 lines/operation; use offset/limit for larger files.
- Ref Limits: Max 2 reference files active at once.
- Tools: Proactively invoke available tools and functions for searching and memory storage.
- Tasks: On high context noise or end of assessment, break down session into tasks and write in `tasks/todo.md` for external agent hand-off. Remove outdated content when finished.

## When Working with Documentation

1. Check the `.roo/skills/` directory for relevant skills
2. Load skill instructions first (small, <5000 tokens)
3. Use skill guidance to identify which sections of large files to read
4. Never load complete reference documentation without user direction

## Architecture

Three layers. Dependency arrows point inward only — inner layers never import outer.

```text
Tool Handlers   src/tools/
     │
     ▼
Services        src/services/   (config, resolver, pagination, formatters, readiness)
     │
     ▼
GitHub Adapter  src/services/github.ts  ←  GraphQL + REST
```

- **Entry point:** [`src/index.ts`](src/index.ts) — bootstraps McpServer, registers tools, selects transport
- **Domain types:** [`src/types.ts`](src/types.ts) — all Scrum and GraphQL response types
- **Tool schemas:** [`src/schemas/scrum.ts`](src/schemas/scrum.ts) — Zod input validation, all `.strict()`
- **Full layer contract and migration phases:** [`tasks/REFACTORING.md`](tasks/REFACTORING.md)

## Code Style

- Imports: Full relative paths with .ts extension; no bare specifiers.
- Naming: `PascalCase` types, `camelCase` functions/vars, `UPPER_SNAKE_CASE` constants.
- Functions: Arrow functions only `(const fn = (arg: Type): Return => {})`.
- Error handling: Throw `GitHubApiError`; handlers return structured text response via format helper.
- Zod schemas: Enforce `.strict()` to reject unknown keys.

## CI — Run Before Every Commit

`.github/workflows/pr-check.yml`
