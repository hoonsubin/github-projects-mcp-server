// =============================================================================
// src/domain/rules/dependencies.ts — Pure domain rule: dependency parsing
//
// Pure functions for parsing dependency references from story body text and
// generating the ## Dependencies markdown section.
// This module has no imports outside the standard library.
// =============================================================================

import type { DependencyEntry } from "../types.ts";

/**
 * Regex matching dependency references in body text.
 * Supports: "Depends on #123", "Blocked by #456", "Blocks #789", "Related to #012".
 */
const DEPENDENCY_REF_RE = /(?:Depends\s+on|Blocked\s+by|Blocks|Related\s+to)\s+#(\d+)/gi;

/**
 * Parse dependency references from a story body's `## Dependencies` section.
 *
 * Scans the body for a `## Dependencies` heading and extracts structured
 * dependency entries from the markdown list items beneath it.
 * Each list item should follow the pattern:
 *   - #123 Title of the story (Depends on)
 *
 * Falls back to scanning the entire body for inline dependency references
 * if no `## Dependencies` section is found.
 *
 * @param body - Story body markdown text
 * @returns Array of parsed DependencyEntry objects
 */
export const parseDependencies = (body: string): DependencyEntry[] => {
  const entries: DependencyEntry[] = [];
  const section = extractDependencySection(body);

  if (section !== null) {
    // Parse structured markdown list items from the ## Dependencies section
    const itemRe = /^[ \t]*[-*][ \t]+#(\d+)[ \t]+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = itemRe.exec(section)) !== null) {
      entries.push({
        key: match[1],
        title: match[2].trim() || null,
        ref: { id: null },
      });
    }
  } else {
    // Fallback: scan entire body for inline references
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = DEPENDENCY_REF_RE.exec(body)) !== null) {
      const key = match[1];
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({
          key,
          title: null,
          ref: { id: null },
        });
      }
    }
  }

  return entries;
};

/**
 * Check if body contains a `## Dependencies` section.
 *
 * @param body - Story body markdown text
 * @returns true if a ## Dependencies heading is present
 */
export const hasDependencySection = (body: string): boolean => /^##[ \t]+Dependencies$/m.test(body);

/**
 * Generate a `## Dependencies` markdown section from dependency entries.
 *
 * Produces output like:
 * ```markdown
 * ## Dependencies
 *
 * - #123 Story title (Depends on)
 * - #456 Another story (Blocks)
 * ```
 *
 * @param entries - Array of DependencyEntry objects
 * @returns Markdown string for the dependencies section
 */
export const generateDependencySection = (entries: DependencyEntry[]): string => {
  if (entries.length === 0) return "";

  const lines: string[] = ["## Dependencies", ""];
  for (const entry of entries) {
    const titlePart = entry.title ? ` ${entry.title}` : "";
    lines.push(`- #${entry.key}${titlePart}`);
  }
  lines.push("");

  return lines.join("\n");
};

/**
 * Extract the content of the `## Dependencies` section from body text.
 * Returns null if no such section exists.
 *
 * @param body - Story body markdown text
 * @returns Section content between ## Dependencies and the next ## heading, or null
 */
const extractDependencySection = (body: string): string | null => {
  const sectionRe = /^##[ \t]+Dependencies[ \t]*\n([\s\S]*?)(?=\n##[ \t]|$)/m;
  const match = sectionRe.exec(body);
  return match ? match[1].trim() : null;
};
