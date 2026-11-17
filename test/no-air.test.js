// People without air (asked for on 2026-11-16): everyone gets out of a room whose air has gone, on a deck too;
// whoever can't get out (someone lying there, and everyone once no room aboard has good air) passes out after the
// wounds file's time and dies after its second, unless they're carried out or the air comes back; the people on the
// register go the same way; with her air plant stopped the ship breathes reserve air for five days first; an hour
// without power kills nobody; a long wait comes out as its minutes do; at someone else's place its people put the air
// back on soon; a species the line isn't for is spared; and the player doesn't die, for now.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-no-air-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const body = await import("../src/body.js");
const death = await import("../src/death.js");
const { clockRuns, passTime } = await import("../src/rules.js");
const { stillAlive } = await import("../src/command.js");
const logistics = await import("../src/logistics.js");
const { peopleAboard } = await import("../src/life.js");
const medbay = await import("../src/medbay.js");
const { mapFor, useThing, walkCommand, walkView } = await import("../src/walk.js");
const sys = await import("../src/systems.js");
const { parseEffect } = await import("../src/scene-text.js");
const { shipView } = await import("../src/ship.js");
const { registerTable } = await import("../src/register.js");
const { WOUNDS } = await import("../src/world.js");
const health = await import("../public/health-text.js");

// The dice held still: while the clock runs in play a fire or a breach can start by chance, and a fire in Engineering
// can take the air plant with it, which is another test's business. Just under 1 is "it never happens".
Math.random = () => 0.99;

const newGame = (seed = 21, bodySeed = 77) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "captain" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  // People's own times without air come from this, so the same people pass out in the same order every run.
  game.bodySeed = bodySeed;
  return game;
};
const inRoom = (game, room) => {
  game.walk = null;
  walkCommand(game, { action: "room", to: room });
  clockRuns(game, 1);
};
const minutes = (game, n, until = () => false) => {
  const said = [];
  for (let i = 0; i < n && !until(); i += 1) said.push(...(clockRuns(game, 1) ?? []));
  return said;
};
const effect = (game, words) => sys.applySystemsEffect(game, parseEffect(words).do.systems);
// The ship's reserve air used up already, so that what comes after it comes at once: five days of it is its own test.
const RESERVE = 5 * 24 * 60;
const noReserve = (game) => {
  game.systems ??= {};
  game.systems.meridian ??= { at: game.clock.hours, parts: {}, doors: {}, air: {}, alarm: {}, noted: {} };
  game.systems.meridian.reserve = RESERVE;
};
// The air plant off, and nothing in reserve.
const airGone = (game) => {
  effect(game, "air off");
  noReserve(game);
};
const BAO = "crowd:meridian:mess hand bao";
const DECKS = ["deck1", "deck2", "deck3"];
const everyoneAboard = (game) => DECKS.flatMap((level) => peopleAboard(game, "meridian", level).map((one) => ({ ...one, room: mapFor("meridian").levels[level].roomAt(one.x, one.y) })));
const inThe = (game, room) => everyoneAboard(game).filter((one) => one.room === room).map((one) => one.name);
const deadAboard = (game) => death.deadAt(game, "meridian").length;
// Bao, beaten and lying in the mess for hours yet.
const layBaoDown = (game) => {
  const at = game.life.places.meridian["Mess Hand Bao"];
  assert.ok(medbay.fallDown(game, { who: "Mess Hand Bao", place: "meridian", level: at.level, x: at.x, y: at.y, why: "can't get up", hours: 12 }));
};
// The generator with nothing to burn, and nothing coming aboard from nowhere while this runs.
const withoutFuel = (game, run) => {
  const model = logistics.logisticsOf("meridian");
  const refills = model.refills;
  model.refills = [];
  try {
    logistics.takeAboard(game, "meridian", "fuel_cell", 999);
    noReserve(game);
    game.logistics.meridian.machines.generator = { ...(game.logistics.meridian.machines.generator ?? { progress: 0, made: 0, waiting: null }), burning: 0 };
    return run();
  } finally {
    model.refills = refills;
  }
};

