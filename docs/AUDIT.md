# Architecture Audit Report

**Generated:** 2026-06-04T12:19:02.059Z
**Commit:** `6e25479`
**Source directory:** `./src`

## Architecture Compliance

Modules scanned: **144**

| Rule | Severity | Status | Violations |
|------|----------|--------|------------|
| schemas-must-not-depend-on-src | error | 🔴 Fail | 1 |
| domain-must-not-depend-on-inner-layers | error | 🟢 Pass | 0 |
| use-case-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| services-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| adapters-must-not-depend-on-tools-schemas-server | error | 🟢 Pass | 0 |
| tools-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| no-circular-dependencies | error | 🟢 Pass | 0 |
| owner-graphql-no-query-builder | error | 🟢 Pass | 0 |
| project-items-response-types-is-leaf | error | 🟢 Pass | 0 |
| platform-request-is-leaf | error | 🟢 Pass | 0 |
| no-console-log | error | 🟢 Pass | 0 |

### Violation Details

**schemas-must-not-depend-on-src** (1 violations)
  - `src/schemas/scrum.test.ts`

## Stability (Instability) Metrics

_Instability (I) measures outgoing dependencies. I=0 means the module depends on nothing (highly stable); I=1 means it depends on many things (fragile)._

| Module | Layer | I | Risk |
|--------|-------|---|------|
| `src/adapters/capabilities.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/bootstrap-field-sources.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/bootstrap-iterations.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/assemblers/assembler-pipeline.integration.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/assemblers/direct-lookup-assembler.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/assemblers/project-items-assembler.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/board-item-projection.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/display-helpers.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/field-value-mutator.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/filter-strategy-router.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/fixture-replay/load-manifest.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/fixture-replay/query-hash.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/fixture-replay/recording-client.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/item-filter.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/label-resolver.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/owner-graphql.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/pagination.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/project-items-cache.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/project-items-query-builder.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/resolve-issue-number.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/search-query-builder.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/search-result-normalizer.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/story-mutation-service.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/story-query-service.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/internal/user-milestone-resolver.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/adapters/github/mappers-aggregate.test.ts` | adapter | 1.00 | 🔴 high-risk |
| `src/domain/content-location.test.ts` | domain | 1.00 | 🔴 high-risk |
| `src/schemas/scrum.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/scrum/fetch-location.test.ts` | use-case | 1.00 | 🔴 high-risk |
| `src/scrum/resolve-location.test.ts` | use-case | 1.00 | 🔴 high-risk |
| `src/scrum/template-pipeline.test.ts` | use-case | 1.00 | 🔴 high-risk |
| `src/scrum/template-resource.test.ts` | use-case | 1.00 | 🔴 high-risk |
| `src/server.ts` | entrypoint | 1.00 | 🔴 high-risk |
| `src/services/pick-defined.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/support/config-profile.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/tools/scrum-bridge.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/tools/scrum-mcp.integration.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/tools/scrum-read.contract.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/tools/scrum-read.golden.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/tools/scrum-write.contract.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/tools/handlers/write.test.ts` | framework | 1.00 | 🔴 high-risk |
| `src/adapters/github/backend.ts` | adapter | 0.96 | 🔴 high-risk |
| `src/adapters/github/create-backend.ts` | adapter | 0.94 | 🔴 high-risk |
| `src/test/support/fixture-backend.ts` | framework | 0.92 | 🔴 high-risk |
| `src/tools/handlers/read.ts` | framework | 0.90 | 🔴 high-risk |
| `src/adapters/github/internal/burndown-calculator.ts` | adapter | 0.86 | 🔴 high-risk |
| `src/adapters/github/factory.ts` | adapter | 0.86 | 🔴 high-risk |
| `src/scrum/orient.ts` | use-case | 0.86 | 🔴 high-risk |
| `src/adapters/github/internal/analytics-service.ts` | adapter | 0.85 | 🔴 high-risk |
| `src/adapters/github/internal/board-health-service.ts` | adapter | 0.83 | 🔴 high-risk |
| `src/test/support/fake-backend.ts` | framework | 0.82 | 🔴 high-risk |
| `src/adapters/github/internal/assemblers/search-api-assembler.ts` | adapter | 0.81 | 🔴 high-risk |
| `src/adapters/github/internal/impediment-service.ts` | adapter | 0.80 | 🔴 high-risk |
| `src/adapters/github/internal/file-reader.ts` | adapter | 0.80 | 🔴 high-risk |
| `src/tools/handlers/write.ts` | framework | 0.80 | 🔴 high-risk |
| `src/adapters/github/internal/vocabulary-manager.ts` | adapter | 0.78 | 🟡 moderate |
| `src/adapters/github/internal/epic-service.ts` | adapter | 0.75 | 🟡 moderate |
| `src/adapters/github/internal/fixture-replay/fixture-replay-client.ts` | adapter | 0.75 | 🟡 moderate |
| `src/scrum/get-story.ts` | use-case | 0.75 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/direct-lookup-assembler.ts` | adapter | 0.73 | 🟡 moderate |
| `src/adapters/github/internal/story-mutation-service.ts` | adapter | 0.73 | 🟡 moderate |
| `src/adapters/abstract-backend.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/project-items-cache.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/pagination.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/extractors.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/sprint-history-service.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/resolve-issue-number.ts` | adapter | 0.67 | 🟡 moderate |
| `src/scrum/find-items.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/get-analytics.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/get-board-health.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/update-impediment.ts` | use-case | 0.67 | 🟡 moderate |
| `src/adapters/github/internal/story-query-service.ts` | adapter | 0.63 | 🟡 moderate |
| `src/adapters/factory.ts` | adapter | 0.63 | 🟡 moderate |
| `src/adapters/github/internal/assembler-output.ts` | adapter | 0.63 | 🟡 moderate |
| `src/tools/scrum-write.ts` | framework | 0.63 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/mixed-assembler.ts` | adapter | 0.60 | 🟡 moderate |
| `src/adapters/github/internal/config-reloader.ts` | adapter | 0.60 | 🟡 moderate |
| `src/adapters/github/internal/project-items-query-builder.ts` | adapter | 0.57 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/project-items-assembler.ts` | adapter | 0.56 | 🟡 moderate |
| `src/adapters/github/internal/item-filter.ts` | adapter | 0.56 | 🟡 moderate |
| `src/adapters/github/internal/field-value-mutator.ts` | adapter | 0.55 | 🟡 moderate |
| `src/test/support/config-profile.ts` | framework | 0.55 | 🟡 moderate |
| `src/scrum/listing-mappers.ts` | use-case | 0.50 | 🟡 moderate |
| `src/adapters/github/internal/burndown-completion.ts` | adapter | 0.50 | 🟡 moderate |
| `src/adapters/github/internal/result-normalizer.ts` | adapter | 0.50 | 🟡 moderate |
| `src/scrum/config-boot.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/template-resource.ts` | use-case | 0.50 | 🟡 moderate |
| `src/adapters/github/internal/user-milestone-resolver.ts` | adapter | 0.45 | 🟡 moderate |
| `src/tools/scrum-read.ts` | framework | 0.45 | 🟡 moderate |
| `src/test/support/scrum-test-utils.ts` | framework | 0.44 | 🟡 moderate |
| `src/adapters/github/mappers.ts` | adapter | 0.44 | 🟡 moderate |
| `src/scrum/resolve-location.ts` | use-case | 0.43 | 🟡 moderate |
| `src/scrum/fetch-location.ts` | use-case | 0.43 | 🟡 moderate |
| `src/adapters/github/internal/owner-graphql.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/resolver.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/filter-strategy-router.ts` | adapter | 0.40 | 🟡 moderate |
| `src/test/support/contract-assertions.ts` | framework | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/label-resolver.ts` | adapter | 0.36 | 🟡 moderate |
| `src/scrum/url-rewriters.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/bootstrap-field-sources.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/iteration-classifier.ts` | adapter | 0.33 | 🟡 moderate |
| `src/scrum/sprint-math.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/board-item-projection.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/search-result-normalizer.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/bootstrap.ts` | adapter | 0.30 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/types.ts` | adapter | 0.30 | 🟡 moderate |
| `src/schemas/scrum.ts` | framework | 0.29 | 🟡 moderate |
| `src/adapters/github/internal/project-items-response-types.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/search-query-builder.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/_test_utils.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/fixture-replay/load-manifest.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/board-scan-coordinator.ts` | adapter | 0.23 | 🟡 moderate |
| `src/services/error-enrichment.ts` | framework | 0.22 | 🟡 moderate |
| `src/adapters/github/internal/execution-engine.ts` | adapter | 0.22 | 🟡 moderate |
| `src/adapters/github/internal/http-client.ts` | adapter | 0.20 | 🟢 low-risk |
| `src/test/tools/contract-test-utils.ts` | framework | 0.20 | 🟢 low-risk |
| `src/adapters/github/internal/infra-context.ts` | adapter | 0.19 | 🟢 low-risk |
| `src/schemas/scrum-outputs.ts` | framework | 0.14 | 🟢 low-risk |
| `src/scrum/ports.ts` | use-case | 0.08 | 🟢 low-risk |
| `src/domain/config.ts` | domain | 0.08 | 🟢 low-risk |
| `src/adapters/github/errors.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/domain/errors.ts` | domain | 0.07 | 🟢 low-risk |
| `src/adapters/github/queries.ts` | adapter | 0.07 | 🟢 low-risk |
| `src/adapters/github/types.ts` | adapter | 0.06 | 🟢 low-risk |
| `src/_deno-shim.node.ts` | framework | 0.00 | 🟢 low-risk |
| `src/domain/types.ts` | domain | 0.00 | 🟢 low-risk |
| `src/domain/content-location.ts` | domain | 0.00 | 🟢 low-risk |
| `src/adapters/capabilities.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/github-types.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/operations.graphql` | adapter | 0.00 | 🟢 low-risk |
| `src/services/logger.ts` | framework | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/platform-request.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/concurrent.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/domain/rules/readiness.ts` | domain | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/__fixtures__/project-items-p1.json` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/__fixtures__/project-items-p2.json` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/__fixtures__/user-node-ids.json` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/fixture-replay/query-hash.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/fixture-replay/types.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/domain/rules/acceptance-criteria.ts` | domain | 0.00 | 🟢 low-risk |
| `src/schemas/inputs.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/_mcp_result.ts` | framework | 0.00 | 🟢 low-risk |
| `src/services/pick-defined.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/_snapshot_normalize.ts` | framework | 0.00 | 🟢 low-risk |

