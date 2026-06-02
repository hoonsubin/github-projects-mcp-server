// =============================================================================
// src/scrum/_contract_assertions.ts
// Config-derived invariant checks for tool-surface contract tests.
// =============================================================================

import { assertEquals } from "@std/assert";
import type { ItemSearchResult, OrientResult } from "../domain/types.ts";
import type { ConfigProfile } from "./_config_profile.ts";

export const assertOrientMatchesConfig = (
  payload: OrientResult,
  profile: ConfigProfile,
): void => {
  assertEquals(payload.vocabulary.story_points.values, profile.expectedStoryPointValues);
  assertEquals(payload.vocabulary.story_points.scale, profile.expectedStoryPointScale);
  assertEquals(payload.vocabulary.sprint.velocity_window, profile.expectedVelocityWindow);
  assertEquals(payload.vocabulary.sprint.length_weeks, profile.expectedSprintLengthWeeks);
  assertEquals(payload.vocabulary.dor, profile.expectedDor);
  assertEquals(payload.vocabulary.dod, profile.expectedDod);
  assertEquals(payload.vocabulary.team, profile.expectedTeam);
  assertEquals(payload.vocabulary.autonomy, profile.expectedAutonomy);
  assertEquals(payload.platform_state.deadline_field, profile.expectedDeadlineField);
  assertEquals(payload.platform_state.template_uris, profile.expectedTemplateUris);

  if (payload.vocabulary.status) {
    for (const key of profile.statusKeys) {
      assertEquals(payload.vocabulary.status[key], profile.statusDisplay[key]);
    }
  }

  if (payload.vocabulary.priority) {
    for (const key of profile.priorityKeys) {
      assertEquals(payload.vocabulary.priority[key], profile.priorityDisplay[key]);
    }
  }

  if (payload.vocabulary.type) {
    for (const [key, display] of Object.entries(profile.typeDisplay)) {
      assertEquals(payload.vocabulary.type[key], display);
    }
  }
};

export const assertFindItemsMatchesConfig = (
  payload: ItemSearchResult,
  profile: ConfigProfile,
): void => {
  const allowedStatuses = new Set(Object.values(profile.statusDisplay));
  const allowedPriorities = new Set(Object.values(profile.priorityDisplay));

  for (const item of payload.items) {
    if (item.status !== null) {
      assertEquals(
        allowedStatuses.has(item.status),
        true,
        `status "${item.status}" must be a config display value`,
      );
    }
    if (item.priority !== null) {
      assertEquals(
        allowedPriorities.has(item.priority),
        true,
        `priority "${item.priority}" must be a config display value`,
      );
    }
  }
};
