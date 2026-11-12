// A use for the things in the rooms (the hands-on plan, step 2): a thing does something by what it's called, from
// world/uses.txt. A bunk is slept in, a chair sat in, a mess table eaten at while a sitting's on and out of the real
// kettle, an urn drunk from, a board read and kept in What you know, a footlocker opened and things left in it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-uses-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const { logisticsOf, storesView } = await import("../src/logistics.js");
const { addItem, passTime } = await import("../src/rules.js");
const uses = await import("../src/uses.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
};
const thing = (game, name) => walkView(game).things.find((one) => one.name === name);
const does = (game, name) => (thing(game, name)?.does ?? []).map((one) => one.label);
const act = (game, name, id) => thing(game, name).does.find((one) => one.id === id);
const run = (game, name, id) => walkCommand(game, { action: id, key: thing(game, name).id });
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const kettleStore = () => logisticsOf("meridian").stores.find((one) => one.id === "soup_kettle");
const kettle = (game) => storesView(game, "meridian").find((one) => one.id === "soup_kettle").count.n;
const setKettle = (game, n) => { game.stores ??= {}; game.stores[kettleStore().key] = { count: n }; };

test("the file reads: words, times, what it takes off, how often, what it costs, and what's wrong by its line", () => {
  const model = uses.parseUses([
    "# a note",
    "Uses:",
    "- sit: called chair, bench; 1 hour; stress -1, tiredness -3",
    "- eat: called mess table; half an hour; stress -4; once a sitting; 2 credits off the ship",
    "- drink: called tea; 15 minutes; once every 4 hours",
    "- nap: called sofa",
    "- wash: called basin; a long time",
    "Buttons and lines:",
    "- sit: Sit a while: You sit.",
    "Things:",
    "- meridian, A contract, open on the desk: read, shows the sittings",
    "- meridian, The scan bed: nothing",
    "- meridian, A cupboard: fly",
    "Put in the rooms:",
    "- meridian, The Heads: A row of basins: wash: Four basins.",
    "Wrong part:",
  ].join("\n"));
  const sit = model.uses.find((one) => one.kind === "sit");
  assert.deepEqual([sit.words, sit.minutes, sit.stress, sit.tiredness], [["chair", "bench"], 60, -1, -3]);
  const eat = model.uses.find((one) => one.kind === "eat");
  assert.deepEqual([eat.minutes, eat.once, eat.cost], [30, { sitting: true }, 2]);
  assert.deepEqual(model.uses.find((one) => one.kind === "drink").once, { hours: 4 });
  assert.deepEqual(model.words.sit, { button: "Sit a while", said: "You sit." });
  assert.deepEqual(model.things.map((one) => [one.name, one.uses]), [["A contract, open on the desk", [{ kind: "read", shows: "sittings" }]], ["The scan bed", []]]);
  assert.deepEqual(model.put.map((one) => [one.room, one.name, one.uses, one.look]), [["The Heads", "A row of basins", [{ kind: "wash" }], "Four basins."]]);
  assert.equal(model.problems.length, 4);
  assert.match(model.problems[0], /line 6: "nap" isn't a use the game knows/);
  assert.match(model.problems[1], /line 7: "a long time" isn't something a use can say/);
  assert.match(model.problems[2], /line 13: "fly" isn't a use/);
  assert.match(model.problems[3], /line 16: there's no part called "Wrong part"/);
  // The words are whole words: a bunk isn't a bunker, and a hot-bunk slate has a bunk in it.
  assert.equal(sit.pattern.test("the captain's chair"), true);
  assert.equal(sit.pattern.test("a chairman"), false);
});

test("the game's own file is sound, and gives the Meridian's things their uses without touching what they did", () => {
  assert.deepEqual(uses.usesProblems(), []);
  const game = newGame();
  inRoom(game, "bunks");
  assert.deepEqual(does(game, "A warm bunk"), ["Sleep here"]);
  assert.deepEqual(does(game, "A photograph in a rack frame"), ["Take a moment here"]);
  // The file stands a footlocker in the Hot Bunks, and it opens.
  const locker = thing(game, "A footlocker with no name on it");
  assert.ok(locker?.holds && locker.store === "thing:meridian:use:a_footlocker_with_no_name_on_it");
  assert.equal(locker.room, "bunks");
  inRoom(game, "medbay");
  // A scan bed isn't a bed, by the file's own line, and a computer is a computer.
  assert.deepEqual(does(game, "The scan bed"), []);
  assert.deepEqual(does(game, "A cot with its curtain drawn"), []);
  assert.deepEqual(does(game, "The records terminal"), []);
  // The ship's stores are left alone.
  assert.equal(thing(game, "Medicine cabinet").does, undefined);
  inRoom(game, "bridge");
  // The captain's chair keeps its written words, and can be sat in besides.
  const chair = thing(game, "The captain's chair");
  assert.deepEqual([chair.written, chair.does.map((one) => one.label)], [true, ["Sit a while"]]);
  assert.match(walkCommand(game, { action: "use", key: chair.id }).said, /./);
  // The sealed locker has words of its own, so it isn't made a stash.
  assert.equal(thing(game, "Ready room locker").holds, undefined);
  // Showing the game changes nothing.
  const before = JSON.stringify(game);
  walkView(game);
  assert.equal(JSON.stringify(game), before);
});

test("sitting passes an hour and takes a little off; a moment at the viewport is once a day", () => {
  const game = newGame();
  inRoom(game, "bridge");
  game.needs.fatigue = 40;
  game.needs.stress = 30;
  const before = game.clock.hours;
  const { said } = run(game, "The captain's chair", "use-sit");
  assert.match(said, /^You sit for an hour/);
  assert.ok(Math.abs(game.clock.hours - before - 1) < 1e-6);
  assert.equal(game.needs.fatigue, 37);
  assert.ok(game.needs.stress < 30, "a little stress off");
  assert.equal(act(game, "The forward viewport", "use-quiet").detail, "15 minutes");
  const stress = game.needs.stress;
  run(game, "The forward viewport", "use-quiet");
  assert.ok(game.needs.stress < stress, "and more at the viewport");
  const again = act(game, "The forward viewport", "use-quiet");
  assert.deepEqual([again.disabled, again.detail], [true, "once a day is enough"]);
  assert.throws(() => run(game, "The forward viewport", "use-quiet"), /Not now: once a day is enough/);
  passTime(game, 24, "rest");
  assert.equal(act(game, "The forward viewport", "use-quiet").disabled, undefined);
  // A use the thing hasn't got is refused.
  assert.throws(() => walkCommand(game, { action: "use-eat", key: thing(game, "The captain's chair").id }), /That isn't here/);
});

test("eating aboard is a real sitting: only while one's on, out of the kettle, and once for each", () => {
  const game = newGame();
  inRoom(game, "mess");
  toHour(game, 12);
  const waiting = act(game, "A wobbling table", "use-eat");
  assert.deepEqual([waiting.disabled, waiting.detail], [true, "the next sitting's at 18:00"]);
  toHour(game, 18);
  setKettle(game, 0);
  assert.equal(act(game, "The far table", "use-eat").detail, "the kettle's empty");
  setKettle(game, 400);
  game.needs.stress = 30;
  const full = kettle(game);
  const { said } = run(game, "A wobbling table", "use-eat");
  assert.match(said, /^You eat what there is/);
  assert.ok(game.needs.stress < 30, "and it does some good");
  assert.ok(kettle(game) < full, "a sitting came out of the kettle, with everyone else's");
  assert.equal(act(game, "The far table", "use-eat").detail, "you've eaten with this sitting");
  // The second sitting is another meal.
  toHour(game, 20);
  setKettle(game, 400);
  assert.equal(act(game, "The far table", "use-eat").disabled, undefined);
  // The urn is good every four hours.
  run(game, "The tea urn", "use-drink");
  assert.equal(act(game, "The tea urn", "use-drink").detail, "not again so soon");
  passTime(game, 4, "active");
  assert.equal(act(game, "The tea urn", "use-drink").disabled, undefined);
});

test("a board is read, says what the ship knows today, and is kept in What you know once", () => {
  const game = newGame();
  inRoom(game, "mess");
  const lore = game.lore.length;
  const { said } = run(game, "Sitting rota", "use-read");
  assert.match(said, /^You read it through\./);
  assert.match(said, /The sittings are at 06:00, 07:30, 18:00 and 19:30, about \d+ people at each\. Right now: /);
  assert.match(said, /It's in What you know now, under Sitting rota\./);
  assert.equal(game.lore.length, lore + 1);
  assert.match(game.lore.at(-1).text, /^At CFS Meridian: Four sittings, nine hundred people, one hall\./);
  assert.doesNotMatch(run(game, "Sitting rota", "use-read").said, /What you know now/);
  assert.equal(game.lore.length, lore + 1);
});

test("the footlocker keeps what's left in it", () => {
  const game = newGame();
  inRoom(game, "bunks");
  const locker = thing(game, "A footlocker with no name on it");
  addItem(game, "data_chip");
  bag.bagCommand(game, { action: "open", key: locker.store });
  assert.deepEqual(bag.bagView(game).open.items, []);
  const view = bag.bagView(game);
  const at = ["pockets", "pack"].find((where) => view[where].items.some((one) => one.id === "data_chip"));
  const mine = view[at].items.find((one) => one.id === "data_chip");
  bag.bagCommand(game, { action: "move", from: { at, x: mine.x, y: mine.y }, to: { at: "open", x: 0, y: 0 } });
  assert.deepEqual(bag.bagView(game).open.items.map((one) => one.id), ["data_chip"], "it's in the footlocker");
  assert.equal(game.inventory.data_chip ?? 0, 0);
  bag.bagCommand(game, { action: "close" });
  // A day later, from the other end of the ship, it's still there.
  inRoom(game, "bridge");
  passTime(game, 24, "rest");
  inRoom(game, "bunks");
  bag.bagCommand(game, { action: "open", key: locker.store });
  assert.deepEqual(bag.bagView(game).open.items.map((one) => one.id), ["data_chip"]);
});

test("a bunk is the game's own eight hours, where you'd sleep anyway; off the ship a meal costs", () => {
  const game = newGame();
  inRoom(game, "bunks");
  game.needs.fatigue = 70;
  const before = game.clock.hours;
  const { said } = run(game, "A warm bunk", "use-sleep");
  assert.match(said, /^You sleep for eight hours aboard the Meridian/);
  assert.ok(Math.abs(game.clock.hours - before - 8) < 1e-6);
  assert.ok(game.needs.fatigue < 10);
  // A captain sleeps aboard, so a seat at Kessara is only a seat; the noodle stall takes its two credits.
  game.location = "kessara";
  game.walk = null;
  const map = mapFor("kessara");
  const stall = Object.values(map.levels).find((level) => level.things.some((one) => one.name === "The noodle stall"));
  walkCommand(game, { action: "room", to: stall.id });
  const credits = game.credits;
  assert.equal(act(game, "The noodle stall", "use-eat").detail, "30 minutes, 2 credits");
  assert.match(run(game, "The noodle stall", "use-eat").said, /It costs you 2 credits\./);
  assert.equal(game.credits, credits - 2);
  assert.equal(act(game, "The noodle stall", "use-eat").detail, "you've eaten not long ago");
  game.credits = 0;
  passTime(game, 7, "active");
  assert.match(act(game, "The noodle stall", "use-eat").detail, /it costs 2 credits, and you have 0/);
});
