// =============================================================================
// src/domain/errors.ts - Domain-level error classes
//
// These live in the domain layer so both use-case code (src/scrum/) and adapter
// code (src/adapters/) can throw and catch them without cross-layer coupling.
// =============================================================================

import { SupportedBackend } from "./types.ts";

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

export abstract class AdapterError extends Error {
  abstract readonly backendName: SupportedBackend;
  abstract readonly code: string;
  abstract readonly recovery: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "AdapterError";
    this.context = context;
  }
}
