# TypeScript · MCP · Deno — Technical Standards

These rules apply in every mode when reading or producing code in this repository.

## MCP Tool Handler Contract

Every tool follows **parse → delegate → format**. No handler does GitHub I/O directly.

- **Framework**
  - Path: `src/tools/`
  - Responsibility:
    - Parse Zod params
    - Call use-case
    - Return formatted text

- **Use-Case**
  - Paths: `src/scrum/`, `src/domain/`
  - Responsibility:
    - Orchestration
    - Domain rules
    - No GitHub types

- **Adapter**
  - Path: `src/adapters/`
  - Responsibility:
    - `GitHubProjectBackend`
    - All GitHub API calls

- **Schemas**
  - Path: `src/schemas/`
  - Responsibility:
    - Zod schemas only
    - Imported by tools and use-cases

Violation signals: a handler that imports GraphQL queries, `loadConfig`, or any raw GitHub
type is a layer breach — fix it before shipping.

## Deno Module Conventions

- Local imports: full relative paths ending in `.ts` (e.g. `../scrum/ports.ts`).
- MCP SDK imports end in `.js` (CJS interop requirement — do **not** change to `.ts`):
  `@modelcontextprotocol/sdk/server/mcp.js`
- Third-party packages declared in `deno.json` import map only; no CDN bare URLs.
- Permissions: do not add `--allow-*` flags beyond what `deno.json` already declares.

## Zod

- All schemas in `src/schemas/`. Every object schema uses `.strict()`.
- Schemas are named to match their tool: `GetSprintSchema`, `CreateStorySchema`.
- Validation happens at the handler boundary — use-cases receive typed values, not raw input.

## Error Handling

- Throw `GitHubApiError` for GitHub API failures (`src/domain/errors.ts`).
- Wrap unknown errors at handler boundary with `enrichError()` (`src/services/error-enrichment.ts`).
- Handlers return plain structured text — **never throw to the MCP transport**.

## Logging and Transport Safety

- The server runs both `stdio` and `StreamableHTTP` transports simultaneously.
- Never use `console.log` — it pollutes `stdio` and breaks the MCP wire format.
- Use `log.*` from `src/services/logger.ts`; it gates output on `DEBUG` / `TRACE` env vars.

## Testing

- Test files: co-located `*.test.ts` or under `src/`. Run with `deno test`.
- Use-cases are unit-tested with a stub `ProjectBackend` (pure TypeScript, no network).
- Do not mock the GitHub adapter in integration paths — use fixture data or real API calls.