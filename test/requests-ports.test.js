// Requests, step 6 of the organic quests: off the ship. At a port that's short of something, or in trouble (a strike, a
// raid, a fight), someone there asks: Dockmaster Jessup by name at Haven, or someone with a name anywhere else. They can
// buy what's short from the player at over the market price (needs: sell ...), paid as it's handed over, and what the
// player did is standing there, with whoever holds the place ({port}). None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-ports-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const rq = await import("../src/requests.js");
const walk = await import("../src/walk.js");
const talks = await import("../src/talks.js");
const { ITEMS } = await import("../src/data.js");
const { itemFactor } = await import("../src/daily.js");
const { WORLD_CHARACTERS } = await import("../src/world.js");
const { readRecord } = await import("../src/record.js");
const { conditionHolds, parseCondition, parseSceneText } = await import("../src/scene-text.js");

const KINDS = ["medicine", "fuel", "parts", "pantry", "broken", "medkit", "rival", "post_back", "brig", "grumbling", "carry", "extra_shift", "repair_order", "hand_on_job", "word_for_boss", "port_food", "port_medicine", "port_trouble", "haven_food"];
const newGame = (start, seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "Begun." });
  return game;
};
const at = (game, hours) => {
  game.clock.hours = hours;
  return rules.clockRuns(game, 1);
};
const told = (notes) => notes.filter((one) => one.startsWith("[REQUEST]"));
function only(game, ...kinds) {
  game.requests = { open: {}, rest: Object.fromEntries(KINDS.filter((one) => !kinds.includes(one)).map((one) => [one, 1e9])), asked: {}, n: 0 };
}
function talkTo(game, key, words = null) {
  walk.bringOver(game, [key]);
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  const first = game.talk.lastReply;
  if (words) talks.writtenTalkTurn({ game, playerText: words, emit: () => {} });
  walk.closeTalk(game);
  return first;
}
// A port's supply set by hand, and kept there: the world's day has already run for today.
const short = (game, place, good, level) => {
  game.world.places[place].goods[good] = level;
};

