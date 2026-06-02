// =============================================================================
// Port-level + handler snapshot capture via real GitHubProjectBackend.
// =============================================================================

import { resolve } from "@std/path";
import { graphql as rawGraphql } from "../../../src/adapters/github/internal/http-client.ts";
import { createGitHubBackend } from "../../../src/adapters/github/create-backend.ts";
import type { GitHubBackendConfig, ResolvedToken } from "../../../src/adapters/github/types.ts";
import type { ScrumConfig } from "../../../src/domain/config.ts";
import type {
  FixtureCatalog,
  ScenarioManifestEntry,
} from "../../../src/adapters/github/internal/fixture-replay/types.ts";
import { RecordingGitHubClient } from "../../../src/adapters/github/internal/fixture-replay/recording-client.ts";
import { writeJsonSnapshot } from "./port-snapshot-writer.ts";
import { CAPTURE_SCENARIOS, runHandlerSnapshot } from "./scenarios.ts";
import { type McpTextResult, parseToolText } from "../../../src/tools/_mcp_result.ts";

export const captureScenarioFixtures = async (opts: {
  scrumConfig: ScrumConfig;
  projectRoot: string;
  configDesc: string;
  resolvedGhConfig: GitHubBackendConfig;
  resolvedToken: ResolvedToken;
  fixturesDir: string;
  catalog: FixtureCatalog;
  scenarioFilter?: string;
  wireEntries:
    import("../../../src/adapters/github/internal/fixture-replay/types.ts").WireResponseEntry[];
}): Promise<{ scenarios: Record<string, ScenarioManifestEntry>; files: string[] }> => {
  const {
    scrumConfig,
    projectRoot,
    configDesc,
    resolvedGhConfig,
    resolvedToken,
    fixturesDir,
    catalog,
    scenarioFilter,
    wireEntries,
  } = opts;

  const scenarios: Record<string, ScenarioManifestEntry> = {};
  const files: string[] = [];

  const selected = scenarioFilter
    ? CAPTURE_SCENARIOS.filter((s) => s.name === scenarioFilter)
    : CAPTURE_SCENARIOS;

  if (selected.length === 0) {
    throw new Error(`Unknown scenario "${scenarioFilter}"`);
  }

  for (const scenario of selected) {
    const realGraphql = <T>(query: string, variables?: Record<string, unknown>) =>
      rawGraphql<T>(resolvedToken, query, variables ?? {});

    const recorder = new RecordingGitHubClient({
      graphql: realGraphql,
      rest: () => Promise.reject(new Error("REST not captured")),
    });

    const { backend } = createGitHubBackend({
      scrumConfig,
      projectRoot,
      configDesc,
      ghConfig: resolvedGhConfig,
      ghClient: recorder,
      resolvedToken,
    });

    await backend.reload();

    const ctx = { backend, scrumConfig, catalog };
    const portOutput = await scenario.run(ctx);

    const scenarioDir = resolve(fixturesDir, "scenarios", scenario.name);
    await Deno.mkdir(scenarioDir, { recursive: true });

    const portPath = `scenarios/${scenario.name}/port-output.json`;
    await writeJsonSnapshot(resolve(fixturesDir, portPath), portOutput);
    files.push(portPath);

    const scenarioWire = await recorder.persistWireResponses(fixturesDir);
    const callLog = recorder.buildScenarioCallLog([...wireEntries, ...scenarioWire]);
    const callLogPath = `scenarios/${scenario.name}/call-log.json`;
    await Deno.writeTextFile(
      resolve(fixturesDir, callLogPath),
      JSON.stringify(callLog, null, 2),
    );
    files.push(callLogPath);

    let handlerPath: string | undefined;
    if (scenario.captureHandler) {
      const handlerResult = await runHandlerSnapshot(scenario.name, ctx, portOutput);
      if (handlerResult) {
        handlerPath = `scenarios/${scenario.name}/handler-output.json`;
        await writeJsonSnapshot(
          resolve(fixturesDir, handlerPath),
          parseToolText(handlerResult),
        );
        files.push(handlerPath);
      }
    }

    scenarios[scenario.name] = {
      callLog: callLogPath,
      portOutput: portPath,
      handlerOutput: handlerPath,
    };
  }

  return { scenarios, files };
};
