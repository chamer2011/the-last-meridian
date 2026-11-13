// The player can be anyone: being captain is one way to start, and otherwise someone else has the chair. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-anyone-"));
process.env.GAME_DATA_DIR = dataDir;

const { findCharacter } = await import("../src/campaign.js");
const { NOTABLES, SKILLS } = await import("../src/character-data.js");
const { checkView, startCheck } = await import("../src/checks.js");
const { buildCharacter, createGameFromDraft, creatorSetup, normalizeDraft, randomDraft } = await import("../src/creator.js");
const { FACTIONS, LOCATIONS, STARTING_QUESTS } = await import("../src/data.js");
const { chairOf, changeCommand, shipCommand, shipView } = await import("../src/ship.js");
const { peopleAboard } = await import("../src/life.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { OFFERED_STARTS, START_LIST, aboardShip, isCaptain, jobHere, startIsOff, startOf } = await import("../src/role.js");
const { passTime, publicState, rest, restCost, travel, workShift } = await import("../src/rules.js");
const { countAboard, logisticsOf, takeAboard } = await import("../src/logistics.js");

// The ship's food, medicine and parts are what's in her rooms' stores (world/logistics): a test counts them, empties
// them, or stops the garden and the refills from nothing while a shortage has to last.
const ITEMS_OF = { food: ["ration_crate", "produce"], medicine: ["medicine_crate"], parts: ["parts_crate"] };
const stockOf = (game, id) => countAboard(game, "meridian", ITEMS_OF[id]).n;
function empty(game, id) {
  for (const item of ITEMS_OF[id]) takeAboard(game, "meridian", item, 999);
  if (id === "food") {
    game.stores ??= {};
    game.stores[logisticsOf("meridian").stores.find((one) => one.id === "soup_kettle").key] = { count: 0 };
  }
}
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
const { leadsHere, storyView } = await import("../src/story-library.js");
const { hasMovedOn, leadNow } = await import("../src/story-clock.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { mapFor, roomHere, walkOf, walkView } = await import("../src/walk.js");
const { SHIP_DATA, STAR_MAP, STORY_CLOCK, WORLD_MAPS, WORLD_THREADS } = await import("../src/world.js");

const CHAIR = SHIP_DATA.chair;
const OTHERS = Object.keys(START_LIST).filter((id) => id !== "captain");
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const days = (game, count) => passTime(game, 24 * count, "routine");
// Who's in one of the Meridian's rooms: the rooms are drawn on decks, so it's whoever on the deck stands inside it.
const peopleIn = (game, room) => {
  const { levelId, level } = mapFor("meridian").rooms[room];
  return peopleAboard(game, "meridian", levelId).filter((one) => level.roomAt(one.x, one.y) === room);
};

// ---- What's written down -----------------------------------------------------------

test("every start is somewhere real, with real people, a real job and something on their mind", () => {
  assert.ok(START_LIST.captain?.captain);
  assert.ok(OTHERS.length >= 15, `only ${OTHERS.length} ways to start`);
  for (const id of OTHERS) {
    const start = START_LIST[id];
    assert.ok(["fleet", "world"].includes(start.group), id);
    for (const field of ["name", "short", "desc", "gm", "opening"]) assert.ok(typeof start[field] === "string" && start[field].length > 3, `${id}: ${field}`);
    assert.ok(LOCATIONS[start.place], `${id}: ${start.place}`);
    assert.ok(mapFor(start.place)?.rooms[start.room], `${id}: there's no ${start.room} at ${start.place}`);
    assert.ok(start.job.name && start.job.done && start.job.pay > 0 && SKILLS[start.job.skill], `${id}: the job`);
    for (const person of start.people) assert.ok(NOTABLES[person], `${id}: ${person}`);
    for (const faction of Object.keys(start.factions ?? {})) assert.ok(FACTIONS[faction], `${id}: ${faction}`);
    for (const field of ["id", "title", "desc", "objective"]) assert.ok(start.quest[field], `${id}: the quest's ${field}`);
    assert.ok(!/\b(captain of the Meridian|your fleet|your ship)\b/i.test(start.desc), `${id} sounds like a captain`);
    if (start.group === "fleet") assert.ok(["meridian", "sundial", "anselm"].includes(start.place), `${id} is listed with the ships, and isn't on one`);
  }
  assert.equal(new Set(OTHERS.map((id) => START_LIST[id].quest.id)).size, OTHERS.length, "each has a quest of its own");
});

test("nearly every story can reach someone who isn't the captain, in words written for them", () => {
  const ids = Object.keys(WORLD_THREADS);
  const open = ids.filter((id) => WORLD_THREADS[id].anyone);
  assert.ok(open.length >= 100, `only ${open.length} stories`);
  for (const id of open) {
    const text = WORLD_THREADS[id].anyone;
    assert.ok(text.length > 40, id);
    assert.ok(!/\b(you|your|yours)\b/i.test(text), `${id} is talking to the captain: ${text}`);
  }
  for (const id of ids.filter((one) => !WORLD_THREADS[one].anyone)) assert.ok(WORLD_THREADS[id].kind, `${id} is the captain's own`);
});

test("three people could have the chair, each with a file, a post, a day, and their own way of doing it", () => {
  const ids = Object.keys(CHAIR.captains);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    const person = NOTABLES[id];
    assert.ok(person, `${id} has no file`);
    assert.equal(person.chair, true);
    assert.equal(person.listed, false, "the game master doesn't need them unless they're in the chair");
    assert.ok(person.goals && person.secrets && person.voice);
    assert.ok(Object.values(mapFor("meridian").levels).some((level) => level.homes.some((home) => home.id === id)), `${id} has no post`);
    const file = CHAIR.captains[id];
    assert.equal(file.name, `Captain ${person.name.split(" ").at(-1)}`);
    for (const key of ["moveAt", "stockTo", "restDays", "risk"]) assert.ok(Number.isFinite(file[key]), `${id}: ${key}`);
  }
  for (const port of CHAIR.ports) assert.ok(STAR_MAP.places[port] && !LOCATIONS[port].hidden, port);
});

test("a captain's game hasn't changed: it starts where it always did, with the people it always had", () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  assert.equal(game.version, 24);
  assert.deepEqual(game.role, { id: "captain", captain: true });
  assert.equal(isCaptain(game), true);
  assert.equal(game.location, "meridian");
  assert.equal(game.ship.chair, null);
  assert.deepEqual(game.quests.map((quest) => quest.id), STARTING_QUESTS.map((quest) => quest.id));
  assert.ok(game.contacts.some((contact) => contact.name === NOTABLES.voss.name));
  assert.equal(publicState(game).role.captain, true);
  assert.equal(publicState(game).role.job, null);
  assert.equal(chairOf(game), null);
  assert.match(publicState(game).people.find((person) => person.id === "voss").role, /^Your /);
});

