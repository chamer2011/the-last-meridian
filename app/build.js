// Makes the installer, dist/The-Last-Meridian-Setup.exe. The settings are under "build" in
// package.json. The one added here is where this folder is, so that on this computer the app can
// run the game from here. Your saves and API key never go in the installer: see "files" there.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, Platform } from "electron-builder";

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { build: settings } = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));

const files = await build({
  targets: Platform.WINDOWS.createTarget(),
  projectDir,
  config: { ...settings, extraMetadata: { gameHome: projectDir } },
});
console.log(`Finished: ${files.filter((file) => file.endsWith(".exe")).join(", ")}`);
