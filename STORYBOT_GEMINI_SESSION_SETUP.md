# StoryBot Gemini website-session setup

StoryBot uses the signed-in Gemini website endpoint, not a Gemini Developer API key and not a paid API call. The active StoryBot request runs from the Story Rewrite backend using environment variables configured only on Render.

## Render environment variables

Open the **Story Rewrite backend service** in Render → **Environment** and add:

- `authTokenForGemini`: the current `SNlM0e` value from the signed-in Gemini page.
- `GEMINI_BUILD_LABEL`: the active Gemini build label (`cfb2h` or the `bl` value associated with the current page).
- `GEMINI_SESSION_COOKIE`: the Cookie request-header value from a successful Gemini `StreamGenerate` request. Paste the header value; the backend strips an optional leading `Cookie:`.

Do not put these values in `ai-chat.js`, a frontend config, or GitHub. The backend never sends these values to browser clients or logs them.

## Important security warning

`GEMINI_SESSION_COOKIE` is highly sensitive and may act like a signed-in Google session. Anyone who obtains it may be able to access the Google account until that session expires or is revoked. Never paste it into chat or commit it to GitHub. Consider using a dedicated Google account that contains no sensitive Gmail, Drive, payment, or personal data. Render keeps these variables out of the frontend bundle, but the backend process itself can access them.

## Expiration and troubleshooting

These are temporary website-session values, not stable API credentials. They may expire or change after reload, sign-out, or a Gemini deployment. HTTP 400/401 usually means the token, cookie, or build label no longer matches the active session, or Google changed its private endpoint. This endpoint is undocumented and Google can change it without notice.

StoryBot receives a server-generated game snapshot containing room status, players/readiness, lives, current stage facts, votes, recent chat, and the question. Its master instructions say that `lobby` means the game has not started, only `playing` confirms a start, and any unknown status must be reported as unknown rather than invented.
