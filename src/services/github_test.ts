import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatError, GitHubApiError } from "./github.ts";

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
