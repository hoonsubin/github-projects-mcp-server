/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Rule 1: Domain must not depend on anything else in src/ ──────────
    {
      name: "domain-must-not-depend-on-inner-layers",
      comment: "src/domain/ is the innermost layer. It must not import from scrum, " +
        "adapters, tools, schemas, services, or server.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/(scrum|adapters|tools|schemas|services|server\\.ts)" },
    },

    // ── Rule 2: Use-case must not depend on adapters or outer layers ─────
    {
      name: "use-case-must-not-depend-on-adapters",
      comment: "src/scrum/ (use-cases) must not import adapters, tools, schemas, " +
        "or server. Only domain, std lib, and same-layer imports are allowed.",
      severity: "error",
      from: { path: "^src/scrum/", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/(adapters|tools|schemas|server\\.ts)" },
    },

    // ── Rule 3: Services must not depend on adapters or outer layers ─────
    {
      name: "services-must-not-depend-on-adapters",
      comment: "src/services/ (framework utilities) must not import adapters, " +
        "tools, schemas, or server.",
      severity: "error",
      from: { path: "^src/services/" },
      to: { path: "^src/(adapters|tools|schemas|server\\.ts)" },
    },

    // ── Rule 4: Adapters must not depend on tools, schemas, or server ────
    {
      name: "adapters-must-not-depend-on-tools-schemas-server",
      comment: "src/adapters/ must not import tools, schemas, or server. " +
        "They may import domain, scrum/ports, and services.",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/(tools|schemas|server\\.ts)" },
    },

    // ── Rule 5: Tools must not depend on adapters ───────────────────────
    {
      name: "tools-must-not-depend-on-adapters",
      comment: "src/tools/ (framework handlers) must not import adapters directly " +
        "— they use use-cases which depend on the port interface. Test files may " +
        "import adapters for fixture replay bridge tests.",
      severity: "error",
      from: { path: "^src/tools/", pathNot: "\\.test\\.ts$" },
      to: { path: "^src/adapters/" },
    },

    // ── Rule 6: Schemas must not depend on use-case, adapter, or peer layers ──
    {
      name: "schemas-must-not-depend-on-src",
      comment: "src/schemas/ is the framework validation layer. " +
        "It may depend on Zod and domain vocabulary (inward), " +
        "but NOT on use-case, adapter, services, or server layers.",
      severity: "error",
      from: { path: "^src/schemas/" },
      to: { path: "^src/(scrum|adapters|tools|services|server\\.ts)" },
      // domain is intentionally excluded — depending inward on the innermost
      // (most stable) layer is architecturally correct per the Dependency Rule.
    },

    // ── Rule 7: No circular dependencies ─────────────────────────────────
    {
      name: "no-circular-dependencies",
      comment: "Circular dependencies cause coupling and fragility. " +
        "Break cycles via DIP or extraction.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // ── Rule 7b: owner-graphql and response types stay acyclic leaves ─────
    {
      name: "owner-graphql-no-query-builder",
      comment: "owner-graphql.ts must not depend on project-items-query-builder " +
        "(types live in project-items-response-types.ts).",
      severity: "error",
      from: { path: "^src/adapters/github/internal/owner-graphql\\.ts$" },
      to: { path: "project-items-query-builder" },
    },
    {
      name: "project-items-response-types-is-leaf",
      comment: "Response type shapes must not import query or execution layers.",
      severity: "error",
      from: { path: "^src/adapters/github/internal/project-items-response-types\\.ts$" },
      to: {
        path:
          "^src/adapters/github/internal/(owner-graphql|project-items-query-builder|pagination|assemblers)/",
      },
    },
    {
      name: "platform-request-is-leaf",
      comment: "PlatformRequest must not depend on assembler pipeline types.",
      severity: "error",
      from: { path: "^src/adapters/github/internal/platform-request\\.ts$" },
      to: { path: "^src/adapters/github/internal/assemblers/" },
    },

    // ── Rule 8: No console.log in src/ ───────────────────────────────────
    {
      name: "no-console-log",
      comment: "console.log pollutes MCP stdio transport. " +
        "Use log.* from src/services/logger.ts instead.",
      severity: "error",
      from: { path: "^src/" },
      to: { dependencyTypes: ["core"], path: "console" },
    },
  ],

  options: {
    // Parse TypeScript imports without requiring compilation
    tsPreCompilationDeps: true,

    // Don't follow external dependencies
    doNotFollow: {
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },

    // Exclude generated files, fixtures, snapshots
    exclude: {
      path: [
        "node_modules",
        "src/adapters/github/generated/",
        "src/test/tools/__snapshots__/",
        "dist/",
      ],
    },

    // Only scan src/ directory
    includeOnly: "^src/",

    // Module system: Deno uses ESM with .ts extensions
    moduleSystems: ["es6", "cjs"],

    // Enhanced resolution for MCP SDK .js imports
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default"],
    },

    preserveSymlinks: false,
  },
};
