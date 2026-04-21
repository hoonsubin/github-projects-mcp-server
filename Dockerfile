FROM denoland/deno:2.3.3 AS runtime

WORKDIR /app

COPY deno.json ./
COPY deno.lock ./
COPY src ./src

RUN deno install && chown -R deno:deno /app

# Non-root user for security
USER deno

ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["deno", "task", "start"]