// ---- Starting as someone else -------------------------------------------------------

for (const id of OTHERS) {
  test(`starting as ${START_LIST[id].short}: in the right place, in the right room, with the right people`, () => {
    const start = START_LIST[id];
    const game = newGame(id);
    assert.deepEqual(game.role, { id, captain: false });
    assert.equal(isCaptain(game), false);
    assert.equal(game.location, start.place);
    assert.equal(roomHere(game).id, start.room);
    assert.equal(walkView(game).here.name, mapFor(start.place).rooms[start.room].name);
    assert.ok(game.seenLore.includes(`place:${start.place}`));
    assert.deepEqual(game.quests.map((quest) => quest.id), [start.quest.id]);
    assert.ok(game.contacts.length >= start.people.length);
    for (const person of start.people) assert.ok(game.contacts.some((contact) => contact.name === NOTABLES[person].name), person);
    assert.equal(game.ship.at, null, "the Meridian is wherever she is, and it's not here");
    assert.ok(chairOf(game));
    const shown = publicState(game);
    assert.equal(shown.role.title, start.name);
    assert.equal(shown.role.job.name, start.job.name);
    assert.ok(shown.locations.some((place) => place.here));
    for (const person of start.people) assert.ok(!shown.contacts.find((contact) => contact.name === NOTABLES[person].name).note.includes("Your "), "nobody here is theirs to command");
  });
}

test("how someone got through the Fall depends on where they ended up", () => {
  for (const fall of ["last_stand", "evacuated", "fled", "captured", "away"]) {
    const captain = randomDraft({ seed: 5, archetype: "officer" });
    captain.life.fall = fall;
    const other = structuredClone(captain);
    other.start = "docker";
    const told = buildCharacter(captain).view.life;
    const elsewhere = buildCharacter(other).view.life;
    assert.match(told.biography.at(-1), /Meridian/, fall);
    assert.ok(!/Meridian/.test(elsewhere.biography.at(-1)), `${fall}: ${elsewhere.biography.at(-1)}`);
    assert.ok(!/Meridian/.test(elsewhere.fall.text), `${fall}: ${elsewhere.fall.text}`);
    assert.deepEqual(buildCharacter(other).game.stats, buildCharacter(captain).game.stats, "and it's only the words that change");
    assert.equal(told.fall.label, elsewhere.fall.label);
  }
});

