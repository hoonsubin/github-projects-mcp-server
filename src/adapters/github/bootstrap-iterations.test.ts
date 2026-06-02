import { assertEquals } from "@std/assert";
import { classifyIterations } from "./internal/iteration-classifier.ts";
import type { IterationEntry } from "../../domain/types.ts";

const activeIterations: IterationEntry[] = [
  { id: "07155ad6", title: "Sprint 4", startDate: "2026-06-02", duration: 11 },
  { id: "771466e5", title: "Sprint 5", startDate: "2026-06-13", duration: 14 },
];
const completedIterations: IterationEntry[] = [
  { id: "ecba33e9", title: "Sprint 3", startDate: "2026-05-24", duration: 8 },
];

Deno.test("classifyIterations — UTC sprint start day is active regardless of local TZ", () => {
  const result = classifyIterations(
    activeIterations,
    completedIterations,
    new Date("2026-06-02T12:00:00+09:00"),
  );
  assertEquals(result.active?.title, "Sprint 4");
});

Deno.test("classifyIterations — gap day between sprints has no active", () => {
  const result = classifyIterations(
    activeIterations,
    completedIterations,
    new Date("2026-06-01T12:00:00Z"),
  );
  assertEquals(result.active, null);
});

Deno.test("classifyIterations — pins active sprint from capture timestamp", () => {
  const result = classifyIterations(
    activeIterations,
    completedIterations,
    new Date("2026-06-02T23:25:00Z"),
  );
  assertEquals(result.active?.title, "Sprint 4");
});
