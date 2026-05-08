// =============================================================================
// src/tools/scrum-read.ts — Phase 2: all 5 scrum_* read tools
// [Phase 2, steps 5–10 — COMPLETE]
//
// All tools call loadConfig at invocation time — no shared server state.
// Bootstrap env vars required: GITHUB_OWNER, GITHUB_OWNER_TYPE (default "user"),
// GITHUB_PROJECT_NUMBER, GITHUB_REPO, GITHUB_TOKEN.
//
// NOTE: All GraphQL queries use the `user()` root. For org-owned projects,
// add a parallel GET_PROJECT_ITEMS_ORG_QUERY that uses `organization()` and
// branch on ownerType in fetchAllItems. Tracked as a Phase 4 extension.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatError, graphql } from "../services/github.ts";
import { loadConfig } from "../services/config.ts";
import type { RuntimeConfig } from "../services/config.ts";
import { resolveSprint, resolveStory } from "../services/resolver.ts";

import {
  GetBacklogSchema,
  GetHistorySchema,
  GetSprintSchema,
  GetStorySchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import type { Story } from "../types.ts";

// ── Bootstrap helpers ─────────────────────────────────────────────────────────

/** GitHub client wrapper — matches the interface loadConfig/resolveStory expect. */
const gh = { graphql };

/** Get the repo slug from environment — centralized to avoid duplication. */
const getRepo = (): string => {
  const repo = Deno.env.get("GITHUB_REPO");
  if (!repo) {
    throw new Error(
      "GITHUB_REPO environment variable is not set. " +
        "Set it to the repository slug (e.g., 'github-projects-mcp-server').",
    );
  }
  return repo;
};
interface BootstrapConfig {
  owner: string;
  ownerType: "user" | "org";
  projectNumber: number;
}

const getBootstrapConfig = (): BootstrapConfig => {
  const owner = Deno.env.get("GITHUB_OWNER");
  if (!owner) {
    throw new Error(
      "GITHUB_OWNER environment variable is not set. " +
        "Set it to the GitHub username or organisation login that owns the project.",
    );
  }
  const ownerTypeRaw = Deno.env.get("GITHUB_OWNER_TYPE") ?? "user";
  if (ownerTypeRaw !== "user" && ownerTypeRaw !== "org") {
    throw new Error(
      `GITHUB_OWNER_TYPE must be 'user' or 'org', got '${ownerTypeRaw}'.`,
    );
  }
  const projectNumberRaw = Deno.env.get("GITHUB_PROJECT_NUMBER");
  if (!projectNumberRaw) {
    throw new Error("GITHUB_PROJECT_NUMBER environment variable is not set.");
  }
  const projectNumber = parseInt(projectNumberRaw, 10);
  if (isNaN(projectNumber)) {
    throw new Error(
      `GITHUB_PROJECT_NUMBER must be an integer, got '${projectNumberRaw}'.`,
    );
  }
  return { owner, ownerType: ownerTypeRaw as "user" | "org", projectNumber };
};

// ── Raw GraphQL response types ─────────────────────────────────────────────────

interface RawFieldValue {
  field?: { id: string } | null;
  name?: string; // single-select display name
  optionId?: string;
  number?: number; // number field value
  title?: string; // iteration title (sprint name)
  iterationId?: string;
  startDate?: string;
  duration?: number;
}

interface RawContent {
  id: string;
  number?: number;
  title: string;
  body?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
}

interface RawItem {
  id: string;
  content: RawContent | null;
  fieldValues: { nodes: RawFieldValue[] };
}

interface GetProjectItemsResponse {
  user?: {
    projectV2?: {
      items: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawItem[];
      };
    } | null;
  } | null;
}

interface GetIssueDetailsResponse {
  node?: {
    id?: string;
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    createdAt?: string;
    updatedAt?: string;
    assignees?: { nodes: Array<{ login: string }> };
    labels?: { nodes: Array<{ name: string }> };
    milestone?: { title: string } | null;
    comments?: {
      nodes: Array<{
        id: string;
        author?: { login: string } | null;
        body: string;
        createdAt: string;
        url: string;
      }>;
    };
    timelineItems?: {
      nodes: Array<{
        source?: {
          number?: number;
          title?: string;
          url?: string;
          state?: string;
          isDraft?: boolean;
        } | null;
      }>;
    };
  } | null;
}

interface GetItemFieldsResponse {
  node?: {
    fieldValues?: { nodes: RawFieldValue[] };
  } | null;
}

