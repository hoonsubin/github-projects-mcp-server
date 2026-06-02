# AGENT.md

This file provides guidance to agents when working with code in this repository.

## Reference Documents

- [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) — Domain model, tool surface, agent behavior, and server architecture.
- [`tasks/REFACTORING.md`](tasks/REFACTORING.md) — Ongoing adapter refactoring plan (phases 0–4 + multi-backend).
- [`tasks/TODO.md`](tasks/TODO.md) — Active work items.
- [`README.md`](README.md) — Project installation.

## Layer Contract

Handler → Use-case → Adapter. Violation signal: a handler that imports GraphQL queries, `loadConfig`, or any raw GitHub type is a layer breach - fix it before shipping.

## Deno Module Conventions

- MCP SDK imports end in `.js` (CJS interop - do **not** change to `.ts`): `@modelcontextprotocol/sdk/server/mcp.js`
- Third-party packages declared in `deno.json` import map only; no CDN bare URLs.
- Permissions: do not add `--allow-*` flags beyond what `deno.json` already declares.

## Zod

Validation happens at the handler boundary - use-cases receive typed values, not raw input.

## Error Handling

- Wrap unknown errors at handler boundary with `enrichError()` (`src/services/error-enrichment.ts`).
- Handlers return plain structured text - **never throw to the MCP transport**.

## Logging and Transport Safety

- The server runs both `stdio` and `StreamableHTTP` transports simultaneously.
- Never use `console.log` - it pollutes `stdio` and breaks the MCP wire format.
- Use `log.*` from `src/services/logger.ts`; it gates output on `DEBUG` / `TRACE` env vars.

## Testing

- Test files: co-located `*.test.ts` or under `src/`. Run with `deno test`.
- Use-cases are unit-tested with a stub `ProjectBackend` (pure TypeScript, no network).
- Do not mock the GitHub adapter in integration paths - use fixture data or real API calls.

## Commands

```bash
deno lint                          # must pass before marking any task complete
deno fmt --check                   # format check (--check, not auto-fix)
deno task test
deno task diagram-gen              # regenerate module dependency diagrams
deno task compile:all              # cross-compile all platform binaries
```

## Code Style

- **Imports:** Full relative paths with `.ts` extension; no bare specifiers for local modules.
- **MCP SDK:** Imports from `@modelcontextprotocol/sdk/*` MUST end in `.js` (CJS interop).
- **Naming:** `PascalCase` types · `camelCase` functions/vars · `UPPER_SNAKE_CASE` constants.
- **Functions:** Arrow only — `const fn = (arg: Type): Return => {}`.
- **Zod:** Always `.strict()` on object schemas.
- **Types:** No inline concrete types; define named types. Compose or extend existing ones.
- **Lint:** `no-explicit-any` and `eqeqeq` are enforced — avoid `any` and loose equality.
- **Errors:** Throw `AdapterError` subclasses; handlers wrap with [`enrichError()`](src/services/error-enrichment.ts) to produce structured agent-readable text. Never throw to the MCP transport.

## Non-Obvious Conventions

- **`console.log` is FORBIDDEN** — it pollutes the MCP stdio wire protocol. Use `log.*` from [`src/services/logger.ts`](src/services/logger.ts) which writes to stderr. `DEBUG=1` enables debug level; `TRACE=1` enables raw JSON-RPC wire tracing.
- **[`pickDefined()`](src/services/pick-defined.ts)** — null ≠ undefined: `null` values ARE included (explicit clear intent), `undefined` values are excluded.
- **[`assertNever()`](src/domain/errors.ts)** — exhaustive switch guard for discriminated unions.
- **Port interface:** [`src/scrum/ports.ts`](src/scrum/ports.ts) is THE contract. Use-case functions depend only on this, never on adapter internals.

## Available MCP Servers

| Server                 | Use                                                          |
| ---------------------- | ------------------------------------------------------------ |
| **scrum-master**       | `scrum_*` tools (read always-allowed)                        |
| **mempalace**          | `mempalace_search` — semantic codebase search                |
| **sequentialthinking** | Structured reasoning before complex decisions                |
| **searxng**            | `searxng_web_search` — web search for unfamiliar APIs/errors |
