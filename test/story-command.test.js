// The ship's chain of command, step 6: the story and the AI know. A written scene can ask who holds a post, what
// someone's job is, how loyal they are and how far a mutiny's got, and change it: appoint, relieve, assign, loyalty and
// remember. A post changing hands goes on the record, the AI's state has one line on the chain of command, and the
// Story board edits the command file. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-story-command-"));
const commandDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-story-command-files-"));
fs.copyFileSync(new URL("../world/command/meridian.txt", import.meta.url), path.join(commandDir, "meridian.txt"));
process.env.GAME_COMMAND_DIR = commandDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const cmd = await import("../src/command.js");
const { aiSnapshot } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { factsLeft, loadScenes, sceneProblems } = await import("../src/scenes.js");
const { openWrittenTalk, writtenTalkTurn } = await import("../src/talks.js");
const { roleBrief } = await import("../src/role.js");
const { runTool, newTurnLimits } = await import("../src/tools.js");
const { boardWorldItem, saveBoardWorldItem } = await import("../src/board.js");
const { WORLD_CHARACTERS } = await import("../src/world.js");

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const holds = (game, text) => conditionHolds(game, text);
// Plays the * lines of a little scene's only part, as the written story does.
function play(game, lines) {
  const { scene, problems } = parseSceneText(["# A test", "", "== start", ...lines, "END"].join("\n"), "test.txt");
  assert.deepEqual(problems, []);
  const said = [];
  for (const step of scene.parts.start.do ?? []) said.push(...cmd.storyCommand(game, step));
  return said;
}

