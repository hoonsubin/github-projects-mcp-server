// =============================================================================
// src/services/config.ts
//
// ── Phase 1, step 3: implement loadConfig ────────────────────────────────────
//
// todo: [Phase 1, step 3] Implement:
//   export async function loadConfig(
//     github: GitHubClient,
//     owner: string,
//     ownerType: "user" | "org",
//     projectNumber: number,
//   ): Promise<RuntimeConfig>
//
// Implementation steps (in order):
//   1. Fetch scrum.config.yml via GetRepoFileSchema handler — path: ".github/scrum/config.yml"
//      owner/repo come from process.env (GITHUB_OWNER / GITHUB_REPO) or a top-level config;
//      during testing, owner/ownerType/projectNumber come from the agent's system prompt.
//   2. Parse the YAML string (use a JS YAML parser — check package.json for what's available)
//      and validate the result against the ScrumConfigYml interface from types.ts.
//   3. Fetch project field metadata in a single GraphQL call:
//        query($login: String!, $number: Int!) {
//          user/organization(login: $login) {
//            projectV2(number: $number) {
//              id
//              fields(first: 50) {
//                nodes {
//                  __typename id name dataType
//                  ... on ProjectV2SingleSelectField { options { id name } }
//                  ... on ProjectV2IterationField {
//                    configuration {
//                      iterations          { id title startDate duration }
//                      completedIterations { id title startDate duration }
//                    }
//                  }
//                }
//              }
//            }
//          }
//        }
//   4. Walk the field nodes; match field names against scrum.config.yml's field_names to resolve:
//      sprintFieldId, statusFieldId, storyPointsFieldId, priorityFieldId,
//      epicFieldId, assigneeFieldId, typeFieldId. Missing optional fields → null.
//   5. Build statusOptions, priorityOptions, typeOptions:
//      for each single-select field, match option.name against the vocabulary arrays in
//      scrum.config.yml (status_values, priority_values, item_types) → Record<vocabName, optionId>
//   6. Classify iterations from the sprint field's configuration:
//      - active: the iteration where today falls between startDate and startDate+duration days
//      - next: the first iteration (by startDate) that starts after the active one's end date
//      - completed: all from completedIterations[]
//      - all: concat(active, next, remaining future, completed) — deduplicated
//   7. Return RuntimeConfig.
//
// Caching: none — each invocation fetches fresh (stateless per design principle 3).
//   If round-trip latency becomes a concern, a short-lived in-process TTL cache (≤60s)
//   may be added later, but start without one.
// =============================================================================

import type { ScrumConfigYml, IterationEntry } from "../types.ts";

// RuntimeConfig — merges human config (scrum.config.yml) with live GitHub field metadata.
// Internal only — never exposed to the agent.
export interface RuntimeConfig {
  yml: ScrumConfigYml;
  projectId: string;
  fields: {
    sprintFieldId: string;
    statusFieldId: string;
    storyPointsFieldId: string | null;
    priorityFieldId: string | null;
    epicFieldId: string | null;    // maps to GitHub Milestone field
    assigneeFieldId: string | null;
    typeFieldId: string | null;
  };
  statusOptions: Record<string, string>;   // vocabulary name → GitHub option ID
  priorityOptions: Record<string, string>; // vocabulary name → GitHub option ID
  typeOptions: Record<string, string>;     // StoryType value → GitHub option ID
  // Uses IterationEntry from types.ts: { id, title, startDate, duration }
  iterations: {
    active: IterationEntry | null;
    next: IterationEntry | null;
    completed: IterationEntry[];
    all: IterationEntry[];
  };
}

// Minimal GitHub client interface — the real client is passed in from index.ts.
interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

/**
 * Load and merge scrum.config.yml with live GitHub project field metadata.
 * Called by every tool handler at invocation time. See implementation steps above.
 */
export async function loadConfig(
  _github: GitHubClient,
  _owner: string,
  _ownerType: "user" | "org",
  _projectNumber: number,
): Promise<RuntimeConfig> {
  // todo: [Phase 1, step 3] Implementation pending
  throw new Error("not yet implemented: loadConfig");
}
