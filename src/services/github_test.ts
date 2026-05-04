import { assertEquals, assertStringIncludes } from "@std/assert";
import { enrichError, formatError, GitHubApiError } from "./github.ts";

Deno.test("formatError - GitHubApiError: returns 'Error: ' prefix with message", () => {
  const err = new GitHubApiError("token expired");
  assertEquals(formatError(err), "Error: token expired");
});

Deno.test("formatError - GitHubApiError with status code: message only, no status in output", () => {
  const err = new GitHubApiError("rate limited", 403);
  assertEquals(formatError(err), "Error: rate limited");
});

Deno.test("formatError - standard Error: returns 'Error: ' prefix with message", () => {
  assertEquals(formatError(new Error("something broke")), "Error: something broke");
});

Deno.test("formatError - string value: prefixes with 'Error: '", () => {
  assertEquals(formatError("raw string failure"), "Error: raw string failure");
});

Deno.test("formatError - number value: stringifies and prefixes", () => {
  assertEquals(formatError(42), "Error: 42");
});

Deno.test("formatError - null value: returns string starting with 'Error: '", () => {
  assertStringIncludes(formatError(null), "Error:");
});

Deno.test("GitHubApiError - is instanceof Error", () => {
  assertEquals(new GitHubApiError("x") instanceof Error, true);
});

Deno.test("GitHubApiError - name property is 'GitHubApiError'", () => {
  assertEquals(new GitHubApiError("x").name, "GitHubApiError");
});

Deno.test("GitHubApiError - stores graphqlErrors array", () => {
  const errs = ["field not found", "null result"];
  const e = new GitHubApiError("multi", 200, errs);
  assertEquals(e.graphqlErrors, errs);
});

// ---------------------------------------------------------------------------
// enrichError
// ---------------------------------------------------------------------------

Deno.test("enrichError - non-GitHubApiError: falls back to formatError output", () => {
  assertEquals(enrichError(new Error("plain error")), "Error: plain error");
});

Deno.test("enrichError - plain GitHubApiError (no status, no graphqlErrors): returns base only", () => {
  const err = new GitHubApiError("something went wrong");
  const result = enrichError(err);
  assertEquals(result, "Error: something went wrong");
});

Deno.test("enrichError - 401: includes token URL and permission list", () => {
  const err = new GitHubApiError("Authentication failed", 401);
  const result = enrichError(err);
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "github.com/settings/tokens");
  assertStringIncludes(result, "invalid or expired");
});

Deno.test("enrichError - 403 rate-limited: instructs to wait until reset time", () => {
  const err = new GitHubApiError("Rate limit or permission denied. Rate limit resets at 2026-01-01.", 403);
  const result = enrichError(err);
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "Wait until");
});

Deno.test("enrichError - 403 permission denied without operation: generic permission hint", () => {
  const err = new GitHubApiError("Permission denied", 403);
  const result = enrichError(err);
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "Permission denied");
  assertStringIncludes(result, "github.com/settings/tokens");
});

Deno.test("enrichError - 403 with operation context: includes required permission", () => {
  const err = new GitHubApiError("Permission denied", 403);
  const result = enrichError(err, { operation: "create_issue" });
  assertStringIncludes(result, "Issues: Read and write");
});

Deno.test("enrichError - GraphQL 'Could not resolve to a Repository': repo access hint", () => {
  const err = new GitHubApiError(
    "GraphQL errors: Could not resolve to a Repository with the name 'owner/repo'.",
    undefined,
    ["Could not resolve to a Repository with the name 'owner/repo'."],
  );
  const result = enrichError(err);
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "owner and repo name are spelled correctly");
  assertStringIncludes(result, "fine-grained token");
});

Deno.test("enrichError - GraphQL 'Resource not accessible by personal access token': scope hint", () => {
  const err = new GitHubApiError(
    "GraphQL errors: Resource not accessible by personal access token",
    undefined,
    ["Resource not accessible by personal access token"],
  );
  const result = enrichError(err, { operation: "get_repo_file" });
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "Contents: Read");
  assertStringIncludes(result, "github.com/settings/tokens");
});

Deno.test("enrichError - GraphQL write access denied: write scope hint", () => {
  const err = new GitHubApiError(
    "GraphQL errors: Must have push access to create a commit",
    undefined,
    ["Must have push access to create a commit"],
  );
  const result = enrichError(err, { operation: "write_repo_file" });
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "Contents: Read and write");
});

Deno.test("enrichError - GraphQL invalid field: query revision hint", () => {
  const err = new GitHubApiError(
    "GraphQL errors: Field 'badField' doesn't exist on type 'Repository'",
    undefined,
    ["Field 'badField' doesn't exist on type 'Repository'"],
  );
  const result = enrichError(err, { operation: "graphql" });
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "viewer { login }");
});

Deno.test("enrichError - GraphQL variable type error: variable type hint", () => {
  const err = new GitHubApiError(
    "GraphQL errors: Variable '$id' of type 'Int' was provided invalid value",
    undefined,
    ["Variable '$id' of type 'Int' was provided invalid value"],
  );
  const result = enrichError(err);
  assertStringIncludes(result, "→ Fix:");
  assertStringIncludes(result, "node IDs are String");
});
