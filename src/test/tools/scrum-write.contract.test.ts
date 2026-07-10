// =============================================================================
// Tool-surface contract tests - scrum_* write handlers
// =============================================================================

import { assertEquals } from "@std/assert";
import {
  committedConfigProfilePromise,
  committedFakeBackendPromise,
  committedScrumConfigPromise,
  testSessionCache,
} from "../support/scrum-test-utils.ts";
import { ConfigShapedFakeBackend } from "../support/fake-backend.ts";
import {
  AddVocabularyResultSchema,
  CreateStoryPartialFailureSchema,
  CreateStoryResponseSchema,
  LogImpedimentResultSchema,
  PlanSprintResultSchema,
  SetFieldResponseSchema,
  StorySchema,
  UpdateImpedimentResponseSchema,
  UpdateStoryResponseSchema,
} from "../../schemas/scrum-outputs.ts";
import { assertHandlerSchema } from "../support/handler-assertions.ts";
import {
  handleAddVocabulary,
  handleCreateEpic,
  handleCreateStory,
  handleLogImpediment,
  handlePlanSprint,
  handleSetField,
  handleUpdateImpediment,
  handleUpdateStory,
  resolveP0PriorityDisplay,
} from "../../tools/scrum-write.ts";

Deno.test("scrum_add_vocabulary - happy path schema", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleAddVocabulary(backend, boot.scrumConfig, testSessionCache(), {
      kind: "label",
      value: "contract-test-label",
    }),
    AddVocabularyResultSchema,
    "scrum_add_vocabulary",
  );
});

Deno.test("scrum_add_vocabulary - rejects undeclared status option", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const result = await handleAddVocabulary(backend, boot.scrumConfig, testSessionCache(), {
    kind: "status_option",
    value: "On Hold",
  });

  assertEquals(result.isError, true);
  assertEquals(result.content[0]?.text.includes("VOCABULARY_NOT_DECLARED"), true);
});

Deno.test("scrum_add_vocabulary - status_option when missing on platform", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const missingStatus = profile.statusDisplay.blocked ?? "Blocked";
  const backend = ConfigShapedFakeBackend.fromBoot(boot, {
    missingStatusOptions: [missingStatus],
  });

  const payload = assertHandlerSchema(
    await handleAddVocabulary(backend, boot.scrumConfig, testSessionCache(), {
      kind: "status_option",
      value: missingStatus,
    }),
    AddVocabularyResultSchema,
    "scrum_add_vocabulary (status)",
  );
  assertEquals(payload.kind, "status_option");
});

Deno.test("scrum_set_field - happy path schema", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;
  const itemRef = { id: "PVTI_fake_1" };

  assertHandlerSchema(
    await handleSetField(backend, boot.scrumConfig, {
      ref: itemRef,
      field: "status",
      value: profile.statusDisplay.in_progress ?? "In Progress",
    }),
    SetFieldResponseSchema,
    "scrum_set_field",
  );
});

Deno.test("scrum_update_story - happy path schema", async () => {
  const config = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleUpdateStory(backend, config.scrumConfig, {
      ref: { id: "PVTI_fake_1" },
      title: "Updated contract-test title",
    }),
    UpdateStoryResponseSchema,
    "scrum_update_story",
  );
});

Deno.test("scrum_create_story - happy path schema", async () => {
  const config = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;
  const storyType = (Object.keys(profile.typeDisplay)[0] ?? "user_story") as "user_story";

  assertHandlerSchema(
    await handleCreateStory(backend, config.scrumConfig, {
      title: "Contract test story",
      body: "- [ ] AC one",
      type: storyType,
    }),
    CreateStoryResponseSchema,
    "scrum_create_story",
    StorySchema.shape,
  );
});

