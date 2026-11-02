# project-story-popups

*The story as popups over the isometric room, the player's pick (example D, speech over people's heads) with their three tweaks, plus interface size and full screen. Built 2026-11-02, backup before-story-popups-2026-11-02. Not yet played by them or run with real Claude*

On 2026-11-02 the player asked to "revamp the text story window and integrate it seemlessly in the walking window like a popup that informs the player of the story and whats happening", and to see examples first. I showed four pictures: A a story card, B a log beside the room, C a band along the bottom (which I recommended), D speech in windows over people's heads. They chose D over my pick: "D is a good start", with three tweaks, in their words: "first the style show feel like the rest of the game, two i would like the text that represent the people speak to write and not appear all at once, three maybe the resolution could be adaptable or at least the UI could be chosen by the player".

How each tweak was read, which they haven't confirmed:
- **Style:** my mock used warm steel, orange corners and a book font, and that was what felt wrong. The popups are now the same `check-window` console windows as the rest of the game, in green with the Terminal font, and a speech window takes the speaker's color. Popup font in Settings can switch to Book.
- **Writing out:** speech writes a letter at a time, at 45 letters a second by default, with Slow, Fast and All at once in Settings. Narration appears whole, because they only asked for people speaking. It also applies to replies in the talk window. A click finishes the line, and the next click goes on.
- **Adaptable:** the windows rearrange themselves by the room's size (a container query at 760px). Interface size in Settings has Automatic, Small, Normal, Large and Largest, using CSS zoom on the page: Automatic only grows past 1400x900, so the default window looks unchanged. Full screen is a Settings button using the browser's fullscreen, since the app's F11 is in a hidden menu I didn't want to rebuild for. "UI chosen by the player" became Story over the room: Popups, One box or Under the room (the old panel). A and B weren't built.

Decisions that aren't obvious from the code:
- `public/scene.js` has no screen, so the tests can use it. `public/popups.js` draws, and `public/writer.js` holds words back. A scene runs from `beginScene` (when the player acts) or from `latestSceneStart` after a load.
- Pieces are cut at sentence ends, and a limit from the window's size is taken once per scene, so resizing mid-scene doesn't re-cut it.
- Game messages come up as notes with the piece they follow, so a check's result doesn't spoil the text before it. Fight blow-by-blow isn't shown.
- Until a scene's been read, a click on the room goes on with the story and doesn't walk. That was my call, because a player clicking "anywhere to go on" would otherwise walk away. They may not like it.
- Balloons only go over someone found in `game.walk.people` by name, and a wrong match is worse than none, so ambiguous names go in the bottom window. Comms voices and machines never get a balloon.

**Why:** they want the walking window to be the game, with the story happening in it and looking like everything else.

Their screen is 2560x1440, so at full screen Automatic draws everything at 1.6. Testing full screen in the real app covers their whole screen for a few seconds, and a stray click during one run changed that test window's size setting, so keep those runs rare and read a surprise like that as them, not the game. Headless Edge with a test server (`popup-check.mjs` in the scratchpad, which won't last) showed everything else without a window popping up.

**How to apply:** ask how it feels once they've played. Real Claude hasn't run this: its real text has only been read back from their save, not streamed live, so real pacing is untested. The AI's instructions and tools didn't change for it, so there was no reload. Talk, fight and check windows still have their own big windows, and they may want talks moved into balloons next. Backup is `backups/before-story-popups-2026-11-02`. Related: [project-walk-around](project-walk-around.md), [project-world-engine](project-world-engine.md), [user-keyboard-shy](user-keyboard-shy.md).
