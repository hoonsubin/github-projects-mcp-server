# Issue Creation Checklist — Fixture Capture Refactoring

## Pre-Creation Preparation

- [x] Review completed at [`tasks/FIXTURE_CAPTURE_REFACTORING.md`](tasks/FIXTURE_CAPTURE_REFACTORING.md) — corrections documented
- [x] Codebase investigation complete — all assumptions validated
- [ ] Epic issue stubbed (this plan serves as the epic)
- [ ] Individual feature planning complete

## Feature 1: Fixture Directory & Shim

Story-level checklist:

- [ ] 1.1 — Create [`src/test/__fixtures__/`](src/test/__fixtures__/) directory (`mkdir -p src/test/__fixtures__/`)
- [ ] 1.2 — Write [`src/test/__fixtures__/captured.json`](src/test/__fixtures__/captured.json) with skeleton JSON
- [ ] 1.3 — Write [`src/test/__fixtures__/index.ts`](src/test/__fixtures__/index.ts) with typed exports
- [ ] 1.4 — Verify: `deno task test` green, `deno lint` green

## Feature 2: Port-Only Capture Script

Story-level checklist:

- [ ] 2.1 — Delete [`scripts/capture/types.ts`](scripts/capture/types.ts)
- [ ] 2.2 — Delete [`scripts/capture/augment-config.yml`](scripts/capture/augment-config.yml)
- [ ] 2.3 — Create [`scripts/capture/slug.ts`](scripts/capture/slug.ts) with extracted `deriveConfigSlug(configPath: string): string`
- [ ] 2.4 — Rewrite [`scripts/capture-test-fixtures.ts`](scripts/capture-test-fixtures.ts) (port-only, no GraphQL, no GitHub internals)
- [ ] 2.5 — Update [`deno.json`](deno.json) capture-fixtures task with `--allow-write=src/test/__fixtures__`
- [ ] 2.6 — Run capture against `.github/scrum/config.yml`, `.github/scrum/org-config.yml`, remote config
- [ ] 2.7 — Verify `captured.json` has 3 populated profiles
- [ ] 2.8 — `deno task test` green, `deno lint` green

## Feature 3: CapturedDataBackend

Story-level checklist:

- [ ] 3.1 — Define `CAPTURED_CAPABILITIES` in [`src/adapters/capabilities.ts`](src/adapters/capabilities.ts) or [`captured-backend.ts`](src/test/support/captured-backend.ts)
- [ ] 3.2 — Create [`src/test/support/captured-backend.ts`](src/test/support/captured-backend.ts) with **ALL** abstract methods:
  - `reload()` — no-op
  - `getPlatformState()` — returns profile.platformState
  - `findItems()` — returns profile.findItems
  - `getStoryDetail()` — returns profile.itemDetails[id]
  - `composeStorySnapshot()` — return from getStoryDetail
  - `composeStoryAfterSetField()` — throw [`UnsupportedCapabilityError`](src/domain/errors.ts)
  - `composeStoryAfterStoryUpdate()` — throw [`UnsupportedCapabilityError`](src/domain/errors.ts)
  - `composeStoryAfterCreateStory()` — throw [`UnsupportedCapabilityError`](src/domain/errors.ts)
  - `getEpics()` — return empty
  - `getSprintCompletion()` — return empty
  - `getAnalytics()` — throw [`UnsupportedCapabilityError`](src/domain/errors.ts)
  - `getBoardHealth()` — return empty
  - `getSprintImpediments()` — return empty
  - `getOrphanImpediments()` — return empty
  - `createStory()` — throw
  - `createImpediment()` — throw
  - `updateStory()` — throw
  - `setField()` — throw
  - `addComment()` — throw
  - `addVocabulary()` — throw
  - `updateImpediment()` — throw
- [ ] 3.3 — Add `.gitattributes` entry: `src/test/__fixtures__/captured.json linguist-generated=true`
- [ ] 3.4 — `deno task test` green, `deno lint` green, `deno task depcruise` green

## Feature 4: Cleanup

Story-level checklist:

- [ ] 4.1 — Delete [`scripts/capture-output/`](scripts/capture-output/) directory
- [ ] 4.2 — Add `scripts/capture-output/` to [`.gitignore`](.gitignore)
- [ ] 4.3 — If [`scripts/capture/`](scripts/capture/) empty after slug.ts extraction, delete it
- [ ] 4.4 — Search for references to `capture-output`, `augment-config`, raw GraphQL in docs/comments
- [ ] 4.5 — `deno task test` green, `deno task depcruise` green

## Validation

- [ ] Full test suite: `deno task test`
- [ ] Lint: `deno lint`
- [ ] Format: `deno fmt --check`
- [ ] Type check: `deno check src/`
- [ ] Architecture boundaries: `deno task depcruise`
- [ ] End-to-end capture + backend validation (manual)
