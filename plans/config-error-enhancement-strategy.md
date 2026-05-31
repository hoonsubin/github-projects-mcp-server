# Config-Load Error Handling Enhancement Strategy

**Date:** 2026-05-31\
**Status:** Updated after sanity check — 3 structural improvements added\
**Based on:** Complete dataflow analysis from [`src/server.ts`](../src/server.ts) → [`src/scrum/resolve-location.ts`](../src/scrum/resolve-location.ts) → [`src/scrum/config-boot.ts`](../src/scrum/config-boot.ts) → [`src/scrum/fetch-location.ts`](../src/scrum/fetch-location.ts) → [`src/adapters/factory.ts`](../src/adapters/factory.ts) → [`src/adapters/github/factory.ts`](../src/adapters/github/factory.ts) → [`src/adapters/github/bootstrap.ts`](../src/adapters/github/bootstrap.ts) → [`src/adapters/github/internal/http-client.ts`](../src/adapters/github/internal/http-client.ts)

---

## 1. Situation Assessment

### What's working well

- **Structured error classes in the adapter layer:** `GitHubApiError` ([`src/adapters/github/errors.ts`](../src/adapters/github/errors.ts)) is well-designed — every throw site declares `code`, `recovery`, and optional `context`/`graphqlErrors`. Each recovery text is actionable (token generation links, field names, reset times).
- **Domain error base class:** `AdapterError` ([`src/domain/errors.ts`](../src/domain/errors.ts):26-37) provides a clean abstract base that all platform adapters extend, meeting the Dependency Rule (interface lives in the domain layer, implementations in adapters).
- **Degraded mode:** The server doesn't crash on config errors — it registers stub tools returning the error text ([`src/server.ts:246-254`](../src/server.ts:246)). This is architecturally sound: an MCP server that fails to initialize can still respond to `tools/list` and return meaningful error text on each call.
- **`catchBackend` for partial failures:** Non-fatal adapter errors during tool calls are captured as warnings ([`src/services/error-enrichment.ts:54-69`](../src/services/error-enrichment.ts:54)), allowing the agent to see partial data alongside structured warnings.

### What's wrong

**Problem A — Layer contract asymmetry (P1):** The use-case layer throws raw `Error` while the adapter layer throws structured `GitHubApiError`. `ConfigError` ([`src/domain/errors.ts:40-50`](../src/domain/errors.ts:40)) lives in the domain layer and is available to use-case code, but is only used at 1 of 9 throw sites.

**Problem B — Catch filter is too narrow (P0):** The degraded-mode handler at [`src/server.ts:285`](../src/server.ts:285) checks `err instanceof AdapterError && err.code === "AUTH_FAILED"` — discarding rich recovery hints from all other `GitHubApiError` codes (`NOT_FOUND`, `FIELD_NOT_CONFIGURED`, `OPTION_NOT_FOUND`, `PERMISSION_DENIED`, `RATE_LIMITED`, `HTTP_ERROR`).

**Problem C — Generic fallback is misleading (P0):** The fallback text `"Config not found or invalid at: ..."` is emitted when the `ConfigError` and `AdapterError(AUTH_FAILED)` branches both miss. It is factually incorrect for YAML parse failures, missing configuration sections, field-not-found errors, project-not-found errors, and rate-limiting — none of which are "config not found or invalid."

**Problem D — Message/recovery duplication in ConfigError (P1):** The HTML_CONTENT throw at [`src/scrum/config-boot.ts:63-67`](../src/scrum/config-boot.ts:63) passes the same string as both `message` and `recovery`, producing verbatim duplicates in the rendered output.

**Problem E — Error codes are not a single source of truth (P2):** `GitHubErrorCode` is a string union in [`src/adapters/github/errors.ts:14-33`](../src/adapters/github/errors.ts:14). The use-case layer's `ConfigError` uses arbitrary strings with no shared type. The `HTML_CONTENT` code is never referenced by its literal string elsewhere — it's a magic string.

**Problem F — Extension validation scope confusion (P2):** The `SUPPORTED_TEMPLATE_EXTENSIONS` constant is used for both config files AND template paths, but `.md` and `.json` are only valid for templates, not config.

