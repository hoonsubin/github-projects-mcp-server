// =============================================================================
// src/services/scrum.ts
// Core helpers for the SCRUM sprint tool layer.
//
// Responsibilities:
//   - loadScrumConfig()       merge scrum.config.yml + project-board.config.json
//   - resolveFields()         name → ID via _fields_registry (fast path) or live fallback
//   - fetchAllItems()         auto-paginated full item list
//   - resolveTargetIteration() active or explicit iteration lookup
//   - Field value extractors  getNumberFieldValue, getStatusValue, getIterationValue
//   - Aggregation helpers     sumStoryPoints, extractPriorityValue
//   - Item classification     isBacklogItem, getItemTitle, getItemNumber, getItemUrl, getItemAssignees
//   - Cursor helpers          encodeCursor, decodeCursor
//   - Date helpers            computeEndDate, daysRemaining
// =============================================================================

import { parse as parseYaml } from "@std/yaml";
import type {
  BoardConfig,
  MergedScrumConfig,
  ProjectItemsData,
  ProjectV2Item,
  ProjectV2ItemFieldValue,
  ResolvedScrumFields,
  SprintIteration,
} from "../types.ts";
import { graphql } from "./github.ts";
import {
  ITEM_CONTENT_FRAGMENT,
  ITEM_FIELD_VALUES_FRAGMENT,
} from "./formatters.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRUM_CONFIG_PATH = "./config/scrum.config.yml";
const BOARD_CONFIG_PATH = "./config/project-board.config.json";

