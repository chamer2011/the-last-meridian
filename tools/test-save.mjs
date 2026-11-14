// Makes the test save: a new captain's game in the "test" slot, the one the title screen lists as Test save, with the
// test switches of src/test-mode.js on. The Meridian's fuel stays full, and the rig counts as built with whatever a hack
// needs, so any computer, keypad, junction box or camera can be connected to and hacked without finding the parts first.
// It starts on the bridge on the morning of day 1, after the opening (no mutiny is fought in it).
//
//   node tools/test-save.mjs          writes data/saves/test.json, and stops if one is there already
//   node tools/test-save.mjs --again  writes it again over the old test save
//
// GAME_DATA_DIR points it at another data folder, as it does the game. It never touches any other save.

import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../src/paths.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import "../src/tools.js";
import { keepFuelFull } from "../src/test-mode.js";

const again = process.argv.includes("--again");
const saves = path.join(dataDir(), "saves");
const file = path.join(saves, "test.json");
if (fs.existsSync(file) && !again) {
  console.error(`There's a test save already at ${file}. Run this with --again to make it afresh.`);
  process.exit(1);
}

const draft = randomDraft({ archetype: "officer" });
draft.start = "captain";
const game = createGameFromDraft(draft);
game.test = { fuel: true, rig: true };
// Past the opening: the story has begun, nothing's waiting on it, and it's mid-morning.
game.scene = null;
game.clock.hours = Math.floor(game.clock.hours / 24) * 24 + 9.5;
game.transcript.push({ role: "narrator", text: "The story has begun." });
game.transcript.push({ role: "notice", text: "[TEST] This is the test save. The Meridian's fuel stays full, and your rig works as if it had every part a hack needs: it connects to anything, has room for every program and the most power parts give. The hacking itself plays as usual." });
keepFuelFull(game);

fs.mkdirSync(saves, { recursive: true });
fs.writeFileSync(`${file}.tmp`, JSON.stringify(game));
fs.renameSync(`${file}.tmp`, file);
console.log(`Test save written: ${file} (${game.name}, fuel ${game.ship.fuel} of ${game.ship.maxFuel}).`);