**Problem G — resolveLocation() outside try/catch (P2):** [`src/server.ts:131-134`](../src/server.ts:131) runs `resolveLocation()` at module top-level _before_ the `createMcpServer()` try/catch at line 280. If it throws (unsupported extension, invalid URL), the error never reaches `registerStubTools()` — it crashes the server via `emitJsonRpcError()` + `Deno.exit(1)` instead of entering degraded mode.

**Problem H — enrichError() missing ConfigError handling (P1):** [`src/services/error-enrichment.ts:26-34`](../src/services/error-enrichment.ts:26) renders `[CODE] message → Recovery: ...` for `AdapterError` but treats `ConfigError` as a generic `Error: message`, losing its structured code and recovery fields.

### Architectural constraints (non-negotiables)

1. `console.log` is FORBIDDEN — MCP stdio transport. All output via [`logger.ts`](../src/services/logger.ts) to stderr.
2. `ConfigError` already lives in the domain layer — use-case code can import it without violating the Dependency Rule.
3. The catch block at `server.ts:280-298` must not crash — degraded mode is deliberate.
4. No new dependencies. The `ConfigError` class already exists; we extend its usage, not its interface.

---

## 2. Enhancement Strategy — Phased Plan

### Phase 0: Fix structural defects (P0 items)

**Goal:** Stop misleading the user. Estimated effort: ~25 min.

| Step | File                                        | Change                                                                                                                                       | Risk                                                      |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0.1  | [`src/server.ts:285`](../src/server.ts:285) | Change `err instanceof AdapterError && err.code === "AUTH_FAILED"` to `err instanceof AdapterError` (all codes). Use `err.recovery` for all. | Low — the `recovery` field is mandatory on `AdapterError` |
| 0.2  | [`src/server.ts:291`](../src/server.ts:291) | Change generic hint to account for "file was found but unparseable" — remove "config not found" language.                                    | Low                                                       |

### Phase 1: Extend structured error usage (P1 items + structural gaps)

**Goal:** Make all errors self-documenting; fix structural gaps. Estimated effort: ~55 min.

| Step | File                                                                               | Change                                                                                                                             | Risk                                                 |
| ---- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1.1  | [`src/scrum/config-boot.ts:41`](../src/scrum/config-boot.ts:41)                    | Convert `fetchContent` error wrap from `Error` to `ConfigError` with code `"FETCH_FAILED"`                                         | Low — callers catch `ConfigError`                    |
| 1.2  | [`src/scrum/config-boot.ts:74`](../src/scrum/config-boot.ts:74)                    | Convert YAML parse error from `Error` to `ConfigError` with code `"YAML_PARSE_ERROR"`                                              | Low                                                  |
| 1.3  | [`src/scrum/config-boot.ts:80-86`](../src/scrum/config-boot.ts:80-86)              | Convert missing-section errors from `Error` to `ConfigError` with code `"MISSING_SECTION"` + key name in context                   | Low                                                  |
| 1.4  | [`src/scrum/config-boot.ts:63-67`](../src/scrum/config-boot.ts:63-67)              | Fix `message` vs `recovery` duplication — message describes the problem, recovery says what to do                                  | Low                                                  |
| 1.5  | [`src/scrum/resolve-location.ts:51,62`](../src/scrum/resolve-location.ts:51,62)    | Convert extension errors from `Error` to `ConfigError` with code `"UNSUPPORTED_EXTENSION"`                                         | Low                                                  |
| 1.6  | [`src/scrum/fetch-location.ts:43,51`](../src/scrum/fetch-location.ts:43,51)        | Convert fetch errors from `Error` to `ConfigError` with codes `"NETWORK_ERROR"` / `"HTTP_ERROR"`                                   | Low                                                  |
| 1.7  | [`src/adapters/factory.ts:109`](../src/adapters/factory.ts:109)                    | Convert `UNKNOWN_PLATFORM` from `Error` to `ConfigError` with code `"UNKNOWN_PLATFORM"`                                            | Low — adapter layer can import domain types          |
| 1.8  | [`src/server.ts:131-134`](../src/server.ts:131-134)                                | Move `resolveLocation()` call inside `createMcpServer()` try/catch so unsupported-extension errors enter degraded mode             | Low — no functional change to resolveLocation itself |
| 1.9  | [`src/services/error-enrichment.ts:26-34`](../src/services/error-enrichment.ts:26) | Add `ConfigError` branch to `enrichError()` — render `[CODE] message\n\n→ Recovery: ...` (mirrors existing `AdapterError` pattern) | Low                                                  |

