# AGENT.md

Guidance for coding agents working in this repository.

## Reference Documents

- [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) — Domain model, tool surface, and server architecture.
- [`tasks/REFACTORING.md`](tasks/REFACTORING.md) — Ongoing adapter refactoring plan.
- [`tasks/TODO.md`](tasks/TODO.md) — Active work items.
- [`README.md`](README.md) — Installation and usage.

## Layer Contract

Handler → Use-case → Adapter. A handler that imports GraphQL queries, `loadConfig`, or raw GitHub types is a layer breach — fix before shipping.

Production code under `src/scrum/` and `src/tools/` must not import adapters. Cross-layer test code lives under [`src/test/`](src/test/). Validate with `deno task depcruise`.

## Deno Module Conventions

- MCP SDK imports end in `.js` (CJS interop — do **not** change to `.ts`): `@modelcontextprotocol/sdk/server/mcp.js`
- Third-party packages declared in `deno.json` import map only; no CDN bare URLs.
- Permissions: do not add `--allow-*` flags beyond what existing tasks already declare.

## Zod

Validation happens at the handler boundary — use-cases receive typed values, not raw input. Tool output schemas live in [`src/schemas/scrum-outputs.ts`](src/schemas/scrum-outputs.ts) and are registered as `outputSchema` on each `scrum_*` tool definition.

## Error Handling

- Wrap unknown errors at the handler boundary with `enrichError()` ([`src/services/error-enrichment.ts`](src/services/error-enrichment.ts)).
- Handlers return plain structured text — **never throw to the MCP transport**.

## Logging and Transport Safety

- The server runs both `stdio` and Streamable HTTP transports simultaneously.
- Never use `console.log` — it pollutes `stdio` and breaks the MCP wire format.
- Use `log.*` from [`src/services/logger.ts`](src/services/logger.ts); it gates output on `DEBUG` / `TRACE` env vars.

## Testing

Run the full suite with `deno task test` (~257 tests, no network required for CI).

### Where tests live (two-bucket rule)

| Bucket                  | Location                                                                                      | Rule                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Unit / single-layer** | Co-located `*.test.ts` next to the module                                                     | May only import inward (same layer, domain, services). Example: `item-filter.test.ts` beside `item-filter.ts`. |
| **Cross-layer**         | [`src/test/support/`](src/test/support/) helpers + [`src/test/tools/`](src/test/tools/) tests | May import across layers (adapters, tools, schemas). Never add these imports to production modules.            |

GitHub adapter test spies and config factories: [`src/test/support/github-client.ts`](src/test/support/github-client.ts) (`createGhSpy`, `makeConfig`, `makeCtx`).

`src/tools/` contains handlers only — no `*.test.ts` files.

### Test layers

| Layer                   | What it tests                                      | Backend                                  |
| ----------------------- | -------------------------------------------------- | ---------------------------------------- |
| Use-case / adapter unit | Pure logic, mappers, filters, mutations            | Stub `ProjectBackend` or Tier 1 fixtures |
| Tool-surface contract   | All 12 `scrum_*` handlers return schema-valid JSON | `ConfigShapedFakeBackend`                |
| Tool-surface golden     | Stable agent-visible JSON for read tools           | Fake backend + committed snapshots       |
| Captured data           | Handlers against real port responses               | `CapturedDataBackend`                    |

Do **not** mock the GitHub adapter with hand-rolled stubs in integration paths. Use either:

- **`ConfigShapedFakeBackend`** ([`src/test/support/fake-backend.ts`](src/test/support/fake-backend.ts)) — in-memory backend seeded from `.github/scrum/config.yml`.
- **`CapturedDataBackend`** ([`src/test/support/captured-backend.ts`](src/test/support/captured-backend.ts)) — replays real port responses captured from a live backend. Construct with `CapturedDataBackend.fromProfile(CAPTURED.profiles["config"])`.

### `src/test/support/` — cross-layer helpers (not tests)

| Module                                                              | Role                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`scrum-test-utils.ts`](src/test/support/scrum-test-utils.ts)       | `committedScrumConfigPromise`, `committedFakeBackendPromise`, `capturedBackendPromise`, `withTestServer` |
| [`github-client.ts`](src/test/support/github-client.ts)             | `createGhSpy`, `makeConfig`, `makeCtx` for adapter unit tests                    |
| [`handler-assertions.ts`](src/test/support/handler-assertions.ts)   | `assertHandlerSchema`, `assertMcpToolOutput`, `parseHandlerPayload`              |
| [`config-profile.ts`](src/test/support/config-profile.ts)           | Derives vocabulary/status expectations from committed config                     |
| [`contract-assertions.ts`](src/test/support/contract-assertions.ts) | `assertOrientMatchesConfig`, `assertFindItemsMatchesConfig`                      |
| [`fake-backend.ts`](src/test/support/fake-backend.ts)               | In-memory `ProjectBackend` for handler tests                                     |
| [`captured-backend.ts`](src/test/support/captured-backend.ts)       | Read-only `ProjectBackend` that replays real port responses from `captured.json` |

### `src/test/tools/` — tool-surface tests

