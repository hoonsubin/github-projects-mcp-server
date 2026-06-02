# AGENT.md

Guidance for coding agents working in this repository.

## Reference Documents

- [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) — Domain model, tool surface, and server architecture.
- [`tasks/REFACTORING.md`](tasks/REFACTORING.md) — Ongoing adapter refactoring plan.
- [`tasks/TODO.md`](tasks/TODO.md) — Active work items.
- [`README.md`](README.md) — Installation and usage.

## Layer Contract

Handler → Use-case → Adapter. A handler that imports GraphQL queries, `loadConfig`, or raw GitHub types is a layer breach — fix before shipping.

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

Test files are co-located `*.test.ts` under `src/`. Run the full suite with `deno task test` (~260 tests, no network required for CI).

### Layer overview

| Layer                   | What it tests                                      | Backend                                 |
| ----------------------- | -------------------------------------------------- | --------------------------------------- |
| Use-case / adapter unit | Pure logic, mappers, filters, mutations            | Stub `ProjectBackend` or fixture JSON   |
| Tool-surface contract   | All 12 `scrum_*` handlers return schema-valid JSON | `ConfigShapedFakeBackend`               |
| Tool-surface golden     | Stable agent-visible JSON for read tools           | Same fake backend + committed snapshots |
| Fixture bridge          | Handlers against captured GitHub wire replay       | `FixtureReplayClient` + manifest v2     |

Do **not** mock the GitHub adapter with hand-rolled stubs in integration paths. Use either:

- **`ConfigShapedFakeBackend`** ([`src/scrum/_fake_backend.ts`](src/scrum/_fake_backend.ts)) — in-memory backend seeded from `.github/scrum/config.yml` for fast handler tests.
- **Fixture replay** ([`src/scrum/fixture-backend.ts`](src/scrum/fixture-backend.ts)) — offline replay of captured GraphQL responses under [`src/adapters/github/internal/__fixtures__/`](src/adapters/github/internal/__fixtures__/).

### Tool-surface test files

| File                                                                               | Purpose                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`src/tools/scrum-read.contract.test.ts`](src/tools/scrum-read.contract.test.ts)   | 5 read tools — Zod schema + config contract             |
| [`src/tools/scrum-write.contract.test.ts`](src/tools/scrum-write.contract.test.ts) | 7 write tools — Zod schema                              |
| [`src/tools/scrum-read.golden.test.ts`](src/tools/scrum-read.golden.test.ts)       | Golden snapshots for `scrum_orient`, `scrum_find_items` |
| [`src/tools/scrum-bridge.test.ts`](src/tools/scrum-bridge.test.ts)                 | Fixture replay through orient/find_items handlers       |
| [`src/scrum/_config_profile.test.ts`](src/scrum/_config_profile.test.ts)           | Config boot + fake-backend smoke (infrastructure)       |

### Shared test infrastructure

| Module                                                                   | Role                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [`src/scrum/_test_utils.ts`](src/scrum/_test_utils.ts)                   | `committedScrumConfigPromise`, `committedFakeBackendPromise`, `committedFixtureBackendPromise` |
| [`src/scrum/_config_profile.ts`](src/scrum/_config_profile.ts)           | Derives vocabulary/status expectations from committed config                                   |
| [`src/scrum/_contract_assertions.ts`](src/scrum/_contract_assertions.ts) | `assertOrientMatchesConfig`, `assertFindItemsMatchesConfig`                                    |
| [`src/tools/_contract_test_utils.ts`](src/tools/_contract_test_utils.ts) | `assertHandlerSchema`, `parseHandlerPayload`                                                   |
| [`src/tools/_mcp_result.ts`](src/tools/_mcp_result.ts)                   | `parseToolText`, `formatZodError` — unwrap MCP text results in tests                           |
| [`src/tools/_snapshot_normalize.ts`](src/tools/_snapshot_normalize.ts)   | Strips volatile fields before golden/bridge comparison                                         |

Handlers are exported from [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts) and [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts) for contract tests. Prefer calling handlers directly — not the MCP registration layer.

### Adding or changing a tool

1. Add or update the output schema in [`src/schemas/scrum-outputs.ts`](src/schemas/scrum-outputs.ts) (always `.strict()`).
2. Register `outputSchema` on the tool definition.
3. Add a contract test in the appropriate `*.contract.test.ts` file using `assertHandlerSchema`.
4. For read tools with config-coupled vocabulary, also call `assertOrientMatchesConfig` / `assertFindItemsMatchesConfig` where applicable.
5. Run `deno task test` and `deno lint`.

### Golden snapshots

Snapshots live in [`src/tools/__snapshots__/`](src/tools/__snapshots__/). They are committed — normal `deno task test` does not need `--allow-write`.

To regenerate after intentional output changes:

```bash
deno test --allow-env=DEBUG,GITHUB_TOKEN,NODE_ENV --allow-net --allow-read --allow-write \
  src/tools/scrum-read.golden.test.ts -- --update
```

Pass `-- --update` (after `--`) — not a top-level `deno test` flag.

### Fixture capture and validation

Captured fixtures are under `src/adapters/github/internal/__fixtures__/`. Refresh from live GitHub (requires `GITHUB_TOKEN`):

```bash
deno task capture-fixtures --config .github/scrum/config.yml              # wire + scenarios
deno task capture-fixtures --config .github/scrum/config.yml --mode wire  # wire only
deno task capture-fixtures --config .github/scrum/config.yml --mode validate  # offline replay check
```

After changing fixtures or adding wire hashes, run `--mode validate` and `src/tools/scrum-bridge.test.ts`. If runtime GraphQL variables differ from capture defaults (e.g. optional `first`), add a manifest alias entry pointing to the same wire JSON file.

## Commands

```bash
deno lint                          # must pass before marking any task complete
deno fmt --check                   # format check (run `deno fmt` to fix)
deno check src/                    # type-check
deno task test                     # full test suite
deno test src/tools/               # tool-surface tests only (23 tests)
deno task capture-fixtures --config .github/scrum/config.yml --mode validate
deno task compile                  # compile binary for current platform
deno task build:all                # all platform binaries + Node/MCPB bundles
deno task depcruise                # module dependency graph (optional)
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
