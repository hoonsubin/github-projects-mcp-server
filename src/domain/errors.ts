// =============================================================================
// src/domain/errors.ts — Domain-level error classes
//
// These live in the domain layer so both use-case code (src/scrum/) and adapter
// code (src/adapters/) can throw and catch them without cross-layer coupling.
// =============================================================================

/**
 * Use in the `default` branch of exhaustive switches over discriminated unions.
 * TypeScript will produce a compile error if any variant is left unhandled,
 * because only `never` is assignable to the parameter.
 *
 * @example
 * switch (story.kind) {
 *   case "draft":  return "draft";
 *   case "issue":  return "issue";
 *   default: assertNever(story);
 * }
 */
export const assertNever = (x: never, msg?: string): never => {
  throw new Error(msg ?? `Unhandled variant: ${JSON.stringify(x)}`);
};

/**
 * Thrown when a SprintRef of "current" or "next" resolves to no iteration.
 * Expected during normal operation (e.g. no next sprint scheduled yet).
 * Callers that need to distinguish "absent" from "error" catch this specifically;
 * unexpected errors (auth failures, network errors) are left to propagate.
 */
export class SprintNotScheduledError extends Error {
  readonly ref: "current" | "next";

  constructor(ref: "current" | "next", message: string) {
    super(message);
    this.name = "SprintNotScheduledError";
    this.ref = ref;
  }
}

/**
 * Thrown when an ItemRef by key cannot be resolved to a story.
 * Used by resolveRef() in the adapter layer when { key } lookup fails.
 */
export class StoryNotFoundError extends Error {
  readonly key: string;

  constructor(key: string, message?: string) {
    super(message ?? `Story with key "${key}" not found.`);
    this.name = "StoryNotFoundError";
    this.key = key;
  }
}
