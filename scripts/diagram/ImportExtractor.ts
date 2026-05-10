// =============================================================================
// scripts/diagram/ImportExtractor.ts — Extract imported names from import statements
// =============================================================================

/**
 * Extract imported names from a raw import statement.
 *
 * Examples:
 *   "import { Foo, Bar } from './path'"  → ["Foo", "Bar"]
 *   "import Foo from './path'"            → ["Foo"]
 *   "import * as Foo from './path'"       → ["*Foo"]
 */
export const extractImportedNames = (
  content: string,
  importPath: string,
): string[] => {
  const lines = content.split("\n");
  const importLine = lines.find(
    (line) =>
      line.includes(`from '${importPath}'`) ||
      line.includes(`from "${importPath}"`),
  );

  if (!importLine) return [];

  // Match named imports: { Foo, Bar, Baz }
  const namedMatch = importLine.match(/\{([^}]+)\}/);
  if (namedMatch) {
    return namedMatch[1]
      .split(",")
      .map((n) =>
        n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
      )
      .filter(Boolean);
  }

  // Match default import: Foo
  const defaultMatch = importLine.match(/import\s+(\w+)\s+from/);
  if (defaultMatch) {
    return [defaultMatch[1]];
  }

  // Match namespace import: * as Foo
  const namespaceMatch = importLine.match(/import\s+\*\s+as\s+(\w+)/);
  if (namespaceMatch) {
    return [`*${namespaceMatch[1]}`];
  }

  return [];
};
