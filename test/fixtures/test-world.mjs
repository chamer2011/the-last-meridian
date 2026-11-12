// The tests' own stories and scenes. The written main story was taken out of the game on 2026-11-12, and the tests
// that played it to try the story engine (scenes, quests that wait on people, endings by name, the record, the
// clock, the Story board) play the small test stories in this folder instead. None of it is the game's story, and
// none of it is ever read by the game itself.
//
// useTestWorld() makes a copy of the game's own scenes and stories in a temporary folder, adds the test ones, and
// points the game at the copies. Call it before anything from src/ is imported, since the game reads its folders as
// it starts. A server started by a test afterwards sees the same copies, through the environment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const world = path.join(here, "..", "..", "world");

// The test stories, by the names the tests use.
export const LEAK = "crew_test_leak";
export const INQUIRY = "crew_test_inquiry";

function copyInto(target, ...folders) {
  fs.mkdirSync(target, { recursive: true });
  for (const folder of folders) {
    for (const name of fs.readdirSync(folder)) {
      const from = path.join(folder, name);
      if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(target, name));
    }
  }
  return target;
}

// Copies the test scenes and stories on top of folders a test has already copied for itself, as the board's tests do.
export function addTestWorld({ scenes, stories } = {}) {
  if (scenes) copyInto(scenes, path.join(here, "scenes"));
  if (stories) copyInto(stories, path.join(here, "stories"));
}

export function useTestWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-test-world-"));
  const scenes = copyInto(path.join(root, "scenes"), path.join(world, "scenes"), path.join(here, "scenes"));
  const stories = copyInto(path.join(root, "stories"), path.join(world, "stories"), path.join(here, "stories"));
  process.env.GAME_SCENES_DIR = scenes;
  process.env.GAME_STORIES_DIR = stories;
  process.on("exit", () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  });
  // The game's own folders too, for a test that wants to say how the game itself stands.
  return { scenes, stories, gameScenes: path.join(world, "scenes"), gameStories: path.join(world, "stories") };
}
