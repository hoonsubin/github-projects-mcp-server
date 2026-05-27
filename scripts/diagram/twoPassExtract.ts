// =============================================================================
// scripts/diagram/twoPassExtract.ts — Two-pass collection helper for type-surface extraction
// =============================================================================

import type { ExtractedClass, ExtractedRelationship } from "./types.ts";

export type ExtractorFn = (
  knownNames: Set<string>,
) => {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  warnings?: string[];
  warningNodes?: Set<string>;
};

export const twoPassExtract = (extractors: ExtractorFn[]): {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  warnings: string[];
  warningNodes: Set<string>;
} => {
  // Pass 1: names only (warnings and warningNodes discarded — re-emitted on pass 2)
  const knownNames = new Set<string>();
  for (const fn of extractors) {
    const { classes } = fn(new Set());
    for (const cls of classes) knownNames.add(cls.name);
  }

  // Pass 2: full extraction with relationship pruning
  const allClasses: ExtractedClass[] = [];
  const allRelationships: ExtractedRelationship[] = [];
  const allWarnings: string[] = [];
  const allWarningNodes = new Set<string>();

  for (const fn of extractors) {
    const { classes, relationships, warnings = [], warningNodes } = fn(knownNames);
    allClasses.push(...classes);
    allRelationships.push(...relationships);
    allWarnings.push(...warnings);
    if (warningNodes) {
      for (const n of warningNodes) allWarningNodes.add(n);
    }
  }

  return {
    classes: allClasses,
    relationships: allRelationships,
    warnings: allWarnings,
    warningNodes: allWarningNodes,
  };
};
