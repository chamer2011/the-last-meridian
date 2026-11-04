// The people, places and species as plain-text files: each reads into the shape the game uses and writes back the
// same, the game holds them all, problems are named by their line, and a saved file is read again at once.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-world-text-"));
process.env.GAME_DATA_DIR = dataDir;
// One test writes a file, so these work on copies.
const realWorld = fileURLToPath(new URL("../world/", import.meta.url));
for (const [folder, env] of [["characters", "GAME_PEOPLE_DIR"], ["places", "GAME_PLACES_DIR"], ["species", "GAME_SPECIES_DIR"]]) {
  const copy = path.join(dataDir, folder);
  fs.mkdirSync(copy);
  for (const name of fs.readdirSync(path.join(realWorld, folder))) fs.copyFileSync(path.join(realWorld, folder, name), path.join(copy, name));
  process.env[env] = copy;
}

const { PERSON, PLACE, SPECIES_SPEC, parsePersonText, parsePlaceText, parseSpeciesText, parseWorldText, writePersonText, writeWorldText } = await import("../public/world-text.js");
const { PEOPLE_DIR, PLACES_DIR, SPECIES_DIR, WORLD_CHARACTERS, WORLD_FILE_PROBLEMS, WORLD_PLACES, WORLD_SPECIES, reloadWorld } = await import("../src/world.js");
const { NOTABLES, SPECIES } = await import("../src/character-data.js");
const { LOCATIONS, refreshLocations } = await import("../src/data.js");

const canon = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.keys(inner).sort().map((k) => [k, inner[k]])) : inner));

test("every person, place and species reads without a problem, writes back the same, and the game holds them all", () => {
  assert.deepEqual(WORLD_FILE_PROBLEMS, []);
  for (const [dir, spec, count] of [[PEOPLE_DIR, PERSON, 61], [PLACES_DIR, PLACE, 24], [SPECIES_DIR, SPECIES_SPEC, 6]]) {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
    assert.equal(files.length, count, dir);
    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const first = parseWorldText(text, spec, name.slice(0, -4));
      assert.deepEqual(first.problems, [], name);
      assert.equal(writeWorldText(first.value, spec), text, `${name} is written the way the game writes it`);
      const again = parseWorldText(writeWorldText(first.value, spec), spec, name.slice(0, -4));
      assert.equal(canon(again.value), canon(first.value), name);
    }
  }
  assert.equal(Object.keys(WORLD_CHARACTERS).length, 61);
  assert.equal(Object.keys(WORLD_PLACES).length, 24);
  assert.deepEqual(Object.keys(WORLD_SPECIES), ["human", "korrun", "veshti", "ilari", "thessan", "synthetic"], "in the order the character creator shows them");
  assert.equal(NOTABLES, WORLD_CHARACTERS);
  assert.equal(SPECIES, WORLD_SPECIES);
  assert.equal(SPECIES.human.fx.factions.fleet, 5);
  assert.equal(SPECIES.synthetic.agelessTerms, 99);
  assert.equal(SPECIES.synthetic.fx.fatigueRate, 0.25);
  assert.equal(NOTABLES.aduro.combat.damage[1] > 0, true);
  assert.equal(NOTABLES.cantor.faction, null, "a person with no faction");
  assert.equal(NOTABLES.cantor.age, null);
  assert.deepEqual(NOTABLES.aduro.combat.tags, []);
  assert.equal(NOTABLES.aduro.listed, undefined);
  assert.equal(LOCATIONS.haven.name, "Haven Station");
  assert.ok(LOCATIONS.haven.market.includes("medkit"));
  assert.equal(LOCATIONS.haven.gm.districts.length, 5);
  assert.equal(LOCATIONS.meridian.fleet, true);
});

