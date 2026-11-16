// The logistics rework, step 6: a job nobody can do becomes an ask, and the story knows. A job on the work board that
// has waited too long, with nobody able to do it or nothing aboard to do it with, is brought to the player by whoever
// that part of the ship belongs to, through the requests: yes, not now or no. Yes to a job with no hands makes it the
// player's until it's due; yes to one with no goods is a promise to bring them aboard. And the written story can ask
// about the board and change it: whether a job is waiting, what comes first, and a job of its own. None of this calls
// an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-asks-"));
// Some tests write another file, so the real one is copied first and never written.
const logisticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-work-asks-files-"));
fs.copyFileSync(new URL("../world/logistics/meridian.txt", import.meta.url), path.join(logisticsDir, "meridian.txt"));
process.env.GAME_LOGISTICS_DIR = logisticsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const bag = await import("../src/bag.js");
const cmd = await import("../src/command.js");
const em = await import("../src/emergencies.js");
const sys = await import("../src/systems.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const { countAboard, logisticsOf, logisticsProblems, putAboard, takeAboard } = await import("../src/logistics.js");
const { boardView, workCommand } = await import("../src/work.js");
const { notePut, putsOf } = await import("../src/puts.js");
const { readRecord } = await import("../src/record.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { factsLeft, loadScenes, sceneProblems } = await import("../src/scenes.js");
const { addDetour } = await import("../src/room-hooks.js");
const { storyRequest } = await import("../src/request-hook.js");
const { clearLife } = await import("../src/life.js");
const { reloadLogistics } = await import("../src/world.js");
const { parseLogisticsText, readAskers, readWaiting, writeLogisticsText } = await import("../public/logistics-text.js");
// The dice are held still while the clock runs here: in play a fire or a breach can start by chance, and an engineer
// would be sent to it, off whatever these tests are watching. Just under 1 is "it never happens".
const rules = await import("../src/rules.js");
function calmly(play) {
  const real = Math.random;
  Math.random = () => 0.99;
  try {
    return play();
  } finally {
    Math.random = real;
  }
}
const clockRuns = (game, minutes) => calmly(() => rules.clockRuns(game, minutes));
const { publicState } = rules;

const SHIP = "meridian";
// A captain past the opening, on a ship where nothing wears out by itself.
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "Begun." });
  game.scene = null;
  game.wearDay = Infinity;
  return game;
};
const FILE = fs.readFileSync(path.join(logisticsDir, "meridian.txt"), "utf8");
const storeOf = (id) => logisticsOf(SHIP).stores.find((one) => one.id === id);
const count = (game, id, item) => bag.storeCounts(game, storeOf(id).key, storeOf(id).holds)[item] ?? 0;
const take = (game, id, item, n) => bag.storeTake(game, storeOf(id).key, storeOf(id).holds, item, n);
const put = (game, id, item, n) => bag.storePut(game, storeOf(id).key, storeOf(id).holds, item, n);
const at = (game, hours) => {
  game.clock.hours = hours;
  clockRuns(game, 1);
};
// Five minutes at a time, as the clock is counted, gathering what the story's told.
function run(game, minutes) {
  const said = [];
  for (let gone = 0; gone < minutes; gone += 5) {
    const told = clockRuns(game, 5);
    said.push(...(Array.isArray(told) ? told : told?.notes ?? []));
  }
  return said;
}
// Runs the clock until something holds, and says what was told on the way.
function until(game, holds, most = 600) {
  const said = [];
  for (let gone = 0; gone < most && !holds(); gone += 5) said.push(...run(game, 5));
  assert.ok(holds(), `it came about within ${most} minutes`);
  return said;
}
const waiting = (game) => game.logistics[SHIP].waiting ?? {};
const mine = (game) => game.logistics[SHIP].orders?.mine ?? {};
const jobs = (game) => game.logistics[SHIP].jobs ?? [];
const row = (game, id) => boardView(game, SHIP).jobs.find((one) => one.id === id) ?? null;
const open = (game, kind) => game.requests?.open?.[kind] ?? null;
const questOf = (game, kind) => [...(game.quests ?? [])].reverse().find((one) => one.request === kind) ?? null;
const facts = (game) => readRecord(game).facts.map((one) => one.id);
const minutesNow = (game) => Math.floor(game.clock.hours * 60 + 1e-6);
// Something outside the board that takes people, as walking with the player or a brawl would (src/room-hooks.js).
const wanted = new Set();
addDetour((game, place) => (place === SHIP && wanted.size ? (key) => (wanted.has(key) ? { where: "@bridge", doing: "wanted on the bridge" } : null) : null));
function holding(keys, play) {
  for (const key of keys) if (key) wanted.add(key);
  try {
    return play();
  } finally {
    wanted.clear();
  }
}
// Everyone a store's line names to carry for it, and everyone who mends.
function carriersOf(game, id) {
  const out = new Set();
  for (const one of storeOf(id).carriers) {
    const keys = one.spare ? cmd.onJob(game, SHIP, null) : one.job ? cmd.onJob(game, SHIP, one.job) : [one.post ? cmd.holderKey(game, SHIP, one.post) : one.key];
    for (const key of keys) if (key) out.add(key);
  }
  return [...out];
}
const engineers = (game) => sys.engineersOf(game, SHIP);
const everyone = (game) => [...new Set([...carriersOf(game, "pantry"), ...carriersOf(game, "fuel_rack"), ...carriersOf(game, "medicine_cabinet"), ...engineers(game)])];
// Nothing comes aboard from nowhere meanwhile.
function withoutRefills(play) {
  const model = logisticsOf(SHIP);
  const refills = model.refills;
  model.refills = [];
  try {
    return play();
  } finally {
    model.refills = refills;
  }
}
// The game with the ship's file written another way, and the real words put back afterwards.
function withFile(change, play) {
  const text = change(FILE);
  assert.notEqual(text, FILE, "the file was changed for this test");
  const write = (words) => {
    fs.writeFileSync(path.join(logisticsDir, "meridian.txt"), words);
    reloadLogistics();
    walk.clearMaps();
    clearLife();
  };
  write(text);
  try {
    return play();
  } finally {
    write(FILE);
  }
}
// The player goes to whoever has something to ask, hears it, and answers.
function hear(game, key) {
  walk.bringOver(game, [key]);
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  return game.talk.lastReply;
}
function say(game, words) {
  const said = [];
  talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.type !== "state") said.push(e.text); } });
  return said.join("\n");
}
function answer(game, key, words) {
  const first = hear(game, key);
  const said = say(game, words);
  walk.closeTalk(game);
  return { first, said };
}
const holds = (game, text) => {
  assert.deepEqual(parseCondition(text).problems, [], text);
  return conditionHolds(game, text);
};
const play = (game, text) => {
  const read = parseEffect(text);
  assert.equal(read.problem, undefined, `${text}: ${read.problem}`);
  return cmd.storyCommand(game, read.do);
};
// A request turned off or on, as a scene's * request line does it.
const request = (game, text) => {
  const read = parseEffect(text);
  assert.equal(read.problem, undefined, `${text}: ${read.problem}`);
  return storyRequest(game, read.do);
};
// The pantry with no ration crates, while the shuttle stores keep theirs and everyone who'd carry is wanted elsewhere.
function pantryWithNobody(game) {
  at(game, 33);
  for (const key of carriersOf(game, "pantry")) wanted.add(key);
  take(game, "pantry", "ration_crate", count(game, "pantry", "ration_crate"));
  run(game, 10);
}
// A request file's lines on top with the parts it has to have, and what the checker says of it.
function problemsOf(top, ask = "Well?") {
  const { scene } = parseSceneText(`# A test\n${top}\n\n== ask\n@{asker}: "${ask}"\n> Yes -> yes\n> No -> no\n\n== yes\n@{asker}: "Good."\n\n== no\n@{asker}: "Then no."\n\n== done\n@{asker}: "Done."\n\n== failed\n@{asker}: "Failed."\n\n== gone\n@{asker}: "Gone."\n`);
  return rq.compileRequest("a_test", scene).problems.join(" | ");
}

