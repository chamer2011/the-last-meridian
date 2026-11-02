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
const { StoryError, choiceLine, matchChoice, openingSceneId, partText, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { talkCommand, talkView } = await import("../src/walk.js");
const { WORLD_SCENES } = await import("../src/world.js");

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

test("every written scene is sound: it starts somewhere, every part can be reached, and every choice goes somewhere real", () => {
  assert.ok(Object.keys(WORLD_SCENES).length >= 2);
  for (const [id, scene] of Object.entries(WORLD_SCENES)) assert.deepEqual(sceneProblems(scene, id), [], id);
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
  for (const expected of ["starts at nowhere", "part c can't be reached", "part b has no text", "part b has no choices", "goes to nowhere_else", "unknown difficulty brutal", "needs pass and fail", "has no words", "step 1", "Unknown tool: make_tea"]) {
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
  assert.deepEqual(game.scene, { id: "opening_captain", part: "bridge", pending: null });
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
