// The written story: scenes played from their files. The game has no written opening or main story since 2026-11-12,
// so these tests play the small test scenes in test/fixtures (a drill on the bridge, a shared opening, an arrival at
// Haven and a story about a leak), in a copy of the world that has them beside the game's own.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

import { LEAK, useTestWorld } from "./fixtures/test-world.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-"));
process.env.GAME_DATA_DIR = dataDir;
// Before anything of the game is read: its scenes and stories, and the tests' own, in a temporary folder.
const testWorld = useTestWorld();

const { buildVocab, latestOptions, parseNarration, parseOptions } = await import("../public/story.js");
const { POLES, SKILLS } = await import("../src/character-data.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { OLD_STORY_NOTICE, migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { START_LIST } = await import("../src/role.js");
const { publicState } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { NO_OPENING, StoryError, allSceneProblems, choiceLine, loadScenes, matchChoice, openingSceneId, partText, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { attr, maxHp, skillRank } = await import("../src/rules.js");
const { personWhere, talkCommand, talkView, walkCommand: walkTo } = await import("../src/walk.js");
const { recordView } = await import("../src/record.js");

const WORLD_SCENES = loadScenes().scenes;
const HELPERS = { attr, skillRank, maxHp };

// The page's own vocabulary: every skill, and every belief.
const vocab = buildVocab(SKILLS);
for (const pole of Object.keys(POLES)) vocab.poles[pole] = pole;
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
  return pieces;
}
// A part of the story waits until the player is with whoever it needs, so the tests play it the way a player would:
// they walk to that person's room by the map of the place, and talk to them.
function goOver(game, turn) {
  for (let i = 0; i < 6 && game.scene?.told === false && game.scene.with; i += 1) {
    const where = personWhere(game, game.scene.with);
    if (where?.level) walkTo(game, { action: "room", to: where.level });
    turn({ event: "meet", person: game.scene.with });
  }
}
const lastNarration = (game) => [...game.transcript].reverse().find((entry) => entry.role === "narrator")?.text ?? "";

// ---- The scene files ------------------------------------------------------------

test("every written scene is sound: it reads, it starts somewhere, every part can be reached, and every choice goes somewhere real", () => {
  // The game's own scenes, and then the copy these tests play, which has the test scenes too.
  for (const dir of [testWorld.gameScenes, undefined]) {
    const { count, problems } = allSceneProblems(dir);
    assert.ok(count >= 2);
    assert.deepEqual(problems, []);
  }
  assert.ok(loadScenes().scenes.opening_captain.title, "the title is read");
});

// ---- The text format ------------------------------------------------------------------

const SAMPLE = `# A test
// a comment
start: first

== first
One line
that runs on.

@Someone: "Speech stands alone."
=> So does a consequence.
NOTE: [STORY] A message.
* journal: Written down.
* flag it_happened
> [+Voss] Go -> second
> [persuasion:hard:voss] [mercy] Talk -> won | lost ? credits >= 20 and not flag done
> Pay [! costs 20 credits] -> second ? has medkit

== second
? flag it_happened -> third
-> first

== third
CHECK engineering:easy
  reason: Open it
  pass -> won
  fail -> lost

== won
FIGHT scrap_rat: Something looks at your boots.
  allies: voss
  why: desperate
  won -> lost
  lost -> lost
  fled -> lost

== lost
Over.
END
`;

test("a scene written as text is read into the parts the game plays, with the line of everything", () => {
  const { scene, problems } = parseSceneText(SAMPLE, "sample");
  assert.deepEqual(problems, []);
  assert.equal(scene.title, "A test");
  assert.equal(scene.start, "first");
  const first = scene.parts.first;
  assert.deepEqual(first.text, ["One line that runs on.", '@Someone: "Speech stands alone."', "=> So does a consequence."]);
  assert.equal(first.note, "[STORY] A message.");
  assert.deepEqual(first.do.map(({ line, ...step }) => step), [{ tool: "add_journal", entry: "Written down." }, { set: "it_happened" }]);
  assert.equal(first.choices.length, 3);
  assert.deepEqual({ ...first.choices[0], line: undefined }, { say: "Go", tags: ["+Voss"], to: "second", line: undefined });
  assert.deepEqual({ ...first.choices[1], line: undefined }, { say: "Talk", tags: ["mercy"], check: "persuasion:hard:voss", pass: "won", fail: "lost", if: "credits >= 20 and not flag done", line: undefined });
  assert.equal(first.choices[2].say, "Pay [! costs 20 credits]", "a tag that isn't at the front stays in the words");
  assert.equal(first.choices[2].if, "has medkit");
  assert.equal(first.choices[0].line, 14);
  assert.deepEqual(scene.parts.second.when.map(({ line, ...rule }) => rule), [{ if: "flag it_happened", to: "third" }, { to: "first" }]);
  assert.deepEqual({ check: scene.parts.third.check, reason: scene.parts.third.reason, pass: scene.parts.third.pass, fail: scene.parts.third.fail }, { check: "engineering:easy", reason: "Open it", pass: "won", fail: "lost" });
  assert.deepEqual(scene.parts.won.fight, { enemy: "scrap_rat", lead_in: "Something looks at your boots.", allies: ["voss"], why: "desperate" });
  assert.deepEqual([scene.parts.won.won, scene.parts.won.lost, scene.parts.won.fled], ["lost", "lost", "lost"]);
  assert.equal(scene.parts.lost.end, true);
  assert.deepEqual(sceneProblems(scene, "sample"), []);
  // What it plays as is the same text the game master would write.
  assert.match(partText(first), /^One line that runs on\.\n\n@Someone: "Speech stands alone\."\n\n=> So does a consequence\.\n\n> \[\+Voss\] Go\n> \[persuasion:hard:voss\] \[mercy\] Talk\n> Pay/);
});

test("a mistake in a text file is reported with its line, in plain words", () => {
  const text = `words before any part
== first
> A choice with no arrow
> [persuasion:hard] One way only -> here
* xp ten: Not a number
* dance
? -> nowhere
CHECK persuasion:hard
  pass -> first
  sideways -> first
== bad name!
Text.
`;
  const { problems } = parseSceneText(text, "broken");
  const lines = Object.fromEntries(problems.map((one) => [one.line, one.message]));
  assert.match(lines[1], /before the first part/);
  assert.match(lines[3], /needs -> and the part/);
  assert.match(lines[4], /two parts after the arrow, pass \| fail/);
  assert.match(lines[5], /xp needs a number/);
  assert.match(lines[6], /isn't an effect the game knows/);
  assert.match(lines[7], /rule is written/);
  assert.match(lines[8], /only has pass and fail, not sideways/);
  assert.match(lines[11], /letters, numbers and underscores/);
});

test("effects are the same calls the AI makes, and say what's wrong when they're not", () => {
  assert.deepEqual(parseEffect(" credits -20: A round").do, { tool: "change_credits", amount: -20, reason: "A round" });
  assert.deepEqual(parseEffect(" item +medkit").do, { tool: "give_item", item: "medkit" });
  assert.deepEqual(parseEffect(" item -medkit").do, { tool: "take_item", item: "medkit" });
  assert.deepEqual(parseEffect(" quest the_beacon done: Found it").do, { tool: "update_quest", id: "the_beacon", status: "completed", objective: "Found it" });
  assert.deepEqual(parseEffect(" new quest find_him: Find Him | He's lost | Look at Haven").do, { tool: "add_quest", id: "find_him", title: "Find Him", description: "He's lost", objective: "Look at Haven" });
  assert.deepEqual(parseEffect(" contact Ilya Voss friendly: She likes you").do, { tool: "note_contact", name: "Ilya Voss", attitude: "friendly", note: "She likes you" });
  assert.deepEqual(parseEffect(" belief mercy 2: Spared him").do, { tool: "shift_ideology", toward: "mercy", amount: 2, reason: "Spared him" });
  assert.deepEqual(parseEffect(" time 8 hours rest: A night").do, { tool: "pass_time", hours: 8, activity: "rest", reason: "A night" });
  assert.deepEqual(parseEffect(' raw add_lore {"term": "The Rim", "kind": "place", "text": "Far out."}').do, { tool: "add_lore", term: "The Rim", kind: "place", text: "Far out." });
  assert.match(parseEffect(" item +pony").problem, /no item called pony/);
  assert.match(parseEffect(" belief kindness 1: x").problem, /belief needs one of/);
  assert.match(parseEffect(" contact Voss: no attitude").problem, /how they feel/);
});

test("conditions read the game, say what's wrong with them, and never hold when they're wrong", () => {
  const game = newGame();
  game.flags = { told: true };
  game.credits = 50;
  game.inventory.medkit = 1;
  game.scene = { id: "x", part: "a", seen: ["a", "b"] };
  game.quests.push({ id: "test_quest", title: "A Test", description: "For the conditions.", objective: "Be asked about.", status: "active" });
  const holds = (text) => conditionHolds(game, text, HELPERS);
  assert.equal(holds("has medkit"), true);
  assert.equal(holds("not has medkit"), false);
  assert.equal(holds("credits >= 50 and flag told"), true);
  assert.equal(holds("credits > 50"), false);
  assert.equal(holds("seen b and not seen c"), true);
  assert.equal(holds("captain"), true);
  assert.equal(holds("at meridian"), true);
  assert.equal(holds("quest test_quest active"), true);
  assert.equal(holds("quest test_quest done"), false);
  assert.equal(holds("quest nothing_here none"), true);
  assert.equal(holds("met Voss"), true, "the crew are the captain's contacts");
  assert.equal(holds(`skill persuasion >= ${skillRank(game, "persuasion")}`), true);
  assert.equal(holds(`stat presence > ${attr(game, "presence")}`), false);
  assert.equal(holds("day = 1"), true);
  assert.equal(holds("health >= 100"), true);
  assert.equal(holds("chance 100"), true);
  assert.equal(holds("chance 0"), false);
  assert.equal(holds("has pony"), false, "a condition with a mistake never holds");
  assert.deepEqual(parseCondition("has pony and skill flying >= 2 and credits more 3 and wibble").problems, [
    "there's no item called pony",
    "there's no skill called flying",
    '"credits" needs one of >= <= > < = != and a number: "credits more 3"',
    '"wibble" isn\'t a condition the game knows',
  ]);
});

test("a choice with a condition is only offered when it holds, a rule sends the story on, and a flag is remembered", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "tell the crew the truth" });
  assert.equal(game.flags.told_the_crew, true);
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  assert.match(lastNarration(game), /> Ask her what she'd do/, "not asked yet, so it's offered");
  play(game, { playerText: "ask her what she'd do" });
  assert.equal(game.scene.part, "voss_answer");
  play(game, { playerText: "go on" });
  assert.doesNotMatch(lastNarration(game), /> Ask her what she'd do/, "asked once, so it's gone");
  assert.throws(() => play(game, { playerText: "ask her what she'd do" }), /isn't one of the choices/);
  play(game, { playerText: "have pell plot" });
  assert.match(lastNarration(game), /The lower decks are asking if you meant it/, "the rule took the story to the part that knows");
  assert.equal(game.scene, null);
  assert.equal(game.flags.told_the_crew, true, "flags outlive the scene");
});

test("the files are read again when they change, so a writer sees a change without restarting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-live-"));
  const file = path.join(dir, "opening_captain.txt");
  fs.writeFileSync(file, "== a\nFirst words.\nEND\n");
  assert.equal(loadScenes(dir).scenes.opening_captain.parts.a.text[0], "First words.");
  fs.writeFileSync(file, "== a\nSecond words.\nEND\n");
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(file, later, later);
  assert.equal(loadScenes(dir).scenes.opening_captain.parts.a.text[0], "Second words.");
  // A file that can't be read is left out, and the story says so instead of breaking.
  fs.writeFileSync(file, "nothing here\n");
  fs.utimesSync(file, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  const broken = loadScenes(dir);
  assert.equal(broken.scenes.opening_captain, undefined);
  assert.match(broken.broken.opening_captain, /^line 1: .*before the first part/);
  assert.equal(broken.problems[0].file, "opening_captain.txt");
  // The captain's own opening being broken is said so, rather than quietly playing the plain one.
  fs.writeFileSync(path.join(dir, "opening.txt"), "== a\nPlain.\nEND\n");
  const game = newGame();
  assert.throws(() => writtenTurn({ game, event: "start", emit: () => {}, log: () => {}, scenes: loadScenes(dir).scenes, broken: loadScenes(dir).broken }), (err) => err instanceof StoryError && /opening_captain can't be read: line 1/.test(err.message));
  fs.writeFileSync(path.join(dir, "_notes.txt"), "Not a scene.");
  assert.deepEqual(Object.keys(loadScenes(dir).scenes), ["opening"], "a file starting with _ is a note, and a broken one is left out");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the check-story command says what's wrong, with the line, and exits with 1; and 0 when all is well", async () => {
  const { execFile } = await import("node:child_process");
  const run = (args) => new Promise((resolve) => { execFile(process.execPath, ["src/check-scenes.js", ...args], { cwd: projectDir }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout })); });
  const good = await run([]);
  assert.equal(good.code, 0, good.stdout);
  assert.match(good.stdout, /All \d+ scenes are sound/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-bad-"));
  fs.writeFileSync(path.join(dir, "thread_x.txt"), "== a\nHello.\n> Go -> nowhere\n* xp lots: x\n");
  const bad = await run([dir]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /thread_x\.txt \(line 4\): xp needs a number/);
  assert.match(bad.stdout, /choice 1 \(line 3\) goes to nowhere, which isn't a part/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the game has no written opening, and says so in a line; a written one is found by the life's name, then the shared one", () => {
  // The game's own scenes: nothing opens a new game, for any life, and starting the story says so and leaves no scene.
  const own = loadScenes(testWorld.gameScenes);
  for (const id of Object.keys(START_LIST)) assert.equal(openingSceneId(newGame(id), own.scenes), null, id);
  const fresh = newGame();
  const said = [];
  writtenTurn({ game: fresh, event: "start", emit: (e) => said.push(e), log: () => {}, scenes: own.scenes, broken: own.broken });
  assert.deepEqual(said.filter((e) => e.type !== "state"), [{ type: "notice", text: NO_OPENING }]);
  assert.equal(fresh.scene, null);
  assert.deepEqual(fresh.quests, [], "and a new game has no quest");
  assert.equal(publicState(fresh).storyWaiting, false, "so there's nothing to continue");
  // With the test scenes: the captain's own opening, and the shared one for every other life.
  assert.ok(WORLD_SCENES.opening_captain);
  for (const id of Object.keys(START_LIST)) assert.ok(openingSceneId(newGame(id)), id);
  assert.equal(openingSceneId(newGame("captain")), "opening_captain");
  assert.equal(openingSceneId(newGame("miner")), "opening");
  assert.equal(openingSceneId(newGame("docker"), { ...WORLD_SCENES, opening_docker: WORLD_SCENES.opening }), "opening_docker", "a life's own comes before the shared one");
});

test("the checker finds what's wrong with a scene, in plain words", () => {
  const broken = {
    start: "nowhere",
    parts: {
      a: { text: ["Hello."], choices: [{ say: "Go", to: "nowhere_else" }, { say: "Try", check: "persuasion:brutal", pass: "a" }, { tags: ["+Voss"], to: "a" }] },
      b: { text: [], do: [{ tool: "give_item", item: "a_pony" }, { tool: "make_tea" }] },
      c: { text: ["Lost."], end: true },
    },
  };
  const problems = sceneProblems(broken, "broken");
  for (const expected of ["starts at nowhere", "part c can't be reached", "part b has no text", "part b has no choices", "goes to nowhere_else", "unknown difficulty brutal", "needs pass and fail", "has no words", "effect 1", "Unknown tool: make_tea"]) {
    assert.ok(problems.some((problem) => problem.includes(expected)), `${expected}: ${problems.join(" / ")}`);
  }
});

// ---- Reading a part ----------------------------------------------------------------

test("a part reads the way the game master writes, so the page needs nothing new to show it", () => {
  const part = WORLD_SCENES.opening_captain.parts.bridge;
  const text = partText(part);
  const blocks = parseNarration(text);
  const speakers = blocks.filter((block) => block.type === "speech").map((block) => block.speaker);
  assert.ok(speakers.some((name) => /Voss/.test(name)), speakers.join(", "));
  assert.ok(speakers.some((name) => /Sorel/.test(name)));
  const options = parseOptions(text, vocab);
  assert.equal(options.length, 4);
  const check = options.find((option) => option.tags.some((tag) => tag.kind === "check"));
  assert.deepEqual(check.tags[0], { kind: "check", skill: "persuasion", difficulty: "moderate", audience: "voss" });
  assert.equal(check.label, "Ask what she isn't telling you");
  assert.ok(options.some((option) => option.tags.some((tag) => tag.kind === "approve" && tag.name === "Voss")));
  assert.ok(options.some((option) => option.tags.some((tag) => tag.kind === "belief" && tag.pole === "reason")));
  assert.equal(choiceLine({ say: "Run", check: "athletics:hard", tags: ["!", "-Tarrow"] }), "> [athletics:hard] [!] [-Tarrow] Run");
});

test("typing a choice is forgiving: the start of it, most of its words, or a typo, but never a guess between two", () => {
  const choices = WORLD_SCENES.opening_captain.parts.bridge.choices;
  assert.equal(matchChoice("Say nothing, and listen to it", choices)?.to, "listen");
  assert.equal(matchChoice("say nothing", choices)?.to, "listen");
  assert.equal(matchChoice("ask what she isnt teling you", choices)?.check, "persuasion:moderate:voss");
  assert.equal(matchChoice("tell the crew the truth", choices)?.to, "truth");
  assert.equal(matchChoice("what would she do if the chair were hers", choices)?.to, "voss_answer");
  assert.equal(matchChoice("ask", choices), null, "two choices start with ask");
  assert.equal(matchChoice("ask her", choices)?.to, "voss_answer", "only one goes on with her");
  assert.equal(matchChoice("fly to the moon", choices), null);
  assert.equal(matchChoice("", choices), null);
});

// ---- Playing ---------------------------------------------------------------------------

test("the captain's opening plays through with no AI: speech, a choice, consequences, and an end", () => {
  const game = newGame();
  const opening = play(game, { event: "start" });
  assert.equal(opening[0].role, "narrator");
  assert.match(opening[0].text, /@Commander Ilya Voss: "Captain\."/);
  assert.deepEqual(game.scene, { id: "opening_captain", part: "bridge", pending: null, seen: ["bridge"], quest: "first_orders", told: true, with: "voss", at: null });
  assert.equal(game.transcript.filter((entry) => entry.role === "player").length, 0, "nothing's logged as the player's until they choose");

  const heard = play(game, { playerText: "say nothing" });
  assert.equal(game.transcript.find((entry) => entry.role === "player")?.text, "Say nothing, and listen to it", "the choice is recorded in full, not as typed");
  assert.match(heard[0].text, /@Ensign Lira Vey: "Confirming:/);
  assert.equal(game.journal.length, 1, "the part's do step wrote the journal");
  assert.equal(game.scene.part, "listen");

  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  play(game, { playerText: "Have Pell plot the course" });
  assert.equal(game.scene, null, "the scene is over");
  assert.doesNotMatch(lastNarration(game), /asking if you meant it/, "the ship wasn't told, so the plain ending plays");
  assert.match(game.quests.find((quest) => quest.id === "first_orders").objective, /The course is plotted/);
  assert.equal(game.xp, 10);
  assert.ok(game.transcript.some((entry) => entry.role === "notice" && /XP/.test(entry.text)), "the award shows as a game message");
  assert.equal(publicState(game).scene, null);
  assert.equal(publicState(game).mode, undefined, "there's only the written story, so the game doesn't say which");
});

test("a choice with a check opens the check's window, and the story goes on from how it came out", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "Ask what she isn't telling you" });
  assert.ok(game.check, "the window is open");
  assert.equal(game.check.source, "choice");
  assert.equal(game.check.audience, "voss");
  assert.equal(game.transcript.at(-1).text, "Ask what she isn't telling you");
  assert.equal(game.scene.part, "bridge", "the story waits");
  assert.equal(checkCommand(game, "run").over, true);
  assert.equal(game.check, null);
  assert.equal(publicState(game).storyWaiting, true, "the page offers Continue the story");
  const expected = game.lastCheck.success ? "voss_pressed_pass" : "voss_pressed_fail";
  play(game, { event: "continue" });
  assert.equal(game.scene.part, expected);
  assert.equal(publicState(game).storyWaiting, false);
  assert.ok(game.lastCheck.used, "the same result can't be read twice");
  // Pressing Continue again says so, instead of playing the result again.
  const again = play(game, { event: "continue" });
  assert.equal(game.scene.part, expected);
  assert.match(again[0].text, /Nothing more is written/);
});

