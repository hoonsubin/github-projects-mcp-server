// =============================================================================
// src/adapters/github/queries.ts - GraphQL operation loader
//
// Auto-loads all named operations from operations.graphql at module init.
// Do NOT add query strings here - edit operations.graphql instead.
//
// Each exported constant is the full document string for that operation
// (operation definition + all referenced fragment definitions), ready to
// send directly to the GitHub GraphQL API.
//
// Fails fast at startup if any expected operation name is missing from
// operations.graphql - no silent drift between the file and this module.
// =============================================================================

import { parse, print } from "graphql";
import type { DocumentNode, FragmentDefinitionNode } from "graphql";

// ── Parse operations.graphql once at module init ──────────────────────────────
//
// Using import with { type: "text" } bundles the .graphql file content at
// compile time (deno compile) so the compiled binary never needs to read
// it from the filesystem at runtime. This also works correctly with
// deno run - the import assertion is resolved at load time.

import _graphqlSource from "./operations.graphql" with { type: "text" };

const _source: string = _graphqlSource;
const _doc: DocumentNode = parse(_source);

// Index all fragment definitions by name
const _fragments = new Map<string, FragmentDefinitionNode>();
for (const def of _doc.definitions) {
  if (def.kind === "FragmentDefinition") {
    _fragments.set(def.name.value, def);
  }
}

// Recursively collect all fragment names referenced by an AST node.
// Uses WeakSet to track visited AST nodes and avoid infinite recursion
// from circular parent/prev/next pointers in the GraphQL AST.
const _collectFrags = (
  node: unknown,
  acc: Set<string> = new Set(),
  seen: WeakSet<object> = new WeakSet(),
): Set<string> => {
  if (!node || typeof node !== "object") return acc;

  if (Array.isArray(node)) {
    for (const v of node) _collectFrags(v, acc, seen);
    return acc;
  }

  const obj = node as object;
  // Prevent revisiting the same object (handles circular references)
  if (seen.has(obj)) return acc;
  seen.add(obj);

  const o = obj as Record<string, unknown>;
  if (
    o["kind"] === "FragmentSpread" &&
    o["name"] &&
    typeof o["name"] === "object"
  ) {
    const name = (o["name"] as { value: string }).value;
    if (!acc.has(name)) {
      acc.add(name);
      const frag = _fragments.get(name);
      if (frag) _collectFrags(frag, acc, seen);
    }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") _collectFrags(v, acc, seen);
  }
  return acc;
};

// Build map: operation name → full document string (op + referenced fragments)
const _ops = new Map<string, string>();
for (const def of _doc.definitions) {
  if (def.kind === "OperationDefinition" && def.name) {
    const parts: string[] = [print(def)];
    for (const fragName of _collectFrags(def)) {
      const frag = _fragments.get(fragName);
      if (frag) parts.push(print(frag));
    }
    _ops.set(def.name.value, parts.join("\n\n"));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the full GraphQL document string for a named operation.
 * Includes all fragment definitions the operation references.
 * Throws immediately (at startup) if the name is not in operations.graphql.
 */
const getQuery = (name: string): string => {
  const q = _ops.get(name);
  if (!q) {
    throw new Error(
      `[queries] Operation "${name}" not found in operations.graphql`,
    );
  }
  return q;
};

// ── Named constants ───────────────────────────────────────────────────────────
// Each call to getQuery() validates that the operation exists in operations.graphql
// at startup - throwing immediately if any expected name is absent.

getQuery("GetUserProjectItems"); // startup validation only; not imported elsewhere
export const GET_ISSUE_DETAILS_QUERY = getQuery("GetIssueDetails");
export const GET_ITEM_FIELDS_QUERY = getQuery("GetItemFields");
export const GET_DRAFT_ISSUE_DETAILS_QUERY = getQuery("GetDraftIssueDetails");
export const GET_REPO_LABELS_QUERY = getQuery("GetRepoLabels");
export const GET_IMPEDIMENT_ISSUES_QUERY = getQuery("GetImpedimentIssues");
export const LIST_MILESTONES_QUERY = getQuery("ListMilestones");
export const GET_USER_NODE_ID = getQuery("GetUserNodeId");
export const ADD_PROJECT_ITEM_MUTATION = getQuery("AddProjectItem");
export const CLEAR_ITEM_FIELD_MUTATION = getQuery("ClearItemField");
export const UPDATE_ITEM_FIELD_MUTATION = getQuery("UpdateItemField");

// ── Item lookups (internal services) ──────────────────────────────────────────
export const GET_PROJECT_ITEM_BY_ID_QUERY = getQuery("GetProjectItemById");
export const GET_ISSUE_BY_ID_QUERY = getQuery("GetIssueById");
export const GET_BLOCKED_BY_QUERY = getQuery("GetBlockedBy");

// ── Repository and user lookups ────────────────────────────────────────────────
export const GET_REPO_QUERY = getQuery("GetRepo");
export const GET_USER_MILESTONES_QUERY = getQuery("GetUserMilestones");

// ── Field management queries ───────────────────────────────────────────────────
export const GET_FIELD_OPTIONS_QUERY = getQuery("GetFieldOptions");

// ── Bootstrap queries (config-loader) ──────────────────────────────────────────
export const GET_USER_PROJECT_FIELDS_BOOTSTRAP_QUERY = getQuery("GetUserProjectFieldsBootstrap");
export const GET_ORG_PROJECT_FIELDS_BOOTSTRAP_QUERY = getQuery("GetOrgProjectFieldsBootstrap");

// ── Label mutations ────────────────────────────────────────────────────────────
export const CREATE_LABEL_MUTATION = getQuery("CreateLabel");
export const REPLACE_ISSUE_LABELS_MUTATION = getQuery("ReplaceIssueLabels");
export const SET_LABELS_MUTATION = getQuery("SetLabels");

// ── Issue mutations ────────────────────────────────────────────────────────────
export const CREATE_ISSUE_MUTATION = getQuery("CreateIssue");
export const CLOSE_ISSUE_MUTATION = getQuery("CloseIssue");
export const CLEAR_ASSIGNEES_MUTATION = getQuery("ClearAssignees");
export const SET_ASSIGNEE_MUTATION = getQuery("SetAssignee");
export const SET_MILESTONE_MUTATION = getQuery("SetMilestone");

// ── Comment mutations ──────────────────────────────────────────────────────────
export const ADD_COMMENT_MUTATION = getQuery("AddComment");

// ── Milestone mutations ────────────────────────────────────────────────────────
export const CREATE_MILESTONE_MUTATION = getQuery("CreateMilestone");

// ── Field management mutations ─────────────────────────────────────────────────
export const UPDATE_FIELD_MUTATION = getQuery("UpdateField");
export const CONVERT_DRAFT_ISSUE_MUTATION = getQuery("ConvertDraftIssue");
export const ADD_DRAFT_ISSUE_MUTATION = getQuery("AddDraftIssue");
