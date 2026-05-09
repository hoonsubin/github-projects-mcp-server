# AGENT.md

Guidance for coding agents working in this repository.
Concise by design — see linked documents for depth.

## Reference Documents

| Document                                                                 | Contents                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [`README.md`](README.md)                                                 | Project overview, domain model, full tool surface design, interaction patterns |
| [`tasks/REFACTORING.md`](tasks/REFACTORING.md)                           | Architecture, phased roadmap, current implementation state per phase           |
| [`.github/scrum/config.yml`](.github/scrum/config.yml)                   | Team, sprint, field names, vocabulary, DoR/DoD, autonomy settings              |
| [`deno.json`](deno.json)                                                 | Tasks, import map, compiler options, formatter and linter config               |
| [`skill/scrum-master-agent/SKILL.md`](skill/scrum-master-agent/SKILL.md) | Agentic Scrum skill prompts and ceremony playbooks                             |

## Managing This Project with Its Own Tools

This server registers itself as its own MCP client — see [`.roo/mcp.json`](.roo/mcp.json).
The active tool surface changes as migration phases complete — **always discover before acting**:

1. Call `tools/list` to see what is currently registered
2. Check [`src/index.ts`](src/index.ts) to confirm which tool modules are wired
3. Check [`tasks/REFACTORING.md`](tasks/REFACTORING.md) for phase status — it defines what is
   implemented, what is a stub, and what is planned
4. Use whatever tools are available; do not assume a specific tool exists until confirmed

**Stable interaction pattern regardless of surface:**

- Start with an orientation tool (`scrum_orient` or equivalent) if one is registered
- Read before writing — inspect sprint and backlog state before mutating anything
- Confirm with the user before bulk writes; respect the `autonomy` level in `.github/scrum/config.yml`

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
deno check src/
GITHUB_TOKEN=test-token deno test --allow-env=DEBUG,GITHUB_TOKEN --allow-net src/
```

These mirror the checks in [`.github/workflows/pr-check.yml`](.github/workflows/pr-check.yml).

## Environment Variables

| Variable        | Required | Default | Purpose                                                   |
| --------------- | -------- | ------- | --------------------------------------------------------- |
| `GITHUB_TOKEN`  | ✅       | —       | GitHub PAT; server exits on startup if missing            |
| `MCP_TRANSPORT` | —        | `stdio` | Set to `http` for HTTP/SSE mode (Open WebUI, Docker)      |
| `PORT`          | —        | `3000`  | HTTP mode port                                            |
| `DEBUG`         | —        | —       | Set to `1` for debug logging (GraphQL timing, tool calls) |
