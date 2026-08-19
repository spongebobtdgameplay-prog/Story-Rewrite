# Story Rewrite

Story Rewrite is a browser puzzle game where players cross out sentences to change dangerous stories. The project now includes accounts, server-side progress, limited lives, multiplayer room codes, synchronized sentence voting, group chat, and an audio system.

## Main files

- `index.html` — routes signed-in players to the game and new sessions to account creation
- `auth.html` / `auth.js` — account registration and sign in
- `main.html` / `main.js` — home screen
- `levels.html` / `levels.js` — world and chapter map
- `dialog.html` / `dialog.js` — single-player and multiplayer gameplay
- `multiplayer.html` / `multiplayer.js` — create/join game codes, lobby, ready states, player list, group chat
- `network.js` — REST and Socket.IO client helpers
- `server-config.js` — deployed backend URL for a separate static frontend
- `audio.js` — background music and sound engine with Web Audio fallbacks
- `server.js` — Node HTTP, account, save, lives, validation, chat, and Socket.IO multiplayer server
- `stages.json` — five worlds and fifty stages
- `looks.css` / `game-ui.css` / `multiplayer.css` — UI styling
- `AUDIO_SOURCES.md` — vetted audio sources and expected filenames

## Run the full game locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Open:

```text
http://localhost:57410
```

The same Node server hosts the frontend, REST API, account database, and Socket.IO connection, so `server-config.js` can stay blank for local testing.

## Accounts and saves

Accounts are required for gameplay. Passwords are hashed with Node `crypto.scrypt` using a random salt. Progress is stored by the server in `data/accounts.json`. That database file is ignored by Git and should never be committed.

The browser does not use `localStorage` for progress. The login token is kept only in `sessionStorage`, while stars, unlocked stages, current stage, lives, death count, and audio settings are stored server-side.

## Lives

Each account starts with three lives. A failed survival check removes one life and shows the stage's bad aftermath. At zero lives the player must restart the current chapter. Multiplayer uses three shared team lives.

## Multiplayer

Multiplayer supports up to four players.

1. Sign in.
2. Open `multiplayer.html`.
3. Create a game or enter a six-character game code.
4. Players use group chat and ready up.
5. The host starts the story.
6. Each sentence is selected by votes. A majority vote crosses the sentence out.
7. The host submits the team rewrite for server validation.

Rooms survive normal page navigation long enough for players to reconnect when moving from the lobby into a story level.

## GitHub Pages

GitHub Pages can still host the frontend, but Pages cannot run the Node/WebSocket backend. For a Pages deployment, deploy `server.js` to a Node host with WebSocket support, then set the backend address in:

```javascript
window.STORY_REWRITE_SERVER_URL = "https://your-backend.example.com";
```

inside `server-config.js`.

Set these environment variables on the backend:

```text
SESSION_SECRET=<long random value>
ALLOWED_ORIGINS=https://spongebobtdgameplay-prog.github.io
DATA_DIR=<persistent server directory>
```

Use persistent storage for `DATA_DIR` if the hosting provider has an ephemeral filesystem.

## Audio

The repository contains the complete audio engine and the folder layout for music and sound effects. Until actual MP3/WAV files are uploaded, the game uses generated Web Audio fallback sounds so missing audio files do not break gameplay.

See `AUDIO_SOURCES.md` for royalty-free source candidates and exact filenames.
