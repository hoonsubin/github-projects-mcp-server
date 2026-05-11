// =============================================================================
// src/adapters/github/queries.ts — GraphQL operation loader
//
// Auto-loads all named operations from operations.graphql at module init.
// Do NOT add query strings here — edit operations.graphql instead.
//
// Each exported constant is the full document string for that operation
// (operation definition + all referenced fragment definitions), ready to
// send directly to the GitHub GraphQL API.
//
// Fails fast at startup if any expected operation name is missing from
// operations.graphql — no silent drift between the file and this module.
// =============================================================================

import { parse, print } from "graphql";
import type { DocumentNode, FragmentDefinitionNode } from "graphql";

// ── Parse operations.graphql once at module init ──────────────────────────────

const _source = Deno.readTextFileSync(
  new URL("./operations.graphql", import.meta.url),
);
const _doc: DocumentNode = parse(_source);

// Index all fragment definitions by name
const _fragments = new Map<string, FragmentDefinitionNode>();
for (const def of _doc.definitions) {
  if (def.kind === "FragmentDefinition") {
    _fragments.set(def.name.value, def);
  }
}

// Recursively collect all fragment names referenced by an AST node
function _collectFrags(node: unknown, acc: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    for (const v of node) _collectFrags(v, acc);
    return acc;
  }
  const o = node as Record<string, unknown>;
  if (
    o["kind"] === "FragmentSpread" &&
    o["name"] &&
    typeof o["name"] === "object"
  ) {
    const name = (o["name"] as { value: string }).value;
    if (!acc.has(name)) {
      acc.add(name);
      _collectFrags(_fragments.get(name), acc);
    }
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") _collectFrags(v, acc);
  }
  return acc;
}

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
export function getQuery(name: string): string {
  const q = _ops.get(name);
  if (!q) {
    throw new Error(
      `[queries] Operation "${name}" not found in operations.graphql`,
    );
  }
  return q;
}

/** All operation names available in operations.graphql. */
export const OPERATION_NAMES: ReadonlySet<string> = new Set(_ops.keys());

// ── Named constants (backward-compatible with existing imports) ───────────────

export const GET_PROJECT_ITEMS_QUERY = getQuery("GetUserProjectItems");
export const GET_ISSUE_DETAILS_QUERY = getQuery("GetIssueDetails");
export const GET_ITEM_FIELDS_QUERY = getQuery("GetItemFields");
export const GET_REPO_LABELS_QUERY = getQuery("GetRepoLabels");
