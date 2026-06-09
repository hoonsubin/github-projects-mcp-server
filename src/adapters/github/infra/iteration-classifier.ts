// =============================================================================
// Sprint iteration active/next classification (pure, no GraphQL deps).
// =============================================================================

import type { IterationEntry } from "../../../domain/types.ts";

export interface ClassifiedIterations {
  active: IterationEntry | null;
  next: IterationEntry | null;
  completed: IterationEntry[];
  all: IterationEntry[];
}

/** Parse YYYY-MM-DD iteration dates in UTC (matches GitHub Projects + orient use-case). */
export const utcDateOnly = (dateStr: string): Date => new Date(`${dateStr}T00:00:00Z`);

export const utcStartOfDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const classifyIterations = (
  activeIterations: IterationEntry[],
  completedIterations: IterationEntry[],
  asOf: Date = utcStartOfDay(new Date()),
): ClassifiedIterations => {
  const today = utcStartOfDay(asOf);

  let active: IterationEntry | null = null;
  for (const iter of activeIterations) {
    const start = utcDateOnly(iter.startDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + iter.duration);
    if (today >= start && today < end) {
      active = iter;
      break;
    }
  }

  const cutoff: Date = (() => {
    if (active) {
      const d = utcDateOnly(active.startDate);
      d.setUTCDate(d.getUTCDate() + active.duration);
      return d;
    }
    return today;
  })();
  const allSorted = [...activeIterations].sort(
    (a, b) => utcDateOnly(a.startDate).getTime() - utcDateOnly(b.startDate).getTime(),
  );
  const next = allSorted.find((iter) => utcDateOnly(iter.startDate) >= cutoff) ?? null;

  const allMap = new Map<string, IterationEntry>();
  for (const iter of activeIterations) allMap.set(iter.id, iter);
  for (const iter of completedIterations) allMap.set(iter.id, iter);
  const all = [...allMap.values()].sort(
    (a, b) => utcDateOnly(a.startDate).getTime() - utcDateOnly(b.startDate).getTime(),
  );

  return {
    active,
    next,
    completed: [...completedIterations],
    all,
  };
};
