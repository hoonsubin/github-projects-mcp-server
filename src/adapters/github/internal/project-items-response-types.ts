// =============================================================================
// project-items-response-types.ts - GraphQL response shapes for projectV2.items
//
// Leaf module: no imports from query builders, owner helpers, or execution.
// =============================================================================

import type { PageInfoRef, ProjectItem, ProjectV2Ref } from "../types.ts";

export interface ProjectV2ItemsPage extends ProjectV2Ref {
  items: {
    totalCount: number;
    pageInfo: PageInfoRef;
    nodes: ProjectItem[];
  };
}

/** User or organization root wrapping a projectV2 items page. */
export interface ProjectItemsResponse {
  user?: { projectV2: ProjectV2ItemsPage | null } | null;
  organization?: { projectV2: ProjectV2ItemsPage | null } | null;
}
