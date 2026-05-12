#!/usr/bin/env bash
set -euo pipefail

curl -LsSf https://astral.sh/uv/install.sh | sh

uv python install 3.12

npm install -g @earendil-works/pi-coding-agent

# Ensure user-local Python bin is on PATH for shells started later
grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

export PATH="$HOME/.local/bin:$PATH"

uv tool install mempalace

# Install the Pi extension package that exposes MemPalace commands/tools
pi install npm:mempalace-pi

deno install

if [ ! -f "$HOME/.mempalace/config.yaml" ]; then
  mempalace onboard \
    --name  "${MEMPALACE_USER_NAME:-vscode}" \
    --email "${MEMPALACE_USER_EMAIL:-}" \
    --non-interactive
fi

if [ ! -f "/workspace/mempalace.yaml" ]; then
  mempalace init /workspace \
    --wing "${MEMPALACE_WING:-$(basename /workspace)}" \
    --no-mine
fi

mempalace mine /workspace --gitignore-aware