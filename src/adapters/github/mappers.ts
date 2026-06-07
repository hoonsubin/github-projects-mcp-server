// =============================================================================
// src/adapters/github/mappers.ts - GitHub raw types → domain types mappers
//
// Pure functions: take ProjectItem (or narrow input shapes) and return domain types.
// Local input shapes are grounded in github-types.ts via Pick so field renames
// in the generated schema break at compile time rather than silently desyncing.
// =============================================================================

import type { GitHubBootState } from "./bootstrap.ts";
import { notImplemented } from "./errors.ts";
import type {
  DependencyEntry,
  ItemType,
  IterationEntry,
  StoryBase,
  StoryComment,
} from "../../domain/types.ts";
import { computeSprintEndDate } from "../../scrum/sprint-math.ts";
import type {
  BurndownStoryInput,
  ItemAggregate,
  SprintInfo,
  StorySnapshotOverrides,
} from "../../scrum/ports.ts";
import type { Story } from "../../domain/types.ts";
import type { CreateStoryInput, ScrumField, StoryUpdates } from "../../scrum/ports.ts";
import type { SprintRef } from "../../domain/types.ts";
import { resolveSprint } from "./internal/resolver.ts";
import type {
  AssigneeNodes,
  BoardFields,
  CommentProjection,
  DraftStory,
  FieldValueNode,
  IssueRefNode,
  IssueStory,
  LabelNameOnly,
  LinkedPr,
  MilestoneRefNode,
  OrgIssueFieldValueNode,
  ProjectItem,
  TimelinePrSource,
  UserLogin,
} from "./types.ts";

// ── Local input shapes (private - only for function parameter types) ───────────

/**
 * Query projection of GH.IssueComment for buildCommentList.
 * Grounded in GH types so field renames in the generated schema break at compile time.
 */
interface CommentInput extends CommentProjection {
  author?: UserLogin | null;
}

/**
 * Query projection of CrossReferencedEvent.source for buildLinkedPrList.
 * The source field is GH.PullRequest (ReferencedSubject = Issue | PullRequest -
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
    ref: { id: n.id }, // issue node ID - resolveDependencyRefs() maps to project item IDs
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
  issueType?: { id: string; name: string } | null;
  assignees?: AssigneeNodes;
  labels?: { nodes: Array<LabelNameOnly> };
  milestone?: MilestoneRefNode | null;
  blockedBy?: { nodes: IssueRefNode[] };
  blocking?: { nodes: IssueRefNode[] };
  comments?: { nodes: CommentInput[] };
  timelineItems?: { nodes: TimelineItemInput[] };
}

// ── Field extraction ───────────────────────────────────────────────────────────

/**
 * Fill in null story_points / priority from Issue.issueFieldValues when the
 * project board fieldValues extraction found nothing (org issue-backed fields).
 * Matches by field name against field_mapping — mutates `fields` in place.
 */
const overlayOrgIssueFieldValues = (
  fields: BoardFields,
  nodes: OrgIssueFieldValueNode[],
  fieldMapping: GitHubBootState["ghConfig"]["field_mapping"],
): void => {
  for (const node of nodes) {
    const fieldName = node.field?.name;
    if (!fieldName) continue;
    if (fields.story_points === null && fieldMapping.story_points === fieldName) {
      const n = Number(node.value);
      if (Number.isFinite(n)) fields.story_points = n;
    }
    if (fields.priority === null && fieldMapping.priority === fieldName) {
      if (typeof node.name === "string") fields.priority = node.name;
    }
  }
};

