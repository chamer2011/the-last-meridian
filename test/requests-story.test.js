// Requests, step 7 of the organic quests: the written story knows. A scene can ask how a request stands (? request
// medicine done), have someone ask one now (* request medicine: reason), and turn a kind off so a scene of its own takes
// that trouble over (* request medicine off: reason), and on again. The checker knows the kinds a scene names. None of
// this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-requests-story-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const rq = await import("../src/requests.js");
const lg = await import("../src/logistics.js");
const { storyRequest } = await import("../src/request-hook.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");

const SHIP = "meridian";
const KINDS = ["medicine", "fuel", "parts", "pantry", "broken", "medkit", "rival", "post_back", "brig", "grumbling", "carry", "extra_shift", "repair_order", "hand_on_job", "word_for_boss", "port_food", "port_medicine", "port_trouble", "haven_food"];
const newGame = (start = "captain", seed = 21) => {
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
const holds = (game, state) => conditionHolds(game, `request medicine ${state}`);

test("? request and * request are read, and a mistake in them is said in plain words", () => {
  for (const text of ["request medicine done", "request port_food asked", "not request medicine off"]) assert.deepEqual(parseCondition(text).problems, [], text);
  assert.match(parseCondition("request medicine maybe").problems.join(" "), /"request" is followed by a request's name, like medicine, and one of asked, taken, done/);
  assert.deepEqual(parseEffect("request medicine: Aduro asks now"), { do: { request: "medicine", turn: null, reason: "Aduro asks now" } });
  assert.deepEqual(parseEffect("request medicine off: The story takes it over"), { do: { request: "medicine", turn: "off", reason: "The story takes it over" } });
  assert.match(parseEffect("request medicine sideways: no").problem, /request is written \* request medicine: The reason/);
  // The checker knows which kinds there are.
  const scenes = {
    request_medicine: parseSceneText("# M\nasks: a cook\nneeds: your word\nby: 1 day\n\n== ask\n@{asker}: \"?\"\n> Yes -> yes\n\n== yes\n@{asker}: \"Y.\"\n\n== done\n@{asker}: \"D.\"\n\n== failed\n@{asker}: \"F.\"\n\n== gone\n@{asker}: \"G.\"\n", "request_medicine").scene,
    thread_test: parseSceneText("# T\n\n== start\n@Voss: \"Well?\"\n> Ask -> two ? request medicine done\n\n== two\n@Voss: \"So.\"\n* request moonbeams: A test\n* request medicine off: A test\n", "thread_test").scene,
  };
  assert.deepEqual(rq.storyRequestProblems(scenes), ["thread_test: there's no request called moonbeams: the requests are medicine"]);
});

test("how a request stands, from nothing to asked, taken on and done, and how it ended stays", () => {
  const game = newGame();
  only(game, "medicine");
  assert.equal(holds(game, "none"), true);
  lg.takeAboard(game, SHIP, "medicine_crate", 4);
  at(game, 10.5);
  assert.equal(holds(game, "asked"), true);
  assert.equal(holds(game, "none"), false);
  rq.answerRequest(game, "medicine", "yes");
  assert.equal(holds(game, "taken"), true);
  lg.putAboard(game, SHIP, "medicine_crate", 4);
  game.requests.open.medicine.base = -2;
  rq.advanceRequests(game);
  assert.equal(holds(game, "done"), true);
  assert.equal(holds(game, "taken"), false);
  assert.equal(game.requests.ended.medicine.how, "done");

  const refused = newGame();
  only(refused, "medicine");
  lg.takeAboard(refused, SHIP, "medicine_crate", 4);
  at(refused, 10.5);
  rq.answerRequest(refused, "medicine", "no");
  assert.equal(conditionHolds(refused, "request medicine refused"), true);
  assert.equal(conditionHolds(refused, "request medicine done"), false);
});

test("* request has someone ask now, whatever the pacer or its own when: line say, as long as someone's there to ask", () => {
  const game = newGame();
  only(game, "medicine", "fuel");
  game.requests.rest.medicine = 1e9;
  // The cabinet's full, so medicine wouldn't come up by itself; and it's resting.
  game.clock.hours = 10.5;
  const notes = storyRequest(game, { request: "medicine", turn: null, reason: "Aduro's been waiting to say it" });
  assert.deepEqual(notes, ["[REQUEST] Dr. Aduro has something for you to decide, in Medbay."]);
  assert.equal(game.requests.open.medicine.story, true);
  rq.advanceRequests(game);
  assert.equal(game.requests.open.medicine?.state, "offered", "it stays asked though its when: line doesn't hold");
  assert.deepEqual(storyRequest(game, { request: "medicine", reason: "Again" }), [], "asking it twice does nothing");
  assert.deepEqual(storyRequest(game, { request: "moonbeams", reason: "A test" }), ["[REQUEST] There's no request called moonbeams: A test"]);
  // A trouble that isn't there can't be asked about.
  only(game, "rival");
  assert.deepEqual(storyRequest(game, { request: "rival", reason: "A test" }), ["[REQUEST] Nobody can ask about bad blood just now."]);
});

test("* request off keeps a kind from being asked, so a scene can take it over, and on brings it back", () => {
  const game = newGame();
  only(game, "medicine");
  lg.takeAboard(game, SHIP, "medicine_crate", 4);
  storyRequest(game, { request: "medicine", turn: "off", reason: "The story deals with the cabinet" });
  assert.equal(holds(game, "off"), true);
  at(game, 10.5);
  assert.deepEqual(game.requests.open, {}, "not asked while it's off");
  storyRequest(game, { request: "medicine", turn: "on", reason: "Back to normal" });
  assert.equal(holds(game, "off"), false);
  at(game, 11.5);
  assert.equal(game.requests.open.medicine?.state, "offered");
  // Turned off while someone has it to ask, it goes.
  storyRequest(game, { request: "medicine", turn: "off", reason: "Not now" });
  assert.equal(game.requests.open.medicine, undefined);
});
