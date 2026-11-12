// The systems played together over the real server, the way a player would: the written story, using things, working
// the place's parts and their checks with the clock running, computers, picking pockets and a fight, the alarm, midnight
// with a check open, words the story has no answer for, a jump to Haven, and a life that isn't the captain's. What
// must always hold is looked at after every step: never a check and a fight at once, never a computer with either,
// credits and health that are numbers and not below nothing, standing within -100 to 100, a clock that never goes back,
// nobody in a room twice, and every line of the story a line of text.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-together-"));
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { projectDir } = await import("../src/paths.js");

let server;
let address;
// The server's own data folder, where a test can leave a saved game for it to open.
let data;
before(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-together-server-"));
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

// ---- Playing ------------------------------------------------------------------------------------

const problems = [];
const problem = (where, what) => problems.push(`${where}: ${what}`);

async function call(route, body = {}) {
  const res = await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const error = lines.find((line) => line.type === "error")?.message ?? null;
    if (error && /Unexpected error|TypeError|ReferenceError|Cannot read|is not a function/.test(error)) problem(route, error);
    return { status: res.status, error };
  }
  const reply = { status: res.status, ...(await res.json()) };
  if (reply.status >= 500) problem(`${route} ${JSON.stringify(body).slice(0, 80)}`, reply.error);
  return reply;
}
const state = async () => (await (await fetch(`${address}/api/state`)).json()).game;
const tick = async (times) => {
  for (let i = 0; i < times; i += 1) await call("/api/tick", { ms: 2000, rate: 300 });
};

let lastHours = -Infinity;
async function holds(where) {
  const g = await state();
  if (g.check && g.combat) problem(where, "a check and a fight at once");
  if (g.computer && (g.check || g.combat)) problem(where, "a computer open with a check or a fight");
  if (!Number.isFinite(g.credits) || g.credits < 0) problem(where, `credits are ${g.credits}`);
  if (!Number.isFinite(g.hp) || g.hp < 0) problem(where, `health is ${g.hp}`);
  if (g.clock.hours + 1e-6 < lastHours) problem(where, `the clock went back from ${lastHours} to ${g.clock.hours}`);
  lastHours = g.clock.hours;
  for (const one of g.factions) if (!Number.isFinite(one.value) || one.value < -100 || one.value > 100) problem(where, `standing with ${one.id} is ${one.value}`);
  const keys = new Set();
  for (const person of g.walk?.people ?? []) {
    if (keys.has(person.key)) problem(where, `${person.key} is in the room twice`);
    keys.add(person.key);
  }
  for (const entry of g.transcript) if (typeof entry.text !== "string") problem(where, "a line of the story that isn't text");
  return g;
}

async function finishCheck() {
  for (let i = 0; i < 6 && (await state()).check; i += 1) {
    const { check } = await state();
    await call("/api/check", { command: check.decided ? "disconnect" : "run" });
  }
}
async function finishFight() {
  for (let i = 0; i < 60 && (await state()).combat; i += 1) await call("/api/combat", { type: i > 40 ? "flee" : "attack" });
}
async function logOff() {
  if ((await state()).computer) await call("/api/computer", { action: "logoff" });
}