// ── GraphQL queries ────────────────────────────────────────────────────────────

const GET_PROJECT_ITEMS_QUERY = `
  query GetProjectItems($login: String!, $number: Int!, $after: String) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue {
                id
                number
                title
                body
                url
                createdAt
                updatedAt
                assignees(first: 10) { nodes { login } }
                labels(first: 20) { nodes { name } }
                milestone { title }
              }
              ... on DraftIssue { id title body }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { id } }
                  name
                  optionId
                }
                ... on ProjectV2ItemFieldNumberValue {
                  field { ... on ProjectV2Field { id } }
                  number
                }
                ... on ProjectV2ItemFieldIterationValue {
                  field { ... on ProjectV2IterationField { id } }
                  title
                  iterationId
                  startDate
                  duration
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_ISSUE_DETAILS_QUERY = `
  query GetIssueDetails($issueId: ID!) {
    node(id: $issueId) {
      ... on Issue {
        id
        number
        title
        body
        url
        createdAt
        updatedAt
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        milestone { title }
        comments(first: 50) {
          nodes {
            id
            author { login }
            body
            createdAt
            url
          }
        }
        timelineItems(first: 25, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  number
                  title
                  url
                  state
                  isDraft
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_ITEM_FIELDS_QUERY = `
  query GetItemFields($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        fieldValues(first: 20) {
          nodes {
            ... on ProjectV2ItemFieldSingleSelectValue {
              field { ... on ProjectV2SingleSelectField { id } }
              name
              optionId
            }
            ... on ProjectV2ItemFieldNumberValue {
              field { ... on ProjectV2Field { id } }
              number
            }
            ... on ProjectV2ItemFieldIterationValue {
              field { ... on ProjectV2IterationField { id } }
              title
              iterationId
            }
          }
        }
      }
    }
  }
`;

/** Fetch repository labels for story typing verification. */
const GET_REPO_LABELS_QUERY = `
  query GetRepoLabels($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      labels(first: 50) {
        nodes { name color description }
      }
    }
  }
`;

interface RepoLabelsResponse {
  repository?: {
    labels?: {
      nodes: Array<{ name: string; color: string; description: string }>;
    };
  };
}

// ── Pagination helper ──────────────────────────────────────────────────────────

/**
 * Fetch every project item (paginated, 100 per page).
 * GitHub Projects v2 has no server-side field filtering, so all filtering is
 * done client-side after this call.
 *
 * todo: [Phase 4] Support org-owned projects by adding an org-root variant of ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
 * GET_PROJECT_ITEMS_QUERY and branching on ownerType here. ([#19](https://github.com/hoonsubin/github-projects-mcp-server/issues/19))
 */
const fetchAllItems = async (
  config: RuntimeConfig,
  owner: string,
  ownerType: "user" | "org",
): Promise<RawItem[]> => {
  if (ownerType === "org") {
    throw new Error(
      "Org-owned projects are not yet supported by the scrum_* read tools. " +
        "Use a user-owned project or add the org-root query variant (Phase 4 extension).",
    );
  }

  const all: RawItem[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data: GetProjectItemsResponse = await gh.graphql<GetProjectItemsResponse>(
      GET_PROJECT_ITEMS_QUERY,
      {
        login: owner,
        number: config.yml.project.project_number,
        after: cursor ?? null,
      },
    );

    const items = data.user?.projectV2?.items;
    if (!items) break;

    all.push(...items.nodes);
    hasNextPage = items.pageInfo.hasNextPage;
    cursor = items.pageInfo.endCursor;
  }

  return all;
};

// ── Story builder ──────────────────────────────────────────────────────────────

const STORY_TYPES = new Set(["feature", "bug", "tech_debt", "spike"]);

/**
 * Build a Story from a raw project item node.
 * Returns null for DraftIssues (no issue number) and items without content.
 */
const buildStoryFromRaw = (item: RawItem, config: RuntimeConfig): Story | null => {
  const content = item.content;
  if (!content || typeof content.number !== "number") return null;

  const { sprintFieldId, statusFieldId, storyPointsFieldId, priorityFieldId } = config.fields;

  let status: string | null = null;
  let sprint: string | null = null;
  let story_points: number | null = null;
  let priority: string | null = null;

  for (const fv of item.fieldValues.nodes) {
    const fieldId = fv.field?.id;
    if (!fieldId) continue;
    if (fieldId === statusFieldId && fv.name) {
      status = fv.name;
    } else if (fieldId === sprintFieldId && fv.title) {
      sprint = fv.title;
    } else if (
      storyPointsFieldId &&
      fieldId === storyPointsFieldId &&
      typeof fv.number === "number"
    ) {
      story_points = fv.number;
    } else if (priorityFieldId && fieldId === priorityFieldId && fv.name) {
      priority = fv.name;
    }
  }

  const allLabels = content.labels?.nodes.map((l) => l.name) ?? [];
  const type = (allLabels.find((l) => STORY_TYPES.has(l)) as Story["type"]) ??
    null;
  const labels = allLabels.filter((l) => !STORY_TYPES.has(l));

  return {
    ref: { number: content.number, id: item.id },
    title: content.title,
    body: content.body ?? "",
    type,
    status,
    sprint,
    story_points,
    priority,
    assignees: content.assignees?.nodes.map((a) => a.login) ?? [],
    labels,
    epic: content.milestone?.title ?? null,
    created_at: content.createdAt ?? "",
    updated_at: content.updatedAt ?? "",
    url: content.url ?? null,
  };
};

// ── Vocabulary helpers ─────────────────────────────────────────────────────────

/**
 * Find a status display name by searching yml.status for a vocab key that
 * contains the given hint (case-insensitive). Falls back to `fallback`.
 *
 * Example: findStatusDisplayName(config, "done", "Done")
 *   → searches yml.status for a key like "done", "Done", "is_done", etc.
 *   → returns the mapped display value, e.g. "Done" or "Completed"
 */
const findStatusDisplayName = (
  config: RuntimeConfig,
  keyHint: string,
  fallback: string,
): string => {
  // yml.status is not in the ScrumConfigYml type signature; it comes from the
  // user's YAML and is caught by [key: string]: unknown.
  const vocab = config.yml.status as Record<string, string> | undefined;
  if (!vocab) return fallback;
  const entry = Object.entries(vocab).find(([k]) =>
    k.toLowerCase().includes(keyHint.toLowerCase())
  );
  return entry ? entry[1] : fallback;
};

// ── Acceptance criteria parser ─────────────────────────────────────────────────

interface AcceptanceCriterion {
  text: string;
  checked: boolean;
}

const parseAcceptanceCriteria = (body: string): AcceptanceCriterion[] => {
  const ac: AcceptanceCriterion[] = [];
  const checkboxRe = /^[ \t]*-[ \t]+\[([ xX])\][ \t]+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(body)) !== null) {
    ac.push({ checked: match[1].trim() !== "", text: match[2].trim() });
  }
  return ac;
};

// ── Readiness classifier ───────────────────────────────────────────────────────

type ReadinessLevel = "sprint_ready" | "in_refinement" | "future_candidate";

/**
 * Classify a backlog story's readiness for sprint planning.
 * sprint_ready:       has story_points + AC checkboxes in body + priority
 * in_refinement:      has at least one but not all three
 * future_candidate:   has none of the three
 */
const classifyReadiness = (story: Story): ReadinessLevel => {
  const hasPoints = story.story_points !== null && story.story_points > 0;
  const hasAC = /^[ \t]*-[ \t]+\[([ xX])\]/m.test(story.body);
  const hasPriority = story.priority !== null;
  const score = [hasPoints, hasAC, hasPriority].filter(Boolean).length;
  if (score === 3) return "sprint_ready";
  if (score > 0) return "in_refinement";
  return "future_candidate";
};

// ── Tool registration ──────────────────────────────────────────────────────────

export const registerScrumReadTools = (server: McpServer): void => {
  // ── Step 5: scrum_orient ─────────────────────────────────────────────────────
  //
  // Entry point for the agent on any new project. Returns two things:
  //   platform_state    — what actually exists on the PM platform right now
  //   declared_vocabulary — what the team's config.yml says should exist
  //
  // The agent uses its Scrum knowledge as the reference standard and computes
  // the gap between platform_state and declared_vocabulary to determine whether
  // the project is Scrum-ready. Structural gaps (missing fields) require human
  // action. Vocabulary gaps (missing options, labels) can be fixed via
  // scrum_add_vocabulary.

  server.registerTool(
    "scrum_orient",
    {
      title: "Orient to Project",
      description:
        `Return the current platform state and declared Scrum vocabulary for this project.

No arguments required. Call this first when connecting to a new project, before sprint
planning, or any time the agent needs to verify the board is configured correctly.

Returns two top-level sections:

platform_state — what currently exists on the PM platform:
  fields          — which Scrum fields are present (status, sprint, story_points, priority)
                    and their configured options/scale
  labels          — repo labels that exist for story typing and impediment tracking
  iterations      — active sprint, next sprint, and count of completed sprints

declared_vocabulary — what the team's config.yml says the project should have:
  status          — vocab key → display name map for the Status field
  priority        — vocab key → display name map for the Priority field
  story_points    — configured point scale (e.g. [1, 2, 3, 5, 8])
  sprint          — duration_days and velocity_window settings
  team            — product owner, members, scrum master rotation
  definition_of_ready — DoR checklist with version and criteria
  definition_of_done  — DoD checklist with version and criteria

The agent compares platform_state against declared_vocabulary and its own Scrum knowledge
to identify gaps. Structural gaps (a required field does not exist) require the human to
create them in the GitHub Projects UI. Vocabulary gaps (a field option or label is missing)
can be resolved autonomously via scrum_add_vocabulary.`,
      inputSchema: z.object({}).strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo: getRepo(),
        });
        const yml = config.yml;

        const statusVocab = (yml.status as Record<string, string> | undefined) ?? null;
        const priorityVocab = (yml.priority as Record<string, string> | undefined) ?? null;

        // Derive which declared status options are present/missing in the live field
        const liveStatusOptions = Object.values(config.statusOptions);
        const declaredStatusValues = statusVocab ? Object.values(statusVocab) : [];
        const missingStatusOptions = declaredStatusValues.filter(
          (v) => !liveStatusOptions.includes(v),
        );

        // Derive which declared priority options are present/missing
        const livePriorityOptions = Object.values(config.priorityOptions);
        const declaredPriorityValues = priorityVocab ? Object.values(priorityVocab) : [];
        const missingPriorityOptions = declaredPriorityValues.filter(
          (v) => !livePriorityOptions.includes(v),
        );

        // Type labels the agent needs for story classification
        const typeLabels = ["feature", "bug", "tech_debt", "spike", "impediment"];

        // Fetch repo labels to report which type labels exist/are missing
        const labelsResult = await gh.graphql<RepoLabelsResponse>(
          GET_REPO_LABELS_QUERY,
          { owner, repo: getRepo() },
        );
        const existingLabels = labelsResult?.repository?.labels?.nodes.map((l) => l.name) ?? [];
        const missingLabels = typeLabels.filter((l) => !existingLabels.includes(l));

        const result = {
          platform_state: {
            fields: {
              status: {
                exists: !!config.fields.statusFieldId,
                options: liveStatusOptions,
                missing_options: missingStatusOptions,
              },
              sprint: {
                exists: !!config.fields.sprintFieldId,
              },
              story_points: {
                exists: !!config.fields.storyPointsFieldId,
              },
              priority: {
                exists: !!config.fields.priorityFieldId,
                options: livePriorityOptions,
                missing_options: missingPriorityOptions,
              },
            },
            labels: {
              existing: existingLabels,
              expected: typeLabels,
              missing: missingLabels,
            },
            iterations: {
              active: config.iterations.active
                ? {
                  name: config.iterations.active.title,
                  start_date: config.iterations.active.startDate,
                  duration_days: config.iterations.active.duration,
                }
                : null,
              next: config.iterations.next
                ? {
                  name: config.iterations.next.title,
                  start_date: config.iterations.next.startDate,
                  duration_days: config.iterations.next.duration,
                }
                : null,
              completed_count: config.iterations.completed.length,
            },
          },
          declared_vocabulary: {
            status: statusVocab,
            priority: priorityVocab,
            story_points: {
              scale: yml.sprint?.story_point_scale ?? null,
              values: yml.sprint?.story_point_values ?? null,
            },
            sprint: {
              duration_days: yml.sprint?.duration_days ?? null,
              velocity_window: yml.sprint?.velocity_window ?? 5,
              length_weeks: yml.sprint?.length_weeks ?? null,
            },
            team: yml.team ?? null,
            definition_of_ready: yml.definition_of_ready ?? null,
            definition_of_done: yml.definition_of_done ?? null,
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── Step 6: scrum_get_history ─────────────────────────────────────────────────
  //
  // Returns raw sprint snapshots for the last N completed sprints. The agent
  // derives velocity, trends, and recommendations from this data — the server
  // returns observable facts only (per design principle #6).

  server.registerTool(
    "scrum_get_history",
    {
      title: "Get Sprint History",
      description: `Return raw sprint snapshots for the last N completed sprints.

Args:
  window (integer 1–10, default 5) — how many completed sprints to include

Returns:
  window                 — number of sprints requested
  sprints[]              — one entry per completed sprint, most-recent-first:
    name                 — sprint title
    start_date           — ISO date string
    end_date             — ISO date string
    duration_days        — calendar days in the sprint
    stories[]            — lightweight story list: { number, title, points, status }
    summary              — { committed_points, completed_points, carried_points,
                             completion_rate (0–1), story_count, completed_count }

Use this to give the agent the raw data it needs to reason about velocity trends,
team throughput, and sprint commitment calibration. The agent computes averages,
trends, and recommendations — this tool returns the facts.`,
      inputSchema: GetHistorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetHistorySchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo: getRepo(),
        });

        // Most-recent-first slice of completed iterations
        const completedSorted = [...config.iterations.completed].sort(
          (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
        );
        const windowSlice = completedSorted.slice(0, params.window);

        if (windowSlice.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(
                {
                  window: params.window,
                  sprints: [],
                  message: "No completed sprints found in the project.",
                },
                null,
                2,
              ),
            }],
          };
        }

        // Fetch all items once; group by iteration client-side
        const allItems = await fetchAllItems(config, owner, ownerType);
        const { sprintFieldId, statusFieldId, storyPointsFieldId } = config.fields;
        const doneDisplay = findStatusDisplayName(config, "done", "Done");

        const sprints = windowSlice.map((iter) => {
          const iterItems = allItems.filter((item) => {
            const fv = item.fieldValues.nodes.find(
              (v) => v.field?.id === sprintFieldId,
            );
            return fv?.iterationId === iter.id;
          });

          let committedPoints = 0;
          let completedPoints = 0;
          let completedCount = 0;

          const stories = iterItems
            .filter((item) => item.content && typeof item.content.number === "number")
            .map((item) => {
              const content = item.content!;
              const ptsFv = storyPointsFieldId
                ? item.fieldValues.nodes.find((v) => v.field?.id === storyPointsFieldId)
                : null;
              const pts = ptsFv?.number ?? 0;
              const statusFv = item.fieldValues.nodes.find(
                (v) => v.field?.id === statusFieldId,
              );
              const statusName = statusFv?.name ?? null;
              const isDone = statusName === doneDisplay;

              committedPoints += pts;
              if (isDone) {
                completedPoints += pts;
                completedCount++;
              }

              return {
                number: content.number as number,
                title: content.title,
                points: pts,
                status: statusName,
              };
            });

          const carriedPoints = committedPoints - completedPoints;
          const endDate = new Date(iter.startDate);
          endDate.setDate(endDate.getDate() + iter.duration);

          return {
            name: iter.title,
            start_date: iter.startDate,
            end_date: endDate.toISOString().slice(0, 10),
            duration_days: iter.duration,
            stories,
            summary: {
              committed_points: committedPoints,
              completed_points: completedPoints,
              carried_points: carriedPoints,
              completion_rate: committedPoints > 0
                ? Math.round((completedPoints / committedPoints) * 100) / 100
                : 0,
              story_count: stories.length,
              completed_count: completedCount,
            },
          };
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ window: params.window, sprints }, null, 2),
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── Step 7: scrum_get_backlog ─────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_backlog",
    {
      title: "Get Product Backlog",
      description: `Return all stories not yet assigned to any sprint (the backlog).

Args:
  search   (string, optional)    — substring match on title or body
  labels   (string[], optional)  — include only stories carrying ALL specified labels
  priority (string, optional)    — vocabulary display value, e.g. "Must"
  epic     (string, optional)    — Milestone title filter
  limit    (integer, default 50) — max stories to return

Returns:
  stories[]              — Story objects, backlog order
  total_count            — count before limit is applied
  readiness              — { sprint_ready, in_refinement, future_candidate } counts

Readiness criteria:
  sprint_ready      = has story_points > 0 AND at least one AC checkbox in body AND has priority
  in_refinement     = has at least one of the three
  future_candidate  = has none`,
      inputSchema: GetBacklogSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetBacklogSchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo: getRepo(),
        });

        const allItems = await fetchAllItems(config, owner, ownerType);
        const { sprintFieldId } = config.fields;

        // Items with no sprint field value → backlog
        const backlogItems = allItems.filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === sprintFieldId,
          );
          return !fv || !fv.title; // no iteration assigned
        });

        let stories = backlogItems
          .map((item) => buildStoryFromRaw(item, config))
          .filter((s): s is Story => s !== null);

        // Client-side filters
        if (params.search) {
          const needle = params.search.toLowerCase();
          stories = stories.filter(
            (s) =>
              s.title.toLowerCase().includes(needle) ||
              s.body.toLowerCase().includes(needle),
          );
        }
        if (params.labels && params.labels.length > 0) {
          stories = stories.filter((s) => params.labels!.every((l) => s.labels.includes(l)));
        }
        if (params.priority) {
          stories = stories.filter((s) => s.priority === params.priority);
        }
        if (params.epic) {
          stories = stories.filter((s) => s.epic === params.epic);
        }

        const totalCount = stories.length;
        stories = stories.slice(0, params.limit);

        const readiness = {
          sprint_ready: 0,
          in_refinement: 0,
          future_candidate: 0,
        };
        for (const s of stories) {
          readiness[classifyReadiness(s)]++;
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ stories, total_count: totalCount, readiness }, null, 2),
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── Step 8: scrum_get_sprint ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_sprint",
    {
      title: "Get Sprint Board",
      description:
        `Return the sprint board: all stories for a sprint, grouped by status with point totals.

Args:
  sprint ("current"|"next"|null|sprint-name, optional, default "current")

Returns:
  sprint                 — { name, start_date, end_date, days_remaining }
  groups[]               — { status, stories[], points_sum } in status vocabulary order
  totals                 — { committed_points, completed_points, in_flight_points, blocked_points }

committed_points  = total story points in the sprint
completed_points  = points for stories in the Done status
in_flight_points  = points for stories In Progress
blocked_points    = points for stories in Blocked status

Status display names for Done/In Progress/Blocked are inferred from the team's
status vocabulary (yml.status) by searching for keys containing "done", "progress",
and "block" respectively.`,
      inputSchema: GetSprintSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetSprintSchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo: getRepo(),
        });

        const sprintRef = params.sprint ?? "current";
        const iterationId = resolveSprint(sprintRef, config);

        if (iterationId === null) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(
                {
                  message:
                    "Backlog view is not supported by scrum_get_sprint. Use scrum_get_backlog instead.",
                },
                null,
                2,
              ),
            }],
          };
        }

        // Sprint metadata for the response header
        const iterEntry = config.iterations.all.find((i) => i.id === iterationId);

        const allItems = await fetchAllItems(config, owner, ownerType);
        const { sprintFieldId } = config.fields;

        // Items in this sprint
        const sprintItems = allItems.filter((item) => {
          const fv = item.fieldValues.nodes.find(
            (v) => v.field?.id === sprintFieldId,
          );
          return fv?.iterationId === iterationId;
        });

        const stories = sprintItems
          .map((item) => buildStoryFromRaw(item, config))
          .filter((s): s is Story => s !== null);

        // Group by status display name
        const groupMap = new Map<string, Story[]>();
        for (const story of stories) {
          const key = story.status ?? "(No Status)";
          if (!groupMap.has(key)) groupMap.set(key, []);
          groupMap.get(key)!.push(story);
        }

        const groups = [...groupMap.entries()].map(([status, groupStories]) => ({
          status,
          stories: groupStories,
          points_sum: groupStories.reduce((sum, s) => sum + (s.story_points ?? 0), 0),
        }));

        // Vocabulary-based status lookups for totals
        const doneDisplay = findStatusDisplayName(config, "done", "Done");
        const inProgressDisplay = findStatusDisplayName(config, "progress", "In Progress");
        const blockedDisplay = findStatusDisplayName(config, "block", "Blocked");

        const sum = (filter: (s: Story) => boolean) =>
          stories.filter(filter).reduce((acc, s) => acc + (s.story_points ?? 0), 0);

        const totals = {
          committed_points: stories.reduce((acc, s) => acc + (s.story_points ?? 0), 0),
          completed_points: sum((s) => s.status === doneDisplay),
          in_flight_points: sum((s) => s.status === inProgressDisplay),
          blocked_points: sum((s) => s.status === blockedDisplay),
        };

        // Sprint header
        let sprintMeta: Record<string, unknown> = { name: String(sprintRef) };
        if (iterEntry) {
          const endDate = new Date(iterEntry.startDate);
          endDate.setDate(endDate.getDate() + iterEntry.duration);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysRemaining = Math.max(
            0,
            Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
          );
          sprintMeta = {
            name: iterEntry.title,
            start_date: iterEntry.startDate,
            end_date: endDate.toISOString().slice(0, 10),
            duration_days: iterEntry.duration,
            days_remaining: daysRemaining,
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ sprint: sprintMeta, groups, totals }, null, 2),
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── Step 10: scrum_get_story ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_story",
    {
      title: "Get Story Details",
      description:
        `Return full details for a single story: content, board fields, comments, linked PRs, and AC.

Args:
  ref — { number: int } or { id: string } — at least one required.
        id is the opaque project item handle (PVTI_...) returned by other tools.
        number is the human-readable GitHub issue number.

Returns:
  story                  — full Story object (status, sprint, points, priority, etc.)
  comments[]             — { author, body, created_at, url } — includes impediment cross-links
  linked_prs[]           — { number, title, url, state, is_draft } — PRs referencing this issue
  acceptance_criteria[]  — { text, checked } — parsed from markdown checkboxes in body

Comments include notes posted by scrum_log_impediment (bidirectional impediment links).`,
      inputSchema: GetStorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetStorySchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo: getRepo(),
        });

        const resolved = await resolveStory(params.ref, config, gh);

        // Fetch issue details and project item field values in parallel
        const [issueData, itemData] = await Promise.all([
          gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, {
            issueId: resolved.issueId,
          }),
          gh.graphql<GetItemFieldsResponse>(GET_ITEM_FIELDS_QUERY, {
            itemId: resolved.itemId,
          }),
        ]);

        const issue = issueData.node;
        if (!issue || issue.number === null) {
          throw new Error(
            `Issue ${resolved.issueId} could not be fetched. ` +
              "It may have been deleted or the token lacks Issues: Read access.",
          );
        }

        // Extract board field values from the project item
        const fieldValues = itemData.node?.fieldValues?.nodes ?? [];
        const { sprintFieldId, statusFieldId, storyPointsFieldId, priorityFieldId } = config.fields;

        let status: string | null = null;
        let sprint: string | null = null;
        let story_points: number | null = null;
        let priority: string | null = null;

        for (const fv of fieldValues) {
          const fieldId = fv.field?.id;
          if (!fieldId) continue;
          if (fieldId === statusFieldId && fv.name) {
            status = fv.name;
          } else if (fieldId === sprintFieldId && fv.title) {
            sprint = fv.title;
          } else if (
            storyPointsFieldId &&
            fieldId === storyPointsFieldId &&
            typeof fv.number === "number"
          ) {
            story_points = fv.number;
          } else if (priorityFieldId && fieldId === priorityFieldId && fv.name) {
            priority = fv.name;
          }
        }

        const allLabels = issue.labels?.nodes.map((l) => l.name) ?? [];
        const type = (allLabels.find((l) => STORY_TYPES.has(l)) as Story["type"]) ??
          null;
        const labels = allLabels.filter((l) => !STORY_TYPES.has(l));

        const story: Story = {
          ref: { number: issue.number!, id: resolved.itemId },
          title: issue.title ?? "",
          body: issue.body ?? "",
          type,
          status,
          sprint,
          story_points,
          priority,
          assignees: issue.assignees?.nodes.map((a) => a.login) ?? [],
          labels,
          epic: issue.milestone?.title ?? null,
          created_at: issue.createdAt ?? "",
          updated_at: issue.updatedAt ?? "",
          url: issue.url ?? null,
        };

        const comments = (issue.comments?.nodes ?? []).map((c) => ({
          author: c.author?.login ?? "(ghost)",
          body: c.body,
          created_at: c.createdAt,
          url: c.url,
        }));

        const linked_prs = (issue.timelineItems?.nodes ?? [])
          .filter((n) => n.source?.number !== null)
          .map((n) => ({
            number: n.source!.number!,
            title: n.source!.title ?? "",
            url: n.source!.url ?? "",
            state: n.source!.state ?? "UNKNOWN",
            is_draft: n.source!.isDraft ?? false,
          }));

        const acceptance_criteria = parseAcceptanceCriteria(story.body);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(
              { story, comments, linked_prs, acceptance_criteria },
              null,
              2,
            ),
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );
};