test("a part can demand a check or start a fight itself, and the ending decides where the story goes", () => {
  const scenes = {
    opening_captain: {
      start: "a",
      parts: {
        a: { text: ["A locked hatch."], check: "engineering:easy", reason: "Open the hatch", pass: "open", fail: "stuck" },
        open: { text: ["It opens."], choices: [{ say: "Go through", to: "ambush" }] },
        stuck: { text: ["It doesn't."], choices: [{ say: "Kick it", to: "ambush" }] },
        ambush: { text: ["Trouble."], fight: { enemy: "scrap_rat", lead_in: "Something the size of a dog looks at your boots." }, won: "won", lost: "lost", fled: "fled" },
        won: { text: ["You won."], end: true },
        lost: { text: ["You lost."], end: true },
        fled: { text: ["You ran."], end: true },
      },
    },
  };
  assert.deepEqual(sceneProblems(scenes.opening_captain, "test"), []);
  const game = newGame();
  play(game, { event: "start" }, scenes);
  assert.ok(game.check, "the check the story demanded is open");
  assert.equal(game.check.reason, "Open the hatch");
  assert.deepEqual(game.scene.pending, { kind: "check", pass: "open", fail: "stuck" });
  checkCommand(game, "run");
  const expected = game.lastCheck.success ? "open" : "stuck";
  play(game, { event: "continue" }, scenes);
  assert.equal(game.scene.part, expected);
  const fight = play(game, { playerText: game.lastCheck.success ? "go through" : "kick it" }, scenes);
  assert.ok(game.combat, "the fight has started");
  assert.match(fight[0].text, /Trouble\.[\s\S]*size of a dog/);
  assert.equal(game.scene.pending.kind, "fight");
  // The fight's ending is what the fight window records when it's over.
  game.combat = null;
  game.lastFight = { result: "fled", enemies: ["scrap_rat"], summary: "You got away.", used: false };
  play(game, { event: "continue" }, scenes);
  assert.equal(game.scene, null);
  assert.match(lastNarration(game), /You ran/);
});

