# Story Rewrite audio

Story Rewrite uses its procedural Web Audio ambience for background atmosphere, but gameplay and UI sound effects now prefer real CC0 recordings from Kenney's Interface Sounds pack. The procedural effects remain only as a fallback if a real sound cannot play.

## Real sound-effect source

- Pack: Kenney — Interface Sounds
- License: Creative Commons CC0 1.0 Universal
- Original asset page: https://kenney.nl/assets/interface-sounds
- Redistributable GitHub mirror used at runtime: https://github.com/Calinou/kenney-interface-sounds
- Mirror license: `LICENSE.txt` in that repository

The game currently maps these CC0 WAV files:

- `click` → `click_001.wav`
- `cross` → `scratch_003.wav`
- `restore` → `maximize_007.wav`
- `join` → `open_001.wav`
- `message` → `select_007.wav`
- `ready` → `confirmation_001.wav`
- `fail` → `error_008.wav`
- `life` → `error_001.wav`
- `success` → `confirmation_002.wav`
- `vote` → `tick_001.wav`
- `revive` → `maximize_001.wav`
- `reviveEarned` → `confirmation_003.wav`
- `heartRefill` → `confirmation_004.wav`

Kenney's CC0 license permits copying, modification, redistribution, and commercial use without attribution. Attribution is still kept here for source tracking.

## Procedural ambience

`audio.js` still generates the background ambience for menu, lobby, Fromville, Neon Exorcists, Blackthorn Manor, Spirit Grove, False City, and danger states. It also contains synthesized fallback effects so a temporary failure to load a real WAV does not break gameplay.
