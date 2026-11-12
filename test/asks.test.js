// Questions and asks for everyone (the hands-on plan, step 3): anyone without written lines answers from what the
// game knows right now, walks with the player when asked and willing, and goes to the medbay now when told to.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-asks-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const asks = await import("../src/asks.js");
const body = await import("../src/body.js");
const { startCombat } = await import("../src/combat.js");
const { jobsOf, postOf } = await import("../src/command.js");
const { logisticsOf } = await import("../src/logistics.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const talks = await import("../src/talks.js");
const walk = await import("../src/walk.js");

const newGame = (start = "captain") => {
  const draft = randomDraft({ seed: 21, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walk.walkCommand(game, { action: "room", to: room });
};
const toHour = (game, hour) => passTime(game, (((hour - (game.clock.hours % 24)) % 24) + 24) % 24 || 24, "rest");
const people = (game) => walk.walkView(game).people;
const person = (game, key) => people(game).find((one) => one.key === key);
const acts = (game, key) => (person(game, key)?.acts ?? []).map((one) => one.label);
const wound = (name, part) => body.newWound(body.woundKindsByName(name).find((kind) => kind.parts.includes(part)), part);
const setKettle = (game, n) => { game.stores ??= {}; game.stores[logisticsOf("meridian").stores.find((one) => one.id === "soup_kettle").key] = { count: n }; };
// Someone awake in the player's room who does a job, by the job's id.
const oneOf = (game, room, job) => people(game).find((one) => one.room === room && !one.asleep && jobsOf(game, "meridian")[one.key] === job);
function talkTo(game, key) {
  walk.talkCommand(game, { action: "open", person: key });
  talks.openWrittenTalk(game);
  return game.talk.written.stock.parts.start.choices.map((one) => one.say);
}
function say(game, words) {
  const said = [];
  talks.writtenTalkTurn({ game, playerText: words, emit: (e) => { if (e.type === "text") said.push(e.text); } });
  return said.join("\n");
}
const closeTalk = (game) => walk.talkCommand(game, { action: "close" });

test("the file reads, and says which names and which words in braces it doesn't know", () => {
  const model = asks.parseAsks([
    "Questions:",
    "- job: What do you do?",
    "- weather: Nice day?",
    "Answers:",
    "- job: I'm {a job}, in {room}.",
    "- job: {job}.",
    "- going cook: {n} left.",
    "Come with me:",
    "- yes: \"All right, {name}.\"",
    "- maybe: \"Perhaps.\"",
  ].join("\n"));
  assert.equal(model.questions.job, "What do you do?");
  assert.equal(model.answers.job.length, 2);
  assert.deepEqual(model.problems.map((one) => one.replace(/^world\/asks.txt, /, "")), [
    'line 3: "weather" isn\'t a line the game says under Questions',
    'line 7: {n} isn\'t something the game fills in for "going cook": it has {sittings}',
    'line 10: "maybe" isn\'t a line the game says under Come with me',
  ]);
  assert.deepEqual(asks.asksProblems(), [], "and the game's own file is sound");
});

test("a cook answers from what the game knows: their job, the kettle, where an officer is, the talk, and how they are", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "galley");
  const cook = oneOf(game, "galley", "cook");
  assert.ok(cook, "there's a cook in the galley at ten");
  setKettle(game, 0);
  game.ship.out = { medicine: 2 };
  body.addWounds(game, body.keyAt("meridian", cook.key), [wound("deep cut", "left_arm")]);
  const questions = talkTo(game, cook.key);
  for (const one of ["What do you do aboard?", "How's the work going?", "Where can I find someone?", "What's the talk?", "How are you holding up?"]) assert.ok(questions.includes(one), `${one} is asked: ${questions.join(" | ")}`);
  assert.match(say(game, "What do you do aboard?"), /"(I'm a cook\. The Galley, mostly\.|Cook\. You'll find me in The Galley, when I'm not asleep\.)"/);
  assert.match(say(game, "How's the work going?"), /"(The kettle's empty\. I can't cook what isn't in the pantry\.|We're \d+ short on the watch bill)/);
  assert.match(say(game, "What's the talk?"), /"We're out of medicine\./);
  assert.match(say(game, "How are you holding up?"), /"A deep cut in the left arm\. I've had better weeks\."/);
  // Where someone is leads to names, and a name to where they were last seen; it can be asked again.
  assert.match(say(game, "Where can I find someone?"), /"Who are you after\?"/);
  const names = game.talk.written.stock.parts.where.choices.map((one) => one.say);
  assert.ok(names.length >= 3 && names.at(-1) === "Never mind.", names.join(" | "));
  const first = names[0];
  assert.match(say(game, first), new RegExp(`"${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[?.] `));
  assert.match(say(game, "Where can I find someone?"), /Who are you after/);
  say(game, "Never mind.");
  closeTalk(game);
});

test("the captain asks a cook to come along: they walk with the player, room to room, until told that's all or two hours are up", () => {
  const game = newGame();
  toHour(game, 10);
  inRoom(game, "galley");
  const cook = oneOf(game, "galley", "cook");
  assert.deepEqual(acts(game, cook.key).filter((one) => /Come with me|That's all/.test(one)), ["Come with me"]);
  const { said } = walk.walkCommand(game, { action: "come-along", key: cook.key });
  assert.match(said, /"Captain\." .+ falls in beside you\.\n\[WITH\] .+ is walking with you/);
  assert.equal(game.along.key, cook.key);
  assert.deepEqual(acts(game, cook.key).filter((one) => /Come with me|That's all/.test(one)), ["That's all"]);
  // The player goes to the mess, and a few minutes later the cook is beside them there.
  inRoom(game, "mess");
  for (let i = 0; i < 12; i += 1) clockRuns(game, 1);
  const me = walk.walkView(game).you ?? game.walk;
  const them = person(game, cook.key);
  assert.ok(them, "they're on the same deck");
  assert.ok(Math.abs(them.x - game.walk.x) + Math.abs(them.y - game.walk.y) <= 3, `beside the player: ${them.x},${them.y} against ${game.walk.x},${game.walk.y} (${them.doing})`);
  assert.equal(them.doing, "walking with you");
  assert.ok(me);
  // That's all, and they go back to their day.
  assert.match(walk.walkCommand(game, { action: "thats-all", key: cook.key }).said, /"Right\. I'll get back to it, then\."/);
  assert.equal(game.along, null);
  // Asked again, they come, and after two hours they go by themselves.
  walk.walkCommand(game, { action: "come-along", key: cook.key });
  const notes = passTime(game, 2.1, "active");
  assert.ok(notes.some((one) => /^\[WITH\] .+ goes back to their day\.$/.test(one)), notes.join(" | "));
  assert.equal(game.along, null);
});

test("who says no: someone asleep, an officer to a crewman, another job's people; one's own job says yes", () => {
  const game = newGame("engine_hand");
  toHour(game, 10);
  inRoom(game, "engineering");
  const tech = oneOf(game, "engineering", "tech");
  assert.ok(tech, "another tech is in engineering");
  assert.match(walk.walkCommand(game, { action: "come-along", key: tech.key }).said, /"(All right\. Lead on\.|If you like\. I could use the walk\.)"/);
  walk.walkCommand(game, { action: "thats-all", key: tech.key });
  const officer = people(game).find((one) => one.room === "engineering" && postOf(game, "meridian", one.key));
  if (officer) assert.match(walk.walkCommand(game, { action: "come-along", key: officer.key }).said, /"I've a post to keep\./);
  inRoom(game, "galley");
  const cook = oneOf(game, "galley", "cook");
  assert.match(walk.walkCommand(game, { action: "come-along", key: cook.key }).said, /"Not now\. I've got my hands full\."/);
  assert.equal(game.along, null);
  // In the small hours, in the bunks, nobody stirs.
  toHour(game, 3);
  inRoom(game, "bunks");
  const sleeper = people(game).find((one) => one.asleep);
  assert.ok(sleeper, "someone's asleep in the bunks at three");
  assert.match(walk.walkCommand(game, { action: "come-along", key: sleeper.key }).said, /doesn't stir\.$/);
});

test("someone hurt and on their feet goes to the medbay when told, and is seen without waiting for the morning", () => {
  const game = newGame();
  toHour(game, 13);
  inRoom(game, "galley");
  const cook = oneOf(game, "galley", "cook");
  const key = body.keyAt("meridian", cook.key);
  assert.ok(!acts(game, cook.key).includes("Go to the medbay"), "nobody well is sent");
  body.addWounds(game, key, [wound("deep cut", "left_arm")]);
  assert.ok(acts(game, cook.key).includes("Go to the medbay"));
  assert.match(walk.walkCommand(game, { action: "send-medbay", key: cook.key }).said, /"You're right\. I'll go now\."/);
  assert.ok(game.sent[key]);
  assert.ok(!acts(game, cook.key).includes("Go to the medbay"), "once is enough");
  // Three hours on, in the afternoon, long after the morning queue: the cut's been seen to, and they're back at work.
  for (let i = 0; i < 18; i += 1) passTime(game, 1 / 6, "active");
  assert.ok(body.woundsNow(game, key).every((one) => one.dressed), "the medbay dressed it");
  assert.deepEqual(game.sent, {});
});

test("someone walking with the player who can fight stands with them", () => {
  const game = newGame();
  toHour(game, 10);
  // Tarrow has a fight of her own in her file; wherever she is at ten, the captain finds her.
  const map = walk.mapFor("meridian");
  const room = Object.keys(map.rooms).find((id) => {
    inRoom(game, id);
    return people(game).some((one) => one.key === "tarrow" && one.room === id);
  });
  assert.ok(room, "Tarrow's aboard");
  const said = walk.walkCommand(game, { action: "come-along", key: "tarrow" }).said;
  if (!/falls in beside you/.test(said)) return;
  assert.equal(game.along.fights, true);
  startCombat(game, "dock_thug");
  assert.deepEqual(game.combat.allies.map((one) => one.named), [true]);
});
