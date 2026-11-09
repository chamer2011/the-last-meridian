// The ship's logistics, step 7's spare parts: the engineers' repairs use up what the logistics file's "a repair
// takes" line says, fetched from the stores it names, first to last, for the kinds of damage it names. With none in
// the stores a repair waits, said once, until some comes; a rag off a lens or a seal off a vent takes nothing; and
// Tech Sami keeps the parts lockers up from the shuttle stores. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-repairs-"));
// The checker test writes another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logistics-repairs-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const bag = await import("../src/bag.js");
const { countAboard, errandsView, logisticsOf, logisticsProblems, putAboard, repairsView, storesView, takeAboard } = await import("../src/logistics.js");
const { clockRuns, passTime, publicState } = await import("../src/rules.js");
const sys = await import("../src/systems.js");
const { whereNow } = await import("../src/life.js");
const { clearMaps } = await import("../src/walk.js");
const { reloadLogistics } = await import("../src/world.js");
const { parseLogisticsText, readRepair, writeLogisticsText, writeRepair } = await import("../public/logistics-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf("meridian").stores.find((one) => one.id === id);
const count = (game, storeId, item = "parts_crate") => storesView(game, "meridian").find((one) => one.id === storeId).items.find((one) => one.id === item)?.n ?? 0;
const take = (game, storeId, item, n) => bag.storeTake(game, storeOf(storeId).key, storeOf(storeId).holds, item, n);
const parts = (game) => countAboard(game, "meridian", ["parts_crate"]).n;
const partNamed = (name, room) => Object.values(sys.systemsOf("meridian").parts).find((one) => one.name === name && one.room === room);
const said = (notes) => notes.filter((line) => line.startsWith("[SYSTEMS]"));
function withFile(text, run) {
  try {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), text);
    reloadLogistics();
    clearMaps();
    return run();
  } finally {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), FILE);
    reloadLogistics();
    clearMaps();
  }
}

test("the repair line is read into its pieces, written back the same, and a bad one says what's wrong", () => {
  const line = "1 parts crate, from the parts lockers or the shuttle stores, for what's broken, cut, crippled or forced";
  assert.deepEqual(readRepair(line), { n: 1, what: "parts crate", from: ["parts lockers", "shuttle stores"], damage: ["broken", "cut", "crippled", "forced"] });
  assert.equal(writeRepair(readRepair(line)), line);
  assert.deepEqual(readRepair("a parts crate"), { n: 1, what: "parts crate", from: [], damage: [] }, "every store that keeps it, for every kind of damage");
  assert.equal(readRepair("two parts crates, for what's broken").n, 2);
  assert.deepEqual(readRepair("nothing"), { n: 0, what: "", from: [], damage: [] });
  assert.equal(writeRepair(readRepair("nothing")), "nothing");
  assert.match(readRepair("parts").problem, /needs a number and what a repair takes/);
  assert.match(readRepair("1 parts crate, for what's").problem, /kinds of damage/);
  // The file keeps the line among the numbers at the top, and writes it back where it was.
  const { value, problems } = parseLogisticsText(FILE, "meridian");
  assert.deepEqual(problems, []);
  assert.equal(value.repair.line, 6);
  assert.equal(writeLogisticsText(value), FILE);
});