### Phase 2: Introduce error code taxonomy (P2 items)

**Goal:** Replace magic strings with a shared type union. Estimated effort: ~15 min.

| Step | File                                                      | Change                                                                | Risk                  |
| ---- | --------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| 2.1  | [`src/domain/errors.ts`](../src/domain/errors.ts)         | Add `UseCaseErrorCode` type union with all codes use-case code throws | Low — additive change |
| 2.2  | [`src/scrum/config-boot.ts`](../src/scrum/config-boot.ts) | Import and use `UseCaseErrorCode` type for `ConfigError.code`         | Low                   |

### Phase 3: Extension split and recovery polish (P2 items)

**Goal:** Improve message precision. Estimated effort: ~15 min.

| Step | File                                                                                                    | Change                                                                                                                        | Risk                                         |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 3.1  | [`src/scrum/resolve-location.ts:19`](../src/scrum/resolve-location.ts:19)                               | Split `SUPPORTED_CONFIG_EXTENSIONS` from `SUPPORTED_TEMPLATE_EXTENSIONS`                                                      | Low — only the config main call site changes |
| 3.2  | [`src/scrum/config-boot.ts:45`](../src/scrum/config-boot.ts:45)                                         | Conditionalize file-not-found advice: if absolute path, suggest checking path; if relative, suggest `--config` / project root | Low                                          |
| 3.3  | [`src/adapters/github/internal/http-client.ts:127`](../src/adapters/github/internal/http-client.ts:127) | Make 401 recovery text env-var-name agnostic                                                                                  | Low                                          |
| 3.4  | [`src/adapters/github/bootstrap.ts:332`](../src/adapters/github/bootstrap.ts:332)                       | Add `owner_type` clarification to NOT_FOUND recovery text                                                                     | Low                                          |

---

## 3. Error code taxonomy (proposed)

### UseCaseErrorCode (new — `src/domain/errors.ts`)

```typescript
export type UseCaseErrorCode =
  | "FETCH_FAILED" // Config content unreadable (network or file I/O)
  | "HTTP_ERROR" // Non-2xx response from config URL fetch
  | "HTML_CONTENT" // URL returned HTML instead of raw YAML
  | "YAML_PARSE_ERROR" // Config YAML could not be parsed
  | "MISSING_SECTION" // Config is missing a required top-level key
  | "UNSUPPORTED_EXTENSION" // File/URL has an extension outside the allowed set
  | "UNKNOWN_PLATFORM"; // SCRUM_PLATFORM does not match any registered factory
```

### ConfigError enhancements (existing class — `src/domain/errors.ts`)

```typescript
export class ConfigError extends Error {
  readonly code: UseCaseErrorCode; // ← changed from string to typed union
  readonly recovery: string;
  // ... rest unchanged
}
```

### GitHubErrorCode (existing — `src/adapters/github/errors.ts`)

No change needed. Already well-typed as a union.

---

## 4. Catch handler logic after all changes

```typescript
// src/server.ts — the consolidated catch block after Phases 0-1
} catch (err) {
  let hint: string;

  if (err instanceof AdapterError) {
    // ALL AdapterError codes — every throw site carries recovery
    hint = err.recovery;
  } else if (err instanceof ConfigError) {
    // Use-case layer errors now carry structured recovery
    hint = err.recovery;
  } else {
    // Truly unknown — print what we know
    hint = `Server initialization failed: ${
      err instanceof Error ? err.message : String(err)
    }.`;
  }

  registerStubTools(
    server,
    `${hint}\nOriginal error: ${err instanceof Error ? err.message : String(err)}`,
  );
  return server;
}
```

The key change: **no** `code === "AUTH_FAILED"` gate. Every `AdapterError` carries `recovery` — use it.

### enrichError() after Phase 1.9

