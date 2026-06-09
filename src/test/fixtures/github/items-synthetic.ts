// =============================================================================
// src/adapters/github/fixtures/items-synthetic.ts
//
// Synthetic fixture items and convenience aggregates.
// =============================================================================

import type { ProjectItem } from "../../../adapters/github/types.ts";
import { FIXTURE_ITEM_192, FIXTURE_ITEM_222, FIXTURE_ITEM_WITH_CUSTOM_FIELDS } from "./items.ts";

/**
 * Synthetic fixture: a Done-status item in Sprint 4 - needed for terminal-exclusion
 * filter tests in item-filter.test.ts. Uses real field IDs from captured fixtures
 * so buildStoryFromRaw resolves status/sprint correctly.
 */
export const FIXTURE_ITEM_DONE = {
  id: "PVTI_lAHOAmfLjc4BWiTtzguDONE",
  type: "ISSUE",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-10T00:00:00Z",
  isArchived: false,
  content: {
    __typename: "Issue",
    id: "I_kwDOSJo3Ms8AAAABD000000",
    number: 999,
    title: "Done Story",
    url: "https://github.com/hoonsubin/github-projects-mcp-server/issues/999",
    state: "CLOSED",
    body: "A completed story for terminal-exclusion filter tests.",
    issueType: null,
    assignees: { nodes: [] },
    labels: { nodes: [{ name: "bug", color: "e1012b" }] },
    milestone: null,
    repository: {
      name: "github-projects-mcp-server",
      nameWithOwner: "hoonsubin/github-projects-mcp-server",
    },
    blockedBy: { nodes: [] },
  },
  fieldValues: {
    nodes: [
      {
        __typename: "ProjectV2ItemFieldRepositoryValue",
        repository: {
          name: "github-projects-mcp-server",
          nameWithOwner: "hoonsubin/github-projects-mcp-server",
        },
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1seo", name: "Repository" },
      },
      {
        __typename: "ProjectV2ItemFieldLabelValue",
        labels: { nodes: [{ name: "bug", color: "e1012b" }] },
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1sec", name: "Labels" },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text: "Done Story",
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1seQ", name: "Title" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Bug",
        color: "RED",
        optionId: "bug_id",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhS9YWs", name: "Type" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Must",
        color: "RED",
        optionId: "457ca5cd",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1soA", name: "Priority" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Done",
        color: "GREEN",
        optionId: "done_id",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY", name: "Status" },
      },
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        number: 5,
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1soI", name: "Story Points" },
      },
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        title: "Sprint 4",
        startDate: "2026-06-02",
        duration: 11,
        iterationId: "07155ad6",
        field: { id: "PVTIF_lAHOAmfLjc4BWiTtzhR1soM", name: "Sprint" },
      },
    ],
  },
} as unknown as ProjectItem;

/** All four nodes as an array - for tests that need diverse items. */
export const FIXTURE_NODES: readonly ProjectItem[] = [
  FIXTURE_ITEM_222,
  FIXTURE_ITEM_192,
  FIXTURE_ITEM_WITH_CUSTOM_FIELDS,
  FIXTURE_ITEM_DONE,
];
