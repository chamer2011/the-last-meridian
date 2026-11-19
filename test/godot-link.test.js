// The Godot view's line to the game, over the real server (server.js, the routes under /api/godot/): what it's told
// with no game open and a new game started from there, the place and the room of a game being played, the clock run
// from Godot and left alone while the game's own page is running it, a fight in the room fought from Godot, the story
// and a talk as Godot is handed them, and that only a game Godot started itself is Godot's to stop.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-link-"));
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
// The story answers a line at a time: this only wants to know it was taken.
const told = async (address, route, body) => (await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).text();
const { projectDir } = await import("../src/paths.js");

const servers = [];
async function startServer(more = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-link-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port), GAME_LICENSED_DIR: path.join(data, "no-packs"), ...more };
  delete env.ALMAGEST_STARTED_BY_GODOT;
  Object.assign(env, more);
  const child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  servers.push(child);
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
  const address = `http://127.0.0.1:${port}`;
  const get = async (route) => {
    const res = await fetch(address + route);
    return { status: res.status, ...(await res.json()) };
  };
  const post = async (route, body = {}) => {
    const res = await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  return { child, data, get, post, address };
}
after(() => {
  for (const child of servers) child.kill();
});

// A game past its opening, so that nothing of the story is waiting: a save left for the server to open.
function leaveSave(data, slot = "slot1") {
  const game = createGameFromDraft(randomDraft({ seed: 17, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  fs.writeFileSync(path.join(data, "saves", `${slot}.json`), JSON.stringify(game));
}

test("with no game open, Godot is told so, and which saves there are", async () => {
  const { data, get, post } = await startServer();
  const none = await get("/api/godot/place");
  assert.equal(none.status, 200);
  assert.equal(none.game, false);
  assert.ok(none.saves.every((save) => save.empty), "no save yet");
  assert.equal((await post("/api/godot/tick", { ms: 500, rate: 10 })).status, 400, "and there's no clock to run");
  // It's also told which copy of the game this is: a copy with no saves of its own is the usual reason for that screen.
  assert.equal(none.where.folder, projectDir);
  assert.equal(none.where.saves, path.join(data, "saves"));
  assert.deepEqual(none.where.unread, []);
  assert.equal(none.where.art, false, "this copy has no art packs");
  leaveSave(data);
  fs.writeFileSync(path.join(data, "saves", "slot2.json"), '{"name": "Cut short", ');
  const some = await get("/api/godot/place");
  assert.deepEqual(some.saves.filter((save) => !save.empty).map((save) => save.slot), ["slot1"]);
  assert.deepEqual(some.where.unread.map((one) => one.slot), ["slot2"], "a save that's there and can't be opened is named");
  assert.ok(some.where.unread[0].why.length > 0);
});

test("with no game open, a new one is started from Godot with a captain the game makes itself", async () => {
  const { get, post } = await startServer();
  const made = await post("/api/creator/random", { anyone: false });
  assert.equal(made.status, 200);
  assert.equal(made.draft.start, "captain");
  // The captain goes through Godot and back as plain JSON.
  const begun = await post("/api/new", { draft: JSON.parse(JSON.stringify(made.draft)) });
  assert.equal(begun.status, 200);
  const place = await get("/api/godot/place");
  assert.equal(place.game, true);
  assert.equal(place.place.id, "meridian");
  assert.equal((await get("/api/godot/story")).untold, true, "and its story is still to be told, which Godot starts by itself");
});

test("a game being played: the place, the room, the clock, and where the player is", async () => {
  const { data, get, post } = await startServer();
  leaveSave(data);
  assert.equal((await post("/api/load", { slot: "slot1" })).status, 200);
  const place = await get("/api/godot/place");
  assert.equal(place.status, 200);
  assert.equal(place.game, true);
  assert.equal(place.place.id, "meridian");
  assert.equal(place.decks.length, 3);
  assert.equal(place.walk.place.id, "meridian");
  assert.ok(place.walk.floor.length > 0 && place.walk.people.length > 0, "the room as it stands comes with it");
  assert.deepEqual(place.state, { combat: false, talk: false, check: false, computer: false, over: false });
  const level = await get("/api/godot/level/deck2");
  assert.equal(level.deck.id, "deck2");
  assert.equal((await get("/api/godot/level/deck9")).status, 400);

  // The clock runs for Godot as it does for the page: a minute of the game for six seconds at the usual speed.
  const first = await post("/api/godot/tick", { ms: 2000, rate: 300 });
  assert.equal(first.status, 200);
  assert.ok(first.clock.hours > place.clock.hours, "time has passed");
  assert.equal(first.here, "deck1");
  assert.ok(Array.isArray(first.people));
  assert.deepEqual(first.at, { level: "deck1", x: place.walk.captain.x, y: place.walk.captain.y });
  assert.equal(first.shared, undefined);
  assert.equal(typeof first.saved, "number");

  // Walking is the page's own route, and the tick says where the game has the player afterwards.
  const there = await post("/api/walk", { action: "go", to: "exit:1" });
  assert.equal(there.status, 200);
  const moved = await post("/api/godot/tick", { ms: 0, rate: 10 });
  assert.equal(moved.at.level, there.walk.here.deck.id);
  assert.notEqual(moved.at.level, "deck1");
  const room = await get("/api/godot/walk");
  assert.deepEqual(room.walk.captain, there.walk.captain);

  // Something done in the game's own window is a save more, which is how Godot knows to look at the room again.
  const before = (await post("/api/godot/tick", { ms: 0, rate: 10 })).saved;
  assert.equal((await post("/api/systems", { row: "lights:light_switch:mess", to: "off" })).status, 200);
  const afterwards = await post("/api/godot/tick", { ms: 0, rate: 10 });
  assert.ok(afterwards.saved > before, "the change shows");
  const dark = await get("/api/godot/level/deck2");
  assert.equal(dark.deck.areas.find((area) => area.id === "mess").dark, true);
});

test("while the game's own page is running the clock, Godot's asking moves no time", async () => {
  const { data, post } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const page = await post("/api/tick", { ms: 500, rate: 10 });
  const godot = await post("/api/godot/tick", { ms: 2000, rate: 300 });
  assert.equal(godot.shared, true);
  assert.equal(godot.clock.hours, page.clock.hours, "the clock stood still for Godot");
  // A talk stops the clock for both, and Godot is told there's one.
  const person = page.people.find((one) => !one.asleep && !one.crowd) ?? page.people[0];
  await post("/api/walk", { action: "go", to: `person:${person.key}` });
  assert.equal((await post("/api/talk", { action: "open", person: person.key })).status, 200);
  const held = await post("/api/godot/tick", { ms: 500, rate: 10 });
  assert.equal(held.held, true);
  assert.equal(held.state.talk, true);
});

test("a fight in the room is fought from Godot with the page's own orders, on one clock", async () => {
  const { data, get, post } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const room = await get("/api/godot/walk");
  const someone = room.walk.people.find((one) => !one.asleep && !one.down && !one.crowd) ?? room.walk.people[0];
  await post("/api/walk", { action: "go", to: `person:${someone.key}` });
  assert.equal((await post("/api/walk", { action: "attack", key: `person:${someone.key}` })).status, 200);
  // Godot hears there's a fight from its tick, which stands still for it, and asks what the fight is.
  const heard = await post("/api/godot/tick", { ms: 500, rate: 10 });
  assert.equal(heard.held, true);
  assert.equal(heard.state.combat, true);
  const begun = await get("/api/godot/combat");
  assert.equal(begun.combat.live, null, "it hasn't been moved into the room yet");
  assert.equal(begun.combat.round, 1);
  assert.ok(begun.combat.enemies.length >= 1);
  assert.equal(typeof begun.storyWaiting, "boolean");
  // It moves into the room, and says where everyone is.
  assert.equal((await post("/api/combat", { action: "live" })).status, 200);
  const live = (await get("/api/godot/combat")).combat;
  assert.ok(live.live, "the fight is in the room");
  assert.ok(Number.isFinite(live.live.you.x) && Number.isFinite(live.live.you.y));
  for (const enemy of live.enemies) assert.ok(live.live.fighters[enemy.key], `${enemy.name} has a place in the room`);
  assert.ok(live.actions.some((one) => one.action.type === "attack"), "there are orders to give");
  // An order, then time: the fight goes on for Godot as it does for the page.
  const ordered = await post("/api/combat", { type: "attack", target: live.enemies[0].key });
  assert.equal(ordered.status, 200);
  const went = await post("/api/combat", { action: "tick", ms: 400, view: "godot" });
  assert.equal(went.status, 200);
  const t1 = went.combat?.live.t ?? null;
  if (t1 !== null) {
    assert.ok(t1 > live.live.t, "time passed in the fight");
    // While the page is running the fight, Godot's asking moves no time in it.
    const page = await post("/api/combat", { action: "tick", ms: 100 });
    if (!page.outcome.over) {
      const still = await post("/api/combat", { action: "tick", ms: 400, view: "godot" });
      if (!still.outcome.over) assert.equal(still.combat.live.t, page.combat.live.t, "the fight stood still for Godot");
    }
  }
});

test("the story and a talk as Godot is handed them: pieces, who says them, and what can be answered", async () => {
  const { get, post, address } = await startServer();
  assert.equal((await post("/api/new", { draft: randomDraft({ seed: 7, archetype: "officer" }) })).status, 200);
  const untold = await get("/api/godot/story");
  assert.equal(untold.untold, true);
  assert.deepEqual(untold.beats, []);
  // The opening, told: read in pieces, each piece of speech by someone in the room keyed to them.
  await told(address, "/api/chat", { event: "start" });
  const opening = await get("/api/godot/story");
  assert.equal(opening.untold, false);
  assert.ok(opening.beats.length >= 2, "the opening comes in pieces");
  assert.ok(opening.beats.every((beat) => ["narration", "speech", "consequence"].includes(beat.type) && beat.parts.every((part) => typeof part.text === "string")));
  const room = (await get("/api/godot/walk")).walk;
  const spoken = opening.beats.filter((beat) => beat.type === "speech");
  assert.ok(spoken.length > 0, "someone speaks");
  for (const beat of spoken.filter((one) => one.key && one.key !== "you")) assert.ok(room.people.some((person) => person.key === beat.key), `${beat.speaker} is in the room`);
  assert.ok(opening.choices.length >= 2, "and there's something to answer");
  assert.ok(opening.choices.every((choice) => typeof choice.label === "string" && Array.isArray(choice.chips)));
  // The choices hang off whoever the scene is waiting on, with what they last said.
  assert.equal(opening.anchor.key, opening.scene.with);
  assert.ok(Array.isArray(opening.anchor.said));
  // A choice taken: what's shown afterwards is what's been told since, starting with the player's own words.
  const before = Number(opening.id.split("|")[2]);
  await told(address, "/api/chat", { text: opening.choices[0].label });
  const next = await get(`/api/godot/story?from=${before}`);
  assert.equal(next.said, opening.choices[0].label);
  assert.notEqual(next.id, opening.id);
});

test("a talk is handed to Godot with the person's words and the lines to say", async () => {
  const { data, get, post, address } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const room = (await get("/api/godot/walk")).walk;
  const person = room.people.find((one) => !one.asleep && !one.down && !one.crowd);
  await post("/api/walk", { action: "go", to: `person:${person.key}` });
  assert.equal((await post("/api/talk", { action: "open", person: person.key })).status, 200);
  const opened = (await get("/api/godot/story")).talk;
  assert.equal(opened.key, person.key);
  assert.ok(opened.said.length > 0, "they speak first");
  assert.equal(opened.choices.at(-1).order, "close", "the last line is goodbye");
  assert.equal((await post("/api/godot/tick", { ms: 500, rate: 10 })).state.talk, true);
  // A line said: their answer is the newest thing, and the player's own words are kept to show over it.
  const line = opened.choices.find((choice) => choice.say);
  if (line) {
    await told(address, "/api/talk", { action: "say", text: line.say });
    const answered = (await get("/api/godot/story")).talk;
    assert.equal(answered.heard, line.say);
    assert.ok(answered.lines > opened.lines);
  }
  assert.equal((await post("/api/talk", { action: "close" })).status, 200);
  assert.equal((await get("/api/godot/story")).talk, null);
});

test("who the player is comes with the clock, and the game is handed to the menus without the saves unless they're asked for", async () => {
  const { data, get, post } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const place = await get("/api/godot/place");
  const tick = await post("/api/godot/tick", { ms: 0, rate: 10 });
  for (const you of [place.you, tick.you, (await get("/api/godot/walk")).you]) {
    assert.equal(typeof you.name, "string");
    assert.ok(you.hp > 0 && you.hp <= you.maxHp && you.energy <= you.maxEnergy);
    assert.equal(you.captain, true);
    assert.equal(typeof you.credits, "number");
    assert.equal(typeof you.stress, "number");
    assert.equal(typeof you.fuel, "number");
  }
  const plain = await get("/api/godot/game");
  assert.equal(plain.game.name, place.you.name);
  assert.equal(plain.saves, undefined);
  assert.equal(plain.setup, undefined);
  const full = await get("/api/godot/game?saves&setup");
  assert.ok(Array.isArray(full.saves) && full.setup);
});

test("a skill check is handed to Godot as its window shows it, and played with the page's own commands", async () => {
  const { data, get, post } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  assert.equal((await get("/api/godot/check")).check, null, "none open yet");
  const room = (await get("/api/godot/walk")).walk;
  const someone = room.people.find((one) => !one.asleep && !one.down && !one.crowd && !one.wary) ?? room.people[0];
  await post("/api/walk", { action: "go", to: `person:${someone.key}` });
  // Picking a pocket is a Stealth check: the room's own order opens it.
  const opened = await post("/api/walk", { action: "pickpocket", key: someone.key });
  assert.equal(opened.status, 200);
  assert.equal((await post("/api/godot/tick", { ms: 500, rate: 10 })).state.check, true);
  const { check } = await get("/api/godot/check");
  assert.equal(check.skill, "stealth");
  assert.equal(typeof check.window, "string");
  assert.equal(typeof check.theme, "string");
  assert.ok(check.panels.length >= 1 && check.panels.every((panel) => typeof panel.title === "string"));
  assert.ok(check.commands.length >= 1 && check.commands.every((entry) => typeof entry.command === "string" && typeof entry.label === "string"));
  assert.ok(check.odds >= 0 && check.odds <= 100);
  assert.equal(check.target, `person:${someone.key}`);
  // The roll, made at once: it's over, with how it came out to show.
  const rolled = await post("/api/check", { command: "run" });
  assert.equal(rolled.over, true);
  assert.equal(typeof rolled.outcome.title, "string");
  assert.equal(typeof rolled.outcome.math, "string");
  assert.equal(typeof rolled.outcome.success, "boolean");
  assert.equal((await get("/api/godot/check")).check, null);
});

test("what the player carries is handed to Godot as the inventory's window shows it, and moved with the page's own orders", async () => {
  const { data, get, post } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const carried = await get("/api/godot/bag");
  assert.equal(typeof carried.name, "string");
  assert.equal(typeof carried.credits, "number");
  assert.ok(carried.body && typeof carried.body === "object");
  const { bag } = carried;
  assert.ok(bag.pack.cols > 0 && bag.pack.rows > 0 && Array.isArray(bag.pack.items));
  assert.ok(bag.pockets.cols > 0 && Array.isArray(bag.belt) && bag.gear && "weapon" in bag.gear);
  assert.equal(bag.open, null);
  assert.equal(typeof bag.load, "number");
  // Something in the pack, moved to another square of it: the answer has the pack as it now is.
  const item = bag.pack.items[0];
  assert.ok(item && Number.isInteger(item.x) && Number.isInteger(item.w), "there's something in the pack, with its place and size");
  const to = { at: "pack", x: bag.pack.cols - item.w, y: bag.pack.rows - item.h };
  const moved = await post("/api/bag", { action: "move", from: { at: "pack", x: item.x, y: item.y }, to });
  assert.equal(moved.status, 200);
  assert.ok(moved.game.bag.pack.items.some((one) => one.id === item.id && one.x === to.x && one.y === to.y));
  assert.deepEqual((await get("/api/godot/bag")).bag.pack, moved.game.bag.pack);
});

test("only a game Godot started is Godot's to stop, and it saves before it does", async () => {
  const ours = await startServer();
  const refused = await ours.post("/api/godot/stop");
  assert.equal(refused.status, 400);
  assert.match(refused.error, /wasn't started by the Godot view/);
  assert.equal(ours.child.exitCode, null, "it's still running");

  const theirs = await startServer({ ALMAGEST_STARTED_BY_GODOT: "1" });
  leaveSave(theirs.data);
  await theirs.post("/api/load", { slot: "slot1" });
  // A walk is saved a second later, unless the game is stopped first: then it's saved at once.
  const walked = await theirs.post("/api/walk", { action: "go", to: "exit:1" });
  const stopped = await theirs.post("/api/godot/stop");
  assert.equal(stopped.stopped, true);
  await new Promise((resolve) => theirs.child.on("exit", resolve));
  const kept = JSON.parse(fs.readFileSync(path.join(theirs.data, "saves", "autosave.json"), "utf8"));
  assert.equal(kept.walk.level, walked.walk.here.deck.id, "where the player had walked to was saved");
});
