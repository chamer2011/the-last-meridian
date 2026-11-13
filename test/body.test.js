// Everyone's body, made up when a game begins (health step 1): six parts with old marks and wounds, from species, age,
// job and past, a person's own file winning; the same all game and different in the next; the player's from their life
// story, traits and conditions; shown on Look, the printouts and the inventory, and never written to the save.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-body-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { bodyOf, bodyView, crowdWho, healthProblems, lookLine, pastLines, statusOf } = await import("../src/body.js");
const { personSheet } = await import("../src/person-sheet.js");
const { migrateGame } = await import("../src/migrate.js");
const { publicState } = await import("../src/rules.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { CAREERS, FALL_CHOICES, GENERAL_EVENTS, GENERAL_MISHAPS } = await import("../src/life-data.js");
const { WORLD_CHARACTERS, WORLD_LIFE, WORLD_SPECIES, WOUNDS } = await import("../src/world.js");
const health = await import("../public/health-text.js");
const { parsePersonText, parseSpeciesText, writePersonText, writeSpeciesText } = await import("../public/world-text.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
const crowdOf = (place) => (WORLD_LIFE[place]?.crowd ?? []).flatMap((group) => group.names.map(([name]) => name));
const words = (body) => body.marks.map((mark) => `${mark.part}: ${mark.words}`).sort().join(" | ");

test("the files read cleanly: every species has six parts to be hit, and the checker finds nothing", () => {
  assert.deepEqual(healthProblems(), []);
  for (const [id, species] of Object.entries(WORLD_SPECIES)) {
    assert.deepEqual(Object.keys(species.body?.hits ?? {}).sort(), [...health.PARTS].sort(), `${id} names all six parts`);
  }
  assert.ok(WOUNDS.wounds.length >= 10 && WOUNDS.marks.length >= 15, "the wounds file has its kinds");
  for (const one of [...WOUNDS.wounds, ...WOUNDS.marks]) assert.ok(!health.readKindLine(one.text).problem, one.text);
  // The files and the Body parts read back exactly as they were written.
  const dir = path.resolve("world/health");
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".txt") && !n.startsWith("_"))) {
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    const back = name === "wounds.txt" ? health.writeWoundsText(health.parseWoundsText(text).value) : health.writeHealthText(health.parseHealthText(text).value);
    assert.equal(back, text, `${name} reads back the same`);
  }
  for (const id of ["korrun", "synthetic"]) {
    const text = fs.readFileSync(path.resolve(`world/species/${id}.txt`), "utf8");
    assert.equal(writeSpeciesText(parseSpeciesText(text).value), text);
  }
  const marrow = fs.readFileSync(path.resolve("world/characters/marrow.txt"), "utf8");
  assert.equal(writePersonText(parsePersonText(marrow).value), marrow);
});

