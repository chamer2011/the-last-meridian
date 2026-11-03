// The written story: scenes played without the AI, the switch between the two, and the test scene. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseNarration, parseOptions, buildVocab } = await import("../public/story.js");
const { POLES, SKILLS } = await import("../src/character-data.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { START_LIST } = await import("../src/role.js");
const { publicState } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { StoryError, allSceneProblems, choiceLine, loadScenes, matchChoice, openingSceneId, partText, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { attr, maxHp, skillRank } = await import("../src/rules.js");
const { talkCommand, talkView } = await import("../src/walk.js");

const WORLD_SCENES = loadScenes().scenes;
const HELPERS = { attr, skillRank, maxHp };

// The page's own vocabulary: every skill, and every belief.
const vocab = buildVocab(SKILLS);
for (const pole of Object.keys(POLES)) vocab.poles[pole] = pole;
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.mode = "written";
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
  for (const piece of pieces) game.transcript.push(piece);
  return pieces;
}
const lastNarration = (game) => [...game.transcript].reverse().find((entry) => entry.role === "narrator")?.text ?? "";

// ---- The scene files ------------------------------------------------------------

test("every written scene is sound: it reads, it starts somewhere, every part can be reached, and every choice goes somewhere real", () => {
  const { count, problems } = allSceneProblems();
  assert.ok(count >= 2);
  assert.deepEqual(problems, []);
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
  const holds = (text) => conditionHolds(game, text, HELPERS);
  assert.equal(holds("has medkit"), true);
  assert.equal(holds("not has medkit"), false);
  assert.equal(holds("credits >= 50 and flag told"), true);
  assert.equal(holds("credits > 50"), false);
  assert.equal(holds("seen b and not seen c"), true);
  assert.equal(holds("captain"), true);
  assert.equal(holds("at meridian"), true);
  assert.equal(holds("quest the_beacon active"), true);
  assert.equal(holds("quest the_beacon done"), false);
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
  play(game, { playerText: "tell the fleet the truth" });
  assert.equal(game.flags.told_the_fleet, true);
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  assert.match(lastNarration(game), /> Ask her what she'd do/, "not asked yet, so it's offered");
  play(game, { playerText: "ask her what she'd do" });
  assert.equal(game.scene.part, "voss_answer");
  play(game, { playerText: "go on" });
  assert.doesNotMatch(lastNarration(game), /> Ask her what she'd do/, "asked once, so it's gone");
  assert.throws(() => play(game, { playerText: "ask her what she'd do" }), /isn't one of the choices/);
  play(game, { playerText: "have pell plot" });
  assert.match(lastNarration(game), /The Sundial's asking if you meant it/, "the rule took the story to the part that knows");
  assert.equal(game.scene, null);
  assert.equal(game.flags.told_the_fleet, true, "flags outlive the scene");
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

test("the captain's opening is written, and every other life has an opening to fall back on", () => {
  assert.ok(WORLD_SCENES.opening_captain);
  for (const id of Object.keys(START_LIST)) {
    const game = newGame(id);
    assert.ok(openingSceneId(game), id);
  }
  assert.equal(openingSceneId(newGame("captain")), "opening_captain");
  assert.equal(openingSceneId(newGame("docker")), "opening");
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
  assert.equal(matchChoice("tell the fleet the truth", choices)?.to, "truth");
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
  assert.deepEqual(game.scene, { id: "opening_captain", part: "bridge", pending: null, seen: ["bridge"] });
  assert.equal(game.transcript.filter((entry) => entry.role === "player").length, 0, "nothing's logged as the player's until they choose");

  const heard = play(game, { playerText: "say nothing" });
  assert.equal(game.transcript.find((entry) => entry.role === "player")?.text, "Say nothing, and listen to it", "the choice is recorded in full, not as typed");
  assert.match(heard[0].text, /@Ensign Lira Vey: "Confirming:/);
  assert.equal(game.journal.length, 1, "the part's do step wrote the journal");
  assert.equal(game.scene.part, "listen");

  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  play(game, { playerText: "Have Pell plot the course for Haven" });
  assert.equal(game.scene, null, "the scene is over");
  assert.doesNotMatch(lastNarration(game), /Sundial's asking/, "the fleet wasn't told, so the plain ending plays");
  assert.match(game.quests.find((quest) => quest.id === "the_beacon").objective, /Haven Station is plotted/);
  assert.equal(game.xp, 10);
  assert.ok(game.transcript.some((entry) => entry.role === "notice" && /XP/.test(entry.text)), "the award shows as a game message");
  assert.ok(publicState(game).scene === null && publicState(game).mode === "written");
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
  assert.equal(game.pendingEvents.length, 1, "the page offers Continue the story");
  const expected = game.lastCheck.success ? "voss_pressed_pass" : "voss_pressed_fail";
  play(game, { event: "continue" });
  assert.equal(game.scene.part, expected);
  assert.equal(game.pendingEvents.length, 0);
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
  game.pendingEvents.push("The player ran.");
  play(game, { event: "continue" }, scenes);
  assert.equal(game.scene, null);
  assert.match(lastNarration(game), /You ran/);
});

test("what the written story can't answer leaves the game exactly as it was, and says why", () => {
  const game = newGame();
  play(game, { event: "start" });
  const before = JSON.stringify(game);
  assert.throws(() => play(game, { playerText: "fly to the moon" }), (err) => err instanceof StoryError && /isn't one of the choices/.test(err.message));
  assert.throws(() => play(game, { playerText: "I look into this", threadId: "crew_naomi_under_crew" }), (err) => err instanceof StoryError && /hasn't been written out yet/.test(err.message));
  assert.equal(JSON.stringify(game), before);
  // Once the scene is over, typing gets a different answer.
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "see the ship" });
  assert.equal(game.scene, null);
  assert.throws(() => play(game, { playerText: "look around" }), /no more written story here/);
});

test("someone who isn't the captain gets the opening that fits anyone, with a note saying theirs is to come", () => {
  const game = newGame("docker", 5);
  const pieces = play(game, { event: "start" });
  assert.match(pieces[0].text, /The signal is on every band/);
  assert.ok(pieces.some((piece) => piece.role === "notice" && /hasn't been written yet/.test(piece.text)));
  play(game, { playerText: "get on with the day" });
  assert.equal(game.scene, null);
});

test("in a written game, a talk has what people have heard and goodbye, with nothing to type", () => {
  const game = newGame();
  play(game, { event: "start" });
  const voss = publicState(game).walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss, "Voss is on the bridge");
  talkCommand(game, { action: "open", person: voss.key });
  const view = talkView(game);
  assert.equal(view.written, true);
  assert.deepEqual(view.asks, []);
  assert.ok(view.rumors >= 0);
  talkCommand(game, { action: "close" });
  game.mode = "ai";
  talkCommand(game, { action: "open", person: voss.key });
  assert.equal(talkView(game).written, false);
  assert.ok(talkView(game).asks.length > 0, "with an AI, there are things to say");
});

test("an older save keeps its AI game master, and a new game says which it has", () => {
  const old = { ...createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" })), version: 14 };
  delete old.mode;
  delete old.scene;
  const migrated = migrateGame(old);
  assert.equal(migrated.version, 15);
  assert.equal(migrated.mode, "ai");
  assert.equal(migrated.scene, null);
  assert.deepEqual(migrated.flags, {});
  const fresh = createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" }));
  assert.equal(fresh.mode, "ai", "the server decides, from the Settings menu");
  assert.equal(publicState(fresh).mode, "ai");
});

// ---- Over the real server, with no key and no AI anywhere -------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-server-"));
let child = null;
let port = 0;
let aiCalls = 0;
let standIn = null;

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
  // Any call to the AI would land here, and there must be none.
  standIn = http.createServer((req, res) => {
    aiCalls += 1;
    res.writeHead(500);
    res.end();
  });
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  port = await freePort();
  const env = { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port), ANTHROPIC_BASE_URL: `http://127.0.0.1:${standIn.address().port}` };
  delete env.ANTHROPIC_API_KEY;
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  standIn?.close();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: with no key, a new game gets the written story, and the opening plays with no AI call", async () => {
  const settings = (await state()).settings;
  assert.equal(settings.hasKey, false);
  assert.equal(settings.story, null);
  assert.equal(settings.storyApplies, "written");

  const made = await post("/api/new", { draft: randomDraft({ seed: 42, archetype: "officer" }) });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.mode, "written");
  assert.equal(made.game.scene, null);

  const opening = await post("/api/chat", { event: "start" });
  assert.equal(opening.status, 200);
  assert.equal(opening.error, null);
  assert.match(opening.text, /@Commander Ilya Voss/);
  assert.equal(opening.done.scene.part, "bridge");
  assert.equal(opening.done.transcript.at(-1).role, "narrator");

  // Something that isn't a choice changes nothing, and the choices are still on offer.
  const wrong = await post("/api/chat", { text: "fly to the moon" });
  assert.match(wrong.error, /isn't one of the choices/);
  assert.equal(wrong.lines.at(-1).state.transcript.length, 1);

  // A choice with a check, the way the page does it: the window first, then Continue.
  const started = await post("/api/check/start", { label: "Ask what she isn't telling you" });
  assert.equal(started.status, 200, JSON.stringify(started));
  assert.equal(started.game.check.skill, "persuasion");
  const rolled = await post("/api/check", { command: "run" });
  assert.equal(rolled.over, true);
  assert.equal(rolled.game.pendingEvents, 1);
  const carried = await post("/api/chat", { event: "continue" });
  assert.equal(carried.error, null);
  assert.ok(["voss_pressed_pass", "voss_pressed_fail"].includes(carried.done.scene.part), JSON.stringify(carried.done.scene));
  assert.ok(carried.done.transcript.some((entry) => entry.role === "notice" && /\[ROLL\]/.test(entry.text)));

  const on = await post("/api/chat", { text: "go on" });
  assert.equal(on.done.scene.part, "orders");
  const over = await post("/api/chat", { text: "go and see the ship" });
  assert.equal(over.done.scene, null);
  assert.match(over.done.quests.find((quest) => quest.id === "the_beacon").objective, /Haven Station is one jump away/);
  assert.equal(aiCalls, 0, "nothing went anywhere near the AI");
});

test("over the real server: a talk in a written game has nothing to type, and saying something is refused", async () => {
  const current = (await state()).game;
  const voss = current.walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss);
  const opened = await post("/api/talk", { action: "open", person: voss.key });
  assert.equal(opened.status, 200, JSON.stringify(opened));
  assert.equal(opened.game.talk.written, true);
  assert.deepEqual(opened.game.talk.asks, []);
  const said = await post("/api/talk", { action: "say", text: "Hello" });
  assert.equal(said.status, 400);
  assert.match(said.error, /Written conversations aren't in yet/);
  await post("/api/talk", { action: "close" });
  assert.equal(aiCalls, 0);
});

test("over the real server: choosing the AI game master in Settings applies to the next new game, and a key does the same by itself", async () => {
  const chosen = await post("/api/settings", { story: "ai" });
  assert.equal(chosen.story, "ai");
  assert.equal(chosen.storyApplies, "ai");
  const aiGame = await post("/api/new", { draft: randomDraft({ seed: 43, archetype: "officer" }) });
  assert.equal(aiGame.game.mode, "ai");
  await post("/api/save", { slot: "slot1" });
  const back = await post("/api/settings", { story: "written" });
  assert.equal(back.storyApplies, "written");
  const written = await post("/api/new", { draft: randomDraft({ seed: 44, archetype: "officer" }) });
  assert.equal(written.game.mode, "written");
  // The saved game, with its AI game master, is kept as it was.
  const loaded = await post("/api/load", { slot: "slot1" });
  assert.equal(loaded.game.mode, "ai");
});
