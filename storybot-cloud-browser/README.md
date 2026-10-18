# Retired StoryBot cloud-browser worker

This directory is retained for historical reference only. The active StoryBot request path no longer uses this worker, Chromium automation, a Codespaces browser, a Gemini browser profile, or the worker token.

StoryBot now uses `storybot-gemini-guest.js` from the backend's existing `storybot:ask` Socket.IO event. That helper supplies the StoryBot master prompt and the authoritative room/stage/chat context to Gemini's web guest request flow. It does not type prompts into a browser UI and does not require a Gemini API key.

Do not run `install.sh` or `start.sh` for normal Story Rewrite development. The active devcontainer no longer starts this worker. The old files remain here only so the transition is easy to inspect or revert.

The direct Gemini web endpoint is private/undocumented and may change or reject server-side guest requests. StoryBot reports that failure rather than falling back to a generic canned answer.