```typescript
export const enrichError = (err: unknown): string => {
  if (err instanceof AdapterError) {
    const detail = err.context ? `\nDetails: ${JSON.stringify(err.context)}` : "";
    return `[${err.code}] ${err.message}${detail}\n\n→ Recovery: ${err.recovery}`;
  }
  if (err instanceof ConfigError) {
    // ← NEW: handle ConfigError with same structured format
    return `[${err.code}] ${err.message}\n\n→ Recovery: ${err.recovery}`;
  }
  return err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;
};
```

---

## 5. Architecture diagram (before vs after)

### Before — Error class usage

```
Use-Case Layer (src/scrum/)              Adapter Layer (src/adapters/github/)
┌──────────────────────────────┐        ┌──────────────────────────────────┐
│  throw new Error("...")      │  8×    │  throw new GitHubApiError(...)   │  structured
│  throw new ConfigError(...)  │  1×    │    code + recovery + context     │
└──────────────┬───────────────┘        └────────────┬─────────────────────┘
               │                                     │
               ▼                                     ▼
         Catch block (server.ts:280)
         ┌──────────────────────────────────────┐
         │  if (AdapterError && AUTH_FAILED) →  │ uses recovery
         │  if (ConfigError)                →  │ uses recovery
         │  else                            →  │ "Config not found..." ← MISLEADING
         └──────────────────────────────────────┘

enrichError() ─→ only handles AdapterError
resolveLocation() ─→ runs BEFORE try/catch at top level ← crashes server
```

### After — Error class usage

```
Use-Case Layer (src/scrum/)              Adapter Layer (src/adapters/github/)
┌──────────────────────────────┐        ┌──────────────────────────────────┐
│  throw new ConfigError(...)  │  9×    │  throw new GitHubApiError(...)   │  structured
│    code: UseCaseErrorCode    │        │    code + recovery + context     │
│    recovery: string          │        └────────────┬─────────────────────┘
└──────────────┬───────────────┘                     │
               │                                     │
               ▼                                     ▼
         Catch block (server.ts:280)
         ┌──────────────────────────────────────┐
         │  if (AdapterError)               →  │ uses recovery ← ALL codes
         │  if (ConfigError)                →  │ uses recovery ← ALL sites
         │  else                            →  │ precise fallback ← FIXED
         └──────────────────────────────────────┘

enrichError() ─→ handles AdapterError + ConfigError
resolveLocation() ─→ INSIDE try/catch ← degraded mode
```

---

## 6. Implementation todo list

### Phase 0 — Fix structural defects (P0)

- [ ] 0.1 Expand AdapterError catch to all codes ([server.ts:285](../src/server.ts:285))
- [ ] 0.2 Fix generic fallback text ([server.ts:291](../src/server.ts:291))

### Phase 1 — Extend structured error usage (P1 + gaps)

- [ ] 1.1 Convert fetchContent error to ConfigError FETCH_FAILED ([config-boot.ts:41](../src/scrum/config-boot.ts:41))
- [ ] 1.2 Convert YAML parse error to ConfigError YAML_PARSE_ERROR ([config-boot.ts:74](../src/scrum/config-boot.ts:74))
- [ ] 1.3 Convert missing-section errors to ConfigError MISSING_SECTION ([config-boot.ts:80-86](../src/scrum/config-boot.ts:80))
- [ ] 1.4 Fix HTML_CONTENT message/recovery duplication ([config-boot.ts:63-67](../src/scrum/config-boot.ts:63))
- [ ] 1.5 Convert extension errors to ConfigError UNSUPPORTED_EXTENSION ([resolve-location.ts:51,62](../src/scrum/resolve-location.ts:51))
- [ ] 1.6 Convert fetch errors to ConfigError ([fetch-location.ts:43,51](../src/scrum/fetch-location.ts:43))
- [ ] 1.7 Convert UNKNOWN_PLATFORM to ConfigError ([factory.ts:109](../src/adapters/factory.ts:109))
- [ ] 1.8 Move resolveLocation() inside createMcpServer() try/catch ([server.ts:131-134](../src/server.ts:131))
- [ ] 1.9 Add ConfigError branch to enrichError() ([error-enrichment.ts:26](../src/services/error-enrichment.ts:26))

