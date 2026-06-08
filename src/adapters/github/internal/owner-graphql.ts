// =============================================================================
// owner-graphql.ts - Shared helpers for user vs organization GraphQL roots
// =============================================================================

import type { OwnerType } from "../types.ts";
import type { ProjectItemsResponse, ProjectV2ItemsPage } from "./project-items-response-types.ts";

/** GraphQL root field name for an owner type. */
export type OwnerRootField = "user" | "organization";

export const ownerRootField = (ownerType: OwnerType): OwnerRootField =>
  ownerType === "user" ? "user" : "organization";

/** Response shape with optional user/organization projectV2 branches. */
export type OwnerProjectV2Response = ProjectItemsResponse;

/** Bootstrap field metadata response (projectV2 with fields only). */
export interface OwnerProjectFieldsBootstrapResponse {
  user?: { projectV2?: { id: string; fields: { nodes: unknown[] } } | null } | null;
  organization?: {
    projectV2?: { id: string; fields: { nodes: unknown[] } } | null;
    issueFields?: { nodes: unknown[] };
    issueTypes?: { nodes: unknown[] };
  } | null;
}

export const projectV2FromOwnerResponse = <T>(
  response: OwnerProjectV2Response,
  ownerType: OwnerType,
): T | null | undefined => {
  const branch = ownerType === "user" ? response.user : response.organization;
  return branch?.projectV2 as T | null | undefined;
};

export const projectV2FieldsFromBootstrap = (
  response: OwnerProjectFieldsBootstrapResponse,
  ownerType: OwnerType,
): { id: string; fields: { nodes: unknown[] } } | null | undefined => {
  if (ownerType === "user") {
    return response.user?.projectV2 ?? undefined;
  }
  return response.organization?.projectV2 ?? undefined;
};

export type { ProjectV2ItemsPage };
