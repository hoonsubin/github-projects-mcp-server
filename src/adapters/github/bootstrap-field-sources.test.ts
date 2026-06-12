import { assertEquals } from "@std/assert";
import {
  type BootstrapFieldNode,
  buildOptionMaps,
  isCanonicalSingleSelectUnavailable,
  type OrgIssueFieldNode,
  singleSelectOptionMapForField,
} from "./bootstrap-field-sources.ts";

const projectFields: BootstrapFieldNode[] = [
  {
    id: "PVTSSF_status",
    name: "Status",
    dataType: "SINGLE_SELECT",
    options: [{ id: "opt_done", name: "Done", color: "GREEN", description: "" }],
  },
  {
    id: "PVTSSF_priority",
    name: "Priority",
    dataType: "SINGLE_SELECT",
    options: [],
  },
];

const orgIssueFields: OrgIssueFieldNode[] = [
  {
    id: "IF_priority",
    name: "Priority",
    options: [{ id: "IFSO_must", name: "Must", color: "RED" }],
  },
];

const ghConfig = {
  field_mapping: { sprint: "Sprint", status: "Status", priority: "Priority" },
  status_display: { done: "Done" },
  priority_display: { must: "Must" },
  type_mapping: {},
} as unknown as Parameters<typeof buildOptionMaps>[1];

Deno.test("singleSelectOptionMapForField - prefers non-empty project options", () => {
  const map = singleSelectOptionMapForField("Status", projectFields, orgIssueFields);
  assertEquals(map.get("Done"), "opt_done");
});

Deno.test("singleSelectOptionMapForField - falls back to org issue field when project empty", () => {
  const map = singleSelectOptionMapForField("Priority", projectFields, orgIssueFields);
  assertEquals(map.get("Must"), "IFSO_must");
});

Deno.test("buildOptionMaps - merges priority options from org when project options empty", () => {
  const maps = buildOptionMaps(projectFields, ghConfig, orgIssueFields);
  assertEquals(maps.priorityOptions, { Must: "IFSO_must" });
  assertEquals(maps.statusOptions, { Done: "opt_done" });
});

Deno.test("buildOptionMaps - includes board options beyond config vocabulary", () => {
  const fields: BootstrapFieldNode[] = [
    {
      id: "PVTSSF_status",
      name: "Status",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "opt_done", name: "Done", color: "GREEN", description: "" },
        { id: "opt_hold", name: "On Hold", color: "GRAY", description: "" },
      ],
    },
  ];
  const maps = buildOptionMaps(fields, ghConfig, []);
  assertEquals(maps.statusOptions, { Done: "opt_done", "On Hold": "opt_hold" });
});

Deno.test("isCanonicalSingleSelectUnavailable - false when project has options", () => {
  assertEquals(
    isCanonicalSingleSelectUnavailable("Status", projectFields, [], false),
    false,
  );
});

Deno.test("isCanonicalSingleSelectUnavailable - false when org catalog has options", () => {
  assertEquals(
    isCanonicalSingleSelectUnavailable("Priority", projectFields, orgIssueFields, true),
    false,
  );
});

Deno.test("isCanonicalSingleSelectUnavailable - true when both catalogs empty", () => {
  assertEquals(
    isCanonicalSingleSelectUnavailable("Priority", projectFields, [], true),
    true,
  );
  assertEquals(
    isCanonicalSingleSelectUnavailable("Priority", projectFields, [], false),
    true,
  );
});
