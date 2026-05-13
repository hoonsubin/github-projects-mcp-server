#!/usr/bin/env bash
set -euo pipefail

curl -LsSf https://astral.sh/uv/install.sh | sh

uv python install 3.12

npm install -g @earendil-works/pi-coding-agent

grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

export PATH="$HOME/.local/bin:$PATH"

uv tool install mempalace

pi install npm:mempalace-pi

deno install

# --- MemPalace: scripted onboard (global, once per user home) ---
if [ ! -f "$HOME/.mempalace/config.yaml" ]; then
  ONBOARD_ARGS=(
    --name "${MEMPALACE_USER_NAME:-vscode}"
    --non-interactive
  )
  if [ -n "${MEMPALACE_USER_EMAIL:-}" ]; then
    ONBOARD_ARGS+=(--email "$MEMPALACE_USER_EMAIL")
  fi
  mempalace init "${ONBOARD_ARGS[@]}"
fi

# --- MemPalace: scripted project init (once per workspace) ---
if [ ! -f "/workspace/mempalace.yaml" ]; then
  mempalace init /workspace \
    --wing "${MEMPALACE_WING:-$(basename /workspace)}" \
    --no-mine
fi

# --- MemPalace: index workspace, respecting .gitignore ---
mempalace mine /workspace --gitignore-aware