test("two lines at the top say how long a job is left waiting and who brings it, and the checker catches a bad one", () => {
  assert.deepEqual(readWaiting("30 minutes if it's urgent, 3 hours if it isn't"), { urgent: 30, other: 180 });
  assert.deepEqual(readWaiting("1 hour when it's urgent, 2 days otherwise"), { urgent: 60, other: 2880 });
  assert.match(readWaiting("a while").problem, /how long for urgent work and how long for the rest/);
  assert.deepEqual(readAskers("the quartermaster for the galley, the deck chief for the rest").list, [{ who: "the quartermaster", parts: ["galley"] }, { who: "the deck chief", parts: ["rest"] }]);
  assert.deepEqual(readAskers("the chief engineer for the engines and repairs").list, [{ who: "the chief engineer", parts: ["engines", "repairs"] }]);
  assert.match(readAskers("the cook for the kitchen").problem, /"kitchen" isn't a part of the ship an ask can be for/);
  assert.match(readAskers("the cook").problem, /a post, then for, then a part of the ship/);
  const { value, problems } = parseLogisticsText(FILE, SHIP);
  assert.deepEqual(problems, []);
  assert.equal(writeLogisticsText(value), FILE.replaceAll("\r\n", "\n"), "the file reads back as it was written");
  assert.match(FILE, /\nleft waiting: 30 minutes if it's urgent, 3 hours if it isn't\nwho asks: the chief medical officer for the medbay, the chief engineer for the engines and repairs, the quartermaster for the galley, the deck chief for the rest\n/);
  assert.deepEqual(logisticsOf(SHIP).asks, { after: { urgent: 30, other: 180 }, by: { medbay: "chief_medical_officer", engines: "chief_engineer", repairs: "chief_engineer", galley: "quartermaster", rest: "deck_chief" } });
  assert.deepEqual(logisticsProblems(), []);
  // A post the ship hasn't got, and one line without the other.
  withFile((text) => text.replace("the quartermaster for the galley", "the purser for the galley"), () => {
    assert.ok(logisticsProblems().some((one) => /the purser isn't a post in world\/command, to ask for galley/.test(one)), logisticsProblems().join(" | "));
  });
  withFile((text) => text.replace(/\nwho asks: [^\n]*/, ""), () => {
    assert.ok(logisticsProblems().some((one) => /left waiting and who asks go together/.test(one)), logisticsProblems().join(" | "));
    assert.equal(logisticsOf(SHIP).asks, null, "and with only one of them, nobody brings anything");
  });
});

test("a job nobody can do is kept as waiting, and after three hours whoever its part of the ship belongs to has it to bring", () => withoutRefills(() => {
  const game = newGame();
  try {
    pantryWithNobody(game);
    assert.equal(waiting(game)["pantry:ration_crate"]?.why, "hands");
    const since = waiting(game)["pantry:ration_crate"].since;
    assert.equal(row(game, "pantry:ration_crate").stuck, true);
    assert.equal(holds(game, "work waiting"), false, "it's only just come up: nothing's been left waiting yet");
    // Not before its three hours are up.
    run(game, 160);
    assert.equal(open(game, "work_hands"), null, "nobody has brought it yet");
    assert.equal(holds(game, "work waiting hands"), false);
    assert.equal(rq.asksNow(game, "odessa"), false);
    const said = until(game, () => Boolean(open(game, "work_hands")), 90);
    const asked = open(game, "work_hands");
    assert.deepEqual([asked.asker, asked.post, asked.work, asked.state], ["odessa", "quartermaster", "pantry:ration_crate", "offered"]);
    assert.ok(asked.at * 60 - since >= 180, `asked ${Math.round(asked.at * 60 - since)} minutes after it stuck`);
    assert.ok(said.includes("[REQUEST] Quartermaster Brandt has something for you to decide, in the Long Mess."), said.join(" | "));
    assert.equal(rq.asksNow(game, "odessa"), true);
    // And the story can ask about it, by the reason and by the part of the ship.
    assert.deepEqual(["work waiting", "work waiting hands", "work waiting goods", "work waiting galley", "work waiting medbay"].map((text) => holds(game, text)), [true, true, false, true, false]);
    // Reading the game writes nothing.
    const before = JSON.stringify(game);
    publicState(game);
    boardView(game, SHIP);
    assert.equal(JSON.stringify(game), before);
    // Someone gets free and takes it: nobody has anything to ask about it any more.
    wanted.clear();
    run(game, 10);
    assert.equal(waiting(game)["pantry:ration_crate"], undefined);
    assert.equal(open(game, "work_hands"), null);
    assert.equal(rq.asksNow(game, "odessa"), false);
    assert.equal(holds(game, "work waiting hands"), false);
  } finally {
    wanted.clear();
  }
}));

test("yes makes the job the player's until it's due, and carrying it in themselves ends it done", () => withoutRefills(() => {
  const game = newGame();
  try {
    pantryWithNobody(game);
    until(game, () => Boolean(open(game, "work_hands")), 260);
    const { first, said } = answer(game, "odessa", "I'll do it");
    assert.match(first, /^@Quartermaster Odessa Brandt: "There's nobody to carry for the pantry\. Everyone I'd send is laid up, called away or on something that can't be left\. Would you carry 4 ration crates to the pantry yourself\?"/);
    assert.match(said, /\[REQUEST\] Taken on: A job left waiting\. Carry 4 ration crates to the pantry, by \d\d:\d\d on day 2\./);
    assert.match(said, /"Then it's yours, and I'll keep the others off it\. Thank you\."/);
    const quest = questOf(game, "work_hands");
    assert.deepEqual([quest.title, quest.objective, quest.status], ["A job left waiting", "Carry 4 ration crates to the pantry", "active"]);
    assert.equal(mine(game)["pantry:ration_crate"].ask, true);
    // The page says it's theirs by their word, and it isn't handed back from the board.
    const line = row(game, "pantry:ration_crate");
    assert.deepEqual([line.mine, line.promised, line.canTake], [true, true, false]);
    assert.match(line.status, /^yours since \d\d:\d\d, as you said you'd see to it$/);
    assert.throws(() => workCommand(game, SHIP, { action: "leave", id: "pantry:ration_crate" }), /You gave your word on that one/);
    // Everyone's free again, and the crew still leaves it to them.
    wanted.clear();
    run(game, 30);
    assert.equal(jobs(game).some((j) => j.to === "pantry" && j.item === "ration_crate"), false, "nobody's sent for the crates");
    assert.equal(count(game, "pantry", "ration_crate"), 0);
    // Two crates in: the quest counts what's left.
    take(game, "shuttle_stores", "ration_crate", 2);
    put(game, "pantry", "ration_crate", 2);
    notePut(game, storeOf("pantry").key, "ration_crate", 2);
    run(game, 5);
    assert.equal(questOf(game, "work_hands").objective, "Carry 2 ration crates to the pantry");
    // The other two: done, with thanks, a memory and a fact.
    const xp = game.xp;
    take(game, "shuttle_stores", "ration_crate", 2);
    put(game, "pantry", "ration_crate", 2);
    notePut(game, storeOf("pantry").key, "ration_crate", 2);
    const told = run(game, 5);
    assert.ok(told.some((one) => /^\[REQUEST\] Done: A job left waiting\. Quartermaster Odessa Brandt: "That's done, and by your own hands\./.test(one)), told.join(" | "));
    assert.equal(game.xp, xp + 10);
    assert.deepEqual([questOf(game, "work_hands").status, questOf(game, "work_hands").objective], ["completed", "Done: you saw to it yourself."]);
    assert.equal(mine(game)["pantry:ration_crate"], undefined);
    assert.equal(game.requests.ended.work_hands.how, "done");
    assert.ok(facts(game).includes("request_work_hands_done"));
    assert.ok((game.command[SHIP].memory?.odessa ?? []).some((one) => one.kind === "helped"), "she remembers it");
  } finally {
    wanted.clear();
  }
}));

test("put right some other way it's no longer needed, and left past its hour it has failed and is the crew's again", () => withoutRefills(() => {
  const gone = newGame();
  try {
    pantryWithNobody(gone);
    until(gone, () => Boolean(open(gone, "work_hands")), 260);
    answer(gone, "odessa", "I'll do it");
    // Crates turn up in the pantry by no doing of the player's.
    put(gone, "pantry", "ration_crate", 4);
    const told = run(gone, 5);
    assert.ok(told.some((one) => /^\[REQUEST\] No longer needed: A job left waiting\. Quartermaster Odessa Brandt: "Never mind\. Someone got free and saw to it\."/.test(one)), told.join(" | "));
    assert.equal(gone.requests.ended.work_hands.how, "gone");
    assert.equal(mine(gone)["pantry:ration_crate"], undefined);
  } finally {
    wanted.clear();
  }
  const late = newGame();
  try {
    pantryWithNobody(late);
    until(late, () => Boolean(open(late, "work_hands")), 260);
    answer(late, "odessa", "I'll do it");
    const due = open(late, "work_hands").due;
    assert.ok(Math.abs(due - late.clock.hours - 3) < 0.1, "three hours to do it in");
    const told = until(late, () => !open(late, "work_hands"), 200);
    assert.ok(told.some((one) => /^\[REQUEST\] Failed: A job left waiting\. Quartermaster Odessa Brandt: "It's still waiting\. You said you'd see to it\."/.test(one)), told.join(" | "));
    assert.equal(late.requests.ended.work_hands.how, "failed");
    assert.equal(questOf(late, "work_hands").status, "failed");
    assert.equal(mine(late)["pantry:ration_crate"], undefined, "the board has it back");
    assert.ok((late.command[SHIP].memory?.odessa ?? []).some((one) => one.kind === "let_down"));
    // With hands free again the crew carries for the pantry as it always did.
    wanted.clear();
    until(late, () => count(late, "pantry", "ration_crate") >= 4, 120);
  } finally {
    wanted.clear();
  }
}));

test("told no, the same job isn't brought again, and another one left waiting is after a while", () => withoutRefills(() => {
  const game = newGame();
  try {
    at(game, 33);
    for (const key of everyone(game)) wanted.add(key);
    take(game, "pantry", "ration_crate", count(game, "pantry", "ration_crate"));
    until(game, () => Boolean(open(game, "work_hands")), 260);
    assert.equal(open(game, "work_hands").work, "pantry:ration_crate");
    const { said } = answer(game, "odessa", "It'll have to wait");
    assert.match(said, /"Then it waits till I've someone to send\."/);
    assert.equal(open(game, "work_hands"), null);
    assert.equal(game.requests.ended.work_hands.how, "refused");
    assert.ok(facts(game).includes("request_work_hands_refused"));
    // The parts lockers run short too, and nobody can carry for them either: that one's brought, by the chief engineer.
    take(game, "parts_lockers", "parts_crate", count(game, "parts_lockers", "parts_crate"));
    until(game, () => Boolean(open(game, "work_hands")), 60 * 12);
    const next = open(game, "work_hands");
    assert.notEqual(next.work, "pantry:ration_crate", "not the one that was turned down");
    assert.ok(waiting(game)["pantry:ration_crate"], "though it's still waiting");
    assert.ok(game.requests.workRest["pantry:ration_crate"] > game.clock.hours + 24 * 5, "it rests a week, as anything turned down does");
  } finally {
    wanted.clear();
  }
}));

test("urgent work is brought after half an hour: the fuel rack on its last cells, by the chief engineer", () => withoutRefills(() => {
  const game = newGame();
  try {
    at(game, 33);
    for (const key of carriersOf(game, "fuel_rack")) wanted.add(key);
    take(game, "fuel_rack", "fuel_cell", count(game, "fuel_rack", "fuel_cell") - 1);
    run(game, 10);
    assert.equal(waiting(game)["fuel_rack:fuel_cell"]?.why, "hands");
    const since = waiting(game)["fuel_rack:fuel_cell"].since;
    assert.equal(row(game, "fuel_rack:fuel_cell").mark, "!!");
    until(game, () => Boolean(open(game, "work_hands")), 100);
    const asked = open(game, "work_hands");
    assert.deepEqual([asked.asker, asked.post, asked.work], ["marrow", "chief_engineer", "fuel_rack:fuel_cell"]);
    const waited = asked.at * 60 - since;
    assert.ok(waited >= 30 && waited <= 95, `brought ${Math.round(waited)} minutes after it stuck, at the hour's look after its half hour`);
    assert.match(hear(game, "marrow"), /"There's nobody to carry for the fuel rack\. .* Would you carry 2 fuel cells to the fuel rack yourself\?"/);
    walk.closeTalk(game);
  } finally {
    wanted.clear();
  }
}));

test("with nothing aboard to do a job with, the captain is asked to bring it, and buying it does it", () => withoutRefills(() => {
  const game = newGame();
  at(game, 33);
  // The hand-written ask about medicine is off, so that the board's own is the one that comes.
  request(game, "request medicine off: the board asks instead");
  request(game, "request medkit off: the board asks instead");
  takeAboard(game, SHIP, "medicine_crate", countAboard(game, SHIP, "medicine_crate").n);
  run(game, 10);
  assert.equal(waiting(game)["medicine_cabinet:medicine_crate"]?.why, "goods");
  assert.equal(row(game, "medicine_cabinet:medicine_crate").status, "nothing aboard to bring");
  const said = until(game, () => Boolean(open(game, "work_goods")), 260);
  assert.deepEqual(["work waiting goods", "work waiting medbay", "work waiting hands"].map((text) => holds(game, text)), [true, true, false]);
  const asked = open(game, "work_goods");
  assert.deepEqual([asked.asker, asked.post, asked.work], ["aduro", "chief_medical_officer", "goods:medicine_crate"]);
  assert.deepEqual(asked.want, { item: "medicine_crate", n: 2, where: "aboard", label: "medicine crates", into: "aboard" });
  assert.ok(said.includes("[REQUEST] Dr. Aduro has something for you to decide, in Medbay."), said.join(" | "));
  const { first, said: answered } = answer(game, "aduro", "I'll see to it");
  assert.match(first, /"A word, Captain\. The medicine cabinet is down to no medicine crates, and there are none aboard to bring\. We need 2 medicine crates, and that has to come from off the ship\./);
  assert.match(answered, /\[REQUEST\] Taken on: What the ship has run out of\. Bring 2 medicine crates aboard, by day 7\./);
  assert.equal(questOf(game, "work_goods").objective, "Bring 2 medicine crates aboard (0/2)");
  assert.deepEqual(mine(game), {}, "there's no job to hold: the work waits for the goods");
  // One bought, then the other.
  putAboard(game, SHIP, "medicine_crate", 1);
  notePut(game, "aboard", "medicine_crate", 1);
  run(game, 5);
  assert.equal(questOf(game, "work_goods").objective, "Bring 2 medicine crates aboard (1/2)");
  putAboard(game, SHIP, "medicine_crate", 1);
  notePut(game, "aboard", "medicine_crate", 1);
  const told = run(game, 5);
  assert.ok(told.some((one) => /^\[REQUEST\] Done: What the ship has run out of\. Dr\. Sen Aduro: "That's what we were short of\./.test(one)), told.join(" | "));
  assert.equal(questOf(game, "work_goods").objective, "Done: you brought 2 medicine crates aboard.");
  assert.equal(game.requests.ended.work_goods.how, "done");
  assert.equal(waiting(game)["medicine_cabinet:medicine_crate"], undefined);
}));

test("the same shortage isn't asked about twice: an ask written by hand keeps the board's back, and the board's keeps it back", () => withoutRefills(() => {
  // The medicine ask written by hand comes first, and while it's open or resting the board says nothing of medicine.
  const game = newGame();
  at(game, 33);
  takeAboard(game, SHIP, "medicine_crate", countAboard(game, SHIP, "medicine_crate").n);
  until(game, () => Boolean(open(game, "medicine")), 120);
  run(game, 60 * 8);
  assert.equal(waiting(game)["medicine_cabinet:medicine_crate"]?.why, "goods");
  assert.equal(open(game, "work_goods"), null, "one ask about the medicine is enough");
  answer(game, "aduro", "We'll have to manage without");
  run(game, 60 * 8);
  assert.equal(open(game, "work_goods"), null, "and told no, it isn't asked another way");
  // The other way round: the board's ask is open, and the one written by hand keeps quiet.
  const other = newGame();
  at(other, 33);
  request(other, "request medicine off: the board asks first");
  request(other, "request medkit off: the board asks first");
  takeAboard(other, SHIP, "medicine_crate", countAboard(other, SHIP, "medicine_crate").n);
  until(other, () => Boolean(open(other, "work_goods")), 260);
  request(other, "request medicine on: both could ask now");
  run(other, 60 * 30);
  assert.equal(open(other, "medicine"), null);
  assert.ok(open(other, "work_goods"));
}));

test("a repair nobody can get to is brought by the chief engineer, and mended by the player's own hands it's done", () => {
  const game = newGame();
  try {
    at(game, 33);
    for (const key of engineers(game)) wanted.add(key);
    const CAMERA = "cameras:camera:bridge";
    sys.damagePart(game, SHIP, CAMERA, "broken", { by: "story" });
    game.systems[SHIP].parts[CAMERA].fixAt = game.clock.hours + 0.9;
    run(game, 10);
    assert.equal(waiting(game)[`repair:${CAMERA}`]?.why, "hands");
    until(game, () => Boolean(open(game, "work_hands")), 260);
    assert.equal(holds(game, "work waiting repairs"), true);
    assert.deepEqual([open(game, "work_hands").asker, open(game, "work_hands").work], ["marrow", `repair:${CAMERA}`]);
    const { first, said } = answer(game, "marrow", "I'll do it");
    assert.match(first, /"There's nobody to mend the camera in The Bridge\. .* Would you mend the camera in The Bridge yourself\?"/);
    assert.match(said, /Taken on: A job left waiting\. Mend the camera in The Bridge, by/);
    assert.equal(mine(game)[`repair:${CAMERA}`].ask, true);
    assert.equal(row(game, `repair:${CAMERA}`).promised, true);
    // The engineers are free again, and leave it to the player.
    wanted.clear();
    run(game, 60);
    assert.equal(jobs(game).some((j) => j.ref === CAMERA), false);
    assert.equal(game.systems[SHIP].parts[CAMERA].damage, "broken");
    // By hand, on the bridge: the part's own fix, and its check passed where it has one.
    walk.walkCommand(game, { action: "room", to: "bridge" });
    if (sys.workOnPart(game, `part:${CAMERA}`, "fix").check) {
      const reason = game.check?.reason;
      game.check = null;
      sys.settlePart(game, { success: true, reason, training: false });
    }
    assert.equal(game.systems?.[SHIP]?.parts?.[CAMERA]?.damage, undefined, "it's mended");
    assert.equal(putsOf(game, `fixed:${SHIP}`, CAMERA), 1);
    const told = run(game, 5);
    assert.ok(told.some((one) => /^\[REQUEST\] Done: A job left waiting\./.test(one)), told.join(" | "));
    assert.equal(mine(game)[`repair:${CAMERA}`], undefined);
  } finally {
    wanted.clear();
  }
});

test("a fire nobody can be sent to is brought within the hour, and fighting it out with their own hands does it", () => {
  const game = newGame();
  try {
    at(game, 33);
    for (const key of engineers(game)) wanted.add(key);
    calmly(() => em.startFire(game, SHIP, "galley"));
    run(game, 10);
    assert.equal(waiting(game)["fire:galley"]?.why, "hands");
    until(game, () => Boolean(open(game, "work_hands")), 100);
    assert.deepEqual([open(game, "work_hands").asker, open(game, "work_hands").work], ["marrow", "fire:galley"]);
    const { first } = answer(game, "marrow", "I'll do it");
    assert.match(first, /"There's a fire in the Galley and nobody to send to it\. .* Would you fight the fire in the Galley yourself\?"/);
    assert.deepEqual(mine(game), {}, "a fire is anyone's who can get there");
    walk.walkCommand(game, { action: "room", to: "galley" });
    let said = [];
    for (let goes = 0; goes < 12 && em.fireIn(game, SHIP, "galley"); goes += 1) said = String(calmly(() => walk.walkCommand(game, { action: "fight-fire" }).said)).split("\n");
    assert.equal(em.fireIn(game, SHIP, "galley"), null, "it's out");
    const told = [...said, ...run(game, 5)];
    assert.ok(told.some((one) => /^\[REQUEST\] Done: A job left waiting\./.test(one)), told.join(" | "));
    assert.equal(game.requests.ended.work_hands.how, "done");
  } finally {
    wanted.clear();
  }
});

test("without the two lines nobody brings anything, and a job stuck only because people are asleep isn't brought", () => withoutRefills(() => {
  withFile((text) => text.replace(/\nleft waiting: [^\n]*\nwho asks: [^\n]*/, ""), () => {
    const game = newGame();
    try {
      pantryWithNobody(game);
      assert.equal(waiting(game)["pantry:ration_crate"]?.why, "hands", "it's still kept as waiting, for the story to ask about");
      run(game, 60 * 6);
      assert.equal(open(game, "work_hands"), null);
      assert.equal(holds(game, "work waiting hands"), true, "the story's question goes by half an hour and three hours then");
    } finally {
      wanted.clear();
    }
  });
  // At night the carriers are asleep, not lost: the job waits for the morning, and nobody's brought it.
  const night = newGame();
  at(night, 24 + 23.5);
  take(night, "pantry", "ration_crate", count(night, "pantry", "ration_crate"));
  run(night, 60 * 4);
  if (count(night, "pantry", "ration_crate") < 4 && !jobs(night).some((j) => j.to === "pantry")) assert.equal(waiting(night)["pantry:ration_crate"], undefined, "asleep isn't nobody");
  assert.equal(open(night, "work_hands"), null);
  // What the ship grows herself isn't waiting for goods: the pantry short of produce is only the next picking away.
  const grown = newGame();
  at(grown, 33);
  take(grown, "pantry", "produce", count(grown, "pantry", "produce"));
  take(grown, "garden_bins", "produce", count(grown, "garden_bins", "produce"));
  run(grown, 10);
  if (count(grown, "garden_bins", "produce") === 0) assert.equal(row(grown, "pantry:produce").status, "nothing aboard to bring");
  assert.equal(waiting(grown)["pantry:produce"], undefined);
}));

test("the story's words about the board are read, and the checker says what's wrong with them", () => {
  for (const text of ["work waiting", "work waiting hands", "work waiting goods", "work waiting galley", "work waiting the engines", "work first medbay", "work first none", "work job sweep_bay done", "work job sweep_bay none"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("work waiting kitchen").problems[0], /hands, goods, or a part of the ship \(medbay, engines, galley, repairs\)/);
  assert.match(parseCondition("work first kitchen").problems[0], /one of medbay, engines, galley, repairs, or none/);
  assert.match(parseCondition("work job sweep_bay finished").problems[0], /one of waiting, taken, done, none/);
  assert.match(parseCondition("work everything").problems[0], /followed by waiting, first or job/);
  assert.deepEqual(parseEffect("work first engines: The reactor comes before everything").do, { command: "work_first", part: "engines", reason: "The reactor comes before everything" });
  assert.deepEqual(parseEffect("work first none: Back to the usual").do, { command: "work_first", part: "none", reason: "Back to the usual" });
  assert.deepEqual(parseEffect("work job sweep_bay in The Lighter Bay, 30 minutes, by the deckhands, the spare hands, urgent: Sweep the Lighter Bay").do,
    { command: "work_job", name: "sweep_bay", room: "The Lighter Bay", minutes: 30, carriers: ["the deckhands", "the spare hands"], urgent: true, reason: "Sweep the Lighter Bay" });
  assert.deepEqual(parseEffect("work job sweep_bay in The Lighter Bay, 2 hours, by the deckhands: Sweep the Lighter Bay").do.minutes, 120);
  assert.deepEqual(parseEffect("work job sweep_bay off: Nobody minds any more").do, { command: "work_job_off", name: "sweep_bay", reason: "Nobody minds any more" });
  assert.match(parseEffect("work first kitchen: no").problem, /work first is written/);
  assert.match(parseEffect("work first engines").problem, /needs a colon and the reason/);
  assert.match(parseEffect("work job sweep_bay in The Lighter Bay, by the deckhands: Sweep").problem, /It needs how long it takes/);
  assert.match(parseEffect("work job sweep_bay 30 minutes, by the deckhands: Sweep").problem, /It needs the room, after in/);
  assert.match(parseEffect("work job sweep_bay in The Lighter Bay, 30 minutes: Sweep").problem, /It needs who does it, after by/);
  assert.match(parseEffect("work job sweep_bay in The Ballroom, 30 minutes, by the deckhands: Sweep").problem, /the Meridian has no room called The Ballroom/);
  assert.match(parseEffect("work job sweep_bay in The Lighter Bay, 30 minutes, by the pirates: Sweep").problem, /nobody called the pirates/);
  assert.match(parseEffect("work job sweep_bay in The Lighter Bay, 3 days, by the deckhands: Sweep").problem, /doesn't follow "3 days"/);
  assert.match(parseEffect("work job Sweep! in The Lighter Bay, 30 minutes, by the deckhands: Sweep").problem, /lowercase letters, digits and underscores/);
  // A scene that gives the board a job can wait on the fact the job leaves.
  const { scene, problems } = parseSceneText(`# A test
== start
The bay wants sweeping.
* work job sweep_bay in The Lighter Bay, 30 minutes, by the deckhands: Sweep the Lighter Bay
> Later -> after ? flag work_sweep_bay_done
> Not yet -> start ? work job sweep_bay waiting

== after
It's swept.
END
`);
  assert.deepEqual(problems, []);
  assert.deepEqual(sceneProblems(scene, "a_test"), []);
  assert.ok(factsLeft({ ...loadScenes().scenes, a_test: scene }).has("work_sweep_bay_done"));
  // And the request files' own lines: the two kinds go with their two needs, and can't be handed on.
  assert.equal(problemsOf("for: anyone aboard\nabout: a job nobody can do\nasks: them\nneeds: see to it yourself\nby: 3 hours", "{trouble}. Would you {task}?"), "");
  assert.equal(problemsOf("for: the captain\nabout: a job with nothing to do it with\nasks: them\nneeds: bring what's wanted\nby: 5 days", "{trouble}. We need {wanted}."), "");
  assert.match(problemsOf("asks: the quartermaster\nneeds: see to it yourself\nby: 3 hours"), /see to it yourself needs about: a job nobody can do/);
  assert.match(problemsOf("asks: the quartermaster\nneeds: bring what's wanted\nby: 3 hours"), /bring what's wanted needs about: a job with nothing to do it with/);
  assert.match(problemsOf("about: a job nobody can do\nasks: them\nneeds: your word\nby: 3 hours"), /is for a request to do the job: needs: see to it yourself/);
  assert.match(problemsOf("asks: the quartermaster\nneeds: your word\nby: 3 hours", "{trouble}, I'm afraid."), /\{trouble\} is only filled in for a request about a job the work board has left waiting/);
  assert.deepEqual(rq.requestProblems(), []);
});

test("the story puts a part of the ship first, the page says so in its words, and the first officer looks again a day on", () => {
  const game = newGame();
  at(game, 33);
  run(game, 20);
  assert.equal(holds(game, "work first none"), true);
  assert.equal(boardView(game, SHIP).first.by, "Commander Voss");
  const said = play(game, "work first engines: The reactor comes before everything, on the captain's word");
  assert.deepEqual(said, ["[WORK] The engines first: The reactor comes before everything, on the captain's word"]);
  assert.equal(holds(game, "work first engines"), true);
  assert.equal(holds(game, "work first none"), false);
  const first = boardView(game, SHIP).first;
  assert.deepEqual([first.title, first.part, first.story, first.by, first.why], ["The engines first", "engines", true, null, "The reactor comes before everything, on the captain's word"]);
  // Hours on, with nothing pressing, it still stands: the first officer leaves the story's order alone for a day.
  run(game, 60 * 6);
  assert.equal(holds(game, "work first engines"), true);
  assert.equal(boardView(game, SHIP).first.story, true);
  // A day after it was given she looks again, and it's hers.
  run(game, 60 * 19);
  assert.equal(boardView(game, SHIP).first.story, false);
  assert.equal(boardView(game, SHIP).first.by, "Commander Voss");
  // And the story can put it back to as it comes.
  play(game, "work first medbay: The wounded first");
  assert.equal(holds(game, "work first medbay"), true);
  assert.deepEqual(play(game, "work first none: Back to the usual"), ["[WORK] As it comes: Back to the usual"]);
  assert.equal(holds(game, "work first none"), true);
});

test("the story gives the board a job of its own: someone's sent, it's done, and it's on the record", () => {
  const game = newGame();
  at(game, 33);
  assert.equal(holds(game, "work job sweep_bay none"), true);
  assert.deepEqual(play(game, "work job sweep_bay in The Lighter Bay, 30 minutes, by the deckhands: Sweep the Lighter Bay"), ["[WORK] On the board: Sweep the Lighter Bay."]);
  assert.equal(holds(game, "work job sweep_bay waiting"), true);
  assert.deepEqual(play(game, "work job sweep_bay in The Lighter Bay, 30 minutes, by the deckhands: Sweep the Lighter Bay"), [], "given twice, it's there once");
  assert.equal(jobs(game).filter((j) => j.story === "sweep_bay").length, 1);
  run(game, 5);
  const j = jobs(game).find((one) => one.story === "sweep_bay");
  assert.ok(cmd.onJob(game, SHIP, "deckhand").includes(j.by), "a deckhand has it");
  assert.equal(holds(game, "work job sweep_bay taken"), true);
  const line = row(game, "story:sweep_bay");
  assert.equal(line.what, "Sweep the Lighter Bay");
  assert.match(line.status, / is .*, since \d\d:\d\d$/);
  assert.equal(line.busy, true);
  const said = until(game, () => holds(game, "work job sweep_bay done"), 120);
  assert.ok(said.some((one) => /^\[WORK\] Done: Sweep the Lighter Bay\. .+ saw to it\.$/.test(one)), said.join(" | "));
  assert.ok(facts(game).includes("work_sweep_bay_done"));
  assert.equal(holds(game, "flag work_sweep_bay_done"), true);
  assert.equal(row(game, "story:sweep_bay"), null);
  // Taken off the board before anyone's done it, it's simply gone.
  play(game, "work job tidy_stores in Stores, 2 hours, by the deckhands: Tidy the parts lockers");
  assert.equal(holds(game, "work job tidy_stores waiting"), true);
  assert.deepEqual(play(game, "work job tidy_stores off: Nobody minds any more"), []);
  assert.equal(holds(game, "work job tidy_stores none"), true);
  assert.equal(jobs(game).some((one) => one.story === "tidy_stores"), false);
});

test("a job of the story's can be done by the player in its room, and one nobody can do is brought to them", () => {
  const game = newGame();
  try {
    at(game, 33);
    for (const key of cmd.onJob(game, SHIP, "deckhand")) wanted.add(key);
    play(game, "work job sweep_bay in The Lighter Bay, 30 minutes, by the deckhands: Sweep the Lighter Bay");
    run(game, 10);
    assert.equal(waiting(game)["story:sweep_bay"]?.why, "hands");
    assert.equal(row(game, "story:sweep_bay").stuck, true);
    // The deck chief brings it, since it belongs to no part of the ship in particular.
    until(game, () => Boolean(open(game, "work_hands")), 260);
    const chief = cmd.holderKey(game, SHIP, "deck_chief");
    assert.deepEqual([open(game, "work_hands").asker, open(game, "work_hands").work], [chief, "story:sweep_bay"]);
    const { first, said } = answer(game, chief, "I'll do it");
    assert.match(first, /"There's nobody for this: sweep the Lighter Bay\. .* Would you sweep the Lighter Bay yourself\?"/);
    assert.match(said, /Taken on: A job left waiting\. Sweep the Lighter Bay, by/);
    // In the Lighter Bay it's under You can; anywhere else it isn't.
    assert.equal((walk.walkView(game).acts ?? []).some((act) => act.id === "work-story"), false);
    walk.walkCommand(game, { action: "room", to: logisticsOf(SHIP).findRoom("The Lighter Bay").id });
    const act = walk.walkView(game).acts.find((one) => one.id === "work-story");
    assert.deepEqual([act.key, act.label, act.disabled ?? false], ["sweep_bay", "Sweep the Lighter Bay (30 minutes)", false]);
    const before = game.clock.hours;
    const done = String(calmly(() => walk.walkCommand(game, { action: "work-story", key: "sweep_bay" }).said)).split("\n");
    assert.equal(done[0], "[WORK] Done: Sweep the Lighter Bay. You saw to it yourself.");
    assert.ok(Math.abs(game.clock.hours - before - 0.5) < 0.02, "half an hour of the player's own time");
    assert.equal(holds(game, "work job sweep_bay done"), true);
    assert.match(readRecord(game).facts.find((one) => one.id === "work_sweep_bay_done").text, /^Sweep the Lighter Bay: done on day 2, by you\.$/);
    assert.throws(() => walk.walkCommand(game, { action: "work-story", key: "sweep_bay" }), /no job of that kind in this room/);
    const told = [...done, ...run(game, 5)];
    assert.ok(told.some((one) => /^\[REQUEST\] Done: A job left waiting\./.test(one)), told.join(" | "));
    assert.equal(game.requests.ended.work_hands.how, "done");
  } finally {
    wanted.clear();
  }
});
