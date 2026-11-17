// The logistics rework, step 7, part 1: the ports hold real amounts. world/goods has the goods, a tree to a file, and
// world/ports what each port usually holds, makes and uses. Each midnight a port makes, uses and sends for what it's
// short of, and hauls take days by the distance on the star map. The word a port has for a supply is how many it has
// against the usual, so prices, news and the story go on as before. What goes on at a port does real things: its
// makers stop, its people use more, goods are taken or brought, nothing gets in, or a haul is lost. None of this
// calls an AI. What a maker needs to make things (part 2) is in test/ports-makers.test.js, and the ground the basic
// goods come out of (part 3) in test/ports-ground.test.js.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ports-"));
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
const { noneLeft, placeNow, portNow, supplyFactor, tradedAt } = await import("../src/daily.js");
const { amountOf, clearPorts, counted, levelOf, portsModel, portsProblems, usualOf, whyShort } = await import("../src/ports.js");
const { shipCommand, shipView } = await import("../src/ship.js");
const { boardWorldItem, boardWorldList, saveBoardWorldItem } = await import("../src/board.js");
const { DAILY, STAR_MAP, STORY_CLOCK, WORLD_GOODS, WORLD_PORTS, reloadPorts } = await import("../src/world.js");
const { LOCATIONS } = await import("../src/data.js");
const { STEPS, parseGoodsText, parsePortText, readGoodLine, readHoldLine, readMakeLine, readStands, readUseLine, writeGoodsText, writeHoldLine, writeMakeLine, writePortText, writeUseLine } = await import("../public/ports-text.js");

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
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
const level = (game, place, good) => levelOf(game.world, place, good);
const has = (game, place, good) => amountOf(game.world, place, good);
const haulsTo = (game, place, good) => (game.world.hauls ?? []).filter((haul) => haul[1] === place && haul[2] === good);
const model = () => portsModel();
// The files as they are in the copies, with one of them written another way, and put back afterwards.
function withFile(dir, name, change, play) {
  const file = path.join(dir, name);
  const was = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const again = () => {
    reloadPorts();
    clearPorts();
  };
  fs.writeFileSync(file, change(was ?? ""));
  again();
  try {
    return play();
  } finally {
    if (was === null) fs.rmSync(file);
    else fs.writeFileSync(file, was);
    again();
  }
}

test("the goods' and the ports' files are sound, and each reads back exactly as it's written", () => {
  assert.deepEqual(portsProblems(), []);
  for (const [dir, parse, write] of [[goodsDir, parseGoodsText, writeGoodsText], [portsDir, parsePortText, writePortText]]) {
    for (const name of fs.readdirSync(dir).filter((one) => one.endsWith(".txt") && !one.startsWith("_"))) {
      const text = fs.readFileSync(path.join(dir, name), "utf8").replaceAll("\r\n", "\n");
      const { value, problems } = parse(text, name.slice(0, -4));
      assert.deepEqual(problems, [], name);
      assert.equal(write(value), text, `${name} reads back as written`);
    }
  }
  assert.ok(fs.existsSync(path.join(goodsDir, "_how-to-write-goods.txt")) && fs.existsSync(path.join(portsDir, "_how-to-write-a-port.txt")), "each folder has its how-to");
  const m = model();
  assert.deepEqual(Object.keys(m.trees), ["food", "fuel", "medicine", "parts", "air", "comforts"], "the supplies' trees first, in their own order");
  assert.deepEqual(m.stands, { food: "ration_crates", fuel: "jump_fuel", medicine: "medicine_crates", parts: "parts_crates" });
  assert.equal(m.order.length, 45, "the basic, the refined, the developed and the advanced goods");
  assert.deepEqual(STEPS.map((step) => m.order.filter((good) => m.goods[good].step === step).length), [14, 12, 12, 7]);
  // Every port with supplies has a file, and holds each supply the world already says it deals in.
  assert.deepEqual(Object.keys(m.ports).sort(), Object.keys(DAILY.places).sort());
  for (const [id, place] of Object.entries(DAILY.places)) for (const supply of Object.keys(place.goods ?? {})) assert.ok(usualOf(id, supply) > 0, `${id} holds its ${supply}`);
  // Across the map, more of every good is made in a day than is used and goes into other things.
  for (const good of m.order) {
    const made = Object.values(m.ports).reduce((sum, port) => sum + (port.made[good] ?? 0), 0);
    const used = Object.values(m.ports).reduce((sum, port) => sum + (port.use[good] ?? 0) + (port.eat[good] ?? 0), 0);
    assert.ok(made > used * 1.5, `${good}: ${made} made against ${used} used`);
  }
  // A haul takes two days at the least and six at the most, by how far it is on the chart.
  assert.equal(m.days("vantor", "bastion"), 2);
  assert.equal(m.days("haven", "frontier"), 4);
  assert.ok(Object.keys(m.ports).every((a) => Object.keys(m.ports).every((b) => a === b || (m.days(a, b) >= 2 && m.days(a, b) <= 6 && m.days(a, b) === m.days(b, a)))));
});

