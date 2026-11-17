// The logistics rework, step 7, part 2: the refined goods and their makers. A port that makes something needs what
// it's made from, and hands and power to make it: a maker's line says what goes into a day's making, it makes no more
// than the port has the goods for, and takes them; a port short of what its people eat and drink has fewer hands at
// its makers, one short of medicine has more of them laid up, and one without what its makers run on does a part of
// its work. So a shortage travels down a tree as well as across the map. The Sundial and Anselm's Mercy are ports.
// None of this calls an AI. The ground the basic goods come out of (part 3) is in test/ports-ground.test.js.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-makers-"));
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
const { placeNow, portNow } = await import("../src/daily.js");
const { amountOf, clearPorts, levelOf, portsModel, portsProblems, whyShort, workAt, workLine } = await import("../src/ports.js");
const { shipCommand, shipView } = await import("../src/ship.js");
const { boardWorldItem, saveBoardWorldItem } = await import("../src/board.js");
const { DAILY, STAR_MAP, STORY_CLOCK, reloadPorts } = await import("../src/world.js");
const { NEEDS, goodsIn, parseGoodsText, readGoodLine, readMakeLine, writeGoodLine, writeGoodsText, writeMakeLine } = await import("../public/ports-text.js");

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
// So many of a good at a port, exactly.
const give = (game, place, good, n) => set(game, place, good, (n / model().ports[place].holds[good].usual) * 100);
const noHauls = (game, place, good) => { game.world.hauls = game.world.hauls.filter((haul) => !(haul[1] === place && (!good || haul[2] === good))); };
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

test("every good that's made from something says so, every maker says what goes into it, and the trees say what hands, the sick and power need", () => {
  assert.deepEqual(portsProblems(), []);
  const m = model();
  assert.deepEqual(m.work, { hands: ["ration_crates", "drinking_water"], sick: ["medicine_crates"], power: ["fuel_cells"] });
  assert.equal(m.trees.fuel.power, true, "the fuel tree's own makers run on what they make");
  for (const good of Object.values(m.goods)) {
    if (good.step === "basic") assert.deepEqual(good.from, [], `${good.name} comes out of the ground`);
    else assert.ok(good.from.length >= 1 && good.from.every((one) => m.goods[one]), `${good.name} is made from something`);
  }
  assert.deepEqual(m.goods.ration_crates.from, ["meal", "kelp_cake"]);
  assert.deepEqual(m.goods.fuel_cells.from, ["refined_fuel", "parts_crates"], "the casings come from another tree");
  assert.deepEqual(m.goods.machines.from, ["parts_crates", "circuit_boards"]);
  for (const port of Object.values(m.ports)) {
    const seen = new Set();
    for (const one of port.makes) {
      const good = m.goods[one.good];
      assert.equal(one.from.length > 0, good.from.length > 0, `${port.id}: ${one.name} and what ${good.name} are made from`);
      for (const input of one.from) {
        assert.ok(good.from.includes(input.good) && port.holds[input.good] && input.n > 0, `${port.id}: ${one.name} take ${input.good}`);
        // What a maker takes is made before it, where it's made here: so today's meal goes into today's crates.
        assert.ok(!port.made[input.good] || seen.has(input.good), `${port.id}: ${input.good} is made before ${good.name}`);
      }
      seen.add(one.good);
    }
  }
  // What a port brings in counts what its makers take, working as hard as it takes to make what goes out.
  const kitchens = maker("haven", "ration_packs");
  assert.deepEqual(kitchens.from.map((one) => one.good), ["meal"]);
  const share = m.flow.haven.ration_packs / kitchens.rate;
  assert.ok(share > 0.3 && share < 0.7, "they work at about half of what they can");
  assert.ok(Math.abs(m.ports.haven.eat.meal - kitchens.from[0].n * share) < 1e-6);
  assert.ok(Math.abs(m.need.haven.meal - m.ports.haven.eat.meal) < 1e-6, "Haven makes no meal, so it brings in all its kitchens take");
  assert.ok(m.flow.frontier.meal > m.ports.frontier.eat.meal + m.need.haven.meal - 1e-6, "and Tessen's sheds make that as well as what its own homesteads take");
  // Jump fuel is still made where it was, each port from refined fuel of its own.
  for (const id of ["cinder", "deepyards", "vantor", "graveyard", "ghostlight"]) {
    assert.ok(m.ports[id].made.jump_fuel > 0 && m.ports[id].made.refined_fuel > 0 && !m.ports[id].holds.refined_fuel.from.length, id);
    assert.deepEqual(maker(id, "jump_fuel").from.map((one) => one.good), ["refined_fuel"]);
  }
  // Who makes each of the four supplies, and who sends to whom for them, is still what the world's day file says.
  for (const [id, place] of Object.entries(DAILY.places)) for (const [supply, from] of Object.entries(place.goods ?? {})) {
    const hold = m.ports[id].holds[m.stands[supply]];
    assert.deepEqual([...hold.from].sort(), [...from].sort(), `${id}'s ${supply}`);
    assert.equal(Boolean(m.ports[id].made[m.stands[supply]]), from.length === 0, `${id} makes its own ${supply}, or doesn't`);
  }
});

