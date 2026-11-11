// The story knows (health step 9): a scene can ask whether someone's hurt, badly hurt, ill, able to walk, laid up or
// dead, and can wound, heal or kill them, with what it did on the record; the game leaves a fact when a limb is lost;
// Tarrow's answer to "how she's doing" follows how she is; and the Story board edits the wounds file, a place's medbay
// and a species' body.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-story-health-"));
process.env.GAME_DATA_DIR ??= dataDir;
// The board writes files, so the health files and the species are copies.
const worldDir = fileURLToPath(new URL("../world/", import.meta.url));
for (const [folder, env] of [["health", "GAME_HEALTH_DIR"], ["species", "GAME_SPECIES_DIR"]]) {
  const copy = path.join(dataDir, `copy-${folder}`);
  fs.mkdirSync(copy, { recursive: true });
  for (const name of fs.readdirSync(path.join(worldDir, folder))) fs.copyFileSync(path.join(worldDir, folder, name), path.join(copy, name));
  process.env[env] = copy;
}

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const { storyCommand } = await import("../src/command.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { factsLeft, loadScenes, sceneProblems } = await import("../src/scenes.js");
const { openWrittenTalk, writtenTalkTurn } = await import("../src/talks.js");
const { passTime } = await import("../src/rules.js");
const { readNames } = await import("../src/death.js");
const { medbayOf } = await import("../src/medbay.js");
const { boardWorldItem, boardWorldList, saveBoardWorldItem } = await import("../src/board.js");
const { WORLD_CHARACTERS } = await import("../src/world.js");
const { writeHealthText, writeWoundsText } = await import("../public/health-text.js");
const { SPECIES_SPEC, writeWorldText } = await import("../public/world-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const TARROW = "id:tarrow";
const BAO = "crowd:meridian:mess hand bao";
const wound = (name, part) => body.newWound(body.woundKindsByName(name).find((kind) => kind.parts.includes(part)), part);
const holds = (game, words) => {
  const { problems } = parseCondition(words);
  assert.deepEqual(problems, [], words);
  return conditionHolds(game, words);
};
const problemOf = (words) => parseCondition(words).problems.join("; ");
function play(game, lines) {
  const { scene, problems } = parseSceneText(["# A test", "", "== start", ...lines, "END"].join("\n"), "test.txt");
  assert.deepEqual(problems, []);
  const said = [];
  for (const step of scene.parts.start.do ?? []) said.push(...storyCommand(game, step));
  return said;
}

test("a scene can ask whether someone's hurt, badly hurt, ill, can walk, is laid up, or is dead", () => {
  const game = newGame();
  assert.equal(holds(game, "can walk tarrow"), true);
  assert.equal(holds(game, "can't walk Kara Tarrow"), false);
  assert.equal(holds(game, "hurt tarrow"), false);
  assert.equal(holds(game, "hurt you"), false);
  // Vik starts the game laid up on a cot with a broken leg.
  assert.equal(holds(game, "laid up vik"), true);
  assert.equal(holds(game, "laid up any"), true);
  assert.equal(holds(game, "badly hurt vik"), true);
  assert.equal(holds(game, "not laid up tarrow"), true);
  // Out cold, she can't walk; a cut is hurt but not badly; an illness isn't hurt at all.
  body.addWounds(game, TARROW, [wound("knock", "head")]);
  assert.equal(holds(game, "can walk tarrow"), false);
  assert.equal(holds(game, "cannot walk tarrow"), true);
  body.addWounds(game, "you", [wound("cut", "left_arm")]);
  assert.deepEqual([holds(game, "hurt you"), holds(game, "badly hurt you")], [true, false]);
  body.catchIllness(game, BAO, "cough", game.clock.hours);
  assert.deepEqual([holds(game, "ill mess hand bao"), holds(game, "hurt mess hand bao"), holds(game, "ill any")], [true, false, true]);
  // A story person anywhere, by name.
  assert.equal(holds(game, "hurt quill"), false);
  assert.equal(holds(game, "dead any"), false);
  // The checker says what's wrong.
  assert.match(problemOf("can walk any"), /doesn't say who/);
  assert.match(problemOf("hurt somebody nobody knows"), /nobody called somebody nobody knows/);
  assert.match(problemOf("can run tarrow"), /"can" is followed by walk/);
  assert.match(problemOf("laid tarrow"), /"laid" is followed by up/);
  assert.match(problemOf("dead"), /followed by someone/);
});

test("a scene can wound someone, on the part it names or one the game picks, and it goes on the record", () => {
  const game = newGame();
  const said = play(game, ["* wound tarrow deep cut on the left arm: A blade in the dark"]);
  assert.deepEqual(said, ["[HEALTH] Kara Tarrow, a deep cut in the left arm: A blade in the dark"]);
  assert.deepEqual(body.woundsNow(game, TARROW).map((one) => [one.kind, one.part]), [["deep_cut", "left_arm"]]);
  assert.equal(game.flags.tarrow_wounded, true);
  assert.match(game.story.record.facts.find((one) => one.id === "tarrow_wounded").text, /Kara Tarrow was wounded on day 1: a deep cut in the left arm/);
  // A leg the game picks, the same in the same game at the same moment.
  const pick = () => {
    const one = newGame();
    one.bodySeed = 7;
    play(one, ["* wound tarrow broken bone on a leg: She fell down the forward stair"]);
    return body.woundsNow(one, TARROW)[0].part;
  };
  assert.match(pick(), /^(right|left)_leg$/);
  assert.equal(pick(), pick());
  // The player too, and the checker's words.
  play(game, ["* wound you cut: A slip with the cutter"]);
  assert.ok(game.wounds.some((one) => one.kind === "cut"));
  assert.match(parseEffect("wound tarrow broken bone on the head: no").problem, /can't be on the head/);
  assert.match(parseEffect("wound tarrow scar: no").problem, /a wound from the wounds file \(bruise, cut/);
  assert.match(parseEffect("wound tarrow deep cut").problem, /needs a colon/);
  assert.match(parseEffect("wound nobody here cut: x").problem, /wound is written/);
  // Both legs broken, she lies where she is, and the medbay comes for her.
  play(game, ["* wound tarrow broken bone on the right leg: The hatch came down", "* wound tarrow broken bone on the left leg: on both legs"]);
  assert.equal(holds(game, "can walk tarrow"), false);
  passTime(game, 0.25, "routine");
  assert.ok(game.down?.[TARROW], "down where she was");
});

test("healing takes the wounds away and gets them up, a lost limb stays lost, and losing one goes on the record", () => {
  const game = newGame();
  body.addWounds(game, TARROW, [wound("deep cut", "chest"), wound("knock", "head")]);
  body.takeLimb(game, TARROW, "left_arm", game.clock.hours);
  assert.match(game.story.record.facts.find((one) => one.id === "tarrow_lost_a_limb").text, /Kara Tarrow lost the left arm on day 1/);
  passTime(game, 0.25, "routine");
  assert.ok(game.down?.[TARROW], "out cold where she fell");
  const said = play(game, ["* heal tarrow: Dr. Aduro worked through the night"]);
  assert.deepEqual(said, ["[HEALTH] Kara Tarrow is well again: Dr. Aduro worked through the night"]);
  const left = body.woundsNow(game, TARROW);
  assert.deepEqual(left.map((one) => one.kind), ["lost"], "the arm doesn't grow back");
  assert.equal(left[0].dressed, true);
  assert.equal(body.bloodOf(game, TARROW), 100);
  assert.equal(game.flags.tarrow_healed, true);
  assert.equal(holds(game, "can walk tarrow"), true);
  passTime(game, 0.25, "routine");
  assert.ok(!game.down?.[TARROW] || game.down[TARROW].going, "she gets up");
  // One kind of wound only.
  body.catchIllness(game, BAO, "cough", game.clock.hours);
  body.addWounds(game, BAO, [wound("bruise", "chest")]);
  play(game, ["* heal mess hand bao cough: The steam helped"]);
  assert.deepEqual(body.woundsNow(game, BAO).map((one) => one.kind), ["bruise"]);
  assert.match(parseEffect("heal tarrow: x").do.command, /heal/);
  assert.match(parseEffect("heal tarrow sore feelings: x").problem, /heal is written/);
});

test("a story's death: they fall where they stand, the record and the names have it, and the player can't die", () => {
  const game = newGame();
  passTime(game, 0.1, "routine");
  const said = play(game, ["* dies tarrow: of her wounds, before anyone came"]);
  assert.ok(said.some((one) => one === "[HEALTH] Kara Tarrow dies, of her wounds, before anyone came."), said.join("\n"));
  assert.equal(game.dead[TARROW].cause, "of her wounds, before anyone came");
  assert.equal(game.down[TARROW].dead, true, "under a blanket where she stood, until she's carried away");
  assert.equal(holds(game, "dead tarrow"), true);
  assert.equal(holds(game, "can walk tarrow"), false);
  assert.equal(holds(game, "dead any"), true);
  assert.match(game.story.record.facts.find((one) => one.id === "tarrow_died").text, /Kara Tarrow died on day 1, of her wounds, before anyone came/);
  assert.equal(game.story.record.facts.find((one) => one.id === "tarrow_died").from, "the story");
  assert.match(readNames(game, "meridian", { name: "The chalked names" }), /Kara Tarrow/);
  assert.match(parseEffect("dies you: x").problem, /you can't die/);
  assert.match(parseEffect("dies tarrow").problem, /how it happened/);
});

test("the checker knows the facts all this leaves, and a scene written with it is sound", () => {
  const known = factsLeft(loadScenes().scenes);
  for (const name of ["tarrow_wounded", "tarrow_healed", "tarrow_lost_a_limb", "tarrow_died", "you_wounded", "you_lost_a_limb", "mess_hand_bao_healed", "quill_wounded"]) assert.ok(known.has(name), name);
  const text = ["# A test", "", "== start", "? laid up tarrow -> visit", "? can't walk tarrow -> carry", "@Marrow: \"She's fine.\"", "> Shake her hand -> done", "",
    "== visit", "@Marrow: \"Go easy.\"", "* heal tarrow: rest", "END", "", "== carry", "You get her over your shoulder.", "* wound you bruise on the chest: She's heavier than she looks", "END", "",
    "== done", "? flag tarrow_wounded -> visit", "She nods.", "END"].join("\n");
  const { scene, problems } = parseSceneText(text, "t.txt");
  assert.deepEqual(problems, []);
  assert.deepEqual(sceneProblems(scene, "t"), []);
  // What the reader catches and what the checker does: a death for the player, and a walk nobody is asked about.
  const bad = parseSceneText(["# B", "", "== start", "? can walk any -> start", "Nothing.", "* dies you: nothing", "END"].join("\n"), "b.txt");
  const said = [...bad.problems.map((one) => one.message ?? String(one)), ...sceneProblems(bad.scene, "b")].join("\n");
  assert.match(said, /you can't die/);
  assert.match(said, /doesn't say who/);
});

test("Tarrow's answer to how she's doing follows how she is", () => {
  const ask = (game) => {
    game.talk = { id: 1, key: "tarrow", personId: "tarrow", name: WORLD_CHARACTERS.tarrow.name, short: "Tarrow", where: "Security", doing: null, log: [], lastReply: null, said: 0, told: [], unheard: [] };
    openWrittenTalk(game);
    const said = [];
    writtenTalkTurn({ game, playerText: "Ask how she's doing", emit: (e) => { if (e.text) said.push(e.text); } });
    game.talk = null;
    return said.join("\n");
  };
  assert.match(ask(newGame()), /Thank you for asking/);
  const scratched = newGame();
  body.addWounds(scratched, TARROW, [wound("cut", "right_arm")]);
  assert.match(ask(scratched), /A scratch, Captain/);
  const badly = newGame();
  body.addWounds(badly, TARROW, [wound("deep cut", "chest")]);
  assert.match(ask(badly), /It's been seen to/);
  const down = newGame();
  body.addWounds(down, TARROW, [wound("broken bone", "right_leg"), wound("broken bone", "left_leg")]);
  assert.match(ask(down), /I can't stand, Captain/);
  const laidUp = newGame();
  body.addWounds(laidUp, TARROW, [wound("deep cut", "chest")]);
  laidUp.down = { ...laidUp.down, [TARROW]: { who: "tarrow", place: "meridian", level: null, x: 0, y: 0, since: 0, until: 0, why: "laid up", bed: "patient-3" } };
  assert.match(ask(laidUp), /I'm to lie still/);
});

test("the Story board edits the wounds file, the medbay, and a species' body", () => {
  assert.deepEqual(boardWorldList("health").map((one) => one.id), ["wounds", "anselm", "meridian"]);
  const wounds = boardWorldItem("health", "wounds");
  assert.ok(wounds.value.wounds.length > 10 && wounds.lists.parts.length === 6);
  assert.ok(wounds.links.species.some((one) => one.id === "korrun"));
  assert.deepEqual(wounds.problems, []);
  // A bruise that lasts three days, saved and read again.
  const changed = structuredClone(wounds.value);
  changed.wounds = changed.wounds.map((one) => (one.text.startsWith("bruise,") ? { ...one, text: one.text.replace("heals in 2 days", "heals in 3 days") } : one));
  assert.equal(saveBoardWorldItem("health", "wounds", writeWoundsText(changed)).saved, true);
  assert.equal(body.woundKindsByName("bruise")[0].heals, 3);
  // A line that doesn't read is saved as it is, as on the other pages, and the checker names it; the board's own box
  // won't keep one.
  const odd = saveBoardWorldItem("health", "wounds", writeWoundsText({ ...changed, wounds: [...changed.wounds, { text: "nonsense without a colon" }] }));
  assert.equal(odd.saved, true);
  assert.ok(odd.problems.some((one) => /^health\/wounds\.txt \(line \d+\)/.test(one)), odd.problems.join("\n"));
  assert.equal(saveBoardWorldItem("health", "wounds", writeWoundsText(changed)).problems.length, 0);
  // A file with no name line doesn't read, and isn't saved.
  const refused = saveBoardWorldItem("health", "meridian", "cots: patient-1\n");
  assert.equal(refused.saved, false);
  // The medbay: a cut takes a quarter of an hour now.
  const medbay = boardWorldItem("health", "meridian");
  assert.equal(medbay.links.place.id, "meridian");
  const slower = structuredClone(medbay.value);
  slower.treatments = slower.treatments.map((one) => (one.text.startsWith("cut:") ? { ...one, text: "cut: 1 dose, 15 minutes" } : one));
  assert.equal(saveBoardWorldItem("health", "meridian", writeHealthText(slower)).saved, true);
  assert.equal(medbayOf("meridian").treatments.find((one) => one.name === "cut").minutes, 15);
  assert.throws(() => boardWorldItem("health", "nowhere"), /no health file called nowhere/);
  // A species' body: Korrun bones break still less often.
  const korrun = boardWorldItem("species", "korrun");
  const sturdier = structuredClone(korrun.value);
  sturdier.body = { ...(sturdier.body ?? {}), breaks: 0.4 };
  assert.equal(saveBoardWorldItem("species", "korrun", writeWorldText(sturdier, SPECIES_SPEC)).saved, true);
  assert.equal(body.speciesBody("korrun").breaks, 0.4);
});
