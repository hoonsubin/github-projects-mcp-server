# Phase 7 Backlog Redesign Migration Guide

## Breaking Change: Return Shape

The `scrum_get_backlog` tool now returns a structured object instead of a plain array:

### Before (Phase 6 and earlier):

```json
{
  "content": [
    {
      "type": "text",
      "text": "[{\"ref\": {...}, \"title\": \"...\", ...}]"
    }
  ]
}
```

### After (Phase 7+):

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"stories\": [{\"ref\": {...}, \"title\": \"...\", ...}], \"total_count\": 10, \"readiness\": {...}, \"orphan_impediments\": []}"
    }
  ]
}
```

## Key Changes

1. **Return Shape:** Now returns `{ stories, total_count, readiness, orphan_impediments }` instead of just `stories[]`
2. **Story Listing:** Each story is now a `StoryListing` (lightweight) instead of full `Story` object
3. **Active-Item Filter:** Done stories with no sprint are automatically excluded
4. **Orphan Impediments:** New field for impediments without story/sprint context

## Migration Steps

1. Update code that consumes `scrum_get_backlog` results to handle the new shape
2. Access stories via `result.content[0].text.stories` (same path, different structure)
3. Handle `orphan_impediments` field if needed for your workflow
4. Note: `StoryListing` does not include `body`, `type`, `assignees`, `labels`, `epic`, `created_at`, or `updated_at` fields

## StoryListing vs Story Field Comparison

| Field          | Story (old) | StoryListing (new) | Notes                          |
| -------------- | ----------- | ------------------ | ------------------------------ |
| `ref.id`       | Yes         | Yes                | Opaque project-item handle     |
| `ref.key`      | Yes         | Yes                | Human-readable issue number    |
| `title`        | Yes         | Yes                | Story title                    |
| `status`       | Yes         | Yes                | Team vocabulary status value   |
| `story_points` | Yes         | Yes                | Effort estimate                |
| `priority`     | Yes         | Yes                | Team vocabulary priority value |
| `sprint`       | Yes         | Yes                | Sprint name or null            |
| `writable`     | No          | Yes                | true for active items          |
| `body`         | Yes         | **No**             | Full content - use `get-story` |
| `type`         | Yes         | **No**             | feature/bug/tech_debt/spike    |
| `assignees`    | Yes         | **No**             | GitHub logins                  |
| `labels`       | Yes         | **No**             | Label array                    |
| `epic`         | Yes         | **No**             | Milestone title                |
| `created_at`   | Yes         | **No**             | ISO-8601 timestamp             |
| `updated_at`   | Yes         | **No**             | ISO-8601 timestamp             |
| `url`          | Yes         | **No**             | Canonical URL                  |

## Active-Item Filter Behavior

The active-item filter excludes stories where:

- `status` is "done" (case-insensitive match)
- AND `sprint` is `null` (no sprint assigned)

Stories that are Done inside an active sprint remain visible.

### Examples

| Status      | Sprint     | Visible? | Reason                          |
| ----------- | ---------- | -------- | ------------------------------- |
| Done        | null       | No       | Done + no sprint = stale        |
| Done        | "Sprint 1" | Yes      | Done in active sprint = visible |
| In Progress | null       | Yes      | Active work = visible           |
| Todo        | null       | Yes      | Not done = visible              |

## Orphan Impediments

The `orphan_impediments` field contains unresolved impediments that have no cross-reference to a story or sprint. These are impediments logged at the project level without a specific story context.

- Only `open` and `in_progress` status impediments are returned
- `resolved` impediments are excluded

## Backward Compatibility

This is a **breaking change**. Code that directly accesses the returned array will need to be updated to access `result.content[0].text.stories` instead.