// rather than exclusively reading from a static set of fields
/** Extract board fields from a field-value node array. */
const extractBoardFields = (
  nodes: FieldValueNode[],
  config: GitHubBootState,
  issueTypeName: string | null = null,
): BoardFields => {
  const fields = config.live.fields;
  const typeMapping = config.ghConfig.type_mapping ?? {};
  const displayToCanonical = Object.fromEntries(
    Object.entries(typeMapping).map(([key, entry]) => [entry.display, key]),
  );

  let status: string | null = null;
  let sprint: string | null = null;
  let story_points: number | null = null;
  let priority: string | null = null;
  let type: ItemType | null = null;

  for (const fv of nodes) {
    const id = fv.field?.id;
    if (!id) continue;

    // Unwrap org-level issue field values: the display name and number are nested
    // under issueFieldValue rather than at the top level of the node.
    const effectiveName: string | undefined = fv.name ??
      (typeof fv.issueFieldValue?.name === "string" ? fv.issueFieldValue.name : undefined);
    const effectiveNumber: number | undefined = fv.number ??
      (typeof fv.issueFieldValue?.value === "number" ? fv.issueFieldValue.value : undefined);

    if (id === fields.statusFieldId && effectiveName) {
      status = effectiveName;
    } else if (id === fields.sprintFieldId && fv.title) {
      sprint = fv.title;
    } else if (
      fields.storyPointsFieldId &&
      id === fields.storyPointsFieldId &&
      typeof effectiveNumber === "number"
    ) {
      story_points = effectiveNumber;
    } else if (
      fields.priorityFieldId &&
      id === fields.priorityFieldId &&
      effectiveName
    ) {
      priority = effectiveName;
    } else if (
      config.live.typeResolution.source === "board_field" &&
      id === config.live.typeResolution.fieldId &&
      effectiveName
    ) {
      type = (displayToCanonical[effectiveName] ?? null) as ItemType | null;
    }
  }

  if (config.live.typeResolution.source === "org_issue_type" && issueTypeName) {
    type = (displayToCanonical[issueTypeName] ?? null) as ItemType | null;
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
  config: GitHubBootState,
): StoryBase | null => {
  const content = item.content;
  if (!content) return null;

  const boardFields = extractBoardFields(
    item.fieldValues.nodes,
    config,
    content.__typename === "Issue" ? content.issueType?.name ?? null : null,
  );
  if (content.__typename === "Issue" && content.issueFieldValues?.nodes.length) {
    overlayOrgIssueFieldValues(
      boardFields,
      content.issueFieldValues.nodes,
      config.ghConfig.field_mapping,
    );
  }

  // ── DraftIssue branch ───────────────────────────────────────────────────────
  if (content.__typename === "DraftIssue") {
    const draft: DraftStory = {
      kind: "draft",
      ref: { id: item.id },
      key: null,
      title: content.title,
      body: content.body ?? "",
      type: boardFields.type,
      status: boardFields.status,
      sprint: boardFields.sprint,
      story_points: boardFields.story_points,
      priority: boardFields.priority,
      assignees: content.assignees?.nodes.map((a) => a.login) ?? [],
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
  // Aggregate query profiles omit labels/assignees; default to empty collections.
  const labels: string[] = content.labels?.nodes.map((l: { name: string }) => l.name) ?? [];
  const assignees: string[] = content.assignees?.nodes.map((a) => a.login) ?? [];
  const epic = content.__typename === "Issue" && content.milestone
    ? { ref: { id: content.milestone.id }, name: content.milestone.title }
    : null;

  const blockedBy = content.__typename === "Issue" && content.blockedBy
    ? mapIssueDependencies(content)
    : [] as DependencyEntry[];

  const body = "body" in content ? (content.body ?? "") : "";
  const url = "url" in content && content.url ? content.url : "";

  const issue: IssueStory = {
    kind: "issue",
    ref: { id: item.id },
    key: content.number.toString(),
    title: content.title,
    body,
    type: boardFields.type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees,
    labels,
    epic,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    url,
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
  config: GitHubBootState,
): IssueStory => {
  const boardFields = extractBoardFields(
    fieldValueNodes,
    config,
    issueNode.issueType?.name ?? null,
  );
  // Type comes from either the board field or org issue type, depending on bootstrap typeResolution.
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
    body: c.body ?? "",
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
  return {
    id: iter.id,
    name: iter.title,
    goal: null,
    startDate: iter.startDate,
    durationDays: iter.duration,
    endDate: computeSprintEndDate(iter.startDate, iter.duration),
  };
};

/**
 * Attempt to resolve a sprint goal for the given iteration.
 * Always throws NOT_IMPLEMENTED - the GitHub Projects API does not expose
 * iteration descriptions or goals.
 *
 * Call via catchBackend so the throw is converted to a warning rather than
 * aborting the enclosing request.
 */
export const resolveSprintGoal = (_iter: IterationEntry): never =>
  notImplemented("sprint goal", { reason: "GitHub Projects API does not expose iteration goals" });

// ── Dependency ref resolution ──────────────────────────────────────────────────

/**
 * Second-pass resolver: fills in ref.id for dependency entries by matching
 * issue node IDs or issue numbers against in-memory project items.
 *
 * Called after mapping stories from project items when the full item set is
 * available in memory. Not called from getStoryDetail() — ref.id stays as
 * issue node ID in that context.
 */
export const resolveDependencyRefs = (
  stories: StoryBase[],
  allItems: ProjectItem[],
): StoryBase[] => {
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

// ── Aggregate projection ───────────────────────────────────────────────────────

const extractSprintField = (
  nodes: FieldValueNode[],
  sprintFieldId: string,
): { sprintId: string | null; sprintTitle: string | null } => {
  const fv = nodes.find((v) => v.field?.id === sprintFieldId);
  if (!fv || !("iterationId" in fv)) return { sprintId: null, sprintTitle: null };
  const iterationId = "iterationId" in fv && typeof fv.iterationId === "string"
    ? fv.iterationId
    : null;
  return {
    sprintId: iterationId,
    sprintTitle: "title" in fv && typeof fv.title === "string" ? fv.title : null,
  };
};

const contentHasAssignee = (item: ProjectItem): boolean => {
  const content = item.content;
  if (!content) return false;
  if ("assignees" in content) {
    return (content.assignees?.nodes.length ?? 0) > 0;
  }
  return false;
};

const contentHasBlockers = (item: ProjectItem): boolean => {
  const content = item.content;
  if (!content || content.__typename !== "Issue") return false;
  return (content.blockedBy?.nodes.length ?? 0) > 0;
};

const contentTitleAndNumber = (
  item: ProjectItem,
): { title: string | null; issueNumber: number | null } => {
  const content = item.content;
  if (!content || content.__typename === "DraftIssue") {
    return {
      title: content && "title" in content ? content.title : null,
      issueNumber: null,
    };
  }
  if ("number" in content) {
    return { title: content.title, issueNumber: content.number };
  }
  return { title: null, issueNumber: null };
};

/**
 * Project a board item to {@link ItemAggregate}. Never returns null.
 */
export const buildAggregateFromRaw = (
  item: ProjectItem,
  config: GitHubBootState,
): ItemAggregate => {
  const { sprintFieldId } = config.live.fields;
  const boardFields = extractBoardFields(
    item.fieldValues.nodes,
    config,
    item.content?.__typename === "Issue" ? item.content.issueType?.name ?? null : null,
  );
  if (item.content?.__typename === "Issue" && item.content.issueFieldValues?.nodes.length) {
    overlayOrgIssueFieldValues(
      boardFields,
      item.content.issueFieldValues.nodes,
      config.ghConfig.field_mapping,
    );
  }
  const { sprintId, sprintTitle } = extractSprintField(
    item.fieldValues.nodes,
    sprintFieldId,
  );
  const { title, issueNumber } = contentTitleAndNumber(item);

  return {
    id: item.id,
    type: boardFields.type,
    status: boardFields.status,
    sprintId,
    sprintTitle,
    storyPoints: boardFields.story_points,
    hasBlockers: contentHasBlockers(item),
    hasAssignee: contentHasAssignee(item),
    issueNumber,
    isArchived: item.isArchived ?? false,
    title,
  };
};

export const aggregateToBurndownInput = (
  agg: ItemAggregate,
): BurndownStoryInput | null => {
  if (agg.issueNumber === null || agg.title === null) return null;
  return {
    number: agg.issueNumber,
    title: agg.title,
    points: agg.storyPoints ?? 0,
    status: agg.status,
  };
};

/** Sum story points in terminal statuses for one sprint iteration. */
export const sprintCompletionFromAggregates = (
  aggregates: readonly ItemAggregate[],
  iterationId: string,
  config: GitHubBootState,
): { completed: number; total: number } => {
  const statusReverseMap = new Map<string, string>();
  const statusDisplay = config.ghConfig.status_display ?? {};
  for (const [canonical, display] of Object.entries(statusDisplay)) {
    statusReverseMap.set(display, canonical);
  }

  let completed = 0;
  let total = 0;

  for (const agg of aggregates) {
    if (agg.sprintId !== iterationId) continue;
    const points = agg.storyPoints ?? 0;
    total += points;
    if (agg.status) {
      const canonicalKey = statusReverseMap.get(agg.status);
      if (canonicalKey && config.scrumConfig.scrum.status[canonicalKey]?.terminal) {
        completed += points;
      }
    }
  }

  return { completed, total };
};

// ── Burndown projection ────────────────────────────────────────────────────────

/**
 * Project a ProjectItem to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
 */
export const buildBurndownStoryInput = (
  item: ProjectItem,
  config: GitHubBootState,
): BurndownStoryInput | null => aggregateToBurndownInput(buildAggregateFromRaw(item, config));

// ── Post-mutation snapshot merge ───────────────────────────────────────────────

const sprintDisplayTitle = (
  sprintRef: SprintRef,
  config: GitHubBootState,
): string | null => {
  const iterationId = resolveSprint(sprintRef, config);
  if (!iterationId) return null;
  const iter = config.live.iterations.all.find((i) => i.id === iterationId);
  return iter?.title ?? null;
};

export const applyStorySnapshotOverrides = (
  story: Story,
  overrides?: StorySnapshotOverrides,
): Story => {
  if (!overrides) return story;

  let epic = story.epic;
  if (overrides.epic !== undefined) {
    epic = overrides.epic === null
      ? null
      : "name" in overrides.epic
      ? overrides.epic
      : { ref: overrides.epic, name: story.epic?.name ?? "" };
  }

  let blocked_by = story.blocked_by;
  if (overrides.blocked_by !== undefined) {
    blocked_by = overrides.blocked_by === null ? [] : overrides.blocked_by.map((ref) => ({
      ref: "id" in ref ? { id: ref.id } : { id: "" },
      key: "number" in ref ? String(ref.number) : "",
      title: null,
    }));
  }

  return {
    ...story,
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    ...(overrides.body !== undefined ? { body: overrides.body } : {}),
    ...(overrides.labels !== undefined ? { labels: overrides.labels } : {}),
    ...(overrides.assignees !== undefined ? { assignees: overrides.assignees } : {}),
    ...(overrides.type !== undefined ? { type: overrides.type as Story["type"] } : {}),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.sprint !== undefined ? { sprint: overrides.sprint } : {}),
    ...(overrides.story_points !== undefined ? { story_points: overrides.story_points } : {}),
    ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
    epic,
    blocked_by,
  };
};

export const storySnapshotOverridesFromSetField = (
  field: ScrumField,
  value: string | number | SprintRef | null,
  config: GitHubBootState,
): StorySnapshotOverrides => {
  switch (field) {
    case "status":
      return { status: value as string | null };
    case "sprint":
      return {
        sprint: value === null ? null : sprintDisplayTitle(value as SprintRef, config),
      };
    case "story_points": {
      if (value === null) return { story_points: null };
      const n = Number(value);
      return { story_points: Number.isFinite(n) ? n : null };
    }
    case "priority":
      return { priority: value as string | null };
    case "type":
      return { type: value as string | null };
    case "assignee":
      return { assignees: value === null ? [] : [value as string] };
    default:
      return {};
  }
};

export const storySnapshotOverridesFromStoryUpdates = (
  updates: StoryUpdates,
): StorySnapshotOverrides => ({
  ...(updates.title !== undefined ? { title: updates.title } : {}),
  ...(updates.body !== undefined ? { body: updates.body } : {}),
  ...(updates.labels !== undefined ? { labels: updates.labels } : {}),
  ...(updates.assignees !== undefined ? { assignees: updates.assignees } : {}),
  ...(updates.epic !== undefined ? { epic: updates.epic } : {}),
  ...(updates.blocked_by !== undefined ? { blocked_by: updates.blocked_by } : {}),
});

export const storySnapshotOverridesFromCreateStory = (
  input: CreateStoryInput,
  config: GitHubBootState,
): StorySnapshotOverrides => ({
  title: input.title,
  body: input.body,
  type: input.type,
  ...(input.priority !== undefined ? { priority: input.priority } : {}),
  ...(input.storyPoints !== undefined ? { story_points: input.storyPoints } : {}),
  ...(input.labels !== undefined ? { labels: input.labels } : {}),
  ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
  ...(input.epic !== undefined ? { epic: input.epic } : {}),
  ...(input.sprint !== undefined ? { sprint: sprintDisplayTitle(input.sprint, config) } : {}),
});
