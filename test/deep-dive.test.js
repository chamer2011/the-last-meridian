// Where the game's systems meet: what a deep check of fights in the room, bodies and wounds, the medbay, requests, the
// chain of command and the ship's stores found on 2026-11-11, each kept from coming back. They were found by playing
// whole games over the real server for weeks of game time, and on screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-deep-dive-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const rules = await import("../src/rules.js");
const body = await import("../src/body.js");
const medbay = await import("../src/medbay.js");
const requests = await import("../src/requests.js");
const { stockTalk } = await import("../src/talks.js");
const { walkCommand, walkOf, walkView } = await import("../src/walk.js");
const { findCharacter } = await import("../src/campaign.js");
const { publicState, passTime, clockRuns, combatAction, startCombat, fxSum, travel } = rules;

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  if (start !== "captain") draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  return game;
};
const workOf = (run) => {
  const started = process.cpuUsage();
  run();
  const used = process.cpuUsage(started);
  return (used.user + used.system) / 1000;
};
// A wound of a kind the wounds file has, on a part.
const wound = (kind, part) => body.newWound(body.kindOf(kind, part), part);
// Someone on the bridge laid out where they stand, as a fight leaves them.
function knockDown(game, key) {
  walkOf(game);
  const person = walkView(game).people.find((one) => one.key === key);
  assert.ok(person, `${key} is on the deck`);
  assert.ok(medbay.fallDown(game, { who: key, place: game.location, level: game.walk.level, x: person.x, y: person.y, why: "out cold", hours: 4 }));
  return body.keyAt(game.location, key);
}

test("the player's body is made up once, so asking for their numbers thousands of times costs nothing", () => {
  // Every number the player has asks what their wounds do to it, and that asked for their whole body, made from
  // scratch each time: a fight's every blow, every screen and every hour of a long wait paid for it dozens of times.
  const game = newGame();
  const one = body.bodyOf(game, "you");
  const two = body.bodyOf(game, "you");
  assert.deepEqual(one, two, "the same body each time");
  assert.notEqual(one.marks, two.marks, "and a copy each time, so nothing added to one shows on the next");
  one.marks.push({ part: "head", words: "a mark that isn't theirs" });
  assert.deepEqual(body.bodyOf(game, "you"), two);
  // A different life is a different body.
  assert.notDeepEqual(body.bodyOf(newGame("captain", 22), "you").marks, two.marks);
  const took = workOf(() => { for (let i = 0; i < 20000; i += 1) fxSum(game, "attack"); });
  assert.ok(took < 500, `20,000 reads of the player's attack took ${Math.round(took)} ms of work`);
});

test("a wound still tells on the player's numbers, and comes off them when it's gone", () => {
  const game = newGame();
  const before = fxSum(game, "attack");
  body.addWounds(game, "you", [wound("broken_bone", "right_arm")]);
  assert.equal(fxSum(game, "attack"), before - 2, "a broken arm takes 2 off attacking");
  game.wounds = [];
  assert.equal(fxSum(game, "attack"), before);
});

test("a rest of any length leaves health and energy whole numbers", () => {
  // Someone carried to the medbay is out for an hour and a bit, and health once came back as 14.039513401015725.
  const game = newGame();
  game.hp = 10;
  game.energy = 2;
  passTime(game, 1.37, "rest");
  assert.ok(Number.isInteger(game.hp) && game.hp > 10, `health ${game.hp}`);
  assert.ok(Number.isInteger(game.energy), `energy ${game.energy}`);
  passTime(game, 8, "rest");
  assert.ok(Number.isInteger(game.hp) && Number.isInteger(game.energy));
});

