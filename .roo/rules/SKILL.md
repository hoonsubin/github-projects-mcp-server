# TypeScript · MCP · Deno — Technical Standards

These rules apply in every mode when reading or producing code in this repository.

## Layer Contract

Handler → Use-case → Adapter. Violation signal: a handler that imports GraphQL queries,
`loadConfig`, or any raw GitHub type is a layer breach — fix it before shipping.

## Deno Module Conventions

- MCP SDK imports end in `.js` (CJS interop — do **not** change to `.ts`):
  `@modelcontextprotocol/sdk/server/mcp.js`
- Third-party packages declared in `deno.json` import map only; no CDN bare URLs.
- Permissions: do not add `--allow-*` flags beyond what `deno.json` already declares.

## Zod

Validation happens at the handler boundary — use-cases receive typed values, not raw input.

## Error Handling

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

## Ticket-First Gate

Trigger: any request implying new work or a change — "fix", "add", "implement", "refactor",
"flag", "create a ticket", or any code modification. Information-only requests do not trigger this.

**Sequence — always surface, never proceed silently:**

1. **Search** — call `scrum_get_backlog` (keyword from request) before any other action.
2. **Surface results** — show matches (title, status, type). Ask: "Is this the issue you mean,
   or something new?"
3. **Triage:**
   - Duplicate found → offer to update or reuse; never create a second ticket.
   - Related found → ask: sub-task, dependency link, or separate ticket?
   - No match → ask: expected outcome / AC, type, sprint or epic — then create using the
     type template and run `item-assessment.md §dor_check` before confirming.
4. **Confirm** the ticket is identified or created before any change proceeds.

**Bypass:** skip only when the human explicitly says "skip ticket", "no ticket", or
"bypass documentation".
