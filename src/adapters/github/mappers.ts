// =============================================================================
// src/adapters/github/mappers.ts — GitHub raw types → domain types mappers
//
// Pure functions: take ProjectItem (or narrow input shapes) and return domain types.
// Local input shapes are grounded in github-types.ts via Pick so field renames
// in the generated schema break at compile time rather than silently desyncing.
// =============================================================================

import type { RuntimeConfig } from "./config-loader.ts";
import type {
  DependencyEntry,
  DraftStory,
  IssueStory,
  ItemType,
  IterationEntry,
  Story,
} from "../../domain/types.ts";
import type { BurndownStoryInput, SprintInfo } from "../../scrum/ports.ts";
import type {
  AssigneeNodes,
  BoardFields,
  CommentProjection,
  FieldValueNode,
  IssueRefNode,
  LabelNameOnly,
  LinkedPr,
  MilestoneRefNode,
  ProjectItem,
  TimelinePrSource,
  UserLogin,
} from "./types.ts";
import type { StoryComment } from "../../domain/types.ts";

// ── Local input shapes (private — only for function parameter types) ───────────

/**
 * Query projection of GH.IssueComment for buildCommentList.
 * Grounded in GH types so field renames in the generated schema break at compile time.
 */
interface CommentInput extends CommentProjection {
  author?: UserLogin | null;
}

/**
 * Query projection of CrossReferencedEvent.source for buildLinkedPrList.
 * The source field is GH.PullRequest (ReferencedSubject = Issue | PullRequest —
 * in practice only PullRequests appear as linked artifacts).
 */
interface TimelineItemInput {
  source?: TimelinePrSource | null;
}

// ── Dependency mapping ─────────────────────────────────────────────────────────

/**
 * Map Issue.blockedBy GraphQL connection to a DependencyEntry array.
 * Used by buildStoryFromRaw (project items) and buildEnrichedStory (detail query).
 */
const mapIssueDependencies = (
  issueContent: { blockedBy?: { nodes: IssueRefNode[] } },
): DependencyEntry[] => {
  const toEntry = (n: IssueRefNode): DependencyEntry => ({
    key: String(n.number),
    title: n.title,
    ref: { id: n.id }, // issue node ID — resolveDependencyRefs() maps to project item IDs
  });
  return (issueContent.blockedBy?.nodes ?? []).map(toEntry);
};

// ── Exported input shape for backend.ts ───────────────────────────────────────

/**
 * Shape of the issue node returned by GetIssueDetails, cast to this interface
 * in backend.ts before passing to buildEnrichedStory.
 *
 * Flat scalar fields are grounded in GH.Issue via Pick so that field renames in
 * the generated schema break at compile time. Nested connection shapes
 * (assignees, labels, milestone, comments, timelineItems) are query-projection
 * shapes narrower than the full schema connection types.
 */
export interface IssueDetailsInput {
  id: string;
  number: number;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  body: string | null;
  url: string | null;
  assignees?: AssigneeNodes;
  labels?: { nodes: Array<LabelNameOnly> };
  milestone?: MilestoneRefNode | null;
  blockedBy?: { nodes: IssueRefNode[] };
  blocking?: { nodes: IssueRefNode[] };
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
  let type: ItemType | null = null;

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
      type = fv.name as ItemType;
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
      blocked_by: [],
    };
    return draft;
  }

  // ── Issue / PullRequest branch ──────────────────────────────────────────────
  // Both have number, title, url, body, assignees, labels
  // labels/assignees are absent when includePRContent: false — skip this item
  if (!content.labels || !content.assignees) return null;
  // Type comes from the Type board field — not from labels.
  // All repo labels are passed through unfiltered.
  const labels: string[] = content.labels.nodes.map((l: { name: string }) => l.name);
  const epic = content.__typename === "Issue" && content.milestone
    ? { ref: { id: content.milestone.id }, name: content.milestone.title }
    : null;

  // Dependencies come from native Issue.blockedBy GraphQL field
  const blockedBy = content.__typename === "Issue"
    ? mapIssueDependencies(content)
    : [] as DependencyEntry[];
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
    blocked_by: blockedBy,
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
  const labels: string[] = issueNode.labels?.nodes.map((l: { name: string }) => l.name) ?? [];

  // Dependencies come from native Issue.blockedBy GraphQL field
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
    blocked_by: mapIssueDependencies(issueNode),
  };
};

// ── Detail enrichment builders ─────────────────────────────────────────────────

/**
 * Build a comment list from GraphQL comment nodes.
 */
export const buildCommentList = (nodes: CommentInput[]): StoryComment[] =>
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
    id: iter.id,
    name: iter.title,
    startDate: iter.startDate,
    durationDays: iter.duration,
    endDate: endDate.toISOString().slice(0, 10),
  };
};

// ── Dependency ref resolution ──────────────────────────────────────────────────

/**
 * Second-pass resolver: fills in ref.id for dependency entries by matching
 * issue node IDs or issue numbers against in-memory project items.
 *
 * Called at the end of getBacklogStories() and getSprintStories() — both of which
 * have the full list of ProjectItems already in memory. Not called from
 * getStoryDetail() — ref.id stays as issue node ID in that context.
 */
export const resolveDependencyRefs = (
  stories: Story[],
  allItems: ProjectItem[],
): Story[] => {
  // Build lookups: issue number string → project item ID, and issue node ID → project item ID
  const keyToId = new Map<string, string>();
  const issueIdToItemId = new Map<string, string>();
  for (const item of allItems) {
    const content = item.content;
    if (!content || content.__typename === "DraftIssue") continue;
    const issueKey = String(content.number);
    if (issueKey && item.id) {
      keyToId.set(issueKey, item.id);
      issueIdToItemId.set(content.id, item.id);
    }
  }

  const resolve = (entries: readonly DependencyEntry[]): DependencyEntry[] =>
    entries.map((e) => {
      // Try issue node ID → project item ID (from native API mapping)
      const idFromIssue = issueIdToItemId.get(e.ref.id);
      if (idFromIssue) {
        return { ...e, ref: { id: idFromIssue } };
      }
      // Fallback: issue number string → project item ID (legacy path)
      const idFromKey = keyToId.get(e.key);
      if (idFromKey) {
        return { ...e, ref: { id: idFromKey } };
      }
      return e;
    });

  return stories.map((s) => ({
    ...s,
    blocked_by: resolve(s.blocked_by),
  }));
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
