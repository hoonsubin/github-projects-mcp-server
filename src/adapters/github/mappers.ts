// =============================================================================
// src/adapters/github/mappers.ts — GitHub raw types → domain types mappers
//
// Pure functions: take ProjectItem (or narrow input shapes) and return domain types.
// =============================================================================

import type { RuntimeConfig } from "./config-loader.ts";
import type { DraftStory, IssueStory, IterationEntry, Story } from "../../domain/types.ts";
import type { BurndownStoryInput, SprintInfo } from "../../scrum/ports.ts";
// classifyLabels / StoryTypeLabel removed — type is now read from the Type board field,
// not from repo labels. See extractBoardFields → typeFieldId branch below.
import type { BoardFields, Comment, FieldValueNode, LinkedPr, ProjectItem } from "./types.ts";

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
  milestone?: { id: string; title: string } | null;
  comments?: { nodes: CommentInput[] };
  timelineItems?: { nodes: TimelineItemInput[] };
}

// ── Field extraction ───────────────────────────────────────────────────────────

/** Extract board fields from a field-value node array. */
const extractBoardFields = (
  nodes: FieldValueNode[],
  fields: RuntimeConfig["fields"],
): BoardFields => {
  let status: string | null = null;
  let sprint: string | null = null;
  let story_points: number | null = null;
  let priority: string | null = null;
  let type: string | null = null;

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
    } else if (fields.typeFieldId && id === fields.typeFieldId && fv.name) {
      type = fv.name;
    }
  }

  return { status, sprint, story_points, priority, type };
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
  item: ProjectItem,
  config: RuntimeConfig,
): Story | null => {
  const content = item.content;
  if (!content) return null;

  const boardFields = extractBoardFields(item.fieldValues.nodes, config.fields);

  // ── DraftIssue branch ───────────────────────────────────────────────────────
  if (content.__typename === "DraftIssue") {
    // assignees is absent when includeDraftIssueContent: false — skip this item
    if (!content.assignees) return null;
    const draft: DraftStory = {
      kind: "draft",
      ref: { id: item.id },
      key: null,
      title: content.title,
      body: content.body,
      type: boardFields.type,
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
    return draft;
  }

  // ── Issue / PullRequest branch ──────────────────────────────────────────────
  // Both have number, title, url, body, assignees, labels
  // labels/assignees are absent when includePRContent: false — skip this item
  if (!content.labels || !content.assignees) return null;
  // Type comes from the Type board field — not from labels.
  // All repo labels are passed through unfiltered.
  const labels = content.labels.nodes.map((l) => l.name);
  const epic = content.__typename === "Issue" && content.milestone
    ? { ref: { id: content.milestone.id }, name: content.milestone.title }
    : null;

  const issue: IssueStory = {
    kind: "issue",
    ref: { id: item.id },
    key: content.number.toString(),
    title: content.title,
    body: content.body,
    type: boardFields.type,
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
  return issue;
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
): IssueStory => {
  const boardFields = extractBoardFields(fieldValueNodes, config.fields);
  // Type comes from the Type board field — not from labels.
  // All repo labels are passed through unfiltered.
  const labels = issueNode.labels?.nodes.map((l) => l.name) ?? [];

  return {
    kind: "issue",
    ref: { id: itemId },
    key: issueNode.number.toString(),
    title: issueNode.title ?? "",
    body: issueNode.body ?? "",
    type: boardFields.type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees: issueNode.assignees?.nodes.map((a) => a.login) ?? [],
    labels,
    epic: issueNode.milestone
      ? { ref: { id: issueNode.milestone.id }, name: issueNode.milestone.title }
      : null,
    created_at: issueNode.createdAt,
    updated_at: issueNode.updatedAt,
    url: issueNode.url ?? "",
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

// ── Sprint info projection ─────────────────────────────────────────────────────

/**
 * Map an IterationEntry to the platform-agnostic SprintInfo shape.
 * Returns null when iter is null (no active/next sprint configured).
 * Used by StoryQueryService and backend.ts getPlatformState.
 */
export const toSprintInfo = (iter: IterationEntry | null): SprintInfo | null => {
  if (!iter) return null;
  const endDate = new Date(iter.startDate);
  endDate.setDate(endDate.getDate() + iter.duration);
  return {
    name: iter.title,
    startDate: iter.startDate,
    durationDays: iter.duration,
    endDate: endDate.toISOString().slice(0, 10),
  };
};

// ── Burndown projection ────────────────────────────────────────────────────────

/**
 * Project a ProjectItem to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
 */
export const buildBurndownStoryInput = (
  item: ProjectItem,
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
