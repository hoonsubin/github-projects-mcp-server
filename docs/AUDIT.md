# Architecture Audit Report

**Generated:** 2026-06-19T16:51:06.769Z
**Commit:** `4419700`
**Source directory:** `./src`

## Architecture Compliance

Modules scanned: **170**

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
| query-pipeline-import-boundary | error | 🟢 Pass | 0 |
| query-strategies-not-import-services | error | 🟢 Pass | 0 |
| read-services-not-import-write-or-paginator | error | 🟢 Pass | 0 |
| write-services-not-import-query-pipeline | error | 🟢 Pass | 0 |
| infra-not-import-services | error | 🟢 Pass | 0 |
| no-console-log | error | 🟢 Pass | 0 |

## Stability (Instability) Metrics

_Instability (I) measures outgoing dependencies. I=0 means the module depends on nothing (highly stable); I=1 means it depends on many things (fragile)._

| Module | Layer | I | Risk |
|--------|-------|---|------|
| `src/server.ts` | entrypoint | 1.00 | 🔴 high-risk |
| `src/test/fixtures/github/index.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/fixtures/port/index.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/fixtures/scrum/index.ts` | framework | 1.00 | 🔴 high-risk |
| `src/test/support/github-client.ts` | framework | 1.00 | 🔴 high-risk |
| `src/adapters/github/create-backend.ts` | adapter | 0.97 | 🔴 high-risk |
| `src/adapters/github/backend.ts` | adapter | 0.96 | 🔴 high-risk |
| `src/tools/handlers/read.ts` | framework | 0.92 | 🔴 high-risk |
| `src/scrum/orient.ts` | use-case | 0.89 | 🔴 high-risk |
| `src/tools/handlers/write.ts` | framework | 0.88 | 🔴 high-risk |
| `src/adapters/github/factory.ts` | adapter | 0.86 | 🔴 high-risk |
| `src/adapters/github/read-services/impediment-service.ts` | adapter | 0.83 | 🔴 high-risk |
| `src/scrum/find-items.ts` | use-case | 0.83 | 🔴 high-risk |
| `src/scrum/sprint-data-format.ts` | use-case | 0.83 | 🔴 high-risk |
| `src/test/support/captured-backend.ts` | framework | 0.83 | 🔴 high-risk |
| `src/adapters/github/read-services/sprint-data-service.ts` | adapter | 0.82 | 🔴 high-risk |
| `src/test/support/fake-backend.ts` | framework | 0.82 | 🔴 high-risk |
| `src/adapters/github/write-services/story-mutation-service.ts` | adapter | 0.81 | 🔴 high-risk |
| `src/adapters/github/infra/file-reader.ts` | adapter | 0.80 | 🔴 high-risk |
| `src/adapters/github/read-services/story-query-service.ts` | adapter | 0.79 | 🟡 moderate |
| `src/adapters/github/assemblers/search-api-assembler.ts` | adapter | 0.75 | 🟡 moderate |
| `src/adapters/github/read-services/epic-service.ts` | adapter | 0.75 | 🟡 moderate |
| `src/scrum/get-item-detail.ts` | use-case | 0.75 | 🟡 moderate |
| `src/test/fixtures/github/pages.ts` | framework | 0.75 | 🟡 moderate |
| `src/adapters/github/query-pipeline/project-items-cache.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/query-pipeline/pagination.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/assemblers/extractors.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/assemblers/direct-lookup-assembler.ts` | adapter | 0.71 | 🟡 moderate |
| `src/adapters/github/assemblers/assembler-output.ts` | adapter | 0.70 | 🟡 moderate |
| `src/adapters/github/write-services/vocabulary-manager.ts` | adapter | 0.70 | 🟡 moderate |
| `src/adapters/factory.ts` | adapter | 0.67 | 🟡 moderate |
| `src/adapters/github/query-strategies/resolve-issue-number.ts` | adapter | 0.67 | 🟡 moderate |
| `src/scrum/get-sprint-data.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/update-impediment.ts` | use-case | 0.67 | 🟡 moderate |
| `src/scrum/write-value-resolve.ts` | use-case | 0.67 | 🟡 moderate |
| `src/tools/scrum-write.ts` | framework | 0.67 | 🟡 moderate |
| `src/test/support/contract-assertions.ts` | framework | 0.67 | 🟡 moderate |
| `src/adapters/abstract-backend.ts` | adapter | 0.63 | 🟡 moderate |
| `src/adapters/github/assemblers/mixed-assembler.ts` | adapter | 0.60 | 🟡 moderate |
| `src/adapters/github/infra/config-reloader.ts` | adapter | 0.60 | 🟡 moderate |
| `src/test/support/config-profile.ts` | framework | 0.60 | 🟡 moderate |
| `src/scrum/validate-add-vocabulary.ts` | use-case | 0.60 | 🟡 moderate |
| `src/adapters/github/write-services/field-value-mutator.ts` | adapter | 0.58 | 🟡 moderate |
| `src/scrum/config-boot.ts` | use-case | 0.58 | 🟡 moderate |
| `src/adapters/github/query-pipeline/project-items-query-builder.ts` | adapter | 0.57 | 🟡 moderate |
| `src/adapters/github/query-strategies/item-filter.ts` | adapter | 0.56 | 🟡 moderate |
| `src/scrum/utils/fetch-location.ts` | use-case | 0.56 | 🟡 moderate |
| `src/tools/scrum-read.ts` | framework | 0.55 | 🟡 moderate |
| `src/adapters/github/mappers.ts` | adapter | 0.50 | 🟡 moderate |
| `src/adapters/github/query-strategies/result-normalizer.ts` | adapter | 0.50 | 🟡 moderate |
| `src/adapters/github/assemblers/project-items-assembler.ts` | adapter | 0.50 | 🟡 moderate |
| `src/adapters/github/infra/completion-timestamps.ts` | adapter | 0.50 | 🟡 moderate |
| `src/scrum/find-items-intent.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/listing-projection.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/utils/sprint-context.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/sprint-raw-format.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/terminal-statuses.ts` | use-case | 0.50 | 🟡 moderate |
| `src/test/support/scrum-test-utils.ts` | framework | 0.50 | 🟡 moderate |
| `src/scrum/template-resource.ts` | use-case | 0.50 | 🟡 moderate |
| `src/scrum/validate-labels.ts` | use-case | 0.50 | 🟡 moderate |
| `src/tools/handler-errors.ts` | framework | 0.50 | 🟡 moderate |
| `src/test/fixtures/github/items-synthetic.ts` | framework | 0.50 | 🟡 moderate |
| `src/test/fixtures/scrum/locations.ts` | framework | 0.50 | 🟡 moderate |
| `src/adapters/github/infra/resolver.ts` | adapter | 0.46 | 🟡 moderate |
| `src/scrum/utils/resolve-location.ts` | use-case | 0.43 | 🟡 moderate |
| `src/services/session-cache.ts` | framework | 0.42 | 🟡 moderate |
| `src/scrum/utils/url-rewriters.ts` | use-case | 0.40 | 🟡 moderate |
| `src/adapters/github/linked-pull-requests.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/infra/owner-graphql.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/query-strategies/filter-strategy-router.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/write-services/user-milestone-resolver.ts` | adapter | 0.40 | 🟡 moderate |
| `src/adapters/github/write-services/label-resolver.ts` | adapter | 0.36 | 🟡 moderate |
| `src/adapters/github/bootstrap-field-sources.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/infra/iteration-classifier.ts` | adapter | 0.33 | 🟡 moderate |
| `src/adapters/github/query-pipeline/board-item-projection.ts` | adapter | 0.33 | 🟡 moderate |
| `src/scrum/utils/listing-mappers.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/query-strategies/search-result-normalizer.ts` | adapter | 0.33 | 🟡 moderate |
| `src/schemas/scrum.ts` | framework | 0.33 | 🟡 moderate |
| `src/scrum/sprint-filter.ts` | use-case | 0.33 | 🟡 moderate |
| `src/scrum/item-detail-projection.ts` | use-case | 0.33 | 🟡 moderate |
| `src/scrum/sprint-summary.ts` | use-case | 0.33 | 🟡 moderate |
| `src/adapters/github/bootstrap.ts` | adapter | 0.30 | 🟡 moderate |
| `src/adapters/github/assemblers/types.ts` | adapter | 0.30 | 🟡 moderate |
| `src/adapters/github/infra/project-items-response-types.ts` | adapter | 0.25 | 🟡 moderate |
| `src/adapters/github/query-strategies/search-query-builder.ts` | adapter | 0.25 | 🟡 moderate |
| `src/scrum/orient-tier.ts` | use-case | 0.25 | 🟡 moderate |
| `src/test/fixtures/github/items.ts` | framework | 0.25 | 🟡 moderate |
| `src/adapters/github/read-services/board-scan-coordinator.ts` | adapter | 0.23 | 🟡 moderate |
| `src/adapters/github/infra/http-client.ts` | adapter | 0.21 | 🟡 moderate |
| `src/adapters/github/infra/infra-context.ts` | adapter | 0.20 | 🟢 low-risk |
| `src/adapters/github/query-pipeline/execution-engine.ts` | adapter | 0.20 | 🟢 low-risk |
| `src/test/support/handler-assertions.ts` | framework | 0.20 | 🟢 low-risk |
| `src/services/error-enrichment.ts` | framework | 0.17 | 🟢 low-risk |
| `src/schemas/scrum-outputs.ts` | framework | 0.17 | 🟢 low-risk |
| `src/tools/_mcp_result.ts` | framework | 0.17 | 🟢 low-risk |
| `src/scrum/ports.ts` | use-case | 0.08 | 🟢 low-risk |
| `src/adapters/github/types.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/adapters/github/errors.ts` | adapter | 0.08 | 🟢 low-risk |
| `src/adapters/github/queries.ts` | adapter | 0.07 | 🟢 low-risk |
| `src/domain/errors.ts` | domain | 0.06 | 🟢 low-risk |
| `src/domain/config.ts` | domain | 0.05 | 🟢 low-risk |
| `src/domain/content-location.ts` | domain | 0.05 | 🟢 low-risk |
| `src/_deno-shim.node.ts` | framework | 0.00 | 🟢 low-risk |
| `src/domain/types.ts` | domain | 0.00 | 🟢 low-risk |
| `src/domain/env.ts` | domain | 0.00 | 🟢 low-risk |
| `src/adapters/capabilities.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/generated/github-types.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/services/logger.ts` | framework | 0.00 | 🟢 low-risk |
| `src/scrum/utils/sprint-math.ts` | use-case | 0.00 | 🟢 low-risk |
| `src/adapters/github/infra/platform-request.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/adapters/github/infra/concurrent.ts` | adapter | 0.00 | 🟢 low-risk |
| `src/scrum/utils/acceptance-criteria.ts` | use-case | 0.00 | 🟢 low-risk |
| `src/scrum/server-instructions.ts` | use-case | 0.00 | 🟢 low-risk |
| `src/services/rate-limiter.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/response-serialize.ts` | framework | 0.00 | 🟢 low-risk |
| `src/services/pick-defined.ts` | framework | 0.00 | 🟢 low-risk |
| `src/test/fixtures/github/user-nodes.ts` | framework | 0.00 | 🟢 low-risk |
| `src/test/fixtures/port/captured.json` | framework | 0.00 | 🟢 low-risk |
| `src/test/fixtures/scrum/templates.ts` | framework | 0.00 | 🟢 low-risk |
| `src/tools/_snapshot_normalize.ts` | framework | 0.00 | 🟢 low-risk |

