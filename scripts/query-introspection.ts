import { getIntrospectionQuery, buildClientSchema, printSchema } from "graphql";
import { GITHUB_API_URL, getToken } from "../src/services/github.ts";

const main = async () => {
  const token = getToken();
  const response = await fetch(GITHUB_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "github-projects-mcp-server/1.0.0",
      "X-Github-Next-Global-ID": "1", // opt-in to new global node IDs
    },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
  });

  const { data, errors } = await response.json();

  if (errors) {
    throw new Error(JSON.stringify(errors));
  }
  await Deno.writeTextFile(
    "src/schemas/schema.json",
    JSON.stringify(data, null, 2),
  );

  const schema = buildClientSchema(data);
  const sdl = printSchema(schema); // human-readable .graphql format
  await Deno.writeTextFile("src/schemas/schema.graphql", sdl);
};

main().catch((err) => {
  console.error("❌  Query failed:", err.message);
  Deno.exit(1);
});
