// =============================================================================
// src/test/support/scrum-test-utils.ts
// Internal test utility - not part of the public module surface.
// Underscore prefix signals: do not re-export from index files.
// =============================================================================

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import { fetchContent } from "../../scrum/utils/fetch-location.ts";
import { type BootConfig, loadScrumConfig } from "../../scrum/config-boot.ts";
import {
  resolveLocation,
  SUPPORTED_TEMPLATE_EXTENSIONS,
} from "../../scrum/utils/resolve-location.ts";
import type { ContentLocation } from "../../domain/content-location.ts";
import type { FileReaderPort } from "../../scrum/ports.ts";
import { CAPTURED } from "@test/fixtures/port/index.ts";
import { type ConfigProfile, deriveConfigProfile } from "./config-profile.ts";
import { CapturedDataBackend } from "./captured-backend.ts";
import { ConfigShapedFakeBackend } from "./fake-backend.ts";
import { SessionCache } from "../../services/session-cache.ts";

/** Fresh session cache for handler contract tests (no cross-test pollution). */
export const testSessionCache = (): SessionCache => new SessionCache();

// ── Type template paths ───────────────────────────────────────────────────────

/**
 * Reads and parses the committed .github/scrum/config.yml, extracts all
 * type_mapping entries that declare a `template` field, and resolves each
 * to a ContentLocation using the same logic as loadConfig() in config-loader.ts.
 *
 * Reads from disk once. Callers should use the module-level lazy promise
 * (see typeTemplatePathsPromise below) rather than calling this directly
 * in each test, to avoid redundant disk reads.
 */
export const buildTypeTemplatePaths = async (): Promise<Record<string, ContentLocation>> => {
  const configPath = ".github/scrum/config.yml";
  const rawYml = await Deno.readTextFile(configPath);
  const config = parse(rawYml) as Record<string, unknown>;
  const backends = config.backends as Record<string, unknown>;
  const github = backends.github as Record<string, Record<string, unknown>>;
  const typeMapping = github.type_mapping as Record<string, { template?: string }>;
  const projectRoot = dirname(resolve(Deno.cwd(), configPath));
  const paths: Record<string, ContentLocation> = {};
  for (const [key, entry] of Object.entries(typeMapping)) {
    if (entry.template) {
      paths[key] = resolveLocation(
        entry.template,
        projectRoot,
        SUPPORTED_TEMPLATE_EXTENSIONS,
      );
    }
  }
  return paths;
};

/**
 * Module-level lazy promise - disk read and YAML parse happen once per test
 * file import, not once per test case. All tests that need the paths should
 * await this instead of calling buildTypeTemplatePaths() directly.
 */
export const typeTemplatePathsPromise: Promise<Record<string, ContentLocation>> =
  buildTypeTemplatePaths();

// ── Committed scrum config (tool-surface contract tests) ─────────────────────

const COMMITTED_CONFIG_PATH = ".github/scrum/config.yml";

/**
 * Loads the committed `.github/scrum/config.yml` once per test module -
 * the same file the server uses when started with default --config.
 */
export const committedScrumConfigPromise: Promise<BootConfig> = loadScrumConfig(
  resolveLocation(COMMITTED_CONFIG_PATH, resolve(Deno.cwd())),
);

/**
 * Derived vocabulary expectations from the committed config.
 * Await inside tests after committedScrumConfigPromise resolves.
 */
export const committedConfigProfilePromise: Promise<ConfigProfile> = committedScrumConfigPromise
  .then(deriveConfigProfile);

/**
 * Fake backend seeded from the committed scrum config vocabulary.
 */
export const committedFakeBackendPromise: Promise<ConfigShapedFakeBackend> =
  committedScrumConfigPromise.then((boot) => ConfigShapedFakeBackend.fromBoot(boot));

/**
 * Read-only backend replaying real port responses from captured.json (default profile).
 */
export const capturedBackendPromise: Promise<CapturedDataBackend> = Promise.resolve(
  CapturedDataBackend.fromProfile(CAPTURED.profiles["config"]),
);

// ── FileReaderPort stubs ──────────────────────────────────────────────────────

/**
 * Stub FileReaderPort that delegates to the real fetchContent().
 * Use in pipeline integration tests where real template file content is needed.
 */
export const realFileReader: FileReaderPort = {
  fetchContent: (loc: ContentLocation) => fetchContent(loc),
};

/**
 * Stub FileReaderPort that returns a fixed string without touching the filesystem.
 * Use in pure unit tests where only MIME resolution is being tested, not content.
 */
export const stubFileReader: FileReaderPort = {
  fetchContent: (_loc: ContentLocation) => Promise.resolve("stub content"),
};

// ── Ephemeral HTTP test server ─────────────────────────────────────────────────

/**
 * Spins up an ephemeral local HTTP server on a random port, calls fn with
 * the base URL, then shuts the server down in a finally block.
 *
 * Use this instead of inlining Deno.serve / server.shutdown() in every URL test.
 * Port 0 lets the OS pick a free port, avoiding conflicts across parallel test runs.
 *
 * @example
 * await withTestServer(
 *   () => new Response("hello", { status: 200 }),
 *   async (base) => {
 *     const result = await fetchContent({ kind: "url", url: new URL("/test.yml", base) });
 *     assertEquals(result, "hello");
 *   },
 * );
 */
export const withTestServer = async (
  handler: (req: Request) => Response,
  fn: (baseUrl: URL) => Promise<void>,
): Promise<void> => {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    handler,
  );
  const { port } = server.addr as Deno.NetAddr;
  try {
    await fn(new URL(`http://127.0.0.1:${port}`));
  } finally {
    await server.shutdown();
  }
};
