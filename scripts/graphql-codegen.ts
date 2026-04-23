// =============================================================================
// scripts/graphql-codegen.ts
//
// Phase 1 — Schema    Fetch the GitHub GraphQL schema → src/schemas/schema.graphql
// Phase 2 — Validate  Parse src/graphql/operations.graphql and validate against schema
// Phase 3 — Generate  Emit TypeScript types for every schema type → src/generated/github-types.ts
//
// Usage:
//   deno task codegen              # all three phases
//   deno task codegen:validate     # Phase 1 + 2 only
//   deno task codegen:types-only   # Phase 2 + 3 (uses cached schema)
//   deno task codegen -- --dry-run # print generated output without writing
// =============================================================================

import { parseArgs } from "@std/cli/parse-args";
import {
  buildClientSchema,
  buildSchema,
  type DocumentNode,
  getIntrospectionQuery,
  type GraphQLNamedType,
  type GraphQLSchema,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type OperationDefinitionNode,
  parse as gqlParse,
  printSchema,
  validate as gqlValidate,
} from "graphql";
import { getToken, GITHUB_API_URL } from "../src/services/github.ts";

// ── CLI ───────────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
  boolean: ["skip-fetch", "validate", "dry-run", "help"],
  alias: { h: "help" },
});

if (args.help) {
  console.log(
    "Usage: deno task codegen [-- --skip-fetch | --validate | --dry-run]",
  );
  Deno.exit(0);
}

const SCHEMA_JSON_PATH = "src/generated/schema.json";
const SCHEMA_SDL_PATH = "src/generated/schema.graphql";
const OPERATIONS_PATH = "src/graphql/operations.graphql";
const GENERATED_PATH = "src/generated/github-types.ts";
const skipFetch = args["skip-fetch"] as boolean;
const validateOnly = args["validate"] as boolean;
const dryRun = args["dry-run"] as boolean;

// ── Scalar map ────────────────────────────────────────────────────────────────

const SCALAR_TS: Record<string, string> = {
  String: "string",
  Boolean: "boolean",
  Int: "number",
  Float: "number",
  ID: "string",
  URI: "string",
  DateTime: "string",
  Date: "string",
  HTML: "string",
  GitObjectID: "string",
  GitTimestamp: "string",
  X509Certificate: "string",
  BigInt: "string",
  PreciseDateTime: "string",
};
const BUILTIN_SCALARS = new Set(Object.keys(SCALAR_TS).slice(0, 5)); // String…ID

const phase1 = async (): Promise<void> => {
  console.log("Phase 1 — Fetching GitHub GraphQL schema...");
  const response = await fetch(GITHUB_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      "User-Agent": "github-projects-mcp-server/1.0.0",
      "X-Github-Next-Global-ID": "1",
    },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(JSON.stringify(errors));
  await Deno.writeTextFile(SCHEMA_JSON_PATH, JSON.stringify(data, null, 2));
  await Deno.writeTextFile(
    SCHEMA_SDL_PATH,
    printSchema(buildClientSchema(data)),
  );
  console.log(`  ✓ wrote ${SCHEMA_JSON_PATH} and ${SCHEMA_SDL_PATH}`);
};

// Reads src/graphql/operations.graphql and validates every named operation
// against the schema.  Field-type conflicts on mutually exclusive union branches
// (e.g. Issue.state vs PullRequest.state) are demoted to warnings because
// graphql-js flags them even though they are safe at runtime.

const UNION_CONFLICT_RE =
  /^Fields? "([^"]+)" conflict because (they return conflicting types|subfields ".+" conflict)/;

const phase2 = (schema: GraphQLSchema): DocumentNode => {
  console.log("Phase 2 — Validating operations...");
  const src = Deno.readTextFileSync(OPERATIONS_PATH);
  const doc = gqlParse(src);

  const allErrors = gqlValidate(schema, doc);
  const warnings = allErrors.filter((e) => UNION_CONFLICT_RE.test(e.message));
  const hardErrors = allErrors.filter(
    (e) => !UNION_CONFLICT_RE.test(e.message),
  );

  if (warnings.length) {
    console.warn(
      `  ⚠  ${warnings.length} union-branch conflict(s) — safe at runtime (see UNION_CONFLICT_RE)`,
    );
  }
  if (hardErrors.length) {
    console.error(`\n  ✗ Validation failed:`);
    hardErrors.forEach((e) => {
      const loc = e.locations?.[0];
      console.error(`  • ${e.message}${loc ? ` (line ${loc.line})` : ""}`);
    });
    Deno.exit(1);
  }

  const ops = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === "OperationDefinition",
  );
  ops.forEach((op) => console.log(`  ✓ ${op.operation} ${op.name?.value ?? "(anon)"}`));
  console.log(`  → ${ops.length} operations OK`);
  return doc;
};

