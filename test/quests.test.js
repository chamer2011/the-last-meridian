// The story goes on with the people it needs: a part waits until the player is in the same room as whoever speaks last
// in it, and goes on only when they talk to them; walking away in the middle puts it on hold; someone it needs who has
// died fails the quest; one story waits its turn while another is played; and the tracker says which, for the quest the
// player follows. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-quests-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { publicState } = await import("../src/rules.js");
const { parseSceneText } = await import("../src/scene-text.js");
const { StoryError, heldUp, partNeed, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { followQuest, questsView } = await import("../src/quests.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { personWhere, walkCommand, walkView } = await import("../src/walk.js");
const { advanceLife } = await import("../src/life.js");

const CREW = "crew_naomi_under_crew";

const newGame = () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  return game;
};
// One turn, the way the server plays it, with what the story says kept in the transcript in order.
function play(game, args) {
  const said = [];
  writtenTurn({
    game,
    emit: (e) => {
      if (e.type === "text") said.push(e.text);
      if (e.type === "notice") game.transcript.push({ role: "notice", text: e.text });
    },
    log: (role, text, tag) => game.transcript.push({ role, text, ...(tag ?? {}) }),
    ...args,
  });
  if (said.length) game.transcript.push({ role: "narrator", text: said.join("") });
  return said.join("");
}
const stepOf = (game, id) => questsView(game).quests.find((quest) => quest.id === id).step;
const goTo = (game, room) => walkCommand(game, { action: "room", to: room });

test("who a part waits for: whoever speaks last in it, unless a WITH: line says someone else or nobody", () => {
  const game = newGame();
  const { scene } = parseSceneText(`== a
@Commander Ilya Voss: "Captain."
@Ensign Pell Asante: "Sir."
> Go on -> b

== b
WITH: Commander Ilya Voss
@Ensign Pell Asante: "Plotted."
END

== c
WITH: nobody
@Ensign Pell Asante: "Plotted."
END

== d
@Sorel [comm]: "Fleet-wide, Captain."
The quiet goes on.
END`);
  assert.equal(partNeed(game, scene.parts.a).person, "pell");
  assert.equal(partNeed(game, scene.parts.b).person, "voss");
  assert.equal(partNeed(game, scene.parts.c), null);
  assert.equal(partNeed(game, scene.parts.d), null, "a voice over the comms isn't someone to go and find");
  const wrong = parseSceneText(`== a\nWITH: Nobody Atall\n@Ensign Pell Asante: "Sir."\nEND`).scene;
  assert.ok(sceneProblems(wrong, "test").some((one) => /WITH: names Nobody Atall/.test(one)), "the checker names someone who isn't in the world");
});

test("a part waits until the player is with whoever it needs, and the tracker says who and where", () => {
  const game = newGame();
  play(game, { playerText: "I look into this", threadId: CREW });
  assert.equal(personWhere(game, "naomi").here, true, "the story begins with Naomi, so she's come over");
  play(game, { playerText: "Ask her what's in Section Fourteen" });
  assert.equal(game.scene.part, "asked", "she's here, so her answer plays at once");
  play(game, { playerText: "Ask Chief Marrow about the hull work first" });
  assert.equal(game.scene.told, false, "Marrow's part waits for Marrow");
  assert.equal(game.scene.with, "marrow");
  let step = stepOf(game, CREW);
  assert.equal(step.state, "go");
  assert.equal(step.text, "Talk to Chief Engineer Dunn Marrow");
  assert.equal(step.where, "He's at Engineering.");
  assert.throws(() => play(game, { playerText: "Go down through the Cold Elbow" }), (err) => err instanceof StoryError && /talk to Chief Engineer Dunn Marrow, at Engineering/.test(err.message));
  assert.throws(() => play(game, { event: "meet", person: "marrow" }), /at Engineering/, "he isn't here to talk to");
  goTo(game, "engineering");
  step = stepOf(game, CREW);
  assert.equal(step.state, "here");
  const met = play(game, { event: "meet", person: "marrow" });
  assert.match(met, /@Chief Engineer Dunn Marrow: "Fourteen\?/);
  assert.equal(game.scene.part, "marrow_first");
  assert.equal(game.transcript.filter((entry) => entry.role === "player").at(-1).text, "Talk to Chief Engineer Dunn Marrow");
  assert.ok(game.transcript.filter((entry) => entry.scene === `thread_${CREW}`).every((entry) => entry.quest === CREW), "what the story says is marked with its quest");
});

test("walking away in the middle puts a quest on hold, and going back to them picks it up where it was", () => {
  const game = newGame();
  play(game, { event: "start" });
  assert.equal(game.scene.with, "voss");
  assert.equal(stepOf(game, "the_beacon").state, "here");
  goTo(game, "names");
  assert.ok(heldUp(game));
  const step = stepOf(game, "the_beacon");
  assert.equal(step.state, "hold");
  assert.equal(step.where, "You walked away. She's at the Bridge.");
  assert.throws(() => play(game, { playerText: "Say nothing, and listen to it" }), /on hold until you're back with Commander Ilya Voss, at the Bridge/);
  goTo(game, "bridge");
  const again = play(game, { event: "meet", person: "voss" });
  assert.match(again, /^@Commander Ilya Voss: "Captain\." She says it/, "she says her last words again");
  assert.match(again, /> Say nothing, and listen to it/, "and the choices are there as before");
  play(game, { playerText: "Say nothing, and listen to it" });
  assert.equal(game.scene.part, "listen");
});

test("someone a quest is waiting on dies, and the quest fails and can't go on", () => {
  const game = newGame();
  play(game, { playerText: "I look into this", threadId: CREW });
  play(game, { playerText: "Ask her what's in Section Fourteen" });
  goTo(game, "engineering");
  assert.equal(game.scene.with, "naomi", "her answer waits for her, now the player's walked off");
  assert.equal(stepOf(game, CREW).state, "hold");
  const outcome = runTool(game, "note_contact", { name: "Naomi Cass", attitude: "neutral", note: "Lost in a hull breach.", status: "dead" }, newTurnLimits());
  assert.match(outcome.notice, /\[QUEST\] failed: The Downstairs Crew/);
  const quest = game.quests.find((one) => one.id === CREW);
  assert.equal(quest.status, "failed");
  assert.equal(quest.objective, "Naomi Cass is dead, so this can't go on.");
  assert.equal(game.scene, null, "the scene is over");
  assert.equal(stepOf(game, CREW).state, "failed");
  assert.throws(() => play(game, { event: "meet", person: "naomi" }), /Nothing in the story is waiting on Naomi Cass/);
});

test("a story waits its turn while another is played, and talking to its person takes it up again", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "I look into this", threadId: CREW });
  assert.equal(game.scene.id, `thread_${CREW}`);
  assert.equal(game.parked.opening_captain.with, "voss", "the opening waits on Voss");
  assert.equal(stepOf(game, "the_beacon").state, "here", "Voss is right here");
  const back = play(game, { event: "meet", person: "voss" });
  assert.match(back, /Your orders\./);
  assert.equal(game.scene.id, "opening_captain");
  assert.equal(game.parked[`thread_${CREW}`].with, "naomi", "and now the Downstairs Crew waits on Naomi");
  play(game, { playerText: "Tell the fleet the truth: you don't know what the signal is yet" });
  assert.equal(game.scene.part, "truth");
});

