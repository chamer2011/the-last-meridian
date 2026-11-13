// A page of the ship's log (a part's PAGE: and DRAWING: lines, src/drawings.js, src/scenes.js, src/talks.js): the
// lines read and what's wrong with them, the drawings and what's wrong with them, the battle's end carrying its page,
// and the prisoners' question as a page in the talk, done once it's answered, with what the answer did.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-logpage-"));
process.env.GAME_DATA_DIR = dataDir;
// The game's drawings, and one too big for a page, in a folder of their own.
const drawings = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-drawings-"));
for (const name of fs.readdirSync(path.join(import.meta.dirname, "..", "world", "drawings"))) fs.copyFileSync(path.join(import.meta.dirname, "..", "world", "drawings", name), path.join(drawings, name));
fs.writeFileSync(path.join(drawings, "too_big.txt"), `${"x".repeat(40)}\n${Array.from({ length: 9 }, () => "#").join("\n")}\n`);
process.env.GAME_DRAWINGS_DIR = drawings;

const { drawingNames, drawingOf, drawingProblems } = await import("../src/drawings.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { liveTick } = await import("../src/live-fight.js");
const { publicState } = await import("../src/rules.js");
const { parseSceneText } = await import("../src/scene-text.js");
const { pageOf, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const talks = await import("../src/talks.js");
const walk = await import("../src/walk.js");

const SHIP = "meridian";
const newGame = (seed = 61) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));

