// =============================================================================
// src/scrum/fetch-location.ts - fetchContent() use-case utility
//
// Converts a ContentLocation to its string content. Pure dispatch — no adapter
// dependencies, no authentication. config-loader.ts imports this directly
// (not through FileReaderPort) because config loading happens before any
// FileReaderPort implementors exist.
//
// Security note: the URL branch issues a plain unauthenticated fetch.
// Callers are responsible for ensuring the URL originates from trusted
// operator input (CLI or config file), not from user-supplied tool arguments.
// GitHubFileReader wraps this for github.com URLs with an auth header.
// =============================================================================

import type { ContentLocation } from "../domain/content-location.ts";
import { describeContentLocation } from "../domain/content-location.ts";

/**
 * Fetch the string content from wherever a ContentLocation points.
 *
 * @throws {Error} for file I/O failures or HTTP non-2xx responses.
 */
export const fetchContent = async (
  location: ContentLocation,
): Promise<string> => {
  switch (location.kind) {
    case "file":
      return Deno.readTextFile(location.path);
    case "inline":
      return location.content;
    case "url": {
      const res = await fetch(location.url);
      if (!res.ok) {
        throw new Error(
          `Cannot fetch ${describeContentLocation(location)}: HTTP ${res.status} ${res.statusText}`,
        );
      }
      return res.text();
    }
  }
};