test("the tracker follows the main quest until the player picks another, and never one that's over", () => {
  const game = newGame();
  assert.equal(questsView(game).following, "the_beacon");
  followQuest(game, "fuel_for_the_fleet");
  assert.equal(questsView(game).following, "fuel_for_the_fleet");
  assert.equal(stepOf(game, "fuel_for_the_fleet").text, "Secure a fuel supplier for the ship.");
  runTool(game, "update_quest", { id: "fuel_for_the_fleet", status: "completed", objective: "Quill sold the ship her fuel." }, newTurnLimits());
  assert.equal(questsView(game).following, "the_beacon", "a quest that's over isn't followed");
  assert.deepEqual(game.quests.find((one) => one.id === "fuel_for_the_fleet").done, ["Secure a fuel supplier for the ship."], "what it asked before is a step done");
  assert.throws(() => followQuest(game, "fuel_for_the_fleet"), /over/);
  assert.throws(() => followQuest(game, "no_such_quest"), /no quest/);
});

test("whoever a scene is waiting on stays with the player, however long they take", () => {
  const game = newGame();
  play(game, { playerText: "I look into this", threadId: CREW });
  assert.ok(walkView(game).people.some((one) => one.key === "naomi"));
  game.clock.hours += 3;
  advanceLife(game);
  assert.ok(walkView(game).people.some((one) => one.key === "naomi"), "she's still here three hours on");
  play(game, { playerText: "Ask her what's in Section Fourteen" });
  assert.equal(game.scene.part, "asked");
});

test("showing the game, with stories waiting and one on hold, changes nothing in the save", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "I look into this", threadId: CREW });
  goTo(game, "names");
  const before = structuredClone(game);
  const shown = publicState(game);
  assert.deepEqual(game, before);
  assert.ok(shown.questLog.quests.length >= 3);
});
