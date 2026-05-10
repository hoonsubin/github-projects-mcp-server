// =============================================================================
// scripts/generate-project-diagram.ts — Generate class diagram from TypeScript exports
//
// Scans .ts files in /src, extracts exports with type info via TS Compiler API,
// detects dependencies, and outputs a Mermaid class diagram as Markdown.
// =============================================================================

// ── Imports: diagram utilities ─────────────────────────────────────────────────
import { type ExportInfo, ExportParser } from "./diagram/ExportParser.ts";
import { DependencyGraph, type UnusedExport } from "./diagram/DependencyGraph.ts";
import {
  ClassDiagramGenerator,
  type ClassDiagramOptions,
} from "./diagram/ClassDiagramGenerator.ts";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ParsedModule {
  path: string; // Relative to src/, e.g., "tools/scrum-read.ts"
  imports: string[]; // Raw import paths (relative only)
  exports: ExportInfo[]; // Extracted exports with type info
  content?: string; // Raw content for import extraction
}

// ── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_EXCLUSIONS = ["generated/**", "graphql/**", "**/*_test.ts"];

// ── CLI ────────────────────────────────────────────────────────────────────────
const printHelp = (): void => {
  console.log(`
Usage: deno run -A scripts/generate-project-diagram.ts [options]

Options:
  --output, -o <path>     Output file path (default: ./docs/proj-diagram.md)
  --src <path>            Source directory to scan (default: ./src)
  --include-external      Include external imports (npm:, jsr:, @std/*)
  --help, -h              Show this help message

Output:
  Generates a Mermaid class diagram showing module dependencies and exports.
  Each module is represented as a class with its exported symbols.
  Unused exports are detected and reported.
`);
};

const parseArgs = (): {
  output: string;
  src: string;
  includeExternal: boolean;
  help: boolean;
} => {
  const args = Deno.args;
  let output = "./docs/proj-diagram.md";
  let src = "./src";
  let includeExternal = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--output":
      case "-o":
        output = args[++i] ?? output;
        break;
      case "--src":
        src = args[++i] ?? src;
        break;
      case "--include-external":
        includeExternal = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { output, src, includeExternal, help };
};

// ── Scanner ────────────────────────────────────────────────────────────────────
const isExcluded = (path: string, patterns: string[]): boolean =>
  patterns.some((p) => {
    const re = new RegExp(
      "^" +
        p
          .replace(/\*\*/g, "[/]?[^/]*")
          .replace(/\*/g, "[^/]*") +
        "$",
    );
    return re.test(path);
  });

const scanModules = async (
  srcDir: string,
  includeExternal: boolean,
): Promise<ParsedModule[]> => {
  const modules: ParsedModule[] = [];
  const exportParser = new ExportParser();

  const walk = async (dir: string, rel: string): Promise<void> => {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const full = `${dir}/${entry.name}`;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          if (!isExcluded(relPath, DEFAULT_EXCLUSIONS)) {
            await walk(full, relPath);
          }
        } else if (entry.isFile && entry.name.endsWith(".ts")) {
          if (!isExcluded(relPath, DEFAULT_EXCLUSIONS)) {
            const content = await Deno.readTextFile(full);
            const imports = parseImportPaths(content).filter(
              (p) =>
                p.startsWith("./") ||
                p.startsWith("../") ||
                includeExternal,
            );
            const exports = exportParser.parse(content, full);
            modules.push({ path: relPath, imports, exports, content });
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error reading ${dir}:`, msg);
    }
  };

  await walk(srcDir, "");
  return modules;
};

const parseImportPaths = (content: string): string[] => {
  const paths: string[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) paths.push(m[1]);
  return paths;
};

// ── Diagram Generator ──────────────────────────────────────────────────────────
const generateDiagram = (
  modules: ParsedModule[],
  unusedExports: UnusedExport[],
): string => {
  const options: ClassDiagramOptions = {
    showUnusedExports: true,
    showDependencyArrows: true,
  };

  const diagram = new ClassDiagramGenerator(
    modules,
    unusedExports,
    options,
  ).generate();

  return diagram;
};

const generateMarkdown = (
  modules: ParsedModule[],
  unusedExports: UnusedExport[],
): string => {
  const diagram = generateDiagram(modules, unusedExports);

  let unusedExportsSection = "";
  if (unusedExports.length > 0) {
    const unusedRows = unusedExports
      .map(
        (e) => `| ${e.modulePath} | \`${e.exportName}\` | \`${e.exportKind}\` |`,
      )
      .join("\n");

    unusedExportsSection = `
## Unused Exports

The following exports are never imported by any other module in the codebase:

| Module | Export | Kind |
|--------|--------|------|
${unusedRows}
`;
  }

  return `# GitHub Projects MCP Server — Module Dependency Diagram

Generated by [generate-project-diagram.ts](../scripts/generate-project-diagram.ts)

This diagram shows the class structure of the codebase, with each module as a class containing its exported symbols, and relationships showing import dependencies.

---

## Module Overview

\`\`\`mermaid
${diagram}
\`\`\`

${unusedExportsSection}

## Legend

| Symbol | Meaning |
|--------|---------|
| \`<<Class>>\` | Exported class |
| \`<<Interface>>\` | Exported interface |
| \`<<Enum>>\` | Exported enum |
| \`<<Function>>\` | Exported function |
| \`+type name\` | Exported variable with type |
| \`-->\` | Import dependency |

## Notes

- Each class represents a TypeScript module
- Members are the exported symbols with their types
- Relationships show which modules import which
- Test files are excluded by default
- Generated code and GraphQL operations are excluded
- External imports (npm:, jsr:, @std/*) are filtered out

---

*Auto-generated — do not edit manually*
`;
};

// ── Main ───────────────────────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  console.log(`Scanning ${args.src}...`);
  const modules = await scanModules(args.src, args.includeExternal);
  console.log(`Found ${modules.length} modules`);

  console.log("Building dependency graph...");
  const depGraph = new DependencyGraph(modules);
  const unusedExports = depGraph.findUnusedExports();
  console.log(`Found ${unusedExports.length} unused exports`);

  console.log("Generating diagram...");
  const markdown = generateMarkdown(modules, unusedExports);

  const outputDir = args.output.split("/").slice(0, -1).join("/");
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    /* exists */
  }

  await Deno.writeTextFile(args.output, markdown);
  console.log(`Saved to ${args.output}`);
};

main().catch((err) => {
  console.error("Failed:", err.message);
  Deno.exit(1);
});
