# AGENT.md

Guidance for coding agents working in this repository. Concise by design — see linked documents for depth.

## Reference Documents

| Document                                                                 | Contents                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`README.md`](README.md)                                                 | Project vision, domain model, full tool surface design, interaction patterns                                    |
| [`tasks/`](tasks/)                                                       | Architecture, phased roadmap, current implementation state per phase, user stories, and small broken-down tasks |
| [`docs/proj-diagram.md`](docs/proj-diagram.md)                           | Current state of the project class diagram and tracking unused exports. Use as ToC of the project               |
| [`.github/scrum/config.yml`](.github/scrum/config.yml)                   | Team, sprint, field names, vocabulary, DoR/DoD, autonomy settings                                               |
| [`deno.json`](deno.json)                                                 | Tasks, import map, compiler options, formatter and linter config                                                |
| [`skill/scrum-master-agent/SKILL.md`](skill/scrum-master-agent/SKILL.md) | Agentic Scrum skill prompts and ceremony playbooks                                                              |

## Context Management Rules

- **File reading limit**: 500 lines per read operation
- **Reference file limit**: Maximum 2 files simultaneously
- **Chunking required**: Files >500 lines must use offset/limit
- **User confirmation**: Ask before reading files >1000 lines

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

| Rule               | Detail                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| **Imports**        | Full relative paths with `.ts` extension — no bare specifiers                                     |
| **Naming**         | `PascalCase` types · `camelCase` functions/vars · `UPPER_SNAKE_CASE` constants                    |
| **Functions**      | Arrow functions only: `const fn = (arg: Type): Return => {}`                                      |
| **Error handling** | Throw `GitHubApiError`; handlers return `{ content: [{ type: "text", text: formatError(err) }] }` |
| **Zod schemas**    | Always `.strict()` — unknown keys must be rejected                                                |
| **Comments**       | `// ── Section ──` for major sections · `// todo: [Phase N]` for deferred work                    |
| **Formatter**      | `deno fmt` — 100-char lines, 2-space indent, double quotes, semicolons                            |

## CI — Run Before Every Commit

```sh
deno fmt --check
deno lint
deno task diagram-gen
deno task test
```

These mirror the checks in [`.github/workflows/pr-check.yml`](.github/workflows/pr-check.yml).

## Environment Variables

| Variable        | Required | Default | Purpose                                                   |
| --------------- | -------- | ------- | --------------------------------------------------------- |
| `GITHUB_TOKEN`  | ✅       | —       | GitHub PAT; server exits on startup if missing            |
| `MCP_TRANSPORT` | —        | `stdio` | Set to `http` for HTTP/SSE mode (Open WebUI, Docker)      |
| `PORT`          | —        | `3000`  | HTTP mode port                                            |
| `DEBUG`         | —        | —       | Set to `1` for debug logging (GraphQL timing, tool calls) |