test("the creator offers only the lives that aren't switched off, which is the captain's; the others are kept, and can still be made", () => {
  const setup = creatorSetup();
  assert.deepEqual(Object.keys(setup.starts), ["captain"], "every other life has off: true in world/starts.json");
  assert.deepEqual(Object.keys(OFFERED_STARTS), ["captain"]);
  assert.equal(Object.keys(START_LIST).length, 22, "and all the lives are still in the file");
  assert.ok(startIsOff("docker") && !startIsOff("captain") && !startIsOff("emperor"));
  assert.ok(setup.steps.some((step) => step.id === "role"));
  assert.deepEqual(Object.keys(setup.startGroups), ["fleet"], "only the group that has a life on offer");
  assert.equal(setup.starts.captain.name, START_LIST.captain.name);
  assert.ok(START_LIST.docker.job.pay > 0, "a life that's off keeps everything it had");
  assert.equal(normalizeDraft({}).start, "captain");
  assert.equal(normalizeDraft({ start: "docker" }).start, "docker", "a life that's off is still one the game knows, for a game saved with it");
  assert.equal(normalizeDraft({ start: "emperor" }).start, "captain");
  assert.equal(normalizeDraft({ start: "constructor" }).start, "captain");
  const captain = randomDraft({ seed: 9, archetype: "officer" });
  assert.equal(captain.start, "captain");
  assert.equal(buildCharacter(captain).view.start.begin, "Take command of the Meridian");
  assert.equal(randomDraft({ seed: 9, archetype: "officer", keep: { start: "miner" } }).start, "miner");
  const miner = buildCharacter({ ...captain, start: "miner" }).view;
  assert.equal(miner.start.begin, `Begin at ${LOCATIONS.cinder.name}`);
  assert.equal(miner.errors.role.length, 0);
  const seen = new Set();
  for (let seed = 0; seed < 60; seed += 1) seen.add(randomDraft({ seed, anyone: true }).start);
  assert.deepEqual([...seen], ["captain"], "Surprise me only picks a life that's on offer");
});

// ---- What they can and can't do -----------------------------------------------------------

test("someone who isn't the captain can't give the ship orders, but they can wait, and go places", () => {
  const game = newGame("docker");
  const { rations } = game.ship;
  for (const order of [{ action: "rations", id: "half" }, { action: "buy", id: "fuel" }, { action: "sell", id: "fuel" }, { action: "council", on: false }]) {
    assert.throws(() => shipCommand(game, order), /has the chair/, order.action);
  }
  assert.equal(game.ship.rations, rations);
  const waited = shipCommand(game, { action: "wait", days: 1 });
  assert.match(waited.message, /^You let 1 day go by/);
  assert.ok(game.clock.hours >= 32);
});

test("passage costs credits and time, moves them and nobody else, and doesn't touch the ship", () => {
  const game = newGame("docker");
  // Whoever has the chair has just jumped, so the ship stays put for the days this takes.
  game.ship.chair.lastJump = 999;
  game.credits = 200;
  const { fuel } = game.ship;
  const at = game.ship.at;
  const entry = publicState(game).locations.find((place) => place.id === "kessara");
  assert.ok(entry.fare > 0, "it isn't free");
  assert.equal(entry.fuel, 0, "and it's not the ship's fuel");
  assert.equal(entry.jump, true);
  assert.equal(entry.canGo, true);
  const hours = game.clock.hours;
  const result = shipCommand(game, { action: "course", id: "kessara" });
  assert.equal(result.moved, true);
  assert.equal(game.location, "kessara");
  assert.equal(game.credits, 200 - entry.fare);
  assert.equal(game.ship.fuel, fuel);
  assert.equal(game.ship.at, at);
  assert.equal(game.clock.hours, hours + entry.hours);
  assert.equal(game.walk, null);
  assert.equal(game.arrived, "kessara", "a written arrival there would play when they carry on");
  assert.match(result.message, /^Took passage/);
});

test("nobody can book a passage they can't pay for, or that nobody runs", () => {
  const game = newGame("docker");
  game.credits = 2;
  const entry = publicState(game).locations.find((place) => place.id === "kessara");
  assert.equal(entry.canGo, false);
  assert.match(entry.why, /Passage costs \d+ credits, and you have 2/);
  assert.throws(() => shipCommand(game, { action: "course", id: "kessara" }), /costs \d+ credits/);
  assert.equal(game.location, "haven");
  game.credits = 9000;
  game.seenLore.push("place:nest");
  const nest = publicState(game).locations.find((place) => place.id === "nest");
  assert.equal(nest.canGo, false);
  assert.match(nest.why, /Nobody runs a ship there/);
  assert.throws(() => shipCommand(game, { action: "course", id: "nest" }), /Nobody runs a ship/);
  assert.equal(game.credits, 9000);
});

