// =============================================================================
// Load fixture manifest v2 from adapter __fixtures__ directory.
// =============================================================================

import { dirname, fromFileUrl, resolve } from "@std/path";
import type { FixtureManifestV2 } from "./types.ts";

export const DEFAULT_FIXTURES_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../__fixtures__",
);

export const loadFixtureManifest = async (
  fixturesDir = DEFAULT_FIXTURES_DIR,
): Promise<FixtureManifestV2> => {
  const path = resolve(fixturesDir, "manifest.json");
  const text = await Deno.readTextFile(path);
  const parsed = JSON.parse(text) as FixtureManifestV2 & { version?: number };

  if (parsed.version !== 2) {
    throw new Error(
      `Fixture manifest at ${path} is version ${parsed.version ?? 1}; version 2 required. ` +
        "Run: deno task capture-fixtures",
    );
  }

  return parsed;
};

export const loadFixtureJson = async <T>(
  fixturesDir: string,
  relativePath: string,
): Promise<T> => {
  const text = await Deno.readTextFile(resolve(fixturesDir, relativePath));
  return JSON.parse(text) as T;
};