| File                                                                            | Purpose                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`scrum-read.contract.test.ts`](src/test/tools/scrum-read.contract.test.ts)     | Read tools — Zod schema + config contract (fake backend)            |
| [`scrum-read.captured.test.ts`](src/test/tools/scrum-read.captured.test.ts)   | Read tools — Zod schema against captured port data                  |
| [`scrum-write.contract.test.ts`](src/test/tools/scrum-write.contract.test.ts)   | 7 write tools — Zod schema                                          |
| [`scrum-read.golden.test.ts`](src/test/tools/scrum-read.golden.test.ts)         | Golden snapshots for `scrum_orient`, `scrum_find_items`             |
| [`scrum-mcp.integration.test.ts`](src/test/tools/scrum-mcp.integration.test.ts) | `CallTool` through MCP SDK + InMemoryTransport (output validation)  |

Handlers are exported from [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts) and [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts). Contract tests call handlers directly but must assert `structuredContent` (see `assertHandlerSchema`). [`scrum-mcp.integration.test.ts`](src/test/tools/scrum-mcp.integration.test.ts) exercises the full MCP `CallTool` path.

### Adding or changing a tool

1. Add or update the output schema in [`src/schemas/scrum-outputs.ts`](src/schemas/scrum-outputs.ts) (always `.strict()`).
2. Register `outputSchema` on the tool definition in `src/tools/`.
3. Add a contract test in `src/test/tools/*.contract.test.ts` using `assertHandlerSchema` (validates `structuredContent`, text JSON, and MCP `.shape` parsing).
4. For read tools, consider extending `scrum-mcp.integration.test.ts` if the tool introduces new output-schema edge cases.
5. For read tools with config-coupled vocabulary, also call `assertOrientMatchesConfig` / `assertFindItemsMatchesConfig`.
6. Run `deno task test`, `deno lint`, and `deno task depcruise`.

### Golden snapshots

Snapshots live in [`src/test/tools/__snapshots__/`](src/test/tools/__snapshots__/). They are committed — normal `deno task test` does not need `--allow-write`.

To regenerate after intentional output changes:

```bash
deno test --allow-env=DEBUG,GITHUB_TOKEN,NODE_ENV --allow-net --allow-read --allow-write \
  src/test/tools/scrum-read.golden.test.ts -- --update
```

Pass `-- --update` (after `--`) — not a top-level `deno test` flag.

### Fixture architecture

All fixtures live under [`src/test/fixtures/`](src/test/fixtures/). Import via `@test/fixtures/` (see `deno.json` import map).

| Subfolder | Contents | Consumers |
| --------- | -------- | --------- |
| [`github/`](src/test/fixtures/github/) | Hand-authored `ProjectItem` GraphQL nodes (`FIXTURE_ITEM_222`, `FIXTURE_NODES`, `FIXTURE_PAGE_1`, …) | Adapter unit tests only |
| [`port/`](src/test/fixtures/port/) | `captured.json` + typed `CAPTURED` / `FIXTURE_*` exports | `CapturedDataBackend`, captured contract tests |
| [`scrum/`](src/test/fixtures/scrum/) | Template content and `ContentLocation` constants | Scrum pipeline / template tests |

Use `capturedBackendPromise` from `scrum-test-utils.ts` (or `CapturedDataBackend.fromProfile(CAPTURED.profiles["config"])`) for read-path tests against real port responses.

**Refreshing captured.json** (requires `GITHUB_TOKEN`):

```bash
deno task capture-fixtures -- .github/scrum/config.yml
# Multiple configs (each becomes a named profile in captured.json):
deno task capture-fixtures -- .github/scrum/config.yml .github/scrum/org-config.yml
```

`captured.json` is committed. Re-run after any change to the port interface (`ProjectBackend`) or when real board data needs refreshing. The file is marked `linguist-generated=true` in `.gitattributes`.

## Commands

```bash
deno lint                          # must pass before marking any task complete
deno fmt --check                   # format check (run `deno fmt` to fix)
deno check src/                    # type-check
deno task test                     # full test suite
deno test src/test/tools/          # tool-surface tests only (22 tests)
deno task capture-fixtures -- .github/scrum/config.yml  # refresh captured.json
deno task compile                  # compile binary for current platform
deno task build:all                # all platform binaries + Node/MCPB bundles
deno task depcruise                # architecture boundary check (must pass)
```

## Code Style

- **Imports:** Full relative paths with `.ts` extension; no bare specifiers for local modules.
- **MCP SDK:** Imports from `@modelcontextprotocol/sdk/*` MUST end in `.js` (CJS interop).
- **Naming:** `PascalCase` types · `camelCase` functions/vars · `UPPER_SNAKE_CASE` constants.
- **Functions:** Arrow only — `const fn = (arg: Type): Return => {}`.
- **Zod:** Always `.strict()` on object schemas.
- **Types:** No inline concrete types; define named types. Compose or extend existing ones.
- **Lint:** `no-explicit-any` and `eqeqeq` are enforced — avoid `any` and loose equality.
- **Errors:** Throw `AdapterError` subclasses; handlers wrap with [`enrichError()`](src/services/error-enrichment.ts). Never throw to the MCP transport.

## Non-Obvious Conventions

- **`console.log` is FORBIDDEN** — use `log.*` from [`src/services/logger.ts`](src/services/logger.ts) (stderr). `DEBUG=1` enables debug; `TRACE=1` enables raw JSON-RPC wire tracing.
- **[`pickDefined()`](src/services/pick-defined.ts)** — `null` is included (explicit clear intent); `undefined` is excluded.
- **[`assertNever()`](src/domain/errors.ts)** — exhaustive switch guard for discriminated unions.
- **Port interface:** [`src/scrum/ports.ts`](src/scrum/ports.ts) is THE contract. Use-cases depend only on this, never on adapter internals.