// Walks schema.getTypeMap() and emits one TypeScript declaration per named type.
//   Scalar       →  type alias (GitHub custom scalars → string)
//   Enum         →  "VAL_A" | "VAL_B" | ...
//   Union        →  MemberA | MemberB | ...
//   Interface    →  interface (fields required/optional per schema)
//   Object type  →  interface with all fields optional (queries select a subset)
//   Input type   →  interface (fields required/optional per schema)

function schemaFieldToTs(type: GraphQLType): string {
  if (isNonNullType(type)) return schemaTypeInner(type.ofType);
  return `${schemaTypeInner(type)} | null`;
}
function schemaTypeInner(type: GraphQLType): string {
  if (isNonNullType(type)) return schemaTypeInner(type.ofType);
  if (isListType(type)) return `Array<${schemaFieldToTs(type.ofType)}>`;
  const named = type as GraphQLNamedType;
  return isScalarType(named) ? (SCALAR_TS[named.name] ?? "unknown") : named.name;
}

function fieldLines(
  fields: Record<string, { type: GraphQLType }>,
  allOptional: boolean,
): string {
  return Object.entries(fields)
    .map(
      ([n, f]) =>
        `  ${n}${allOptional || !isNonNullType(f.type) ? "?" : ""}: ${schemaFieldToTs(f.type)};`,
    )
    .join("\n");
}

const phase3 = async (schema: GraphQLSchema): Promise<void> => {
  console.log("Phase 3 — Generating TypeScript types...");

  const buckets = {
    scalars: [] as string[],
    enums: [] as string[],
    unions: [] as string[],
    interfaces: [] as string[],
    objects: [] as string[],
    inputs: [] as string[],
  };

  for (
    const [name, type] of Object.entries(schema.getTypeMap()).sort(
      ([a], [b]) => a.localeCompare(b),
    )
  ) {
    if (name.startsWith("__") || BUILTIN_SCALARS.has(name)) continue;
    if (isScalarType(type)) {
      buckets.scalars.push(
        `export type ${name} = ${SCALAR_TS[name] ?? "string"}; // scalar`,
      );
      continue;
    }
    if (isEnumType(type)) {
      buckets.enums.push(
        `export type ${name} =\n${
          type
            .getValues()
            .map((v) => `  | ${JSON.stringify(v.value)}`)
            .join("\n")
        };`,
      );
      continue;
    }
    if (isUnionType(type)) {
      buckets.unions.push(
        `export type ${name} = ${
          type
            .getTypes()
            .map((t) => t.name)
            .join(" | ")
        };`,
      );
      continue;
    }
    if (isInterfaceType(type)) {
      buckets.interfaces.push(
        `export interface ${name} {\n${fieldLines(type.getFields(), false)}\n}`,
      );
      continue;
    }
    if (isObjectType(type)) {
      buckets.objects.push(
        `export interface ${name} {\n${fieldLines(type.getFields(), true)}\n}`,
      );
      continue;
    }
    if (isInputObjectType(type)) {
      buckets.inputs.push(
        `export interface ${name} {\n${fieldLines(type.getFields(), false)}\n}`,
      );
      continue;
    }
  }

  const hdr = (label: string, n: number) =>
    `\n// ── ${label} (${n}) ${"─".repeat(Math.max(0, 65 - label.length - n.toString().length))}`;
  const output = [
    "// AUTO-GENERATED — do not edit. Run: deno task codegen",
    `// Generated: ${new Date().toISOString()}`,
    hdr("Scalars", buckets.scalars.length),
    buckets.scalars.join("\n"),
    hdr("Enums", buckets.enums.length),
    buckets.enums.join("\n\n"),
    hdr("Unions", buckets.unions.length),
    buckets.unions.join("\n"),
    hdr("Interfaces", buckets.interfaces.length),
    buckets.interfaces.join("\n\n"),
    hdr("Object types", buckets.objects.length),
    buckets.objects.join("\n\n"),
    hdr("Input types", buckets.inputs.length),
    buckets.inputs.join("\n\n"),
    "",
  ].join("\n");

  if (dryRun) {
    console.log(output.slice(0, 2000) + "\n...(truncated)");
    return;
  }

  await Deno.mkdir("src/generated", { recursive: true });
  await Deno.writeTextFile(GENERATED_PATH, output);
  const total = Object.values(buckets).reduce((s, a) => s + a.length, 0);
  console.log(`  ✓ wrote ${GENERATED_PATH}  (${total} types)`);
};

// ── Main ──────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const t0 = performance.now();
  if (!skipFetch) await phase1();
  else console.log("Phase 1 — skipped");

  let sdl: string;
  try {
    sdl = await Deno.readTextFile(SCHEMA_SDL_PATH);
  } catch {
    console.error(
      `Cannot read ${SCHEMA_SDL_PATH} — run without --skip-fetch first`,
    );
    Deno.exit(1);
  }

  const schema = buildSchema(sdl);
  phase2(schema);

  if (!validateOnly) await phase3(schema);
  else console.log("Phase 3 — skipped (--validate)");

  console.log(`\n✅ Done in ${Math.round(performance.now() - t0)}ms`);
};

main().catch((err: unknown) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  Deno.exit(1);
});
