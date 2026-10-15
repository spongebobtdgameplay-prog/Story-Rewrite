#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/storybot-cloud-browser"
VENV_DIR="$HOME/.venvs/storybot-cloud-browser"

sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify xauth
mkdir -p "$(dirname "$VENV_DIR")"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$SERVICE_DIR/requirements.txt"
sudo "$VENV_DIR/bin/python" -m playwright install-deps chromium
"$VENV_DIR/bin/python" -m playwright install chromium

echo
echo "StoryBot cloud browser dependencies installed."
echo "Run: bash storybot-cloud-browser/start.sh"
