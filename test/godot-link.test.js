// The Godot view's line to the game, over the real server (server.js, the routes under /api/godot/): what it's told
// with no game open, the place and the room of a game being played, the clock run from Godot and left alone while the
// game's own page is running it, and that only a game Godot started itself is Godot's to stop.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-link-"));
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
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
  return { child, data, get, post };
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
  leaveSave(data);
  const some = await get("/api/godot/place");
  assert.deepEqual(some.saves.filter((save) => !save.empty).map((save) => save.slot), ["slot1"]);
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