test("danger and distance make a passage dearer, and the Meridian is a short hop only from the dock she's at", () => {
  const game = newGame("docker");
  game.credits = 500;
  const fare = (id) => publicState(game).locations.find((place) => place.id === id);
  assert.ok(fare("kessara").fare > 0);
  assert.equal(fare("meridian").jump, true, "the Meridian isn't here");
  assert.ok(fare("meridian").fare > 0);
  game.ship.at = "haven";
  assert.equal(aboardShip(game), true);
  assert.equal(fare("meridian").jump, false, "and now she is");
  assert.equal(fare("meridian").fare, 0);
  assert.equal(fare("meridian").hours, 1);
  const before = game.credits;
  shipCommand(game, { action: "course", id: "meridian" });
  assert.equal(game.location, "meridian");
  assert.equal(game.credits, before);
  assert.equal(fare("haven").jump, false, "and back to the dock");
  assert.equal(fare("sundial").jump, true, "the Sundial is a place of her own now, a passage away");
  game.ship.at = "cinder";
  game.seenLore.push("place:cinder");
  assert.equal(fare("cinder").jump, false);
  assert.equal(fare("haven").jump, true, "the ship took them along");
  const cheap = newGame("docker");
  cheap.seenLore.push("place:ghostlight", "place:deepyards");
  const spots = STAR_MAP.places;
  assert.ok(spots.ghostlight.danger > spots.deepyards.danger);
  const quiet = publicState(cheap).locations.find((place) => place.id === "deepyards");
  const risky = publicState(cheap).locations.find((place) => place.id === "ghostlight");
  assert.ok(risky.fare > quiet.fare, `${risky.fare} against ${quiet.fare}`);
  assert.ok(Number.isInteger(quiet.fare) && Number.isInteger(risky.fare));
});

test("if the story takes them somewhere, they go by themselves, and it can't move the ship", () => {
  const game = newGame("engine_hand");
  game.ship.chair.lastJump = 999;
  const { fuel } = game.ship;
  const { message } = travel(game, "wheel");
  assert.match(message, /Took passage/);
  assert.equal(game.location, "wheel");
  assert.equal(game.ship.fuel, fuel);
  assert.equal(game.ship.at, null);
  assert.equal(aboardShip(game), false);
  const { result, isError } = tool(game, "travel", { destination: "korrath" });
  assert.ok(!isError, result);
  assert.equal(game.location, "korrath");
  assert.equal(game.ship.at, null);
});

test("a shift at their job pays, takes eight hours, tires them out, and practices what it's for", () => {
  const game = newGame("docker");
  const start = startOf(game);
  const credits = game.credits;
  const hours = game.clock.hours;
  const fatigue = game.needs.fatigue;
  assert.equal(publicState(game).role.job.name, start.job.name);
  const said = workShift(game);
  assert.ok(said.includes(start.job.done));
  assert.ok(game.credits >= credits + start.job.pay);
  assert.equal(game.clock.hours, hours + 8);
  assert.ok(game.needs.fatigue > fatigue);
  assert.ok((game.skillXp[start.job.skill] ?? 0) > 0);
  game.needs.fatigue = 90;
  assert.throws(() => workShift(game), /too tired/);
  game.needs.fatigue = 10;
  game.location = "kessara";
  assert.equal(jobHere(game), null);
  assert.throws(() => workShift(game), /no work here/);
  assert.equal(publicState(game).role.job, null);
  assert.equal(publicState(game).role.jobAway.place, LOCATIONS.haven.name);
  assert.throws(() => workShift(newGame()), /no work here/);
  assert.equal(publicState(newGame()).role.jobAway, null);
});

