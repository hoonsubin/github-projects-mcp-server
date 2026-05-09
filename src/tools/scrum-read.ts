// =============================================================================
// src/tools/scrum-read.ts — Phase 2: all 5 scrum_* read tools
// [Phase 2, steps 5-10 — COMPLETE]
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
import { fetchRepoFile, formatError, GitHubApiError, graphql, rest } from "../services/github.ts";
import type { RestResponse } from "../services/github.ts";
import { loadConfig } from "../services/config.ts";
import type { RuntimeConfig } from "../services/config.ts";
import { resolveSprint, resolveStory } from "../services/resolver.ts";
import { isBacklogItem, PaginatedProjectItemFetcher } from "../services/pagination.ts";
import { computeReadinessSummary } from "../services/readiness.ts";

import {
  GetBacklogSchema,
  GetBurndownSchema,
  GetHistorySchema,
  GetSprintSchema,
  GetStorySchema,
  GetTemplateSchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import type {
  ArtifactType,
  BurndownDayPoint,
  BurndownResponse,
  BurndownSprintMeta,
  BurndownStory,
  GetBacklogResult,
  IdealDayPoint,
  IterationEntry,
  ScrumConfigYml,
  Story,
  TemplateResponse,
} from "../types.ts";

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
        "Set it to the GitHub username or organization login that owns the project.",
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

// ── Field-value minimal interface ──────────────────────────────────────────────

/**
 * Minimal interface for any field-value node that carries board fields.
 * Works on both RawFieldValue (project-items query shape) and
 * ProjectV2ItemFieldValue (GET_ITEM_FIELDS_QUERY shape) because both
 * have the same structural shape for the fields we read.
 */
interface FieldValueNode {
  field?: { id: string } | null;
  name?: string; // single-select option display name
  title?: string; // iteration title
  number?: number; // number field value
}

/** Extracted board fields from any field-value node array. */
interface BoardFields {
  status: string | null;
  sprint: string | null;
  story_points: number | null;
  priority: string | null;
}

/** Exported for testing. */
export const extractBoardFields = (
  nodes: FieldValueNode[],
  fields: RuntimeConfig["fields"],
): BoardFields => {
  let status: string | null = null;
  let sprint: string | null = null;
  let story_points: number | null = null;
  let priority: string | null = null;

  for (const fv of nodes) {
    const id = fv.field?.id;
    if (!id) continue;
    if (id === fields.statusFieldId && fv.name) {
      status = fv.name;
    } else if (id === fields.sprintFieldId && fv.title) {
      sprint = fv.title;
    } else if (
      fields.storyPointsFieldId &&
      id === fields.storyPointsFieldId &&
      typeof fv.number === "number"
    ) {
      story_points = fv.number;
    } else if (
      fields.priorityFieldId &&
      id === fields.priorityFieldId &&
      fv.name
    ) {
      priority = fv.name;
    }
  }

  return { status, sprint, story_points, priority };
};

// ── Label classification ───────────────────────────────────────────────────────

/** Exported for testing. */
export const classifyLabels = (
  allLabels: string[],
): { type: Story["type"]; labels: string[] } => ({
  type: (allLabels.find((l) => STORY_TYPES.has(l)) as Story["type"]) ?? null,
  labels: allLabels.filter((l) => !STORY_TYPES.has(l)),
});

/**
 * Build a Story from a raw project item node.
 * Returns null for DraftIssues (no issue number) and items without content.
 */
const buildStoryFromRaw = (item: RawItem, config: RuntimeConfig): Story | null => {
  const content = item.content;
  if (!content || typeof content.number !== "number") return null;

  const boardFields = extractBoardFields(item.fieldValues.nodes, config.fields);
  const { type, labels } = classifyLabels(
    content.labels?.nodes.map((l) => l.name) ?? [],
  );

  return {
    ref: { number: content.number, id: item.id },
    title: content.title,
    body: content.body ?? "",
    type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
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

// ── Sprint helpers ───────────────────────────────────────────────────────────────

/**
 * Sprint metadata header returned to the agent.
 */
interface SprintMeta {
  name: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  days_remaining?: number;
}

/**
 * Sum story points across stories matching the given predicate.
 * Treats null story_points as 0.
 */
/** Exported for testing. */
export const sumPointsWhere = (
  stories: Story[],
  predicate: (s: Story) => boolean,
): number => stories.filter(predicate).reduce((acc, s) => acc + (s.story_points ?? 0), 0);

/**
 * Build the sprint metadata header for the response.
 * When iterEntry is available, returns full date/duration fields.
 * Falls back to { name: "(sprint not found)" } so the agent receives a
 * descriptive label rather than the internal SprintRef address ("current").
 */
/** Exported for testing. */
export const buildSprintMeta = (iterEntry: IterationEntry | null): SprintMeta => {
  if (!iterEntry) return { name: "(sprint not found)" };

  const endDate = new Date(iterEntry.startDate);
  endDate.setDate(endDate.getDate() + iterEntry.duration);
  endDate.setHours(0, 0, 0, 0); // normalize to avoid timezone edge cases

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
  );

  return {
    name: iterEntry.title,
    start_date: iterEntry.startDate,
    end_date: endDate.toISOString().slice(0, 10),
    duration_days: iterEntry.duration,
    days_remaining: daysRemaining,
  };
};

/**
 * Group stories by their status display name, ordered by the team's declared
 * status vocabulary. Statuses not present in the vocabulary are appended at the end.
 */
/** Exported for testing. */
export const groupStoriesByStatus = (
  stories: Story[],
  config: RuntimeConfig,
): Array<{ status: string; stories: Story[]; points_sum: number }> => {
  // Build the raw group map first
  const groupMap = new Map<string, Story[]>();
  for (const story of stories) {
    const key = story.status ?? "(No Status)";
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(story);
  }

  // Order by declared vocabulary
  const statusOrder = Object.values(
    (config.yml.status as Record<string, string>) ?? {},
  );
  const orderedGroups = statusOrder
    .filter((statusName) => groupMap.has(statusName))
    .map((statusName) => ({
      status: statusName,
      stories: groupMap.get(statusName)!,
      points_sum: sumPointsWhere(groupMap.get(statusName)!, () => true),
    }));

  // Append any statuses not in the vocabulary (e.g., options added after config was written)
  const knownStatuses = new Set(statusOrder);
  for (const [status, groupStories] of groupMap) {
    if (!knownStatuses.has(status)) {
      orderedGroups.push({
        status,
        stories: groupStories,
        points_sum: sumPointsWhere(groupStories, () => true),
      });
    }
  }

  return orderedGroups;
};

/**
 * Compute sprint point totals using vocabulary-based status identification.
 * The "done", "in progress", and "blocked" buckets are matched by keyword
 * against the team's declared status vocabulary — not hardcoded strings.
 */
/** Exported for testing. */
export const computeSprintTotals = (
  stories: Story[],
  config: RuntimeConfig,
): {
  committed_points: number;
  completed_points: number;
  in_flight_points: number;
  blocked_points: number;
} => {
  const doneDisplay = findStatusDisplayName(config, "done", "Done");
  const inProgressDisplay = findStatusDisplayName(
    config,
    "progress",
    "In Progress",
  );
  const blockedDisplay = findStatusDisplayName(config, "block", "Blocked");

  return {
    committed_points: sumPointsWhere(stories, () => true),
    completed_points: sumPointsWhere(stories, (s) => s.status === doneDisplay),
    in_flight_points: sumPointsWhere(
      stories,
      (s) => s.status === inProgressDisplay,
    ),
    blocked_points: sumPointsWhere(stories, (s) => s.status === blockedDisplay),
  };
};

// ── Comment and Linked PR types ────────────────────────────────────────────────

interface Comment {
  author: string;
  body: string;
  created_at: string;
  url: string;
}

interface CommentNode {
  author?: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

/** Exported for testing. */
export const buildCommentList = (nodes: CommentNode[]): Comment[] =>
  nodes.map((c) => ({
    author: c.author?.login ?? "(ghost)",
    body: c.body,
    created_at: c.createdAt,
    url: c.url,
  }));

interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}

interface CrossReferencedEventNode {
  source?: {
    number?: number | null;
    title?: string | null;
    url?: string | null;
    state?: string | null;
    isDraft?: boolean | null;
  } | null;
}

/**
 * Extract linked pull requests from cross-referenced events.
 *
 * Safely handles null/undefined source values with sensible defaults.
 * Entries without a valid source or number are skipped.
 *
 * @param nodes - Cross-referenced events from the GitHub GraphQL API
 * @returns Array of simplified PR objects
 */
export const buildLinkedPrList = (nodes: CrossReferencedEventNode[]): LinkedPr[] =>
  nodes.flatMap((n) => {
    const source = n.source;
    // Skip entries without a source or without a number
    if (!source || typeof source.number !== "number") return [];
    return [{
      number: source.number,
      title: source.title ?? "",
      url: source.url ?? "",
      state: source.state ?? "UNKNOWN",
      is_draft: source.isDraft ?? false,
    }];
  });

// ── Enriched Story builder ─────────────────────────────────────────────────────

/** Typed inner node from GET_ISSUE_DETAILS_QUERY response. */
interface IssueDetailsNode {
  id: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
  comments?: { nodes: CommentNode[] };
  timelineItems?: { nodes: CrossReferencedEventNode[] };
}

/** Exported for testing. */
export const buildEnrichedStory = (
  issueNode: IssueDetailsNode,
  itemId: string,
  fieldValueNodes: FieldValueNode[],
  config: RuntimeConfig,
): Story => {
  const boardFields = extractBoardFields(fieldValueNodes, config.fields);
  const { type, labels } = classifyLabels(
    issueNode.labels?.nodes.map((l) => l.name) ?? [],
  );

  return {
    ref: { number: issueNode.number, id: itemId },
    title: issueNode.title ?? "",
    body: issueNode.body ?? "",
    type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees: issueNode.assignees?.nodes.map((a) => a.login) ?? [],
    labels,
    epic: issueNode.milestone?.title ?? null,
    created_at: issueNode.createdAt ?? "",
    updated_at: issueNode.updatedAt ?? "",
    url: issueNode.url ?? null,
  };
};

/** Named helper for the "issue not found" error message. */
const missingIssueMessage = (issueId: string): string =>
  `Issue ${issueId} could not be fetched. ` +
  "It may have been deleted or the token lacks Issues: Read access.";

// ── Acceptance criteria parser ─────────────────────────────────────────────────

interface AcceptanceCriterion {
  text: string;
  checked: boolean;
}

/** Exported for testing. */
export const parseAcceptanceCriteria = (body: string): AcceptanceCriterion[] => {
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
const _classifyReadiness = (story: Story): ReadinessLevel => {
  const hasPoints = story.story_points !== null && story.story_points > 0;
  const hasAC = /^[ \t]*-[ \t]+\[([ xX])\]/m.test(story.body);
  const hasPriority = story.priority !== null;
  const score = [hasPoints, hasAC, hasPriority].filter(Boolean).length;
  if (score === 3) return "sprint_ready";
  if (score > 0) return "in_refinement";
  return "future_candidate";
};

// ── Burndown helpers ───────────────────────────────────────────────────────────

// ── Local-only interfaces (burndown internals) ─────────────────────────────────

/** Result of the completion-timestamp resolution step. */
interface CompletionResult {
  /** Issue number → ISO-8601 completion timestamp. Only includes done stories. */
  completions: Map<number, string>;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
}

/** Minimal story projection needed for burndown series computation. */
interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/** Computed sprint window — pure derivation of an IterationEntry. */
interface SprintWindow {
  name: string;
  startDate: Date;
  endDate: Date;
  durationDays: number;
  daysRemaining: number;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a GitHub REST API `Link` response header and return the URL for
 * rel="next", or null if absent or on the last page.
 *
 * Link header format: <url>; rel="next", <url>; rel="last"
 */
export const extractLinkHeader = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
};

/**
 * Compute the sprint window from an IterationEntry.
 * All Date objects are normalised to UTC midnight to guarantee
 * consistent day-boundary arithmetic regardless of the server's timezone.
 */
export const buildSprintWindow = (iterEntry: IterationEntry): SprintWindow => {
  const startDate = new Date(iterEntry.startDate);
  startDate.setUTCHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + iterEntry.duration);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - today.getTime()) / msPerDay),
  );

  return {
    name: iterEntry.title,
    startDate,
    endDate,
    durationDays: iterEntry.duration,
    daysRemaining,
  };
};

