// =============================================================================
// src/scrum/url-rewriters.ts - URL rewriter registry
//
// Each backend contributes one entry to this registry. When a config URL
// matches a rewriter, it gets transparently converted to the canonical
// raw-content form before any fetch occurs.
//
// This is the single source of truth for platform-specific URL patterns.
// Resolution code and error-handling code consume this registry — they
// never hard-code platform-specific URL patterns.
// =============================================================================

import type { UrlRewriter } from "../domain/content-location.ts";

/** All registered URL rewriters — each backend adds its own entry. */
export const URL_REWRITERS: readonly UrlRewriter[] = [
  // GitHub: auto-convert blob URLs to raw.githubusercontent.com.
  // Users naturally copy blob URLs from their browser address bar,
  // but blob URLs return HTML pages, not raw file content.
  {
    backendName: "github",
    matches: (url: URL): boolean =>
      url.hostname === "github.com" && url.pathname.includes("/blob/"),
    rewrite: (url: URL): URL => {
      const parts = url.pathname.split("/blob/", 2);
      if (parts.length !== 2) return url;
      return new URL(`https://raw.githubusercontent.com${parts[0]}/${parts[1]}`);
    },
    recoveryHint: (url: URL): string => {
      const parts = url.pathname.split("/blob/", 2);
      if (parts.length === 2) {
        return `GitHub blob URLs return HTML pages. ` +
          `Use a raw.githubusercontent.com URL instead: ` +
          `https://raw.githubusercontent.com${parts[0]}/${parts[1]}`;
      }
      return `GitHub blob URLs return HTML pages. ` +
        `Use a raw.githubusercontent.com URL instead.`;
    },
  },
  // Future: add GitLab, Bitbucket, etc. rewriters here.
];

/**
 * Find the first rewriter that matches a URL.
 * Returns undefined when no rewriter matches — the URL is used as-is.
 */
export const findRewriter = (url: URL): UrlRewriter | undefined =>
  URL_REWRITERS.find((r) => r.matches(url));
