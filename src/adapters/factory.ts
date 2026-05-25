// src/adapters/factory.ts — AdapterFactory + createBackend() registry
//
// The factory contract every platform adapter must implement, and the
// composition-root entry point that selects the correct adapter at startup.
// Platform selection is driven by the SCRUM_PLATFORM env var (default "github").

import type { FileReaderPort, ProjectReader, ProjectWriter } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { PlatformCapabilities } from "./capabilities.ts";

// ── AdapterFactory ──────────────────────────────────────────────────────────

/**
 * Every platform adapter provides a factory class implementing this interface.
 * The composition root calls create() once at startup; the factory owns all
 * internal wiring (config loading, service construction, facade assembly).
 */
export interface AdapterFactory {
  /** Platform identifier key (e.g. "github"). Must match PlatformCapabilities.platform. */
  readonly platform: string;

  /**
   * Construct the backend and all supporting services.
   * Called once at startup by createBackend().
   */
  create(): Promise<BackendResult>;
}

// ── BackendResult ───────────────────────────────────────────────────────────

/**
 * Unified return type for all adapter factories.
 *
 * Replaces the adapter-specific GitHubBackendResult. The composition root
 * receives this and uses it for tool registration — it never knows which
 * concrete adapter produced it.
 *
 * fileReader is nullable because not every platform has a file-reader
 * capability. The composition root checks this before registering template
 * MCP resources.
 */
export interface BackendResult {
  /** The constructed backend, exposed only through the port interfaces. */
  readonly backend: ProjectReader & ProjectWriter;

  /** Capability declaration — gates optional behavior in the composition root. */
  readonly capabilities: PlatformCapabilities;

  /** File reader for template fetching, or null if the platform lacks file-reader support. */
  readonly fileReader: FileReaderPort | null;

  /** Platform-agnostic Scrum configuration (resolved by the adapter factory). */
  readonly scrumConfig: ScrumConfig;
}

// ── createBackend() ─────────────────────────────────────────────────────────

/**
 * Select and construct a backend from the registered adapter factories.
 *
 * 1. Reads SCRUM_PLATFORM env var (defaults to "github").
 * 2. Finds the AdapterFactory whose platform matches.
 * 3. Throws if no match is found (lists registered platforms in the error).
 * 4. Calls factory.create() and returns the BackendResult.
 *
 * The caller (src/index.ts) registers factories and passes the list here —
 * this function owns neither the construction nor the registration; it only
 * selects.
 *
 * @param factories — one or more AdapterFactory instances registered by the composition root
 * @throws {Error} when SCRUM_PLATFORM does not match any registered factory
 */
export const createBackend = async (
  factories: AdapterFactory[],
): Promise<BackendResult> => {
  const target = Deno.env.get("SCRUM_PLATFORM") ?? "github";

  const factory = factories.find((f) => f.platform === target);
  if (!factory) {
    const registered = factories.map((f) => f.platform).join(", ") || "(none)";
    throw new Error(
      `Unknown SCRUM_PLATFORM "${target}". ` +
        `Registered platforms: [${registered}]. ` +
        `Set SCRUM_PLATFORM to one of those values or add a new adapter factory.`,
    );
  }

  return await factory.create();
};
