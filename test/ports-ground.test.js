// The logistics rework, step 7, part 3: the basic goods and the ground they come from. Grain, gas, ore, ice and the
// rest come out of the ground at the ports that have ground for them (a port's Ground part), to whatever hands there
// are, and nothing else in the game is made from nothing: every other good is made from the goods its tree names, by
// a maker that says how many of each. So a shortage can start at a field or a well and climb the whole tree. None of
// this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ground-"));
// The board saves into copies of the goods and the ports, never the game's own.
const copyOf = (folder) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `meridian-${folder}-`));
  for (const name of fs.readdirSync(new URL(`../world/${folder}`, import.meta.url))) fs.copyFileSync(new URL(`../world/${folder}/${name}`, import.meta.url), path.join(dir, name));
  return dir;
};
const goodsDir = copyOf("goods");
const portsDir = copyOf("ports");
process.env.GAME_GOODS_DIR = goodsDir;
process.env.GAME_PORTS_DIR = portsDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
await import("../src/tools.js");
const { passTime, publicState } = await import("../src/rules.js");
const { portNow } = await import("../src/daily.js");
const { amountOf, clearPorts, levelOf, portsModel, portsProblems, whyShort, workAt } = await import("../src/ports.js");
const { boardWorldItem, saveBoardWorldItem } = await import("../src/board.js");
const { DAILY, STORY_CLOCK, reloadPorts } = await import("../src/world.js");
const { PORT_PARTS, parsePortText, readGroundLine, writeGroundLine, writePortText } = await import("../public/ports-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  // A captain who doesn't breathe, so that months can go by with nobody at the helm: left to herself the Meridian loses
  // her air about day 20, and since 2026-11-16 a captain who breathes with it (test/players-death.test.js).
  game.character.species = "synthetic";
  return game;
};
const days = (game, count) => { for (let day = 0; day < count; day += 1) passTime(game, 24, "routine"); };
// Nothing happens anywhere meanwhile: the world's events are put away, and so are the stories whose clocks change
// what a port has, and both are put back afterwards.
function quietly(play) {
  const kept = DAILY.events.splice(0);
  const stories = { ...STORY_CLOCK.threads };
  for (const id of Object.keys(STORY_CLOCK.threads)) delete STORY_CLOCK.threads[id];
  try {
    return play();
  } finally {
    DAILY.events.push(...kept);
    Object.assign(STORY_CLOCK.threads, stories);
  }
}
// Only what the test starts goes on: the events can't begin by themselves, but the ones under way play.
function only(play) {
  const chances = DAILY.events.map((event) => event.chance);
  for (const event of DAILY.events) event.chance = 0;
  try {
    return play();
  } finally {
    DAILY.events.forEach((event, i) => { event.chance = chances[i]; });
  }
}
const begin = (game, place, id, left) => { game.world.places[place].events = [{ id, left }]; };
const model = () => portsModel();
const level = (game, place, good) => levelOf(game.world, place, good);
const has = (game, place, good) => amountOf(game.world, place, good);
// A good's level at a port, set by hand: where it's kept for a supply, or with the port's other goods.
function set(game, place, good, to) {
  const supply = model().supplyOf[good];
  if (supply) game.world.places[place].goods[supply] = to;
  else ((game.world.ports ??= {})[place] ??= {})[good] = to;
}
const give = (game, place, good, n) => set(game, place, good, (n / model().ports[place].holds[good].usual) * 100);
const maker = (place, good) => model().ports[place].makes.find((one) => one.good === good);
// The files as they are in the copies, with one of them written another way, and put back afterwards.
function withFile(dir, name, change, play) {
  const file = path.join(dir, name);
  const was = fs.readFileSync(file, "utf8");
  const again = () => {
    reloadPorts();
    clearPorts();
  };
  fs.writeFileSync(file, change(was));
  again();
  try {
    return play();
  } finally {
    fs.writeFileSync(file, was);
    again();
  }
}

