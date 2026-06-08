// =============================================================================
// src/scrum/fetch-location.ts - fetchContent() use-case utility
//
// Converts a ContentLocation to its string content. Pure dispatch - no adapter
// dependencies, no authentication. config-loader.ts imports this directly
// (not through FileReaderPort) because config loading happens before any
// FileReaderPort implementors exist.
//
// Security note: the URL branch issues a plain unauthenticated fetch by default.
// Callers are responsible for ensuring the URL originates from trusted
// operator input (CLI or config file), not from user-supplied tool arguments.
// Pass an EnvGetter to enable auth via registered UrlRewriters (e.g. GITHUB_TOKEN).
// =============================================================================

import type { ContentLocation } from "../domain/content-location.ts";
import { describeContentLocation } from "../domain/content-location.ts";
import { assertNever, ConfigError } from "../domain/errors.ts";
import { findRewriter } from "./url-rewriters.ts";
import type { EnvGetter } from "../domain/env.ts";

const noopEnv: EnvGetter = () => undefined;

/**
 * Fetch the string content from wherever a ContentLocation points.
 *
 * @param location - the content location to fetch from
 * @param env - optional environment getter for auth-requiring URL rewriters
 * @throws {Error} for file I/O failures or HTTP non-2xx responses.
 */
export const fetchContent = async (
  location: ContentLocation,
  env: EnvGetter = noopEnv,
): Promise<string> => {
  // TypeScript narrows ContentLocation to `never` after all three branches are
  // handled. The assertNever guard provides a runtime backstop if a fourth
  // variant is added to the ContentLocation discriminated union.
  switch (location.kind) {
    case "file":
      return Deno.readTextFile(location.path);
    case "inline":
      return location.content;
    case "url": {
      // fetch follows redirects by default (redirect: "follow"); 3xx responses
      // are not an error case managed by this function - they are resolved to
      // the final response before reaching res.ok.
      //
      // Registered UrlRewriters may supply request options (e.g. auth headers)
      // via requestInit(). This keeps backend-specific auth in the adapter layer.
      const rewriter = findRewriter(location.url);
      const init = rewriter?.requestInit?.(location.url, env);

      let res: Response;
      try {
        res = await fetch(location.url, init);
      } catch (fetchErr) {
        throw new ConfigError(
          `Cannot fetch ${describeContentLocation(location)}: ${
            fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          }`,
          "NETWORK_ERROR",
          "Check your network connection. If using a URL, ensure the server has internet access.",
        );
      }
      if (!res.ok) {
        throw new ConfigError(
          `Cannot fetch ${describeContentLocation(location)}: HTTP ${res.status} ${res.statusText}`,
          "HTTP_ERROR",
          `The server returned HTTP ${res.status}. Verify the URL is correct and accessible.`,
        );
      }
      const text = await res.text();
      return text;
    }
    default:
      return assertNever(location);
  }
};
