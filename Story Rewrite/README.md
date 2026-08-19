# Story Rewrite

A browser puzzle game where the player crosses out sentences from a story to change what happens.

## Structure

All core files are flat in the repository root:

- `index.html` — GitHub Pages entry point
- `main.html` — home screen
- `levels.html` — world and level select
- `dialog.html` — shared level gameplay page
- `tutorial.html` — tutorial
- `rules.html` — rules
- `stages.json` — all 5 worlds and 50 stage definitions
- `looks.css` — shared visual style
- `app.js` — shared save/data/navigation helpers
- `main.js` — home page logic
- `levels.js` — world select logic
- `dialog.js` — gameplay, art, scoring, transitions
- `tutorial.js` — tutorial interaction
- `server.js` — optional local static server
- `images/` — reserved; currently unused
- `videos/` — reserved; currently unused

## GitHub Pages

Upload the contents of this folder to the repository root.

GitHub Pages should serve `index.html`, which redirects to `main.html`.

No build step is required.

## Local testing

Because the game fetches `stages.json`, opening the HTML through `file://` may be blocked by browser security rules.

Run:

```bash
npm start
```

Then open:

```text
http://localhost:57410
```

No npm dependencies are required.

## Saves

Progress is stored in browser localStorage using:

```text
StoryRewriteSaveV3
```

## Assets

`images/` and `videos/` are intentionally unused right now. The game currently draws its picture-book art with inline SVG.
