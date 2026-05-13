#!/usr/bin/env bash
set -euo pipefail

curl -LsSf https://astral.sh/uv/install.sh | sh

uv python install 3.12

npm install -g @earendil-works/pi-coding-agent

grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

export PATH="$HOME/.local/bin:$PATH"

uv tool install mempalace



# --- MemPalace: scripted onboard (global, once per user home) ---
if [ ! -f "$HOME/.mempalace/config.yaml" ]; then
  mempalace init . --no-mine
fi

# --- MemPalace: scripted project init (once per workspace) ---
if [ ! -f "/workspace/mempalace.yaml" ]; then
  mempalace init /workspace \
    --wing "${MEMPALACE_WING:-$(basename /workspace)}" \
    --no-mine
fi

# --- MemPalace: index workspace, respecting .gitignore ---
mempalace mine /workspace --gitignore-aware

pi install npm:mempalace-pi

deno install