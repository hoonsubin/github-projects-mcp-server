// =============================================================================
// scripts/api-capture/github-capturer.ts - GitHub fixture capture orchestrator
// =============================================================================

import { dirname, fromFileUrl, resolve } from "@std/path";
import { resolveToken, validateToken } from "../../src/adapters/github/types.ts";
import type { GitHubBackendConfig } from "../../src/adapters/github/types.ts";
import type { ScrumConfig } from "../../src/domain/config.ts";
import type { CaptureResult } from "../capture-test-fixtures.ts";
import type { FixtureManifestV2 } from "../../src/adapters/github/internal/fixture-replay/types.ts";
import { captureWireFixtures } from "./github/wire-capturer.ts";
import { captureScenarioFixtures } from "./github/scenario-capturer.ts";
import { buildFixtureBackend, validateFixtureReplay } from "../../src/scrum/fixture-backend.ts";

const DEFAULT_FIXTURES_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../src/adapters/github/internal/__fixtures__",
);

export type CaptureMode = "wire" | "scenarios" | "all" | "validate";

const writeManifestV2 = async (opts: {
  fixturesDir: string;
  capturedAt: string;
  resolvedGhConfig: GitHubBackendConfig;
  wireEntries: FixtureManifestV2["wire"]["responses"];
  catalog: FixtureManifestV2["catalog"];
  legacyFiles: string[];
  scenarios: FixtureManifestV2["scenarios"];
  scenarioFiles: string[];
  manifest?: FixtureManifestV2;
}): Promise<void> => {
  const allFiles = [
    ...opts.legacyFiles,
    ...opts.wireEntries.map((e) => e.file),
    ...opts.scenarioFiles,
    "catalog.json",
    "manifest.json",
  ];

  const manifest: FixtureManifestV2 = opts.manifest ?? {
    version: 2,
    capturedAt: opts.capturedAt,
    platform: "github",
    owner: opts.resolvedGhConfig.owner,
    projectNumber: opts.resolvedGhConfig.project_number,
    wire: { responses: opts.wireEntries },
    scenarios: opts.scenarios,
    catalog: opts.catalog,
    files: allFiles,
  };

  await Deno.writeTextFile(
    resolve(opts.fixturesDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
};

export class GitHubFixtureCapturer {
  readonly platform = "github";

  async capture(
    scrumConfig: ScrumConfig,
    outputDir?: string,
    options?: {
      mode?: CaptureMode;
      projectRoot?: string;
      scenario?: string;
    },
  ): Promise<CaptureResult> {
    const effectiveDir = outputDir ?? DEFAULT_FIXTURES_DIR;
    const mode = options?.mode ?? "all";
    const projectRoot = options?.projectRoot ?? Deno.cwd();
    const configDesc = "capture-fixtures";

    if (mode === "validate") {
      await validateFixtureReplay({
        scrumConfig,
        projectRoot,
        configDesc,
        fixturesDir: effectiveDir,
      });
      return {
        platform: "github",
        outputDir: effectiveDir,
        files: [],
        capturedAt: new Date().toISOString(),
      };
    }

    await Deno.mkdir(effectiveDir, { recursive: true });

    const ghConfig = scrumConfig.backends.github as GitHubBackendConfig;
    const resolvedToken = resolveToken(ghConfig.auth.token, configDesc);
    validateToken(resolvedToken, configDesc);

    const resolvedGhConfig: GitHubBackendConfig = {
      ...ghConfig,
      auth: { ...ghConfig.auth, token: resolvedToken },
    };

    const capturedAt = new Date().toISOString();
    let wireEntries: FixtureManifestV2["wire"]["responses"] = [];
    let legacyFiles: string[] = [];
    let catalog: FixtureManifestV2["catalog"];
    let scenarioManifest: FixtureManifestV2["scenarios"] = {};
    let scenarioFiles: string[] = [];

    if (mode === "wire" || mode === "all") {
      const wire = await captureWireFixtures({
        scrumConfig,
        projectRoot,
        configDesc,
        resolvedGhConfig,
        resolvedToken,
        fixturesDir: effectiveDir,
      });
      wireEntries = wire.wireEntries;
      legacyFiles = wire.legacyFiles;
      catalog = wire.catalog;

      await Deno.writeTextFile(
        resolve(effectiveDir, "catalog.json"),
        JSON.stringify(catalog, null, 2),
      );

      // Write manifest v2 after wire phase so --mode validate works even if scenarios fail.
      await writeManifestV2({
        fixturesDir: effectiveDir,
        capturedAt,
        resolvedGhConfig,
        wireEntries,
        catalog,
        legacyFiles,
        scenarios: {},
        scenarioFiles: [],
      });
    } else {
      const catalogPath = resolve(effectiveDir, "catalog.json");
      catalog = JSON.parse(await Deno.readTextFile(catalogPath));
    }

    if (mode === "scenarios" || mode === "all") {
      if (!catalog!) {
        const catalogPath = resolve(effectiveDir, "catalog.json");
        catalog = JSON.parse(await Deno.readTextFile(catalogPath));
      }
      const scenarios = await captureScenarioFixtures({
        scrumConfig,
        projectRoot,
        configDesc,
        resolvedGhConfig,
        resolvedToken,
        fixturesDir: effectiveDir,
        catalog: catalog!,
        scenarioFilter: options?.scenario,
        wireEntries,
      });
      scenarioManifest = scenarios.scenarios;
      scenarioFiles = scenarios.files;
    }

    const allFiles = [
      ...legacyFiles,
      ...wireEntries.map((e) => e.file),
      ...scenarioFiles,
      "catalog.json",
      "manifest.json",
    ];

    if (catalog!) {
      await Deno.writeTextFile(
        resolve(effectiveDir, "catalog.json"),
        JSON.stringify(catalog, null, 2),
      );
    }

    const manifest: FixtureManifestV2 = {
      version: 2,
      capturedAt,
      platform: "github",
      owner: resolvedGhConfig.owner,
      projectNumber: resolvedGhConfig.project_number,
      wire: { responses: wireEntries },
      scenarios: scenarioManifest,
      catalog: catalog!,
      files: allFiles,
    };

    await writeManifestV2({
      fixturesDir: effectiveDir,
      capturedAt,
      resolvedGhConfig,
      wireEntries,
      catalog: catalog!,
      legacyFiles,
      scenarios: scenarioManifest,
      scenarioFiles,
      manifest,
    });

    return {
      platform: "github",
      outputDir: effectiveDir,
      files: allFiles.map((f) => resolve(effectiveDir, f)),
      capturedAt,
    };
  }
}