## File Statistics

| Layer | Files | Total LOC | Top 3 Largest |
|-------|-------|-----------|---------------|
| adapter | 61 | 9020 | `adapters/github/mappers.ts` (646 LOC), `adapters/github/bootstrap.ts` (524 LOC), `adapters/github/types.ts` (489 LOC) |
| framework | 19 | 3010 | `schemas/scrum.ts` (478 LOC), `test/support/fake-backend.ts` (457 LOC), `schemas/scrum-outputs.ts` (355 LOC) |
| use-case | 14 | 1451 | `scrum/ports.ts` (454 LOC), `scrum/orient.ts` (221 LOC), `scrum/sprint-math.ts` (168 LOC) |
| domain | 6 | 1120 | `domain/types.ts` (725 LOC), `domain/config.ts` (125 LOC), `domain/rules/readiness.ts` (95 LOC) |
| entrypoint | 1 | 487 | `server.ts` (487 LOC) |

## Unused Exports

**Total unused exports:** 37

| File | Export | Kind |
|------|--------|------|
| `src/scrum/sprint-math.ts` | buildSprintMeta | function |
| `src/scrum/ports.ts` | StoryListing | interface |
| `src/scrum/resolve-location.ts` | SupportedConfigExtension | type |
| `src/scrum/resolve-location.ts` | SupportedTemplateExtension | type |
| `src/tools/scrum-read.ts` | SCRUM_READ_TOOL_NAMES | var |
| `src/tools/scrum-write.ts` | SCRUM_WRITE_TOOL_NAMES | var |
| `src/test/support/fixture-backend.ts` | validateFixtureReplay | function |
| `_deno-shim.node.ts` | addEventListener | function |
| `_deno-shim.node.ts` | Deno | var |
| `src/schemas/inputs.ts` | GraphQLQuerySchema | var |
| `src/adapters/factory.ts` | createBackend | function |
| `src/adapters/github/queries.ts` | ADD_PROJECT_ITEM_MUTATION | var |
| `src/adapters/github/queries.ts` | GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | CREATE_ISSUE_MUTATION | var |
| `src/adapters/github/mappers.ts` | toSprintInfo | function |
| `src/adapters/github/internal/fixture-replay/load-manifest.ts` | loadFixtureJson | function |
| `src/adapters/github/internal/fixture-replay/recording-client.ts` | RecordingGitHubClient | class |
| `src/adapters/github/internal/fixture-replay/recording-client.ts` | mergeWireEntries | function |
| `src/adapters/github/internal/display-helpers.ts` | resolveTerminalDisplay | function |
| `src/adapters/github/internal/display-helpers.ts` | resolveHighestPriorityDisplay | function |
| `src/adapters/github/internal/label-resolver.ts` | RepoNodeIdProvider | interface |
| `src/adapters/github/internal/execution-engine.ts` | SPRINT_PAGINATION_POLICY | var |
| `src/adapters/github/factory.ts` | GitHubAdapterFactory | class |
| `src/adapters/github/types.ts` | GitHubMilestoneId | type |
| `src/adapters/github/types.ts` | toEntityRef | function |
| `src/adapters/github/types.ts` | ItemContentType | type |
| `src/adapters/github/types.ts` | PrState | type |
| `src/adapters/github/types.ts` | IssueRef | type |
| `src/adapters/github/types.ts` | LabelRef | type |
| `src/domain/content-location.ts` | ContentLocationKind | type |
| `src/domain/types.ts` | ItemListing | type |
| `src/domain/types.ts` | SprintTotalsKind | type |
| `src/services/error-enrichment.ts` | enrichError | function |

---

*Report generated by `deno task audit`. Do not edit manually.*