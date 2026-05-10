// =============================================================================
// src/adapters/github/queries.ts — GitHub GraphQL query strings
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// These are pure declarations — no logic. All GraphQL query strings
// are confined to the adapter layer.
// =============================================================================

/** Fetch project items with pagination cursor. */
export const GET_PROJECT_ITEMS_QUERY = `
  query GetProjectItems($login: String!, $number: Int!, $after: String) {
    user(login: $login) {
      projectV2(number: $number) {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue {
                id
                number
                title
                body
                url
                createdAt
                updatedAt
                assignees(first: 10) { nodes { login } }
                labels(first: 20) { nodes { name } }
                milestone { title }
              }
              ... on DraftIssue { id title body }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { id } }
                  name
                  optionId
                }
                ... on ProjectV2ItemFieldNumberValue {
                  field { ... on ProjectV2Field { id } }
                  number
                }
                ... on ProjectV2ItemFieldIterationValue {
                  field { ... on ProjectV2IterationField { id } }
                  title
                  iterationId
                  startDate
                  duration
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Fetch issue details including comments and linked PRs. */
export const GET_ISSUE_DETAILS_QUERY = `
  query GetIssueDetails($issueId: ID!) {
    node(id: $issueId) {
      ... on Issue {
        id
        number
        title
        body
        url
        createdAt
        updatedAt
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        milestone { title }
        comments(first: 50) {
          nodes {
            id
            author { login }
            body
            createdAt
            url
          }
        }
        timelineItems(first: 25, itemTypes: [CROSS_REFERENCED_EVENT]) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest {
                  number
                  title
                  url
                  state
                  isDraft
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Fetch field values for a single project item. */
export const GET_ITEM_FIELDS_QUERY = `
  query GetItemFields($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        fieldValues(first: 20) {
          nodes {
            ... on ProjectV2ItemFieldSingleSelectValue {
              field { ... on ProjectV2SingleSelectField { id } }
              name
              optionId
            }
            ... on ProjectV2ItemFieldNumberValue {
              field { ... on ProjectV2Field { id } }
              number
            }
            ... on ProjectV2ItemFieldIterationValue {
              field { ... on ProjectV2IterationField { id } }
              title
              iterationId
            }
          }
        }
      }
    }
  }
`;

/** Fetch repository labels. */
export const GET_REPO_LABELS_QUERY = `
  query GetRepoLabels($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      labels(first: 50) {
        nodes { id name color description }
      }
    }
  }
`;