/**
 * Compute the ideal burndown line: one entry per calendar day from
 * start_date to end_date inclusive.
 *
 * Values are rounded to one decimal place to avoid floating-point noise
 * in JSON output (e.g., 13.333333... → 13.3).
 */
export const buildIdealLine = (
  window: SprintWindow,
  committedPoints: number,
): IdealDayPoint[] => {
  const ideal: IdealDayPoint[] = [];
  const cursor = new Date(window.startDate);

  for (let dayIndex = 0; dayIndex <= window.durationDays; dayIndex++) {
    const date = cursor.toISOString().slice(0, 10);
    const remaining = committedPoints * (1 - dayIndex / window.durationDays);
    ideal.push({ date, remaining_points: Math.round(remaining * 10) / 10 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ideal;
};

/**
 * Build the actual burndown series: one entry per calendar day from
 * sprint.start_date to min(today, sprint.end_date).
 *
 * A story counts as completed on day D if its completed_at timestamp
 * falls on or before the end of day D (UTC 23:59:59.999).
 */
export const buildDaySeries = (
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
  window: SprintWindow,
  committedPoints: number,
): BurndownDayPoint[] => {
  const series: BurndownDayPoint[] = [];
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const seriesEnd = window.endDate < today ? window.endDate : today;
  const cursor = new Date(window.startDate);

  while (cursor <= seriesEnd) {
    const endOfDay = new Date(cursor);
    endOfDay.setUTCHours(23, 59, 59, 999);
    const dateStr = cursor.toISOString().slice(0, 10);

    let completedPoints = 0;
    for (const story of stories) {
      const completedAt = completions.get(story.number);
      if (completedAt && new Date(completedAt) <= endOfDay) {
        completedPoints += story.points;
      }
    }

    series.push({
      date: dateStr,
      remaining_points: committedPoints - completedPoints,
      completed_points: completedPoints,
    });

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
};

// ── Vocabulary and projection helpers ──────────────────────────────────────────

/**
 * Resolve the display name for the "done" status from config vocabulary.
 * Falls back to "Done" if the vocabulary entry is missing or has no display_name.
 */
const findDoneStatusName = (config: RuntimeConfig): string => {
  const statusVocab = config.yml.status as
    | Record<string, { display_name?: string } | undefined>
    | undefined;
  if (!statusVocab) return "Done";
  const doneEntry = Object.entries(statusVocab).find(([key]) => key.toLowerCase().includes("done"));
  return doneEntry?.[1]?.display_name ?? "Done";
};

/**
 * Project a RawItem to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
 *
 * Distinct from buildStoryFromRaw: burndown needs only number, title,
 * points, and status — not body, URL, epic, assignees, or timestamps.
 * Reusing buildStoryFromRaw would resolve fields that are never consumed.
 */
export const buildBurndownStoryInput = (
  item: RawItem,
  config: RuntimeConfig,
): BurndownStoryInput | null => {
  const content = item.content;
  if (!content || typeof content.number !== "number") return null;

  const { status, story_points } = extractBoardFields(
    item.fieldValues.nodes,
    config.fields,
  );

  return {
    number: content.number,
    title: content.title,
    points: story_points ?? 0,
    status,
  };
};

// ── Network-bound helpers ──────────────────────────────────────────────────────

/** @internal Network-bound. Throws GitHubApiError(403) on non-Enterprise accounts. */
const fetchAuditLogCompletions = async (
  nodeIdToNumber: Map<string, number>,
  window: SprintWindow,
  org: string,
  doneStatusName: string,
  statusFieldName: string,
): Promise<Map<number, string>> => {
  let url =
    `/orgs/${org}/audit-log?phrase=action:projects_v2_item.field_value_updated&order=asc&per_page=100`;
  const completions = new Map<number, string>();

  while (url) {
    const response: RestResponse<unknown> = await rest(url.split("?")[0], {
      params: Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")),
    });

    const entries = (response.data as {
      total_count: number;
      data: Array<{
        created_at: string;
        field_type: string;
        field_name: string;
        value: string;
        project_item_node_id: string;
      }>;
    })?.data ?? [];

    for (const entry of entries) {
      if (
        entry.field_type === "single_select" &&
        entry.field_name === statusFieldName &&
        entry.value === doneStatusName
      ) {
        const issueNumber = nodeIdToNumber.get(entry.project_item_node_id);
        if (issueNumber !== undefined) {
          // Last "moved to Done" wins if a story moved to Done more than once
          completions.set(issueNumber, entry.created_at);
        }
      }

      // Stop if we've passed the sprint end
      if (new Date(entry.created_at) > window.endDate) {
        return completions;
      }
    }

    // Check if there are more pages
    if (entries.length === 0) break;
    const nextUrl = extractLinkHeader(response.linkHeader);
    if (!nextUrl) break;
    url = nextUrl;
  }

  return completions;
};

/** @internal Network-bound. Available on all GitHub plan tiers. */
const fetchIssueCloseCompletions = async (
  stories: BurndownStoryInput[],
  window: SprintWindow,
  owner: string,
  repo: string,
): Promise<Map<number, string>> => {
  const completions = new Map<number, string>();

  for (const story of stories) {
    try {
      const response: RestResponse<{
        events: Array<{
          id: number;
          event: string;
          created_at: string;
        }>;
      }> = await rest(
        `repos/${owner}/${repo}/issues/${story.number}/timeline`,
        { params: { per_page: "100" } },
      );

      const events = response.data?.events ?? [];

      // Find the last 'closed' event within the sprint window
      let lastCloseAt: string | null = null;
      for (const event of events) {
        if (
          event.event === "closed" &&
          new Date(event.created_at) >= window.startDate &&
          new Date(event.created_at) <= window.endDate
        ) {
          lastCloseAt = event.created_at;
        }
      }

      if (lastCloseAt) {
        completions.set(story.number, lastCloseAt);
      }
    } catch {
      // Silently skip stories that can't be fetched (rate limiting, permissions)
      continue;
    }
  }

  return completions;
};

/**
 * Resolve completion timestamps for sprint stories.
 * Tries the Enterprise Audit Log first; falls back to issue close events on 403.
 *
 * The handler delegates all data-path branching here so its own body
 * remains a linear orchestration sequence with no conditional logic.
 */
const resolveCompletionTimestamps = async (
  stories: BurndownStoryInput[],
  nodeIdToNumber: Map<string, number>,
  window: SprintWindow,
  config: RuntimeConfig,
  owner: string,
  repo: string,
): Promise<CompletionResult> => {
  const doneStatusName = findDoneStatusName(config);
  const statusFieldName = config.yml.field_names.status;

  try {
    const completions = await fetchAuditLogCompletions(
      nodeIdToNumber,
      window,
      owner,
      doneStatusName,
      statusFieldName,
    );
    return { completions, data_source: "audit_log" };
  } catch (err) {
    if (!(err instanceof GitHubApiError) || err.statusCode !== 403) throw err;
    // 403 = not an Enterprise account; degrade gracefully to the proxy path
  }

  const completions = await fetchIssueCloseCompletions(stories, window, owner, repo);
  return {
    completions,
    data_source: "issue_close_proxy",
    warning: "Burndown timestamps are inferred from issue close events, not board field changes. " +
      "This is accurate only if your team closes GitHub Issues when moving stories to Done. " +
      "Stories marked Done but not closed will appear with completed_at: null.",
  };
};

// ── Module-private helpers for the burndown handler ────────────────────────────

/** Keeps the handler free of inline branching for the backlog-ref guard. */
const burndownBacklogError = (): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} => ({
  content: [{
    type: "text" as const,
    text: JSON.stringify({
      message: "scrum_get_burndown requires a sprint reference. " +
        "Pass a sprint name or omit the field to default to the current sprint. " +
        "Burndown charts do not apply to the backlog.",
    }),
  }],
  isError: true,
});

/** Keeps the iteration filter readable at the call site. */
const itemIsInIteration = (
  item: RawItem,
  iterationId: string,
  config: RuntimeConfig,
): boolean => {
  const fv = item.fieldValues.nodes.find(
    (v) => v.field?.id === config.fields.sprintFieldId,
  );
  return fv?.iterationId === iterationId;
};

/** Builds the node-ID → issue-number lookup table from the same allItems fetch. */
const buildNodeIdMap = (items: RawItem[]): Map<string, number> =>
  new Map(
    items
      .filter((item) => typeof item.content?.number === "number")
      .map((item) => [item.id, item.content!.number!]),
  );

/** Assembles the final BurndownResponse — keeps object construction out of the handler. */
const assembleBurndownResponse = (
  window: SprintWindow,
  data_source: "audit_log" | "issue_close_proxy",
  warning: string | undefined,
  series: BurndownDayPoint[],
  ideal: IdealDayPoint[],
  stories: BurndownStoryInput[],
  completions: Map<number, string>,
): BurndownResponse => {
  const sprint: BurndownSprintMeta = {
    name: window.name,
    start_date: window.startDate.toISOString().slice(0, 10),
    end_date: window.endDate.toISOString().slice(0, 10),
    duration_days: window.durationDays,
    days_remaining: window.daysRemaining,
  };

  const burndownStories: BurndownStory[] = stories.map((s) => ({
    number: s.number,
    title: s.title,
    points: s.points,
    status: s.status,
    completed_at: completions.get(s.number) ?? null,
  }));

  return warning
    ? { sprint, data_source, warning, series, ideal, stories: burndownStories }
    : { sprint, data_source, series, ideal, stories: burndownStories };
};

// ── Template helpers (scrum_get_template) ──────────────────────────────────────

/**
 * Look up the configured file path for an artifact type.
 * Returns the path string if declared and non-null, or null if the team
 * has not configured a custom template for this type.
 */
const resolveTemplatePath = (
  yml: ScrumConfigYml,
  artifactType: ArtifactType,
): string | null => yml.templates?.[artifactType] ?? null;

/**
 * Build the "use your built-in default" response.
 * Named to make the handler's intent readable at the call site.
 */
const buildDefaultResponse = (): TemplateResponse => ({
  content: null,
  source: "default",
});

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
            templates: {
              sprint_review: yml.templates?.sprint_review ?? null,
              retrospective: yml.templates?.retrospective ?? null,
              standup: yml.templates?.standup ?? null,
              sprint_planning: yml.templates?.sprint_planning ?? null,
              refinement: yml.templates?.refinement ?? null,
            },
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

  // Returns raw sprint snapshots for the last N completed sprints. The agent
  // derives velocity, trends, and recommendations from this data — the server
  // returns observable facts only (per design principle #6).

  server.registerTool(
    "scrum_get_history",
    {
      title: "Get Sprint History",
      description: `Return raw sprint snapshots for the last N completed sprints.

Args:
  window (integer 1-10, default 5) — how many completed sprints to include

Returns:
  window                 — number of sprints requested
  sprints[]              — one entry per completed sprint, most-recent-first:
    name                 — sprint title
    start_date           — ISO date string
    end_date             — ISO date string
    duration_days        — calendar days in the sprint
    stories[]            — lightweight story list: { number, title, points, status }
    summary              — { committed_points, completed_points, carried_points,
                             completion_rate (0-1), story_count, completed_count }

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

        // Use PaginatedProjectItemFetcher for efficient pagination
        const fetcher = new PaginatedProjectItemFetcher(config, gh, {
          sprintFieldIds: [config.fields.sprintFieldId],
          includeIssueContent: true,
          includePRContent: false,
          includeDraftIssueContent: false,
          pageSize: 100,
        });

        // Collect only backlog items (no sprint assigned)
        const backlogItems = await fetcher.collect((item) =>
          isBacklogItem(item, config.fields.sprintFieldId)
        );

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
        const limitedStories = stories.slice(0, params.limit);

        const readinessSummary = computeReadinessSummary(
          limitedStories.map((story) => ({
            body: story.body,
            story_points: story.story_points,
          })),
        );

        const result: GetBacklogResult = {
          stories: limitedStories,
          total_count: totalCount,
          readiness: readinessSummary,
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
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

        // Delegate to named helpers — handler reads as orchestration only
        const groups = groupStoriesByStatus(stories, config);
        const totals = computeSprintTotals(stories, config);
        const sprint = buildSprintMeta(iterEntry ?? null);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ sprint, groups, totals }, null, 2),
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
          throw new Error(missingIssueMessage(resolved.issueId));
        }

        // Delegate to extracted helpers — handler reads as orchestration only
        const story = buildEnrichedStory(
          issue as IssueDetailsNode,
          resolved.itemId,
          itemData.node?.fieldValues?.nodes ?? [],
          config,
        );
        const comments = buildCommentList(issue.comments?.nodes ?? []);
        const linked_prs = buildLinkedPrList(issue.timelineItems?.nodes ?? []);
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

  // ── Step 11: scrum_get_burndown ───────────────────────────────────────────────

  server.registerTool(
    "scrum_get_burndown",
    {
      title: "Get Sprint Burndown",
      description:
        `Return a day-by-day burndown chart for a sprint, including an ideal line and per-story completion breakdown.

Args:
  sprint ("current"|"next"|null|sprint-name, optional, default "current")
    The sprint to compute the burndown for. Omit to default to the current sprint.
    Burndown does not apply to the backlog.

Returns:
  sprint                 — { name, start_date, end_date, duration_days, days_remaining }
  data_source            — "audit_log" or "issue_close_proxy"
  warning?               — present when data_source is "issue_close_proxy"
  series[]               — actual burndown: { date, remaining_points, completed_points }
  ideal[]                — ideal burndown line: { date, remaining_points }
  stories[]              — per-story summary: { number, title, points, status, completed_at }

data_source indicates how completion timestamps were determined:
  "audit_log"       — Enterprise Audit Log (precise field-change timestamps)
  "issue_close_proxy" — Issue close events (accurate only if issues are closed when moved to Done)

When data_source is "issue_close_proxy", a warning is included telling the agent
to communicate accuracy caveats to the user before presenting the chart.`,
      inputSchema: GetBurndownSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetBurndownSchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const repo = getRepo();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo,
        });

        // Step 1 — Resolve sprint
        const sprintRef = params.sprint ?? "current";
        const iterationId = resolveSprint(sprintRef, config);
        if (iterationId === null) {
          return burndownBacklogError();
        }
        const iterEntry = config.iterations.all.find((i) => i.id === iterationId);
        if (!iterEntry) {
          throw new Error(`Sprint "${sprintRef}" resolved to an unknown iteration ID.`);
        }

        // Step 2 — Fetch sprint stories
        const allItems = await fetchAllItems(config, owner, ownerType);
        const sprintItems = allItems.filter((item) => itemIsInIteration(item, iterationId, config));

        const stories = sprintItems
          .map((item) => buildBurndownStoryInput(item, config))
          .filter((s): s is BurndownStoryInput => s !== null);

        const nodeIdToNumber = buildNodeIdMap(sprintItems);

        // Step 3 — Compute sprint geometry
        const window = buildSprintWindow(iterEntry);
        const committedPoints = stories.reduce((sum, s) => sum + s.points, 0);

        // Step 4 — Resolve completion timestamps (audit log → proxy fallback)
        const { completions, data_source, warning } = await resolveCompletionTimestamps(
          stories,
          nodeIdToNumber,
          window,
          config,
          owner,
          repo,
        );

        // Step 5 — Build series and ideal line
        const series = buildDaySeries(stories, completions, window, committedPoints);
        const ideal = buildIdealLine(window, committedPoints);

        // Step 6 — Assemble and return
        const response = assembleBurndownResponse(
          window,
          data_source,
          warning,
          series,
          ideal,
          stories,
          completions,
        );

        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
      }
    },
  );

  // ── Step 11: scrum_get_template ──────────────────────────────────────────────
  //
  // Fetch a ceremony artifact template by type. The server never interprets,
  // validates, or interpolates templates — content is returned verbatim.
  // If no custom template is declared, the agent uses its built-in default.

  server.registerTool(
    "scrum_get_template",
    {
      title: "Get Ceremony Template",
      description: `Fetch a ceremony artifact template by type.\n\n` +
        `Args:\n` +
        `  artifact_type — one of: sprint_review, retrospective, standup, sprint_planning, refinement\n\n` +
        `Returns:\n` +
        `  If a custom template is declared in config.yml: { content: "<raw template text>", source: "custom" }\n` +
        `  If no custom template is declared: { content: null, source: "default" }\n\n` +
        `The agent applies the raw template text to the target output platform.`,
      inputSchema: GetTemplateSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetTemplateSchema>) => {
      try {
        const { owner, ownerType, projectNumber } = getBootstrapConfig();
        const repo = getRepo();
        const config = await loadConfig({
          github: gh,
          owner,
          ownerType,
          projectNumber,
          repo,
        });

        const path = resolveTemplatePath(config.yml, params.artifact_type);

        if (path === null) {
          const response: TemplateResponse = buildDefaultResponse();
          return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
        }

        const fileContent = await fetchRepoFile(owner, repo, path);
        const response: TemplateResponse = { content: fileContent, source: "custom" };
        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
      }
    },
  );
};