test("they can sleep for nothing where they live and aboard the Meridian, and elsewhere they pay or sleep rough", () => {
  const game = newGame("docker");
  assert.equal(restCost(game), 0);
  game.hp = 1;
  let credits = game.credits;
  assert.match(rest(game), /at Haven Station/);
  assert.equal(game.credits, credits);
  assert.equal(game.hp, publicState(game).maxHp);
  game.location = "kessara";
  game.credits = 50;
  const cost = restCost(game);
  assert.ok(cost > 0);
  assert.match(rest(game), /rented bunk at Kessara Drift/);
  assert.equal(game.credits, 50 - cost);
  game.credits = 1;
  assert.throws(() => rest(game), /A bunk here costs/);
  game.hp = 1;
  game.needs.stress = 0;
  credits = game.credits;
  assert.match(rest(game, { rough: true }), /in a corner of Kessara Drift/);
  assert.equal(game.credits, credits);
  assert.ok(game.hp < publicState(game).maxHp, "it doesn't do you as much good");
  assert.ok(game.needs.stress > 0);
  game.location = "meridian";
  assert.equal(restCost(game), 0);
  assert.throws(() => rest(game, { rough: true }), /no need to sleep rough/);
  const captain = newGame();
  assert.equal(restCost(captain), 0);
  assert.match(rest(captain), /aboard the Meridian/);
  captain.location = "haven";
  assert.equal(restCost(captain), null);
  assert.throws(() => rest(captain), /only rest aboard the Meridian/);
});

// ---- Someone else in the chair ----------------------------------------------------------------

test("whoever has the chair is on the Meridian, and nobody else who could have had it is", () => {
  const game = newGame("engine_hand");
  game.clock.hours = 8;
  const chair = chairOf(game);
  const onBridge = peopleIn(game, "bridge").map((one) => one.id);
  assert.ok(onBridge.includes(chair.id), `${chair.id} isn't on the bridge: ${onBridge}`);
  for (const id of Object.keys(CHAIR.captains)) if (id !== chair.id) assert.ok(!onBridge.includes(id), id);
  assert.ok(onBridge.includes("voss"), "and Commander Voss is still her XO");
  const captain = newGame();
  const captainsBridge = peopleIn(captain, "bridge").map((one) => one.id);
  for (const id of Object.keys(CHAIR.captains)) assert.ok(!captainsBridge.includes(id), `${id} shouldn't be there for a captain`);
  assert.equal(shipView(game).chair, chair.name);
  assert.equal(shipView(captain).chair, null);
  assert.ok(findCharacter(game.campaign, chair.id).chair);
});

test("the same person gets the same captain, a save keeps them, and other people get others", () => {
  assert.equal(chairOf(newGame("docker")).id, chairOf(newGame("docker")).id);
  assert.equal(chairOf(JSON.parse(JSON.stringify(newGame("docker")))).id, chairOf(newGame("docker")).id);
  const seen = new Set();
  for (let seed = 1; seed < 40; seed += 1) seen.add(chairOf(newGame("docker", seed)).id);
  assert.equal(seen.size, 3);
});

test("the ship goes on by itself: whoever has the chair moves her when she needs something, buys it with her own money, and never asks the player", () => {
  const game = newGame("docker");
  const { credits } = game;
  const funds = game.ship.chair.funds;
  const places = new Set();
  let bought = false;
  const daysOut = [];
  for (let day = 0; day < 120; day += 1) {
    const before = game.ship.chair.funds;
    days(game, 1);
    if (game.ship.chair.funds < before + CHAIR.income) bought = true;
    if (game.ship.at) places.add(game.ship.at);
    // The stories' clocks take medicine several crates at a time, so the chair keeps a few however little a day uses.
    if (game.ship.out?.medicine > 0) daysOut.push(day + 1);
    assert.equal(game.arrived ?? null, null, "nothing's waiting on them");
    assert.equal(game.location, "haven", "and they haven't been taken anywhere");
  }
  assert.equal(game.credits, credits, "none of that came out of their pocket");
  assert.ok(places.size >= 1, "she went somewhere for what she needed");
  assert.ok(bought, `she never bought anything: ${funds}`);
  for (const place of places) assert.ok(CHAIR.ports.includes(place), place);
  assert.ok(stockOf(game, "food") > 0 && stockOf(game, "medicine") > 0, "and she's kept fed");
  assert.deepEqual(daysOut, [], `and she's never out of medicine (body seed ${game.bodySeed})`);
});

test("someone away from the Meridian doesn't go hungry with her, or hear her troubles, or heal slower for them", () => {
  const away = newGame("docker");
  empty(away, "food");
  empty(away, "medicine");
  away.ship.fuel = 0;
  away.ship.chair.funds = 0;
  const notes = withoutSources(() => days(away, 6));
  assert.ok(!away.conditions.some((condition) => condition.id === "underfed"));
  assert.ok(!notes.some((line) => line.startsWith("[SUPPLY]") || line.startsWith("[COUNCIL]")), notes.join(" | "));
  assert.ok(away.ship.log.length > 0, "it's still happening, and it's in the ship's own log");
  const aboard = newGame("engine_hand");
  empty(aboard, "food");
  aboard.ship.chair.funds = 0;
  aboard.ship.rations = "half";
  const heard = withoutSources(() => days(aboard, 6));
  assert.ok(aboard.conditions.some((condition) => condition.id === "underfed"), "aboard, they eat what everyone eats");
  assert.ok(heard.some((line) => line.startsWith("[SUPPLY]")));
});