test("the wounds file says how long anyone lasts without air, and it reads back", () => {
  const care = health.careOf({});
  assert.deepEqual(care["without air"], { out: [120, 180], dead: [60, 120] });
  assert.deepEqual(care["back in good air"], { minutes: 10, back: 2 });
  assert.deepEqual(health.CARE["without air"].read("out cold after 30 minutes of bad air, dead an hour after that"), { out: [30, 30], dead: [60, 60] });
  assert.match(health.CARE["without air"].read("quickly").problem, /out cold after 2 to 3 hours of bad air, dead 1 to 2 hours after that/);
  assert.match(health.CARE["without air"].read("out cold after 3 to 2 hours of bad air, dead 1 to 2 hours after that").problem, /is written like/);
  assert.match(health.CARE["back in good air"].read("at once").problem, /comes round after 10 minutes/);
  assert.deepEqual(health.readRule("out cold until they can breathe"), { out: "air" });
  const text = fs.readFileSync(new URL("../world/health/wounds.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(text, /^without air: out cold after 2 to 3 hours of bad air, dead 1 to 2 hours after that$/m);
  assert.match(text, /^back in good air: comes round after 10 minutes, and gets their breath back twice as fast as they lost it$/m);
  assert.match(text, /^- no air, the chest: passed out for want of air; out cold until they can breathe$/m);
  const read = health.parseWoundsText(text);
  assert.deepEqual(read.problems, []);
  assert.equal(health.writeWoundsText(read.value), text);
  assert.deepEqual(body.healthProblems(), []);
  // Everyone has their own times, between the file's, and keeps them.
  const game = newGame();
  const times = body.airTimes(game, BAO);
  assert.ok(times.out >= 120 && times.out <= 180 && times.dead >= 60 && times.dead <= 120, JSON.stringify(times));
  assert.deepEqual(body.airTimes(game, BAO), times);
  assert.notDeepEqual(body.airTimes(game, "crowd:meridian:mess hand lotte"), times);
  assert.equal(body.needsAir(game, BAO), true);
  assert.equal(body.speciesNeedsAir("synthetic"), true, "nothing written says a synthetic doesn't");
});

test("everyone leaves a room whose air has gone, the ones at benches and counters too, and nobody's the worse for it", () => {
  const game = newGame();
  inRoom(game, "mess");
  const before = inThe(game, "mess");
  assert.ok(before.length >= 5, `people in the mess to begin with: ${before.join(", ")}`);
  effect(game, "air off in The Long Mess");
  minutes(game, 40);
  assert.ok(sys.airIn(game, "meridian", "mess") < 30);
  assert.deepEqual(inThe(game, "mess"), [], "the mess is empty");
  assert.ok(everyoneAboard(game).some((one) => /getting out of the bad air in the Long Mess/.test(one.doing)), "and they're somewhere they can breathe");
  minutes(game, 4 * 60);
  assert.equal(game.dead, undefined);
  assert.equal(game.systems.meridian.short, undefined, "nobody's gone short of air");
  assert.equal(Object.keys(game.bodies ?? {}).some((key) => body.outForAir(game, key)), false);
});

test("someone lying where the air's gone passes out and then dies of it, with all that follows", () => {
  const game = newGame();
  inRoom(game, "mess");
  sys.setDoor(game, "meridian", "medbay", "locked", { by: "story" });
  layBaoDown(game);
  effect(game, "air off in The Long Mess");
  const times = body.airTimes(game, BAO);
  const morale = game.ship.morale;
  const aboard = game.ship.aboard;
  const began = game.clock.hours;
  const first = minutes(game, 4 * 60, () => body.outForAir(game, BAO));
  assert.ok(first.some((line) => /Mess Hand Bao passes out, here in the Long Mess: there's no air left to breathe/.test(line)), first.filter((line) => /AIR/.test(line)).join(" | "));
  // The air takes a quarter hour or so to go bad, and Bao's own time runs from there.
  const outAfter = (game.clock.hours - began) * 60;
  assert.ok(outAfter >= times.out + 10 && outAfter <= times.out + 25, `passed out after ${outAfter} minutes, with ${times.out} of bad air to last`);
  assert.deepEqual(inThe(game, "mess"), ["Mess Hand Bao"], "everyone else got out");
  const lying = walkView(game).people.find((one) => one.key === "Mess Hand Bao");
  assert.equal(lying.down, true);
  assert.match(lying.marks ?? "", /passed out for want of air/i);
  assert.equal(body.cantGetUp(game, BAO), "out cold");
  assert.equal(game.dead, undefined);
  const then = minutes(game, 3 * 60, () => game.dead?.[BAO]);
  assert.ok(then.some((line) => /Mess Hand Bao dies, suffocated in the Long Mess/.test(line)), then.filter((line) => /HEALTH|AIR/.test(line)).join(" | "));
  const deadAfter = (game.clock.hours - began) * 60;
  assert.ok(deadAfter >= times.out + times.dead + 10 && deadAfter <= times.out + times.dead + 25, `died after ${deadAfter} minutes, with ${times.out + times.dead} to last`);
  assert.equal(game.dead[BAO].cause, "suffocated in the Long Mess");
  // On the record, off the roster, one less aboard, morale down; and the body lies under a blanket.
  assert.equal(game.flags.mess_hand_bao_died, true);
  assert.equal(stillAlive(game, "Mess Hand Bao"), false);
  assert.equal(game.ship.aboard, aboard - 1);
  assert.equal(game.ship.morale, morale - 3);
  assert.match(walkView(game).people.find((one) => one.key === "Mess Hand Bao").downLook, /^Dead, under a blanket\. They suffocated in the Long Mess\./);
  assert.equal(game.systems.meridian.short, undefined, "and nothing more is counted for them");
  // The name goes up, and the Ship menu's medbay has it.
  inRoom(game, "names");
  const names = walkView(game).things.find((thing) => thing.name === "The chalked names");
  assert.match(useThing(game, names.id).said, /- Mess Hand Bao, day 1: suffocated in the Long Mess\./);
  assert.deepEqual(shipView(game).medbay.dead, [{ name: "Mess Hand Bao", day: 1, cause: "suffocated in the Long Mess" }]);
  // The player stood in it for the first hours and is alive: bad air stops at 1 health, for now.
  assert.ok(game.hp >= 1);
});

test("carried out in time by the medics, nobody passes out", () => {
  const game = newGame();
  inRoom(game, "mess");
  layBaoDown(game);
  effect(game, "air off in The Long Mess");
  const said = minutes(game, 5 * 60);
  assert.ok(said.some((line) => /lays Mess Hand Bao on a cot in the medbay/.test(line)), said.filter((line) => /HEALTH/.test(line)).join(" | "));
  assert.equal(game.dead, undefined);
  assert.equal(body.outForAir(game, BAO), null);
  assert.equal(game.systems.meridian.short, undefined, "what Bao went without is made up");
});

test("once the air's back, whoever passed out comes round, and nobody's died", () => {
  const game = newGame();
  inRoom(game, "mess");
  airGone(game);
  const said = minutes(game, 165);
  assert.ok(said.some((line) => /There's no good air left anywhere aboard the Meridian/.test(line)));
  const out = Object.keys(game.bodies ?? {}).filter((key) => body.outForAir(game, key));
  assert.ok(out.length >= 5, `some have passed out by now: ${out.length}`);
  assert.ok(Object.keys(game.systems.meridian.short).length > out.length, "and the rest are on their way to it");
  assert.equal(game.dead, undefined);
  assert.equal(Object.keys(game.register.dead).length, 0);
  effect(game, "air on");
  minutes(game, 40);
  assert.equal(Object.keys(game.bodies ?? {}).some((key) => body.outForAir(game, key)), false, "everyone's come round");
  minutes(game, 3 * 60);
  assert.equal(game.dead, undefined);
  assert.equal(game.systems?.meridian?.short, undefined, "and has their breath back");
  assert.equal(game.systems?.meridian?.nowhere, undefined);
  assert.ok(game.systems.meridian.reserve < RESERVE, "and the reserve air is filling again");
  assert.ok(everyoneAboard(game).filter((one) => !one.asleep).length > 20, "people are about their day again");
});

test("a ship with no air left anywhere loses everyone aboard, the register too, and the player lives", () => {
  const game = newGame();
  inRoom(game, "mess");
  const aboard = game.ship.aboard;
  airGone(game);
  const said = [];
  for (let hour = 0; hour < 6; hour += 1) said.push(...passTime(game, 1, "active"));
  assert.ok(said.some((line) => /\[AIR\] There's no good air left anywhere aboard the Meridian\. Nobody lasts more than a few hours like this\./.test(line)));
  assert.ok(said.some((line) => /passes out, here in the Long Mess/.test(line)));
  assert.ok(said.some((line) => /Passed out for want of air, elsewhere aboard the Meridian: /.test(line)));
  assert.ok(said.some((line) => /The people on the register are dying for want of air: \d+ of them so far\./.test(line)));
  assert.ok(said.some((line) => /more of the people on the register have died for want of air\. That's \d+ of them\./.test(line)));
  // Everyone on the register, and everyone with a day of their own who's aboard.
  assert.equal(Object.keys(game.register.dead).length, game.register.size);
  assert.equal(everyoneAboard(game).filter((one) => !/^dead/.test(one.doing)).length, 0, "nobody's left on their feet");
  assert.equal(game.ship.aboard, aboard - deadAboard(game));
  assert.ok(game.ship.aboard <= 5, `${game.ship.aboard} left aboard on paper`);
  assert.equal(game.ship.morale, 0);
  const table = registerTable(game);
  assert.equal(table.rows.filter((row) => /^died on day 1, (for want of air|suffocated in )/.test(row[4])).length, deadAboard(game), table.summary);
  // Said in a few lines, not one for each of nine hundred.
  assert.ok(said.filter((line) => /^\[AIR\]/.test(line)).length < 40, `${said.filter((line) => /^\[AIR\]/.test(line)).length} lines about the air`);
  // The player can't die of it yet: their health stops at 1.
  assert.equal(game.hp, 1);
  // A dead ship left for a month costs next to nothing to keep counting.
  const started = Date.now();
  for (let day = 0; day < 30; day += 1) passTime(game, 24, "routine");
  assert.ok(Date.now() - started < 4000, `a month more took ${Date.now() - started} ms`);
});

test("an hour without power kills nobody; six hours without it kills the ship", () => {
  // The generator out of cells for an hour, then cells aboard again: the deckhands carry one to it, and the air's back.
  const short = newGame();
  inRoom(short, "mess");
  withoutFuel(short, () => {
    const said = minutes(short, 60);
    assert.equal(logistics.powerSupply(short, "meridian"), 0);
    assert.ok(sys.airIn(short, "meridian", "mess") < 30, "no power, no air");
    assert.ok(said.some((line) => /no good air left anywhere aboard/.test(line)));
    logistics.putAboard(short, "meridian", "fuel_cell", 8);
    minutes(short, 3 * 60);
  });
  assert.equal(logistics.powerSupply(short, "meridian"), 100);
  assert.ok(sys.airIn(short, "meridian", "mess") >= 99);
  assert.equal(short.dead, undefined);
  assert.equal(Object.keys(short.register.dead).length, 0);
  assert.equal(Object.keys(short.bodies ?? {}).some((key) => body.outForAir(short, key)), false);
  // The same with nothing to burn for six hours.
  const long = newGame();
  inRoom(long, "mess");
  withoutFuel(long, () => {
    for (let hour = 0; hour < 6; hour += 1) passTime(long, 1, "active");
  });
  assert.equal(Object.keys(long.register.dead).length, long.register.size);
  assert.ok(deadAboard(long) > long.register.size + 30);
});

test("a long wait comes out as its minutes do", () => {
  const run = (wait) => {
    const game = newGame();
    inRoom(game, "mess");
    airGone(game);
    wait(game);
    return game;
  };
  // Two hours and three quarters without air, then the air back on, and a night.
  const then = (game) => {
    effect(game, "air on");
    passTime(game, 12, "routine");
    return game;
  };
  const byMinute = run((game) => minutes(game, 165));
  const inOne = run((game) => passTime(game, 2.75, "active"));
  const count = (game) => Object.keys(game.bodies ?? {}).filter((key) => body.outForAir(game, key)).length;
  assert.ok(count(byMinute) >= 5);
  assert.ok(Math.abs(count(byMinute) - count(inOne)) <= 4, `${count(byMinute)} passed out by the minute, ${count(inOne)} in one go`);
  for (const game of [then(byMinute), then(inOne)]) {
    assert.equal(game.dead, undefined);
    assert.equal(Object.keys(game.register.dead).length, 0);
  }
  // A day in one go with no air at all is a day without air.
  const day = run((game) => passTime(game, 24, "active"));
  assert.equal(Object.keys(day.register.dead).length, day.register.size);
  assert.equal(day.hp, 1);
});

test("a species the wounds file's line isn't for is spared", () => {
  const line = WOUNDS.wounds.find((one) => /^no air,/.test(one.text));
  const was = line.text;
  try {
    line.text = `${was}; not for: synthetic`;
    body.clearBodies();
    assert.equal(body.speciesNeedsAir("synthetic"), false);
    assert.equal(body.speciesNeedsAir("human"), true);
    const game = newGame();
    inRoom(game, "mess");
    airGone(game);
    for (let hour = 0; hour < 6; hour += 1) passTime(game, 1, "active");
    assert.equal(game.dead?.["id:seven"], undefined, "Seven's a synthetic, and still here");
    assert.ok(game.dead?.["id:halm"], "Halm isn't");
    const spared = Object.keys(game.register.dead).length;
    assert.ok(spared < game.register.size && spared > game.register.size * 0.8, `${spared} of ${game.register.size} on the register died`);
  } finally {
    line.text = was;
    body.clearBodies();
  }
  // And with no such line in the file, nobody passes out or dies of it at all.
  const at = WOUNDS.wounds.indexOf(line);
  try {
    WOUNDS.wounds.splice(at, 1);
    body.clearBodies();
    const game = newGame();
    inRoom(game, "mess");
    airGone(game);
    for (let hour = 0; hour < 6; hour += 1) passTime(game, 1, "active");
    assert.equal(game.dead, undefined);
    assert.equal(Object.keys(game.register.dead).length, 0);
  } finally {
    WOUNDS.wounds.splice(at, 0, line);
    body.clearBodies();
  }
});

test("at someone else's place, its people put the air back on before anyone passes out", () => {
  const game = newGame(21);
  game.location = "haven";
  game.walk = null;
  clockRuns(game, 1);
  const model = sys.systemsOf("haven");
  const plant = Object.values(model.parts).find((part) => part.kind === "air plant");
  sys.switchPart(game, "haven", plant.id, false, { by: "player" });
  assert.ok(game.systems.haven.parts[plant.id].backAt - game.clock.hours > 5, "left alone, they'd take six hours over it");
  const said = minutes(game, 100, () => !game.systems?.haven?.parts?.[plant.id]);
  assert.ok(said.some((line) => /Someone at Haven Station has put the air plant .* back on/.test(line)), said.filter((line) => /SYSTEMS|AIR/.test(line)).join(" | "));
  assert.ok(said.some((line) => /no good air left anywhere at Haven Station/.test(line)));
  minutes(game, 60);
  assert.equal(game.dead, undefined);
  assert.equal(Object.keys(game.bodies ?? {}).some((key) => body.outForAir(game, key)), false);
  assert.equal(game.systems?.haven, undefined, "and Haven's back to normal");
});

test("on a cot there's a mask: the medbay's own air going doesn't take its patients, a ship with none left does", () => {
  const game = newGame();
  inRoom(game, "mess");
  layBaoDown(game);
  const said = minutes(game, 60, () => game.down[BAO]?.bed);
  assert.ok(said.some((line) => /lays Mess Hand Bao on a cot in the medbay/.test(line)), said.filter((line) => /HEALTH/.test(line)).join(" | "));
  effect(game, "air off in Medbay");
  minutes(game, 5 * 60);
  assert.ok(sys.airIn(game, "meridian", "medbay") < 30);
  assert.ok(game.down[BAO]?.bed, "Bao's still on the cot");
  assert.equal(body.outForAir(game, BAO), null);
  assert.equal(game.dead, undefined);
  assert.equal(game.systems.meridian.short, undefined);
  // With no good air left anywhere aboard, the mask's no help.
  airGone(game);
  minutes(game, 5 * 60 + 30);
  assert.equal(game.dead?.[BAO]?.cause, "suffocated in Medbay");
});

test("what the ship can't breathe without never wears out with no spare aboard to mend it", () => {
  const game = newGame();
  const model = sys.systemsOf("meridian");
  const plant = Object.values(model.parts).find((part) => part.kind === "air plant");
  const mainBox = model.circuits[plant.room];
  logistics.takeAboard(game, "meridian", "parts_crate", 999);
  for (let day = 1; day <= 600; day += 1) sys.wearDay(game, day);
  const broken = Object.keys(game.systems.meridian.parts);
  assert.ok(broken.length > 20, `${broken.length} things have worn out in 600 days with nothing to mend them`);
  assert.ok(!broken.includes(plant.id), "never the air plant");
  assert.ok(!broken.includes(mainBox), "nor the junction box that feeds it");
  assert.ok(broken.some((id) => model.parts[id].kind === "junction box"), "though other junction boxes have");
  // With spares aboard it wears like anything else, and is mended the same day.
  const stocked = newGame();
  const fixed = [];
  for (let day = 1; day <= 600; day += 1) {
    logistics.putAboard(stocked, "meridian", "parts_crate", 2);
    fixed.push(...sys.wearDay(stocked, day));
  }
  assert.ok(fixed.some((line) => /The air plant in Engineering has given out, and .* has replaced what wore out/.test(line)), fixed.filter((line) => /air plant/.test(line)).join(" | ") || "the air plant never wore out");
});

test("the captain is told what stopping the air plant means, and nobody starts it again for them", () => {
  const game = newGame();
  inRoom(game, "engineering");
  const plant = Object.values(sys.systemsOf("meridian").parts).find((part) => part.kind === "air plant");
  const said = sys.switchPart(game, "meridian", plant.id, false, { by: "player" });
  assert.ok(said.some((line) => /That stops the air for the whole ship\. She has reserve air for 5 days; after that nobody aboard lasts more than a few hours without it, and nobody will start it again but you\./.test(line)), said.join(" | "));
  assert.equal(game.systems.meridian.parts[plant.id].backAt, undefined);
  minutes(game, 90);
  assert.equal(game.systems.meridian.parts[plant.id].on, false, "still off an hour and a half on");
  // Crew who do the same are overruled: after the usual six hours while there's reserve air to breathe, and within the
  // hour once a room's air has gone bad for want of it.
  const asCrew = () => {
    const draft = randomDraft({ seed: 21, archetype: "officer" });
    draft.start = "engine_hand";
    const crew = createGameFromDraft(draft);
    crew.transcript.push({ role: "narrator", text: "The story has begun." });
    inRoom(crew, "engineering");
    return crew;
  };
  const crew = asCrew();
  const told = sys.switchPart(crew, "meridian", plant.id, false, { by: "player" });
  assert.equal(told.some((line) => /That stops the air/.test(line)), false);
  const slow = minutes(crew, 100, () => !crew.systems?.meridian?.parts?.[plant.id]?.backAt);
  assert.equal(crew.systems.meridian.parts[plant.id].on, false, "left off for now: there's reserve air");
  slow.push(...minutes(crew, 5 * 60, () => crew.systems?.meridian?.parts?.[plant.id]?.on !== false));
  assert.ok(slow.some((line) => /Someone at .* has put the air plant .* back on/.test(line)), slow.filter((line) => /SYSTEMS|AIR/.test(line)).join(" | "));
  const urgent = asCrew();
  sys.switchPart(urgent, "meridian", plant.id, false, { by: "player" });
  noReserve(urgent);
  const quick = minutes(urgent, 100, () => urgent.systems?.meridian?.parts?.[plant.id]?.on !== false);
  assert.ok(quick.some((line) => /Someone at .* has put the air plant .* back on/.test(line)), quick.filter((line) => /SYSTEMS|AIR/.test(line)).join(" | "));
  assert.equal(urgent.dead, undefined);
});

test("with her air plant stopped the ship breathes reserve air for five days, and only then goes without", () => {
  const read = sys.systemsOf("meridian");
  assert.equal(read.numbers.reserve, 5);
  assert.equal(sys.systemsOf("haven").numbers.reserve, 0, "a station has none");
  const game = newGame();
  inRoom(game, "mess");
  const plant = Object.values(read.parts).find((part) => part.kind === "air plant");
  assert.match(sys.lookAt(game, "meridian", plant), /The reserve air stands at 5 days, which is all of it\.$/);
  effect(game, "air off");
  const first = minutes(game, 10);
  assert.ok(first.some((line) => /\[AIR\] The air plant has stopped\. The ship is breathing reserve air now: there's 5 days of it, and after that nobody lasts more than a few hours\./.test(line)), first.join(" | "));
  assert.equal(sys.airFlows(game, "meridian", "mess"), true);
  // Four days on, nobody's the worse for it, and it says a day is left.
  const said = [];
  for (let day = 0; day < 4; day += 1) said.push(...passTime(game, 24, "routine"));
  assert.ok(said.some((line) => /A day of reserve air is left, and the air plant's still stopped/.test(line)), said.filter((line) => /AIR/.test(line)).join(" | "));
  assert.equal(sys.airIn(game, "meridian", "mess"), 100);
  assert.equal(game.dead, undefined);
  assert.equal(game.systems.meridian.short, undefined);
  assert.match(sys.lookAt(game, "meridian", plant), /The reserve air stands at 23 hours\.$/);
  // A room's own vent shut is still that room without air, reserve or none.
  effect(game, "air off in The Galley");
  assert.equal(sys.airFlows(game, "meridian", "galley"), false);
  effect(game, "air on in The Galley");
  // The fifth day ends, and so does the air: by the next morning nobody's left.
  const last = passTime(game, 24, "routine");
  assert.ok(last.some((line) => /The reserve air has run out/.test(line)), last.filter((line) => /AIR/.test(line)).join(" | "));
  const end = passTime(game, 8, "routine");
  assert.equal(Object.keys(game.register.dead).length, game.register.size, [...last, ...end].filter((line) => /AIR/.test(line)).join(" | "));
  // Started again in time, the plant fills the reserve back up within the day.
  const saved = newGame();
  inRoom(saved, "mess");
  effect(saved, "air off");
  for (let day = 0; day < 2; day += 1) passTime(saved, 24, "routine");
  effect(saved, "air on");
  const after = [];
  for (let hour = 0; hour < 12; hour += 1) after.push(...passTime(saved, 1, "routine"));
  assert.ok(after.some((line) => /The ship's reserve air is full again/.test(line)), after.filter((line) => /AIR/.test(line)).join(" | "));
  assert.equal(saved.dead, undefined);
  assert.equal(saved.systems?.meridian?.reserve, undefined);
});