// Everything that can be done in the room: things used, the place's parts worked, pockets picked, and a fight. Who's
// in a room depends on how the dice went earlier, so what was done is counted over the whole game.
const done = { used: 0, worked: 0, pockets: 0, fights: 0 };
async function workTheRoom(where) {
  let g = await holds(`${where}, arriving`);
  if (!g.walk) return;
  // On a deck, the whole deck's things are shown: the ones worked are the room's own.
  const inRoom = (one) => !g.walk.here.deck || one.room === g.walk.here.id;
  for (const thing of g.walk.things.filter((one) => !one.part && inRoom(one)).slice(0, 4)) {
    await call("/api/walk", { action: "go", to: `thing:${thing.id}` });
    const used = await call("/api/walk", { action: "use", key: thing.id });
    if (used.status === 200) done.used += 1;
    if (used.check) await finishCheck();
    if ((await state()).computer) {
      await tick(3);
      await call("/api/computer", { action: "home" });
      await logOff();
    }
    await holds(`${where}, after using ${thing.name}`);
  }
  g = await state();
  for (const part of g.walk.things.filter((one) => one.part && inRoom(one)).slice(0, 6)) {
    for (const action of part.actions ?? []) {
      const reply = await call("/api/walk", { action: "work", key: part.id, how: action.id });
      if (reply.status === 200) done.worked += 1;
      if (reply.check) {
        await tick(4);
        await holds(`${where}, during ${action.label} on ${part.name}`);
        await finishCheck();
      }
      await logOff();
      await holds(`${where}, after ${action.label} on ${part.name}`);
    }
  }
  g = await state();
  const people = g.walk.people.filter(inRoom).slice(0, 2);
  for (const person of people) {
    const picked = await call("/api/walk", { action: "pickpocket", key: person.key });
    if (!picked.check) continue;
    done.pockets += 1;
    await tick(2);
    await finishCheck();
    await holds(`${where}, after picking ${person.short}'s pocket`);
    const again = await call("/api/walk", { action: "pickpocket", key: person.key });
    if (again.status !== 400) problem(where, `${person.short}'s pocket could be picked twice running`);
  }
  if (people.length) {
    const attacked = await call("/api/walk", { action: "attack", key: people.at(-1).key });
    if (attacked.combat) {
      done.fights += 1;
      await finishFight();
    }
    await holds(`${where}, after the fight`);
  }
}

// The nearest of the other side the player can hit from where they stand, from what the fight sends the page.
function nearestSeen(combat) {
  const live = combat?.live;
  if (!live || combat.you.hp <= 0) return null;
  let best = null;
  for (const enemy of combat.enemies) {
    const spot = live.fighters[enemy.key];
    if (enemy.hp <= 0 || enemy.out || !spot || !live.sight[enemy.key]?.ok) continue;
    const far = Math.hypot((spot.x - live.you.x) * 0.5, spot.y - live.you.y);
    if (!best || far < best.far) best = { key: enemy.key, far };
  }
  return best?.key ?? null;
}

test("a new game opens with the mutiny: the alarm, a choice, the battle fought out across the deck, the story going on from how it ended, and then the room's things, parts, pockets and a fight", async () => {
  await call("/api/new", { draft: randomDraft({ seed: 7, archetype: "officer" }) });
  const opening = await call("/api/chat", { event: "start" });
  assert.equal(opening.error, null);
  let g = await holds("the alarm");
  assert.equal(g.scene.id, "opening_captain");
  assert.equal(g.walk.here.name, "The Bridge");
  assert.deepEqual(g.questLog.quests, []);
  const chose = await call("/api/chat", { text: "Hold the bridge" });
  assert.equal(chose.error, null);
  g = await holds("the battle begins");
  assert.ok(g.combat?.live, "the battle is fought in the room");
  assert.equal(g.combat.battle.title, "The Red Cloth");
  assert.ok(g.combat.allies.length >= 5, `${g.combat.allies.length} on the player's side`);
  assert.equal(g.combat.enemies.length, 6, "the first of them, with more to come");
  assert.ok(!g.combat.actions.some((one) => ["flee", "surrender"].includes(one.action.type)), "no running from it, and no giving up in it");
  assert.equal((await call("/api/chat", { text: "Hold the bridge" })).status, 400, "the story waits for the battle");
  // Fought the way the page does it: time going by half a second at a time, and the player going for the nearest of them.
  let combat = g.combat;
  let over = null;
  for (let i = 0; i < 1200 && !over; i += 1) {
    const target = nearestSeen(combat);
    if (target && target !== combat.live.you.target) await call("/api/combat", { type: "attack", target });
    const reply = await call("/api/combat", { action: "tick", ms: 500 });
    if (reply.status !== 200) problem("the battle", reply.error);
    if (reply.outcome?.over) over = reply.outcome;
    else combat = reply.combat;
    if (i % 20 === 0) await holds(`the battle, ${i / 2} seconds in`);
  }
  assert.ok(over, "the battle ended");
  assert.match(over.summary, /The Red Cloth/);
  g = await holds("after the battle");
  assert.equal(g.combat, null);
  assert.equal(g.storyWaiting, true, "the story goes on from how it ended");
  const carried = await call("/api/chat", { event: "continue" });
  assert.equal(carried.error, null);
  g = await holds("after the opening");
  assert.equal(g.scene, null, "the opening is over");
  assert.ok(g.transcript.some((one) => one.role === "combat" && /The Red Cloth/.test(one.text)), "the story keeps how it went");
  // Wherever the opening left the player, on the bridge or come to in the medbay, the room works.
  await workTheRoom(over.result === "defeat" ? "the medbay" : "the bridge");
  assert.ok(done.used > 0 && done.worked > 0, JSON.stringify(done));
  assert.deepEqual(problems, []);
});