test("whoever's on the dock sees the Meridian come and go", () => {
  const game = newGame("docker");
  game.ship.at = "haven";
  // Down to a day or so of food, with nothing coming aboard from nothing meanwhile.
  takeAboard(game, "meridian", "ration_crate", 32);
  takeAboard(game, "meridian", "produce", 14);
  game.ship.chair.id = "reddick";
  game.ship.chair.funds = 0;
  game.world.places.haven.goods.food = 0;
  let notes = [];
  withoutSources(() => {
    for (let day = 0; day < 12 && game.ship.at === "haven"; day += 1) notes = days(game, 1);
  });
  assert.notEqual(game.ship.at, "haven", "she should have gone looking for food");
  assert.ok(notes.some((line) => /The Meridian has left Haven Station/.test(line)), notes.join(" | "));
  assert.equal(game.location, "haven");
  assert.equal(aboardShip(game), false);
  assert.ok(game.world.news.some((entry) => /The Meridian has come in at/.test(entry.text)));
});

test("a year of it under each of them never breaks anything, and comes out the same however it's cut up", () => {
  for (const id of Object.keys(CHAIR.captains)) {
    const game = newGame("engine_hand");
    game.ship.chair.id = id;
    for (let day = 0; day < 365; day += 1) {
      days(game, 1);
      for (const key of ["food", "medicine", "parts"]) assert.ok(Number.isFinite(game.ship[key]) && game.ship[key] >= 0, key);
      assert.ok(game.ship.fuel >= 0 && game.ship.fuel <= game.ship.maxFuel, `fuel ${game.ship.fuel}`);
      assert.ok(game.ship.hull >= 1 && game.ship.hull <= game.ship.maxHull, `hull ${game.ship.hull}`);
      assert.ok(game.ship.chair.funds >= 0);
      assert.ok(SHIP_DATA.rations[game.ship.rations]);
      assert.ok(game.ship.at === null || LOCATIONS[game.ship.at]);
      assert.ok(game.ship.aboard >= SHIP_DATA.rules.peopleFloor, `${game.ship.aboard} aboard`);
    }
    assert.ok(JSON.stringify(game.ship.chair).length < 200);
    assert.ok(JSON.stringify(game.ship.council).length < 3000);
  }
  const one = newGame("docker");
  days(one, 70);
  const two = newGame("docker");
  // The same game: everyone's body, and who falls ill, are made up from the game's own seed.
  two.bodySeed = one.bodySeed;
  days(two, 30);
  const loaded = JSON.parse(JSON.stringify(two));
  for (let day = 0; day < 40; day += 1) days(loaded, 1);
  // The log's day labels say when each line was written, which depends on how the time was cut up; the rest can't.
  const same = (ship) => ({ ...ship, log: ship.log.map((entry) => entry.text), council: { ...ship.council, recent: ship.council.recent.map((entry) => entry.text) } });
  assert.deepEqual(same(one.ship), same(loaded.ship));
  assert.deepEqual(one.world.places, loaded.world.places);
});

test("a ship with someone in the chair is at least as well off as one nobody's looking after", () => {
  for (const seed of [3, 21, 77]) {
    const looked = newGame("docker", seed);
    days(looked, 100);
    assert.ok(looked.ship.health >= 25, `seed ${seed}: health ${looked.ship.health} at day 100`);
    const onItsOwn = newGame("captain", seed);
    onItsOwn.ship.council = { off: true, ordered: {}, waiting: {}, last: {}, setRations: null, recent: [] };
    days(onItsOwn, 100);
    assert.ok(looked.ship.health >= onItsOwn.ship.health, `seed ${seed}: ${looked.ship.health} against ${onItsOwn.ship.health}`);
  }
});

// ---- The chair can change hands ----------------------------------------------------------------

