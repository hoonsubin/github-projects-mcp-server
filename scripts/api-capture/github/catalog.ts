// =============================================================================
// Build catalog.json sample refs from bootstrap + board scan results.
// =============================================================================

import type { GitHubBootState } from "../../../src/adapters/github/bootstrap.ts";
import type { ProjectItem } from "../../../src/adapters/github/types.ts";
import type { FixtureCatalog } from "../../../src/adapters/github/internal/fixture-replay/types.ts";
import type { GitHubBackendConfig } from "../../../src/adapters/github/types.ts";

const issueKey = (item: ProjectItem): string | null => {
  const content = item.content;
  if (content && typeof content === "object" && "number" in content) {
    const num = (content as { number?: number }).number;
    return num !== undefined ? String(num) : null;
  }
  return null;
};

export const buildFixtureCatalog = (
  ghConfig: GitHubBackendConfig,
  bootState: GitHubBootState,
  fullBoardItems: ProjectItem[],
): FixtureCatalog => {
  const issueItem = fullBoardItems.find((item) => issueKey(item) !== null);
  const draftItem = fullBoardItems.find(
    (item) => item.content?.__typename === "DraftIssue",
  );

  return {
    sampleItemRef: issueItem ? { id: issueItem.id, key: issueKey(issueItem) ?? "" } : null,
    sampleDraftRef: draftItem ? { id: draftItem.id, key: issueKey(draftItem) ?? "" } : null,
    activeSprintId: bootState.live.iterations.active?.id ?? null,
    owner: ghConfig.owner,
    projectNumber: ghConfig.project_number,
    primaryRepo: ghConfig.tracked_repos[0] ?? "",
  };
};