### Phase 2 — Error code taxonomy

- [ ] 2.1 Add UseCaseErrorCode type union ([domain/errors.ts](../src/domain/errors.ts))
- [ ] 2.2 Type ConfigError.code with UseCaseErrorCode

### Phase 3 — Polish

- [ ] 3.1 Split extension constants ([resolve-location.ts](../src/scrum/resolve-location.ts))
- [ ] 3.2 Conditionalize file-not-found advice ([config-boot.ts:45](../src/scrum/config-boot.ts:45))
- [ ] 3.3 Generalize 401 recovery text ([http-client.ts:127](../src/adapters/github/internal/http-client.ts:127))
- [ ] 3.4 Add owner_type clarification ([bootstrap.ts:332](../src/adapters/github/bootstrap.ts:332))

---

## 7. Sanity check results

A sequential-thinking analysis was performed to verify no cascading errors from non-config-load throw sites. Three structural improvements were discovered beyond the original analysis:

### Improvement A — resolveLocation() gap (added as Step 1.8)

`resolveLocation()` at server.ts:131-134 runs at module top-level, BEFORE the `createMcpServer()` try/catch at line 280. If it throws (unsupported extension), the error propagates to the transport-level catch (`runStdio`/`runHttp`) which calls `emitJsonRpcError()` + `Deno.exit(1)`. This means extension-validity errors never enter degraded mode.

**Fix:** Move the `resolveLocation()` call inside `createMcpServer()` so both config-resolution and config-load errors share the same degraded-mode catch.

### Improvement B — enrichError() gap (added as Step 1.9)

`enrichError()` in [`error-enrichment.ts:26-34`](../src/services/error-enrichment.ts:26) only handles `AdapterError`. If a Phase-1 `ConfigError` leaks into a tool handler during a tool call (not startup), `enrichError()` renders it as a generic `"Error: message"` — losing the structured `code` and `recovery` fields.

**Fix:** Add `err instanceof ConfigError` branch that renders `[CODE] message\n\n→ Recovery: ...` — mirrors the existing `AdapterError` pattern.

### Improvement C — factory.ts UNKNOWN_PLATFORM (added as Step 1.7)

`createBackend()` in [`factory.ts:109`](../src/adapters/factory.ts:109) throws raw `Error` for unknown platforms. Since `factory.ts` is in the adapter layer and `ConfigError` is in the domain layer, and the Dependency Rule permits outer→inner imports, this can become `ConfigError` with code `"UNKNOWN_PLATFORM"`.

**Fix:** Convert to `ConfigError("UNKNOWN_PLATFORM", recovery)` — matches the Phase-1 pattern.

### Verification: no cascade risk

The degraded-mode catch at `server.ts:280` wraps ONLY `loadScrumConfig()` + `createBackend()`. Runtime tool-call errors flow through `patchToolLogging()` and `catchBackend()` — completely separate paths. Expanding the `instanceof AdapterError` check to all codes (Stage 0.1) cannot cause runtime tool errors to enter degraded mode by accident.

---

## 8. Risks and mitigations

| Risk                                                                          | Likelihood | Mitigation                                                                                                                |
| ----------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 changes alter error behavior at server startup                        | Low        | All paths covered by existing test suite (`resolve-location.test.ts`, config-boot tested via server.ts integration)       |
| New `UseCaseErrorCode` values not matching every throw site                   | Low        | The type union is an additive constraint — all current strings are valid; no existing code breaks                         |
| `registerStubTools` output format changes                                     | Low        | Stub tools return `{ content: [{ type: "text", text: msg }] }` — only the text content changes                            |
| Catch handler drops `err.message` for some `GitHubApiError` codes             | Low        | Proposed code prepends `Original error: ${err.message}` — always visible                                                  |
| Moving `resolveLocation()` into `createMcpServer()` changes module init order | Low        | `resolveLocation()` is a pure function with no side effects — safe to defer                                               |
| `enrichError()` catches `ConfigError` before it can reach `catchBackend`      | None       | `enrichError()` is for fatal paths; `catchBackend()` is for partial-failure paths — they are mutually exclusive by caller |
