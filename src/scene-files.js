// Which stories have a written scene, from the file names alone, for the parts of the game that only
// need to know that much. src/scenes.js reads the files themselves.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";

// The folder the game reads its scenes from: world/scenes, unless a test or the Story board's check points it at a
// copy, the same way src/scenes.js is pointed.
const folder = () => process.env.GAME_SCENES_DIR ?? path.join(worldDir, "scenes");

// The ids of every scene there's a file for: for telling whether a scene a saved game was in the middle of is
// still there.
export function sceneFileIds() {
  const dir = folder();
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter((name) => !name.startsWith("_")).map((name) => name.match(/^(.+)\.(txt|json)$/)?.[1]).filter(Boolean));
}

// The ids of the stories in world/stories that have a scene called thread_<id>.
export function writtenThreadIds() {
  const dir = folder();
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).map((name) => name.match(/^thread_(.+)\.(txt|json)$/)?.[1]).filter(Boolean));
}
