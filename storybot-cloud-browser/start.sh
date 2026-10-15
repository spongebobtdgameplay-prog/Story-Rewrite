#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/storybot-cloud-browser"
VENV_DIR="$HOME/.venvs/storybot-cloud-browser"
ENV_FILE="$SERVICE_DIR/.env"
PROFILE_DIR="$ROOT_DIR/.storybot-gemini-profile"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Dependencies are not installed. Run: bash storybot-cloud-browser/install.sh" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  VNC_PASSWORD="$(python3 -c 'import secrets,string; print("".join(secrets.choice(string.ascii_letters+string.digits) for _ in range(8)))')"
  printf 'STORYBOT_WORKER_TOKEN=%s\nSTORYBOT_PROFILE_DIR=%s\nSTORYBOT_VNC_PASSWORD=%s\n' "$TOKEN" "$PROFILE_DIR" "$VNC_PASSWORD" > "$ENV_FILE"
  echo "Created a private worker token and browser-console password."
  echo "Worker token: $TOKEN"
  echo "Private browser-console password: $VNC_PASSWORD"
  echo "Save both securely. Do not commit storybot-cloud-browser/.env."
fi

if ! grep -q '^STORYBOT_VNC_PASSWORD=' "$ENV_FILE"; then
  VNC_PASSWORD="$(python3 -c 'import secrets,string; print("".join(secrets.choice(string.ascii_letters+string.digits) for _ in range(8)))')"
  printf 'STORYBOT_VNC_PASSWORD=%s\n' "$VNC_PASSWORD" >> "$ENV_FILE"
  echo "Added a browser-console password: $VNC_PASSWORD"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
export STORYBOT_PROFILE_DIR
export DISPLAY=":99"

if ! command -v Xvfb >/dev/null 2>&1 || ! command -v x11vnc >/dev/null 2>&1; then
  echo "Xvfb/x11vnc are missing. Run the install script again." >&2
  exit 1
fi

Xvfb "$DISPLAY" -screen 0 1440x900x24 -ac -nolisten tcp >/tmp/storybot-xvfb.log 2>&1 &
XVFB_PID=$!
sleep 2

mkdir -p "$HOME/.vnc"
VNC_PASS_FILE="$HOME/.vnc/storybot-cloud-browser.pass"
"$VENV_DIR/bin/x11vnc" -storepasswd "$STORYBOT_VNC_PASSWORD" "$VNC_PASS_FILE" >/dev/null
chmod 600 "$VNC_PASS_FILE"
x11vnc -display "$DISPLAY" -forever -shared -rfbauth "$VNC_PASS_FILE" -listen 127.0.0.1 -rfbport 5900 >/tmp/storybot-vnc.log 2>&1 &
VNC_PID=$!

if [[ -x /usr/share/novnc/utils/novnc_proxy ]]; then
  /usr/share/novnc/utils/novnc_proxy --listen 0.0.0.0:6080 --vnc 127.0.0.1:5900 >/tmp/storybot-novnc.log 2>&1 &
elif command -v novnc_proxy >/dev/null 2>&1; then
  novnc_proxy --listen 0.0.0.0:6080 --vnc 127.0.0.1:5900 >/tmp/storybot-novnc.log 2>&1 &
else
  websockify --web=/usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/tmp/storybot-novnc.log 2>&1 &
fi
NOVNC_PID=$!

cleanup() {
  kill "$NOVNC_PID" "$VNC_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo
echo "StoryBot cloud browser worker is starting."
echo "Codespaces port 6080 must stay PRIVATE (remote browser control)."
echo "Codespaces port 8765 must be PUBLIC for the Render backend, protected by the worker token."
echo "Gemini browser profile: $STORYBOT_PROFILE_DIR"
echo

cd "$SERVICE_DIR"
"$VENV_DIR/bin/uvicorn" worker:app --host 0.0.0.0 --port 8765
