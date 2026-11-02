# project-app

*The Last Meridian as an installed Windows app (Electron), built 2026-11-01. How game changes reach it, and what that means for restarting and testing*

The player asked for a real app, just for themselves, so they pay nothing for signing or Steam. `app/main.js`, `app/choices.js`, `app/build.js` and `app/icon.ico` in the game folder, with the installer at `dist/The-Last-Meridian-Setup.exe`. It's installed for the player with shortcuts on the desktop and in the Start menu. `backups/before-app-2026-11-01` has the version before it.

Decisions that aren't obvious from the code:
- On this computer the installed app imports `D:\Test IA\server.js`, not its own copy, and the saves stay in `D:\Test IA\data`. So a change to the game reaches the app the next time it's closed and reopened, with no rebuild. Only a change in `app/` needs `npm run build-app` and running the installer. Its own copy is only for a computer without the folder, where it keeps saves in `%APPDATA%\The Last Meridian\data`.
- Port 3210 is the lock: only one server can hold it, and two would overwrite each other's autosave. The app joins a game that's already running there, and takes over if that game stops. `node server.js` exits with "already running" if the app has the port.
- Closing the window during an AI turn hides it and quits after the turn is saved, because a browser tab closing never lost a turn. A pending walk is saved on quit.

**Why:** the player has no coding experience and shouldn't have to reinstall anything when a session changes the game.

**How to apply:** "restart the game" now means asking the player to close and reopen the app. If they have it open, starting the `start` preview does nothing useful, because the server exits and the page shows the app's running copy, with the old code. Test with `GAME_DATA_DIR` and `PORT` as before: the app honors both, plus `--user-data-dir`. In an Electron ESM main file, `await app.whenReady()` at the top level never finishes, because ready waits for the file. The player sometimes plays in this session's Browser pane instead, through the `start` preview, so check `preview_list` and whether the app's running before saying how to restart: if it's the preview, restart that once nothing's busy, and they press Continue. While they play, the autosave changes and a moving mouse keeps the clock awake, so "your real save wasn't touched" and the two-minute check in my window tests can fail for that reason alone. Related: [project-last-meridian](project-last-meridian.md), [project-walk-around](project-walk-around.md).
