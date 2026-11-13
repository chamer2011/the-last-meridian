// Stories that move on without the captain, and a ship whose officers make their own decisions. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-stories-"));
process.env.GAME_DATA_DIR = dataDir;

const { findCharacter } = await import("../src/campaign.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { LOCATIONS } = await import("../src/data.js");
const { councilOf, shipCommand, shipLedger, shipView } = await import("../src/ship.js");
const { holderKey, postAndName } = await import("../src/command.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { passTime, publicState } = await import("../src/rules.js");
const { countAboard, fillStores, logisticsOf, putAboard, takeAboard } = await import("../src/logistics.js");
const { clockOf, hasMovedOn, leadNow, ranItsCourse } = await import("../src/story-clock.js");
const { leadsHere, noteThreadStarted, storyView } = await import("../src/story-library.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { DAILY, SHIP_DATA, STORY_CLOCK, WORLD_ARC, WORLD_THREADS } = await import("../src/world.js");

const COUNCIL = SHIP_DATA.council;
const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const days = (game, count) => passTime(game, 24 * count, "routine");
// Keeps the ship out of trouble, so that only what's being tested gets a say.
function comfortable(game) {
  // Every store in her rooms full (food, medicine, parts and the generator's cells), the tank full, and morale steady.
  fillStores(game, "meridian");
  game.ship.fuel = game.ship.maxFuel;
  game.ship.morale = 60;
}
// A day at a time until something's happened, with nobody in charge of anything.
function until(game, reached, limit = 400) {
  for (let day = 0; day < limit; day += 1) {
    if (reached()) return day;
    comfortable(game);
    days(game, 1);
  }
  assert.fail(`It still hadn't happened after ${limit} days.`);
}

// ---- What's written down ----------------------------------------------------------

test("every story says what happens if nobody steps in, or why it has to wait", () => {
  const ids = Object.keys(WORLD_THREADS);
  assert.equal(ids.length, 108, "the 128 there were, less the twenty of the main story that went on 2026-11-12");
  assert.ok(!ids.some((id) => id.startsWith("main_")), "none of the main story is left");
  for (const id of ids) {
    const entry = STORY_CLOCK.threads[id];
    assert.ok(entry, `${id} has nothing written for it`);
    assert.ok(entry.stages.length > 0 || entry.waits, `${id} has no stages, and no reason to wait`);
  }
  for (const id of Object.keys(STORY_CLOCK.threads)) assert.ok(WORLD_THREADS[id], `${id} isn't a story`);
  const waiting = ids.filter((id) => STORY_CLOCK.threads[id].waits).sort();
  assert.deepEqual(waiting, ["deep_past_the_lamp"], "only the one that needed the Meridian at the Harbor, which is set aside now");
});

test("every stage is well formed, and only touches things that exist", () => {
  const fleetKeys = ["morale", "food", "medicine", "parts", "fuel", "pursuit", "ships", "picked", "sat", "named"];
  const check = (where, stage) => {
    assert.ok(Number.isFinite(stage.after) && stage.after > 0, `${where}: when`);
    assert.ok(typeof stage.news === "string" && stage.news.length > 20 && stage.news.length < 300, `${where}: news`);
    if (stage.place) assert.ok(LOCATIONS[stage.place], `${where}: ${stage.place}`);
    for (const hit of stage.places ?? []) {
      const place = DAILY.places[hit.id];
      assert.ok(place, `${where}: ${hit.id} isn't tracked`);
      for (const good of Object.keys(hit.goods ?? {})) assert.ok(place.goods[good] !== undefined, `${where}: ${hit.id} has no ${good}`);
      if (hit.sides) assert.ok(!place.locked, `${where}: nobody can change who holds ${hit.id}`);
      for (const side of Object.keys(hit.sides ?? {})) assert.ok(place.hold?.[side] !== undefined, `${where}: ${hit.id} has no ${side}`);
    }
    for (const key of Object.keys(stage.fleet ?? {})) assert.ok(fleetKeys.includes(key), `${where}: ${key}`);
    const { named } = stage.fleet ?? {};
    // A ship named here is from when there was a fleet: the file still reads, and the game lets the line go.
    if (named) assert.ok(typeof named.id === "string" && ["lost", "gone"].includes(named.status), `${where}: named`);
  };
  let stages = 0;
  for (const [id, entry] of Object.entries(STORY_CLOCK.threads)) {
    let last = 0;
    for (const stage of entry.stages) {
      check(id, stage);
      assert.ok(stage.after > last || (stage.after === last && stage.if), `${id}: its stages have to come in order, unless two on the same day are a fork`);
      last = stage.after;
      assert.ok(typeof stage.lead === "string" && stage.lead.length > 40, `${id}: every stage changes the lead`);
      assert.notEqual(stage.lead, WORLD_THREADS[id].lead);
      stages += 1;
    }
  }
  assert.ok(stages > 150, `only ${stages} stages`);
  assert.equal(STORY_CLOCK.acts.length, 0, "the clock by act is empty since the written main story went");
  STORY_CLOCK.acts.forEach((act, index) => {
    let last = 0;
    for (const event of act.events) {
      check(`act ${index + 1}`, event);
      assert.ok(event.after > last);
      last = event.after;
    }
    if (index < 3) {
      check(`act ${index + 1} moves on`, act.moves_on);
      assert.ok(act.moves_on.after > last, "it moves on after everything else in the act has had its chance");
    }
  });
});

test("nothing that's told to everyone gives a secret away", () => {
  const secrets = ["the Audience", "the Roster", "Roster", "walker", "Stilling", "Dov Harlan", "Ned Vasek", "Tam Orlo", "Dark Pantry", "Door Warden", "Quartile", "Brother Hob", "Anja", "Gantry", "Orchard", "Ember Day", "Project Plumbline", "palewort"];
  const said = [
    ...Object.entries(STORY_CLOCK.threads).flatMap(([id, entry]) => entry.stages.flatMap((stage) => [[id, stage.news], [id, stage.lead]])),
    ...STORY_CLOCK.acts.flatMap((act, index) => [...act.events, act.moves_on].filter(Boolean).map((event) => [`act ${index + 1}`, event.news])),
  ];
  for (const [where, text] of said) {
    for (const secret of secrets) assert.ok(!text.includes(secret), `${where} gives away ${secret}: ${text}`);
    assert.ok(!/[{}]/.test(text), `${where} has something left unfilled: ${text}`);
  }
});

// ---- Stories moving on --------------------------------------------------------------

test("nothing happens straight away, and then the stories start to move", () => {
  const game = newGame();
  days(game, 1);
  assert.deepEqual(clockOf(game).moved, []);
  assert.ok(!hasMovedOn(game, "out_cinder_strike"));
  assert.equal(leadNow(game, "out_cinder_strike"), WORLD_THREADS.out_cinder_strike.lead);
  until(game, () => clockOf(game).moved.length > 3);
  assert.ok(game.story.clock.moved.every((entry) => entry.text && entry.day >= 1));
});

test("when a story's day comes, the world changes, the lead changes, and the news goes round", () => {
  const game = newGame();
  game.ship.at = "cinder";
  game.location = "cinder";
  game.walk = null;
  const before = {};
  until(game, () => {
    if (hasMovedOn(game, "out_cinder_strike")) return true;
    Object.assign(before, JSON.parse(JSON.stringify(game.world.places.cinder)));
    return false;
  });
  const stage = STORY_CLOCK.threads.out_cinder_strike.stages[0];
  const now = game.world.places.cinder;
  assert.ok(now.goods.fuel < before.goods.fuel - 10, `fuel ${before.goods.fuel} became ${now.goods.fuel}`);
  assert.ok(now.hold.strike > before.hold.strike, "the strikers are stronger");
  assert.equal(leadNow(game, "out_cinder_strike"), stage.lead);
  assert.ok(game.world.news.some((entry) => entry.text === stage.news));
  assert.ok(storyView(game).moved.some((entry) => entry.text === stage.news), "it's on the Leads screen");
  assert.ok(Object.values(now.hold).every((share) => share > 0));
  assert.ok(Math.abs(Object.values(now.hold).reduce((sum, share) => sum + share, 0) - 100) < 1, "the shares still come to the whole place");
});

test("a lead that's moved on says how things stand now, and says that it's moved", () => {
  const game = newGame();
  game.location = "haven";
  game.ship.at = "haven";
  game.walk = null;
  let lead = null;
  until(game, () => {
    lead = leadsHere(game).find((entry) => entry.moved);
    return lead;
  });
  assert.equal(lead.lead, leadNow(game, lead.id));
  assert.ok(STORY_CLOCK.threads[lead.id].stages.some((stage) => stage.lead === lead.lead));
  assert.notEqual(lead.lead, WORLD_THREADS[lead.id].lead);
  assert.ok(leadsHere(newGame()).every((entry) => !entry.moved), "a new game's leads are all as they were written");
});

test("once someone has taken a story up, it's in their hands and its clock stops", () => {
  const game = newGame();
  noteThreadStarted(game, "out_cinder_strike");
  assert.equal(game.story.threads.out_cinder_strike, "active");
  const fuel = game.world.places.cinder.goods.fuel;
  until(game, () => clockOf(game).moved.length > 20);
  for (let day = 0; day < 100; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.ok(!hasMovedOn(game, "out_cinder_strike"));
  assert.equal(game.story.clock.threads.out_cinder_strike, undefined);
  assert.ok(!game.story.clock.moved.some((entry) => entry.id === "out_cinder_strike"));
  assert.ok(Number.isFinite(fuel));
});

test("a story that's moved on can still be taken up, and then it stops where it was", () => {
  const game = newGame();
  until(game, () => hasMovedOn(game, "out_cinder_strike"));
  const stage = STORY_CLOCK.threads.out_cinder_strike.stages[0];
  assert.equal(leadNow(game, "out_cinder_strike"), stage.lead ?? stage.news);
  // Look into this, from the Leads menu.
  noteThreadStarted(game, "out_cinder_strike");
  assert.equal(game.story.threads.out_cinder_strike, "active");
  const reached = game.story.clock.threads.out_cinder_strike.stage;
  for (let day = 0; day < 100; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.equal(game.story.clock.threads.out_cinder_strike.stage, reached, "and it stops where it was");
});

test("a story that hasn't moved on still reads as it began", () => {
  const game = newGame();
  assert.equal(hasMovedOn(game, "out_cinder_strike"), false);
  assert.equal(leadNow(game, "out_cinder_strike"), WORLD_THREADS.out_cinder_strike.lead);
});

test("what follows a story opens once that story has run its course, and only then", () => {
  const game = newGame();
  game.level = 5;
  game.location = "cinder";
  game.ship.at = "cinder";
  game.walk = null;
  // Only a few leads show at once, so these two get the place to themselves.
  for (const [id, thread] of Object.entries(WORLD_THREADS)) {
    if (thread.places?.includes("cinder") && id !== "out_cinder_strike" && id !== "out_cinder_reactor") game.story.threads[id] = "done";
  }
  const open = () => leadsHere(game).some((lead) => lead.id === "out_cinder_reactor");
  assert.ok(!open());
  assert.equal(clockOf(game).threads.out_cinder_reactor, undefined);
  until(game, () => ranItsCourse(game, "out_cinder_strike"));
  assert.ok(open(), "the reactor story is there to be found");
  comfortable(game);
  days(game, 2);
  assert.ok(game.story.clock.threads.out_cinder_reactor, "and its own clock has started");
});

test("a story waits for the world to reach it", () => {
  const game = newGame();
  const lateOnes = Object.entries(WORLD_THREADS).filter(([, thread]) => (thread.minLevel ?? 1) >= 6 && !thread.after);
  assert.ok(lateOnes.length > 0);
  comfortable(game);
  days(game, 20);
  for (const [id] of lateOnes) assert.equal(game.story.clock.threads[id], undefined, `${id} started too soon`);
});

// ---- A story's clock by act ------------------------------------------------------------

test("with no acts written, nothing happens by act; with acts, their pressure builds and they move on by themselves, as far as the last and no further", () => {
  // The game's own clock by act is empty since the written main story went, so the story stays in act 1.
  assert.deepEqual(STORY_CLOCK.acts, []);
  const still = newGame(23);
  for (let day = 0; day < 60; day += 1) {
    comfortable(still);
    days(still, 1);
  }
  assert.equal(still.story.act, 1);
  assert.ok(still.story.clock.moved.every((entry) => entry.id), "everything that's moved on is some story's own");
  // Acts written for the test, the way world/story-clock.json takes them: the clock reads the same list.
  const acts = [1, 2, 3, 4].map((n) => ({
    events: [{ after: 3, news: `Test news for act ${n}: something has been heard on the mess decks.`, fleet: { morale: -1 } }],
    ...(n < 4 ? { moves_on: { after: 8, news: `Test news: act ${n} has ended by itself, with nobody moving it.` } } : {}),
  }));
  STORY_CLOCK.acts.push(...acts);
  try {
    const game = newGame();
    const heard = new Set();
    until(game, () => {
      for (const entry of clockOf(game).moved) heard.add(entry.text);
      return game.story.act === 2;
    });
    for (const event of acts[0].events) assert.ok(heard.has(event.news), event.news);
    assert.ok(game.story.clock.moved.some((entry) => entry.text === acts[0].moves_on.news));
    assert.equal(game.story.clock.act.act, 2);
    assert.ok(game.story.clock.moved.some((entry) => entry.id === null && entry.title), "the news says which act it happened in");
    until(game, () => game.story.act === 4, 500);
    for (let day = 0; day < 60; day += 1) {
      comfortable(game);
      days(game, 1);
    }
    assert.equal(game.story.act, 4, "the last act never ends by itself");
  } finally {
    STORY_CLOCK.acts.length = 0;
  }
});

test("when the written story moves the act on, the act's clock starts again from there", () => {
  const game = newGame();
  comfortable(game);
  days(game, 10);
  assert.equal(game.story.clock.act.act, 1);
  const { result, isError } = tool(game, "update_story", { act: 2 });
  assert.ok(!isError, result);
  assert.equal(game.story.clock.act, null);
  const before = game.clock.hours;
  comfortable(game);
  days(game, 1);
  assert.equal(game.story.clock.act.act, 2);
  assert.equal(game.story.clock.act.next, 0);
  assert.equal(game.story.clock.act.from, Math.floor((before + 24) / 24));
});

// ---- Time, saves and the screen --------------------------------------------------------

test("it comes out the same however the time is cut up, and after saving and loading", () => {
  const one = newGame();
  days(one, 90);
  const two = newGame();
  // The same game: everyone's body, and who falls ill, are made up from the game's own seed.
  two.bodySeed = one.bodySeed;
  days(two, 30);
  const loaded = JSON.parse(JSON.stringify(two));
  days(loaded, 20);
  for (let day = 0; day < 40; day += 1) days(loaded, 1);
  assert.deepEqual(one.story.clock, loaded.story.clock);
  assert.deepEqual(one.world, loaded.world);
  assert.equal(one.ship.food, loaded.ship.food);
  assert.equal(one.ship.morale, loaded.ship.morale);
  const other = newGame(99);
  other.name = "Somebody Else";
  days(other, 90);
  assert.notDeepEqual(one.story.clock.threads, other.story.clock.threads, "another captain's stories go at their own pace");
});

test("a long wait doesn't flood the screen, but all of it is still in the news", () => {
  const game = newGame();
  const all = Object.values(STORY_CLOCK.threads).flatMap((entry) => entry.stages.map((stage) => stage.news));
  comfortable(game);
  const notes = days(game, 70);
  const told = notes.filter((line) => all.some((news) => line.includes(news)));
  assert.ok(told.length <= 4, `${told.length} story lines came up at once`);
  assert.ok(game.story.clock.moved.length > 20, "plenty happened");
  const day = newGame();
  comfortable(day);
  days(day, 25);
  const oneDay = [];
  for (let i = 0; i < 40; i += 1) {
    comfortable(day);
    const lines = days(day, 1);
    oneDay.push(lines.filter((line) => all.some((news) => line.includes(news))).length);
  }
  assert.ok(Math.max(...oneDay) <= 2, "no more than a couple in a day");
});

test("the Leads screen only shows what the captain could know, newest first and not too many", () => {
  const game = newGame();
  until(game, () => clockOf(game).moved.length > 25);
  const { moved } = storyView(game);
  assert.ok(moved.length > 0 && moved.length <= 10);
  assert.ok(moved.every((entry, index) => index === 0 || entry.day <= moved[index - 1].day));
  clockOf(game).moved.push({ day: 200, id: "deep_the_sublevels", title: "Hidden", text: "Something at Foundry Seven.", place: "foundry" });
  assert.ok(!storyView(game).moved.some((entry) => entry.title === "Hidden"), "nobody's heard of Foundry Seven");
  game.location = "foundry";
  assert.ok(storyView(game).moved.some((entry) => entry.title === "Hidden"), "until they're standing in it");
  assert.ok(game.story.clock.moved.length <= 31);
});

test("looking at it changes nothing in the save", () => {
  const game = newGame();
  until(game, () => clockOf(game).moved.length > 10);
  const before = JSON.stringify(game);
  publicState(game);
  storyView(game);
  shipView(game);
  leadsHere(game);
  assert.equal(JSON.stringify(game), before);
  const fresh = newGame();
  const clean = JSON.stringify(fresh);
  publicState(fresh);
  assert.equal(JSON.stringify(fresh), clean, "nor in a brand new one");
});

test("an old save picks it all up from today, with nothing happening at once", () => {
  const old = newGame();
  comfortable(old);
  old.clock.hours = 24 * 300;
  old.version = 12;
  delete old.story.clock;
  delete old.ship.council;
  old.ship.day = 300;
  old.world.day = 300;
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 25);
  assert.equal(game.story.clock.start, 300);
  assert.equal(game.story.clock.day, 300);
  comfortable(game);
  days(game, 1);
  assert.deepEqual(game.story.clock.moved, []);
  assert.deepEqual(shipView(game).council, { off: false, recent: [] });
  until(game, () => clockOf(game).moved.length > 0);
  assert.equal(game.version, 25);
  assert.equal(JSON.parse(JSON.stringify(game)).story.clock.start, 300);
});

test("a year of it is quick, and doesn't fill up the save", () => {
  const game = newGame();
  const started = Date.now();
  for (let day = 0; day < 365; day += 1) {
    days(game, 1);
  }
  assert.ok(Date.now() - started < 4000, `it took ${Date.now() - started} ms`);
  assert.ok(JSON.stringify(game.story.clock).length < 16000, `${JSON.stringify(game.story.clock).length} characters`);
  assert.ok(JSON.stringify(game.ship.council).length < 3000);
  assert.ok(game.ship.morale >= 0 && game.ship.morale <= 100);
});

// ---- The officers and the council ---------------------------------------------------------

// How long a supply's got left, in days: its stores in the rooms filled, then taken down to the count in whole crates.
// A shortage only shows while nothing's coming aboard, so the tests that need one run withoutSources.
const ITEMS_OF = { food: ["ration_crate", "produce"], medicine: ["medicine_crate"], parts: ["parts_crate"] };
function left(game, id, count) {
  for (const item of ITEMS_OF[id]) putAboard(game, "meridian", item, 999);
  const aDay = shipLedger(game).used[id] || 1;
  let over = countAboard(game, "meridian", ITEMS_OF[id]).n - aDay * count;
  for (const item of ITEMS_OF[id]) {
    if (over < 1) break;
    over -= takeAboard(game, "meridian", item, Math.floor(over));
  }
}
// The garden and the shuttle stores' refills from nothing stopped, so that a shortage can last.
function withoutSources(run) {
  const model = logisticsOf("meridian");
  const garden = model.machines.find((one) => one.id === "garden");
  const refills = model.refills;
  garden.runs = false;
  model.refills = [];
  try {
    return run();
  } finally {
    garden.runs = true;
    model.refills = refills;
  }
}

// Each decision, with how things have to stand for it to happen. The ones about running short need the food to
// stop coming aboard; the others happen on a ship that's fed.
const SCENES = {
  half_rations: { starved: true, set: (game) => { game.ship.rations = "standard"; left(game, "food", 2.5); } },
  cut_rations: { starved: true, set: (game) => { game.ship.rations = "standard"; left(game, "food", 6); } },
  feast: { set: (game) => { game.ship.rations = "standard"; game.ship.morale = 20; } },
  feast_over: { set: (game) => { game.ship.rations = "generous"; councilOf(game.ship).setRations = "generous"; game.ship.morale = 70; } },
  more_food: { set: (game) => { game.ship.rations = "reduced"; game.ship.morale = 40; } },
};

for (const [id, scene] of Object.entries(SCENES)) {
  test(`if nobody deals with it, they do: ${id}`, () => {
    const decision = COUNCIL.decisions.find((one) => one.id === id);
    assert.ok(decision);
    const game = newGame();
    comfortable(game);
    const notes = [];
    const run = () => {
      scene.set(game);
      for (let day = 0; day < 8 && !notes.some((line) => line.startsWith("[COUNCIL]")); day += 1) notes.push(...passTime(game, 24, "routine"));
    };
    if (scene.starved) withoutSources(run);
    else run();
    const said = notes.filter((line) => line.startsWith("[COUNCIL]"));
    assert.ok(said.length >= 1, `nothing happened: ${notes.join(" | ")}`);
    assert.ok(said[0].includes(decision.text.split("{who}").at(-1)), said[0]);
    // Whoever holds the post it names: Quartermaster Brandt, or Speaker Halm.
    assert.ok(said[0].includes(postAndName(game, "meridian", decision.post)) || !decision.text.includes("{who}"), said[0]);
    assert.equal(game.ship.rations, decision.set.rations);
    assert.ok(shipView(game).council.recent.length >= 1, "and it's on the Ship screen");
  });
}

test("generous rations for morale come back off once people are happier, unless they were the captain's idea", () => {
  const game = newGame();
  comfortable(game);
  game.ship.morale = 20;
  for (let day = 0; day < 6 && game.ship.rations !== "generous"; day += 1) {
    game.ship.food = 9000;
    passTime(game, 24, "routine");
  }
  assert.equal(game.ship.rations, "generous");
  const notes = [];
  for (let day = 0; day < 6 && game.ship.rations === "generous"; day += 1) {
    comfortable(game);
    game.ship.morale = 70;
    notes.push(...passTime(game, 24, "routine"));
  }
  assert.equal(game.ship.rations, "standard", notes.join(" | "));

  const own = newGame();
  comfortable(own);
  shipCommand(own, { action: "rations", id: "generous" });
  for (let day = 0; day < 10; day += 1) {
    comfortable(own);
    own.ship.morale = 70;
    passTime(own, 24, "routine");
  }
  assert.equal(own.ship.rations, "generous", "the captain's order stands");
});

test("they give the captain time first", () => {
  const game = newGame();
  comfortable(game);
  game.ship.rations = "standard";
  const first = withoutSources(() => {
    left(game, "food", 6);
    return passTime(game, 24, "routine");
  });
  assert.ok(!first.some((line) => line.startsWith("[COUNCIL]")), "not on the first day");
  assert.equal(game.ship.rations, "standard");
  assert.equal(game.ship.council.waiting.cut_rations !== undefined, true);
  comfortable(game);
  days(game, 1);
  assert.equal(game.ship.council.waiting.cut_rations, undefined, "and if it stops being a problem they forget about it");
});

test("an order of the captain's own stands for a while before they'd change it", () => {
  const game = newGame();
  comfortable(game);
  shipCommand(game, { action: "rations", id: "standard" });
  shipCommand(game, { action: "rations", id: "generous" });
  const ordered = game.ship.council.ordered.rations;
  assert.ok(Number.isFinite(ordered));
  const notes = [];
  withoutSources(() => {
    for (let day = 0; day < COUNCIL.respect - 1; day += 1) {
      left(game, "food", 6);
      notes.push(...passTime(game, 24, "routine"));
    }
    assert.ok(!notes.some((line) => line.startsWith("[COUNCIL]")), notes.join(" | "));
    assert.equal(game.ship.rations, "generous");
    for (let day = 0; day < 4; day += 1) {
      left(game, "food", 6);
      passTime(game, 24, "routine");
    }
  });
  assert.notEqual(game.ship.rations, "generous", "but not for ever, if it's going to starve everyone");
});

test("told to wait, they wait, whatever happens, and they can be let go again", () => {
  const game = newGame();
  comfortable(game);
  const { message } = shipCommand(game, { action: "council", on: false });
  assert.equal(message, COUNCIL.held);
  assert.equal(shipView(game).council.off, true);
  game.ship.rations = "standard";
  game.ship.morale = 20;
  const notes = [];
  withoutSources(() => {
    for (let day = 0; day < 10; day += 1) {
      left(game, "food", 2);
      left(game, "medicine", 2);
      left(game, "parts", 2);
      notes.push(...passTime(game, 24, "routine"));
    }
    assert.ok(!notes.some((line) => line.startsWith("[COUNCIL]")), notes.join(" | "));
    assert.equal(game.ship.rations, "standard");
    const second = shipCommand(game, { action: "council", on: false });
    assert.equal(second.message, null, "saying it twice doesn't say it twice");
    shipCommand(game, { action: "council", on: true });
    assert.equal(shipView(game).council.off, false);
    const later = [];
    for (let day = 0; day < 4; day += 1) {
      left(game, "food", 2);
      later.push(...passTime(game, 24, "routine"));
    }
    assert.ok(later.some((line) => line.startsWith("[COUNCIL]")));
  });
});

test("one decision a day, because whatever else is wrong will still be wrong tomorrow", () => {
  const game = newGame();
  comfortable(game);
  game.ship.rations = "standard";
  withoutSources(() => {
    for (let day = 0; day < 8; day += 1) {
      left(game, "food", 2.5);
      left(game, "medicine", 3);
      left(game, "parts", 3);
      const said = passTime(game, 24, "routine").filter((line) => line.startsWith("[COUNCIL]"));
      assert.ok(said.length <= 1, said.join(" | "));
    }
  });
  assert.ok(game.ship.council.recent.length >= 1);
});

test("someone who's gone can't decide anything, so the council does it instead", () => {
  const game = newGame();
  comfortable(game);
  const person = findCharacter(game.campaign, "odessa");
  assert.ok(person, "Quartermaster Brandt is in the story");
  game.contacts.push({ name: person.name, status: "dead", attitude: "friendly", note: "" });
  game.ship.rations = "standard";
  const notes = [];
  withoutSources(() => {
    for (let day = 0; day < 4 && game.ship.rations === "standard"; day += 1) {
      left(game, "food", 6);
      notes.push(...passTime(game, 24, "routine"));
    }
  });
  const line = notes.find((one) => one.startsWith("[COUNCIL]"));
  assert.ok(line, notes.join(" | "));
  assert.ok(line.includes(`${COUNCIL.anyone} has checked`), line);
  assert.ok(!line.includes("Brandt"));
  for (const decision of COUNCIL.decisions) {
    if (decision.text.includes("{who}")) assert.ok(/^\{who\}|\. \{who\}/.test(decision.text), `${decision.id} has to read properly when it says "${COUNCIL.anyone}"`);
    assert.ok(holderKey(game, "meridian", decision.post), `${decision.id}: nobody holds the ${decision.post}`);
  }
});

test("everything they decide is something the ship can really do", () => {
  for (const decision of COUNCIL.decisions) {
    assert.ok(decision.set.rations && SHIP_DATA.rations[decision.set.rations], decision.id);
    for (const id of decision.when.rations ?? []) assert.ok(SHIP_DATA.rations[id], `${decision.id}: ${id}`);
    assert.ok(decision.text.length > 20);
    assert.ok(decision.id && decision.post);
    assert.ok(SCENES[decision.id], `${decision.id} has no test of its own`);
  }
});

test("a ship left to itself doesn't flip back and forth", () => {
  // With nothing coming aboard she runs short within the week, and the council deals with it a few times, not daily.
  for (const seed of [3, 21, 77]) {
    const game = newGame(seed);
    const said = [];
    withoutSources(() => {
      for (let day = 0; day < 365; day += 1) {
        said.push(...days(game, 1).filter((line) => line.startsWith("[COUNCIL]")));
        assert.ok(SHIP_DATA.rations[game.ship.rations]);
        assert.ok(game.ship.fuel >= 0);
      }
    });
    assert.ok(said.length >= 2, `seed ${seed}: they only did ${said.length} things in a year`);
    assert.ok(said.length < 120, `seed ${seed}: ${said.length} decisions in a year is too many`);
  }
  // Fed by the shuttle stores' refills, the food's holding: no days left to count, and nothing for them to decide.
  const fed = newGame(21);
  const said = [];
  for (let day = 0; day < 40; day += 1) {
    said.push(...days(fed, 1).filter((line) => line.startsWith("[COUNCIL]")));
  }
  assert.deepEqual(said, []);
  const food = shipView(fed).supplies.find((one) => one.id === "food");
  assert.equal(food.days, null, "holding");
  // The shuttle stores stay full and Brandt keeps the pantry at about four crates; the produce goes as fast as it grows.
  assert.ok(food.stock > 20, `${food.stock} crates aboard`);
});

test("a well-supplied ship with nobody following up its stories feels them, but it isn't worn down", () => {
  for (const seed of [3, 21, 77]) {
    const game = newGame(seed);
    let lowest = 100;
    for (let day = 0; day < 100; day += 1) {
      fillStores(game, "meridian");
      game.ship.fuel = Math.max(game.ship.fuel, 10);
      days(game, 1);
      lowest = Math.min(lowest, game.ship.morale);
    }
    assert.ok(game.ship.morale >= 15, `seed ${seed}: morale ${game.ship.morale}`);
    assert.ok(lowest < 60, "and it does feel it");
  }
});

// ---- Over the real server -------------------------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-stories-server-"));
let child = null;
let port = 0;

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  const save = newGame();
  comfortable(save);
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify(save));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: waiting moves the stories on, the Leads and Ship screens show it, and the council can be told to wait", async () => {
  const held = await post("/api/ship", { action: "council", on: false });
  assert.equal(held.status, 200);
  assert.equal(held.game.ship.council.off, true);
  let game = held.game;
  for (let i = 0; i < 12; i += 1) {
    const waited = await post("/api/ship", { action: "wait", days: 7 });
    if (waited.status !== 200) break;
    game = waited.game;
    if (game.story.moved.length) break;
  }
  assert.ok(game.story.moved.length > 0, "something's moved on");
  assert.ok(game.story.moved[0].title && game.story.moved[0].text && game.story.moved[0].day >= 1);
  const free = await post("/api/ship", { action: "council", on: true });
  assert.equal(free.game.ship.council.off, false);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.ok(state.game.story.moved.length > 0);
  assert.deepEqual(state.game.ship.council.recent, free.game.ship.council.recent);
});
