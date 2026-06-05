#!/usr/bin/env bash
set -euo pipefail

curl -LsSf https://astral.sh/uv/install.sh | sh

uv python install 3.12

npm install -g @earendil-works/pi-coding-agent

grep -qxF 'export PATH="$HOME/.local/bin:$PATH"' ~/.bashrc || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

export PATH="$HOME/.local/bin:$PATH"

npx ctx7 setup

uv tool install mempalace

mempalace init .

pi install npm:mempalace-pi

deno install