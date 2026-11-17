// Makes the public copy of the game, chamer2011/last-meridian, from what's committed here. Only what's
// listed under GAME goes across, so anything new in this repository stays private until it's added to
// that list. CLAUDE.md and docs/notes/ talk about the owner, and they must never go across.
//
//   git clone https://github.com/chamer2011/last-meridian.git <folder>
//   node tools/publish.mjs <folder>
//
// That replaces the game and its licences in <folder> and remakes its GUIDE.md. It leaves what only the
// public copy has alone: README.md, .gitignore, .github/ and pictures/. It stops if anything private turns up.
//
// Then, in <folder>: read `git status`, run the tests, and commit and push. For a new installer, run
// `npm install` and `node app/build.js --for-others`, then attach dist/Almagest-Explorers-Setup.exe to a
// new release with `gh release create`. Only publish when the owner asks.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2];
// Of tools/, only the ones the README tells people to run go across: this script stays here.
const GAME = ["app", "public", "src", "test", "world", "server.js", "package.json", "package-lock.json", "start-game.bat", ".gitattributes", "LICENSE", "STORY-AND-WORLD.md", "tools/to-tiled.mjs", "tools/stand-in-art.mjs", "tools/test-save.mjs"];

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (!target || !fs.existsSync(path.join(target, ".git"))) stop("It needs a clone of the public repository: node tools/publish.mjs <folder>");
if (path.resolve(target) === here) stop("That's this repository, not the public copy.");

const git = (...args) => execFileSync("git", ["-C", here, ...args], { maxBuffer: 1 << 28 });
const committed = (file) => git("show", `HEAD:${file}`);

// ---- The game ----------------------------------------------------------------

for (const name of GAME) fs.rmSync(path.join(target, name), { recursive: true, force: true });
const files = git("ls-tree", "-r", "-z", "--name-only", "HEAD", "--", ...GAME).toString("utf8").split("\0").filter(Boolean);
for (const file of files) {
  const out = path.join(target, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const body = committed(file);
  // Git checks this one kind of file out with Windows line endings, so it's written the same way here.
  fs.writeFileSync(out, file.endsWith(".bat") ? body.toString("utf8").replace(/\r?\n/g, "\r\n") : body);
}

// ---- The guide: this repository's README, without what's only about this computer ----

const THE_APP = `## The app

The installer gives the game its own window, with shortcuts on your desktop and in the Start menu. It holds its own copy of the game, so you don't need anything else installed.

- **Where your things are:** your saved games are in \`%APPDATA%\\Almagest Explorer's\\data\`, which is what \`data/\` means in this guide if you used the installer. If you had it installed as The Last Meridian, the game's name until version 0.5.0, the first run under the new name copies them over from \`%APPDATA%\\The Last Meridian\`, and leaves that folder as it was.
- **A new version:** run the newer installer. It replaces the game and leaves your saves alone.
- **If something goes wrong:** what the game printed is in \`%APPDATA%\\Almagest Explorer's\\game.log\`.
- **Uninstalling:** use **Installed apps** in Windows Settings. That only removes the game. Your saves stay until you delete \`%APPDATA%\\Almagest Explorer's\` yourself.
`;

const GUIDE_TOP = "# Almagest Explorer's: the full guide\n\nHow everything in the game works. It names places and people you'll meet, but it doesn't say how the story ends. To get the game, see the [front page](README.md).\n\n";

const GUIDE_CHANGES = [
  ["You can still play in your browser if you prefer:", "If you've downloaded the source instead of the installer, you can play in your browser:"],
  ["Both ways use the same saves. Only one copy", "Only one copy"],
  ["and you can give one its own drawing: Section Fourteen's file shows how.", "and you can give one its own drawing."],
];

function guide() {
  let text = committed("README.md").toString("utf8").replaceAll("\r\n", "\n");
  // Whatever's above How to play is the owner's own introduction, so it doesn't go in the guide.
  const start = text.indexOf("## How to play\n");
  const end = text.indexOf("## The app\n");
  if (start < 0 || end < start) stop("The README's sections have changed, so the guide needs a look.");
  text = GUIDE_TOP + text.slice(start, end) + THE_APP;
  for (const [from, to] of GUIDE_CHANGES) {
    if (!text.includes(from)) stop(`The README has changed, so the guide needs a look: ${from}`);
    text = text.replace(from, to);
  }
  return text;
}

fs.writeFileSync(path.join(target, "GUIDE.md"), guide());

// ---- Nothing private goes across ----------------------------------------------

const PRIVATE = [/sk-ant-[A-Za-z0-9_-]{10,}/, /@gmail\./i, /CLAUDE\.md/, /docs\/notes/, /MORNING-SUMMARY/, /private repository/i];
const THIS_COMPUTER = [os.userInfo().username, here, here.replaceAll("\\", "/")];

function everyFile(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "dist", "pictures"].includes(entry.name)) return [];
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? everyFile(full) : [full];
  });
}

const found = [];
for (const file of everyFile(target)) {
  const text = fs.readFileSync(file, "utf8");
  const hit = PRIVATE.find((pattern) => pattern.test(text)) ?? THIS_COMPUTER.find((words) => text.includes(words));
  if (hit) found.push(`${path.relative(target, file)}: ${hit}`);
}
if (found.length) stop(`Private things found, so don't publish this:\n${found.join("\n")}`);

console.log(`${files.length} game files copied, the guide remade, and nothing private found.`);
