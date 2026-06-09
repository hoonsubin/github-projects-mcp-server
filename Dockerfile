# ── Build stage ──────────────────────────────────────────────────────────────
# Compiles a self-contained binary with permissions baked in at compile time.
# DENO_DIR is set to a known location so it can be copied to the runtime stage
# for deno ci cache reuse (optional; kept for future incremental builds).
FROM denoland/deno:2.8.1 AS build

ENV DENO_DIR=/deno-dir
WORKDIR /app

# Layer 1: dependency manifests (cache-friendly — only invalidates when deps change)
COPY deno.json deno.lock ./

# Install dependencies. --frozen=false allows the lockfile to update when
# deno.json has changed since the lockfile was generated (common in dev).
# --prod skips devDependencies, --skip-types drops @types/* packages.
RUN deno install --frozen=false --prod --skip-types

# Layer 2: source code (invalidates on any source change)
COPY src ./src

# Compile a self-contained binary. --allow-* flags are embedded at compile time,
# so the runtime image does NOT need Deno installed. The binary bundles the
# entire JS output + a platform-specific denort runtime.
RUN deno compile \
  --allow-env \
  --allow-net \
  --allow-read \
  --output /app/mcp-server \
  src/server.ts

# ── Runtime stage ────────────────────────────────────────────────────────────
# Minimal Debian image. curl is needed solely for the Docker HEALTHCHECK.
# ca-certificates enables TLS for GitHub API and remote config URLs.
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates=20230311+deb12u1 \
    curl=7.88.1-10+deb12u14 \
  && rm -rf /var/lib/apt/lists/*

# Non-root user matching the deno image convention (UID 1993).
RUN groupadd --gid 1993 deno \
  && useradd --uid 1993 --gid 1993 -m -s /sbin/nologin deno

WORKDIR /app

# Copy only the compiled binary from the build stage.
COPY --from=build /app/mcp-server /app/mcp-server

RUN chown deno:deno /app/mcp-server

USER deno

# ── Environment defaults ─────────────────────────────────────────────────────
# These are the server's expected env vars (see src/server.ts).
# All can be overridden in docker-compose.yml or at runtime.
# MCP_TRANSPORT is always "http" in the container — stdio requires a direct
# parent-child process relationship that containers don't provide.
# SCRUM_CONFIG_PATH defaults to /app/config.yml — mount the config file at
# that path and no further env var configuration is needed.
ENV MCP_TRANSPORT=http \
    PORT=3000 \
    SCRUM_PLATFORM=github \
    SCRUM_CONFIG_PATH=/app/config.yml \
    DEBUG=0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

# The compiled binary has --allow-env --allow-net --allow-read baked in.
# It reads SCRUM_CONFIG_PATH from the environment (default: /app/config.yml).
# Mount the config file at that path — no CLI arguments needed.
ENTRYPOINT ["/app/mcp-server"]