/** Used when project-board.config.json is absent (first run before sync). */
const EMPTY_BOARD_CONFIG: BoardConfig = {
  _last_synced: null,
  project: { id: null, title: null, url: null },
  status_values: {},
  priority: {},
  item_types: {},
  sprint: { _field_id: null, active_sprint: null, all_iterations: [] },
  impediment: { _field_id: null, statuses: [] },
  story_points: { _field_id: null },
  _fields_registry: {},
  _epic_field: null,
  _assignee_field: null,
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load and merge scrum.config.yml (human-authored) with project-board.config.json
 * (GitHub-synced). Called at the start of every sprint tool invocation — no caching,
 * no restart needed when either file changes.
 *
 * If project-board.config.json is absent, the board section is initialised to empty
 * defaults so the server starts without error; resolveFields() will use the live
 * field fallback path in that case.
 */
export const loadScrumConfig = async () => {
  const humanRaw = await Deno.readTextFile(SCRUM_CONFIG_PATH);
  const human = parseYaml(humanRaw) as Omit<MergedScrumConfig, "_board">;

  let board: BoardConfig = EMPTY_BOARD_CONFIG;
  try {
    const boardRaw = await Deno.readTextFile(BOARD_CONFIG_PATH);
    board = JSON.parse(boardRaw) as BoardConfig;
  } catch {
    // Absent or unreadable — caller will get a helpful error from resolveFields()
    // instructing them to run `deno task sync-config`.
  }

  return { ...human, _board: board } as MergedScrumConfig;
};

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------

const throwMissing = (
  key: string,
  name: string,
  registry: Record<string, unknown>,
): never => {
  throw new Error(
    `Field "${name}" (field_names.${key} in scrum.config.yml) was not found in ` +
      `_fields_registry. Known fields: [${Object.keys(registry).join(", ")}]. ` +
      `Run \`deno task sync-config\` to refresh.`,
  );
};

const resolveDoneOptionId = (config: MergedScrumConfig): string | null => {
  const sv = config._board.status_values as Record<string, unknown>;
  const opts = sv._options as Array<{ id: string; name: string }> | undefined;
  if (!opts) return null;
  const doneName = (sv.done as string | undefined) ?? "Done";
  return opts.find((o) => o.name === doneName)?.id ?? null;
};

const resolveBlockedOptionId = (config: MergedScrumConfig): string | null => {
  const sv = config._board.status_values as Record<string, unknown>;
  const opts = sv._options as Array<{ id: string; name: string }> | undefined;
  if (!opts) return null;
  const blockedName = (sv.blocked as string | undefined) ?? "Blocked";
  return opts.find((o) => o.name === blockedName)?.id ?? null;
};

/**
 * Resolve field names from scrum.config.yml to GitHub node IDs.
 *
 * Fast path (preferred): reads from _fields_registry in project-board.config.json —
 * zero extra API calls. Requires `deno task sync-config` to have been run at least once.
 *
 * Fallback: when liveFields are provided (e.g. sprint_status already fetched them),
 * resolves directly from that array.
 *
 * Throws a descriptive error if a required field name cannot be resolved by either path.
 */
export const resolveFields = (
  config: MergedScrumConfig,
  liveFields?: Array<{
    id: string;
    name: string;
    dataType: string;
    __typename: string;
  }>,
): ResolvedScrumFields => {
  const registry = config._board._fields_registry;
  const fn = config.field_names;

  if (Object.keys(registry).length > 0) {
    return {
      sprintFieldId:
        registry[fn.sprint]?.id ?? throwMissing("sprint", fn.sprint, registry),
      statusFieldId:
        registry[fn.status]?.id ?? throwMissing("status", fn.status, registry),
      storyPointsFieldId: registry[fn.story_points]?.id ?? null,
      priorityFieldId: registry[fn.priority]?.id ?? null,
      impedimentFieldId: registry[fn.impediment]?.id ?? null,
      doneOptionId: resolveDoneOptionId(config),
      blockedOptionId: resolveBlockedOptionId(config),
    };
  }

  if (liveFields && liveFields.length > 0) {
    const findId = (name: string): string | null =>
      liveFields.find((f) => f.name === name)?.id ?? null;

    return {
      sprintFieldId: findId(fn.sprint) ?? throwMissing("sprint", fn.sprint, {}),
      statusFieldId: findId(fn.status) ?? throwMissing("status", fn.status, {}),
      storyPointsFieldId: findId(fn.story_points),
      priorityFieldId: findId(fn.priority),
      impedimentFieldId: findId(fn.impediment),
      doneOptionId: resolveDoneOptionId(config),
      blockedOptionId: resolveBlockedOptionId(config),
    };
  }

  throw new Error(
    "project-board.config.json has no _fields_registry and no live fields were provided. " +
      "Run `deno task sync-config` first.",
  );
};

// ---------------------------------------------------------------------------
// Item fetching (auto-paginated)
// ---------------------------------------------------------------------------

const buildFetchItemsQuery = (ownerType: "user" | "org"): string => {
  const ownerField = ownerType === "user" ? "user" : "organization";
  return `
    query GetAllProjectItems($login: String!, $number: Int!, $first: Int!, $after: String) {
      ${ownerField}(login: $login) {
        projectV2(number: $number) {
          items(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isArchived
              createdAt
              updatedAt
              ${ITEM_CONTENT_FRAGMENT}
              ${ITEM_FIELD_VALUES_FRAGMENT}
            }
          }
        }
      }
    }
  `;
};

/**
 * Fetch every item in a project by walking the pagination cursor until exhausted.
 * Returns a flat array of all non-null nodes (archived items included — callers
 * filter by isArchived as needed).
 */
export const fetchAllItems = async (
  owner: string,
  ownerType: "user" | "org",
  projectNumber: number,
): Promise<ProjectV2Item[]> => {
  const query = buildFetchItemsQuery(ownerType);
  const items: ProjectV2Item[] = [];
  let cursor: string | null = null;

  while (true) {
    const data: ProjectItemsData = await graphql<ProjectItemsData>(query, {
      login: owner,
      number: projectNumber,
      first: 100,
      after: cursor,
    });

    const projectData =
      ownerType === "user"
        ? data.user?.projectV2
        : data.organization?.projectV2;

    if (!projectData) break;

    items.push(...projectData.items.nodes);

    if (!projectData.items.pageInfo.hasNextPage) break;
    const nextCursor = projectData.items.pageInfo.endCursor ?? null;
    if (nextCursor === null) break; // shouldn't happen, but guard against infinite loop
    cursor = nextCursor;
  }

  return items;
};

// ---------------------------------------------------------------------------
// Iteration resolution
// ---------------------------------------------------------------------------

/**
 * Find the target sprint iteration from the full iteration list.
 *
 * If iterationId is provided: find by ID (searches both active and completed).
 * If omitted: find the iteration whose date range contains today.
 *
 * Throws if the requested iteration doesn't exist or no iteration is currently active.
 */
export const resolveTargetIteration = (
  allIterations: SprintIteration[],
  iterationId?: string,
): SprintIteration & { endDate: string; daysRemaining: number } => {
  if (iterationId) {
    const found = allIterations.find((it) => it.id === iterationId);
    if (!found) {
      throw new Error(
        `Iteration "${iterationId}" not found. ` +
          `Available: ${allIterations.map((it) => `${it.title} (${it.id})`).join(", ")}`,
      );
    }
    const endDate = computeEndDate(found.startDate, found.duration);
    return { ...found, endDate, daysRemaining: calcDaysRemaining(endDate) };
  }

  // Auto-detect: find iteration where today falls within [startDate, endDate]
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const it of allIterations) {
    if (it.completed) continue;
    const start = new Date(it.startDate);
    const endDate = computeEndDate(it.startDate, it.duration);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 0);

    if (today >= start && today <= end) {
      return { ...it, endDate, daysRemaining: calcDaysRemaining(endDate) };
    }
  }

  throw new Error(
    "No active iteration found for today's date. The project may be between sprints, " +
      "or no iterations exist yet. Pass an explicit iteration_id to query a specific sprint.",
  );
};

// ---------------------------------------------------------------------------
// Field value extractors (match by field.id)
// ---------------------------------------------------------------------------