test("the readers say what's wrong with a line, in words", () => {
  assert.match(health.readKindLine("sprain, an ankle: a sprain").problem, /isn't a part/);
  assert.match(health.readKindLine("graze, any part: a graze; stings a lot").problem, /don't know the rule "stings a lot"/);
  assert.match(health.readKindLine("no where at all").problem, /each one is written/);
  assert.match(health.readStartLine("Vik, elbow: bruise").problem, /isn't a part/);
  assert.deepEqual(health.readBodyLine("nothing else"), { nothingElse: true });
  assert.deepEqual(health.readWhere("the chest or a limb").parts, ["chest", "right_arm", "left_arm", "right_leg", "left_leg"]);
  assert.deepEqual(health.readRule("heals in 4 days, 2 once dressed"), { heals: 4, treated: 2, treatment: "dressed" });
  assert.deepEqual(health.readRule("checks one step harder"), { harder: 1 });
});

test("the same person has the same body all game, and the next game makes up others", () => {
  const game = newGame();
  const names = crowdOf("meridian");
  const first = names.map((name) => words(bodyOf(game, { name, place: "meridian" })));
  const again = names.map((name) => words(bodyOf(structuredClone(game), { name, place: "meridian" })));
  assert.deepEqual(again, first, "the same seed, the same bodies");
  const other = { ...game, bodySeed: game.bodySeed + 1 };
  const second = names.map((name) => words(bodyOf(other, { name, place: "meridian" })));
  assert.notDeepEqual(second, first, "another game, other marks");
  // Everyone on file has one too, and the people with days everywhere.
  for (const id of Object.keys(WORLD_CHARACTERS)) assert.ok(bodyOf(game, { id }), id);
  for (const place of Object.keys(WORLD_LIFE)) for (const name of crowdOf(place)) assert.ok(bodyOf(game, { name, place }), `${name} at ${place}`);
  assert.equal(bodyOf(game, { id: "nobody_at_all" }), null);
});

test("a person's own file wins over what's made up, in every game", () => {
  for (const bodySeed of [1, 2, 3, 99, 12345]) {
    const game = { ...newGame(), bodySeed };
    const marrow = bodyOf(game, { id: "marrow" });
    assert.ok(marrow.marks.some((mark) => mark.part === "left_arm" && /two fingers gone from the left hand/i.test(mark.words)), "Marrow's fingers");
    assert.ok(marrow.marks.length <= 3, "no more than the most anyone carries");
    assert.equal(statusOf(bodyOf(game, { id: "rennick" })), "Walks with a limp", "Rennick limps on whichever leg");
    const voss = bodyView(bodyOf(game, { id: "voss" }));
    assert.equal(voss.marks.find((mark) => /burn scar along one jaw/i.test(mark.words))?.state, "old", "a burn scar is an old mark, not a burn");
    // Vik and Hana are on the medbay's cots for a reason now.
    const vik = bodyView(bodyOf(game, { name: "Vik", place: "meridian" }));
    assert.equal(vik.status, "Can barely walk");
    assert.equal(vik.parts.right_leg, "bad");
    assert.ok(vik.marks.some((mark) => mark.words === "A broken right leg"));
    const hana = bodyView(bodyOf(game, { name: "Hana", place: "meridian" }));
    assert.equal(hana.parts.chest, "bad");
    assert.equal(hana.parts.left_arm, "hurt");
  }
});

test("synthetics carry only their own marks, and say they don't bleed", () => {
  for (const bodySeed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const hollis = bodyOf({ ...newGame(), bodySeed }, { id: "hollis" });
    for (const mark of hollis.marks) assert.match(mark.kind ?? "", /casing|joint|faceplate|coolant/, mark.words);
    const view = bodyView(hollis);
    assert.equal(view.blood, null);
    assert.ok(view.notes.includes("They don't bleed."));
  }
  assert.ok(bodyView(bodyOf(newGame(), { id: "marrow" })).notes.some((note) => /break half as often/.test(note)), "Korrun bones");
});

test("the player's body comes from their life story, their traits and the wounds they have now", () => {
  const game = newGame();
  game.character = { ...game.character, species: "human", age: 34, careers: [{ name: "Smuggler" }], biography: ["Ages 18-22, Smuggler: Lost their ship in an ambush.", "Ages 22-26, Raider: Lost a knife vote for command of a raider ship."] };
  game.traits = ["one_eyed", "old_wound"];
  game.conditions = [{ id: "broken_arm", hoursLeft: 100 }, { id: "blood_loss", hoursLeft: 10 }];
  const body = bodyView(bodyOf(game, "you"));
  for (const part of ["chest", "right_arm", "left_arm"]) assert.ok(body.marks.some((mark) => mark.part === part && /old burn/i.test(mark.words)), `burns on the ${part}`);
  assert.ok(body.marks.some((mark) => mark.part === "head" && /one eye gone/i.test(mark.words)), "one-eyed");
  assert.ok(body.marks.some((mark) => /knee/.test(mark.words)), "the knife vote's bad knee");
  assert.equal(body.status, "Walks with a limp");
  const arm = body.marks.find((mark) => /broken (left|right) arm/i.test(mark.words));
  assert.ok(arm && arm.state === "bad" && arm.hoursLeft === 100, "the broken arm is on an arm, with its hours");
  assert.equal(body.blood, 55);
  // The same conditions sit on the same parts all game.
  assert.equal(bodyView(bodyOf(structuredClone(game), "you")).marks.find((mark) => /broken/.test(mark.words)).part, arm.part);
  // An outcome that gave the trait old_wound covers it with its own marks.
  const covered = pastLines({ biography: ["Ages 18-22, Envoy: Survived a bombing at a state dinner, and took the blame."] }, ["old_wound"]);
  assert.equal(covered.length, 1);
  assert.match(covered[0].words, /shrapnel/);
});

test("every mark in the life stories reads, and the traits' and conditions' marks name a kind", () => {
  const found = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.marks) found.push(value);
    Object.values(value).forEach(visit);
  };
  visit([CAREERS, GENERAL_EVENTS, GENERAL_MISHAPS, FALL_CHOICES]);
  assert.ok(found.length >= 16);
  const bios = new Map();
  for (const outcome of found) {
    for (const text of outcome.marks) assert.ok(!health.readBodyLine(text).problem, text);
    bios.set(outcome.bio, (bios.get(outcome.bio) ?? 0) + 1);
  }
  for (const [bio, n] of bios) assert.equal(n, 1, `only one outcome is worded "${bio}"`);
  const game = newGame();
  game.character = { ...game.character, biography: [] };
  game.traits = ["one_eyed", "old_wound", "cyber_arm", "cyber_eye"];
  game.conditions = ["concussed", "cracked_ribs", "broken_arm", "deep_burn", "infected"].map((id) => ({ id, hoursLeft: 10 }));
  const body = bodyOf(game, "you");
  for (const kind of ["an_eye_gone", "old_wound", "cybernetic_arm", "cybernetic_eye", "concussion", "cracked_ribs", "broken_bone", "deep_burn", "infected"]) {
    assert.ok(body.marks.some((mark) => mark.kind === kind), kind);
  }
  assert.equal(bodyView(body).marks.find((mark) => mark.state === "artificial")?.state, "artificial");
});

test("Look, the printouts and the player's own state show the body, and reading them writes nothing", () => {
  const game = newGame();
  game.location = "meridian";
  game.walk = null;
  const map = mapFor("meridian");
  walkCommand(game, { action: "room", to: "medbay" });
  const before = JSON.stringify(game);
  const view = walkView(game);
  const vik = view.people.find((one) => one.key === "Vik");
  assert.ok(vik, "Vik is in the medbay");
  assert.match(vik.marks, /Can barely walk\. A broken right leg\./);
  const sheet = personSheet(game, "Vik");
  assert.equal(sheet.body.status, "Can barely walk");
  // The crowd's printout and their body agree on who they are.
  const who = crowdWho("Vik");
  assert.equal(sheet.species, WORLD_SPECIES[who.species].name);
  assert.equal(sheet.age, who.age);
  assert.equal(sheet.body.species, sheet.species);
  assert.ok(personSheet(game, "marrow").body.marks.some((mark) => /two fingers/i.test(mark.words)));
  const state = publicState(game);
  assert.ok(state.body && Object.keys(state.body.parts).length === 6, "the player's own body goes to the page");
  assert.equal(JSON.stringify(game), before, "looking, printing and showing changed nothing in the save");
  assert.ok(map.rooms.medbay);
  // A crowd name's job is the words before the name, and an Old one is old.
  assert.equal(personSheet(game, "Vik").post, null);
  assert.ok(crowdWho("Old Marta").age >= 60);
  assert.equal(lookLine({ species: "human", marks: [], blood: 100 }), null);
});

test("a new game has its seed, and an older save gets one and keeps it", () => {
  const game = newGame();
  assert.equal(game.version, 28);
  assert.ok(Number.isInteger(game.bodySeed));
  const { bodySeed: _seed, ...old } = structuredClone(game);
  const migrated = migrateGame({ ...old, version: 19 });
  assert.equal(migrated.version, 28);
  assert.ok(Number.isInteger(migrated.bodySeed));
  assert.equal(migrateGame(structuredClone(migrated)).bodySeed, migrated.bodySeed, "a seed once given stays");
});
