// src/adapters/factory.ts - AdapterFactory + createBackend() registry
//
// The factory contract every platform adapter must implement, and the
// composition-root entry point that selects the correct adapter at startup.
// Platform selection is passed in from the composition root (src/server.ts).

import type { FileReaderPort, ProjectReader, ProjectWriter } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { PlatformCapabilities } from "./capabilities.ts";
import type { ContentLocation } from "../domain/content-location.ts";
import type { EnvGetter } from "../domain/env.ts";
import { ConfigError } from "../domain/errors.ts";

// ── AdapterStartupOptions ───────────────────────────────────────────────────

/**
 * Startup options passed from the composition root to every adapter factory.
 * scrumConfig and projectRoot come from loadScrumConfig() in the use-case layer
 * - the adapter never touches the YAML file directly.
 * env comes from the composition root - adapters never read Deno.env directly.
 */
export interface AdapterStartupOptions {
  /**
   * Where to load the scrum config from.
   * Always provided by the server composition root.
   */
  readonly configLocation: ContentLocation;

  /** Parsed ScrumConfig from the use-case layer's loadScrumConfig(). */
  readonly scrumConfig: ScrumConfig;

  /** Resolved project root from loadScrumConfig(). */
  readonly projectRoot: string;

  /** Environment variable resolver provided by the composition root. */
  readonly env: EnvGetter;
}

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
  create(options?: AdapterStartupOptions): Promise<BackendResult>;
}

// ── BackendResult ───────────────────────────────────────────────────────────

/**
 * Unified return type for all adapter factories.
 *
 * The composition root receives this and uses it for tool registration.
 * scrumConfig is no longer carried on BackendResult - the caller already has
 * it from loadScrumConfig(). typeTemplatePaths is also removed - it lives
 * inside the adapter's bootState.live.typeTemplatePaths.
 *
 * fileReader is nullable because not every platform has a file-reader
 * capability. The composition root checks this before registering template
 * MCP resources.
 */
export interface BackendResult {
  /** The constructed backend, exposed only through the port interfaces. */
  readonly backend: ProjectReader & ProjectWriter;

  /** Capability declaration - gates optional behavior in the composition root. */
  readonly capabilities: PlatformCapabilities;

  /** File reader for template fetching, or null if the platform lacks file-reader support. */
  readonly fileReader: FileReaderPort | null;

  /**
   * Canonical type key → template ContentLocation map.
   * Populated from the adapter's bootState.live.typeTemplatePaths.
   * Used by server.ts to register MCP template resources.
   */
  readonly typeTemplatePaths: Record<string, ContentLocation>;
}

// ── createBackend() ─────────────────────────────────────────────────────────

/**
 * Select and construct a backend from the registered adapter factories.
 *
 * 1. Uses the provided platform parameter (defaults to "github").
 * 2. Finds the AdapterFactory whose platform matches.
 * 3. Throws if no match is found (lists registered platforms in the error).
 * 4. Calls factory.create() and returns the BackendResult.
 *
 * The caller (src/server.ts) registers factories and passes the list here -
 * this function owns neither the construction nor the registration; it only
 * selects.
 *
 * @param factories - one or more AdapterFactory instances registered by the composition root
 * @param options - AdapterStartupOptions extended with an optional platform override
 * @throws {Error} when the platform does not match any registered factory
 */
export const createBackend = async (
  factories: AdapterFactory[],
  options?: AdapterStartupOptions & { platform?: string },
): Promise<BackendResult> => {
  const target = options?.platform ?? "github";

  const factory = factories.find((f) => f.platform === target);
  if (!factory) {
    const registered = factories.map((f) => f.platform).join(", ") || "(none)";
    throw new ConfigError(
      `Unknown SCRUM_PLATFORM "${target}". Registered platforms: [${registered}].`,
      "UNKNOWN_PLATFORM",
      `Set SCRUM_PLATFORM to one of the registered platforms: [${registered}], or add a new adapter factory.`,
    );
  }

  return await factory.create(options);
};
