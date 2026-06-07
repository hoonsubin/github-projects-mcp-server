# Architecture Audit Report

**Generated:** 2026-06-07T15:23:23.099Z
**Commit:** `13f6a56`
**Source directory:** `./src`

## Architecture Compliance

Modules scanned: **138**

| Rule | Severity | Status | Violations |
|------|----------|--------|------------|
| domain-must-not-depend-on-inner-layers | error | 🟢 Pass | 0 |
| use-case-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| services-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| adapters-must-not-depend-on-tools-schemas-server | error | 🟢 Pass | 0 |
| tools-must-not-depend-on-adapters | error | 🟢 Pass | 0 |
| schemas-must-not-depend-on-src | error | 🟢 Pass | 0 |
| no-circular-dependencies | error | 🟢 Pass | 0 |
| owner-graphql-no-query-builder | error | 🟢 Pass | 0 |
| project-items-response-types-is-leaf | error | 🟢 Pass | 0 |
| platform-request-is-leaf | error | 🟢 Pass | 0 |
| no-console-log | error | 🟢 Pass | 0 |

## Stability (Instability) Metrics

_Instability (I) measures outgoing dependencies. I=0 means the module depends on nothing (highly stable); I=1 means it depends on many things (fragile)._

| Module | Layer | I | Risk |
|--------|-------|---|------|
| `src/server.ts` | entrypoint | 1.00 | 🔴 high-risk |
| `src/adapters/github/create-backend.ts` | adapter | 0.97 | 🔴 high-risk |
| `src/adapters/github/backend.ts` | adapter | 0.96 | 🔴 high-risk |
| `src/tools/handlers/read.ts` | framework | 0.90 | 🔴 high-risk |
| `src/adapters/github/internal/burndown-calculator.ts` | adapter | 0.86 | 🔴 high-risk |
| `src/adapters/github/factory.ts` | adapter | 0.86 | 🔴 high-risk |
| `src/scrum/orient.ts` | use-case | 0.86 | 🔴 high-risk |
| `src/adapters/github/internal/analytics-service.ts` | adapter | 0.85 | 🔴 high-risk |
| `src/adapters/github/internal/board-health-service.ts` | adapter | 0.83 | 🔴 high-risk |
| `src/test/support/fake-backend.ts` | framework | 0.82 | 🔴 high-risk |
| `src/adapters/github/internal/impediment-service.ts` | adapter | 0.80 | 🔴 high-risk |
| `src/adapters/github/internal/file-reader.ts` | adapter | 0.80 | 🔴 high-risk |
| `src/tools/handlers/write.ts` | framework | 0.80 | 🔴 high-risk |
| `src/adapters/github/internal/assemblers/search-api-assembler.ts` | adapter | 0.76 | 🟡 moderate |
| `src/adapters/github/internal/story-mutation-service.ts` | adapter | 0.76 | 🟡 moderate |
| `src/adapters/github/internal/epic-service.ts` | adapter | 0.75 | 🟡 moderate |
| `src/scrum/get-story.ts` | use-case | 0.75 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/direct-lookup-assembler.ts` | adapter | 0.73 | 🟡 moderate |
| `src/adapters/abstract-backend.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/project-items-cache.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/pagination.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/extractors.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/sprint-history-service.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/internal/vocabulary-manager.ts` | adapter | 0.70 | 🟡 moderate |
| `src/adapters/factory.ts` | adapter | 0.67 | 🟡 moderate |
| `src/adapters/github/internal/resolve-issue-number.ts` | adapter | 0.67 | 🟡 moderate |
| `src/scrum/find-items.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/get-analytics.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/get-board-health.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/update-impediment.ts` | use-case | 0.67 | 🟡 moderate |
| `src/test/support/contract-assertions.ts` | framework | 0.67 | 🟡 moderate |
| `src/adapters/github/internal/story-query-service.ts` | adapter | 0.63 | 🟡 moderate |
| `src/adapters/github/internal/assembler-output.ts` | adapter | 0.63 | 🟡 moderate |
| `src/tools/scrum-write.ts` | framework | 0.63 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/mixed-assembler.ts` | adapter | 0.60 | 🟡 moderate |
| `src/adapters/github/internal/config-reloader.ts` | adapter | 0.60 | 🟡 moderate |
| `src/test/support/config-profile.ts` | framework | 0.60 | 🟡 moderate |
| `src/adapters/github/internal/field-value-mutator.ts` | adapter | 0.58 | 🟡 moderate |
| `src/scrum/config-boot.ts` | use-case | 0.58 | 🟡 moderate |
| `src/adapters/github/internal/project-items-query-builder.ts` | adapter | 0.57 | 🟡 moderate |
| `src/adapters/github/internal/item-filter.ts` | adapter | 0.56 | 🟡 moderate |
| `src/scrum/fetch-location.ts` | use-case | 0.56 | 🟡 moderate |
| `src/tools/scrum-read.ts` | framework | 0.56 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/project-items-assembler.ts` | adapter | 0.53 | 🟡 moderate |
| `src/scrum/listing-mappers.ts` | use-case | 0.50 | 🟡 moderate |
| `src/adapters/github/internal/burndown-completion.ts` | adapter | 0.50 | 🟡 moderate |
| `src/scrum/template-resource.ts` | use-case | 0.50 | 🟡 moderate |
| `src/adapters/github/internal/result-normalizer.ts` | adapter | 0.47 | 🟡 moderate |
| `src/test/support/scrum-test-utils.ts` | framework | 0.47 | 🟡 moderate |
| `src/adapters/github/mappers.ts` | adapter | 0.44 | 🟡 moderate |
| `src/scrum/resolve-location.ts` | use-case | 0.43 | 🟡 moderate |
| `src/scrum/url-rewriters.ts` | use-case | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/owner-graphql.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/resolver.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/user-milestone-resolver.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/internal/filter-strategy-router.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/bootstrap-field-sources.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/iteration-classifier.ts` | adapter | 0.33 | 🟡 moderate |
| `src/scrum/sprint-math.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/board-item-projection.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/search-result-normalizer.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/label-resolver.ts` | adapter | 0.33 | 🟡 moderate |
| `src/scrum/_test_fixtures.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/internal/assemblers/types.ts` | adapter | 0.30 | 🟡 moderate |
| `src/adapters/github/bootstrap.ts` | adapter | 0.29 | 🟡 moderate |
| `src/schemas/scrum.ts` | framework | 0.29 | 🟡 moderate |
| `src/adapters/github/internal/project-items-response-types.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/search-query-builder.ts` | adapter | 0.25 | 🟡 moderate |
| `src/test/tools/contract-test-utils.ts` | framework | 0.25 | 🟡 moderate |
| `src/adapters/github/internal/http-client.ts` | adapter | 0.23 | 🟡 moderate |
| `src/services/error-enrichment.ts` | framework | 0.22 | 🟡 moderate |
| `src/adapters/github/internal/board-scan-coordinator.ts` | adapter | 0.21 | 🟡 moderate |
| `src/adapters/github/internal/_test_utils.ts` | adapter | 0.21 | 🟡 moderate |
| `src/adapters/github/internal/execution-engine.ts` | adapter | 0.20 | 🟢 low-risk |
| `src/schemas/scrum-outputs.ts` | framework | 0.20 | 🟢 low-risk |
| `src/adapters/github/internal/infra-context.ts` | adapter | 0.19 | 🟢 low-risk |
| `src/scrum/ports.ts` | use-case | 0.09 | 🟢 low-risk |
| `src/domain/config.ts` | domain | 0.08 | 🟢 low-risk |
| `src/adapters/github/types.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/adapters/github/errors.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/adapters/github/internal/_test_fixtures.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/domain/errors.ts` | domain | 0.07 | 🟢 low-risk |
| `src/adapters/github/queries.ts` | adapter | 0.07 | 🟢 low-risk |
| `src/domain/content-location.ts` | domain | 0.05 | 🟢 low-risk |
| `src/_deno-shim.node.ts` | framework | 0.00 | 🟢 low-risk |
| `src/domain/types.ts` | domain | 0.00 | 🟢 low-risk |
| `src/domain/env.ts` | domain | 0.00 | 🟢 low-risk |
| `src/adapters/capabilities.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/github-types.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/services/logger.ts` | framework | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/platform-request.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/internal/concurrent.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/domain/rules/readiness.ts` | domain | 0.00 | 🟢 low-risk |
| `src/domain/rules/acceptance-criteria.ts` | domain | 0.00 | 🟢 low-risk |
| `src/schemas/inputs.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/_mcp_result.ts` | framework | 0.00 | 🟢 low-risk |
| `src/services/pick-defined.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/_snapshot_normalize.ts` | framework | 0.00 | 🟢 low-risk |

## File Statistics

| Layer | Files | Total LOC | Top 3 Largest |
|-------|-------|-----------|---------------|
| adapter | 57 | 24463 | `adapters/github/generated/github-types.ts` (14767 LOC), `adapters/github/mappers.ts` (686 LOC), `adapters/github/internal/_test_fixtures.ts` (622 LOC) |
| framework | 18 | 3114 | `schemas/scrum.ts` (479 LOC), `test/support/fake-backend.ts` (457 LOC), `schemas/scrum-outputs.ts` (355 LOC) |
| use-case | 15 | 1888 | `scrum/ports.ts` (428 LOC), `scrum/_test_fixtures.ts` (420 LOC), `scrum/orient.ts` (221 LOC) |
| domain | 7 | 1149 | `domain/types.ts` (725 LOC), `domain/config.ts` (125 LOC), `domain/content-location.ts` (103 LOC) |
| entrypoint | 1 | 367 | `server.ts` (367 LOC) |

## Unused Exports

**Total unused exports:** 51

| File | Export | Kind |
|------|--------|------|
| `src/scrum/template-resource.ts` | templateResourceUseCase | function |
| `src/scrum/resolve-location.ts` | SupportedConfigExtension | type |
| `src/scrum/resolve-location.ts` | SupportedTemplateExtension | type |
| `src/tools/scrum-read.ts` | SCRUM_READ_TOOL_NAMES | var |
| `src/tools/scrum-read.ts` | registerScrumReadTools | function |
| `src/tools/scrum-write.ts` | SCRUM_WRITE_TOOL_NAMES | var |
| `src/tools/scrum-write.ts` | registerScrumWriteTools | function |
| `src/test/tools/contract-test-utils.ts` | parseHandlerPayload | function |
| `src/test/tools/contract-test-utils.ts` | assertHandlerSchema | function |
| `src/test/support/contract-assertions.ts` | assertOrientMatchesConfig | function |
| `src/test/support/contract-assertions.ts` | assertFindItemsMatchesConfig | function |
| `src/test/support/scrum-test-utils.ts` | typeTemplatePathsPromise | var |
| `src/test/support/scrum-test-utils.ts` | committedConfigProfilePromise | var |
| `src/test/support/scrum-test-utils.ts` | committedFakeBackendPromise | var |
| `src/test/support/scrum-test-utils.ts` | realFileReader | var |
| `src/test/support/scrum-test-utils.ts` | stubFileReader | var |
| `src/test/support/scrum-test-utils.ts` | withTestServer | function |
| `_deno-shim.node.ts` | addEventListener | function |
| `_deno-shim.node.ts` | Deno | var |
| `src/schemas/inputs.ts` | GraphQLQuerySchema | var |
| `src/schemas/scrum-outputs.ts` | CreateStoryResponseSchema | var |
| `src/adapters/capabilities.ts` | getCapabilities | function |
| `src/adapters/capabilities.ts` | checkCapability | function |
| `src/adapters/factory.ts` | createBackend | function |
| `src/adapters/github/queries.ts` | GET_USER_NODE_ID | var |
| `src/adapters/github/queries.ts` | ADD_PROJECT_ITEM_MUTATION | var |
| `src/adapters/github/queries.ts` | GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | CREATE_ISSUE_MUTATION | var |
| `src/adapters/github/mappers.ts` | toSprintInfo | function |
| `src/adapters/github/internal/owner-graphql.ts` | projectV2FieldsFromBootstrap | function |
| `src/adapters/github/internal/pagination.ts` | isBacklogItem | function |
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
| `src/services/logger.ts` | initLogger | function |
| `src/services/logger.ts` | bindMcpServer | function |
| `src/services/logger.ts` | patchToolLogging | function |
| `src/services/logger.ts` | wrapTransportLogging | function |

---

*Report generated by `deno task audit`. Do not edit manually.*