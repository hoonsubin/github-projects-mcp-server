// =============================================================================
// src/types.ts — Re-export barrel
//
// Types are organised by architectural layer:
//
//   Domain entities  →  src/domain/types.ts
//   Domain config    →  src/domain/config.ts
//   GitHub adapter   →  src/adapters/github/types.ts
//
// This barrel preserves all pre-refactor import paths.
// Do not add new type declarations here — add them to the appropriate layer file.
// =============================================================================

// ── Domain layer ──────────────────────────────────────────────────────────────

export type {
  ArtifactType,
  BurndownDayPoint,
  BurndownResponse,
  BurndownSprintMeta,
  BurndownStory,
  IdealDayPoint,
  IterationEntry,
  SprintRef,
  Story,
  StoryRef,
  TemplateResponse,
} from "./domain/types.ts";

export type { ScrumConfigYml } from "./domain/config.ts";

// ── GitHub adapter layer ──────────────────────────────────────────────────────

export type {
  BoardFields,
  Comment,
  FieldValueNode,
  GitHubBackendConfig,
  GraphQLResponse,
  ItemContentType,
  ItemFieldValue,
  LinkedPr,
  ProjectItem,
  ProjectItemDraftContent,
  ProjectItemIssueContent,
  ProjectItemPRContent,
} from "./adapters/github/types.ts";
