## Debt Description

Four locations cast `config.backends.github` then access arbitrary properties using `as Record<string, unknown>`:

1. [`src/domain/rules/status.ts:21`](src/domain/rules/status.ts:21): `const ghConfig = config.backends.github as Record<string, unknown>; const statusDisplay = (ghConfig.status_display as Record<string, string>) ?? {};`
2. [`src/tools/scrum-write.ts:36`](src/tools/scrum-write.ts:36): Same double-cast pattern for `priority_display`
3. [`src/scrum/orient.ts:64`](src/scrum/orient.ts:64): `const ghDisplay = scrumConfig.backends.github as GhDisplay | undefined;` — partially better: uses a locally-defined `GhDisplay` interface, but that interface is defined in the same function and is still unverified against the actual config shape
4. [`src/index.ts:40`](src/index.ts:40): `const _server = server as unknown as Record<string, any>;` — **worst case**: a double cast through `unknown` into `any`, which bypasses the type system entirely

The three production cast sites are inconsistent: `status.ts` and `scrum-write.ts` use raw `Record<string, string>` for property access; `orient.ts` at least uses a named interface. None are verified by the compiler.

## Cost of Deferral

- Silent runtime errors if config structure changes
- The `as` cast suppresses all type checking
- `any` cast in `index.ts:40` disables all downstream type checking
- Inconsistent patterns across the codebase

## Proposed Improvement

Define a `GitHubBackendConfig` interface with explicit optional properties in `src/adapters/github/` and use it consistently across all cast sites. Each caller should cast once via the typed interface rather than double-casting to `Record<string, unknown>`.

For the `index.ts:40` double cast: investigate why the cast is needed. If `_server` is truly unused (the underscore prefix convention), delete the line. If it is needed, find the correct type rather than casting to `any`.

## Acceptance Criteria

- [ ] `GitHubBackendConfig` interface defined with explicit optional properties
- [ ] `status.ts:21` uses the typed interface
- [ ] `scrum-write.ts:36` uses the typed interface
- [ ] `orient.ts:64` uses the typed interface (or removes the cast if unnecessary)
- [ ] `index.ts:40` cast removed or replaced with correct type
- [ ] `deno lint` passes with no errors
- [ ] `deno test` passes

## Notes

- Finding 18 from Clean Code Audit (2026-05-20)
- Also covers Finding 26 (double cast with `any` in `index.ts:40`)
- Smell code: G6 (Type erasure via unsafe casts)
