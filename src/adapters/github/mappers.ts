// =============================================================================
// src/adapters/github/mappers.ts — GitHub raw types → domain types mappers
//
// Pure functions: take ProjectV2Item (or narrow input shapes) and return domain types.
// =============================================================================

import type { RuntimeConfig } from "./config-loader.ts";
import type { ProjectV2Item, Story } from "../../types.ts";
import { classifyLabels, type StoryTypeLabel } from "../../domain/rules/labels.ts";
import type { BoardFields, Comment, FieldValueNode, LinkedPr } from "./raw-types.ts";

// ── Local input shapes (private — only for function parameter types) ───────────

/** Comment node shape returned by GetIssueDetails timeline query. */
interface CommentInput {
  author?: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

/** CrossReferencedEvent node shape returned by GetIssueDetails timeline query. */
interface TimelineItemInput {
  source?: {
    number?: number | null;
    title?: string | null;
    url?: string | null;
    state?: string | null;
    isDraft?: boolean | null;
  } | null;
}

// ── Exported input shape for backend.ts ───────────────────────────────────────

/**
 * Shape of the issue node returned by GetIssueDetails, cast to this interface
 * in backend.ts before passing to buildEnrichedStory.
 */
export interface IssueDetailsInput {
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
  comments?: { nodes: CommentInput[] };
  timelineItems?: { nodes: TimelineItemInput[] };
}

// ── Field extraction ───────────────────────────────────────────────────────────

/** Extract board fields from a field-value node array. */
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

// ── Story builders ─────────────────────────────────────────────────────────────

/**
 * Build a Story from a project item.
 * Returns null only for items without content (should not occur in practice).
 * Timestamps come from the item (not the content node) because content nodes
 * for Issues/PRs do not carry createdAt/updatedAt in the ProjectV2 schema.
 *
 * DraftIssues are included: key is null, labels/url/epic are empty/null.
 */
export const buildStoryFromRaw = (
  item: ProjectV2Item,
  config: RuntimeConfig,
): Story | null => {
  const content = item.content;
  if (!content) return null;

  const boardFields = extractBoardFields(item.fieldValues.nodes, config.fields);

  // ── DraftIssue branch ───────────────────────────────────────────────────────
  if (content.__typename === "DraftIssue") {
    return {
      ref: { id: item.id },
      key: null,
      title: content.title,
      body: content.body,
      type: null,
      status: boardFields.status,
      sprint: boardFields.sprint,
      story_points: boardFields.story_points,
      priority: boardFields.priority,
      assignees: content.assignees.nodes.map((a) => a.login),
      labels: [],
      epic: null,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      url: null,
    };
  }

  // ── Issue / PullRequest branch ──────────────────────────────────────────────
  // Both have number, title, url, body, assignees, labels
  const { type, labels } = classifyLabels(
    content.labels.nodes.map((l) => l.name),
  );
  const epic = content.__typename === "Issue" ? content.milestone?.title ?? null : null;

  return {
    ref: { id: item.id },
    key: content.number.toString(),
    title: content.title,
    body: content.body,
    type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees: content.assignees.nodes.map((a) => a.login),
    labels,
    epic,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    url: content.url,
  };
};

/**
 * Build an enriched Story from a full issue node and field values.
 * Used by the getStoryDetail path after fetching GetIssueDetails.
 */
export const buildEnrichedStory = (
  issueNode: IssueDetailsInput,
  itemId: string,
  fieldValueNodes: FieldValueNode[],
  config: RuntimeConfig,
): Story => {
  const boardFields = extractBoardFields(fieldValueNodes, config.fields);
  const { type, labels } = classifyLabels(
    issueNode.labels?.nodes.map((l) => l.name) ?? [],
  );

  return {
    ref: { id: itemId },
    key: issueNode.number.toString(),
    title: issueNode.title ?? "",
    body: issueNode.body ?? "",
    type: type as StoryTypeLabel | null,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees: issueNode.assignees?.nodes.map((a) => a.login) ?? [],
    labels,
    epic: issueNode.milestone?.title ?? null,
    created_at: issueNode.createdAt,
    updated_at: issueNode.updatedAt,
    url: issueNode.url ?? null,
  };
};

// ── Detail enrichment builders ─────────────────────────────────────────────────

/**
 * Build a comment list from GraphQL comment nodes.
 */
export const buildCommentList = (nodes: CommentInput[]): Comment[] =>
  nodes.map((c) => ({
    author: c.author?.login ?? "(ghost)",
    body: c.body,
    created_at: c.createdAt,
    url: c.url,
  }));

/**
 * Build a linked PR list from cross-referenced event nodes.
 */
export const buildLinkedPrList = (nodes: TimelineItemInput[]): LinkedPr[] =>
  nodes.flatMap((n) => {
    const source = n.source;
    if (!source || typeof source.number !== "number") return [];
    return [{
      number: source.number,
      title: source.title ?? "",
      url: source.url ?? "",
      state: source.state ?? "UNKNOWN",
      is_draft: source.isDraft ?? false,
    }];
  });

// ── Burndown projection ────────────────────────────────────────────────────────

/** Lightweight burndown story projection — four fields burndown computation needs. */
export interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/**
 * Project a ProjectV2Item to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
 */
export const buildBurndownStoryInput = (
  item: ProjectV2Item,
  config: RuntimeConfig,
): BurndownStoryInput | null => {
  const content = item.content;
  if (!content || content.__typename === "DraftIssue") return null;

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