test("a line of each kind is read, written back, and refused in plain words when it can't be followed", () => {
  assert.deepEqual(readGoodLine("ration packs, by the case [ration_pack]: Packs and tins for one person."), { name: "ration packs", unit: "case", item: "ration_pack", from: [], words: "Packs and tins for one person." });
  assert.deepEqual(readGoodLine("machines"), { name: "machines", unit: null, item: null, from: [], words: "" });
  assert.match(readGoodLine("[ration_crate]: Crates").problem, /a good is its name/);
  assert.deepEqual(readStands("food, by its ration crates"), { supply: "food", good: "ration crates" });
  assert.match(readStands("the pantry").problem, /a supply and one of this tree's goods/);
  assert.deepEqual(readHoldLine("ration crates: usually 1,500, from Tessen Colony or Maris Deep"), { good: "ration crates", usual: 1500, from: ["Tessen Colony", "Maris Deep"] });
  assert.deepEqual(readHoldLine("fuel cells: usually 12.5, from Cinder Reach, the Veshti Deepyards and Vantor Prime").from, ["Cinder Reach", "the Veshti Deepyards", "Vantor Prime"]);
  assert.deepEqual(readHoldLine("drinking water: usually 600"), { good: "drinking water", usual: 600, from: [] });
  assert.match(readHoldLine("ration crates: lots").problem, /usually and how many/);
  assert.match(readHoldLine("ration crates: usually 0").problem, /more than nothing/);
  assert.deepEqual(readMakeLine("the kitchens: 3.5 ration packs a day"), { name: "the kitchens", n: 3.5, good: "ration packs", from: [] });
  assert.match(readMakeLine("the kitchens: ration packs").problem, /how many of what, and a day/);
  assert.deepEqual(readUseLine("its people: 60 ration crates, 1.2 beer and spirits, 30 drinking water a day"), { who: "its people", list: [{ n: 60, good: "ration crates" }, { n: 1.2, good: "beer and spirits" }, { n: 30, good: "drinking water" }] });
  assert.match(readUseLine("its people: crates a day").problem, /how many and of what/);
  assert.equal(writeHoldLine({ good: "ration crates", usual: 1500, from: ["Tessen Colony", "Maris Deep", "Haven Station"] }), "ration crates: usually 1,500, from Tessen Colony, Maris Deep or Haven Station");
  assert.equal(writeMakeLine({ name: "the kitchens", n: 3.5, good: "ration packs" }), "the kitchens: 3.5 ration packs a day");
  assert.equal(writeUseLine({ who: "its people", list: [{ n: 60, good: "ration crates" }, { n: 0.3, good: "medkits" }] }), "its people: 60 ration crates, 0.3 medkits a day");
  assert.deepEqual(STEPS, ["basic", "refined", "developed", "advanced"]);
  const bad = parsePortText("Haven\npeople: lots\n\nCellar:\n- wine\n\nHolds:\nration crates: usually 5\n", "haven").problems.map((one) => one.message);
  assert.ok(bad.some((one) => /first line is the port's name/.test(one)) && bad.some((one) => /people is a number/.test(one)) && bad.some((one) => /isn't a part of a port's file/.test(one)) && bad.some((one) => /starts with a dash/.test(one)), bad.join(" | "));
});

test("the checker says what's wrong between the files: a good, a port or a source that isn't there, and what can't add up", () => {
  const said = (dir, name, change) => withFile(dir, name, change, () => portsProblems().join(" | "));
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("- ration crates:", "- moon cheese: usually 4\n- ration crates:")), /ports\/orrin\.txt \(line \d+\): there's no good called moon cheese in world\/goods/);
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("from Lumen Sanctuary", "from Atlantis")), /there's no place called Atlantis for ration crates to come from/);
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("ration crates: usually 50, from Lumen Sanctuary", "ration crates: usually 50, from Foundry Seven")), /ration crates comes from Foundry Seven, which holds none/);
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("Makes:", "Makes:\n- the hermits' still: 1 beer and spirits a day")), /the hermits' still makes beer and spirits, and the port holds none/);
  assert.match(said(portsDir, "orrin.txt", (text) => text.replace("- ration crates: usually 50, from Lumen Sanctuary", "- ration crates: usually 50")), /ration crates is used here and never comes/);
  assert.match(said(portsDir, "maris.txt", (text) => text.replace(/(the Rafts' packers: )[\d,.]+ ration crates a day, from [\d,.]+ kelp cake/, "$110 ration crates a day, from 5 kelp cake")), /ration crates a day are used here, taken by its makers or sent for from here, and 10 are made: it'll run down/);
  assert.match(said(portsDir, "atlantis.txt", () => "# Atlantis\n\nHolds:\n- ration crates: usually 5\n"), /ports\/atlantis\.txt: there's no place called atlantis on the star map/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("[ration_crate]", "[moon_cheese]")), /goods\/food\.txt \(line \d+\): there's no item called moon_cheese in world\/items/);
  assert.match(said(goodsDir, "food.txt", (text) => text.replace("stands for: food", "stands for: gold")), /gold isn't one of the supplies every port has a word for/);
  assert.match(said(goodsDir, "comforts.txt", (text) => text.replace("Developed:", "Developed:\n- ration crates: Again.")), /ration crates is written twice: it's in Food too/);
  assert.deepEqual(portsProblems(), [], "and the files are as they were");
});

test("on day one every port has what it usually holds, and reading it writes nothing", () => {
  const game = newGame();
  const m = model();
  for (const port of Object.values(m.ports)) for (const [good, hold] of Object.entries(port.holds)) {
    assert.equal(level(game, port.id, good), 100);
    assert.equal(has(game, port.id, good), hold.usual);
  }
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  const before = JSON.stringify(game);
  // The long list comes only when it's asked for, and only for a place the player knows of.
  assert.equal(placeNow(game, "haven").holds, undefined);
  assert.equal(portNow(game, "haven").length, 6);
  assert.deepEqual(portNow(newGame(), "foundry"), [], "Foundry Seven isn't known yet");
  const haven = placeNow(game, "haven", { full: true });
  assert.deepEqual(haven.goods.map((good) => good.id), ["food", "fuel", "medicine", "parts"], "the four supplies, as ever");
  assert.equal(haven.goods[0].has, counted(m.goods.ration_crates, m.ports.haven.holds.ration_crates.usual));
  assert.ok(haven.goods.every((good) => good.level === "normal" && !good.why));
  assert.deepEqual(haven.holds.map((tree) => tree.name), ["Food", "Fuel", "Medicine", "Parts", "Water and air", "Comforts"]);
  const water = haven.holds.find((tree) => tree.id === "air").goods.find((good) => good.id === "drinking_water");
  assert.match(water.counted, /^[\d,]+ casks of drinking water$/);
  assert.ok(water.made > 0 && water.from.length === 0);
  const crates = haven.holds[0].goods.find((good) => good.id === "ration_crates");
  assert.deepEqual(crates.from, ["Tessen Colony", "Maris Deep"]);
  publicState(game);
  shipView(game);
  assert.equal(JSON.stringify(game), before, "looking changes nothing");
  // How a count is said: whole things, with what they're counted by.
  assert.equal(counted(m.goods.drinking_water, 1), "1 cask of drinking water");
  assert.equal(counted(m.goods.ration_crates, 1), "1 ration crate");
  assert.equal(counted(m.goods.ration_crates, 1180.4), "1,180 ration crates");
  assert.equal(counted(m.goods.jump_fuel, 0.2), "hardly any jump fuel");
  assert.equal(counted(m.goods.medicine_crates, 0), "no medicine crates");
  assert.equal(counted(m.goods.medicine_crates, 0.3, { least: 1 }), "1 medicine crate");
});

test("with nothing going on the ports stay near what they usually hold, for months", () => quietly(() => {
  const game = newGame();
  const m = model();
  let low = 100;
  let high = 100;
  let sum = 0;
  let n = 0;
  for (let day = 0; day < 150; day += 1) {
    days(game, 1);
    for (const port of Object.values(m.ports)) for (const good of Object.keys(port.holds)) {
      const now = level(game, port.id, good);
      if (m.supplyOf[good]) {
        low = Math.min(low, now);
        high = Math.max(high, now);
      }
      assert.ok(now >= 55 && now <= 130, `${port.id}'s ${good} is at ${now} on day ${day + 1}`);
      if (port.made[good] && !port.holds[good].from.length) assert.ok(now <= 100.01, `${port.id} makes ${good} and never past the usual: ${now}`);
      sum += now;
      n += 1;
    }
  }
  assert.ok(low >= 62, `the lowest any supply went was ${low}`);
  assert.ok(high <= 125, `the highest any supply went was ${high}`);
  assert.ok(sum / n > 95 && sum / n < 104, `on the whole they stand at ${sum / n}`);
  assert.ok(game.world.hauls.length > 80, `${game.world.hauls.length} hauls are on their way`);
  for (const [from, to, good, count, left] of game.world.hauls) {
    assert.ok(m.ports[to].holds[good].from.includes(from), `${good} goes to ${to} from one of the ports it sends to`);
    assert.ok(count > 0 && left >= 1 && left <= 6);
  }
}));

test("a port that's short sends for more, the sender has that much less, and it arrives days later", () => quietly(() => {
  const game = newGame();
  const m = model();
  days(game, 1);
  // Bastion Nine is down to half its ration crates. Everything it has comes from Vantor Prime, two days away.
  game.world.hauls = game.world.hauls.filter((haul) => haul[1] !== "bastion");
  game.world.places.bastion.goods.food = 50;
  game.world.places.vantor.goods.food = 100;
  const before = has(game, "vantor", "ration_crates");
  days(game, 1);
  const sent = haulsTo(game, "bastion", "ration_crates");
  assert.equal(sent.length, 1, "a haul is sent for that day");
  assert.deepEqual([sent[0][0], sent[0][4]], ["vantor", 2], "from Vantor Prime, two days out");
  const loaded = sent[0][3];
  // Three days' worth of what Bastion brings in: the trip's two days and half again.
  assert.ok(Math.abs(loaded - m.need.bastion.ration_crates * 3) < 1, `${loaded} crates loaded`);
  const made = m.ports.vantor.made.ration_crates;
  const used = m.ports.vantor.use.ration_crates;
  assert.ok(before - has(game, "vantor", "ration_crates") >= loaded - (made - used) - 1, "what was loaded left Vantor's stores that day");
  const waiting = has(game, "bastion", "ration_crates");
  days(game, 1);
  assert.ok(has(game, "bastion", "ration_crates") < waiting, "still on its way: Bastion only uses what it has");
  assert.equal(haulsTo(game, "bastion", "ration_crates").length, 2, "and, badly short, it has a second haul sent");
  days(game, 1);
  assert.ok(has(game, "bastion", "ration_crates") > waiting + loaded * 0.3, "and then the first is there");
  // While it's short, the map says why: what's on its way and when.
  game.world.places.bastion.goods.food = 60;
  days(game, 1);
  assert.match(whyShort(game.world, "bastion", "ration_crates"), /^[\d,]+ ration crates from Vantor Prime are due (tomorrow|in 2 days)$/);
  // A port the player hasn't heard of isn't named.
  assert.match(whyShort(game.world, "bastion", "ration_crates", () => null), /from a port you don't know of/);
}));

test("a strike stops what's made, the port runs down, and the ports it supplies feel it days later and recover", () => only(() => {
  const struck = newGame();
  const calm = newGame();
  days(struck, 3);
  days(calm, 3);
  begin(struck, "cinder", "cinder_picket_fight", 30);
  days(struck, 6);
  days(calm, 6);
  assert.ok(level(struck, "cinder", "jump_fuel") < 80, `Cinder is at ${level(struck, "cinder", "jump_fuel")}`);
  assert.equal(whyShort(struck.world, "cinder", "jump_fuel"), "Nothing's being made here");
  assert.equal(placeNow(struck, "cinder").goods.find((good) => good.id === "fuel").why, "Nothing's being made here");
  // Korrath Forge has all its fuel from Cinder Reach.
  assert.ok(level(struck, "korrath", "jump_fuel") > 75, "not yet felt at Korrath");
  days(struck, 18);
  days(calm, 18);
  assert.ok(level(struck, "cinder", "jump_fuel") <= 35, `Cinder is down to what it keeps back: ${level(struck, "cinder", "jump_fuel")}`);
  assert.ok(level(struck, "korrath", "jump_fuel") < level(calm, "korrath", "jump_fuel") - 20, `Korrath has ${level(struck, "korrath", "jump_fuel")} against ${level(calm, "korrath", "jump_fuel")}`);
  assert.ok(level(struck, "korrath", "jump_fuel") < 80);
  assert.match(whyShort(struck.world, "korrath", "jump_fuel"), /Cinder Reach has (none|little) to spare \(nothing's being made there\)|from Cinder Reach (is|are) due/);
  // Haven has the Deepyards too, and is hurt less.
  assert.ok(level(struck, "haven", "jump_fuel") > level(struck, "korrath", "jump_fuel"));
  // Fuel costs more where it's short.
  assert.ok(supplyFactor(struck, "korrath", "fuel") > supplyFactor(calm, "korrath", "fuel"));
  // The strike ends, and it all comes back.
  days(struck, 6);
  assert.equal(struck.world.places.cinder.events.length, 0, "the strike is over");
  days(struck, 45);
  assert.ok(level(struck, "cinder", "jump_fuel") > 80 && level(struck, "korrath", "jump_fuel") > 80, `Cinder ${level(struck, "cinder", "jump_fuel")}, Korrath ${level(struck, "korrath", "jump_fuel")}`);
}));

test("each thing that goes on at a port does what it says: more used, taken, brought, shut in, lost, and a glut", () => only(() => {
  const run = (place, event, good, length = 8) => {
    const game = newGame();
    const calm = newGame();
    days(game, 2);
    days(calm, 2);
    begin(game, place, event, length + 2);
    days(game, length);
    days(calm, length);
    return { game, calm, now: level(game, place, good), usual: level(calm, place, good) };
  };
  // The refugees use more than twice the food and medicine.
  const surge = run("bastion", "bastion_surge", "ration_crates");
  assert.ok(surge.now < surge.usual - 12, `Bastion's food: ${surge.now} against ${surge.usual}`);
  assert.match(whyShort(surge.game.world, "bastion", "ration_crates") ?? "It's being used up faster than usual", /being used up faster than usual/);
  // A fever takes medicine off the market.
  const fever = run("wheel", "fever", "medicine_crates");
  assert.ok(fever.now < fever.usual - 15, `the Wheel's medicine: ${fever.now} against ${fever.usual}`);
  assert.match(whyShort(fever.game.world, "wheel", "medicine_crates"), /^It's being taken off the market/);
  // The raiders' haul is brought to Kessara: plenty.
  const score = run("kessara", "kessara_score", "medicine_crates", 6);
  assert.ok(score.now > 125, `Kessara's medicine: ${score.now}`);
  assert.equal(placeNow(score.game, "kessara").goods.find((good) => good.id === "medicine").level, "plenty");
  // A debt war: nothing gets in, so what was sent waits off the port, and its fuel only goes down.
  const war = run("kessara", "kessara_debt_war", "jump_fuel", 7);
  assert.ok(war.now < war.usual - 8, `Kessara's fuel: ${war.now} against ${war.usual}`);
  assert.ok(haulsTo(war.game, "kessara", "jump_fuel").every((haul) => haul[4] === 0), "what was on its way is waiting to come in");
  assert.equal(haulsTo(war.game, "kessara", "ration_crates").some((haul) => haul[4] > 0) || level(war.game, "kessara", "ration_crates") > 85, true, "its food isn't shut out");
  // And the Gilded Wheel, which has its fuel from Kessara, gets none meanwhile.
  assert.ok(level(war.game, "wheel", "jump_fuel") < level(war.calm, "wheel", "jump_fuel") - 5);
  // A convoy lost: what was sent never arrives.
  const lost = run("wheel", "convoy_lost", "ration_crates", 8);
  assert.ok(lost.now < lost.usual - 15, `the Wheel's food: ${lost.now} against ${lost.usual}`);
  assert.match(whyShort(lost.game.world, "wheel", "ration_crates"), /^What was sent here never arrived/);
  // A harvest fills Tessen Colony past what it usually holds, and food is cheap there.
  const harvest = run("frontier", "frontier_harvest", "ration_crates", 6);
  assert.ok(harvest.now > 125, `Tessen's food: ${harvest.now}`);
  assert.ok(supplyFactor(harvest.game, "frontier", "food") < 0.95);
  // A furnace gone cold: less is made, and the forge says so.
  const cold = run("korrath", "korrath_reline", "parts_crates", 10);
  assert.ok(cold.now < cold.usual - 12, `Korrath's parts: ${cold.now} against ${cold.usual}`);
  assert.match(whyShort(cold.game.world, "korrath", "parts_crates") ?? "Less is being made here than usual", /Less is being made here than usual/);
}));

test("the Meridian's buying and selling move real crates, and a port can sell only what it has", () => quietly(() => {
  const game = newGame();
  game.ship.at = "haven";
  game.location = "haven";
  game.walk = null;
  game.credits = 100000;
  const m = model();
  const before = has(game, "haven", "ration_crates");
  shipCommand(game, { action: "sell", id: "food" });
  assert.equal(Math.round(has(game, "haven", "ration_crates") - before), 5, "a lot of food is five crates, and Haven has five more");
  assert.ok(Math.abs(has(game, "haven", "ration_crates") - before - 5) < 0.01, "to the crate, so that the count on the page moves by five");
  const row = () => shipView(game).trade.find((one) => one.id === "food");
  assert.match(row().has, /^[\d,]+ ration crates$/);
  shipCommand(game, { action: "buy", id: "food" });
  assert.equal(Math.round(has(game, "haven", "ration_crates") - before), 0, "and five fewer when she buys them back");
  // A big port hardly notices a lot; a small one does.
  const price = supplyFactor(game, "haven", "medicine");
  tradedAt(game, "haven", "medicine");
  assert.ok(supplyFactor(game, "haven", "medicine") - price < 0.02);
  const small = supplyFactor(game, "frontier", "medicine");
  tradedAt(game, "frontier", "medicine");
  assert.ok(supplyFactor(game, "frontier", "medicine") - small > 0.05, "a crate is a tenth of what Tessen Colony usually holds");
  // With fewer than a lot left there's none to sell.
  game.world.places.haven.goods.food = (4 / m.ports.haven.holds.ration_crates.usual) * 100;
  assert.equal(noneLeft(game, "haven", "food"), true);
  assert.equal(row().none, true);
  assert.throws(() => shipCommand(game, { action: "buy", id: "food" }), /any left/);
  game.world.places.haven.goods.food = (6 / m.ports.haven.holds.ration_crates.usual) * 100;
  assert.equal(noneLeft(game, "haven", "food"), false);
}));

test("a save from before has its levels kept and its hauls begun, and a place with no file keeps the older rule", (t) => {
  const old = newGame();
  old.world.places.haven.goods.fuel = 62;
  delete old.world.hauls;
  delete old.world.ports;
  const loaded = JSON.parse(JSON.stringify(old));
  assert.equal(level(loaded, "haven", "jump_fuel"), 62, "the level it had is the amount it has");
  quietly(() => days(loaded, 1));
  assert.ok(loaded.world.hauls.length > 80, "every port that sends for something has a haul on its way, out of step with the rest");
  assert.ok(new Set(loaded.world.hauls.map((haul) => haul[4])).size >= 3);
  assert.ok(level(loaded, "haven", "jump_fuel") < 70);
  // A place the world keeps supplies for, with no file in world/ports: its level drifts as it always did.
  DAILY.places.asterion = structuredClone(DAILY.places.orrin);
  t.after(() => delete DAILY.places.asterion);
  const game = newGame();
  game.world.places.asterion.goods.food = 40;
  quietly(() => days(game, 20));
  const now = game.world.places.asterion.goods.food;
  assert.ok(now > 55 && now < 110, `it's come back toward normal by itself: ${now}`);
  for (const id of Object.keys(game.world.places)) game.seenLore.push(`place:${id}`);
  assert.equal(placeNow(game, "asterion").goods[0].has, undefined, "and nobody counts crates there");
  assert.deepEqual(portNow(game, "asterion"), []);
});

test("the Story board has the ports and the goods, and saves them through the game's own readers", () => {
  const ports = boardWorldList("port");
  assert.equal(ports.length, 19);
  assert.ok(ports.every((one) => one.written && WORLD_PORTS[one.id] && LOCATIONS[one.id].name === one.name));
  assert.deepEqual(boardWorldList("goods").map((one) => one.name), ["Food", "Fuel", "Medicine", "Parts", "Water and air", "Comforts"]);
  const haven = boardWorldItem("port", "haven");
  assert.equal(haven.kind, "port");
  assert.equal(haven.value.name, "Haven Station");
  assert.deepEqual(haven.problems, []);
  assert.ok(haven.links.from.some((one) => one.id === "frontier" && one.goods.includes("ration crates") && one.days === 4));
  assert.ok(haven.links.to.some((one) => one.id === "wheel" && one.goods.includes("ration crates")));
  assert.ok(haven.links.through["ration crates"] > 100, "what goes through it in a day counts what's sent on");
  assert.ok(haven.lists.goods.includes("jump fuel") && haven.lists.ports.includes("the Veshti Deepyards") && !haven.lists.ports.includes("Haven Station"));
  // A changed line is saved into the copy, and the game plays it at once.
  const orrin = boardWorldItem("port", "orrin");
  const changed = orrin.text.replace("ration crates: usually 50", "ration crates: usually 80");
  assert.notEqual(changed, orrin.text);
  assert.deepEqual(saveBoardWorldItem("port", "orrin", changed), { saved: true, problems: [] });
  assert.equal(model().ports.orrin.holds.ration_crates.usual, 80);
  assert.match(fs.readFileSync(path.join(portsDir, "orrin.txt"), "utf8"), /ration crates: usually 80/);
  // One the reader can't follow isn't saved, and one that names what isn't there is saved with what the checker says.
  const refused = saveBoardWorldItem("port", "orrin", orrin.text.replace("ration crates: usually 50", "ration crates: plenty"));
  assert.equal(refused.saved, false);
  assert.match(refused.problems[0], /usually and how many/);
  const odd = saveBoardWorldItem("port", "orrin", orrin.text.replace("from Lumen Sanctuary", "from Atlantis"));
  assert.equal(odd.saved, true);
  assert.ok(odd.problems.some((one) => /there's no place called Atlantis/.test(one)), odd.problems.join(" | "));
  assert.deepEqual(saveBoardWorldItem("port", "orrin", orrin.text), { saved: true, problems: [] });
  assert.equal(model().ports.orrin.holds.ration_crates.usual, 50);
  // A tree of goods the same way.
  const food = boardWorldItem("goods", "food");
  assert.equal(food.value.stands.supply, "food");
  assert.ok(food.links.where["ration crates"].makers.some((maker) => maker.id === "frontier"));
  assert.ok(food.links.where["ration crates"].made > food.links.where["ration crates"].used);
  const renamed = saveBoardWorldItem("goods", "food", food.text.replace("- provisions, by the hamper", "- fine provisions, by the hamper"));
  assert.equal(renamed.saved, true);
  assert.ok(portsProblems().some((one) => /there's no good called provisions/.test(one)), "the ports that named it are told");
  assert.deepEqual(saveBoardWorldItem("goods", "food", food.text), { saved: true, problems: [] });
  assert.deepEqual(portsProblems(), []);
  assert.equal(saveBoardWorldItem("goods", "food", "Food\n").saved, false);
  assert.throws(() => boardWorldItem("port", "atlantis"), /has no file in world\/ports yet/);
  assert.ok(Object.keys(WORLD_GOODS).length === 6 && STAR_MAP.places.haven);
});