/**
 * Find the raw field value node for a given field ID on a project item.
 * Returns undefined if the item has no value set for that field.
 */
export const getFieldValue = (
  item: ProjectV2Item,
  fieldId: string,
): ProjectV2ItemFieldValue | undefined =>
  item.fieldValues.nodes.find((fv) => fv.field?.id === fieldId);

/** Extract a numeric field value; returns null if unset. */
export const getNumberFieldValue = (
  item: ProjectV2Item,
  fieldId: string,
): number | null => {
  const fv = getFieldValue(item, fieldId);
  return fv?.number ?? null;
};

/** Extract a single-select field value; returns null if unset. */
export const getStatusValue = (
  item: ProjectV2Item,
  fieldId: string,
): { name: string; optionId: string } | null => {
  const fv = getFieldValue(item, fieldId);
  if (!fv || fv.name === undefined || fv.optionId === undefined) return null;
  return { name: fv.name, optionId: fv.optionId };
};

/** Extract an iteration field value; returns null if unset (item is in backlog). */
export const getIterationValue = (
  item: ProjectV2Item,
  fieldId: string,
): { iterationId: string; title: string } | null => {
  const fv = getFieldValue(item, fieldId);
  if (!fv || !fv.iterationId || !fv.title) return null;
  return { iterationId: fv.iterationId, title: fv.title };
};

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Sum story points (numeric field) across a list of items.
 * Items with no value set contribute 0.
 * Returns 0 immediately if fieldId is null (story_points not configured).
 */
export const sumStoryPoints = (
  items: ProjectV2Item[],
  fieldId: string | null,
): number => {
  if (!fieldId) return 0;
  return items.reduce(
    (sum, item) => sum + (getNumberFieldValue(item, fieldId) ?? 0),
    0,
  );
};

/**
 * Return the sort key for an item's priority field.
 * For single-select fields, uses the option's index in orderedOptions (lower = higher priority).
 * Items with no priority set sort to the end (Infinity).
 */
export const extractPriorityValue = (
  item: ProjectV2Item,
  fieldId: string | null,
  orderedOptions: string[],
): number => {
  if (!fieldId) return Infinity;
  const fv = getFieldValue(item, fieldId);
  if (!fv?.name) return Infinity;
  const idx = orderedOptions.indexOf(fv.name);
  return idx === -1 ? Infinity : idx;
};

// ---------------------------------------------------------------------------
// Item classification helpers
// ---------------------------------------------------------------------------

/**
 * An item is a backlog item when it has no iteration assigned and is not archived.
 * Used by github_get_backlog_items to distinguish Product Backlog from Sprint Backlog.
 */
export const isBacklogItem = (
  item: ProjectV2Item,
  sprintFieldId: string,
): boolean =>
  !item.isArchived && getIterationValue(item, sprintFieldId) === null;

/** Extract a display title from any item content type. */
export const getItemTitle = (item: ProjectV2Item): string =>
  item.content?.title ?? "(no title)";

/** Extract a human-readable issue/PR number; null for draft issues. */
export const getItemNumber = (item: ProjectV2Item): number | null =>
  (item.content as { number?: number } | null)?.number ?? null;

/** Extract the item's URL; null for draft issues. */
export const getItemUrl = (item: ProjectV2Item): string | null =>
  (item.content as { url?: string } | null)?.url ?? null;

/** Extract the logins of all assignees for an item. */
export const getItemAssignees = (item: ProjectV2Item): string[] =>
  (
    item.content as { assignees?: { nodes: Array<{ login: string }> } } | null
  )?.assignees?.nodes.map((a) => a.login) ?? [];

// ---------------------------------------------------------------------------
// Client-side pagination cursor helpers
// ---------------------------------------------------------------------------

/**
 * Encode a numeric array index as a base64 cursor string.
 * GitHub server cursors cannot be reused after client-side filtering, so sprint
 * tools that filter locally (backlog, sprint items) use this client-side cursor.
 */
export const encodeCursor = (index: number): string => btoa(String(index));

/** Decode a base64 cursor back to an array index. Throws on invalid input. */
export const decodeCursor = (cursor: string): number => {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    throw new Error(`Invalid pagination cursor: "${cursor}"`);
  }
  const n = parseInt(decoded, 10);
  if (isNaN(n) || n < 0) {
    throw new Error(`Invalid pagination cursor: "${cursor}"`);
  }
  return n;
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Compute the inclusive end date of an iteration.
 * A 14-day sprint starting on April 27 ends on May 10 (27 + 14 - 1 = 40 → May 10).
 */
export const computeEndDate = (
  startDate: string,
  durationDays: number,
): string => {
  const d = new Date(startDate);
  d.setDate(d.getDate() + durationDays - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Return the number of whole days remaining until endDate (inclusive of end-of-day).
 * Returns 0 once the end date has passed.
 */
export const calcDaysRemaining = (endDate: string): number => {
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 0);
  const diffMs = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
};
