# Plan: Remove Silent Config Fallback — Make `--config` Mandatory

> **TypeScript-engineering reassessment.** Original plan at v1 missed the [`ConfigReloader`](src/adapters/github/internal/config-reloader.ts:19) cascade — this revision captures every affected site.

---

## Problem

Two layers of silent fallback mask missing config files:

1. **Server level** ([`src/server.ts:117-121`](src/server.ts:117-121)): `_configLocation` is `ContentLocation | undefined` — `undefined` when no `--config` or `SCRUM_CONFIG_PATH` is set.
2. **Adapter level** ([`src/adapters/github/config-loader.ts:360-363`](src/adapters/github/config-loader.ts:360-363)): `params.configLocation ?? { kind: "file", path: resolve(Deno.cwd(), ".github/scrum/config.yml") }`.

When that default path doesn't exist, the error is caught in [`server.ts:262-277`](src/server.ts:262-277) and the server starts in **degraded mode** with stub tools — a silent failure where every tool call returns the same error instead of crashing at startup.

## Type-System Analysis

**Smell:** This is a **T4 (lying function signature)** cascade. `_configLocation: ContentLocation | undefined` propagates through three function signatures (`createMcpServer`, `runStdio`, `runHttp`) that all treat `undefined` as a valid input, pushing the "what if absent?" question to the adapter layer. The adapter then applies a hidden fallback (`??`), making the runtime behavior differ from what the type suggests.

**Fix:** Make illegal state unrepresentable. `_configLocation` becomes `ContentLocation` (never `undefined`). The question "where is the config?" is answered exactly once, at the CLI boundary, with a hard exit if unanswered.

---

## Complete Change Inventory (11 sites, 6 files)

### ⚠️ CRITICAL: ConfigReloader Cascade

The [`ConfigReloader.reload()`](src/adapters/github/internal/config-reloader.ts:19) method calls `loadConfig({ github: this.github })` **without** `configLocation`. This is the wake-up call missed by the original plan — removing the `??` fallback from `loadConfig` breaks this path silently.

**Fix:** `ConfigReloader` must store and forward the original `configLocation`.

---

### Site 1 — `src/server.ts:114-121` (CLI parsing → early exit)

```diff
- const _rawConfigPath: string | undefined =
-   _cliArgs.config || Deno.env.get("SCRUM_CONFIG_PATH") || undefined;
- const _configLocation: ContentLocation | undefined = _rawConfigPath
-   ? resolveLocation(_rawConfigPath, resolvePath(Deno.cwd()))
-   : undefined;
+ const _rawConfigPath: string | undefined =
+   _cliArgs.config || Deno.env.get("SCRUM_CONFIG_PATH");
+
+ if (!_rawConfigPath) {
+   console.error(
+     "Error: no config file specified.\n" +
+       "Pass --config <path-or-url> when starting the server, " +
+       "or set the SCRUM_CONFIG_PATH environment variable.\n" +
+       "Example: mcp-server --config .github/scrum/config.yml",
+   );
+   Deno.exit(1);
+ }
+
+ const _configLocation: ContentLocation = resolveLocation(
+   _rawConfigPath,
+   resolvePath(Deno.cwd()),
+ );
```

Type change: `ContentLocation | undefined` → `ContentLocation`.

---

### Site 2 — `src/server.ts:78-87` (help text)

```diff
-   --config, -c <path>  Path or URL to the scrum config YAML.
+   --config, -c <path>  Path or URL to the scrum config YAML (required).
                         Accepts a local path (relative or absolute) or an
                         https:// URL to a remote config file.
-                        (default: .github/scrum/config.yml)
```

---

### Site 3 — `src/server.ts:245-247` (createMcpServer signature)

```diff
  const createMcpServer = async (
-   configLocation?: ContentLocation,
+   configLocation: ContentLocation,
  ): Promise<McpServer> => {
```

No runtime change needed — `configLocation` was always passed (just sometimes `undefined`).

---

### Site 4 — `src/server.ts:262-277` (error handling branches)

```diff
  try {
    backendResult = await createBackend(factories, { configLocation });
  } catch (err) {
    let hint: string;
    if (err instanceof AdapterError && err.code === "AUTH_FAILED") {
      hint =
        `Backend authentication failed - check that the platform token (e.g. GITHUB_TOKEN) is set and valid.`;
-   } else if (configLocation) {
+   } else {
      hint = `Config not found or invalid at: ${describeContentLocation(configLocation)}`;
-   } else {
-     hint = `Config not found at default path: .github/scrum/config.yml`;
    }
    const errorMessage = `${hint}\n` +
-     `Pass --config <path-or-url> when starting the server.\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`;
    registerStubTools(server, errorMessage);
    log.warn("Server started in degraded mode.", { hint });
    return server;
  }
```

The two dead branches (`else if (configLocation)` / `else`) collapse into one `else`. `--config` hint line removed (user already provided one).

---

### Site 5 — `src/server.ts:339-341` (runStdio signature)

```diff
  const runStdio = async (
-   configLocation?: ContentLocation,
+   configLocation: ContentLocation,
  ): Promise<void> => {
```

---

### Site 6 — `src/server.ts:366` (runHttp signature)