test("a part can be a page, with a title, a line under it and a drawing, and what's wrong with those lines is said", () => {
  const { scene, problems } = parseSceneText(`== moment
PAGE: The prisoners | The Brig, deck 2
DRAWING: brig
The cells are full.
> [morale +2] Put them to work -> end

== end
Done.
END

== plain
PAGE: Only a title
Words.
END
`, "test");
  assert.deepEqual(problems, []);
  assert.deepEqual([scene.parts.moment.page, scene.parts.moment.drawing], [{ title: "The prisoners", under: "The Brig, deck 2" }, "brig"]);
  assert.deepEqual(scene.parts.plain.page, { title: "Only a title" });
  const wrong = parseSceneText("== one\nPAGE:\nDRAWING: Two Words\nWords.\nEND\n", "wrong");
  assert.deepEqual(wrong.problems.map((one) => one.line), [2, 3]);
  assert.match(wrong.problems[0].message, /PAGE: needs a title/);
  assert.match(wrong.problems[1].message, /DRAWING: needs the name of a drawing in world\/drawings/);
  // The checker: a drawing there's no file for, and a drawing on a part that isn't a page.
  const unknown = sceneProblems(parseSceneText("== one\nPAGE: A page\nDRAWING: moon\nWords.\nEND\n", "x").scene, "x");
  assert.ok(unknown.some((one) => /DRAWING: moon isn't in world\/drawings; the drawings there are brig, meridian, too_big/.test(one)), unknown.join("\n"));
  const loose = sceneProblems(parseSceneText("== one\nDRAWING: brig\nWords.\nEND\n", "x").scene, "x");
  assert.ok(loose.some((one) => /DRAWING: is for a part shown as a page, with a PAGE: line/.test(one)), loose.join("\n"));
});

test("the drawings: by name, cut to what fits a page, and too big said so", () => {
  assert.deepEqual(drawingNames(), ["brig", "meridian", "too_big"]);
  assert.deepEqual(drawingOf("brig"), ["┌────────┬────────┐", "│ ║ ║ ║ ║│ ║ ║ ║ ║│", "│ ║ ║ ║ ║│ ║ ║ ║ ║│", "└───┤├───┴───┤├───┘"]);
  assert.equal(drawingOf("moon"), null);
  assert.equal(drawingOf("../server"), null);
  const big = drawingOf("too_big");
  assert.equal(big.length, 8);
  assert.equal(big[0].length, 32);
  assert.deepEqual(drawingProblems().sort(), ["world/drawings/too_big.txt is 10 lines; a page has room for 8", "world/drawings/too_big.txt is 40 characters wide; a page has room for 32"]);
  // A page names when it was written, for its bar.
  const game = newGame(61);
  game.clock.hours = 24 + 11 + 0.5;
  assert.deepEqual(pageOf(game, { page: { title: "A page", under: "Under it" }, drawing: "brig" }), { title: "A page", under: "Under it", drawing: drawingOf("brig"), at: "day 2, 11:30" });
  assert.equal(pageOf(game, { text: "No page" }), null);
});

// The opening played over the rules, the battle ended at once, keeping what the story says as the server does: a page
// is a piece of its own.
function opening(game) {
  const said = [];
  const emit = (e) => {
    if (e.type !== "text") return;
    const last = said.at(-1);
    if (last && last.scene === (e.scene ?? null) && !last.page && !e.page) last.text += e.text;
    else {
      const piece = { role: "narrator", text: e.text, scene: e.scene ?? null, ...(e.page ? { page: e.page } : {}) };
      said.push(piece);
      game.transcript.push(piece);
    }
  };
  const turn = (args) => writtenTurn({ game, emit, log: (role, words) => game.transcript.push({ role, text: words }), ...args });
  turn({ event: "start" });
  turn({ playerText: "Hold the bridge" });
  const c = game.combat;
  for (const enemy of c.enemies) enemy.hp = 0;
  for (let i = 0; i < 80 && game.combat; i += 1) {
    if (c.enemies.length === 12 && c.enemies.filter((one) => one.hp > 0).length > 4) for (const enemy of c.enemies.filter((one) => one.hp > 0).slice(0, 2)) enemy.hp = 0;
    liveTick(game, { ms: 500 });
  }
  turn({ event: "continue" });
  return said;
}

test("the battle's end is a page of the ship's log, with the Meridian drawn on it", () => {
  const said = opening(newGame(62));
  const page = said.at(-1).page;
  assert.equal(page.title, "The Red Cloth");
  assert.equal(page.under, "Deck 1, after the battle");
  assert.deepEqual(page.drawing, drawingOf("meridian"));
  assert.match(page.at, /^day 1, \d\d:\d\d$/);
  assert.match(said.at(-1).text, /^The last sidearm clatters onto the deck plates/);
  // The alarm before it isn't one.
  assert.equal(said[0].page, undefined);
});

test("the prisoners' question is a page in the talk: its labelled answers, then what's said and done, and only closing it", () => {
  const game = newGame(63);
  opening(game);
  const life = game.life.places[SHIP].tarrow;
  walk.walkCommand(game, { action: "room", to: walk.mapFor(SHIP).levels[life.level].roomAt(Math.round(life.x), Math.round(life.y)) });
  walk.talkCommand(game, { action: "open", person: "tarrow" });
  talks.openWrittenTalk(game);
  const view = publicState(game).talk;
  assert.deepEqual([view.page.title, view.page.under, view.page.done], ["The prisoners", "The Brig, deck 2", undefined]);
  assert.deepEqual(view.page.drawing, drawingOf("brig"));
  assert.match(view.lastReply, /^The ones who gave up are in the cells/);
  assert.match(view.lastReply, /^> \[morale \+2\] \[council \+3\] Put them to work under guard$/m);
  const notices = [];
  talks.writtenTalkTurn({ game, playerText: "Put them to work", emit: (e) => { if (e.type === "text") walk.talkHeard(game, e.text); if (e.type === "notice") { notices.push(e.text); walk.talkHeard(game, e.text, "notice"); } } });
  const after = publicState(game).talk;
  assert.equal(after.page.done, true);
  assert.match(after.lastReply, /Under guard, and the first one who tries anything goes back in a cell/);
  assert.doesNotMatch(after.lastReply, /^>/m, "no more answers: only closing it");
  assert.ok(notices.includes("[COMMAND] The mutineers in the brig are put to work under guard by day."), notices.join("\n"));
  assert.equal(game.command[SHIP].prisoners.fate, "work");
});
