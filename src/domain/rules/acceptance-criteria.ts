// =============================================================================
// src/domain/rules/acceptance-criteria.ts — Pure domain rule: AC parsing
//
// Extracted from scrum-read.ts as part of Story B (Phase 5).
// This module has no imports outside the standard library.
// =============================================================================

/** Parsed acceptance criterion from markdown checkbox syntax. */
interface AcceptanceCriterion {
  text: string;
  checked: boolean;
}

/**
 * Parse markdown checkboxes from a story body into acceptance criteria.
 * Matches patterns: `- [ ]`, `- [x]`, `- [X]`, `* [ ]`, `* [x]`, `* [X]`.
 */
export const parseAcceptanceCriteria = (body: string): AcceptanceCriterion[] => {
  const ac: AcceptanceCriterion[] = [];
  const checkboxRe = /^[ \t]*-[ \t]+\[([ xX])\][ \t]+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = checkboxRe.exec(body)) !== null) {
    ac.push({ checked: match[1].trim() !== "", text: match[2].trim() });
  }
  return ac;
};
