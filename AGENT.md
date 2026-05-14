# AGENT.md

Guidance for coding agents working in this repository. Concise by design — see linked documents for depth.

## Reference Documents

- `README.md`: Project vision, domain model, tool surface design, interaction patterns.
- `docs/proj-diagram.md`: Module dependency diagram and unused export tracking.
- `skill/scrum-master-agent/SKILL.md`: Agentic Scrum prompts and ceremony playbooks.

## Tech Stack

- `Deno.js`: Use `deno task <task name>`. Available tasks: `deno.json`.
- `express.js` + `stdio` MCP: Called by agents, not a web application.

## Context & Tool Rules

- **Read:** Max 500 lines/op; use offset/limit for large files. Max 2 ref files active at once.
- **Tasks:** On high context noise, break into tasks → `tasks/TODO.md`. Remove outdated entries when done.
- **Skills:** Check `.roo/skills/` first; load skill file before any large doc.
- **Search:** `searxng_*` tool to search the web. `mempalance_*` tool or command to perform a semantic search of the project. Never assume. Think, search, confirm, before response.

## Architecture

Three layers. Inner layers never import outer.

```text
Tool Handlers   src/tools/
     ▼
Services        src/services/   (config, resolver, pagination, formatters, readiness)
     ▼
GitHub Adapter  src/services/github.ts  ←  GraphQL + REST
```

- **Entry:** `src/index.ts` — bootstraps McpServer, registers tools, selects transport
- **Types:** `src/types.ts` — all Scrum and GraphQL response types
- **Schemas:** `src/schemas/scrum.ts` — Zod input validation, all `.strict()`
- **Refactor plan:** `tasks/REFACTORING.md`

## Code Style

- Imports: Full relative paths with `.ts`; no bare specifiers.
- Naming: `PascalCase` types · `camelCase` functions/vars · `UPPER_SNAKE_CASE` constants.
- Functions: Arrow only — `const fn = (arg: Type): Return => {}`.
- Errors: Throw `GitHubApiError`; handlers return structured text via format helper.
- Zod: Always `.strict()`.

## Commonly Used Commands

```bash
# semantic search the project codebase
mempalace search "your search string"

# lint check
deno lint

# unit test
deno test

# code format check
deno fmt --check

# generate module dependency report
deno tast diagram-gen
```