test("the story can put them in the chair, once they're aboard, and then it's all theirs", () => {
  const game = newGame("engine_hand");
  const was = chairOf(game);
  const { result, notice, isError } = tool(game, "change_command", { takes: true, reason: "The council voted" });
  assert.ok(!isError, result);
  assert.match(notice, /You have command of the Meridian: The council voted/);
  assert.ok(result.includes(was.name));
  assert.equal(isCaptain(game), true);
  assert.equal(chairOf(game), null);
  assert.equal(game.ship.chair, null);
  shipCommand(game, { action: "rations", id: "reduced" });
  assert.equal(game.ship.rations, "reduced");
  assert.equal(publicState(game).role.captain, true);
  assert.equal(publicState(game).role.job, null);
  assert.ok(!peopleIn(game, "bridge").some((one) => one.id === was.id), "and whoever had it isn't standing there");
  const away = newGame("docker");
  const refused = tool(away, "change_command", { takes: true, reason: "A rumor" });
  assert.equal(refused.isError, true);
  assert.match(refused.result, /aboard the Meridian/);
  assert.equal(isCaptain(away), false);
});

test("the story can take a captain out of the chair, and the world carries on without them in it", () => {
  const game = newGame();
  const { result, notice, isError } = tool(game, "change_command", { takes: false, reason: "The Admiral's court" });
  assert.ok(!isError, result);
  assert.match(notice, /has command of the Meridian now: The Admiral's court/);
  assert.equal(isCaptain(game), false);
  const chair = chairOf(game);
  assert.ok(chair);
  assert.ok(result.includes(chair.name));
  const shown = publicState(game).role;
  assert.equal(shown.title, "Former captain of the Meridian");
  assert.equal(shown.short, "former captain");
  assert.equal(shown.job, null);
  assert.equal(shown.chair, chair.name);
  assert.throws(() => shipCommand(game, { action: "rations", id: "half" }), /has the chair/);
  assert.equal(restCost(game), 0, "they still have a bunk aboard");
  days(game, 30);
  const already = tool(game, "change_command", { takes: false, reason: "Again" });
  assert.match(already.result, /aren't in command anyway/);
});

// ---- Stories -------------------------------------------------------------------------------------

test("the leads they see are written for them, and the captain's own business isn't among them", () => {
  const game = newGame("engine_hand");
  game.level = 10;
  const leads = leadsHere(game);
  assert.ok(leads.length > 0);
  for (const lead of leads) {
    assert.equal(lead.lead, WORLD_THREADS[lead.id].anyone, lead.id);
    assert.ok(!/\byour?\b/i.test(lead.lead));
  }
  const own = Object.keys(WORLD_THREADS).filter((id) => !WORLD_THREADS[id].anyone);
  const seen = new Set();
  for (let day = 0; day < 40; day += 1) {
    game.clock.hours = day * 48 + 8;
    for (const place of ["meridian", "haven", "ghostlight", "vantor", "wheel", "deepyards", "cinder", "bastion"]) {
      game.location = place;
      for (const lead of leadsHere(game)) seen.add(lead.id);
    }
  }
  for (const id of own) assert.ok(!seen.has(id), `${id} is the captain's own business`);
  assert.ok(seen.size > 30, `only ${seen.size} leads`);
  const captain = newGame();
  captain.level = 10;
  for (const lead of leadsHere(captain)) assert.equal(lead.lead, WORLD_THREADS[lead.id].lead, "a captain's leads are as they were");
});

test("a story that's moved on reads as what's got around", () => {
  const game = newGame("miner");
  game.level = 5;
  for (let day = 0; day < 60 && !hasMovedOn(game, "out_cinder_strike"); day += 1) days(game, 1);
  assert.ok(hasMovedOn(game, "out_cinder_strike"));
  const stage = STORY_CLOCK.threads.out_cinder_strike.stages[game.story.clock.threads.out_cinder_strike.stage - 1];
  assert.equal(leadNow(game, "out_cinder_strike"), stage.news);
});

test("the captain's stories go on over their head", () => {
  const game = newGame("docker");
  const OWN = "out_cinder_three_prices";
  assert.ok(!WORLD_THREADS[OWN].anyone);
  for (let day = 0; day < 200 && !hasMovedOn(game, OWN); day += 1) days(game, 1);
  assert.ok(hasMovedOn(game, OWN), "it moved on all the same");
  assert.equal(game.story.threads[OWN], undefined, "nobody took it up");
  assert.ok(leadNow(game, OWN));
});

test("the Meridian's chair and the people aboard treat someone else as someone else", () => {
  const game = newGame("engine_hand");
  game.walk = null;
  walkOf(game);
  const view = walkView({ ...game });
  const chairThing = view.things.find((thing) => thing.name === "The captain's chair");
  assert.match(chairThing.look, /It isn't yours/);
  assert.match(chairThing.use, /while nobody's watching/);
  const captain = newGame();
  const own = walkView(captain).things.find((thing) => thing.name === "The captain's chair");
  assert.match(own.look, /It's yours now/);
  const voss = newGame("marine");
  assert.match(publicState(voss).people.find((person) => person.id === "voss").role, /^The Meridian's /);
  // Engineering is drawn on a deck, so Tobin is among that deck's people in the ship's file.
  const deck = WORLD_MAPS.meridian.levels[mapFor("meridian").rooms.engineering.levelId];
  assert.ok(Object.values(deck.people).find((person) => person.id === "tobin").asksOther);
});

test("a save from before all this is a captain's, and stays one", () => {
  const old = newGame();
  old.version = 13;
  delete old.role;
  delete old.ship.chair;
  old.clock.hours = 300;
  old.location = "meridian";
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 24);
  assert.deepEqual(game.role, { id: "captain", captain: true });
  assert.equal(isCaptain(game), true);
  assert.equal(chairOf(game), null);
  assert.equal(publicState(game).role.captain, true);
  shipCommand(game, { action: "rations", id: "reduced" });
  assert.equal(game.ship.rations, "reduced");
  // Even one with no role in it at all still counts.
  assert.equal(isCaptain({}), true);
  const same = newGame("docker");
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(same))).role, same.role);
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(same))).ship.chair, same.ship.chair);
});

