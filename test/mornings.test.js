// The way back after dying (chosen by the owner on 2026-11-16: "to that morning"), played over the real server: it
// keeps a save by itself the first time a game is saved after six each day, three of them at most; once the player
// has died it takes no orders, saves nothing over anything, and offers those mornings; going back to one opens the
// game as it was then; and a player who died in the very thing that crossed into a morning goes back to the game as
// it stood before it, so that dying never costs more than the day.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-mornings-"));
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const { projectDir } = await import("../src/paths.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const { parseEffect } = await import("../src/scene-text.js");
const sys = await import("../src/systems.js");
const { walkCommand } = await import("../src/walk.js");

let server;
let address;
let data;
before(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-mornings-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  address = `http://127.0.0.1:${port}`;
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port) };
  server = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    server.on("exit", () => reject(new Error("The server stopped.")));
  });
});
after(() => {
  server?.kill();
});

async function call(route, payload = {}) {
  const res = await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: res.status, ...(await res.json()) };
}
const state = async () => (await (await fetch(`${address}/api/state`)).json()).game;
const mornings = async () => (await (await fetch(`${address}/api/mornings`)).json()).mornings;
const saved = (slot) => path.join(data, "saves", `${slot}.json`);

// A captain on the bridge at an hour of the game, whose own times without air are the longest a seed gives, so that
// what happens to them falls where a test needs it.
function captainAt(hours, campaign) {
  let best = null;
  for (let seed = 1; seed <= 40; seed += 1) {
    const times = body.airTimes({ bodySeed: seed }, "you");
    if (!best || times.out + times.dead > best.sum) best = { seed, sum: times.out + times.dead, times };
  }
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "captain" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  game.campaign = campaign;
  game.bodySeed = best.seed;
  game.walk = null;
  walkCommand(game, { action: "room", to: "bridge" });
  clockRuns(game, 1);
  passTime(game, hours - game.clock.hours, "routine");
  assert.ok(Math.abs(game.clock.hours - hours) < 1e-6);
  return { game, times: best.times };
}
// The ship's air plant off, with so many minutes of her reserve air left.
function airStops(game, reserveLeft) {
  sys.applySystemsEffect(game, parseEffect("air off").do.systems);
  game.systems.meridian.reserve = 5 * 24 * 60 - reserveLeft;
}
const open = async (game) => {
  fs.writeFileSync(saved("slot1"), JSON.stringify(game));
  const reply = await call("/api/load", { slot: "slot1" });
  assert.equal(reply.status, 200, reply.error);
};

test("a morning is kept the first time the game is saved after six, the dead take no orders, and going back opens that morning", async () => {
  // Day 2, five in the morning, and the ship's air has just gone for good.
  const { game } = captainAt(29, "mornings-one");
  airStops(game, 0);
  await open(game);
  assert.deepEqual(await mornings(), [{ slot: "morning1", when: "Day 2, 05:00", words: "this morning" }], "kept as soon as the game's opened");
  // Ten minutes of the clock at a go, until the air has them.
  for (let i = 0; i < 80 && !(await state()).over; i += 1) await call("/api/tick", { ms: 2000, rate: 300 });
  const dead = await state();
  assert.ok(dead.over, "the captain has died");
  // Where they fell, or on the cot a nurse got them to before the nurses went too.
  assert.match(dead.over.line, /^Died on day 2 aboard the CFS Meridian, for want of air, in (the Bridge|Medbay)\.$/);
  assert.match(dead.over.when, /^Day 2, (0[7-9]|1\d):\d\d$/);
  assert.ok(dead.over.last.length > 0, "with the last of what the story said");
  // Two mornings now: the first save after six, and the one from five.
  const kept = await mornings();
  assert.equal(kept.length, 2, JSON.stringify(kept));
  assert.match(kept[0].when, /^Day 2, 06:[0-2]\d$/);
  assert.equal(kept[0].words, "this morning");
  assert.deepEqual(kept[1], { slot: "morning1", when: "Day 2, 05:00", words: null });
  // Nothing more can be done in a game that's over, and nothing is saved from it.
  const walk = await call("/api/walk", { action: "room", to: "bridge" });
  assert.equal(walk.status, 400);
  assert.match(walk.error, /^This game is over\./);
  assert.equal((await call("/api/ship", { action: "wait", days: 1 })).status, 400);
  assert.equal((await call("/api/save", { slot: "slot2" })).status, 400);
  assert.equal(fs.existsSync(saved("slot2")), false);
  assert.deepEqual(await call("/api/tick", { ms: 2000, rate: 300 }), { status: 200, still: true });
  assert.equal((await state()).clock.label, dead.clock.label, "and the clock has stopped");
  // Opened again later, it's still over: the autosave is the game as it ended.
  assert.ok(JSON.parse(fs.readFileSync(saved("autosave"), "utf8")).over);
  // Back to this morning: alive, at that hour, and the game that ended isn't kept as the previous one.
  const back = await call("/api/load", { slot: kept[0].slot });
  assert.equal(back.status, 200, back.error);
  assert.equal(back.game.over, null);
  assert.equal(back.game.clock.label, kept[0].when);
  assert.equal(back.game.name, dead.name);
  assert.equal(fs.existsSync(saved("previous")), false);
  assert.equal((await call("/api/walk", { action: "room", to: "bridge" })).status, 200, "and it takes orders again");
  // Further back, the morning after it belongs to a future that was left: it's no longer offered.
  assert.equal((await mornings()).length, 2);
  assert.equal((await call("/api/load", { slot: kept[1].slot })).status, 200);
  assert.deepEqual((await mornings()).map((one) => one.when), ["Day 2, 05:00"]);
  // A slot that isn't one is refused, a morning's or the player's own.
  assert.equal((await call("/api/load", { slot: "morning9" })).status, 400);
  assert.equal((await call("/api/save", { slot: "morning1" })).status, 400);
});

