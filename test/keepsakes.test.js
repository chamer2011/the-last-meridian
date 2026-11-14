// Keepsakes asked after, step 6 of the loot plan: a keepsake (an item whose file says keepsake: yes) taken aboard from
// a container that's someone's in particular is missed by them (whoever sleeps nearest a locker in a room people sleep
// in, or whoever holds the post a container belongs to), who asks after it some hours later while the player still
// has it: the request about: a keepsake you took, world/scenes/request_keepsake.txt. Given back, it's done and they
// remember; put back where it was, it's over; told no, they never ask about it again.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-keepsakes-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const keep = await import("../src/keepsakes.js");
const loot = await import("../src/loot.js");
const rq = await import("../src/requests.js");
const { ITEMS } = await import("../src/data.js");
const { passTime } = await import("../src/rules.js");
const { loadScenes } = await import("../src/scenes.js");
const { parseSceneText } = await import("../src/scene-text.js");
const walk = await import("../src/walk.js");

const SHIP = "meridian";
const KIND = "keepsake";
// Every other request turned off, so nothing else is asked first and the pace is the keepsake's.
const others = Object.keys(loadScenes().scenes).filter((id) => id.startsWith("request_") && id !== `request_${KIND}`).map((id) => id.slice("request_".length));

function newGame() {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.requests = { off: Object.fromEntries(others.map((kind) => [kind, true])) };
  passTime(game, ((10 - (game.clock.hours % 24)) % 24 + 24) % 24 || 24, "rest");
  return game;
}
const inRoom = (game, room) => {
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: room });
};
// The containers aboard, with whose a keepsake in each would be.
function containers(game) {
  const map = walk.mapFor(SHIP);
  return Object.values(map.levels).flatMap((level) => level.things.filter((thing) => loot.lootOf(SHIP, thing)).map((thing) => ({
    level, thing, room: level.areas?.length ? level.roomAt(thing.x, thing.y) : level.id, owner: keep.keepsakeOwner(game, SHIP, level, thing),
  })));
}
const keyOf = (thing) => `thing:${SHIP}:${thing.id}`;
// A locker in the Hot Bunks with a harmonica in it, taken out by the player.
function takeHarmonica(game) {
  const found = containers(game).find((one) => one.room === "bunks" && one.owner && one.thing.name === "A locker");
  inRoom(game, "bunks");
  game.stores = { ...(game.stores ?? {}), [keyOf(found.thing)]: { items: [{ id: "harmonica", x: 0, y: 0, n: 1 }] } };
  bag.bagCommand(game, { action: "open", key: keyOf(found.thing) });
  const one = bag.bagView(game).open.items[0];
  bag.bagCommand(game, { action: "take", from: { at: "open", x: one.x, y: one.y } });
  bag.bagCommand(game, { action: "close" });
  return found;
}
const hours = (game, n) => {
  const notes = [];
  for (let i = 0; i < n; i += 1) notes.push(...passTime(game, 1, "rest"));
  return notes;
};

test("the personal things are keepsakes and the parts and salvage count as salvage, and every file reads with them", () => {
  const keepsakes = Object.entries(ITEMS).filter(([, item]) => item.keepsake);
  const salvage = Object.entries(ITEMS).filter(([, item]) => item.salvage);
  assert.equal(keepsakes.length, 45);
  assert.equal(salvage.length, 36, "the 35 parts and salvage, and scrap");
  for (const [id, item] of keepsakes) assert.ok(["goods", "consumable"].includes(item.type), id);
  for (const [id, item] of salvage) assert.ok(Number.isInteger(item.salvage) && item.salvage >= 1, id);
  assert.equal(ITEMS.scrap.salvage, 1);
  assert.equal(ITEMS.reactor_seal_ring.salvage, 15);
});

test("whose a keepsake is: whoever sleeps nearest a locker, whoever holds the post a desk is, and nobody for the captain's own", () => {
  const game = newGame();
  const all = containers(game);
  const cabins = all.filter((one) => one.room === "cabins");
  assert.ok(cabins.length && cabins.every((one) => ["voss", "tarrow", "halm", "odessa", "bastian"].includes(one.owner)), JSON.stringify(cabins.map((one) => one.owner)));
  assert.equal(all.find((one) => one.room === "medbay" && one.thing.name === "A desk").owner, "aduro", "the medbay's desk is the chief medical officer's");
  assert.ok(all.filter((one) => one.room === "wardroom").every((one) => one.owner === null), "the Wardroom's are the captain's own");
  assert.ok(all.filter((one) => one.room === "boat_bay").every((one) => one.owner === null), "anywhere else, they're anyone's");
  assert.ok(all.filter((one) => one.room === "bunks" && one.thing.name === "A locker").every((one) => one.owner), "every locker in the Hot Bunks is someone's");
  assert.deepEqual(containers(game).map((one) => one.owner), all.map((one) => one.owner), "the same all game");
  assert.equal(keep.containerWords("A footlocker with no name on it"), "footlocker");
  assert.equal(keep.containerWords("A refugee's footlocker"), "footlocker");
});

