// =============================================================================
// bootstrap-field-sources.ts — Pure helpers for merging project vs org issue field
// option catalogs during org bootstrap. Extracted for unit testing.
// =============================================================================

import type { GitHubBackendConfig } from "./types.ts";
import type { SelectFieldNode } from "./types.ts";

/** Query projection of GH.ProjectV2SingleSelectField - all mandatory fields. */
export interface SingleSelectFieldNode extends SelectFieldNode {}

export interface BaseFieldNode {
  id: string;
  name: string;
  dataType: string;
}

export type BootstrapFieldNode = BaseFieldNode | SingleSelectFieldNode;

export interface OrgIssueFieldOption {
  id: string;
  name: string;
  color?: string;
}

export interface OrgIssueFieldNode {
  id: string;
  name: string;
  options?: OrgIssueFieldOption[];
}

export const isSingleSelectField = (node: BootstrapFieldNode): node is SingleSelectFieldNode =>
  "options" in node && Array.isArray((node as SingleSelectFieldNode).options);

/**
 * Option name → option id for a single-select field.
 * Prefers non-empty project board options; falls back to org issue field options.
 */
export const singleSelectOptionMapForField = (
  fieldName: string,
  projectFieldNodes: BootstrapFieldNode[],
  orgIssueFieldNodes: OrgIssueFieldNode[],
): Map<string, string> => {
  const projectNode = projectFieldNodes.find((n) => n.name === fieldName);
  if (projectNode && isSingleSelectField(projectNode) && projectNode.options.length > 0) {
    return new Map(projectNode.options.map((o) => [o.name, o.id]));
  }
  const orgNode = orgIssueFieldNodes.find((n) => n.name === fieldName);
  if (orgNode?.options && orgNode.options.length > 0) {
    return new Map(orgNode.options.map((o) => [o.name, o.id]));
  }
  if (projectNode && isSingleSelectField(projectNode)) {
    return new Map(projectNode.options.map((o) => [o.name, o.id]));
  }
  return new Map();
};

/**
 * True when a configured single-select field has no options on the project board
 * and none on the org issue-field catalog (or the catalog is unavailable).
 */
export const isCanonicalSingleSelectUnavailable = (
  fieldName: string | undefined,
  projectFieldNodes: BootstrapFieldNode[],
  orgIssueFieldNodes: OrgIssueFieldNode[],
  issueFieldsCatalogAvailable: boolean,
): boolean => {
  if (!fieldName) return false;

  const projectNode = projectFieldNodes.find((n) => n.name === fieldName);
  if (projectNode && !isSingleSelectField(projectNode)) {
    return false;
  }
  const projectHasOptions = !!(
    projectNode &&
    isSingleSelectField(projectNode) &&
    projectNode.options.length > 0
  );
  if (projectHasOptions) return false;

  if (!issueFieldsCatalogAvailable) return true;

  const orgNode = orgIssueFieldNodes.find((n) => n.name === fieldName);
  const orgHasOptions = !!(orgNode?.options && orgNode.options.length > 0);
  return !orgHasOptions;
};

export interface ResolvedOptionMaps {
  statusOptions: Record<string, string>;
  priorityOptions: Record<string, string>;
  typeOptions: Record<string, string>;
}

/** Build vocabulary option maps, merging project and org issue-field sources. */
export const buildOptionMaps = (
  fieldNodes: BootstrapFieldNode[],
  ghConfig: GitHubBackendConfig,
  orgIssueFieldNodes: OrgIssueFieldNode[] = [],
): ResolvedOptionMaps => {
  const statusOptions: Record<string, string> = {};
  const priorityOptions: Record<string, string> = {};
  const typeOptions: Record<string, string> = {};
  const { field_mapping, status_display, priority_display, type_mapping } = ghConfig;

  if (field_mapping.status) {
    const map = singleSelectOptionMapForField(
      field_mapping.status,
      fieldNodes,
      orgIssueFieldNodes,
    );
    for (const displayName of Object.values(status_display)) {
      const id = map.get(displayName);
      if (id) statusOptions[displayName] = id;
    }
  }
  if (field_mapping.priority) {
    const map = singleSelectOptionMapForField(
      field_mapping.priority,
      fieldNodes,
      orgIssueFieldNodes,
    );
    for (const displayName of Object.values(priority_display)) {
      const id = map.get(displayName);
      if (id) priorityOptions[displayName] = id;
    }
  }
  if (field_mapping.item_type && type_mapping) {
    const map = singleSelectOptionMapForField(
      field_mapping.item_type,
      fieldNodes,
      orgIssueFieldNodes,
    );
    for (const [canonicalKey, entry] of Object.entries(type_mapping)) {
      const id = map.get(entry.display);
      if (id) typeOptions[canonicalKey] = id;
    }
  }

  return { statusOptions, priorityOptions, typeOptions };
};