test("dying in the very wait that crossed into the morning, the way back is the game as it stood before the wait", async () => {
  // Day 2, eleven at night, the air plant stopped with three hours of reserve air left: it runs out at two, and a
  // captain who lasts as long as anyone does goes down after five and dies after seven.
  const { game, times } = captainAt(47, "mornings-two");
  assert.ok(times.out + times.dead > 270, `${Math.round(times.out + times.dead)} minutes of their own`);
  airStops(game, 180);
  await open(game);
  assert.deepEqual((await mornings()).map((one) => [one.when, one.words]), [["Day 2, 23:00", null]]);
  // Two hours on, something that saves the game: one in the morning, day 3, with the air still good.
  for (let i = 0; i < 12; i += 1) await call("/api/tick", { ms: 2000, rate: 300 });
  assert.equal((await call("/api/action", { action: "difficulty", id: "normal" })).status, 200);
  const then = await state();
  assert.match(then.clock.label, /^Day 3, 01:0\d$/);
  assert.equal((await mornings()).length, 1, "not six yet, so no new morning");
  // Then a day waited in one go, which the captain doesn't see the end of.
  const waited = await call("/api/ship", { action: "wait", days: 1 });
  assert.equal(waited.status, 200, waited.error);
  assert.ok(waited.game.over, "dead inside the wait");
  assert.match(waited.game.over.when, /^Day 3, (0[6-9]|1[01]):\d\d$/, "after six");
  const kept = await mornings();
  assert.deepEqual(kept.map((one) => [one.when, one.words]), [[then.clock.label, "this morning"], ["Day 2, 23:00", null]]);
  const back = await call("/api/load", { slot: kept[0].slot });
  assert.equal(back.status, 200, back.error);
  assert.equal(back.game.over, null);
  assert.equal(back.game.clock.label, then.clock.label);
});

test("a fourth morning takes the place of the oldest, and another game's mornings make way", async () => {
  // Four days waited a day at a time, on a ship that's kept in fuel: three mornings are kept, the last three.
  const { game } = captainAt(30.5, "mornings-three");
  game.test = { fuel: true };
  await open(game);
  for (let day = 0; day < 4; day += 1) assert.equal((await call("/api/ship", { action: "wait", days: 1 })).status, 200);
  assert.deepEqual((await mornings()).map((one) => one.when), ["Day 6, 06:30", "Day 5, 06:30", "Day 4, 06:30"]);
  for (const slot of ["morning1", "morning2", "morning3"]) assert.equal(JSON.parse(fs.readFileSync(saved(slot), "utf8")).campaign, "mornings-three");
  // Another game opened: its own morning is kept, and none of the first game's is offered to it.
  const other = captainAt(33, "mornings-four").game;
  await open(other);
  assert.deepEqual((await mornings()).map((one) => one.when), ["Day 2, 09:00"]);
});
