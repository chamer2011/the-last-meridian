// What's yours and what isn't (the hands-on plan, step 5): taking from a store that isn't yours, or standing in a
// closed room, matters only when it's seen, by someone awake in the room or a working camera, with the lights on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-law-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const law = await import("../src/law.js");
const { logisticsOf, stockOf } = await import("../src/logistics.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const systems = await import("../src/systems.js");
const walk = await import("../src/walk.js");

const newGame = (start = "engine_hand") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: room });
};
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const store = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
// Opens a store beside the pack and takes its first stack of an item.
function takeFrom(game, id, item) {
  bag.bagCommand(game, { action: "open", key: store(id).key });
  const one = bag.bagView(game).open.items.find((it) => it.id === item);
  bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  bag.bagCommand(game, { action: "close" });
  return one.n;
}
const lawLines = (notes) => notes.filter((one) => one.startsWith("[LAW]"));
// Nobody's eyes and no camera's: the room's lights and cameras off.
const blind = (game, room) => {
  systems.applySystemsEffect(game, { system: "cameras", room, state: "off" });
  systems.applySystemsEffect(game, { system: "lights", room, state: "off" });
};

test("the file reads, and the game's own is sound", () => {
  const model = law.parseLaw([
    "Stores:",
    "- the pantry: the quartermaster, the cooks",
    "Rooms:",
    "- The Armory: the guards",
    "seen taking: it goes back; 10 credits docked a second time within 7 days",
    "seen in a closed room: thrown out",
  ].join("\n"));
  assert.deepEqual(model.stores.map((one) => [one.name, one.owners]), [["the pantry", ["the quartermaster", "the cooks"]]]);
  assert.deepEqual(model.taking, { fine: 10, days: 7 });
  assert.equal(model.room, null);
  assert.match(model.problems[0], /line 6: the two lines are written like/);
  assert.deepEqual(law.lawProblems(), []);
  const mine = law.lawOf("meridian");
  assert.deepEqual(mine.stores.find((one) => one.name === "pantry").jobs, ["cook"]);
  assert.deepEqual(mine.rooms.map((one) => one.id), ["armory", "brig"]);
});

test("a tech who takes from the pantry under a cook's eyes gives it back, and pays the second time", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "galley");
  assert.equal(law.isMine(game, "meridian", law.lawOf("meridian").stores.find((one) => one.name === "pantry")), false);
  assert.ok(law.whoSees(game, "meridian", "galley"), "someone's in the galley at ten, or a camera is");
  const before = stockOf(game, "meridian", "ration_crate", "the pantry");
  const n = takeFrom(game, "pantry", "ration_crate");
  assert.equal(game.inventory.ration_crate, n);
  const first = lawLines(clockRuns(game, 1));
  assert.match(first[0], /^\[LAW\] .+ saw you take .+ ration crates? from the pantry\. (It goes|They go) back\.$/);
  assert.equal(first.length, 1);
  assert.equal(game.inventory.ration_crate ?? 0, 0);
  assert.equal(stockOf(game, "meridian", "ration_crate", "the pantry"), before);
  // Nothing more is said about it a minute later.
  assert.deepEqual(lawLines(clockRuns(game, 1)), []);
  // The next day, again: this time it costs.
  toHour(game, 10);
  inRoom(game, "galley");
  const credits = game.credits;
  takeFrom(game, "pantry", "ration_crate");
  const second = lawLines(clockRuns(game, 1));
  assert.match(second[1], /^\[LAW\] It's not the first time this week: 10 credits are docked\.$/);
  assert.equal(game.credits, credits - 10);
});

test("unseen, nothing happens: in the dark with the cameras off, or with nobody awake", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "galley");
  blind(game, "The Galley");
  assert.equal(law.whoSees(game, "meridian", "galley"), null);
  const n = takeFrom(game, "pantry", "ration_crate");
  const notes = lawLines(clockRuns(game, 1));
  assert.deepEqual(notes, ["[LAW] The pantry isn't yours to take from. Nobody saw."]);
  assert.equal(game.inventory.ration_crate, n);
  // And it's said only once.
  takeFrom(game, "pantry", "produce");
  assert.deepEqual(lawLines(clockRuns(game, 1)), []);
});

test("what's the player's own is theirs: a tech's parts lockers, and everything for the captain", () => {
  const tech = newGame();
  toHour(tech, 10);
  inRoom(tech, "stores");
  takeFrom(tech, "parts_lockers", "parts_crate");
  assert.deepEqual(lawLines(clockRuns(tech, 1)), []);
  assert.ok(tech.inventory.parts_crate >= 1);
  const captain = newGame("captain");
  toHour(captain, 10);
  inRoom(captain, "galley");
  takeFrom(captain, "pantry", "ration_crate");
  assert.deepEqual(lawLines(clockRuns(captain, 1)), []);
  assert.ok(captain.inventory.ration_crate >= 1);
});

test("seen in a closed room, the player is told to leave, and walked out ten minutes later", () => {
  const game = newGame();
  toHour(game, 10);
  walk.startInRoom(game, "armory");
  const seen = law.whoSees(game, "meridian", "armory");
  const told = lawLines(clockRuns(game, 1));
  if (!seen) {
    // Nobody there and no camera: nobody says a word.
    assert.deepEqual(told, []);
    return;
  }
  assert.match(told[0], /^\[LAW\] .+: "You've no business in the Armory\. Out\."$/);
  assert.deepEqual(lawLines(clockRuns(game, 1)), []);
  const later = lawLines(passTime(game, 11 / 60, "active"));
  assert.deepEqual(later, ["[LAW] You're walked out of the Armory, and not gently."]);
  const here = walk.mapFor("meridian").levels[game.walk.level].roomAt(game.walk.x, game.walk.y);
  assert.notEqual(here, "armory");
});
