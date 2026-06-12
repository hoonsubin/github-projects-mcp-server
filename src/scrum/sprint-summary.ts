// =============================================================================
// src/scrum/sprint-summary.ts - Scrum-shaped sprint metrics from raw items
// =============================================================================

import type { SprintRawItem } from "./ports.ts";

export interface SprintSummary {
  readonly total_count: number;
  readonly active_count: number;
  readonly done_count: number;
  readonly total_points: number;
  readonly done_points: number;
  readonly remaining_points: number;
  readonly blocked_count: number;
  readonly unassigned_count: number;
}

const points = (item: SprintRawItem): number => item.story_points ?? 0;

export const isTerminalSprintItem = (
  item: SprintRawItem,
  terminalStatuses: ReadonlySet<string>,
): boolean => item.status !== null && terminalStatuses.has(item.status);

export const filterSprintItems = (
  items: readonly SprintRawItem[],
  terminalStatuses: ReadonlySet<string>,
  activeOnly: boolean,
): SprintRawItem[] => {
  if (!activeOnly) return [...items];
  return items.filter((item) => !isTerminalSprintItem(item, terminalStatuses));
};

export const buildSprintSummary = (
  items: readonly SprintRawItem[],
  terminalStatuses: ReadonlySet<string>,
): SprintSummary => {
  let done_count = 0;
  let total_points = 0;
  let done_points = 0;
  let blocked_count = 0;
  let unassigned_count = 0;

  for (const item of items) {
    const pts = points(item);
    total_points += pts;
    if (item.has_blockers) blocked_count += 1;
    if (!item.has_assignee) unassigned_count += 1;
    if (isTerminalSprintItem(item, terminalStatuses)) {
      done_count += 1;
      done_points += pts;
    }
  }

  const total_count = items.length;
  const active_count = total_count - done_count;
  const remaining_points = total_points - done_points;

  return {
    total_count,
    active_count,
    done_count,
    total_points,
    done_points,
    remaining_points,
    blocked_count,
    unassigned_count,
  };
};