Deno.test("scrum_create_story - partial failure when post-create setField fails", async () => {
  const config = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = (await committedFakeBackendPromise as ConfigShapedFakeBackend)
    .withSetFieldFailureOn("sprint");
  const storyType = (Object.keys(profile.typeDisplay)[0] ?? "user_story") as "user_story";

  const payload = assertHandlerSchema(
    await handleCreateStory(backend, config.scrumConfig, {
      title: "Partial failure story",
      body: "",
      type: storyType,
      sprint: "current",
    }),
    CreateStoryResponseSchema,
    "scrum_create_story (partial)",
    StorySchema.shape,
  );

  const parsed = CreateStoryPartialFailureSchema.safeParse(payload);
  assertEquals(parsed.success, true);
  if (parsed.success) {
    assertEquals(parsed.data.failedFields.some((f) => f.field === "sprint"), true);
  }
});

Deno.test("scrum_plan_sprint - happy path schema", async () => {
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handlePlanSprint(backend, {
      sprint: "current",
      stories: [{ id: "PVTI_fake_1" }],
      replace: false,
    }),
    PlanSprintResultSchema,
    "scrum_plan_sprint",
  );
});

Deno.test("scrum_plan_sprint - replace variant clears sprint first", async () => {
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handlePlanSprint(backend, {
      sprint: "current",
      stories: [{ id: "PVTI_fake_1" }],
      replace: true,
    }),
    PlanSprintResultSchema,
    "scrum_plan_sprint (replace)",
  );
  assertEquals(Array.isArray(payload.assigned), true);
});

Deno.test("scrum_log_impediment - happy path schema", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleLogImpediment(backend, boot.scrumConfig, {
      description: "Contract test impediment",
      raised_by: "agent-tester",
    }),
    LogImpedimentResultSchema,
    "scrum_log_impediment",
  );
});

Deno.test("scrum_log_impediment - sprint affects variant", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;
  const p0 = resolveP0PriorityDisplay(boot.scrumConfig);

  const payload = assertHandlerSchema(
    await handleLogImpediment(backend, boot.scrumConfig, {
      description: "Sprint-wide blocker",
      raised_by: "agent-tester",
      priority: p0,
      affects: { sprint: "current" },
    }),
    LogImpedimentResultSchema,
    "scrum_log_impediment (sprint)",
  );
  assertEquals(payload.affects !== null, true);
});

Deno.test("scrum_update_impediment - happy path schema", async () => {
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleUpdateImpediment(backend, {
      ref: { id: "PVTI_fake_imp" },
      status: "resolved",
      resolution_notes: "Unblocked in contract test",
    }),
    UpdateImpedimentResponseSchema,
    "scrum_update_impediment",
  );
});

Deno.test("scrum_create_epic - happy path returns EpicRef", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;
  const result = await handleCreateEpic(
    backend,
    boot.scrumConfig,
    testSessionCache(),
    { name: "Integration Epic", description: "Scope of the integration epic" },
  );

  const payload = JSON.parse(result.content[0].text);
  assertEquals(typeof payload.ref.id, "string");
  assertEquals(typeof payload.ref.number, "number");
});

Deno.test("scrum_create_epic - name is required (Zod)", async () => {
  const { CreateEpicSchema } = await import("../../schemas/scrum.ts");
  let caught = false;
  try {
    CreateEpicSchema.parse({ description: "Missing name" });
  } catch (_err) {
    caught = true;
  }
  assertEquals(caught, true);
});

Deno.test("scrum_create_epic - empty name rejected (Zod)", async () => {
  const { CreateEpicSchema } = await import("../../schemas/scrum.ts");
  let caught = false;
  try {
    CreateEpicSchema.parse({ name: "" });
  } catch (_err) {
    caught = true;
  }
  assertEquals(caught, true);
});

Deno.test("scrum_create_epic - unknown fields rejected by .strict()", async () => {
  const { CreateEpicSchema } = await import("../../schemas/scrum.ts");
  let caught = false;
  try {
    CreateEpicSchema.parse({ name: "Valid", unknownField: "bad" });
  } catch (_err) {
    caught = true;
  }
  assertEquals(caught, true);
});
