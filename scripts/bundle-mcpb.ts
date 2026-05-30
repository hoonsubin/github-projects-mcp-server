// =============================================================================
// scripts/bundle-mcpb.ts
//
// Packages dist/server.mjs as a .mcpb (MCP Bundle) for one-click installation
// in Claude Desktop and any other MCP-compatible host that supports the format.
//
// Prerequisites:
//   - dist/server.mjs must already exist  (run `deno task bundle:node` first)
//   - npm must be available on PATH        (present on all GitHub runners and
//     most developer machines with Node.js installed)
//
// Environment:
//   RELEASE_VERSION  Semver string baked into bundle/manifest.json
//                    (default: "dev")
//
// Output: dist/scrum-master-toolkit.mcpb
//
// Usage:
//   deno task bundle:mcpb
//   RELEASE_VERSION=1.2.3 deno task bundle:mcpb
// =============================================================================

import { resolve } from "@std/path";

const root = Deno.cwd();
const version = Deno.env.get("RELEASE_VERSION") ?? "dev";

const bundleDir = resolve(root, "bundle");
const distDir = resolve(root, "dist");
const serverMjs = resolve(distDir, "server.mjs");
const serverEntry = resolve(bundleDir, "server", "index.js");
const manifestPath = resolve(bundleDir, "manifest.json");
const outputName = "scrum-master-toolkit.mcpb";

console.error(`[bundle-mcpb] packaging version ${version} ...`);

// ── Ensure dist/server.mjs exists ───────────────────────────────────────────

try {
  await Deno.stat(serverMjs);
} catch {
  console.error(
    "[bundle-mcpb] error: dist/server.mjs not found - run 'deno task bundle:node' first.",
  );
  Deno.exit(1);
}

// ── Install mcpb CLI ─────────────────────────────────────────────────────────

console.error("[bundle-mcpb] installing @anthropic-ai/mcpb ...");
const install = new Deno.Command("npm", {
  args: ["install", "-g", "@anthropic-ai/mcpb"],
  stdout: "inherit",
  stderr: "inherit",
});
const { success: installOk } = await install.output();
if (!installOk) {
  console.error("[bundle-mcpb] error: npm install failed.");
  Deno.exit(1);
}

// ── Patch version into manifest.json ────────────────────────────────────────

const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
manifest.version = version;
await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.error(`[bundle-mcpb] manifest.json patched → version ${version}`);

// ── Stage the server entry point ─────────────────────────────────────────────

await Deno.mkdir(resolve(bundleDir, "server"), { recursive: true });
await Deno.copyFile(serverMjs, serverEntry);
console.error("[bundle-mcpb] staged dist/server.mjs → bundle/server/index.js");

// ── Run mcpb pack ────────────────────────────────────────────────────────────

const pack = new Deno.Command("mcpb", {
  args: ["pack"],
  cwd: bundleDir,
  stdout: "inherit",
  stderr: "inherit",
});
const { success: packOk } = await pack.output();
if (!packOk) {
  console.error("[bundle-mcpb] error: mcpb pack failed.");
  Deno.exit(1);
}

// ── Move output to dist/ ─────────────────────────────────────────────────────

// mcpb pack names the output after the directory it was run in, not the
// manifest name field - so the actual file on disk is always "bundle.mcpb".
const packed = resolve(bundleDir, "bundle.mcpb");
const dest = resolve(distDir, outputName);
await Deno.rename(packed, dest);
console.error(`[bundle-mcpb] moved → dist/${outputName}`);

// ── Report output size ───────────────────────────────────────────────────────

const stat = await Deno.stat(dest);
const kb = (stat.size / 1024).toFixed(1);
console.error(`[bundle-mcpb] done → dist/${outputName} (${kb} KB)`);