test("a person's file is plain words and a few lines of numbers", () => {
  const { value, problems } = parsePersonText(`# Sen Aduro
title: Dr.
also called: Dr. Aduro, Aduro
pronouns: they/them
species: ilari
age: unknown
faction: none
role: Chief medical officer
place: meridian
crew: yes
color: #7fe0c3
listed: no

In a line:
Exhausted, kind, and the conscience
of the ship.

Beliefs:
loyalty -5, violence -7

Attributes:
might 2, endurance 4

In a fight:
threat: 1
damage: 2 to 5
weapon: Surgical Laser
tags:
on hit: stress 3
machine: no

When the fight starts:
- The doctor sighs.
`, "aduro");
  assert.deepEqual(problems, []);
  assert.deepEqual(value, {
    name: "Sen Aduro", title: "Dr.", aliases: ["Dr. Aduro", "Aduro"], pronouns: "they/them", species: "ilari", age: null, faction: null, role: "Chief medical officer", location: "meridian", crew: true, color: "#7fe0c3", listed: false,
    note: "Exhausted, kind, and the conscience of the ship.",
    beliefs: { loyalty: -5, violence: -7 }, attributes: { might: 2, endurance: 4 },
    combat: { threat: 1, damage: [2, 5], weapon: "Surgical Laser", tags: [], onHit: { stress: 3 }, machine: false, lines: { intro: ["The doctor sighs."] } },
  });
  assert.equal(writePersonText(value).split("\n")[6], "faction: none");
});

test("a file's problems are named with their line, and the file is still read as far as it goes", () => {
  const { value, problems } = parsePlaceText(`Haven Station
also called: Haven
weather: wet
dangerous: maybe

In a line:
A trade hub.

The Vibe:
cool

Districts:
Just words without a colon
The Neutral Ground: Sable's bar.

Complications:
A line without its dash

Rumors:
- One.
`, "haven");
  const expect = (line, pattern) => assert.ok(problems.some((one) => one.line === line && pattern.test(one.message)), `line ${line} ${pattern}\n${problems.map((one) => `${one.line}: ${one.message}`).join("\n")}`);
  expect(1, /first line is the name/);
  expect(3, /before the first part, each line is one of also called, faction, market/);
  expect(4, /dangerous is yes or no/);
  expect(9, /I don't know a part of a place called "The Vibe"/);
  expect(13, /each one is written Its Name: what it's like/);
  expect(17, /each one starts with - and a space/);
  assert.equal(problems.length, 6, problems.map((one) => `${one.line}: ${one.message}`).join("\n"));
  assert.equal(value.name, "Haven Station");
  assert.deepEqual(value.gm.districts, [{ name: "The Neutral Ground", desc: "Sable's bar." }]);
  assert.deepEqual(value.rumors, ["One."]);
  const species = parseSpeciesText("# Thing\norder: 1\n\nEffects:\nmax hp: 5\nstanding with: fleet 5, ilun -10\n", "thing");
  assert.deepEqual(species.problems, []);
  assert.deepEqual(species.value, { name: "Thing", order: 1, fx: { maxHp: 5, factions: { fleet: 5, ilun: -10 } } });
});

test("a person, a place or a species saved while the game runs is read again into the same objects", () => {
  const file = path.join(PLACES_DIR, "haven.txt");
  const text = fs.readFileSync(file, "utf8");
  const people = WORLD_CHARACTERS, places = WORLD_PLACES;
  try {
    fs.writeFileSync(file, text.replace("# Haven Station", "# Haven Station, Rebuilt"));
    reloadWorld();
    refreshLocations();
    assert.equal(WORLD_PLACES, places, "the same object");
    assert.equal(WORLD_CHARACTERS, people);
    assert.equal(WORLD_PLACES.haven.name, "Haven Station, Rebuilt");
    assert.equal(LOCATIONS.haven.name, "Haven Station, Rebuilt", "and the places the game looks up follow");
  } finally {
    fs.writeFileSync(file, text);
    reloadWorld();
    refreshLocations();
  }
  assert.equal(LOCATIONS.haven.name, "Haven Station");
});
