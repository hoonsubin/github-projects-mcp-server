// =============================================================================
// src/adapters/capabilities.test.ts - CapabilityStatus, getCapabilities, checkCapability
// =============================================================================

import { assertEquals, assertThrows } from "@std/assert";
import {
  CapabilityStatus,
  CapabilityUnavailableError,
  checkCapability,
  getCapabilities,
  type PlatformCapabilities,
} from "./capabilities.ts";

const makeCap = (status: CapabilityStatus): PlatformCapabilities => ({
  platform: "test",
  supports: {
    auditLogBurndown: status,
    nativeSprints: status,
    dependencies: status,
    fileReader: status,
    stableItemKeys: status,
  },
});

// ── getCapabilities ───────────────────────────────────────────────────────────

Deno.test("getCapabilities returns the supports map directly - no separate sync needed", () => {
  const cap = makeCap(CapabilityStatus.NATIVE);
  assertEquals(getCapabilities(cap), cap.supports);
});

Deno.test("getCapabilities reflects status updates immediately", () => {
  const cap: PlatformCapabilities = {
    platform: "test",
    supports: {
      auditLogBurndown: CapabilityStatus.NATIVE,
      nativeSprints: CapabilityStatus.EMULATED,
      dependencies: CapabilityStatus.UNAVAILABLE,
      fileReader: CapabilityStatus.NATIVE,
      stableItemKeys: CapabilityStatus.EMULATED,
    },
  };
  const map = getCapabilities(cap);
  assertEquals(map.auditLogBurndown, CapabilityStatus.NATIVE);
  assertEquals(map.nativeSprints, CapabilityStatus.EMULATED);
  assertEquals(map.dependencies, CapabilityStatus.UNAVAILABLE);
});

// ── checkCapability - NATIVE ──────────────────────────────────────────────────

Deno.test("checkCapability NATIVE: no warning, no throw", () => {
  const cap = makeCap(CapabilityStatus.NATIVE);
  const warnings: string[] = [];
  checkCapability(cap, "auditLogBurndown", warnings);
  checkCapability(cap, "nativeSprints", warnings);
  checkCapability(cap, "dependencies", warnings);
  assertEquals(warnings.length, 0);
});

// ── checkCapability - EMULATED ────────────────────────────────────────────────

Deno.test("checkCapability EMULATED: appends a warning, does not throw", () => {
  const cap = makeCap(CapabilityStatus.EMULATED);
  const warnings: string[] = [];
  checkCapability(cap, "auditLogBurndown", warnings);
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].includes("emulated"), true);
});

Deno.test("checkCapability EMULATED: warning includes platform and operation name", () => {
  const cap = makeCap(CapabilityStatus.EMULATED);
  const warnings: string[] = [];
  checkCapability(cap, "nativeSprints", warnings);
  assertEquals(warnings[0].includes("test"), true);
  assertEquals(warnings[0].includes("nativeSprints"), true);
});

Deno.test("checkCapability EMULATED: each call appends its own warning", () => {
  const cap = makeCap(CapabilityStatus.EMULATED);
  const warnings: string[] = [];
  checkCapability(cap, "dependencies", warnings);
  checkCapability(cap, "fileReader", warnings);
  assertEquals(warnings.length, 2);
});

// ── checkCapability - UNAVAILABLE ─────────────────────────────────────────────

Deno.test("checkCapability UNAVAILABLE: throws CapabilityUnavailableError", () => {
  const cap = makeCap(CapabilityStatus.UNAVAILABLE);
  const warnings: string[] = [];
  assertThrows(
    () => checkCapability(cap, "dependencies", warnings),
    CapabilityUnavailableError,
  );
});

Deno.test("checkCapability UNAVAILABLE: no warning appended before throw", () => {
  const cap = makeCap(CapabilityStatus.UNAVAILABLE);
  const warnings: string[] = [];
  try {
    checkCapability(cap, "fileReader", warnings);
  } catch {
    // expected
  }
  assertEquals(warnings.length, 0);
});

// ── CapabilityUnavailableError ────────────────────────────────────────────────

Deno.test("CapabilityUnavailableError has recoverySuggestion", () => {
  const err = new CapabilityUnavailableError("myplatform", "doSomething");
  assertEquals(typeof err.recoverySuggestion, "string");
  assertEquals(err.recoverySuggestion.length > 0, true);
  assertEquals(err.platform, "myplatform");
  assertEquals(err.operation, "doSomething");
});

Deno.test("CapabilityUnavailableError accepts custom recoverySuggestion", () => {
  const err = new CapabilityUnavailableError("p", "op", "Try using adapter X instead.");
  assertEquals(err.recoverySuggestion, "Try using adapter X instead.");
});

Deno.test("CapabilityUnavailableError message contains platform and operation", () => {
  const err = new CapabilityUnavailableError("github", "burndown");
  assertEquals(err.message.includes("github"), true);
  assertEquals(err.message.includes("burndown"), true);
});
