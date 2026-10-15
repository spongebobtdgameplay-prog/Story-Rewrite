# Story Rewrite — Gemini website-session console helper

StoryBot uses the signed-in Gemini website session and its free website endpoint, not the paid Gemini Developer API.

## One-time setup per host session

1. Sign in to Story Rewrite and create/host the multiplayer room.
2. Click **Connect Gemini** in the StoryBot Gemini session panel. This opens or reattaches the named Gemini tab.
3. In the Gemini tab, open Developer Tools → Console, copy the contents of storybot-gemini-console.js, and paste them into the Console. Run the script.
4. Leave both tabs open. When the connected status appears, StoryBot requests from the room are forwarded to Gemini and the answer returns to multiplayer chat.

The console helper also exposes AskAI("your test prompt") on the Gemini page for direct testing.

## What the session value is

The helper reads Gemini’s page token SNlM0e (sent as the at request parameter) and build label from the signed-in Gemini page at runtime. It is a short-lived website-session value, not a standalone API key. The relevant Google cookies stay in the Gemini browser tab. Do not copy the token or cookies into Render, GitHub, chat, or frontend configuration.

## StoryBot behaviour

The backend builds an authoritative snapshot from the actual room before sending the prompt: room status, players/readiness, lives, current stage, objective, threat, survival rule, available sentences, votes, recent chat, and last outcome. The master prompt tells StoryBot to explain its purpose, help with the current game, never invent events or state, and answer honestly if the game has not started or has ended.

## Browser limitation

A normal Story Rewrite page cannot directly call Gemini’s credentialed private endpoint because it runs on a different origin. The host’s Gemini tab therefore runs the small console helper and relays only prompts and answers through the opener relationship. No Tampermonkey extension is required. Google can change this private endpoint or its request format without notice.