test("what the written story can't answer leaves the game exactly as it was, and says why", () => {
  const game = newGame();
  play(game, { event: "start" });
  const before = JSON.stringify(game);
  assert.throws(() => play(game, { playerText: "fly to the moon" }), (err) => err instanceof StoryError && /isn't one of the choices/.test(err.message));
  assert.throws(() => play(game, { playerText: "I look into this", threadId: "crew_marrow_aft_hold" }), (err) => err instanceof StoryError && /hasn't been written out yet/.test(err.message));
  assert.equal(JSON.stringify(game), before);
  // Once the scene is over, typing gets a different answer.
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "see the ship" });
  assert.equal(game.scene, null);
  assert.throws(() => play(game, { playerText: "look around" }), /no more written story here/);
});

test("someone who isn't the captain gets the opening that fits anyone, with a note saying theirs is to come", () => {
  const game = newGame("miner", 5);
  const pieces = play(game, { event: "start" });
  assert.match(pieces[0].text, /A lamp is blinking somewhere above you/);
  assert.ok(pieces.some((piece) => piece.role === "notice" && /hasn't been written yet/.test(piece.text)));
  play(game, { playerText: "get on with the day" });
  assert.equal(game.scene, null);
});

test("a talk has what people have heard and goodbye, with nothing to type", () => {
  const game = newGame();
  play(game, { event: "start" });
  const voss = publicState(game).walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss, "Voss is on the bridge");
  talkCommand(game, { action: "open", person: voss.key });
  const view = talkView(game);
  assert.equal(view.asks, undefined, "there's nothing to say but the written lines");
  assert.equal(view.typed, undefined, "and no line to type on");
  assert.ok(view.rumors >= 0);
  assert.ok(view.goodbyeLabel);
  talkCommand(game, { action: "close" });
});

test("an older save, even one the AI game master was running, opens as a written game", () => {
  const old = { ...createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" })), version: 14 };
  delete old.scene;
  old.transcript = [{ role: "narrator", text: "The AI's last scene.\n\n> Go left\n> Go right" }];
  old.ai = { provider: "claude", messages: [{ role: "user", content: "x" }], written: ["what the story told"] };
  old.pendingEvents = ["A fight, for the AI to tell."];
  const migrated = migrateGame(old);
  assert.equal(migrated.version, 24);
  assert.equal(migrated.mode, undefined);
  assert.equal(migrated.ai, undefined, "what was kept for the AI goes");
  assert.equal(migrated.pendingEvents, undefined);
  assert.equal(migrated.scene, null);
  assert.deepEqual(migrated.flags, {});
  const notice = migrated.transcript.find((entry) => /The AI game master has gone/.test(entry.text));
  assert.match(notice.text, /^\[STORY\] The AI game master has gone from the game/);
  assert.equal(notice.turnover, true);
  assert.deepEqual(latestOptions(migrated.transcript), [], "the AI's last choices aren't offered");
  assert.equal(publicState(migrated).storyWaiting, false);
  // A game the written story was already running says nothing about the AI. Since 2026-11-12 it's told once that
  // the written main story has gone, because the quests it had from that story are closed.
  const written = migrateGame({ ...structuredClone(old), version: 18, mode: "written", transcript: [{ role: "narrator", text: "Written." }], quests: [{ id: "the_beacon", title: "The Beacon", description: "x", objective: "Find it.", status: "active", main: true }] });
  assert.deepEqual(written.transcript.map((entry) => entry.text), ["Written.", OLD_STORY_NOTICE]);
  assert.equal(written.transcript.at(-1).turnover, true);
  assert.equal(written.quests[0].status, "completed");
  assert.match(written.quests[0].objective, /^Closed: the written story this belonged to/);
  const fresh = createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" }));
  assert.equal(fresh.mode, undefined);
  assert.equal(fresh.ai, undefined);
  assert.equal(publicState(fresh).mode, undefined);
});

// ---- A whole story, played from the Leads menu: the test leak ---------------------------------

// Settles the check that's open, without the dice, the way its window would.
function settleCheck(game, success) {
  assert.ok(game.check, "a check is open");
  game.lastCheck = { id: game.check.id, skill: game.check.skill, difficulty: game.check.difficulty, success, reason: game.check.reason, source: game.check.source, used: false };
  game.check = null;
}
const roomNow = (game) => publicState(game).walk.here.name;
// The captain's opening, played to its end, so that nothing else is under way.
function pastTheOpening(game) {
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "see the ship" });
  assert.equal(game.scene, null);
  return game;
}

