# StoryBot — Gemini website-session helper

StoryBot can use the Gemini website session already signed in on the room host's browser. It does not use the paid Gemini Developer API and does not send Google cookies to Render.

## Connect the host session

1. Sign in to Story Rewrite and host or join the multiplayer room as the host.
2. Click **Connect Gemini** in the StoryBot panel. Keep both tabs open.
3. On the Gemini tab opened by Story Rewrite, open Developer Tools → Console.
4. Copy the full current contents of `storybot-gemini-console.js` from this repository, paste it into the Gemini Console, and run it. Repeat after a browser session refresh or when the helper is updated.
5. Wait for the Gemini connected status, then ask StoryBot in the Story Rewrite chat.

The helper also exposes `AskAI("Say hello in one sentence.")` in the Gemini Console for a direct request test. A successful answer is printed under a large green **🤖 STORYBOT GEMINI RESPONSE** banner with a black border.

## What the helper sends

The helper reads the current `SNlM0e` request token, `cfb2h` build label, and `FdrFJe` session identifier from the signed-in Gemini page. It sends the prompt from the Gemini tab to Gemini's private `StreamGenerate` endpoint using that tab's existing cookies. `FdrFJe` is the `f.sid` session value; it is not the RPC operation ID.

These are undocumented Gemini website internals and may change after Google updates the site. If the helper reports HTTP 400/401 or cannot extract an answer, refresh Gemini while signed in and paste the latest helper. The repository smoke test checks the request structure and parsing with a mocked response; it does not have access to the host's signed-in session and cannot guarantee Google's live endpoint will accept every request.

## Privacy and limitations

The Google session stays in the Gemini tab. Do not copy session tokens or cookies into Story Rewrite frontend files, Render environment variables, GitHub, or chat. The Story Rewrite page and Gemini are different origins, so a normal Story Rewrite script cannot read Gemini's page session directly; the helper must run in the Gemini tab and communicate with the Story Rewrite tab opened by **Connect Gemini**.

StoryBot's server-generated master prompt includes the current room status, players/readiness, lives, stage objective/threat/survival rule, votes, recent room chat, and the player's question. It instructs StoryBot not to claim the game has started unless the server says the status is `playing`, and not to invent game actions or events.
