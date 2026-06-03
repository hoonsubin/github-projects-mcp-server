/**
 * Architecture boundary validation via dependency-cruiser CLI.
 *
 * Uses the CLI spawned as a subprocess (Deno.Command) because
 * dependency-cruiser's programmatic API expects ICruiseOptions
 * (nested ruleSet.forbidden) while .dependency-cruiser.cjs uses
 * IConfiguration format (top-level forbidden + options block).
 * The CLI handles this conversion internally.
 */

const projectRoot = new URL("..", import.meta.url).pathname;
const configPath = `${projectRoot}.dependency-cruiser.cjs`;

const args = Deno.args;
const isJson = args.includes("--json");
const isHtml = args.includes("--html");
const isMetrics = args.includes("--metrics");

// Collect --exclude <pattern> arguments (repeatable)
const excludePatterns: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--exclude" && i + 1 < args.length) {
    excludePatterns.push(args[++i]);
  }
}

const cliArgs = [
  "run",
  "-A",
  "npm:dependency-cruiser",
  "src/",
  "--config",
  configPath,
];

if (isJson) {
  cliArgs.push("--output-type", "json");
} else if (isHtml) {
  cliArgs.push("--output-type", "html");
} else {
  // Default: use "err" reporter which produces a violation summary
  // and exits with non-zero on error-severity violations
  cliArgs.push("--output-type", "err");
}

if (isMetrics) {
  cliArgs.push("--metrics");
}

// Add exclude patterns to depcruise CLI (patterns are already anchored regex)
for (const pattern of excludePatterns) {
  cliArgs.push("--exclude", pattern);
}

const command = new Deno.Command("deno", {
  args: cliArgs,
  stdout: "piped",
  stderr: "piped",
});

const { code, stdout, stderr } = await command.output();

const stdoutText = new TextDecoder().decode(stdout);
const stderrText = new TextDecoder().decode(stderr);

if (stdoutText) console.log(stdoutText);
if (stderrText) console.error(stderrText);

Deno.exit(code);