test("the game itself offers no written story: every lead aboard says it's not written yet", () => {
  const own = loadScenes(testWorld.gameScenes).scenes;
  assert.deepEqual(Object.keys(own).filter((id) => id.startsWith("thread_") || id.startsWith("opening") || id.startsWith("arrive_")), [], "no story, opening or arrival is written");
  const game = pastTheOpening(newGame());
  const leads = publicState(game).story.here;
  assert.ok(leads.length > 1, "the stories that aren't written are still listed");
  assert.deepEqual(leads.filter((one) => one.written).map((one) => one.id), [LEAK], "only the tests' own story is written, and it isn't in the game");
});

test("the captain plays a written story through from the Leads menu, and the game's records follow", () => {
  const game = pastTheOpening(newGame());
  // Taken up from the Leads menu.
  const lead = publicState(game).story.here.find((one) => one.id === LEAK);
  assert.ok(lead, "the lead is on offer aboard the Meridian");
  assert.equal(lead.written, true);
  assert.equal(publicState(game).story.here[0].id, LEAK, "a written story comes first");
  const opening = play(game, { playerText: `I look into this: ${lead.title}`, threadId: LEAK });
  assert.match(opening[0].text, /Naomi Cass is in your doorway/);
  assert.equal(game.story.threads[LEAK], "active", "the Leads menu lists it as followed");
  assert.ok(game.quests.find((quest) => quest.id === LEAK)?.status === "active");
  assert.equal(game.scene.part, "doorway");

  play(game, { playerText: "ask her how bad the leak is" });
  assert.equal(game.journal.length, 2, "the part's effect wrote the journal, after the opening's line");
  play(game, { playerText: "Ask Chief Marrow about the line first" });
  assert.equal(game.scene.part, "marrow_first");
  assert.equal(roomNow(game), "Engineering", "the map followed the story to Marrow");
  assert.equal(game.flags.marrow_asked, true);
  // He says no, and the story goes on another way.
  play(game, { playerText: "Ask him to mend it himself" });
  assert.equal(game.check.audience, "marrow");
  settleCheck(game, false);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "marrow_no");
  play(game, { playerText: "Go down to the line" });
  assert.equal(game.scene.part, "below");
  assert.equal(roomNow(game), "Under the Aft Holds", "the story put the player in a room of its own");
  assert.ok(publicState(game).walk.people.some((one) => /Naomi/.test(one.name)));
  assert.match(lastNarration(game), /> Look under the line/);

  play(game, { playerText: "Patch the line yourself" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "patched");
  assert.equal(game.quests.find((quest) => quest.id === LEAK).status, "completed");
  assert.equal(game.story.threads[LEAK], "done", "the story is finished in the game's records");
  assert.equal(game.story.record.endings[LEAK].ending, "patch_it", "by the name its file gives that ending");
  assert.equal(game.contacts.find((one) => /Naomi/.test(one.name)).attitude, "friendly");
  assert.equal(game.flags.line_patched, true);
  assert.ok(game.xp >= 20);
  play(game, { playerText: "climb back up" });
  assert.equal(game.scene, null);
  assert.equal(roomNow(game), "The Aft Holds", "back where the hatch comes up");
  assert.ok(game.journal.length >= 3, `the journal has the story: ${game.journal.length} entries`);
  assert.ok(!publicState(game).story.here.some((one) => one.id === LEAK), "a story that's over isn't a lead any more");
});

