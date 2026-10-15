# Story Rewrite — Gemini website-session helper

StoryBot uses the signed-in Gemini website session, **not** the paid Gemini Developer API.

## Current setup

1. Install and enable the repository file `story-rewrite-gemini-bridge.user.js` in Tampermonkey on the **room host's browser only**.
2. Open Story Rewrite at https://story-rewrite-iota.vercel.app and create or host a multiplayer room.
3. In that same browser profile, open https://gemini.google.com/app, sign in, and leave the Gemini tab open.
4. The host can then handle StoryBot requests for the room. Other players do not need to install the helper or sign into Gemini.

## Session security

- The helper reads Gemini's page request token (`SNlM0e`) inside the signed-in Gemini tab. This is **not** a reusable API key and it is not configured in Render.
- Gemini session cookies and the page token stay in the host's browser. The Story Rewrite backend receives the prompt and generated answer, not the Google session credentials.
- Do not paste Gemini cookies or page tokens into chat, GitHub, or Render environment variables.

## StoryBot instructions and game-state context

The backend appends StoryBot's role instructions and a server-authoritative room snapshot before forwarding each question. That snapshot includes the room status, whether the game started or ended, players/readiness, stage objective and threats, votes, lives, recent chat, and last outcome. StoryBot is instructed not to invent missing facts or claim the game started unless the server snapshot confirms it.

## Browser limitation

The Gemini website endpoint is private and undocumented. Story Rewrite's normal page cannot make that authenticated request directly: browser same-origin/CORS rules prevent one website from freely executing and reading another website's credentialed fetch. The helper is the current local-browser relay for that reason. Google may change the endpoint or session format without notice.
