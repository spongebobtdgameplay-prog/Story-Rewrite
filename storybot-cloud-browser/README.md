# StoryBot cloud browser (Codespaces)

This worker runs a real Chromium browser inside the remote Codespace. It does not run a local language model and does not control any player's computer. The existing Render multiplayer backend sends questions to the worker over HTTPS.

## Install once, inside the Story Rewrite Codespace

From the repository terminal, run:

    bash storybot-cloud-browser/install.sh

## Start the browser worker

    bash storybot-cloud-browser/start.sh

The first start creates storybot-cloud-browser/.env containing a private API token and a separate password for the remote browser console. Startup logs do not print either secret; the values remain in that ignored local file. Never commit the file or paste either secret into chat. The persistent Gemini profile is stored in the ignored repository folder .storybot-gemini-profile and survives ordinary Codespace stops while the workspace storage remains.

The Codespaces devcontainer starts the worker automatically on container start and when you attach to it. A process lock prevents those two lifecycle hooks from launching duplicate workers. Startup output is saved to `$HOME/storybot-cloud-browser.log`.

## Port visibility is important

In the Codespaces PORTS tab:
- Port 6080 is the noVNC browser console. Keep it PRIVATE. Open the forwarded URL with `/vnc.html?autoconnect=1&resize=remote` appended. Enter STORYBOT_VNC_PASSWORD when prompted, then use the cloud browser shown there to sign in to the dedicated Gemini account.
- Port 8765 is the worker API. Set this port to PUBLIC so the Render backend can reach it over HTTPS. The API requires the bearer token for every /ask request.

Do not expose port 5900. The VNC listener binds to localhost; noVNC on private port 6080 is the only browser-control route.

Once port 8765 is forwarded, its HTTPS URL is the worker base URL, for example the URL GitHub assigns to port 8765. Open that URL plus /health to confirm the worker is reachable.

## Render environment variables

On the existing Story Rewrite backend service, add:
- STORYBOT_BROWSER_WORKER_URL = the HTTPS forwarded URL for port 8765, without /ask
- STORYBOT_BROWSER_WORKER_TOKEN = the exact token generated in the Codespace .env file

Restart/redeploy the Render service after setting both variables. Do not put the token in frontend JavaScript, HTML, GitHub, or chat.

## What it does

The worker uses normal visible Gemini website interactions in its isolated cloud browser profile. Sign in manually through the private noVNC page, not through terminal commands. The browser profile retains its own account session when the Codespace workspace persists. The worker reads the server-provided game context and returns the answer to the backend.

It does not hide browser automation, bypass CAPTCHA, defeat bot checks, or automate a login challenge. If Gemini requires verification, the worker stops and reports the problem so it can be handled normally in the private browser console.

## Availability and production limitation

The startup hooks restart the worker when the existing Codespace starts or you attach to it; they cannot wake a stopped Codespace when a player sends a request. The Codespace must remain running for the worker to serve requests. If the Codespace is stopped, recreated, or its forwarded URL changes, the worker can be unavailable until it starts and the backend URL is updated. This is suitable for development/testing, not guaranteed always-on production hosting.