```diff
- const runHttp = (configLocation?: ContentLocation): void => {
+ const runHttp = (configLocation: ContentLocation): void => {
```

---

### Site 7 — `src/adapters/factory.ts:18-23` (AdapterStartupOptions)

```diff
  export interface AdapterStartupOptions {
    /**
     * Where to load the scrum config from.
-    * undefined → adapter uses its default: { kind: "file", path: ".github/scrum/config.yml" }
+    * Always provided by the server composition root.
     */
-   readonly configLocation?: ContentLocation;
+   readonly configLocation: ContentLocation;
  }
```

---

### Site 8 — `src/adapters/github/config-loader.ts:72-77` (ConfigParams)

```diff
  interface ConfigParams {
    github: GitHubClient;
-   /** Where to load the config from. Defaults to { kind: "file", path: ".github/scrum/config.yml" }. */
-   configLocation?: ContentLocation;
+   /** Where to load the config from. Always provided by the caller. */
+   configLocation: ContentLocation;
  }
```

---

### Site 9 — `src/adapters/github/config-loader.ts:360-363` (loadConfig body)

```diff
-   const configLocation: ContentLocation = params.configLocation ?? {
-     kind: "file",
-     path: resolve(Deno.cwd(), ".github/scrum/config.yml"),
-   };
+   const { configLocation } = params;
```

The `ContentLocation` is destructured directly; no fallback.

---

### Site 10 — `src/adapters/github/internal/config-reloader.ts:12-19`

```diff
  export class ConfigReloader {
    constructor(
      private readonly config: RuntimeConfig,
      private readonly github: GitHubClient,
+     private readonly configLocation: ContentLocation,
    ) {}

    async reload(): Promise<void> {
-     const fresh = await loadConfig({ github: this.github });
+     const fresh = await loadConfig({ github: this.github, configLocation: this.configLocation });
```

Must import `ContentLocation` from `../../domain/content-location.ts`.

---

### Site 11 — `src/adapters/github/factory.ts:119` (ConfigReloader construction)

```diff
-   const configReloader = new ConfigReloader(config, ghClient);
+   const configReloader = new ConfigReloader(config, ghClient, {
+     kind: "file" as const,
+     path: config.scrumConfig._configSource, // or reconstruct from options
+   });
```

**⚠️ Open question:** How does `ConfigReloader` know the original config location? The `RuntimeConfig` does not currently store `configLocation`. Two approaches:

**Option A (minimal):** Store the original `configLocation` on `RuntimeConfig` (add a `configLocation: ContentLocation` field). The reloader reads it from there.

**Option B (parameter):** Pass it through `ConfigReloader` constructor (Site 10). The factory already has `options?.configLocation` at construction time.

**Recommendation:** Option B — simpler, no type change to `RuntimeConfig`. The factory at [`factory.ts:48`](src/adapters/github/factory.ts:48) already has `options?.configLocation` (now required), so passing it to `ConfigReloader` is one line.

---

## What Stays (NOT dead code)

| Code                               | Reason                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| `registerStubTools()`              | Still needed for `AUTH_FAILED` degraded mode                                        |
| `SCRUM_CONFIG_PATH` env var        | Still supported; now mandatory (no fallback)                                        |
| `try/catch` around `createBackend` | Still needed for AUTH_FAILED and other adapter errors                               |
| `resolve-location.test.ts`         | Test data uses `.github/scrum/config.yml` as an example relative path — still valid |
| `bundle/manifest.json`             | Already marks `config_path` as `"required": true`                                   |

## Documentation Debt (out of scope, noted)

| File                   | Location          | Issue                                                                      |
| ---------------------- | ----------------- | -------------------------------------------------------------------------- |
| `README.md`            | line 117          | "Defaults to `.github/scrum/config.yml` relative to the working directory" |
| `tasks/REFACTORING.md` | §9.5 (line ~830+) | Describes the old default behavior                                         |
| `tasks/TODO.md`        | line 434          | JSDoc excerpt with old default                                             |

---

## Type Surface Reduction

| Before                                          | After                               |
| ----------------------------------------------- | ----------------------------------- |
| `_configLocation: ContentLocation \| undefined` | `ContentLocation`                   |
| 3 function params `configLocation?:`            | 3 function params `configLocation:` |
| 1 `??` fallback + 1 `else` branch               | 0 (eliminated)                      |
| `AdapterStartupOptions.configLocation?:`        | `configLocation:` (required)        |
| `ConfigParams.configLocation?:`                 | `configLocation:` (required)        |

**Net effect:** 5 optional types become required; 2 dead branches removed; 1 hidden default eliminated. The type system now accurately reflects that config is mandatory — not merely preferred.

---

## Diagram

```
Before (silent fallback):
  No --config / no SCRUM_CONFIG_PATH
        │
        ▼
  _configLocation = undefined
        │
        ▼
  createBackend({ configLocation: undefined })
        │
        ▼
  loadConfig → defaults to .github/scrum/config.yml
        │
        ▼
  File not found → caught → stub tools (silent failure)

After (hard crash):
  No --config / no SCRUM_CONFIG_PATH
        │
        ▼
  if (!_rawConfigPath) → console.error() + Deno.exit(1)
        │
        ▼
  Server exits immediately — never starts MCP transport
```
