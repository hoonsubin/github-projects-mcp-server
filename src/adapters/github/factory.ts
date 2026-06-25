// src/adapters/github/factory.ts - GitHub adapter factory
// =============================================================================

import type { AdapterFactory, AdapterStartupOptions, BackendResult } from "../factory.ts";
import { graphql, rest } from "./infra/http-client.ts";
import type { GitHubBackendConfig } from "./types.ts";
import { resolveToken, validateToken } from "./types.ts";
import { describeContentLocation } from "../../domain/content-location.ts";
import { createGitHubBackend, toBackendResult } from "./create-backend.ts";

export class GitHubAdapterFactory implements AdapterFactory {
  readonly platform = "github";

  async create(options?: AdapterStartupOptions): Promise<BackendResult> {
    const { configLocation, scrumConfig, projectRoot, env } = options!;
    const configDesc = describeContentLocation(configLocation);

    const ghConfig = scrumConfig.backends.github as GitHubBackendConfig;
    const resolvedToken = resolveToken(ghConfig.auth.token, configDesc, env);
    validateToken(resolvedToken, configDesc);

    // Verify the token actually works with the GitHub API before proceeding.
    // Uses the existing rest() transport (same retry/timeout/error handling).
    await rest(resolvedToken, "user");

    const resolvedGhConfig: GitHubBackendConfig = {
      ...ghConfig,
      auth: { ...ghConfig.auth, token: resolvedToken },
    };

    const ghClient = {
      graphql: <T>(query: string, variables?: Record<string, unknown>) =>
        graphql<T>(resolvedToken, query, variables),
      rest: <T>(
        path: string,
        options?: {
          method?: "GET" | "POST" | "PATCH" | "DELETE";
          params?: Record<string, string>;
          body?: unknown;
          accept?: string;
        },
      ) => rest<T>(resolvedToken, path, options),
    };

    return toBackendResult(createGitHubBackend({
      scrumConfig,
      projectRoot,
      configDesc,
      ghConfig: resolvedGhConfig,
      ghClient,
      resolvedToken,
    }));
  }
}
