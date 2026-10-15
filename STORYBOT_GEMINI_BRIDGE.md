# Story Rewrite Gemini Session Bridge

This uses the **Gemini website-session method**, not the Gemini Developer API.

## Setup
1. Install the Tampermonkey browser extension.
2. Create a new userscript in Tampermonkey and paste the contents of `story-rewrite-gemini-bridge.user.js`, then save and enable it.
3. Open Story Rewrite at https://story-rewrite-iota.vercel.app and join a multiplayer room.
4. Open a separate tab to https://gemini.google.com, sign in, and leave that tab open.
5. Ask StoryBot normally, or run `AskAI("your question")` in the Story Rewrite page's developer console.

## How it works
- Story Rewrite sends prompts to the userscript bridge.
- Tampermonkey local storage relays prompts and answers between the two tabs.
- The private `StreamGenerate` request runs only on the Gemini website origin, where the signed-in tab's cookies are available.
- The Gemini session token and cookies are not sent to Render or stored in the Story Rewrite app.

## Limitations
- Keep at least one signed-in Gemini tab open while using StoryBot.
- This uses a private, undocumented Gemini web endpoint. Google can change the request/response format at any time.