test("supply and trouble: what a port has, and what's going on there", () => {
  for (const text of ["supply food < 80", "supply medicine >= 100 at haven", "trouble here", "not trouble at cinder"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("supply rum < 3").problems.join(" "), /"supply" is followed by food, fuel, medicine or parts/);
  assert.match(parseCondition("trouble everywhere").problems.join(" "), /"trouble" is followed by here, or at and a place/);
  const game = newGame("miner");
  assert.equal(game.location, "cinder");
  short(game, "cinder", "food", 60);
  assert.equal(conditionHolds(game, "supply food < 80"), true);
  assert.equal(conditionHolds(game, "supply food < 80 at haven"), false);
  game.world.places.cinder.events = [{ id: "cinder_picket_fight", left: 5 }];
  assert.equal(conditionHolds(game, "trouble here"), true);
  game.world.places.cinder.events = [{ id: "cinder_tanker", left: 5 }];
  assert.equal(conditionHolds(game, "trouble here"), false, "a tanker getting out isn't trouble");
});

test("the checker reads sell, someone by name at a port, and {place} in a condition", () => {
  const scene = (top) => parseSceneText(`# T\n${top}\n\n== ask\n@{asker}: "?"\n> Yes -> yes\n\n== yes\n@{asker}: "Y."\n\n== done\n@{asker}: "D."\n* faction {port} 3: For {place}\n\n== failed\n@{asker}: "F."\n\n== gone\n@{asker}: "G."\n`, "request_t").scene;
  const problemsOf = (top) => rq.compileRequest("t", scene(top)).problems.join(" | ");
  assert.equal(problemsOf("for: anyone\nwhen: at haven\nasks: Mott Jessup\nneeds: sell 5 ration packs to {asker}, at twice the market price\nby: 5 days\ngone when: supply food >= 100 at {place}"), "");
  assert.equal(problemsOf("for: anyone\nasks: someone here\nneeds: sell two medkits to {asker}\nby: 2 days"), "", "at the market price, when it doesn't say");
  assert.match(problemsOf("for: anyone\nasks: someone here\nneeds: sell 2 medkits to {asker}, at a song\nby: 2 days"), /sell ends with at the market price, at half again the market price or at twice the market price/);
  assert.match(problemsOf("for: anyone\nasks: Nobody Anywhere\nneeds: your word\nby: 1 day"), /there's no post, job or person called Nobody Anywhere/);
  assert.match(problemsOf("for: anyone\nasks: someone here\nneeds: your word\nby: 1 day\ngone when: trouble at {nowhere}"), /gone when:/);
});

test("Haven short of food: Dockmaster Jessup buys five ration packs at twice the market price, and Haven remembers", () => {
  const game = newGame("docker");
  only(game, "haven_food");
  short(game, "haven", "food", 60);
  const notes = told(at(game, 10.5));
  assert.deepEqual(notes, ["[REQUEST] Dockmaster Jessup has something to ask you, in the Manifest Docks."]);
  assert.equal(game.requests.open.haven_food.place, "haven");
  const first = talkTo(game, "mott", "I'll bring them");
  assert.match(first, /Food's short on the ring/);
  const price = Math.round(ITEMS.ration_pack.price * itemFactor(game, ITEMS.ration_pack) * 2);
  assert.ok(price > 30, `twice a dear market price: ${price}`);
  const quest = game.quests.find((one) => one.request === "haven_food");
  assert.equal(quest.objective, `Sell Dockmaster Jessup 5 ration packs at ${price} credits each (0/5)`);
  // Two now, the rest later, each paid as they're handed over.
  game.inventory.ration_pack = 2;
  walk.bringOver(game, ["mott"]);
  const view = walk.walkView(game).people.find((one) => one.key === "mott");
  assert.deepEqual(view.wants, { item: "ration_pack", n: 2, name: ITEMS.ration_pack.name, sell: price });
  const credits = game.credits;
  walk.walkCommand(game, { action: "give", key: "person:mott" });
  const paid = told(rq.advanceRequests(game));
  assert.deepEqual(paid, [`[REQUEST] Dockmaster Jessup pays you ${2 * price} credits for 2 ration packs.`]);
  assert.equal(game.credits, credits + 2 * price);
  assert.equal(quest.objective, `Sell Dockmaster Jessup 5 ration packs at ${price} credits each (2/5)`);
  game.inventory.ration_pack = 3;
  const standing = game.factions.drift ?? 0;
  walk.walkCommand(game, { action: "give", key: "person:mott" });
  const end = told(rq.advanceRequests(game));
  assert.equal(end[0], `[REQUEST] Dockmaster Jessup pays you ${3 * price} credits for 3 ration packs.`);
  assert.match(end[1], /^\[REQUEST\] Done: Food for the ring\. Dockmaster Mott Jessup: "Five packs\./);
  assert.equal(game.credits, credits + 5 * price);
  assert.equal(game.factions.drift, standing + 5, "standing with whoever holds Haven");
  assert.ok(readRecord(game).facts.some((one) => one.id === "request_haven_food_done" && new RegExp(`You sold Dockmaster Jessup 5 ration packs for ${5 * price} credits`).test(one.text)));
});

test("someone at Kessara buys ration packs there and then, and food coming back means it's no longer needed", () => {
  const game = newGame("runner");
  assert.equal(game.location, "kessara");
  only(game, "port_food");
  short(game, "kessara", "food", 60);
  at(game, 10.5);
  const open = game.requests.open.port_food;
  assert.ok(open?.asker, "someone asks");
  assert.equal(WORLD_CHARACTERS[open.asker]?.location, "kessara");
  game.inventory.ration_pack = 3;
  const credits = game.credits;
  const first = talkTo(game, open.asker, "Here, take them");
  assert.match(first, /Food's short on Kessara Drift/);
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], /pays you \d+ credits for 3 ration packs\.$/);
  assert.match(notes[1], /^\[REQUEST\] Done: Short of food\./);
  assert.ok(game.credits > credits);
  assert.equal(game.inventory.ration_pack ?? 0, 0);

  // Another time, taken on, and the food comes back first.
  const other = newGame("runner", 33);
  only(other, "port_food");
  short(other, "kessara", "food", 60);
  at(other, 10.5);
  rq.answerRequest(other, "port_food", "yes");
  short(other, "kessara", "food", 105);
  assert.match(told(rq.advanceRequests(other))[0], /^\[REQUEST\] No longer needed: Short of food\. .*The convoys are coming through again\./);
});

test("trouble at Kessara: someone asks for a medkit for someone hurt in it, and it's standing there", () => {
  const game = newGame("runner");
  only(game, "port_trouble");
  game.world.places.kessara.events = [{ id: "kessara_debt_war", left: 5 }];
  at(game, 10.5);
  const open = game.requests.open.port_trouble;
  assert.ok(open?.asker, "someone asks");
  game.inventory.medkit = 1;
  const first = talkTo(game, open.asker, "Here, take mine");
  assert.match(first, /You'll have heard what's going on on Kessara Drift/);
  const port = game.world.places.kessara.holder;
  const before = game.factions[port] ?? 0;
  const notes = told(rq.advanceRequests(game));
  assert.match(notes[0], /^\[REQUEST\] Done: Hurt in the trouble\./);
  assert.equal(game.factions[port], before + 5, `standing with ${port}, who holds Kessara`);

  // At Cinder Reach the company and the strikers hold it, neither of them a faction: there's no standing to gain.
  const cinder = newGame("miner");
  only(cinder, "port_trouble");
  cinder.world.places.cinder.events = [{ id: "cinder_picket_fight", left: 5 }];
  at(cinder, 10.5);
  const asker = cinder.requests.open.port_trouble?.asker;
  assert.ok(asker);
  cinder.inventory.medkit = 1;
  const factions = { ...cinder.factions };
  talkTo(cinder, asker, "Here, take mine");
  assert.match(told(rq.advanceRequests(cinder))[0], /^\[REQUEST\] Done: Hurt in the trouble\./);
  assert.deepEqual(cinder.factions, factions);
});

test("a port's asks come only at that port: away from Haven, Jessup doesn't ask", () => {
  const game = newGame("runner");
  only(game, "haven_food");
  short(game, "haven", "food", 60);
  at(game, 10.5);
  assert.deepEqual(game.requests.open, {});
});
