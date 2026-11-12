// What the scenes' format gained when act 1 of the old main story was written out: moving the act, filling the tank,
// and a part that waits for the Meridian to arrive. The stories themselves (Two Weeks of Fuel, Visiting Hours, the
// council) were taken out of the game on 2026-11-12, and their tests went with them. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-act1-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { attr, maxHp, skillRank } = await import("../src/rules.js");
const { conditionHolds, parseEffect } = await import("../src/scene-text.js");
const { writtenTurn } = await import("../src/scenes.js");
const { personWhere, walkCommand } = await import("../src/walk.js");

const HELPERS = { attr, skillRank, maxHp };

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  return game;
};

// Plays one turn the way the server does: what the story says goes in the transcript after the turn, in order.
function play(game, args, scenes) {
  const pieces = [];
  const emit = (e) => {
    if (e.type === "state") return;
    const last = pieces.at(-1);
    if (e.type === "text" && last?.role === "narrator") last.text += e.text;
    else pieces.push({ role: e.type === "text" ? "narrator" : "notice", text: e.text });
  };
  writtenTurn({ game, emit, log: (role, text) => game.transcript.push({ role, text }), scenes, ...args });
  goOver(game, (more) => writtenTurn({ game, emit, log: () => {}, scenes, ...more }));
  for (const piece of pieces) game.transcript.push(piece);
  return pieces.filter((piece) => piece.role === "narrator").map((piece) => piece.text).join("\n");
}
// A part of the story waits until the player is with whoever it needs, so the tests play it the way a player would:
// they walk to that person's room by the map of the place, and talk to them.
function goOver(game, turn) {
  for (let i = 0; i < 6 && game.scene?.told === false && game.scene.with; i += 1) {
    const where = personWhere(game, game.scene.with);
    if (where?.level) walkCommand(game, { action: "room", to: where.level });
    turn({ event: "meet", person: game.scene.with });
  }
}

test("the written story can move the act and fill the tank, and a part can wait for the Meridian to arrive", () => {
  assert.deepEqual(parseEffect("act 2").do, { tool: "update_story", act: 2 });
  assert.match(parseEffect("act two").problem, /act needs/);
  assert.deepEqual(parseEffect("fuel 6: Quill's depot").do, { tool: "change_ship", hull: 0, fuel: 6, morale: 0, reason: "Quill's depot" });
  assert.match(parseEffect("fuel: nothing").problem, /fuel needs/);
  const game = newGame();
  assert.equal(conditionHolds(game, "act < 2", HELPERS), true);
  assert.equal(conditionHolds(game, "act >= 2", HELPERS), false);
  game.story.act = 2;
  assert.equal(conditionHolds(game, "act >= 2 and not act > 2", HELPERS), true);

  // A part that waits: its rules are read again when the player continues, and its effects run once.
  const scenes = { thread_wait: { title: "Wait", start: "here", parts: {
    here: { text: ["Set course for Kessara, and press Continue when you're there."], when: [{ if: "at kessara", to: "there" }], choices: [{ say: "Stay a while", to: "here" }] },
    there: { text: ["You're there."], do: [{ tool: "award_xp", amount: 5, reason: "Arrived" }], end: true },
  } } };
  const waiting = newGame("captain", 22);
  const xp = waiting.xp;
  play(waiting, { playerText: "I look into this", threadId: "wait" }, scenes);
  assert.equal(waiting.scene.part, "here");
  const still = play(waiting, { event: "continue" }, scenes);
  assert.equal(waiting.scene.part, "here", "nothing has changed, so the story stays");
  assert.doesNotMatch(still, /You're there/);
  waiting.location = "kessara";
  waiting.arrived = "kessara";
  const arrived = play(waiting, { event: "continue" }, scenes);
  assert.match(arrived, /You're there/);
  assert.equal(waiting.scene, null);
  assert.equal(waiting.xp, xp + 5);
});
