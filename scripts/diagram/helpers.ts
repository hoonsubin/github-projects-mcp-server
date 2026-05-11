// =============================================================================
// scripts/diagram/resolveImport.ts — Resolve relative import paths to module paths
// =============================================================================

/**
 * Resolve a relative import path to a module path (relative to src/).
 *
 * Examples:
 *   resolveImport("tools/scrum-read.ts", "./mappers")       → "tools/mappers.ts"
 *   resolveImport("tools/scrum-read.ts", "../types")        → "types.ts"
 *   resolveImport("tools/scrum-read.ts", "./github")        → "github/index.ts"
 */
export const resolveImport = (
  fromPath: string,
  importPath: string,
): string | null => {
  const dir = fromPath.split("/").slice(0, -1);
  const segs = importPath.split("/");
  const result: string[] = [];
  let i = 0;

  // Count leading ../
  while (i < segs.length && segs[i] === "..") {
    dir.pop();
    i++;
  }
  // Skip single .
  if (i < segs.length && segs[i] === ".") i++;
  // Remaining segments
  while (i < segs.length) {
    result.push(segs[i]);
    i++;
  }

  const candidate = [...dir, ...result].join("/");
  if (candidate.endsWith(".ts")) return candidate;
  return `${candidate}/index.ts`;
};

/**
 * Sanitize a name for use as a Mermaid ID.
 * Removes invalid characters, collapses underscores.
 */
export const sanitizeId = (name: string): string =>
  name
    .replace(/-/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * Format a module path into a title-case class name.
 *
 * Examples:
 *   formatClassNameFromPath("tools/scrum-read.ts") → "ToolsScrumRead"
 *   formatClassNameFromPath("types.ts")            → "Types"
 */
export const formatClassNameFromPath = (path: string): string => {
  let name = path
    .replace(/\.ts$/, "")
    .replace(/\//g, "_")
    .replace(/_/g, " ")
    .replace(/^root/, "Root");

  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  // Sanitize to remove hyphens and other invalid characters
  return sanitizeId(name);
};
