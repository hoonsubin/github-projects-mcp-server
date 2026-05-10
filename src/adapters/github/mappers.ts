// =============================================================================
// src/adapters/github/mappers.ts — GitHub raw types → domain types mappers
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// These are pure functions that take GitHub raw types and return domain types.
// =============================================================================

import type { RuntimeConfig } from "./config-loader.ts";
import type { Story } from "../../types.ts";
import { classifyLabels, type StoryTypeLabel } from "../../domain/rules/labels.ts";
import type {
  BoardFields,
  Comment,
  CommentNode,
  CrossReferencedEventNode,
  FieldValueNode,
  IssueDetailsNode,
  LinkedPr,
  RawItem,
} from "./raw-types.ts";

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

/**
 * Build a Story from a raw project item node.
 * Returns null for DraftIssues (no issue number) and items without content.
 */
export const buildStoryFromRaw = (
  item: RawItem,
  config: RuntimeConfig,
): Story | null => {
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

/**
 * Build an enriched Story from a full issue node and field values.
 * Used by getStoryDetail path.
 */
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
    type: type as StoryTypeLabel | null,
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

/**
 * Build a comment list from GraphQL comment nodes.
 */
export const buildCommentList = (nodes: CommentNode[]): Comment[] =>
  nodes.map((c) => ({
    author: c.author?.login ?? "(ghost)",
    body: c.body,
    created_at: c.createdAt,
    url: c.url,
  }));

/**
 * Build a linked PR list from cross-referenced event nodes.
 */
export const buildLinkedPrList = (nodes: CrossReferencedEventNode[]): LinkedPr[] =>
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

/** Lightweight burndown story projection from a RawItem. */
export interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
}

/**
 * Project a RawItem to the four fields burndown computation needs.
 * Returns null for DraftIssues and items with no issue content.
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
