// =============================================================================
// src/_deno-shim.node.ts
//
// Deno API shim for the Node.js bundle (dist/server.mjs).
// Injected by esbuild via scripts/bundle-node.ts - do NOT import this file
// directly; it only makes sense as an esbuild inject.
//
// Every Deno.* call used across the project is mapped to its Node.js
// equivalent. Deno.serve is bridged through @hono/node-server, which the MCP
// SDK already declares as a direct dependency and which handles SSE streaming
// (required by the Streamable HTTP transport) correctly.
//
// Node.js version requirement: 18+ (Web globals: Request, Response, Headers,
// crypto, ReadableStream).
// =============================================================================

import process from "node:process";
import { readFile } from "node:fs/promises";
import { serve as honoServe } from "@hono/node-server";

// ── addEventListener ───────────────────────────────────────────────────────
// `addEventListener` is a browser/Deno global that does not exist in Node.js.
// esbuild (platform: "node") leaves it as a free variable; this export is
// what the inject resolves it to.
//
// Only "unhandledrejection" is used by the project (crash guard in server.ts).
// The handler signature matches PromiseRejectionEvent: it receives an object
// with a `reason` property and a `preventDefault()` no-op.
//
// Node.js fires "unhandledRejection" on `process`, not on `globalThis`, so
// we bridge the two here.
export function addEventListener(
  type: string,
  handler: (event: { reason: unknown; preventDefault: () => void }) => void,
): void {
  if (type === "unhandledrejection") {
    process.on("unhandledRejection", (reason: unknown) => {
      handler({ reason, preventDefault: () => {} });
    });
  }
  // Other event types are silently ignored - none are used in this project.
}

export const Deno = {
  // ── CLI args ───────────────────────────────────────────────────────────────
  // Captured at module init - equivalent to Deno.args which is also static.
  args: process.argv.slice(2),

  // ── Environment variables ──────────────────────────────────────────────────
  env: {
    get: (key: string): string | undefined => process.env[key],
  },

  // ── Process lifecycle ──────────────────────────────────────────────────────
  exit: (code?: number): never => process.exit(code) as never,

  // ── Working directory ──────────────────────────────────────────────────────
  cwd: (): string => process.cwd(),

  // ── Stdout (synchronous) ───────────────────────────────────────────────────
  // Used by emitJsonRpcError as a last-resort write when the MCP server cannot
  // initialise. process.stdout.write is synchronous when writing to a pipe,
  // which is exactly the stdio MCP transport scenario.
  stdout: {
    writeSync: (data: Uint8Array): void => {
      process.stdout.write(data);
    },
  },

  // ── File reading ───────────────────────────────────────────────────────────
  // Used by GitHubFileReader and config-loader to read YAML config and
  // item-type template files from the local filesystem.
  readTextFile: (path: string | URL): Promise<string> =>
    readFile(path instanceof URL ? path.pathname : path, "utf-8"),

  // ── Error types ────────────────────────────────────────────────────────────
  // PermissionDenied is caught in the runtime permission guard in server.ts.
  // It will never be thrown when running under Node.js (the guard exists only
  // to produce a helpful message when someone runs the Deno source without the
  // required --allow-env flag). The class must exist to satisfy the instanceof
  // check; it is effectively dead code in the Node.js bundle.
  errors: {
    PermissionDenied: class PermissionDenied extends Error {
      constructor(msg?: string) {
        super(msg);
        this.name = "PermissionDenied";
      }
    },
  },

  // ── HTTP server ────────────────────────────────────────────────────────────
  // Bridges the Web Standard Request/Response interface expected by
  // WebStandardStreamableHTTPServerTransport to Node.js's http module.
  // @hono/node-server is the same adapter the MCP SDK uses internally for its
  // own Node.js transport wrapper, so the SSE streaming behaviour is identical.
  serve: (
    options: { port?: number; hostname?: string },
    handler: (req: Request) => Response | Promise<Response>,
  ): void => {
    const port = options.port ?? 3000;
    honoServe({ fetch: handler, port });
  },
};