test("midnight comes with a check open, and the alarm rings and stops, with nothing breaking", async () => {
  await call("/api/check/start", { practice: "engineering", difficulty: "moderate" });
  const dayOf = (g) => Math.floor(g.clock.hours / 24);
  const day = dayOf(await state());
  for (let i = 0; i < 40 && dayOf(await state()) === day; i += 1) await tick(5);
  const g = await holds("after midnight with a check open");
  assert.notEqual(dayOf(g), day, "midnight came");
  await finishCheck();
  await call("/api/systems", { row: "alarm", to: "ringing" });
  await tick(6);
  await workTheRoom("the bridge with the alarm ringing");
  await call("/api/systems", { row: "alarm", to: "quiet" });
  assert.deepEqual(problems, []);
});

test("words the story has no answer for change nothing, and there's no AI to hand the game to", async () => {
  const before1 = await state();
  const reply = await call("/api/chat", { text: "I look around the bridge." });
  assert.ok(reply.error, "the story says it has no answer");
  const after1 = await state();
  assert.equal(after1.transcript.length, before1.transcript.length);
  assert.equal(after1.storyWaiting, false);
  assert.equal((await call("/api/story", { mode: "ai" })).status, 404);
  await holds("after words with no answer");
  assert.deepEqual(problems, []);
});

test("the Meridian jumps to Haven, and its rooms work the same", async () => {
  const course = await call("/api/ship", { action: "course", id: "haven" });
  assert.equal(course.status, 200, course.error);
  await call("/api/chat", { event: "continue" });
  const g = await holds("at Haven");
  assert.equal(g.location.id, "haven");
  for (const room of (g.walk.overview?.rooms ?? []).filter((one) => !one.closed).slice(0, 2)) {
    await call("/api/walk", { action: "room", to: room.id });
    await tick(3);
    await workTheRoom(`Haven: ${room.name}`);
  }
  assert.deepEqual(problems, []);
});

test("someone who isn't the captain starts, works a shift, sleeps, and can't run the Meridian's systems", async () => {
  const draft = randomDraft({ seed: 11, archetype: "officer" });
  draft.start = "engine_hand";
  // Every life but the captain's is switched off for new games since 2026-11-12, and a game saved with one still
  // opens: this one is left in the server's saves, as if it had been made before.
  const notOffered = await call("/api/new", { draft });
  assert.equal(notOffered.status, 400);
  fs.writeFileSync(path.join(data, "saves", "slot1.json"), JSON.stringify(createGameFromDraft(draft)));
  const loaded = await call("/api/load", { slot: "slot1" });
  assert.equal(loaded.status, 200, JSON.stringify(loaded).slice(0, 200));
  lastHours = -Infinity;
  const opening = await call("/api/chat", { event: "start" });
  assert.equal(opening.error, null);
  const g = await holds("the engine hand's start");
  assert.equal(g.role.captain, false);
  await workTheRoom("the engine hand's room");
  await call("/api/action", { action: "work" });
  await holds("after a shift");
  await call("/api/action", { action: "rest" });
  await holds("after sleeping");
  const refused = await call("/api/systems", { row: "alarm", to: "ringing" });
  assert.equal(refused.status, 400);
  assert.ok(done.pockets > 0 && done.fights > 0, `pockets were picked and fights fought along the way: ${JSON.stringify(done)}`);
  assert.deepEqual(problems, []);
});