test("a good's made from, a tree's needs and a maker's from are read, written back, and refused in plain words", () => {
  assert.deepEqual(goodsIn("meal, kelp cake or plasma and dressings"), ["meal", "kelp cake", "plasma and dressings"]);
  const kits = "medkits, by the case [medkit], made from compounds, plasma and dressings: Kits for one wound.";
  assert.deepEqual(readGoodLine(kits), { name: "medkits", unit: "case", item: "medkit", from: ["compounds", "plasma and dressings"], words: "Kits for one wound." });
  assert.equal(writeGoodLine(readGoodLine(kits)), kits);
  assert.deepEqual(readGoodLine("machines, from parts crates or circuit boards").from, ["parts crates", "circuit boards"]);
  assert.match(readGoodLine("meal, kelp cake: Two goods").problem, /the good's name alone/);
  const sheds = "the charging sheds: 430 fuel cells a day, from 43 refined fuel, 8.6 parts crates";
  assert.deepEqual(readMakeLine(sheds), { name: "the charging sheds", n: 430, good: "fuel cells", from: [{ n: 43, good: "refined fuel" }, { n: 8.6, good: "parts crates" }] });
  assert.equal(writeMakeLine(readMakeLine(sheds)), sheds);
  // An and before a number parts two amounts; an and inside a good's name doesn't, nor a comma inside a number.
  assert.deepEqual(readMakeLine("the benches: 5 medkits a day, from 2 plasma and dressings and 1,200 compounds").from, [{ n: 2, good: "plasma and dressings" }, { n: 1200, good: "compounds" }]);
  assert.match(readMakeLine("the kitchens: 72 ration packs a day, from meal").problem, /how many and of what goes into a day's making/);
  assert.match(readMakeLine("the kitchens: 72 ration packs a day, from 0 meal").problem, /how many and of what/);
  const text = "# Food\nstands for: food, by its ration crates\nhands need: ration crates\n\nRefined:\n- meal, by the sack: Grain.\n";
  const { value, problems } = parseGoodsText(text, "food");
  assert.deepEqual(problems, []);
  assert.deepEqual(value.needs, { hands: { good: "ration crates", line: 3 } });
  assert.equal(writeGoodsText(value), text);
  assert.deepEqual(NEEDS, ["hands", "sick", "power"]);
  assert.match(parseGoodsText("# Food\nhands need: .\n", "food").problems[0].message, /hands need is one of this tree's goods/);
});

test("the checker says what's wrong with a maker: what it takes isn't a good, isn't what the tree says, isn't held, or isn't said", () => {
  const said = (dir, name, change) => withFile(dir, name, change, () => portsProblems().join(" | "));
  const kitchens = /(the kitchens on the Manifest Docks: [\d,.]+ ration packs a day), from [\d,.]+ meal/;
  assert.match(said(portsDir, "haven.txt", (text) => text.replace(kitchens, "$1, from 36 moon cheese")), /ports\/haven\.txt \(line \d+\): there's no good called moon cheese in world\/goods, for the kitchens on the Manifest Docks to make ration packs from/);
  assert.match(said(portsDir, "haven.txt", (text) => text.replace(kitchens, "$1, from 36 cloth")), /there's no making ration packs from cloth, by world\/goods\/food\.txt: it says meal/);
  assert.match(said(portsDir, "haven.txt", (text) => text.replace(kitchens, "$1")), /the kitchens on the Manifest Docks: ration packs from nothing\. Say from how many of what \(meal\)/);
  assert.match(said(portsDir, "haven.txt", (text) => text.replace(kitchens, "$1, from 36 meal, 2 meal")), /can take meal once/);
  assert.match(said(portsDir, "cinder.txt", (text) => text.replace(/(the company shops: [\d,.]+ parts crates a day), from [\d,.]+ metal stock/, "$1, from 18 scrap")), /the company shops: parts crates from scrap, and the port holds no scrap: add a line for it under Holds/);
  assert.match(said(portsDir, "haven.txt", (text) => text.replace(/(- meal: usually [\d,.]+), from Tessen Colony/, "$1")), /meal goes into what's made here and never comes: say where it's from, or who makes it/);
  assert.match(said(portsDir, "maris.txt", (text) => text.replace(/(the presses on the Rafts: )[\d,.]+ kelp cake/, "$110 kelp cake")), /kelp cake a day are used here, taken by its makers or sent for from here, and 10 are made: it'll run down/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("[ration_pack_case], made from meal", "[ration_pack_case], made from moon cheese")), /goods\/food\.txt \(line \d+\): ration packs: made from moon cheese, which isn't a good in world\/goods/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("hands need: ration crates", "hands need: fuel cells")), /hands need: fuel cells, which isn't one of this tree's goods/);
  // Round in a ring: scrap from machines, which are made from parts crates, which are made from scrap. The tree has
  // to allow it for a maker to try it.
  const ring = withFile(goodsDir, "parts.txt", (text) => text.replace("[scrap_load], made from wrecks", "[scrap_load], made from wrecks, machines"),
    () => said(portsDir, "deepyards.txt", (text) => text.replace(/(the cutters: [\d,.]+ scrap a day), from [\d,.]+ wrecks/, "$1, from 1 machines")));
  assert.match(ring, /making .* takes .*, and making .* takes .* in the end: one of the ports' makers has to give way/);
  assert.deepEqual(portsProblems(), [], "and the files are as they were");
});

test("a maker makes no more than it has the goods for, and takes what it makes them from", () => quietly(() => {
  const game = newGame();
  const calm = newGame();
  days(game, 1);
  days(calm, 1);
  // The pharmacy cage on Anselm's Mercy makes medicine crates from extracts, which come from Lumen. The Sundial,
  // the one port that sends to Anselm for medicine, has all it wants meanwhile.
  const cage = maker("anselm", "medicine_crates");
  const each = cage.from[0].n / cage.rate;
  assert.deepEqual(cage.from.map((one) => one.good), ["extracts"]);
  for (const one of [game, calm]) {
    set(one, "anselm", "medicine_crates", 50);
    noHauls(one, "anselm", "extracts");
    set(one, "sundial", "medicine_crates", 130);
    noHauls(one, "sundial", "medicine_crates");
  }
  // In one of the two it has no extracts, and none on its way: nothing is made, however short it is of medicine.
  give(game, "anselm", "extracts", 0);
  const before = has(game, "anselm", "medicine_crates");
  const flasks = has(calm, "anselm", "extracts");
  days(game, 1);
  days(calm, 1);
  assert.ok(has(game, "anselm", "medicine_crates") < before, "with no extracts, its medicine only goes down");
  assert.ok(Math.abs(has(calm, "anselm", "medicine_crates") - has(game, "anselm", "medicine_crates") - cage.rate) < 0.01, "with extracts, the cage works flat out");
  assert.ok(Math.abs(flasks - has(calm, "anselm", "extracts") - cage.from[0].n) < 0.01, "and takes the extracts for it");
  assert.match(whyShort(game.world, "anselm", "medicine_crates"), /^Its makers are short of extracts \(([\d,]+ flasks? of extracts from Lumen Sanctuary (is|are) due|more has been sent for from Lumen Sanctuary)/);
  // With five flasks it makes what five flasks make, and the five are gone.
  noHauls(game, "anselm", "extracts");
  give(game, "anselm", "extracts", 5);
  const start = has(game, "anselm", "medicine_crates");
  days(game, 1);
  const made = has(game, "anselm", "medicine_crates") - start + model().ports.anselm.use.medicine_crates;
  assert.ok(Math.abs(made - 5 / each) < 1, `${made} crates from five flasks, at ${each} a crate`);
  assert.ok(has(game, "anselm", "extracts") < 0.01, "all five went into them");
}));

test("what's made today goes into what's made of it today, whatever order the makers are written in", () => quietly(() => {
  const play = () => {
    const game = newGame();
    days(game, 1);
    give(game, "sundial", "meal", 0);
    set(game, "sundial", "ration_crates", 90);
    const before = has(game, "sundial", "ration_crates");
    days(game, 1);
    return { made: has(game, "sundial", "ration_crates") - before + model().ports.sundial.use.ration_crates, meal: has(game, "sundial", "meal") };
  };
  const first = play();
  const floor = maker("sundial", "meal");
  assert.ok(first.made > floor.rate, `the threshing floor's ${floor.rate} sacks of the day went into ${first.made} crates`);
  // The packers written above the threshing floor: the game still threshes first.
  const turned = withFile(portsDir, "sundial.txt", (text) => {
    const lines = text.split("\n");
    const a = lines.findIndex((line) => line.startsWith("- the threshing floor:"));
    const b = lines.findIndex((line) => line.startsWith("- the packing tables"));
    assert.ok(a > 0 && b > a, "as it's written, the threshing floor comes first");
    [lines[a], lines[b]] = [lines[b], lines[a]];
    return lines.join("\n");
  }, () => {
    const order = model().ports.sundial.makes.map((one) => one.good);
    assert.ok(order.indexOf("meal") < order.indexOf("ration_crates"), order.join(", "));
    return play();
  });
  assert.ok(Math.abs(turned.made - first.made) < 0.01);
}));

test("a port short of food or water has fewer hands, one short of medicine more laid up, and one without cells less power, but the fuel tree's own makers", () => quietly(() => {
  const m = model();
  const fed = newGame();
  const hungry = newGame();
  days(fed, 1);
  days(hungry, 1);
  // Korrath Forge's furnaces have room to work flat out in both, and its shops, which take their metal, have all
  // the crates they've room for. In one of the two the forge is thirsty.
  const ready = (game) => {
    set(game, "korrath", "metal_stock", 40);
    set(game, "korrath", "parts_crates", 130);
  };
  for (const game of [fed, hungry]) ready(game);
  set(hungry, "korrath", "drinking_water", 20);
  assert.deepEqual(workAt(fed.world, "korrath"), { hands: 1, power: 1, short: [] });
  const thirsty = workAt(hungry.world, "korrath");
  assert.ok(Math.abs(thirsty.hands - 0.8125) < 1e-9 && thirsty.power === 1, "a quarter of the way down from normal to none, of the quarter there is to lose");
  assert.deepEqual(thirsty.short.map((one) => [one.need, one.good]), [["hands", "drinking_water"]]);
  assert.equal(workLine(fed.world, "korrath"), null);
  assert.equal(workLine(hungry.world, "korrath"), "Its makers are short of hands (drinking water scarce): they're doing about eight tenths of their work");
  assert.equal(placeNow(hungry, "korrath").work, workLine(hungry.world, "korrath"));
  assert.equal(placeNow(fed, "korrath").work, undefined);
  assert.equal(whyShort(hungry.world, "korrath", "metal_stock"), "Its makers are short of hands (drinking water scarce)");
  const furnaces = maker("korrath", "metal_stock");
  days(fed, 1);
  days(hungry, 1);
  assert.ok(Math.abs(has(fed, "korrath", "metal_stock") - has(hungry, "korrath", "metal_stock") - furnaces.rate * (1 - 0.8125)) < 0.01, "the furnaces made that much less");
  // Short of medicine and out of fuel cells as well: hands and power are each a share, and they multiply.
  const worse = newGame();
  days(worse, 1);
  ready(worse);
  set(worse, "korrath", "drinking_water", 20);
  set(worse, "korrath", "medicine_crates", 0);
  set(worse, "korrath", "fuel_cells", 0);
  const now = workAt(worse.world, "korrath");
  assert.ok(Math.abs(now.hands - 0.8125 * 0.85) < 1e-9 && Math.abs(now.power - 0.4) < 1e-9);
  assert.equal(workLine(worse.world, "korrath"), "Its makers are short of hands (drinking water scarce) and power (fuel cells almost gone), and more of its people are laid up (medicine crates almost gone): they're doing about three tenths of their work");
  const start = has(worse, "korrath", "metal_stock");
  days(worse, 1);
  assert.ok(Math.abs(has(worse, "korrath", "metal_stock") - start - furnaces.rate * 0.8125 * 0.85 * 0.4) < 0.01);
  // Cinder Reach with no cells at all: its shops slow down, but the Stack and the charging sheds don't.
  const dark = newGame();
  days(dark, 1);
  give(dark, "cinder", "fuel_cells", 0);
  set(dark, "cinder", "refined_fuel", 40);
  set(dark, "cinder", "metal_stock", 40);
  // Its enrichers and its shops have all they've room for, so only the Stack, the sheds and the smelter are at work.
  set(dark, "cinder", "jump_fuel", 130);
  set(dark, "cinder", "parts_crates", 130);
  assert.ok(Math.abs(workAt(dark.world, "cinder").power - 0.4) < 1e-9);
  const stack = maker("cinder", "refined_fuel");
  const sheds = maker("cinder", "fuel_cells");
  const smelter = maker("cinder", "metal_stock");
  const fuel = has(dark, "cinder", "refined_fuel");
  const metal = has(dark, "cinder", "metal_stock");
  assert.equal(m.goods.refined_fuel.tree, "fuel");
  days(dark, 1);
  assert.ok(has(dark, "cinder", "fuel_cells") > sheds.rate * 0.5, "the sheds charged cells without any to run on");
  assert.ok(Math.abs(has(dark, "cinder", "refined_fuel") - (fuel + stack.rate - sheds.from.find((one) => one.good === "refined_fuel").n)) < 0.5, "and the Stack made all it can, less what the sheds took");
  assert.ok(Math.abs(has(dark, "cinder", "metal_stock") - (metal + smelter.rate * 0.4)) < 0.01, "while the smelter did four tenths of its work");
}));

test("a shortage travels down a tree and across the map: Lumen stops, Anselm's Mercy runs out of what it makes medicine from, and then the Sundial of medicine", () => only(() => {
  const game = newGame();
  const calm = newGame();
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  days(game, 2);
  days(calm, 2);
  // Lumen's grief: nothing of its medicine is made, and none of it leaves. Anselm's Mercy is nearly out of extracts.
  begin(game, "lumen", "lumen_grief", 24);
  set(game, "anselm", "extracts", 12);
  noHauls(game, "anselm", "extracts");
  days(game, 10);
  days(calm, 10);
  assert.ok(has(game, "anselm", "extracts") < 0.5, "the last of the extracts went into medicine");
  assert.ok(level(game, "anselm", "medicine_crates") < level(calm, "anselm", "medicine_crates") - 20, `Anselm's medicine: ${level(game, "anselm", "medicine_crates")} against ${level(calm, "anselm", "medicine_crates")}`);
  assert.match(whyShort(game.world, "anselm", "medicine_crates"), /^Its makers are short of extracts \(nothing's leaving Lumen Sanctuary\)/);
  assert.equal(placeNow(game, "anselm").goods.find((good) => good.id === "medicine").why, whyShort(game.world, "anselm", "medicine_crates"));
  // Lumen itself still has its extracts: it's its makers that have stopped.
  assert.ok(level(game, "lumen", "extracts") > 80);
  assert.ok(level(game, "sundial", "medicine_crates") > 80, "not yet felt on the Sundial");
  days(game, 14);
  days(calm, 14);
  assert.ok(level(game, "anselm", "medicine_crates") < 10, `Anselm has all but run out: ${level(game, "anselm", "medicine_crates")}`);
  assert.ok(level(game, "sundial", "medicine_crates") < level(calm, "sundial", "medicine_crates") - 20, `the Sundial's medicine: ${level(game, "sundial", "medicine_crates")} against ${level(calm, "sundial", "medicine_crates")}`);
  assert.match(whyShort(game.world, "sundial", "medicine_crates"), /^Anselm's Mercy has none to spare \(its makers are short of extracts/);
  assert.match(workLine(game.world, "anselm"), /^More of its people are laid up \(medicine crates almost gone\): its makers are doing about nine tenths of their work$/);
  // The grief passes, the extracts come again, and both come back.
  days(game, 40);
  assert.equal(game.world.places.lumen.events.length, 0);
  assert.ok(level(game, "anselm", "medicine_crates") > 80 && level(game, "sundial", "medicine_crates") > 80, `Anselm ${level(game, "anselm", "medicine_crates")}, the Sundial ${level(game, "sundial", "medicine_crates")}`);
}));

test("what's taken off a port's market or brought to it is its finished goods, not what its makers make them from", () => only(() => {
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
  // People hoard food on Haven: its crates and its packs go, seven hundredths of the usual a day. Its meal isn't
  // taken: it only goes a little faster into the packs its kitchens make up again.
  const hoard = run("haven", "hoarding", 5);
  assert.ok(level(hoard.game, "haven", "ration_crates") < level(hoard.calm, "haven", "ration_crates") - 20);
  assert.ok(level(hoard.game, "haven", "meal") > level(hoard.calm, "haven", "meal") - 20, `meal: ${level(hoard.game, "haven", "meal")} against ${level(hoard.calm, "haven", "meal")}`);
  // Raiders bring parts to Kessara: crates and boards to spare, and no scrap, which its yards never hold more of
  // than they usually do.
  const score = run("kessara", "kessara_score", 5);
  assert.ok(level(score.game, "kessara", "parts_crates") > level(score.calm, "kessara", "parts_crates") + 15);
  assert.ok(level(score.game, "kessara", "scrap") <= 100.01, `scrap: ${level(score.game, "kessara", "scrap")}`);
  // Vantor's reserves are released: crates, and no meal.
  const reserves = run("vantor", "vantor_reserves", 5);
  assert.ok(level(reserves.game, "vantor", "ration_crates") > level(reserves.calm, "vantor", "ration_crates") + 20);
  assert.ok(level(reserves.game, "vantor", "meal") < 101);
  // A strike stops the whole tree's makers: what's refined as well as what's made of it.
  const strike = run("cinder", "cinder_picket_fight", 6);
  assert.ok(level(strike.game, "cinder", "jump_fuel") < level(strike.calm, "cinder", "jump_fuel") - 15);
  assert.equal(whyShort(strike.game.world, "cinder", "jump_fuel"), "Nothing's being made here");
  // The Stack, down to four tenths of its refined fuel, makes none of it up while the strike lasts, and all of it after.
  set(strike.game, "cinder", "refined_fuel", 40);
  set(strike.calm, "cinder", "refined_fuel", 40);
  days(strike.game, 1);
  days(strike.calm, 1);
  assert.ok(level(strike.game, "cinder", "refined_fuel") <= 40.01, `struck: ${level(strike.game, "cinder", "refined_fuel")}`);
  assert.ok(level(strike.calm, "cinder", "refined_fuel") > 42, `at work: ${level(strike.calm, "cinder", "refined_fuel")}`);
}));

test("the Sundial and Anselm's Mercy are ports: what they hold is real, and the Meridian's buying takes it", () => quietly(() => {
  const game = newGame();
  const m = model();
  for (const id of ["sundial", "anselm"]) {
    assert.ok(m.ports[id] && m.ports[id].people > 0, id);
    assert.deepEqual(Object.keys(game.world.places[id].goods), ["food", "medicine", "parts"]);
    for (const good of Object.keys(STAR_MAP.places[id].trade ?? {})) assert.ok(m.ports[id].holds[m.stands[good]], `${id} sells ${good} to the ship, and holds it`);
  }
  assert.ok(m.ports.sundial.made.ration_crates > 0 && m.ports.sundial.made.meal > 0, "the farm ship makes its own food, from its own meal");
  assert.ok(m.ports.anselm.made.medicine_crates > 0 && m.ports.anselm.holds.extracts.from.includes("lumen"), "the hospital ship makes its own medicine, from Lumen's extracts");
  assert.ok(m.ports.lumen.holds.plasma_and_dressings.from.includes("anselm"), "and sends Lumen what its wards have to give");
  assert.deepEqual(m.ports.sundial.holds.medicine_crates.from, ["anselm"]);
  assert.deepEqual(m.ports.anselm.holds.ration_crates.from, ["sundial", "haven"]);
  // The Meridian at the Sundial's dock buys a lot of food: five crates fewer there.
  game.ship.at = "sundial";
  game.location = "sundial";
  game.walk = null;
  game.credits = 100000;
  const before = has(game, "sundial", "ration_crates");
  const row = () => shipView(game).trade.find((one) => one.id === "food");
  assert.match(row().has, /^[\d,]+ ration crates$/);
  // Her stores are full on the first day, so she sells a lot first: five crates more there, then five fewer.
  shipCommand(game, { action: "sell", id: "food" });
  assert.ok(Math.abs(has(game, "sundial", "ration_crates") - before - 5) < 0.01);
  shipCommand(game, { action: "buy", id: "food" });
  assert.ok(Math.abs(has(game, "sundial", "ration_crates") - before) < 0.01);
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  const now = placeNow(game, "sundial");
  assert.match(now.goods[0].has, /^[\d,]+ ration crates$/);
  assert.deepEqual(portNow(game, "sundial").map((tree) => tree.name), ["Food", "Fuel", "Medicine", "Parts", "Water and air", "Comforts"]);
  days(game, 30);
  for (const id of ["sundial", "anselm"]) for (const good of Object.keys(m.ports[id].holds)) assert.ok(level(game, id, good) > 60 && level(game, id, good) < 130, `${id}'s ${good} after a month: ${level(game, id, good)}`);
}));

test("the star map's list says what a good is made from here and what its makers take, and looking writes nothing", () => {
  const game = newGame();
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  const before = JSON.stringify(game);
  const rows = Object.fromEntries(portNow(game, "haven").flatMap((tree) => tree.goods).map((good) => [good.id, good]));
  assert.deepEqual(rows.ration_packs.madeFrom, ["meal"]);
  assert.ok(rows.ration_packs.made > 0 && rows.ration_packs.taken === 0);
  assert.deepEqual([rows.meal.from, rows.meal.made, rows.meal.madeFrom], [["Tessen Colony"], 0, []]);
  assert.ok(rows.meal.taken > 0 && rows.meal.used === 0, "its kitchens take it; nobody else uses it");
  assert.deepEqual(rows.drinking_water.madeFrom, ["water"]);
  assert.deepEqual(rows.water.from, ["Tessen Colony", "Maris Deep"]);
  const cinder = Object.fromEntries(portNow(game, "cinder").flatMap((tree) => tree.goods).map((good) => [good.id, good]));
  assert.deepEqual(cinder.fuel_cells.madeFrom, ["refined fuel", "parts crates"]);
  assert.ok(cinder.parts_crates.taken > 0 && cinder.parts_crates.used > 0, "its crates go to repairs, and into cells as casings");
  publicState(game);
  assert.equal(JSON.stringify(game), before);
});

test("the Story board shows what goes into things, and saves a maker's and a tree's new lines", () => {
  const food = boardWorldItem("goods", "food");
  assert.deepEqual(food.value.needs.hands.good, "ration crates");
  assert.ok(food.lists.goods.includes("kelp cake") && food.lists.goods.includes("fuel cells"), "every good, to pick what one is made from");
  assert.ok(food.links.where.meal.taken > 0 && food.links.where.meal.used === 0);
  assert.ok(food.links.where.meal.makers.some((one) => one.id === "frontier") && food.links.where.meal.makers.some((one) => one.id === "sundial"));
  const haven = boardWorldItem("port", "haven");
  assert.ok(haven.value.makes.some((one) => /^the kitchens on the Manifest Docks: [\d,.]+ ration packs a day, from [\d,.]+ meal$/.test(one.text)));
  assert.ok(haven.links.from.some((one) => one.id === "frontier" && one.goods.includes("meal")));
  assert.ok(haven.links.through.meal > 0);
  // A maker's line changed: saved into the copy, and played at once.
  const orrin = boardWorldItem("port", "orrin");
  const line = orrin.text.match(/- the cloister's cistern: ([\d,.]+) drinking water a day, from ([\d,.]+) water/);
  assert.ok(line, orrin.text);
  const changed = orrin.text.replace(line[0], `- the cloister's cistern: ${line[1]} drinking water a day, from 0.8 water`);
  assert.deepEqual(saveBoardWorldItem("port", "orrin", changed), { saved: true, problems: [] });
  assert.equal(maker("orrin", "drinking_water").from[0].n, 0.8);
  // One that takes what the port doesn't hold is saved, with what the checker says of it.
  const odd = saveBoardWorldItem("port", "orrin", orrin.text.replace(line[0], `- the cloister's cistern: ${line[1]} drinking water a day, from 1 meal`));
  assert.equal(odd.saved, true);
  assert.ok(odd.problems.some((one) => /there's no making drinking water from meal/.test(one)), odd.problems.join(" | "));
  assert.equal(saveBoardWorldItem("port", "orrin", orrin.text.replace(line[0], "- the cloister's cistern: 2 drinking water a day, from water")).saved, false);
  assert.deepEqual(saveBoardWorldItem("port", "orrin", orrin.text), { saved: true, problems: [] });
  // A tree's needs changed the same way.
  const other = saveBoardWorldItem("goods", "food", food.text.replace("hands need: ration crates", "hands need: ration packs"));
  assert.deepEqual(other, { saved: true, problems: [] });
  assert.deepEqual(model().work.hands, ["ration_packs", "drinking_water"]);
  assert.deepEqual(saveBoardWorldItem("goods", "food", food.text), { saved: true, problems: [] });
  assert.deepEqual(model().work.hands, ["ration_crates", "drinking_water"]);
  assert.deepEqual(portsProblems(), []);
});
