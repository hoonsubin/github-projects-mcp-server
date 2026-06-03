import { assertEquals } from "@std/assert";
import {
  ownerRootField,
  projectV2FromOwnerResponse,
  projectV2FieldsFromBootstrap,
} from "./owner-graphql.ts";

Deno.test("ownerRootField - maps user and org", () => {
  assertEquals(ownerRootField("user"), "user");
  assertEquals(ownerRootField("org"), "organization");
});

Deno.test("projectV2FromOwnerResponse - selects correct branch", () => {
  const page = {
    id: "PVT_1",
    items: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };
  const userProject = projectV2FromOwnerResponse<{ id: string }>(
    { user: { projectV2: page } },
    "user",
  );
  const orgProject = projectV2FromOwnerResponse<{ id: string }>(
    { organization: { projectV2: page } },
    "org",
  );
  assertEquals(userProject?.id, "PVT_1");
  assertEquals(orgProject?.id, "PVT_1");
});

Deno.test("projectV2FieldsFromBootstrap - selects bootstrap project node", () => {
  const node = { id: "PVT_1", fields: { nodes: [{ id: "f1" }] } };
  assertEquals(projectV2FieldsFromBootstrap({ user: { projectV2: node } }, "user")?.id, "PVT_1");
  assertEquals(
    projectV2FieldsFromBootstrap({ organization: { projectV2: node } }, "org")?.id,
    "PVT_1",
  );
});