test("the story's other roads: a fight under the line, a patch that fails, the hold sealed, Marrow saying yes, and letting it run", () => {
  const start = (seed) => {
    const game = pastTheOpening(newGame("captain", seed));
    play(game, { playerText: "I look into this", threadId: LEAK });
    play(game, { playerText: "ask her how bad the leak is" });
    return game;
  };
  // Whatever lives under the line: a real fight starts, and losing it is survivable.
  const fighter = start(3);
  play(fighter, { playerText: "Go down with her now" });
  assert.equal(fighter.scene.part, "below");
  play(fighter, { playerText: "Look under the line" });
  assert.ok(fighter.combat, "the fight is on");
  assert.equal(fighter.combat.enemies.length, 2);
  fighter.combat = null;
  fighter.lastFight = { result: "defeat", enemies: ["scrap_rat"], summary: "You lost.", used: false };
  play(fighter, { event: "continue" });
  assert.equal(fighter.scene.part, "rats_lost");
  play(fighter, { playerText: "back to the line" });
  assert.equal(fighter.scene.part, "below");
  assert.doesNotMatch(lastNarration(fighter), /Look under the line/, "a choice whose part was seen isn't offered again");
  // The patch fails, the choice is gone, and the hold is sealed instead.
  play(fighter, { playerText: "Patch the line yourself" });
  settleCheck(fighter, false);
  play(fighter, { event: "continue" });
  assert.equal(fighter.scene.part, "patch_failed");
  play(fighter, { playerText: "Seal the hold" });
  assert.equal(fighter.scene, null);
  assert.equal(fighter.quests.find((quest) => quest.id === LEAK).status, "completed");
  assert.equal(fighter.story.record.endings[LEAK].ending, "seal_the_hold");
  assert.equal(fighter.flags.aft_hold_sealed, true);
  assert.equal(recordView(fighter).facts.find((fact) => fact.id === "aft_hold_sealed").text, "The Aft Holds are sealed since the leak.", "a flag set without words reads as the story's notes put it");

  // Marrow says yes, and the story ends there.
  const talker = start(4);
  play(talker, { playerText: "Ask Chief Marrow about the line first" });
  play(talker, { playerText: "Ask him to mend it himself" });
  settleCheck(talker, true);
  play(talker, { event: "continue" });
  assert.equal(talker.scene, null);
  assert.equal(talker.story.record.endings[LEAK].ending, "marrow_mends_it");
  assert.equal(talker.flags.marrow_owed, true);
  assert.equal(talker.contacts.find((one) => /Marrow/.test(one.name)).attitude, "friendly");

  // Letting it run, from the doorway, fails the quest without a single check.
  const cold = pastTheOpening(newGame("captain", 5));
  play(cold, { playerText: "I look into this", threadId: LEAK });
  play(cold, { playerText: "Tell her the line can wait" });
  assert.equal(cold.scene, null);
  assert.equal(cold.quests.find((quest) => quest.id === LEAK).status, "failed");
  assert.equal(cold.story.threads[LEAK], "done");
  assert.equal(cold.story.record.endings[LEAK].failed, true);
});

