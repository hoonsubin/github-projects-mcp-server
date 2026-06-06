// =============================================================================
// src/domain/env.ts — EnvGetter type
//
// Abstracts "resolve an environment variable name to its value" without
// coupling any module to Deno.env.get(). The composition root (src/server.ts)
// provides the implementation; all downstream code receives this function
// through parameters.
// =============================================================================

/** Function that resolves an environment variable name to its value (or undefined). */
export type EnvGetter = (name: string) => string | undefined;
