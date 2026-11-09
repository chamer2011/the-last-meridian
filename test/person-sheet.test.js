// Anyone's registry printout, from the right-click menu: a named person prints their file without their secrets, the
// crowd gets the same made-up record every time with fight numbers and Awareness that agree with the rules, and
// printing writes nothing to the save.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-sheet-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { personSheet } = await import("../src/person-sheet.js");
const { findCharacter } = await import("../src/campaign.js");
const { DEEDS } = await import("../src/world.js");
const { ENEMIES } = await import("../src/data.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
function standIn(game, place, room) {
  game.location = place;
  game.walk = null;
  const map = mapFor(place);
  walkCommand(game, { action: "room", to: map.start });
  const { level, start } = map.rooms[room];
  Object.assign(game.walk, { level: level.id, x: start.x, y: start.y });
}

test("someone with a file prints what it says, but never their goals or secrets", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const voss = walkView(game).people.find((one) => /Voss/.test(one.name));
  assert.ok(voss, "Voss is on the bridge");
  const before = JSON.stringify(game);
  const sheet = personSheet(game, voss.key);
  assert.equal(JSON.stringify(game), before, "printing changes nothing in the save");
  const file = findCharacter(game.campaign, "voss");
  assert.equal(sheet.thin, false);
  assert.match(sheet.name, /Voss/);
  assert.equal(sheet.attributes.length, 8);
  assert.equal(sheet.attributes.find((a) => a.id === "perception").value, file.attributes.perception);
  assert.equal(sheet.skills.find((s) => s.id === "awareness")?.rank, file.skills.awareness);
  assert.equal(sheet.pocket, voss.pocket, "the same pocket as the menu says");
  assert.equal(sheet.fight.hp, file.combat.hp);
  const text = JSON.stringify(sheet);
  if (file.secrets) assert.ok(!text.includes(file.secrets), "no secrets");
  if (file.goals) assert.ok(!text.includes(file.goals), "no goals");
});

test("the crowd gets the same record every time, with real fight numbers and an Awareness that matches their pocket", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  // Anyone known by name can be printed too, from their file, even when they aren't here.
  assert.equal(personSheet(game, "aduro").thin, false);
  assert.throws(() => personSheet(game, "Nobody At All"), /no record/);
  // Someone from the crowd, wherever there's one on the ship.
  let crowd = null;
  for (const room of Object.keys(mapFor("meridian").rooms)) {
    standIn(game, "meridian", room);
    crowd = walkView(game).people.find((one) => !findCharacter(game.campaign, one.key));
    if (crowd) break;
  }
  assert.ok(crowd, "someone without a file is aboard");
  const once = personSheet(game, crowd.key);
  const twice = personSheet(game, crowd.key);
  assert.deepEqual(once, twice, "the same every time");
  assert.equal(once.thin, true);
  assert.equal(once.name, crowd.name);
  const watchful = (DEEDS.watchful ?? []).some((word) => new RegExp(`\\b${word}\\b`, "i").test(crowd.name));
  const enemy = ENEMIES[DEEDS.attack.as[watchful ? "watchful" : "anyone"]];
  assert.equal(once.fight.hp, enemy.hp, "they'd fight as their stand-in");
  const awareness = once.skills.find((s) => s.id === "awareness")?.rank ?? 0;
  assert.ok(watchful ? awareness >= 2 && awareness <= 3 : awareness <= 1, `Awareness ${awareness} agrees with an ${watchful ? "moderate" : "easy"} pocket`);
});
