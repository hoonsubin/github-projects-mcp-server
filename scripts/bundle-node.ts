// =============================================================================
// scripts/bundle-node.ts
//
// Bundles the MCP server as a self-contained Node.js ESM module.
//
// Output:  dist/server.mjs
// Runtime: Node.js 18+  (no Deno required)
//
// What the bundle contains:
//   - All project source (src/)
//   - All Deno stdlib deps (jsr:@std/*) — inlined by esbuild-deno-loader
//   - All npm deps (@modelcontextprotocol/sdk, graphql, zod, etc.) — inlined
//   - src/_deno-shim.node.ts injected as a global Deno replacement
//
// What stays external (resolved at runtime by Node.js):
//   - node:* built-ins (fs, path, http, net, process, …)
//
// Usage:
//   deno task bundle:node          # produces dist/server.mjs
//   node dist/server.mjs [options] # run on any Node.js 18+ host
// =============================================================================

import * as esbuild from "esbuild";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11";
import { resolve } from "@std/path";

const root = Deno.cwd();
const configPath = resolve(root, "deno.json");
const shimPath = resolve(root, "src/_deno-shim.node.ts");
const outfile = resolve(root, "dist/server.mjs");

console.error("[bundle-node] building dist/server.mjs ...");

const result = await esbuild.build({
  entryPoints: ["src/server.ts"],

  // ── Module resolution ──────────────────────────────────────────────────────
  // denoPlugins handles jsr:, npm:, and deno.json import map entries.
  // It must be the first plugin so it intercepts all specifiers before any
  // other plugins run.
  plugins: [...denoPlugins({ configPath })] as esbuild.Plugin[],

  // ── Bundle settings ────────────────────────────────────────────────────────
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node18"],
  outfile,

  // Keep all node:* built-ins external — Node.js resolves them at runtime.
  // Do NOT add npm packages here; they should be inlined for a zero-dependency
  // distributable.
  external: ["node:*"],

  // ── Deno API shim ──────────────────────────────────────────────────────────
  // Injects _deno-shim.node.ts into every module in the bundle. esbuild
  // treats the file's named exports as globals, so any reference to `Deno`
  // in the source resolves to the injected Node.js-compatible implementation.
  inject: [shimPath],

  // ── Output settings ────────────────────────────────────────────────────────
  // Inline sourcemap keeps stack traces readable without a separate .map file.
  sourcemap: "inline",

  // Minify syntax (dead-code elimination, constant folding) but leave
  // identifiers and whitespace intact so stack traces stay human-readable.
  // Switch minify: true for the smallest possible distributable.
  minifyIdentifiers: false,
  minifySyntax: true,
  minifyWhitespace: false,

  logLevel: "warning",
});

if (result.errors.length > 0) {
  console.error("[bundle-node] errors:", result.errors);
  Deno.exit(1);
}

// Report output size so it's easy to compare against the compiled binary.
const stat = await Deno.stat(outfile);
const kb = (stat.size / 1024).toFixed(1);
console.error(`[bundle-node] done → dist/server.mjs (${kb} KB)`);

await esbuild.stop();