test("someone who isn't the captain gets the story's smaller side, and can still make it come out right", () => {
  const game = newGame("engine_hand", 8);
  play(game, { event: "start" });
  play(game, { playerText: "Get on with the day" });
  const lead = publicState(game).story.here.find((one) => one.id === LEAK);
  assert.ok(lead, "the lead reaches an engine hand aboard the Meridian");
  assert.match(lead.lead, /told everyone who'll listen/);
  const opening = play(game, { playerText: "I look into this", threadId: LEAK });
  assert.equal(game.scene.part, "heard", "the rule sent them past the captain's doorway");
  assert.match(opening[0].text, /You're not the captain/);
  play(game, { playerText: "Follow her down" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "followed");
  assert.equal(roomNow(game), "Under the Aft Holds");
  play(game, { playerText: "Hold the rag" });
  assert.equal(game.scene, null);
  assert.equal(game.quests.find((quest) => quest.id === LEAK).status, "completed");
  assert.equal(game.flags.leak_helper, true);
  assert.match(JSON.stringify(game.journal), /rag/, "the journal has the story");
});


// ---- People and things, with no AI ------------------------------------------------------------

const { openWrittenTalk, stockTalk, writtenTalkTurn } = await import("../src/talks.js");
const { askAtDoor, useThing, walkCommand } = await import("../src/walk.js");
const { computerCommand } = await import("../src/computer-use.js");

// Says one thing in a talk the way the server does: the answer goes in the talk's log.
function sayInTalk(game, text) {
  const { talkHeard, talkSaid } = walkModule;
  talkSaid(game, text);
  const pieces = [];
  writtenTalkTurn({ game, playerText: text, emit: (e) => { if (e.type !== "state") pieces.push(e); } });
  for (const piece of pieces) talkHeard(game, piece.text, piece.type === "text" ? "narrator" : "notice");
  return pieces;
}
const walkModule = await import("../src/walk.js");
const personKey = (game, pattern) => publicState(game).walk.people.find((one) => pattern.test(one.name))?.key;
function openTalkWith(game, pattern) {
  const key = personKey(game, pattern);
  assert.ok(key, `someone matching ${pattern} is in the room`);
  talkCommand(game, { action: "open", person: key });
  openWrittenTalk(game);
  return talkView(game);
}

test("in a written game, someone with a conversation of their own speaks first, and what you say leads on", () => {
  const game = newGame();
  play(game, { event: "start" });
  const view = openTalkWith(game, /Voss/);
  assert.match(view.lastReply, /@Commander Ilya Voss: "Captain\."/);
  assert.match(view.lastReply, /> What's our real situation, Commander\?/);
  assert.equal(game.talk.written.id, "talk_voss");
  const said = sayInTalk(game, "what's our real situation");
  assert.match(said[0].text, /Fuel for two weeks/);
  assert.equal(game.talk.written.part, "situation");
  assert.doesNotMatch(talkView(game).lastReply, /> What's our real situation/, "a question asked isn't offered again");
  assert.match(talkView(game).lastReply, /> Is there anything I should be worried about\?/);
  assert.throws(() => sayInTalk(game, "tell me a joke"), (err) => err instanceof StoryError && /isn't one of the things to say/.test(err.message));
  sayInTalk(game, "That's all for now");
  assert.equal(game.talk.written.part, "done");
  assert.doesNotMatch(talkView(game).lastReply, />/, "nothing more to say, so only the free buttons are left");
  talkCommand(game, { action: "close" });
  assert.equal(game.talk, null);
  assert.ok(game.transcript.some((entry) => /\[TALK\] You talked with Commander Ilya Voss/.test(entry.text)));
});

test("what's said in a conversation changes the game, and someone who isn't the captain gets its other side", () => {
  const game = newGame();
  play(game, { event: "start" });
  openTalkWith(game, /Pell/);
  assert.equal(game.talk.written.id, "talk_pell");
  // Whichever of her answers has an effect: every line she offers is tried until the journal has one more entry.
  const journalBefore = game.journal.length;
  for (let i = 0; i < 8 && game.journal.length === journalBefore; i += 1) {
    const offered = parseOptions(talkView(game).lastReply, vocab).map((option) => option.label);
    const next = offered.find((label) => !/carry on/i.test(label));
    if (!next) break;
    sayInTalk(game, next);
  }
  assert.equal(game.journal.length, journalBefore + 1, "a part's effect wrote the journal");
  talkCommand(game, { action: "close" });
  // Someone who isn't the captain gets Voss's other side, by the rule at the top of her file.
  const hand = newGame("engine_hand", 8);
  play(hand, { event: "start" });
  play(hand, { playerText: "Get on with the day" });
  walkCommand(hand, { action: "room", to: "bridge" });
  openTalkWith(hand, /Voss/);
  assert.equal(hand.talk.written.part, "other");
  assert.match(talkView(hand).lastReply, /The captain's shorter/);
});


test("anyone without a conversation of their own gets stock lines, put together from who they are", () => {
  const game = newGame();
  play(game, { event: "start" });
  walkCommand(game, { action: "room", to: "mess" });
  // The deck's people are all shown; the one to talk to is in the mess itself, and has no conversation written.
  const inMess = publicState(game).walk.people.filter((one) => one.room === "mess");
  const local = inMess.find((one) => one.crowd) ?? inMess.find((one) => !/Halm|Brandt|Seven|Roe|Aduro/.test(one.name));
  assert.ok(local, "someone ordinary is in the mess");
  talkCommand(game, { action: "open", person: local.key });
  openWrittenTalk(game);
  assert.equal(game.talk.written.id, null);
  assert.ok(game.talk.written.stock, "the stock conversation was made when it opened");
  const view = talkView(game);
  assert.match(view.lastReply, new RegExp(`^@${local.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `));
  assert.match(view.lastReply, /> What's it like, here\?/);
  sayInTalk(game, "what's it like here");
  assert.match(talkView(game).lastReply, /One hall, four sittings/, "the room's own description, as what they say");
  assert.doesNotMatch(talkView(game).lastReply, /> What's it like, here\?/);
  const stock = stockTalk(game, game.talk);
  assert.equal(stock.start, "start");
  talkCommand(game, { action: "close" });
});

test("a conversation can't open a check or a fight, and the checker says so", () => {
  const { scene } = parseSceneText("== start\n@Someone: \"Hello.\"\n> [persuasion:hard] Push -> a | b\n== a\nFIGHT scrap_rat: Rats.\n  won -> start\n  lost -> start\n== b\nFine.\nEND\n", "talk_test");
  const problems = sceneProblems(scene, "talk_test", { talk: true });
  assert.ok(problems.some((one) => /choice 1 .* has a check, and a conversation can't open one/.test(one)), problems.join(" / "));
  assert.ok(problems.some((one) => /part a .* has a fight, and a conversation can't open one/.test(one)), problems.join(" / "));
  assert.deepEqual(sceneProblems(scene, "scene_test"), [], "the same file is fine as a scene");
});

test("using a thing with no AI: something to pick up is picked up, and a thing with a written result gives it", () => {
  const game = newGame();
  play(game, { event: "start" });
  // The bridge's things, by name: on a deck, a thing's key is the deck's and its own letter.
  const onBridge = (name) => publicState(game).walk.things.find((thing) => thing.room === "bridge" && name.test(thing.name)).id;
  const chip = useThing(game, onBridge(/data chip/i));
  assert.match(chip.said, /^\[ITEM\] Received: .*Data Chip/i);
  assert.equal(game.inventory.data_chip, 1);
  assert.match(useThing(game, onBridge(/data chip/i)).said, /already got one/);
  assert.match(useThing(game, onBridge(/chair/i)).said, /The chair takes your weight/);
  assert.throws(() => useThing(game, "deck1:zzz"), /isn't here/);
  // Over the walk command, which is what the page calls. The plot table has a computer file of its own, so Use sits
  // the captain down at it instead of reading the map's line.
  const reply = walkCommand(game, { action: "use", key: onBridge(/plot table/i) });
  assert.equal(reply.computer, true);
  assert.equal(game.computer?.name, "The plot table");
  computerCommand(game, { action: "logoff" });
  assert.equal(game.computer, null);
  // Somewhere with nothing written yet, there's still an answer.
  walkCommand(game, { action: "room", to: "aft" });
  const aft = publicState(game).walk.things.find((thing) => /Coolant/.test(thing.name));
  assert.match(useThing(game, aft.id).said, /Nothing more comes of it/);
});

test("asking at a closed door with no AI: a door that opens when asked, one that needs a flag, and one that opens a check", () => {
  // The picket line at Cinder Reach opens to anyone who crosses it, and it's remembered.
  const miner = newGame("miner", 11);
  play(miner, { event: "start" });
  play(miner, { playerText: "get on with the day" });
  const picket = publicState(miner).walk.exits.find((exit) => exit.closed);
  assert.ok(picket, "the picket line is a closed way out of the Row");
  const crossed = askAtDoor(miner, picket.key);
  assert.match(crossed.said, /They watch you cross/);
  assert.equal(crossed.opened, true);
  assert.equal(miner.flags.crossed_the_picket, true);
  assert.ok(!publicState(miner).walk.exits.find((exit) => exit.key === picket.key).closed, "the way is open now");

  // The Velvet Deck wants an invitation, and takes money otherwise, through a check.
  const dealer = newGame("dealer", 7);
  play(dealer, { event: "start" });
  play(dealer, { playerText: "get on with the day" });
  const lift = publicState(dealer).walk.exits.find((exit) => exit.closed);
  assert.ok(lift);
  const asked = askAtDoor(dealer, lift.key);
  assert.equal(asked.check, true);
  assert.ok(dealer.check, "the check's window is open");
  assert.equal(dealer.check.source, "door");
  assert.equal(dealer.check.skill, "commerce");
  assert.deepEqual(Object.keys(dealer.doorAsked).sort(), ["fail", "flag", "pass", "place", "to"]);
  settleCheck(dealer, true);
  const pieces = play(dealer, { event: "continue" });
  assert.match(pieces[0].text, /the grille does/);
  assert.ok(dealer.opened.wheel?.includes("velvet"), "the door is open");
  assert.equal(dealer.doorAsked, null);
  // The same door, with the invitation in hand, opens without a check.
  const invited = newGame("dealer", 9);
  play(invited, { event: "start" });
  play(invited, { playerText: "get on with the day" });
  invited.flags.velvet_invitation = true;
  const welcome = askAtDoor(invited, publicState(invited).walk.exits.find((exit) => exit.closed).key);
  assert.equal(welcome.opened, true);
  assert.match(welcome.said, /has your invitation/);
  // Asking at a door that's already open is refused.
  assert.throws(() => askAtDoor(miner, picket.key), /isn't closed/);
});

test("every closed door in the world has a written rule, and every rule is sound", async () => {
  const { WORLD_MAPS } = await import("../src/world.js");
  let doors = 0;
  for (const [place, map] of Object.entries(WORLD_MAPS)) {
    for (const [levelId, level] of Object.entries(map.levels)) {
      for (const [key, exit] of Object.entries(level.exits ?? {})) {
        if (!exit.closed) continue;
        doors += 1;
        const rule = exit.closed.ask;
        assert.ok(rule, `${place}:${levelId}:${key} has no rule`);
        const kinds = ["if", "check", "opens", "answer"].filter((field) => rule[field]);
        assert.ok(kinds.length, `${place}:${levelId}:${key} has a rule with nothing in it`);
        if (rule.if) {
          assert.deepEqual(parseCondition(rule.if).problems, [], `${place}:${levelId}:${key}: ${rule.if}`);
          assert.ok(rule.opens, `${place}:${levelId}:${key} needs opens`);
        }
        if (rule.check) {
          const [skill, difficulty] = rule.check.split(":");
          assert.ok(SKILLS[skill] && difficulty, `${place}:${levelId}:${key}: ${rule.check}`);
          assert.ok(rule.pass && rule.fail, `${place}:${levelId}:${key} needs pass and fail`);
        }
      }
    }
  }
  assert.equal(doors, 15);
});

// ---- A life the player chose, and arriving somewhere with a written arrival -------------

const { shipCommand } = await import("../src/ship.js");

test("a condition can ask which life the player chose", () => {
  assert.deepEqual(parseCondition("life docker").problems, []);
  assert.match(parseCondition("life nobody").problems[0], /no life called nobody/);
  assert.equal(conditionHolds(newGame("docker", 2), "life docker", HELPERS), true);
  assert.equal(conditionHolds(newGame("docker", 2), "life captain", HELPERS), false);
  assert.equal(conditionHolds(newGame(), "life captain and captain", HELPERS), true);
});

test("arriving somewhere with a written arrival plays it when the player continues, once at length and then in a line", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "have pell plot" });
  const jump = shipCommand(game, { action: "course", id: "haven" });
  assert.equal(jump.moved, true);
  assert.equal(game.location, "haven");
  assert.equal(game.arrived, "haven");
  assert.equal(publicState(game).storyWaiting, true, "the page offers Continue the story");
  const arrival = play(game, { event: "continue" });
  assert.match(arrival[0].text, /Haven Station comes up on the viewport/);
  assert.equal(game.arrived, null);
  assert.equal(game.flags.arrived_haven, true);
  assert.equal(game.scene, null, "the arrival ends by itself");
  assert.ok(arrival.some((piece) => piece.role === "notice" && /Leads menu/.test(piece.text)));
  // Back and forth: the second arrival is a line.
  shipCommand(game, { action: "course", id: "meridian" });
  play(game, { event: "continue" });
  shipCommand(game, { action: "course", id: "haven" });
  const again = play(game, { event: "continue" });
  assert.match(again[0].text, /Haven again/);
  // Someone arriving alone gets their own words.
  const hand = newGame("engine_hand", 6);
  play(hand, { event: "start" });
  play(hand, { playerText: "Get on with the day" });
  hand.credits = 200;
  shipCommand(hand, { action: "course", id: "haven" });
  assert.equal(hand.location, "haven");
  const alone = play(hand, { event: "continue" });
  assert.match(alone[0].text, /Haven Station, on your own/);
  // The game itself has no written arrival, so a jump there leaves nothing to continue.
  assert.equal(loadScenes(testWorld.gameScenes).scenes.arrive_haven, undefined);
});


// ---- Over the real server -----------------------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-server-"));
let child = null;
let port = 0;
// A settings file from when the game had an AI, with a key in it. The game must leave it exactly as it is.
const OLD_SETTINGS = JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key", story: "ai" });

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
  if (type.includes("ndjson")) {
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { status: res.status, lines, text: lines.filter((line) => line.type === "text").map((line) => line.text).join(""), error: lines.find((line) => line.type === "error")?.message ?? null, done: lines.find((line) => line.type === "done")?.state ?? null };
  }
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}
const state = async () => (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json());

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), OLD_SETTINGS);
  port = await freePort();
  const env = { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) };
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
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

test("over the real server: a new game's written opening plays, and so does what follows", async () => {
  assert.equal((await state()).settings, undefined, "there are no AI settings");

  const made = await post("/api/new", { draft: randomDraft({ seed: 42, archetype: "officer" }) });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.mode, undefined);
  assert.equal(made.game.scene, null);

  const opening = await post("/api/chat", { event: "start" });
  assert.equal(opening.status, 200);
  assert.equal(opening.error, null);
  assert.match(opening.text, /@Commander Ilya Voss/);
  assert.equal(opening.done.scene.part, "bridge");
  // What the story said, and then the quest its first part gave.
  assert.deepEqual(opening.done.transcript.map((entry) => entry.role), ["narrator", "notice"]);
  assert.match(opening.done.transcript.at(-1).text, /First Orders/);
  assert.equal(latestOptions(opening.done.transcript).length, 4, "the four choices are on offer");

  // Something that isn't a choice changes nothing, and the choices are still on offer.
  const wrong = await post("/api/chat", { text: "fly to the moon" });
  assert.match(wrong.error, /isn't one of the choices/);
  assert.equal(wrong.lines.at(-1).state.transcript.length, 2);
  assert.equal(latestOptions(wrong.lines.at(-1).state.transcript).length, 4);

  // A choice with a check, the way the page does it: the window first, then Continue.
  const started = await post("/api/check/start", { label: "Ask what she isn't telling you" });
  assert.equal(started.status, 200, JSON.stringify(started));
  assert.equal(started.game.check.skill, "persuasion");
  const rolled = await post("/api/check", { command: "run" });
  assert.equal(rolled.over, true);
  assert.equal(rolled.game.storyWaiting, true);
  const carried = await post("/api/chat", { event: "continue" });
  assert.equal(carried.error, null);
  assert.ok(["voss_pressed_pass", "voss_pressed_fail"].includes(carried.done.scene.part), JSON.stringify(carried.done.scene));
  assert.ok(carried.done.transcript.some((entry) => entry.role === "notice" && /\[ROLL\]/.test(entry.text)));

  const on = await post("/api/chat", { text: "go on" });
  assert.equal(on.done.scene.part, "orders");
  const over = await post("/api/chat", { text: "go and see the ship" });
  assert.equal(over.done.scene, null);
  assert.match(over.done.quests.find((quest) => quest.id === "first_orders").objective, /The drill ended without you/);

  // A story taken up from the Leads menu, the way the page sends it.
  const lead = over.done.story.here.find((one) => one.id === LEAK);
  assert.ok(lead?.written, "the written story is on offer");
  const taken = await post("/api/chat", { text: `I look into this: ${lead.title}`, thread: lead.id });
  assert.equal(taken.error, null, taken.error);
  assert.match(taken.text, /There's a line weeping in the Aft Holds/);
  assert.equal(taken.done.scene.part, "doorway");
  assert.ok(taken.done.story.active.some((one) => one.id === LEAK), "the Leads menu now lists it as followed");
  assert.ok(taken.done.quests.some((quest) => quest.id === LEAK));
  const unwritten = over.done.story.here.find((one) => !one.written);
  if (unwritten) {
    const refused = await post("/api/chat", { text: `I look into this: ${unwritten.title}`, thread: unwritten.id });
    assert.match(refused.error, /hasn't been written out yet/);
  }
});

test("over the real server: a talk is the person's own written words, with nothing to type", async () => {
  const current = (await state()).game;
  const voss = current.walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss);
  const opened = await post("/api/talk", { action: "open", person: voss.key });
  assert.equal(opened.status, 200, JSON.stringify(opened));
  assert.match(opened.game.talk.lastReply, /@Commander Ilya Voss/);
  const said = await post("/api/talk", { action: "say", text: "What's our real situation, Commander?" });
  assert.equal(said.status, 200);
  assert.equal(said.error, null, said.error);
  assert.match(said.text, /Fuel for two weeks/);
  assert.equal(said.done.talk.log.at(-1).role, "narrator");
  const wrong = await post("/api/talk", { action: "say", text: "Dance for me" });
  assert.match(wrong.error, /isn't one of the things to say/);
  await post("/api/talk", { action: "close" });
});

test("over the real server: using a thing comes back as what happened", async () => {
  await post("/api/talk", { action: "close" });
  const chair = (await state()).game.walk.things.find((thing) => /chair/.test(thing.name));
  const sat = await post("/api/walk", { action: "use", key: chair.id });
  assert.equal(sat.status, 200, JSON.stringify(sat));
  assert.match(sat.said, /The chair takes your weight/);
  assert.equal(sat.check, false);
  assert.ok(sat.game.transcript.some((entry) => entry.role === "notice" && /chair takes your weight/.test(entry.text)), "the story keeps a line about it");
});

test("over the real server: there's no AI to choose, and the old settings file with its key is left as it was", async () => {
  for (const route of ["/api/settings", "/api/settings/test", "/api/story"]) {
    const refused = await post(route, { story: "ai", mode: "ai", apiKey: "another-key" });
    assert.equal(refused.status, 404, route);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/settings`)).status, 404);
  const made = await post("/api/new", { draft: randomDraft({ seed: 43, archetype: "officer" }) });
  assert.equal(made.status, 200);
  assert.equal(made.game.mode, undefined);
  await post("/api/save", { slot: "slot1" });
  const loaded = await post("/api/load", { slot: "slot1" });
  assert.equal(loaded.game.mode, undefined);
  assert.equal(fs.readFileSync(path.join(serverData, "settings.json"), "utf8"), OLD_SETTINGS, "the file is untouched");
  assert.ok(!fs.existsSync(path.join(serverData, "usage.jsonl")), "nothing's counted, since nothing costs anything");
});
