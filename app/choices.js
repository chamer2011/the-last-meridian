// The decisions the app makes when it starts, and the settings its installers are made with, kept apart from the
// app itself so they can be tested without opening a window.

import path from "node:path";

// A folder only counts as the game's if the game is really in it.
export const isGameFolder = (folder, exists) => Boolean(folder) && exists(path.join(folder, "server.js")) && exists(path.join(folder, "world"));

// On this computer, the app runs the game from its own folder, so changes there show up the next time
// the app opens, and the saves stay where they've always been. If that folder has gone from where it
// was, the player gets asked, because their saves went with it. A computer that has never had the
// folder runs the copy of the game inside the app, with saves of its own.
export function chooseHome({ remembered, built, exists }) {
  if (isGameFolder(remembered, exists)) return { home: remembered };
  if (remembered) return { lost: remembered };
  return { home: isGameFolder(built, exists) ? built : null };
}

// The game is already running if something on its port answers with its page. Only one copy may run
// at a time, because two would overwrite each other's autosave, so the app uses that one instead. An
// older copy of the game still answers under its old name.
export const OLD_NAME = "The Last Meridian";
export const looksLikeTheGame = (page) => ["<title>Almagest Explorer's", `<title>${OLD_NAME}`].some((title) => String(page).includes(title));

// The app kept its files under its old name until version 0.5.0: its settings, and on a computer without the
// game's folder, the saves and the API key. They're taken over once, when this name has nothing of its own yet.
// A copy (below) takes nothing over: the old files are the first app's, and its settings would send the copy to the
// first app's folder.
export const oldFilesToTakeOver = ({ mine, old, exists, copy = false }) => !copy && exists(old) && !exists(path.join(mine, "app-state.json")) && !exists(path.join(mine, "data"));

// The title bar and borders take some of this, which leaves the page the 810 by 600 it's been checked at.
const MIN_WIDTH = 830;
const MIN_HEIGHT = 640;
const FIRST_WIDTH = 1400;
const FIRST_HEIGHT = 900;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Opens the window where it was last time, unless the screen it was on has gone since then.
export function windowPlace(saved, screens, primary) {
  const size = { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT };
  const usable = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width >= MIN_WIDTH && saved.height >= MIN_HEIGHT;
  if (usable && screens.some((screen) => overlaps(saved, screen))) {
    return { ...size, x: saved.x, y: saved.y, width: saved.width, height: saved.height, maximized: Boolean(saved.maximized) };
  }
  const width = Math.max(MIN_WIDTH, Math.min(FIRST_WIDTH, primary.width));
  const height = Math.max(MIN_HEIGHT, Math.min(FIRST_HEIGHT, primary.height));
  return {
    ...size,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
    maximized: false,
  };
}

// ---- Which app this is, and what its installer is made with ----------------------------

// The game's app, and a second copy of it that sits beside the first (node app/build.js --copy). The copy's own name
// gives it its own settings folder and its own saves where it keeps them itself; its own id and package name let it
// be installed without replacing the first app; its own port lets the two be open at once without either showing the
// other's game.
export const MAIN_APP = { name: "Almagest Explorer's", id: "com.lastmeridian.game", port: 3210, copy: false };
export const COPY_APP = {
  name: "Almagest Explorer's (copy)",
  id: "com.lastmeridian.game.copy",
  port: 3220,
  copy: true,
  packageName: "almagest-explorers-copy",
  executable: "Almagest Explorers Copy",
  installer: "Almagest-Explorers-Copy-Setup.exe",
  output: "dist/copy",
};

// The app knows which one it is from the package.json built into it.
export const appIdentity = (built) => (built?.gameCopy ? COPY_APP : MAIN_APP);

// The settings under "build" in package.json, with what app/build.js was asked for. An installer made here remembers
// this folder, so on this computer the app plays the game from it, and one for other people's computers leaves it out
// and plays the copy of the game inside it. A copy is either of those with a name and the rest of its own, and, since
// the bought art (licensed/) never goes in an installer, it can be told where that art is on this computer.
export function installerSettings(settings, { home = null, forOthers = false, copy = false, licensed = null } = {}) {
  const extraMetadata = forOthers || !home ? {} : { gameHome: home };
  if (!copy) return { ...settings, extraMetadata };
  return {
    ...settings,
    appId: COPY_APP.id,
    productName: COPY_APP.name,
    executableName: COPY_APP.executable,
    directories: { ...settings.directories, output: COPY_APP.output },
    nsis: { ...settings.nsis, artifactName: COPY_APP.installer, shortcutName: COPY_APP.name },
    extraMetadata: { ...extraMetadata, name: COPY_APP.packageName, productName: COPY_APP.name, gameCopy: true, ...(licensed ? { licensedDir: licensed } : {}) },
  };
}