test("a scene can ask who holds a post, what someone's job is, how loyal they are, and how far a mutiny's got", () => {
  const game = newGame();
  assert.equal(holds(game, "holds quartermaster odessa"), true);
  assert.equal(holds(game, "holds quartermaster Odessa Brandt"), true, "by name as well as by id");
  assert.equal(holds(game, "holds captain you"), true);
  assert.equal(holds(game, "holds first_officer tarrow"), false);
  assert.equal(holds(game, "job Cook Imre cook"), true);
  assert.equal(holds(game, "job Yusuf spare"), true);
  assert.equal(holds(game, "loyalty voss > 80"), true);
  assert.equal(holds(game, "loyalty tarrow < 40"), false);
  assert.equal(holds(game, "mutiny calm"), true);
  assert.equal(holds(game, "mutiny brewing"), false);
  assert.match(parseCondition("holds bosun odessa").problems.join(" | "), /"holds" is followed by a post, by its id/);
  assert.match(parseCondition("holds quartermaster Mister Nobody").problems.join(" | "), /there's nobody called Mister Nobody aboard/);
  assert.match(parseCondition("job Yusuf juggler").problems.join(" | "), /"job" is followed by someone, then a job by its id/);
  assert.match(parseCondition("loyalty voss lots").problems.join(" | "), /"loyalty" needs someone, one of/);
});

test("a scene can appoint and relieve, and it goes on the record for later stories", () => {
  const game = newGame();
  const said = play(game, ["* appoint quartermaster tobin: Voss wanted someone who'd count the crates"]);
  assert.equal(cmd.holderKey(game, "meridian", "quartermaster"), "tobin");
  assert.match(said.join(" "), /relieved Quartermaster Brandt, and given the post to Chief Hask/);
  assert.equal(holds(game, "holds quartermaster tobin"), true);
  assert.equal(holds(game, "flag odessa_relieved"), true, "a later story can react to her being relieved");
  assert.equal(holds(game, "flag quartermaster_changed_hands"), true);
  const facts = game.story.record.facts.map((one) => one.id);
  assert.ok(facts.includes("odessa_relieved") && facts.includes("quartermaster_changed_hands") && facts.includes("deck_chief_changed_hands"), facts.join(", "));
  play(game, ["* relieve chief_engineer: The repairs kept waiting"]);
  assert.notEqual(cmd.holderKey(game, "meridian", "chief_engineer"), "marrow");
  assert.equal(holds(game, "flag marrow_relieved"), true);
  assert.equal(cmd.jobOf(game, "meridian", "marrow"), "tech", "Marrow takes the job the new chief left");
});

test("a scene can move someone on the watch bill, change their loyalty, and leave them remembering", () => {
  const game = newGame();
  play(game, ["* assign Yusuf cook: The galley was short"]);
  assert.equal(cmd.jobOf(game, "meridian", "Yusuf"), "cook");
  const before = cmd.loyaltyOf(game, "meridian", "marrow");
  play(game, ["* loyalty marrow -10: You overruled him in front of his techs"]);
  assert.equal(cmd.loyaltyOf(game, "meridian", "marrow"), before - 10);
  const card = cmd.commandView(game).groups.flatMap((group) => group.posts).find((one) => one.id === "chief_engineer");
  assert.match(card.memories.join(" | "), /You overruled him in front of his techs/);
  play(game, ["* remember tarrow voss -15: Voss had her written up for the armoury count"]);
  assert.equal(cmd.regardFor(game, "meridian", "tarrow", "voss"), -15);
  assert.match(parseEffect("appoint captain tobin: no").problem, /the captain's chair changes hands through the story's change of command/);
  assert.match(parseEffect("appoint quartermaster you: no").problem, /the player can't be given a post yet/);
  assert.match(parseEffect("assign Yusuf juggler: no").problem, /assign is written \* assign someone a_job: reason/);
  assert.match(parseEffect("remember marrow -10: no").problem, /remember needs who remembers it and who it's of/);
});

test("the checker knows the facts the chain of command leaves, and a scene's stand-ins include every post", () => {
  const known = factsLeft(loadScenes().scenes);
  for (const name of ["odessa_relieved", "quartermaster_changed_hands", "tarrow_arrested", "ship_taken_by_mutiny", "mutiny_put_down", "cook_imre_relieved"]) assert.ok(known.has(name), name);
  const scene = parseSceneText(["# T", "", "== start", "@{quartermaster}: \"The count's right.\" {first_officer} nods.", "END"].join("\n"), "t.txt").scene;
  assert.deepEqual(sceneProblems(scene, "t"), []);
  const game = newGame();
  assert.equal(cmd.standIns(game).quartermaster.name, WORLD_CHARACTERS.odessa.name);
  play(game, ["* appoint quartermaster tobin: test"]);
  assert.equal(cmd.standIns(game).quartermaster.id, "tobin");
});

test("Hask's answer about the stores follows whoever holds the quartermaster's post", () => {
  const ask = (game) => {
    game.talk = { id: 1, key: "tobin", personId: "tobin", name: WORLD_CHARACTERS.tobin.name, short: "Hask", where: "Engineering", doing: null, log: [], lastReply: null, said: 0, told: [], unheard: [] };
    openWrittenTalk(game);
    const said = [];
    writtenTalkTurn({ game, playerText: "Ask who keeps the stores these days", emit: (e) => { if (e.text) said.push(e.text); } });
    game.talk = null;
    return said.join("\n");
  };
  assert.match(ask(newGame()), /Brandt keeps them/);
  const changed = newGame();
  cmd.commandCommand(changed, { action: "replace", post: "quartermaster", key: "Gardener Benno" });
  const answer = ask(changed);
  assert.match(answer, /Gardener Benno keeps them now, Captain/);
  assert.doesNotMatch(answer, /\{quartermaster\}/);
});

test("the AI's state has one line on the chain of command, and its reads say where someone stands now", () => {
  const game = newGame();
  assert.match(aiSnapshot(game), /^Chain of command aboard the CFS Meridian: everyone holds the post they began the game in; the officers' loyalty to the captain is about \d+\/100 and the council's confidence about \d+\/100\.$/m);
  cmd.commandCommand(game, { action: "replace", post: "quartermaster", key: "Gardener Benno" });
  assert.match(cmd.commandLine(game), /Gardener Benno is quartermaster in place of Odessa Brandt/);
  const read = runTool(game, "read_character", { name: "Odessa Brandt" }, newTurnLimits());
  assert.match(read.result, /Their place aboard now: relieved as the quartermaster, and a gardener now\./);
  // A captain the officers relieved is crew, and the AI's dossier says so.
  const deposed = newGame();
  deposed.command.meridian.mutiny = { pressure: 9, stage: 3, ringleader: "tarrow", due: null, calmUntil: 0 };
  cmd.mutinyOutcome(deposed, "taken", "test");
  assert.match(roleBrief(deposed, null), /they were the captain of the Meridian until the officers relieved them of command/);
  assert.match(cmd.commandLine(deposed), /Kara Tarrow is captain, since the officers relieved the player of command on day \d+/);
});

test("the Story board reads the chain of command, saves through the game's own reader, and refuses a file it can't read", () => {
  const item = boardWorldItem("command", "meridian");
  assert.equal(item.kind, "command");
  assert.equal(item.value.posts.length, 11);
  assert.ok(item.lists.crew.some((one) => one.key === "Cook Imre"));
  assert.ok(item.lists.rooms.includes("The Brig"));
  assert.ok(item.lists.measures.includes("sittings missed"));
  const text = fs.readFileSync(path.join(commandDir, "meridian.txt"), "utf8");
  const changed = text.replace("reviews every: 7 days", "reviews every: 14 days");
  const saved = saveBoardWorldItem("command", "meridian", changed);
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.problems, []);
  assert.equal(cmd.commandOf("meridian").reviews.every, 14, "the game reads the new file at once");
  const refused = saveBoardWorldItem("command", "meridian", "Posts:\n- not a line");
  assert.equal(refused.saved, false);
  assert.ok(refused.problems.length > 0);
  saveBoardWorldItem("command", "meridian", text);
  assert.equal(cmd.commandOf("meridian").reviews.every, 7);
});
