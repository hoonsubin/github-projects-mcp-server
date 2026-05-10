// =============================================================================
// scripts/diagram/DependencyGraph.ts — Build dependency graph and detect unused exports
// =============================================================================

import { resolveImport } from "./resolveImport.ts";
import { extractImportedNames } from "./ImportExtractor.ts";
import { ExportKind } from "./ExportParser.ts";
import type { ParsedModule } from "./DiagramStyler.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

export type { ParsedModule };

export interface UnusedExport {
  modulePath: string;
  exportName: string;
  exportKind: ExportKind;
}

// ── DependencyGraph ────────────────────────────────────────────────────────────

/**
 * Build adjacency list of module dependencies and detect unused exports.
 */
export class DependencyGraph {
  constructor(private readonly modules: ParsedModule[]) {}

  buildAdjacencyList(): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    for (const mod of this.modules) {
      if (!adj.has(mod.path)) adj.set(mod.path, new Set());
      for (const imp of mod.imports) {
        const resolved = resolveImport(mod.path, imp);
        if (resolved) {
          adj.get(mod.path)!.add(resolved);
        }
      }
    }
    return adj;
  }

  getDependencies(module: ParsedModule): ParsedModule[] {
    const deps = new Set<ParsedModule>();
    for (const imp of module.imports) {
      const resolved = resolveImport(module.path, imp);
      if (resolved) {
        const target = this.modules.find((m) => m.path === resolved);
        if (target) deps.add(target);
      }
    }
    return Array.from(deps);
  }

  findUnusedExports(): UnusedExport[] {
    // Step 1: Collect all imported names across all modules
    const importedNames = new Set<string>();

    for (const mod of this.modules) {
      const sourceContent = mod.content;
      if (!sourceContent) continue;

      for (const imp of mod.imports) {
        const resolved = resolveImport(mod.path, imp);
        if (!resolved) continue;

        const target = this.modules.find((m) => m.path === resolved);
        if (!target) continue;

        const names = extractImportedNames(sourceContent, imp);
        for (const name of names) {
          importedNames.add(name);
        }
      }
    }

    // Step 2: Find exports that are never imported
    const unused: UnusedExport[] = [];

    for (const mod of this.modules) {
      for (const exp of mod.exports) {
        if (!importedNames.has(exp.name)) {
          unused.push({
            modulePath: mod.path,
            exportName: exp.name,
            exportKind: exp.kind,
          });
        }
      }
    }

    return unused;
  }

  getImportedBy(modulePath: string): string[] {
    const importers: string[] = [];
    for (const mod of this.modules) {
      for (const imp of mod.imports) {
        const resolved = resolveImport(mod.path, imp);
        if (resolved === modulePath) {
          importers.push(mod.path);
        }
      }
    }
    return importers;
  }
}
