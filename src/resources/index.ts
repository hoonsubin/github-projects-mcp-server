// =============================================================================
// src/resources/index.ts
// MCP Resources — stable, human-authored context the agent reads before acting.
//
// Resources registered here:
//   scrum://config                 — merged scrum.config.yml + project-board.config.json
//   scrum://sprint/current         — sprint goal, capacity, out-of-band decisions
//   scrum://sprint/archive/{n}     — historical sprint docs
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { loadScrumConfig } from "../services/scrum.ts";
import { formatError } from "../services/github.ts";

export const registerScrumResources = (server: McpServer): void => {
  // ── scrum://config ──────────────────────────────────────────────────────────
  //
  // Returns the fully merged configuration as JSON — field name → ID mappings,
  // status taxonomy, DoR, DoD, autonomy level, team, sprint settings, and all
  // GitHub-synced board state from project-board.config.json.
  //
  // Read this at the start of any sprint operation to resolve project coordinates
  // (owner, project_number) and to get the _fields_registry for field ID lookup.

  server.registerResource(
    "scrum-config",
    "scrum://config",
    {
      description:
        "Merged SCRUM configuration: field name → GitHub node ID mappings, status taxonomy, " +
        "DoR, DoD, autonomy level, team, sprint settings, and live board state. " +
        "Read before any sprint operation to get project coordinates and resolve field IDs.",
      mimeType: "application/json",
    },
    async (_uri) => {
      try {
        const config = await loadScrumConfig();
        return {
          contents: [
            {
              uri: "scrum://config",
              mimeType: "application/json",
              text: JSON.stringify(config, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          contents: [
            {
              uri: "scrum://config",
              mimeType: "text/plain",
              text: formatError(err),
            },
          ],
        };
      }
    },
  );

  // ── scrum://sprint/current ──────────────────────────────────────────────────
  //
  // Human-authored sprint doc (config/sprint-current.md). Contains the sprint
  // goal, capacity plan, committed items narrative, and any out-of-band decisions
  // made at sprint kick-off that are not captured in the GitHub board.
  //
  // Read before standup, sprint review, or any "how are we doing" query to
  // understand the intent behind the live board state.

  server.registerResource(
    "sprint-current",
    "scrum://sprint/current",
    {
      description:
        "Human-authored sprint goal, capacity plan, team commitments, and out-of-band " +
        "decisions for the current sprint. Read before standup or sprint review to " +
        "understand the intent behind the live board state.",
      mimeType: "text/markdown",
    },
    async (_uri) => {
      try {
        const text = await Deno.readTextFile("./config/sprint-current.md");
        return {
          contents: [
            { uri: "scrum://sprint/current", mimeType: "text/markdown", text },
          ],
        };
      } catch (_err) {
        return {
          contents: [
            {
              uri: "scrum://sprint/current",
              mimeType: "text/markdown",
              text:
                "_(sprint-current.md not found — create `config/sprint-current.md` to document " +
                "the sprint goal, capacity plan, and out-of-band decisions)_",
            },
          ],
        };
      }
    },
  );

  // ── scrum://sprint/archive/{n} ──────────────────────────────────────────────
  //
  // Historical sprint docs. The Scrum Master archives sprint-current.md to
  // config/sprint-archive-{n}.md after each sprint close. The agent reads these
  // when writing velocity commentary or retrospective context.

  const archiveTemplate = new ResourceTemplate("scrum://sprint/archive/{n}", {
    list: undefined,
  });

  server.registerResource(
    "sprint-archive",
    archiveTemplate,
    {
      description:
        "Historical sprint doc for sprint number {n}. " +
        "Backed by config/sprint-archive-{n}.md. " +
        "Used for velocity commentary and retrospective reference.",
      mimeType: "text/markdown",
    },
    async (_uri: URL, variables: Variables, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      const n = Array.isArray(variables.n) ? variables.n[0] : variables.n;
      const uri = `scrum://sprint/archive/${n}`;
      try {
        const text = await Deno.readTextFile(`./config/sprint-archive-${n}.md`);
        return { contents: [{ uri, mimeType: "text/markdown", text }] };
      } catch (_err) {
        return {
          contents: [
            {
              uri,
              mimeType: "text/markdown",
              text: `_(config/sprint-archive-${n}.md not found)_`,
            },
          ],
        };
      }
    },
  );
};