test("the Meridian's repair line knows its item, stores and kinds of damage, and the checker catches a bad one", () => {
  assert.deepEqual(logisticsOf("meridian").repair, { item: "parts_crate", n: 1, from: ["parts_lockers", "shuttle_stores"], damage: ["broken", "cut", "crippled", "forced"], line: 6 });
  assert.deepEqual(logisticsProblems(), []);
  const bad = FILE.replace(/^a repair takes: .*$/m, "a repair takes: 1 parts crate, from the hold or the pantry, for what's smashed or broken");
  withFile(bad, () => {
    const problems = logisticsProblems();
    assert.ok(problems.some((one) => /line 6.*no store called hold/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 6.*pantry doesn't keep parts crate/.test(one)), problems.join(" | "));
    assert.ok(problems.some((one) => /line 6.*nothing is ever smashed: the kinds of damage are .*covered/.test(one)), problems.join(" | "));
    assert.equal(logisticsOf("meridian").repair, null, "a line with a problem takes nothing until it's put right");
  });
  withFile(FILE.replace(/^a repair takes: .*$/m, "a repair takes: 1 lantern"), () => {
    assert.ok(logisticsProblems().some((one) => /line 6.*(no store keeps lantern|no item called lantern)/.test(one)), logisticsProblems().join(" | "));
  });
});

test("a cut junction box is fixed with a parts crate from the parts lockers, which an engineer fetches first", () => {
  const game = newGame();
  const box = partNamed("junction box", "engineering");
  assert.equal(parts(game), 12);
  sys.damagePart(game, "meridian", box.id, "cut", { by: "story" });
  const due = game.systems.meridian.parts[box.id].fixAt;
  assert.match(sys.lookAt(game, "meridian", box), /Marrow will fix it with a parts crate from the stores\.$/);
  // In the last hour: the first half at the parts lockers, the second at the box.
  passTime(game, due - game.clock.hours - 0.8);
  assert.deepEqual(sys.detourFor(game, "meridian")("marrow", "engineering", false), { where: "store:parts_lockers", doing: "fetching a parts crate from the parts lockers for the junction box" });
  assert.match(whereNow(game, "marrow"), /fetching a parts crate from the parts lockers for the junction box/);
  passTime(game, 0.4);
  assert.deepEqual(sys.detourFor(game, "meridian")("marrow", "engineering", false), { where: "@engineering", doing: "fixing the junction box" });
  assert.equal(parts(game), 12, "the crate comes out when it's used");
  const notes = said(passTime(game, 0.5));
  assert.deepEqual(notes, ["[SYSTEMS] Marrow has fixed the junction box in Engineering, with a parts crate from the parts lockers."]);
  assert.equal(count(game, "parts_lockers"), 5);
  assert.equal(parts(game), 11);
  assert.equal(game.systems?.meridian?.parts?.[box.id], undefined, "and it's whole again");
  const shown = publicState(game).ship.repairs;
  assert.equal(shown.does, "a parts crate, from the parts lockers or the shuttle stores, for what's broken, cut, crippled or forced");
  assert.deepEqual(shown.waiting, []);
  assert.match(shown.last, /^Day 1, \d\d:\d\d: A parts crate from the parts lockers, for the junction box in Engineering\.$/);
  // With the lockers empty, the shuttle stores give it, and the engineer goes there for it. (Tech Sami is kept to his
  // day for this, or he'd have carried a crate down to the lockers first.)
  const model = logisticsOf("meridian");
  const errands = model.errands;
  model.errands = errands.filter((one) => one.id !== "tech:parts_crate");
  try {
    take(game, "parts_lockers", "parts_crate", 6);
    sys.damagePart(game, "meridian", box.id, "broken", { by: "story" });
    passTime(game, game.systems.meridian.parts[box.id].fixAt - game.clock.hours - 0.8);
    assert.equal(sys.detourFor(game, "meridian")("marrow", "engineering", false).where, "store:shuttle_stores");
    assert.match(said(passTime(game, 1))[0], /with a parts crate from the shuttle stores\.$/);
    assert.equal(count(game, "shuttle_stores"), 5);
  } finally {
    model.errands = errands;
  }
});

test("with no parts in the stores a repair waits, says so once, and is done within the hour after a crate comes", () => {
  const game = newGame();
  const box = partNamed("junction box", "engineering");
  takeAboard(game, "meridian", "parts_crate", 999);
  sys.damagePart(game, "meridian", box.id, "broken", { by: "story" });
  const first = said(passTime(game, 2.1));
  assert.deepEqual(first, ["[SYSTEMS] Marrow can't fix the junction box in Engineering: there isn't a parts crate in the stores."]);
  assert.match(sys.lookAt(game, "meridian", box), /Marrow can't fix it until there's a parts crate in the stores\.$/);
  assert.deepEqual(publicState(game).ship.repairs.waiting, ["the junction box in Engineering"]);
  assert.deepEqual(said(passTime(game, 24)), [], "nothing said twice, and still broken");
  assert.equal(game.systems.meridian.parts[box.id].damage, "broken");
  // Reading it changes nothing.
  const before = JSON.stringify(game);
  publicState(game);
  sys.lookAt(game, "meridian", box);
  assert.equal(JSON.stringify(game), before);
  putAboard(game, "meridian", "parts_crate", 1, ["parts_lockers"]);
  passTime(game, 0.1);
  assert.ok(game.systems.meridian.parts[box.id].fixAt - game.clock.hours <= 1, "an engineer's on it");
  assert.deepEqual(publicState(game).ship.repairs.waiting, []);
  assert.deepEqual(said(passTime(game, 1)), ["[SYSTEMS] Marrow has fixed the junction box in Engineering, with a parts crate from the parts lockers."]);
  assert.equal(parts(game), 0);
});

test("a forced door takes a parts crate too, while a sealed vent or a covered lens takes nothing", () => {
  const game = newGame();
  sys.setDoor(game, "meridian", "engineering", "forced", { by: "player" });
  assert.deepEqual(said(passTime(game, 2.1)), ["[SYSTEMS] Marrow has fixed the door to Engineering, with a parts crate from the parts lockers."]);
  assert.equal(parts(game), 11);
  const vent = partNamed("vent", "mess");
  sys.damagePart(game, "meridian", vent.id, "sealed", { by: "story" });
  assert.doesNotMatch(sys.lookAt(game, "meridian", vent), /parts crate/);
  assert.deepEqual(said(passTime(game, 2.1)).filter((line) => /vent/.test(line)), ["[SYSTEMS] Marrow has fixed the vent in The Long Mess."]);
  const camera = partNamed("camera", "bridge");
  sys.damagePart(game, "meridian", camera.id, "covered", { by: "story" });
  passTime(game, 2.1);
  assert.equal(game.systems?.meridian?.parts?.[camera.id], undefined);
  assert.equal(parts(game), 11, "neither took a crate");
});

test("fixing something yourself takes nothing, and a file without the line fixes everything for free", () => {
  const game = newGame();
  const box = partNamed("junction box", "engineering");
  sys.damagePart(game, "meridian", box.id, "cut", { by: "story" });
  sys.repairPart(game, "meridian", box.id);
  assert.equal(parts(game), 12);
  assert.equal(game.systems?.meridian?.parts?.[box.id], undefined);
  withFile(FILE.replace(/^a repair takes: .*\n/m, ""), () => {
    const free = newGame();
    assert.equal(logisticsOf("meridian").repair, null);
    assert.equal(publicState(free).ship.repairs, null);
    sys.damagePart(free, "meridian", box.id, "cut", { by: "story" });
    assert.doesNotMatch(sys.lookAt(free, "meridian", box), /parts crate/);
    assert.deepEqual(said(passTime(free, 2.1)), ["[SYSTEMS] Marrow has fixed the junction box in Engineering."]);
    assert.equal(parts(free), 12);
  });
  assert.equal(repairsView(newGame(), "haven"), null, "and a place with no logistics has no repairs to show");
});

test("Tech Sami keeps the parts lockers up from the shuttle stores, one crate at a time", () => {
  const game = newGame();
  game.clock.hours = 9;
  clockRuns(game, 1);
  take(game, "parts_lockers", "parts_crate", 5);
  const errand = errandsView(game, "meridian").find((one) => one.id === "tech:parts_crate");
  assert.equal(errand.does, "parts crates from the shuttle stores to the parts lockers when under 2, 1 at a time");
  for (let gone = 0; gone < 90; gone += 5) clockRuns(game, 5);
  assert.equal(count(game, "parts_lockers"), 2, "one trip brings the lockers to two, which is enough");
  assert.equal(count(game, "shuttle_stores"), 5);
  assert.equal(parts(game), 7, "nothing came from nowhere");
});