test("taken from someone's locker, it's missed: they ask after it some hours later, and given back it's done", () => {
  const game = newGame();
  const { owner } = takeHarmonica(game);
  assert.equal(game.inventory.harmonica, 1);
  hours(game, 4);
  assert.equal(game.requests.open?.[KIND], undefined, "not noticed yet");
  const said = hours(game, 6);
  const open = game.requests.open?.[KIND];
  assert.ok(open, said.join("\n"));
  assert.equal(open.asker, owner);
  assert.equal(open.thing, "harmonica");
  assert.equal(open.room, "The Hot Bunks");
  assert.ok(said.some((one) => /^\[REQUEST\] .+ has something to ask you/.test(one)), said.join("\n"));
  assert.ok(rq.asksNow(game, owner));
  const ask = rq.requestScene(game, open).parts.ask.text.join(" ");
  assert.match(ask, /gone missing from my locker in the Hot Bunks: my harmonica/);
  const given = rq.answerRequest(game, KIND, "given");
  assert.ok(given.some((one) => /You give .+ the harmonica/.test(one)), given.join("\n"));
  const done = rq.advanceRequests(game);
  assert.ok(done.some((one) => /^\[REQUEST\] Done: Something gone missing\./.test(one)), done.join("\n"));
  assert.equal(game.inventory.harmonica ?? 0, 0);
  hours(game, 1);
  assert.equal(game.keepsakes.list[0].over, "given");
  assert.ok(game.command.meridian.memory[owner].some((one) => one.kind === "helped"), "they remember it");
  assert.ok(game.story.record.facts.some((one) => one.id === "request_keepsake_done"));
});

test("put back where it was, it's over and nobody asks; dropped somewhere else, an ask that's waiting goes", () => {
  const back = newGame();
  const found = takeHarmonica(back);
  hours(back, 1);
  assert.equal(back.keepsakes.list.length, 1, "missed");
  bag.bagCommand(back, { action: "open", key: keyOf(found.thing) });
  const where = back.bag.pockets.find((one) => one.id === "harmonica") ? { at: "pockets", ...back.bag.pockets.find((one) => one.id === "harmonica") } : { at: "pack", ...back.bag.pack.find((one) => one.id === "harmonica") };
  bag.bagCommand(back, { action: "drop", from: { at: where.at, x: where.x, y: where.y } });
  bag.bagCommand(back, { action: "close" });
  hours(back, 10);
  assert.equal(back.keepsakes.list[0].over, "put back");
  assert.equal(back.requests.open?.[KIND], undefined);

  const gone = newGame();
  takeHarmonica(gone);
  hours(gone, 10);
  assert.ok(gone.requests.open?.[KIND], "asked");
  gone.inventory.harmonica = 0;
  hours(gone, 1);
  assert.equal(gone.requests.open?.[KIND], undefined, "with nothing to give back, the ask that was waiting goes");
});

test("told no, they remember it and never ask about that keepsake again; said yes and never given, it fails", () => {
  const no = newGame();
  const { owner } = takeHarmonica(no);
  hours(no, 10);
  rq.answerRequest(no, KIND, "no");
  assert.ok(no.command.meridian.memory[owner].some((one) => one.kind === "turned_down"));
  hours(no, 24 * 9);
  assert.equal(no.requests.open?.[KIND], undefined, "a week's rest over, still not asked again");
  assert.equal(no.keepsakes.list[0].asked, true);

  const yes = newGame();
  takeHarmonica(yes);
  hours(yes, 10);
  rq.answerRequest(yes, KIND, "yes");
  const said = hours(yes, 50);
  assert.ok(said.some((one) => /^\[REQUEST\] Failed: Something gone missing\./.test(one)), said.join("\n"));
});

test("the checker knows the keepsake's lines: {thing} only with about: a keepsake you took, and that about only to give it back", () => {
  const request = (top) => parseSceneText(`# T\n${top}\nby: 1 day\n\n== ask\n@{asker}: "?"\n> Yes -> yes\n\n== yes\n@{asker}: "Y."\n\n== done\n@{asker}: "D."\n\n== failed\n@{asker}: "F."\n\n== gone\n@{asker}: "G."\n`, "request_t").scene;
  const problems = (top) => rq.compileRequest("t", request(top)).problems;
  assert.deepEqual(problems("about: a keepsake you took\nasks: them\nneeds: give 1 {thing} to {asker}"), []);
  assert.ok(problems("asks: the quartermaster\nneeds: give 1 {thing} to {asker}").some((one) => /needs about: a keepsake you took/.test(one)));
  assert.ok(problems("about: a keepsake you took\nasks: them\nneeds: talk to the quartermaster").some((one) => /is for a request to give it back/.test(one)));
});
