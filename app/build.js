// Makes an installer. The settings are under "build" in package.json, and installerSettings in app/choices.js adds
// what's asked for here:
//   node app/build.js               dist/Almagest-Explorers-Setup.exe, whose app plays the game from this folder on this
//                                   computer, so a change here shows the next time it opens
//   node app/build.js --for-others  the same for other people's computers, with this folder left out: the app plays
//                                   the copy of the game inside it and keeps saves of its own
//   node app/build.js --copy        dist/copy/Almagest-Explorers-Copy-Setup.exe, a second app beside the first, called
//                                   Almagest Explorer's (copy), that plays the game from this folder (with
//                                   --for-others, from inside itself)
//   --licensed=<folder>             with --copy, where the bought art is on this computer, for a folder without it
// Saves never go in an installer: see "files" in package.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform } from "electron-builder";
import { installerSettings } from "./choices.js";

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { build: settings } = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
const copy = process.argv.includes("--copy");
const given = process.argv.find((arg) => arg.startsWith("--licensed="))?.slice("--licensed=".length);
const licensed = copy && given ? path.resolve(given) : null;
if (licensed && !fs.existsSync(licensed)) throw new Error(`There's no folder at ${licensed}.`);

const files = await build({
  targets: Platform.WINDOWS.createTarget(),
  projectDir,
  config: installerSettings(settings, { home: projectDir, forOthers: process.argv.includes("--for-others"), copy, licensed }),
});
console.log(`Finished: ${files.filter((file) => file.endsWith(".exe")).join(", ")}`);
