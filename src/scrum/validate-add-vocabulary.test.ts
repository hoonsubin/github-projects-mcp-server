// =============================================================================
// src/scrum/validate-add-vocabulary.test.ts
// =============================================================================

import { assertEquals, assertThrows } from "@std/assert";
import { ConfigError } from "../domain/errors.ts";
import type { ScrumConfig } from "../domain/config.ts";
import { assertAddVocabularyAllowed } from "./validate-add-vocabulary.ts";

const scrumConfig = {
  scrum: {
    status: {
      backlog: { terminal: false, blocking: false },
      done: { terminal: true, blocking: false },
    },
    priority: [{ key: "p0" }, { key: "p1" }],
  },
  backends: {
    github: {
      status_display: {
        backlog: "Backlog",
        done: "Done",
      },
      priority_display: {
        p0: "Must",
        p1: "Should",
      },
    },
  },
} as unknown as ScrumConfig;

Deno.test("assertAddVocabularyAllowed - allows labels without config check", () => {
  assertAddVocabularyAllowed(scrumConfig, "label", "any-dynamic-label", [], []);
});

Deno.test("assertAddVocabularyAllowed - rejects undeclared status option", () => {
  const err = assertThrows(
    () => assertAddVocabularyAllowed(scrumConfig, "status_option", "On Hold", ["Backlog"], []),
    ConfigError,
  );
  assertEquals(err.code, "VOCABULARY_NOT_DECLARED");
});

Deno.test("assertAddVocabularyAllowed - rejects declared status not in missing_options", () => {
  const err = assertThrows(
    () => assertAddVocabularyAllowed(scrumConfig, "status_option", "Done", [], []),
    ConfigError,
  );
  assertEquals(err.code, "VOCABULARY_NOT_MISSING");
});

Deno.test("assertAddVocabularyAllowed - allows declared status in missing_options", () => {
  assertAddVocabularyAllowed(scrumConfig, "status_option", "Backlog", ["Backlog"], []);
});

Deno.test("assertAddVocabularyAllowed - rejects undeclared priority option", () => {
  const err = assertThrows(
    () => assertAddVocabularyAllowed(scrumConfig, "priority_option", "Urgent", [], ["Must"]),
    ConfigError,
  );
  assertEquals(err.code, "VOCABULARY_NOT_DECLARED");
});

Deno.test("assertAddVocabularyAllowed - allows declared priority in missing_options", () => {
  assertAddVocabularyAllowed(scrumConfig, "priority_option", "Must", [], ["Must"]);
});
