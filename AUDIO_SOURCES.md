# Story Rewrite audio

Story Rewrite now has an original procedural Web Audio soundtrack built into `audio.js`. It runs automatically when a real audio file is not present, so the game already has different ambience for the menu, lobby, Fromville, Neon Exorcists, Blackthorn Manor, Spirit Grove, False City, and danger states.

The sound-effect engine also has synthesized fallbacks for clicking, crossing out, restoring, joining, messages, readying up, failure, life loss, and success.

## Optional real music files

The engine automatically prefers these files when they exist:

- `music/menu/menu.mp3`
- `music/lobby/lobby.mp3`
- `music/fromville/fromville.mp3`
- `music/neon-exorcists/neon-exorcists.mp3`
- `music/blackthorn/blackthorn.mp3`
- `music/spirit-grove/spirit-grove.mp3`
- `music/false-city/false-city.mp3`
- `music/danger/danger.mp3`

## Optional real sound files

- `sounds/ui/click.wav`
- `sounds/story/cross.wav`
- `sounds/story/restore.wav`
- `sounds/story/success.wav`
- `sounds/multiplayer/join.wav`
- `sounds/multiplayer/message.wav`
- `sounds/multiplayer/ready.wav`
- `sounds/danger/fail.wav`
- `sounds/danger/life-lost.wav`

## Vetted places to choose tracks

- Pixabay music: https://pixabay.com/music/
- Horror / dark ambience: https://pixabay.com/music/search/dark-ambient-horror/
- Horror ambience search: https://pixabay.com/music/search/horror%20ambience/
- Candidate: Horror Ambience by AtlasAudio: https://pixabay.com/music/horror-scene-horror-ambience-512255/
- Pixabay sound effects: https://pixabay.com/sound-effects/

Useful sound-effect searches include `ui click`, `paper scratch`, `pencil cross`, `notification`, `door slam`, `heartbeat`, `horror impact`, `message`, and `ready`.

## Public repository warning

Do not copy a third-party stock audio track into this public repository unless its license explicitly permits redistribution of the original audio file. Pixabay permits use of its content inside creative projects, but its license prohibits distributing content on a standalone basis. Because a public Git repository exposes the original MP3/WAV file directly, the repo currently uses the original procedural soundtrack instead of committing third-party stock tracks.

If external tracks are added later, keep the source page and license information for every file.
