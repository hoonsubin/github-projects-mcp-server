# AGENTS.md — Debug Mode

This file provides guidance to agents in Debug mode in this repository.

## Debugging Non-Obvious Gotchas

- **`console.log` breaks the MCP wire format.** The server runs stdio transport — any stdout output appears as invalid JSON-RPC to the client. All logging goes through [`src/services/logger.ts`](src/services/logger.ts) to stderr.
- **Transport output visibility:** Set `DEBUG=1` for API-level tracing (tool calls, GraphQL operations), `TRACE=1` for raw JSON-RPC wire dumps.
- **Unhandled rejections:** [`src/server.ts`](src/server.ts) registers an `unhandledrejection` listener that writes to stderr. Stdout is never touched — even catastrophic failures emit valid JSON-RPC error responses via `emitJsonRpcError()`.
- **Degraded mode:** When config is missing, the server registers stub handlers for all `scrum_*` tools. Each returns a human-readable error — no crash, session stays alive. Look for `log.warn` with hint "degraded mode".
- **Deno permissions:** Running `deno run` without `--allow-env` produces a `PermissionDenied` error. The compiled binary has baked-in permissions.
- **MCP SDK import extension:** If you see module resolution errors for `@modelcontextprotocol/sdk/*`, check that imports end in `.js` not `.ts` — the SDK uses CJS interop.