test("losing a fight aboard: the player wakes in the medbay with whole numbers, and what the hours brought is kept in the story", () => {
  // A new game, before the player has walked a step: they're carried to the medbay all the same.
  const game = newGame();
  assert.equal(game.walk, null);
  startCombat(game, "dock_thug");
  game.hp = 1;
  game.combat.enemies[0].attack = 60;
  let outcome;
  for (let i = 0; i < 40 && game.combat; i += 1) outcome = combatAction(game, { type: "attack" });
  assert.equal(outcome.result, "defeat");
  assert.match(outcome.summary, /came to in the medbay/);
  assert.ok(Number.isInteger(game.hp) && game.hp >= 1, `health ${game.hp}`);
  assert.equal(publicState(game).walk.here.id, "medbay");
  // How they came to is told in the fight; anything tagged that the clock brought meanwhile is a note for the story.
  const told = outcome.events.filter((event) => event.text).map((event) => event.text);
  assert.ok(told.some((line) => /^You come to on a cot/.test(line)));
  assert.ok(!told.some((line) => /^\[[A-Z]+\]/.test(line)), "no tagged line is only in the fight's own window");
  assert.ok(outcome.notes.every((line) => typeof line === "string"));
});

test("nobody lying down is fought or robbed, and nobody lying where they fell has something to ask", () => {
  const game = newGame();
  const key = knockDown(game, "pell");
  assert.throws(() => walkCommand(game, { action: "attack", key: "pell" }), /down already/);
  assert.throws(() => walkCommand(game, { action: "pickpocket", key: "pell" }), /lying there/);
  assert.equal(game.combat, null);
  assert.equal(game.check, null);
  game.down[key].dead = true;
  assert.throws(() => walkCommand(game, { action: "attack", key: "pell" }), /They're dead/);
  // Someone with something to ask keeps it to themselves while they lie where they fell, and asks again from a cot.
  const asking = newGame();
  asking.requests = { open: { fuel: { kind: "fuel", asker: "voss", at: asking.clock.hours, place: "meridian", state: "offered" } }, rest: {}, asked: {}, n: 0 };
  assert.equal(requests.asksNow(asking, "voss"), true);
  const voss = knockDown(asking, "voss");
  assert.equal(requests.asksNow(asking, "voss"), false);
  assert.ok(!walkView(asking).people.find((one) => one.key === "voss").asks);
  asking.down[voss].bed = medbay.medbayOf("meridian").cots[0];
  assert.equal(requests.asksNow(asking, "voss"), true, "laid up on a cot, they can be asked what they wanted");
  delete asking.down[voss];
  assert.equal(requests.asksNow(asking, "voss"), true);
});

test("stock lines start with a capital, only the captain is called Captain, and nobody asleep says what they're up to", () => {
  const names = ["Mess Hand Bao", "Cook Imre", "Tech Oona", "Deckhand Kofi", "Salome", "Yusuf", "Ayla", "Teo", "Petra", "Emeka"];
  const talkWith = (name, extra = {}) => ({ name, short: name.split(" ").at(-1), personId: null, doing: "clearing tables", asleep: false, ...extra });
  const captain = newGame();
  const hand = newGame("engine_hand");
  let called = 0;
  for (const name of names) {
    for (const game of [captain, hand]) game.contacts.push({ name, attitude: "friendly", note: "" });
    if (/Captain/.test(stockTalk(captain, talkWith(name)).parts.start.text[0])) called += 1;
    const said = stockTalk(hand, talkWith(name));
    assert.doesNotMatch(said.parts.start.text[0], /captain/i, `${name} to an engine hand`);
    assert.match(said.parts.doing.text[0], /: "[A-Z]/, said.parts.doing.text[0]);
    assert.equal(stockTalk(hand, talkWith(name, { asleep: true })).parts.doing, undefined, "asleep, they aren't asked");
  }
  assert.ok(called > 0, "the captain is still called Captain by some");
});

test("a cook waiting for the garden to grow isn't an errand left waiting, so the deck chief keeps his post through a quiet month", () => {
  // The produce is eaten as fast as it grows, so the cook's errand stands waiting at the garden bins most days. That
  // counted against the deck chief, who was warned on day 11 and relieved on day 14 of every game.
  const game = newGame("orderly");
  const said = [];
  for (let day = 0; day < 30; day += 1) said.push(...passTime(game, 24, "routine"));
  assert.ok(!said.some((line) => /errands left waiting/.test(line)), said.filter((line) => /COMMAND/.test(line)).join(" | "));
  const chief = publicState(game).command.groups.flatMap((group) => group.posts).find((post) => post.id === "deck_chief");
  assert.equal(chief.holder.key, "tobin");
  assert.ok(chief.duty.score === null || chief.duty.score >= 90, `the deck chief's duty is ${chief.duty.score}`);
});

test("someone here asks for a word with the player's boss only where that boss is", () => {
  // A porter from Anselm's Mercy visiting the Meridian was asked by one of her ensigns to get them a word with a doctor
  // on another ship.
  const game = newGame("porter");
  assert.equal(game.location, "anselm");
  travel(game, "meridian");
  for (let hour = 0; hour < 24 * 8; hour += 1) {
    passTime(game, 1, "routine");
    assert.equal(game.requests?.open?.word_for_boss, undefined, `asked aboard the Meridian on day ${Math.floor(game.clock.hours / 24)}`);
  }
});

test("the top bar's numbers: wounds count as hurt, and bleeding says how much blood is left, until the wound's dressed", () => {
  const game = newGame();
  assert.equal(publicState(game).hurt, 0);
  assert.equal(publicState(game).bleeding, null);
  body.addWounds(game, "you", [wound("deep_cut", "left_leg")]);
  const shown = publicState(game);
  assert.equal(shown.hurt, 1);
  assert.ok(shown.bleeding.rate > 0 && shown.bleeding.blood === 100, JSON.stringify(shown.bleeding));
  // The story says once when they've lost a lot of it, and it stops where the wounds file says, for the player.
  const said = [];
  for (let hour = 0; hour < 12; hour += 1) said.push(...passTime(game, 1));
  assert.equal(said.filter((line) => /lost a lot of blood/.test(line)).length, 1, said.join(" | "));
  assert.ok(publicState(game).bleeding.blood < 60);
  assert.ok(Number.isFinite(game.blood) && game.blood >= 0);
  // A medkit dresses it, and the bleeding's over.
  game.inventory.medkit = Math.max(1, game.inventory.medkit ?? 0);
  rules.useItem(game, "medkit");
  assert.equal(publicState(game).bleeding, null);
  assert.equal(publicState(game).hurt, 1, "dressed, it's still a wound until it heals");
});

test("someone's file is found by its id straight away, by any of their names, and the campaign's own file comes first", () => {
  assert.equal(findCharacter(null, "marrow").id, "marrow");
  assert.equal(findCharacter(null, "Dunn Marrow").id, "marrow");
  assert.equal(findCharacter(null, "MARROW").id, "marrow");
  assert.equal(findCharacter(null, "Tech Oona"), null, "someone with only a name has no file");
  assert.equal(findCharacter(null, ""), null);
});

test("the clock runs through a whole day and night with someone down, someone asking and a wound open, and showing it changes nothing", () => {
  const game = newGame();
  knockDown(game, "lira");
  body.addWounds(game, "you", [wound("cut", "chest")]);
  for (let i = 0; i < 144; i += 1) {
    assert.doesNotThrow(() => clockRuns(game, 10));
    if (i % 12 === 0) {
      const before = JSON.stringify(game);
      const shown = publicState(game);
      assert.equal(JSON.stringify(game), before, "showing the game changes nothing");
      assert.ok(Number.isInteger(shown.hp) && Number.isInteger(shown.energy));
    }
  }
});

// ---- Round three: what forty-day games played by a brawler, and the mutiny played every way, found ---------------

const cmd = await import("../src/command.js");
const death = await import("../src/death.js");
const { writtenTurn } = await import("../src/scenes.js");
// Plays a turn of the written story and gives what it said and the notes it left, in order.
const storyTurn = (game, event, playerText = "") => {
  const out = [];
  writtenTurn({ game, event, playerText, emit: (e) => { if (e.text) out.push(e.text); }, log: () => {} });
  return out;
};

test("someone who dies in the player's arms is still carried and still seen, and anyone with a file lies where they died until they're carried away", () => {
  // A helm officer beaten, picked up and bled out on the way vanished from the room, and the player was left carrying
  // someone nobody could see. Anyone with a file vanished the moment they died, while a nurse came for a body that
  // wasn't there.
  const game = newGame();
  const key = knockDown(game, "pell");
  walkCommand(game, { action: "carry", key: "pell" });
  const said = death.die(game, key, { cause: "bled" });
  assert.match(said[0], /Pell Asante dies, bled to death in your arms/);
  let seen = walkView(game).people.find((one) => one.key === "pell");
  assert.ok(seen?.dead && seen.carried === "you", JSON.stringify(seen ?? null));
  assert.equal(walkView(game).carrying.key, "pell");
  clockRuns(game, 5);
  walkCommand(game, { action: "putdown" });
  seen = walkView(game).people.find((one) => one.key === "pell");
  assert.ok(seen?.dead && !seen.carried, "put down, they lie there under a blanket");
  assert.match(seen.downLook, /Dead, under a blanket\. They bled to death in your arms\./);
  assert.ok(!game.carrying);
  // Someone with a file who dies where they fell lies there too, like anyone else, until they're carried away.
  const other = newGame();
  const lira = knockDown(other, "lira");
  assert.match(death.die(other, lira, { cause: "bled" })[0], /bled to death where they fell/);
  assert.ok(walkView(other).people.find((one) => one.key === "lira")?.dead);
  for (let hour = 0; hour < 12 && walkView(other).people.some((one) => one.key === "lira"); hour += 1) passTime(other, 1, "routine");
  assert.equal(walkView(other).people.find((one) => one.key === "lira"), undefined, "carried to where the dead are laid out, within the day");
  assert.ok(other.dead[lira]);
});

test("officers left waiting for an answer keep whoever speaks for them, and what's told comes in the order it happened", () => {
  // The captain hears the delegation out, leaves it unanswered and puts things right first. The choices still on offer
  // then happened to nobody: stepping down gave the chair to no one, and the fight was with "someone".
  const game = newGame();
  const state = game.command.meridian;
  game.ship.morale = 5;
  state.loyalty = {};
  for (const post of cmd.commandOf("meridian").posts) {
    const holder = cmd.holderKey(game, "meridian", post.id);
    if (holder && holder !== "you") state.loyalty[holder] = { rations: -20, hunger: -20, morale: -10 };
  }
  state.mutiny = { pressure: 6, stage: 2, ringleader: null, due: null, calmUntil: 0 };
  passTime(game, 24, "routine");
  assert.equal(cmd.commandSceneDue(game), "command_delegation");
  const leader = state.mutiny.ringleader;
  assert.ok(leader);
  storyTurn(game, "continue");
  assert.equal(game.scene.id, "command_delegation");
  // Things ease before the captain answers.
  game.ship.morale = 70;
  state.loyalty = {};
  passTime(game, 24, "routine");
  assert.ok(state.mutiny.stage < 3, `stage ${state.mutiny.stage}`);
  assert.equal(state.mutiny.ringleader, leader, "they still have someone to speak for them");
  const demands = storyTurn(game, "", "Hear them out").join("\n");
  const stepDown = demands.match(/> (Step down, and let .+ have the chair)/)?.[1];
  assert.ok(stepDown && !/someone/.test(stepDown), demands);
  const told = storyTurn(game, "", stepDown);
  assert.equal(game.ship.chair?.id, leader);
  assert.equal(publicState(game).role.captain, false);
  const stepped = told.findIndex((line) => /You've stepped down/.test(line));
  const filled = told.findIndex((line) => /has made .+ chief of security/.test(line));
  assert.ok(stepped >= 0 && filled >= 0, told.join(" | "));
  assert.ok(stepped < filled, "what happened comes first, then who was moved because of it");
  // Once it's answered and things are calm, nobody leads anything.
  assert.equal(state.mutiny.ringleader, null);
});

const lg = await import("../src/logistics.js");

test("a request taken on carries on with whoever takes the asker's place, and is over, without a word from the dead, when nobody does", () => {
  // A chief engineer who'd asked the captain for parts died, nobody was given the post, and five days later the dead
  // man told the captain off for letting him down.
  const takeOn = (game) => {
    lg.takeAboard(game, "meridian", "medicine_crate", lg.countAboard(game, "meridian", "medicine_crate").n - 1);
    game.clock.hours = 10.5;
    clockRuns(game, 1);
    assert.equal(game.requests.open.medicine?.asker, "aduro");
    requests.answerRequest(game, "medicine", "yes");
    assert.equal(game.requests.open.medicine.state, "accepted");
  };
  // The first officer fills the dead doctor's post, and it's the new doctor the medicine is for now.
  const game = newGame();
  takeOn(game);
  death.die(game, "id:aduro", { cause: "bled" });
  let said = passTime(game, 1);
  assert.ok(game.requests.open.medicine && game.requests.open.medicine.asker !== "aduro", JSON.stringify(game.requests.open.medicine ?? null));
  assert.ok(!said.some((line) => /\[REQUEST\] Over/.test(line)), said.join(" | "));
  // With nobody keeping the watch bill, the post stays empty, and the request is over with the doctor.
  const other = newGame();
  takeOn(other);
  death.die(other, "id:voss", { cause: "bled" });
  death.die(other, "id:aduro", { cause: "bled" });
  said = passTime(other, 1);
  assert.equal(other.requests.open.medicine, undefined);
  assert.ok(said.some((line) => /^\[REQUEST\] Over: .+ is dead, and nobody else is asking\.$/.test(line)), said.join(" | "));
  assert.equal(other.quests.find((one) => one.request).status, "failed");
  for (let day = 0; day < 6; day += 1) said.push(...passTime(other, 24, "routine"));
  assert.ok(!said.some((line) => /Aduro: "/.test(line)), said.filter((line) => /Aduro/.test(line)).join(" | "));
});

test("a scene's choices come up as soon as its last words are written, without waiting for something else to redraw the room", () => {
  // An answer that led straight to more choices left only the reply on screen: the page drew the choices only once the
  // words were all written, and nothing drew it again when they were. Seen with the officers' delegation, where "Hear
  // them out" was followed by nothing to click.
  const popups = fs.readFileSync(new URL("../public/popups.js", import.meta.url), "utf8");
  const pen = popups.slice(popups.indexOf("const pen = newPen({"), popups.indexOf("export function initPopups"));
  assert.match(pen, /pop\.words\?\.show\(count\);/);
  assert.match(pen, /if \(!pen\.busy && pop\.open && !document\.getElementById\("pop-answer"\) && choicesNow\(\)\.length\) drawScene\(\);/);
  // The talk window has always done the same for its own choices.
  const talk = fs.readFileSync(new URL("../public/talk.js", import.meta.url), "utf8");
  assert.match(talk, /if \(!pen\.busy && !talk\.sending\) written\(\);/);
});

test("a long wait passes a day at a time, so it comes out the same however it's cut up", () => {
  // The medbay, the wounds and the doctor's rounds each look once, at the end of the time they're given. Four days in
  // one go used to leave Vik and Hana on their cots, treated on the first morning and never looked at again, while four
  // single days let them go; and over seventy days the medicine used differed enough, about one game in ten, that
  // whoever had the chair bought differently and the ship ended up somewhere else.
  const docker = (bodySeed) => {
    const game = newGame("docker");
    game.bodySeed = bodySeed;
    return game;
  };
  // Whatever two new games don't share to begin with (when they were made, say) isn't what's being compared.
  const fresh = [docker(1), docker(1)];
  const compared = Object.keys(fresh[0]).filter((key) => JSON.stringify(fresh[0][key]) === JSON.stringify(fresh[1][key]));
  assert.ok(["ship", "down", "medbay", "bodies", "logistics", "world", "command"].every((key) => compared.includes(key) || !(key in fresh[0])), compared.join(", "));
  const differing = (a, b) => compared.filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
  // 3271021635 is a seed that parted on the fourth day.
  for (const bodySeed of [3271021635, 7, 12345]) {
    const atOnce = docker(bodySeed);
    passTime(atOnce, 24 * 6, "routine");
    const byDay = docker(bodySeed);
    for (let day = 0; day < 6; day += 1) passTime(byDay, 24, "routine");
    assert.deepEqual(differing(atOnce, byDay), [], `six days, seed ${bodySeed}`);
  }
  // A wait that isn't a whole number of days is its whole days and then what's left.
  const atOnce = docker(7);
  passTime(atOnce, 60, "routine");
  const pieces = docker(7);
  for (const hours of [24, 24, 12]) passTime(pieces, hours, "routine");
  assert.deepEqual(differing(atOnce, pieces), []);
  assert.equal(atOnce.clock.hours, pieces.clock.hours);
  // And a day or less is one piece, as it always was.
  const short = docker(7);
  const before = short.clock.hours;
  passTime(short, 24, "routine");
  assert.equal(short.clock.hours, before + 24);
});
