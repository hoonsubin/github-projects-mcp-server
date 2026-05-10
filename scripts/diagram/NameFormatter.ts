// =============================================================================
// scripts/diagram/NameFormatter.ts — Sanitize names and format class names
// =============================================================================

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