## File Statistics

| Layer | Files | Total LOC | Top 3 Largest |
|-------|-------|-----------|---------------|
| adapter | 53 | 23554 | `adapters/github/generated/github-types.ts` (14767 LOC), `adapters/github/mappers.ts` (664 LOC), `adapters/github/bootstrap.ts` (561 LOC) |
| framework | 32 | 5116 | `schemas/scrum.ts` (496 LOC), `test/fixtures/github/items.ts` (461 LOC), `tools/handlers/write.ts` (443 LOC) |
| use-case | 28 | 2100 | `scrum/ports.ts` (435 LOC), `scrum/orient.ts` (216 LOC), `scrum/config-boot.ts` (133 LOC) |
| domain | 5 | 842 | `domain/types.ts` (538 LOC), `domain/config.ts` (125 LOC), `domain/content-location.ts` (103 LOC) |
| entrypoint | 1 | 598 | `server.ts` (598 LOC) |

## Unused Exports

**Total unused exports:** 79

| File | Export | Kind |
|------|--------|------|
| `src/scrum/sprint-raw-format.ts` | formatSprintRawData | function |
| `src/scrum/utils/resolve-location.ts` | SupportedConfigExtension | type |
| `src/scrum/utils/resolve-location.ts` | SupportedTemplateExtension | type |
| `src/scrum/find-items-intent.ts` | defaultListingFields | function |
| `src/scrum/server-instructions.ts` | SCRUM_SERVER_INSTRUCTIONS | var |
| `src/scrum/server-instructions.ts` | SCRUM_GLOSSARY_NOTE | var |
| `src/scrum/template-resource.ts` | templateResourceUseCase | function |
| `src/tools/scrum-read.ts` | SCRUM_READ_TOOL_NAMES | var |
| `src/tools/scrum-read.ts` | registerScrumReadTools | function |
| `src/tools/scrum-write.ts` | SCRUM_WRITE_TOOL_NAMES | var |
| `src/tools/scrum-write.ts` | registerScrumWriteTools | function |
| `src/test/support/github-client.ts` | createGhSpy | function |
| `src/test/support/github-client.ts` | makeCtx | function |
| `src/test/support/contract-assertions.ts` | assertOrientMatchesConfig | function |
| `src/test/support/contract-assertions.ts` | assertFindItemsMatchesConfig | function |
| `src/test/support/scrum-test-utils.ts` | testSessionCache | function |
| `src/test/support/scrum-test-utils.ts` | typeTemplatePathsPromise | var |
| `src/test/support/scrum-test-utils.ts` | committedConfigProfilePromise | var |
| `src/test/support/scrum-test-utils.ts` | committedFakeBackendPromise | var |
| `src/test/support/scrum-test-utils.ts` | capturedBackendPromise | var |
| `src/test/support/scrum-test-utils.ts` | realFileReader | var |
| `src/test/support/scrum-test-utils.ts` | stubFileReader | var |
| `src/test/support/scrum-test-utils.ts` | withTestServer | function |
| `src/test/support/handler-assertions.ts` | parseHandlerPayload | function |
| `src/test/support/handler-assertions.ts` | assertHandlerSchema | function |
| `src/test/fixtures/scrum/locations.ts` | INLINE_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | INLINE_YAML_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | INLINE_JSON_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | FILE_YML_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | FILE_JSON_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | FILE_MD_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | URL_YML_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | URL_JSON_LOCATION | var |
| `src/test/fixtures/scrum/locations.ts` | URL_MD_LOCATION | var |
| `src/test/fixtures/scrum/templates.ts` | TYPE_TEMPLATE_CONTENT | var |
| `src/test/fixtures/github/user-nodes.ts` | USERNODE_IDS | var |
| `src/test/fixtures/github/user-nodes.ts` | FIXTURE_USER_ID | var |
| `src/test/fixtures/github/pages.ts` | FIXTURE_PAGE_1 | var |
| `src/test/fixtures/github/pages.ts` | FIXTURE_PAGE_2 | var |
| `src/test/fixtures/github/items-synthetic.ts` | FIXTURE_NODES | var |
| `src/test/fixtures/port/index.ts` | FIXTURE_PLATFORM_STATE | var |
| `src/test/fixtures/port/index.ts` | FIXTURE_FIND_ITEMS | var |
| `src/test/fixtures/port/index.ts` | FIXTURE_ITEM_DETAILS | var |
| `src/test/fixtures/port/index.ts` | FIXTURE_FIRST_ITEM_DETAIL | var |
| `_deno-shim.node.ts` | addEventListener | function |
| `_deno-shim.node.ts` | Deno | var |
| `src/schemas/scrum-outputs.ts` | CreateStoryResponseSchema | var |
| `src/schemas/scrum-outputs.ts` | CreateStoryOutputSchema | var |
| `src/schemas/scrum-outputs.ts` | SetFieldResponseSchema | var |
| `src/schemas/scrum-outputs.ts` | UpdateStoryResponseSchema | var |
| `src/adapters/capabilities.ts` | getCapabilities | function |
| `src/adapters/capabilities.ts` | checkCapability | function |
| `src/adapters/factory.ts` | createBackend | function |
| `src/adapters/github/infra/owner-graphql.ts` | projectV2FieldsFromBootstrap | function |
| `src/adapters/github/queries.ts` | GET_USER_NODE_ID | var |
| `src/adapters/github/queries.ts` | ADD_PROJECT_ITEM_MUTATION | var |
| `src/adapters/github/queries.ts` | GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_TYPES_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | GET_ORG_ISSUE_FIELDS_BOOTSTRAP_QUERY | var |
| `src/adapters/github/queries.ts` | CREATE_ISSUE_MUTATION | var |
| `src/adapters/github/mappers.ts` | toSprintInfo | function |
| `src/adapters/github/mappers.ts` | sprintCompletionFromAggregates | function |
| `src/adapters/github/factory.ts` | GitHubAdapterFactory | class |
| `src/adapters/github/types.ts` | GitHubMilestoneId | type |
| `src/adapters/github/types.ts` | toEntityRef | function |
| `src/adapters/github/types.ts` | ItemContentType | type |
| `src/adapters/github/types.ts` | PrState | type |
| `src/adapters/github/types.ts` | IssueRef | type |
| `src/adapters/github/types.ts` | LabelRef | type |
| `src/adapters/github/query-pipeline/pagination.ts` | isBacklogItem | function |
| `src/adapters/github/query-pipeline/execution-engine.ts` | SPRINT_PAGINATION_POLICY | var |
| `src/domain/content-location.ts` | ContentLocationKind | type |
| `src/services/logger.ts` | initLogger | function |
| `src/services/logger.ts` | bindMcpServer | function |
| `src/services/logger.ts` | patchToolLogging | function |
| `src/services/logger.ts` | wrapTransportLogging | function |
| `src/services/rate-limiter.ts` | createRateLimiter | function |

---

*Report generated by `deno task audit`. Do not edit manually.*