test("fourteen basic goods come out of the ground, and nothing else is made from nothing anywhere", () => {
  assert.deepEqual(portsProblems(), []);
  const m = model();
  const basic = m.order.filter((good) => m.goods[good].step === "basic");
  assert.deepEqual(basic, ["grain", "kelp", "greens", "sour_gas", "night_flowers", "reagents", "blood", "ore", "wrecks", "ice", "well_and_sea_water", "fruit_and_honey", "fibre", "leaf"]);
  for (const good of Object.values(m.goods)) {
    if (good.step === "basic") assert.deepEqual(good.from, [], `${good.name} isn't made from anything`);
    else assert.ok(good.from.length > 0, `${good.name} is made from something`);
    if (good.step === "refined") assert.ok(good.from.every((one) => m.goods[one].step === "basic"), `${good.name} is worked up from what comes out of the ground`);
  }
  assert.deepEqual(m.goods.refined_fuel.from, ["sour_gas", "ice", "wrecks"], "gas, ice, or what's left in a dead ship's tanks");
  assert.equal(m.goods.greens.item, "produce");
  let grounds = 0;
  for (const port of Object.values(m.ports)) {
    for (const one of port.makes) {
      const good = m.goods[one.good];
      assert.equal(Boolean(one.ground), good.step === "basic", `${port.id}: ${one.name} and ${good.name}`);
      assert.equal(one.from.length === 0, Boolean(one.ground), `${port.id}: only the ground gives ${good.name} for nothing`);
      if (one.ground) grounds += 1;
    }
  }
  assert.ok(grounds >= 30, `${grounds} places where something comes out of the ground`);
  // Everything every port holds can be followed back to some ground: through its own makers, or the ports it sends to.
  const grounded = (id, good, seen = new Set()) => {
    const key = `${id}/${good}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const port = m.ports[id];
    const makers = port.makes.filter((one) => one.good === good);
    if (makers.length) return makers.every((one) => one.ground || one.from.every((input) => grounded(id, input.good, new Set(seen))));
    return port.holds[good].from.some((other) => grounded(other, good, new Set(seen)));
  };
  for (const port of Object.values(m.ports)) for (const good of Object.keys(port.holds)) assert.ok(grounded(port.id, good), `${port.id}'s ${good} comes out of the ground somewhere`);
  // Every port that makes one of the four supplies has ground of its own for it, all the way down: so who depends
  // on whom for a supply is what it always was. Anselm's Mercy alone makes its medicine from another port's extracts.
  const local = (id, good) => m.ports[id].makes.filter((one) => one.good === good).length > 0 && m.ports[id].makes.filter((one) => one.good === good).every((one) => one.ground || one.from.every((input) => local(id, input.good)));
  for (const [id, place] of Object.entries(DAILY.places)) for (const [supply, from] of Object.entries(place.goods ?? {})) {
    if (from.length) continue;
    assert.equal(local(id, m.stands[supply]), !(id === "anselm" && supply === "medicine"), `${id}'s ${supply}`);
  }
  // What crosses the map before it's worked up at all: wool and kelp thread to Lumen's looms, Vantor's fruit to
  // Korrath's mash halls, and the Sundial's honey to the Gilded Wheel's kitchens.
  assert.deepEqual(m.ports.lumen.holds.fibre.from, ["frontier", "maris"]);
  assert.deepEqual(m.ports.korrath.holds.fruit_and_honey.from, ["vantor"]);
  assert.deepEqual(m.ports.wheel.holds.fruit_and_honey.from, ["sundial"]);
  assert.deepEqual(maker("wheel", "provisions").from.map((one) => one.good), ["ration_crates", "fruit_and_honey"]);
  // A ship has soil, hives and people who pay in blood, and no water of its own: it brings that in.
  assert.deepEqual(m.ports.sundial.makes.filter((one) => one.ground).map((one) => one.good), ["grain", "greens", "fruit_and_honey"]);
  assert.deepEqual(m.ports.anselm.makes.filter((one) => one.ground).map((one) => one.good), ["blood"]);
  assert.deepEqual([m.ports.sundial.holds.water.from, m.ports.sundial.made.water], [["maris"], undefined]);
  assert.deepEqual([m.ports.anselm.holds.water.from, m.ports.anselm.made.water], [["graveyard", "korrath"], undefined]);
  // The stations have no ground at all.
  for (const id of ["haven", "bastion", "wheel"]) assert.equal(m.ports[id].makes.some((one) => one.ground), false, id);
});

test("a Ground line is read, written back, and refused in plain words; a port's file keeps its Ground part", () => {
  assert.deepEqual(PORT_PARTS, ["holds", "ground", "makes", "uses", "stores"]);
  assert.deepEqual(readGroundLine("the Long Fields: 1,330 grain a day"), { name: "the Long Fields", n: 1330, good: "grain" });
  assert.equal(writeGroundLine(readGroundLine("the Long Fields: 1,330 grain a day")), "the Long Fields: 1,330 grain a day");
  assert.match(readGroundLine("the Long Fields: grain").problem, /where it comes out of the ground, a colon, how many of what, and a day/);
  assert.match(readGroundLine("the Long Fields: 0 grain a day").problem, /more than nothing/);
  assert.match(readGroundLine("the Long Fields: 330 grain a day, from 5 leaf").problem, /comes out of the ground, so it isn't made from anything/);
  const text = "# Tessen Colony\npeople: 2,000\n\nHolds:\n- grain: usually 3,300\n\nGround:\n- the Long Fields: 330 grain a day\n\nMakes:\n- the drying sheds: 330 meal a day, from 330 grain\n";
  const { value, problems } = parsePortText(text, "frontier");
  assert.deepEqual(problems, []);
  assert.deepEqual(value.ground.map((one) => one.text), ["the Long Fields: 330 grain a day"]);
  assert.equal(writePortText(value), text);
  assert.match(parsePortText("# X\n\nGround:\n- the Long Fields: 330 grain a day, from 5 leaf\n", "x").problems[0].message, /isn't made from anything/);
});

test("the checker keeps the ground to the basic goods, and everything else to being made from something", () => {
  const said = (dir, name, change) => withFile(dir, name, change, () => portsProblems().join(" | "));
  assert.match(said(portsDir, "frontier.txt", (text) => text.replace("Makes:", "Makes:\n- the reapers: 5 grain a day")), /ports\/frontier\.txt \(line \d+\): grain: a basic good isn't made, it comes out of the ground\. Write the line under Ground, without a from/);
  assert.match(said(portsDir, "frontier.txt", (text) => text.replace("Ground:", "Ground:\n- the magic mill: 5 meal a day")), /meal: only a basic good comes out of the ground\. This one is made, so its line goes under Makes, with what it's made from/);
  assert.match(said(portsDir, "frontier.txt", (text) => text.replace(/(- the Long Fields: [\d,.]+ grain a day)/, "$1, from 5 leaf")), /comes out of the ground, so it isn't made from anything/);
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("Ground:", "Ground:\n- the comet's dust: 2 ore a day")), /the comet's dust: ore come out of the ground here, and the port holds none: add a line for it under Holds/);
  assert.match(said(portsDir, "frontier.txt", (text) => text.replace(/(- the drying sheds: [\d,.]+ meal a day), from [\d,.]+ grain/, "$1")), /the drying sheds: meal from nothing\. Say from how many of what \(grain\)/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("- grain, by the load [grain]:", "- grain, by the load [grain], made from kelp:")), /goods\/food\.txt \(line \d+\): grain: a basic good comes out of the ground, and isn't made from anything/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("- meal, by the sack [meal], made from grain:", "- meal, by the sack [meal]:")), /meal: say what it's made from \(made from \.\.\.\)\. Only the basic goods come out of the ground/);
  // A port with no ground for what it makes things from, and nowhere to send for it.
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace(/\nGround:\n- the comet's own ice: [\d,.]+ ice a day\n/, "\n")), /ice goes into what's made here and never comes: say where it's from, or who makes it/);
  assert.deepEqual(portsProblems(), [], "and the files are as they were");
});

test("the ground gives to the hands there are, with or without power", () => quietly(() => {
  const seams = maker("korrath", "ore");
  assert.equal(seams.ground, true);
  assert.equal(seams.name, "the deep seams");
  const ready = () => {
    const game = newGame();
    days(game, 1);
    // Room for a full day's ore, and the furnaces, which take it, with all the metal they've room for.
    set(game, "korrath", "ore", 40);
    set(game, "korrath", "metal_stock", 130);
    return game;
  };
  const dug = (game) => {
    const before = has(game, "korrath", "ore");
    days(game, 1);
    return has(game, "korrath", "ore") - before;
  };
  const fed = ready();
  assert.ok(Math.abs(dug(fed) - seams.rate) < 0.01, "a full day's ore");
  // No fuel cells at all: its makers do four tenths of their work, and the seams give what they always give.
  const dark = ready();
  give(dark, "korrath", "fuel_cells", 0);
  assert.ok(Math.abs(workAt(dark.world, "korrath").power - 0.4) < 1e-9);
  assert.ok(Math.abs(dug(dark) - seams.rate) < 0.01, "the ground needs no power");
  // Thirsty: fewer hands at the seams as everywhere else.
  const thirsty = ready();
  set(thirsty, "korrath", "drinking_water", 20);
  assert.ok(Math.abs(dug(thirsty) - seams.rate * 0.8125) < 0.01, "and it needs hands");
  assert.equal(whyShort(thirsty.world, "korrath", "ore"), "Its makers are short of hands (drinking water scarce)");
  // The ground stops at what the port usually holds, like any maker.
  const full = ready();
  set(full, "korrath", "ore", 100);
  days(full, 1);
  assert.ok(level(full, "korrath", "ore") <= 100.01);
}));

test("a field that fails climbs the whole tree: no grain, no meal, no ration crates, and it comes back when the field does", () => quietly(() => {
  const game = newGame();
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  days(game, 1);
  // The Sundial's Long Furrow gives next to nothing, and what she had of grain and meal is nearly gone.
  withFile(portsDir, "sundial.txt", (text) => text.replace(/(- the Long Furrow: )[\d,.]+ grain a day/, "$10.5 grain a day"), () => {
    assert.equal(maker("sundial", "grain").rate, 0.5);
    set(game, "sundial", "grain", 4);
    set(game, "sundial", "meal", 4);
    days(game, 10);
    assert.ok(has(game, "sundial", "grain") < 1 && has(game, "sundial", "meal") < 1, "every load went into meal, and every sack into crates");
    assert.ok(level(game, "sundial", "ration_crates") < 70, `the Sundial's food: ${level(game, "sundial", "ration_crates")}`);
    assert.match(whyShort(game.world, "sundial", "ration_crates"), /^Its makers are short of meal \(its makers are short of grain\)/);
    // Of the grain itself the map can only say that too little comes out of the ground, or that hungry hands bring in less.
    assert.match(whyShort(game.world, "sundial", "grain"), /^(More is being taken from here than comes out of the ground|Its makers are short of hands \(ration crates (short|scarce|almost gone)\))$/);
    // Anselm's Mercy has Haven as well for its food, and feels it less.
    assert.ok(level(game, "anselm", "ration_crates") > level(game, "sundial", "ration_crates") + 15);
  });
  // The furrow bears again.
  assert.ok(maker("sundial", "grain").rate > 20);
  days(game, 40);
  assert.ok(level(game, "sundial", "ration_crates") > 80 && level(game, "sundial", "grain") > 60, `food ${level(game, "sundial", "ration_crates")}, grain ${level(game, "sundial", "grain")}`);
}));

test("a harvest starts in the ground, and what's taken off a market leaves the ground's goods alone", () => only(() => {
  const run = (place, event, length) => {
    const game = newGame();
    const calm = newGame();
    days(game, 2);
    days(calm, 2);
    begin(game, place, event, length + 2);
    days(game, length);
    days(calm, length);
    return { game, calm };
  };
  // Tessen's harvest: twice the grain out of the Long Fields, so the sheds mill twice as much and the homesteads
  // pack past what the colony usually holds, and the grain doesn't run down for it.
  const harvest = run("frontier", "frontier_harvest", 6);
  assert.ok(level(harvest.game, "frontier", "ration_crates") > 125, `crates: ${level(harvest.game, "frontier", "ration_crates")}`);
  assert.ok(level(harvest.game, "frontier", "meal") > level(harvest.calm, "frontier", "meal") && level(harvest.game, "frontier", "grain") > 90, `meal ${level(harvest.game, "frontier", "meal")}, grain ${level(harvest.game, "frontier", "grain")}`);
  // Raiders take its crates. Nobody carries off a field: its grain only goes a little faster into meal.
  const raid = run("frontier", "frontier_raid", 6);
  assert.ok(level(raid.game, "frontier", "ration_crates") < level(raid.calm, "frontier", "ration_crates") - 30);
  assert.ok(level(raid.game, "frontier", "grain") > level(raid.calm, "frontier", "grain") - 35, `grain: ${level(raid.game, "frontier", "grain")} against ${level(raid.calm, "frontier", "grain")}`);
  // A storm on Maris: a tenth of the kelp comes in, and the map says so of the kelp itself.
  const storm = run("maris", "maris_storm", 4);
  set(storm.game, "maris", "kelp", 50);
  assert.match(whyShort(storm.game.world, "maris", "kelp"), /^Less is coming out of the ground here than usual/);
  assert.match(whyShort(storm.game.world, "maris", "ration_crates") ?? "Less is being made here than usual", /^Less is being made here than usual/);
}));

test("the star map's list names the ground a good comes out of, and looking writes nothing", () => {
  const game = newGame();
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  const before = JSON.stringify(game);
  const rows = (id) => Object.fromEntries(portNow(game, id).flatMap((tree) => tree.goods).map((good) => [good.id, good]));
  const tessen = rows("frontier");
  assert.deepEqual(tessen.grain.ground, ["the Long Fields"]);
  assert.ok(tessen.grain.made > 0 && tessen.grain.taken > 0 && tessen.grain.used === 0);
  assert.deepEqual([tessen.grain.madeFrom, tessen.grain.from], [[], []]);
  assert.deepEqual([tessen.meal.ground, tessen.meal.madeFrom], [[], ["grain"]]);
  assert.deepEqual(rows("lumen").fibre.from, ["Tessen Colony", "Maris Deep"]);
  assert.deepEqual(rows("lumen").fibre.ground, []);
  assert.deepEqual(rows("sundial").greens.ground, ["the bays on the Drowned Deck"]);
  assert.ok(rows("sundial").greens.used > 0, "the families eat them");
  assert.deepEqual(rows("deepyards").ice.ground, ["the Ice Cut"]);
  publicState(game);
  assert.equal(JSON.stringify(game), before);
});

test("the Story board shows a port's ground and the basic goods, and saves a Ground line through the game's own readers", () => {
  const tessen = boardWorldItem("port", "frontier");
  assert.deepEqual(tessen.value.ground.map((one) => readGroundLine(one.text).good), ["grain", "well and sea water", "fibre", "leaf"]);
  assert.ok(tessen.lists.basics.includes("grain") && !tessen.lists.basics.includes("meal"));
  assert.ok(tessen.lists.made.includes("meal") && !tessen.lists.made.includes("grain"));
  assert.ok(tessen.links.to.some((one) => one.id === "lumen" && one.goods.includes("fibre")), "Lumen sends here for fibre");
  const food = boardWorldItem("goods", "food");
  assert.equal(food.value.steps.basic.length, 3);
  assert.ok(food.links.where.grain.makers.some((one) => one.id === "frontier") && food.links.where.grain.makers.some((one) => one.id === "sundial"));
  assert.ok(food.links.where.grain.taken > 0 && food.links.where.greens.used > 0);
  // A Ground line changed: saved into the copy, and played at once.
  const orrin = boardWorldItem("port", "orrin");
  const line = orrin.text.match(/- the comet's own ice: ([\d,.]+) ice a day/);
  assert.ok(line, orrin.text);
  assert.deepEqual(saveBoardWorldItem("port", "orrin", orrin.text.replace(line[0], "- the comet's own ice: 9 ice a day")), { saved: true, problems: [] });
  assert.deepEqual([maker("orrin", "ice").rate, maker("orrin", "ice").ground], [9, true]);
  // One for a good that's made is saved with what the checker says; one with a from isn't a Ground line at all.
  const odd = saveBoardWorldItem("port", "orrin", orrin.text.replace(line[0], `${line[0]}\n- the comet's kitchens: 1 drinking water a day`));
  assert.equal(odd.saved, true);
  assert.ok(odd.problems.some((one) => /drinking water: only a basic good comes out of the ground/.test(one)), odd.problems.join(" | "));
  const refused = saveBoardWorldItem("port", "orrin", orrin.text.replace(line[0], `${line[0]}, from 1 water`));
  assert.equal(refused.saved, false);
  assert.match(refused.problems[0], /isn't made from anything/);
  assert.deepEqual(saveBoardWorldItem("port", "orrin", orrin.text), { saved: true, problems: [] });
  assert.deepEqual(portsProblems(), []);
});
