import { assertEquals } from "@std/assert";
import { DEFAULT_FIXTURES_DIR, loadFixtureManifest } from "./load-manifest.ts";

Deno.test("loadFixtureManifest — accepts version 2 manifest", async () => {
  const manifest = await loadFixtureManifest(DEFAULT_FIXTURES_DIR);
  assertEquals(manifest.version, 2);
});
