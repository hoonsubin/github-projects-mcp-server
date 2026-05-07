// =============================================================================
// src/services/config_test.ts
//
// Unit tests for loadConfig and classifyIterations helpers.
// =============================================================================

import { assertEquals } from "@std/assert";
import { classifyIterations } from "./config.ts";
import type { IterationEntry } from "../types.ts";

// ── classifyIterations tests ─────────────────────────────────────────────────

Deno.test("classifyIterations — active sprint detected by today", () => {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 3); // started 3 days ago

  const activeIterations: IterationEntry[] = [
    {
      id: "sprint-1",
      title: "Sprint 1",
      startDate: startDate.toISOString(),
      duration: 14,
    },
  ];
  const completedIterations: IterationEntry[] = [];

  const result = classifyIterations(activeIterations, completedIterations);

  assertEquals(result.active?.id, "sprint-1");
  assertEquals(result.active?.title, "Sprint 1");
  assertEquals(result.next, null);
  assertEquals(result.completed.length, 0);
  assertEquals(result.all.length, 1);
});

Deno.test("classifyIterations — next sprint detected when no active", () => {
  const today = new Date();
  // sprint-1: starts today, duration 14 → ends today + 14
  // sprint-2: starts today + 20 → after sprint-1 ends
  const nextStart = new Date(today);
  nextStart.setDate(nextStart.getDate() + 20);

  const activeIterations: IterationEntry[] = [
    {
      id: "sprint-1",
      title: "Sprint 1",
      startDate: new Date(today).toISOString(),
      duration: 14,
    },
    {
      id: "sprint-2",
      title: "Sprint 2",
      startDate: nextStart.toISOString(),
      duration: 14,
    },
  ];
  const completedIterations: IterationEntry[] = [];

  const result = classifyIterations(activeIterations, completedIterations);

  assertEquals(result.active?.id, "sprint-1");
  assertEquals(result.next?.id, "sprint-2");
});

Deno.test("classifyIterations — completed iterations marked", () => {
  const pastStart = new Date();
  pastStart.setDate(pastStart.getDate() - 30);

  const activeIterations: IterationEntry[] = [];
  const completedIterations: IterationEntry[] = [
    {
      id: "sprint-past",
      title: "Sprint Past",
      startDate: pastStart.toISOString(),
      duration: 14,
    },
  ];

  const result = classifyIterations(activeIterations, completedIterations);

  assertEquals(result.active, null);
  assertEquals(result.next, null);
  assertEquals(result.completed.length, 1);
  assertEquals(result.completed[0].id, "sprint-past");
  assertEquals(result.all.length, 1);
});

Deno.test("classifyIterations — deduplication when overlap between active and completed", () => {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 3);

  // Same iteration appears in both lists (edge case)
  const activeIterations: IterationEntry[] = [
    {
      id: "sprint-1",
      title: "Sprint 1",
      startDate: startDate.toISOString(),
      duration: 14,
    },
  ];
  const completedIterations: IterationEntry[] = [
    {
      id: "sprint-1",
      title: "Sprint 1",
      startDate: startDate.toISOString(),
      duration: 14,
    },
  ];

  const result = classifyIterations(activeIterations, completedIterations);

  // Should not duplicate
  assertEquals(result.all.length, 1);
});

Deno.test("classifyIterations — all list sorted by startDate", () => {
  const today = new Date();
  const pastStart = new Date(today);
  pastStart.setDate(pastStart.getDate() - 30);
  const futureStart = new Date(today);
  futureStart.setDate(futureStart.getDate() + 10);

  const activeIterations: IterationEntry[] = [
    {
      id: "sprint-future",
      title: "Sprint Future",
      startDate: futureStart.toISOString(),
      duration: 14,
    },
  ];
  const completedIterations: IterationEntry[] = [
    {
      id: "sprint-past",
      title: "Sprint Past",
      startDate: pastStart.toISOString(),
      duration: 14,
    },
  ];

  const result = classifyIterations(activeIterations, completedIterations);

  assertEquals(result.all[0].id, "sprint-past");
  assertEquals(result.all[1].id, "sprint-future");
});
