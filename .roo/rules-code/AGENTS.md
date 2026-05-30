# AGENTS.md — Code Mode

This file provides guidance to agents in Code mode in this repository.

## Layer Contract (Enforced)

```
Framework → Use-Case → Adapter (via ProjectBackend port)
```

- A handler importing GraphQL, `loadConfig`, or raw GitHub types is a layer breach.
- Validation at the handler boundary only — use-cases receive typed values, never raw Zod input.
- Use-cases depend exclusively on [`src/scrum/ports.ts`](src/scrum/ports.ts); never on adapter internals.

## Non-Obvious Coding Rules

- **`console.log` is FORBIDDEN.** It pollutes the MCP stdio protocol. Use `log.*` from [`src/services/logger.ts`](src/services/logger.ts) — all output to stderr.
- **MCP SDK imports end in `.js`** — `@modelcontextprotocol/sdk/server/mcp.js` — do not change to `.ts`.
- **[`pickDefined()`](src/services/pick-defined.ts)** — `null` passes through (explicit clear), `undefined` is filtered out.
- **[`assertNever()`](src/domain/errors.ts)** — use in `default` branch of discriminated union switches for exhaustiveness.
- **`AdapterError` subclasses** require `backendName`, `code`, and `recovery` fields. Throw from adapter; wrap at handler boundary with [`enrichError()`](src/services/error-enrichment.ts).
- **Zod schemas** — always `.strict()`; define in [`src/schemas/`](src/schemas/).
- **Tool names** — single source of truth in `SCRUM_READ_TOOL_NAMES` / `SCRUM_WRITE_TOOL_NAMES` exported from [`src/tools/`](src/tools/). Never hardcode.
