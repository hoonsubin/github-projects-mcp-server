// =============================================================================
// scripts/generate-project-diagram.ts - Generate class diagram from TypeScript exports
//
// Scans .ts files in /src, extracts exports with type info via TS Compiler API,
// detects dependencies, and outputs a Mermaid class diagram as Markdown.
// =============================================================================

// ── Imports: diagram utilities ─────────────────────────────────────────────────
import * as path from "@std/path";
import type { UnusedExport } from "./diagram/types.ts";
import {
  ClassDiagramGenerator,
  type ClassDiagramOptions,
} from "./diagram/ClassDiagramGenerator.ts";
import * as helper from "./diagram/helpers.ts";
import { ParsedModule } from "./diagram/ParsedModule.ts";
// ── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_OUTPUT_DIR = "./docs/";
const DEFAULT_ROOT_DIR = "./src";
const DEFAULT_EXCLUSIONS = ["**/generated/**", "graphql/**", "**/*test.ts"];
// ── CLI ────────────────────────────────────────────────────────────────────────
const printHelp = (): void => {
  console.log(`
Usage: deno run -A scripts/generate-project-diagram.ts [options]

Options:
  --outputDir, -o <path>     Output folder path (default: ./docs/)
  --src <path>            Source directory to scan (default: ./src)
  --include-external      Include external imports (npm:, jsr:, @std/*)
  --help, -h              Show this help message

Output:
  Generates a project state report based on class relationships.
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
  let output = DEFAULT_OUTPUT_DIR;
  let src = DEFAULT_ROOT_DIR;
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
        includeExternal = false;
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

class GeneratedArtifact {
  constructor(private content: string, private nameExt: string, private saveDir: string) {
  }

  async saveArtifact() {
    try {
      await Deno.writeTextFile(path.join(this.saveDir, this.nameExt), this.content);
    } catch (err) {
      console.error(err);
    }
  }
}

const isExcluded = (relPath: string, patterns: string[]): boolean => {
  // Check if any path segment is an excluded directory (handles **/dir/** matching "foo/bar/dir")
  const segments = relPath.split("/");
  const hasExcludedDir = patterns.some((p) => {
    const regexCheck = p.match(/^(\*\*\/)?([^*]+)(\/\*\*)?$/);
    return regexCheck && segments.includes(regexCheck[2]);
  });
  if (hasExcludedDir) return true;

  // Convert glob to regex: ** → .* (any depth), * → [^/]* (single segment)
  // Use a unique placeholder string so ** is replaced before *
  const placeholder = "__GLOBSTAR__";
  return patterns.some((p) => {
    const regexStr = "^" +
      p
        .replace(/\*\*/g, placeholder)
        .replace(/\*/g, "[^/]*")
        .replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), ".*") +
      "$";
    const re = new RegExp(regexStr);
    return re.test(relPath);
  });
};

const scanModules = async (
  srcDir: string,
  includeExternal: boolean,
): Promise<ParsedModule[]> => {
  const modules: ParsedModule[] = [];
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
            const currentMod = new ParsedModule(full, content, includeExternal);
            modules.push(currentMod);
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

const generateMarkdownReport = (
  unusedExports: UnusedExport[],
  outputDir: string,
): string => {
  let unusedExportsSection = "";
  if (unusedExports.length > 0) {
    const unusedRows = unusedExports
      .map(
        (i) =>
          `| [\`${i.modulePathName}\`](${
            path.relative(path.dirname(outputDir), i.modulePathName)
          }) | \`${i.name}\` | \`${i.kind}\` |`,
      )
      .join("\n");

    unusedExportsSection = `
## Unused Exports

The following exports are never directly imported by other modules in the codebase:

| Module | Export | Kind |
|---|---|---|
${unusedRows}
`;
  }

  return `# Current Structure Report

Generated by [generate-project-diagram.ts](../scripts/generate-project-diagram.ts)

This diagram shows the class structure of the codebase, with each module as a class containing its exported symbols, and relationships showing import dependencies.

---

## Module Overview

\`\`\`mermaid

\`\`\`

${unusedExportsSection}

## Notes

- Each class represents a TypeScript module
- Members are the exported symbols with their types
- Relationships show which modules import which
- Test files are excluded by default
- Generated code and GraphQL operations are excluded
- External imports (npm:, jsr:, @std/*) are filtered out

---

*Auto-generated - do not edit manually*
`;
};

const wrapMermaidBlock = (diagramString: string) => {
  return `
\`\`\`mermaid
${diagramString}
\`\`\`
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
  const unusedExports = helper.findUnusedExports(modules);
  console.log(`Found ${unusedExports.length} unused exports`);

  console.log("Generating diagram...");
  const moduleImportDiagram = wrapMermaidBlock(generateDiagram(modules, unusedExports));
  // todo: save generate diagrams as a separate .mermaid file.

  console.log("Generating report...");
  const mdReportBody = generateMarkdownReport(unusedExports, args.output);

  const outputDir = args.output.split("/").slice(0, -1).join("/");
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    /* exists */
    console.log(outputDir, " already exists. Skipping folder creation...");
  }

  const reportObj = new GeneratedArtifact(mdReportBody, "report.md", args.output);
  const moduleDiagramObj = new GeneratedArtifact(
    moduleImportDiagram,
    "module-imports.mermaid",
    args.output,
  );

  await reportObj.saveArtifact();
  await moduleDiagramObj.saveArtifact();
  console.log(`Saved to ${args.output}`);
};

main().catch((err) => {
  console.error("Failed:", err.message);
  Deno.exit(1);
});