test("looking at it changes nothing in the save", () => {
  const game = newGame("docker");
  days(game, 12);
  const before = JSON.stringify(game);
  publicState(game);
  storyView(game);
  shipView(game);
  assert.equal(JSON.stringify(game), before);
});

// ---- Over the real server ---------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-anyone-server-"));
let child = null;
let port = 0;

const freePort = () => new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  port = await freePort();
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

test("over the real server: a life that's switched off can't begin a new game, and a game saved with it still opens: a dock hand works, books passage, and is refused the ship's orders", async () => {
  const draft = randomDraft({ seed: 42, archetype: "officer" });
  draft.start = "docker";
  const notOffered = await post("/api/new", { draft });
  assert.equal(notOffered.status, 400);
  assert.match(notOffered.error, /switched off for now/);
  // A game saved as a dock hand, from when that life was offered, opens as it was.
  fs.writeFileSync(path.join(serverData, "saves", "slot1.json"), JSON.stringify(createGameFromDraft(draft)));
  const made = await post("/api/load", { slot: "slot1" });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.role.captain, false);
  assert.equal(made.game.location.id, "haven");
  assert.equal(made.game.walk.here.name, "The Manifest Docks");
  assert.equal(made.game.role.job.name, START_LIST.docker.job.name);
  assert.ok(made.game.role.chair);

  const started = await post("/api/chat", { event: "start" });
  assert.equal(started.status, 200);
  assert.match(started.text, /No story is written for now/, "nothing's written to open the game, and it says so");
  assert.ok(!started.text.includes("made captain"));

  const credits = made.game.credits;
  const worked = await post("/api/action", { action: "work" });
  assert.equal(worked.status, 200, JSON.stringify(worked));
  assert.ok(worked.game.credits > credits);
  assert.ok(worked.message.includes(START_LIST.docker.job.done));

  const refused = await post("/api/ship", { action: "rations", id: "half" });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /has the chair/);

  const entry = worked.game.locations.find((place) => place.id === "kessara");
  const gone = await post("/api/ship", { action: "course", id: "kessara" });
  assert.equal(gone.status, 200, JSON.stringify(gone));
  assert.equal(gone.moved, true);
  assert.equal(gone.game.location.id, "kessara");
  assert.equal(gone.game.credits, worked.game.credits - entry.fare);
  assert.ok(gone.game.role.rest > 0, "it's not home");
  const slept = await post("/api/action", { action: "rest", rough: true });
  assert.equal(slept.status, 200, JSON.stringify(slept));
  assert.match(slept.message, /in a corner of Kessara Drift/);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.game.role.title, START_LIST.docker.name);
  assert.equal(state.game.role.jobAway.place, LOCATIONS.haven.name);
});

test("a check window doesn't call someone else the captain", () => {
  const open = (game, skill) => {
    startCheck(game, { skill, difficulty: "moderate", reason: "A test", source: "practice" });
    return checkView(game).prompt;
  };
  assert.equal(open(newGame(), "leadership"), "captain:");
  assert.equal(open(newGame("docker"), "leadership"), "you:");
  assert.equal(open(newGame(), "hacking"), "root@meridian:~$");
  assert.equal(open(newGame("docker"), "hacking"), "root@terminal:~$");
  for (const skill of Object.keys(SKILLS)) assert.ok(!/captain|meridian/i.test(open(newGame("docker"), skill)), skill);
});