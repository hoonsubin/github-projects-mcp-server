// =============================================================================
// scripts/diagram/resolveImport.ts — Resolve relative import paths to module paths
// =============================================================================

import { UnusedExport } from "./types.ts";
import { ParsedModule } from "./ParsedModule.ts";

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

/**
 * Identifies exports within the provided modules that are not referenced by any imports in those modules.
 */
export const findUnusedExports = (modules: ParsedModule[]): UnusedExport[] => {
  const moduleMap = new Map<string, ParsedModule>();
  const usedNamesByModule = new Map<string, Set<string>>();

  // Initialize maps
  for (const mod of modules) {
    moduleMap.set(mod.filePathName, mod);
    usedNamesByModule.set(mod.filePathName, new Set());
  }

  // Track usage
  for (const mod of modules) {
    for (const imp of mod.getImports()) {
      const resolved = resolveImport(mod.filePathName, imp.path);
      if (!resolved || !moduleMap.has(resolved)) continue;

      const targetMod = moduleMap.get(resolved)!;
      const usedSet = usedNamesByModule.get(resolved)!;

      if (imp.kind === "named" || imp.kind === "type") {
        // For named/type imports, the 'name' property is the exported name in the target module
        usedSet.add(imp.name);
      } else if (imp.kind === "namespace") {
        // Namespace import (* as Foo) implies all exports are potentially used
        for (const exp of targetMod.getExports()) {
          usedSet.add(exp.name);
        }
      } else if (imp.kind === "default") {
        // Best effort for default imports: use the local name as a fallback
        usedSet.add(imp.name);
      }
    }
  }

  const unreferencedExports: UnusedExport[] = [];

  // Identify unused
  for (const mod of modules) {
    const usedSet = usedNamesByModule.get(mod.filePathName)!;
    for (const exp of mod.getExports()) {
      if (!usedSet.has(exp.name)) {
        unreferencedExports.push({
          ...exp,
          modulePath: mod.filePathName,
        });
      }
    }
  }

  return unreferencedExports;
};
