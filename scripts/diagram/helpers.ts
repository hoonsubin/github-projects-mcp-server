// =============================================================================
// scripts/diagram/helpers.ts - Shared diagram utilities
//
//   - Import-path resolution (resolveImport)
//   - Unused-export detection (findUnusedExports)
// =============================================================================

import { UnusedExport } from "./types.ts";
import { ParsedModule } from "./ParsedModule.ts";

/**
 * Resolve a relative import path to a module path (relative to src/).
 *
 * Examples:
 *   resolveImport("tools/scrum-read.ts", "./mappers")       → "tools/mappers.ts"
 *   resolveImport("tools/scrum-read.ts", "../types")        → "types.ts"
 *   resolveImport("tools/scrum-read.ts", "./github")        → "github/server.ts"
 */
export const resolveImport = (
  fromPath: string,
  importPath: string,
): string | null => {
  // don't resolve external imports
  if (!importPath.startsWith(".")) return importPath;

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
  return `${candidate}/server.ts`;
};

/**
 * Identifies exports within the provided modules that are not referenced by any imports in those modules.
 */
export const findUnusedExports = (modules: ParsedModule[]): UnusedExport[] => {
  // todo: exclude exports that are used within the same module.
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
          modulePathName: mod.filePathName,
        });
      }
    }
  }

  return unreferencedExports;
};
