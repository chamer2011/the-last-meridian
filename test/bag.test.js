// The grid inventory (src/bag.js): every item's size and weight; the bag matched to what the player has, whatever gives
// or takes things; moving, stacking and splitting; gear on and off, the hip and the belt; what's carried loose; the load
// and tiring; buying with no room; piles on the floor and things that hold something; what the beaten leave; and the
// belt and the sidearm in a fight.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-bag-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { ITEMS } = await import("../src/data.js");
const bag = await import("../src/bag.js");
const { addItem, buy, passTime, publicState, removeItem } = await import("../src/rules.js");
const { combatAction, startCombat } = await import("../src/rules.js");
const { clearMaps, walkCommand, walkView } = await import("../src/walk.js");
const { INVENTORY, WORLD_MAPS, bagProblems } = await import("../src/world.js");
const { LOCATIONS } = await import("../src/data.js");

const newGame = (seed = 42) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const view = (game) => publicState(game).bag;
const at = (game, grid, id) => game.bag[grid].find((one) => one.id === id);
const run = (game, body) => bag.bagCommand(game, body);

test("every item has a size, a weight and a stack, and fits in the pack", () => {
  for (const [id, item] of Object.entries(ITEMS)) {
    const { w, h } = bag.sizeOf(item);
    assert.ok(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1, `${id} has a size`);
    assert.ok(w <= INVENTORY.pack.cols && h <= INVENTORY.pack.rows, `${id} fits in the pack`);
    assert.ok(Number.isFinite(bag.weightOf(item)) && bag.weightOf(item) >= 0, `${id} has a weight`);
    assert.ok(bag.stackOf(item) >= 1, `${id} has a stack`);
    assert.match(String(item.size), /^\d+x\d+$/, `${id}'s file says its size`);
  }
  assert.ok(bag.stackOf(ITEMS.ration_pack) > 1 && bag.stackOf(ITEMS.medkit) > 1, "supplies stack");
  assert.equal(bag.stackOf(ITEMS.service_rifle), 1);
  assert.deepEqual(bag.sizeOf(ITEMS.service_rifle), { w: 4, h: 1 });
});

test("a new game's bag: gear in hand and worn, fight supplies on the belt, small things in a pocket, and reading it changes nothing", () => {
  const game = newGame();
  const before = structuredClone(game);
  const shown = view(game);
  assert.deepEqual(game, before, "showing the bag changes nothing in the save");
  assert.equal(shown.gear.weapon?.id, game.equipped.weapon);
  assert.equal(shown.gear.armor?.id, game.equipped.armor);
  const belt = shown.belt.filter(Boolean);
  assert.ok(belt.length > 0 && belt.every((one) => one.fight), "supplies that work in a fight start on the belt");
  for (const item of [...shown.pockets.items, ...shown.pack.items]) assert.ok(item.x + item.w <= (shown.pockets.items.includes(item) ? shown.pockets.cols : shown.pack.cols));
  assert.ok(shown.pockets.items.every((one) => one.w * one.h === 1), "only one-square things in a pocket");
  // Everything the player has is somewhere, exactly once.
  const placed = {};
  for (const slot of Object.values(shown.gear)) if (slot) placed[slot.id] = (placed[slot.id] ?? 0) + 1;
  for (const item of [...shown.belt.filter(Boolean), ...shown.pockets.items, ...shown.pack.items, ...shown.loose]) placed[item.id] = (placed[item.id] ?? 0) + item.n;
  assert.deepEqual(placed, game.inventory);
  assert.equal(shown.maxLoad, INVENTORY.load.base + INVENTORY.load.perMight * publicState(game).stats.might);
});

test("whatever gives or takes things, the bag follows: stacks first, then a place of its own, and what doesn't fit is carried loose", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "ration_pack", 6);
  addItem(game, "service_rifle");
  let shown = view(game);
  assert.equal(shown.pack.items.find((one) => one.id === "ration_pack")?.n, 6);
  assert.ok(shown.pack.items.some((one) => one.id === "service_rifle" && one.w === 4));
  addItem(game, "ration_pack", 6);
  shown = view(game);
  const rations = shown.pack.items.filter((one) => one.id === "ration_pack");
  assert.deepEqual(rations.map((one) => one.n).sort((a, b) => b - a), [10, 2], "a stack fills to ten, then a new one starts");
  removeItem(game, "ration_pack", 11);
  shown = view(game);
  assert.equal(shown.pack.items.filter((one) => one.id === "ration_pack").reduce((sum, one) => sum + one.n, 0), 1);
  // A pack full of plate armor: the rest is in the player's hands.
  addItem(game, "marine_plate", 6);
  shown = view(game);
  assert.ok(shown.loose.some((one) => one.id === "marine_plate"), "what has no room is carried loose");
  assert.ok(shown.overloaded, "and that much is too heavy");
});

test("moving things: anywhere they fit, only small things in a pocket, stacks join, and a stack splits", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "service_rifle");
  addItem(game, "ration_pack", 8);
  bag.settleBag(game);
  const rifle = at(game, "pack", "service_rifle");
  run(game, { action: "move", from: { at: "pack", x: rifle.x, y: rifle.y }, to: { at: "pack", x: 4, y: 4 } });
  assert.deepEqual([at(game, "pack", "service_rifle").x, at(game, "pack", "service_rifle").y], [4, 4]);
  assert.throws(() => run(game, { action: "move", from: { at: "pack", x: 4, y: 4 }, to: { at: "pack", x: 6, y: 4 } }), /doesn't fit/, "off the edge");
  assert.throws(() => run(game, { action: "move", from: { at: "pack", x: 4, y: 4 }, to: { at: "pockets", x: 0, y: 1 } }), /one square/, "a rifle isn't pocket-sized");
  const rations = at(game, "pack", "ration_pack");
  run(game, { action: "split", from: { at: "pack", x: rations.x, y: rations.y } });
  const halves = game.bag.pack.filter((one) => one.id === "ration_pack");
  assert.deepEqual(halves.map((one) => one.n).sort(), [4, 4]);
  run(game, { action: "move", from: { at: "pack", x: halves[1].x, y: halves[1].y }, to: { at: "pack", x: halves[0].x, y: halves[0].y } });
  assert.deepEqual(game.bag.pack.filter((one) => one.id === "ration_pack").map((one) => one.n), [8], "dropped onto its own kind, it joins the stack");
  run(game, { action: "move", from: { at: "pack", x: halves[0].x, y: halves[0].y }, to: { at: "pockets", x: 3, y: 1 } });
  assert.equal(at(game, "pockets", "ration_pack")?.n, 8);
  assert.equal(game.inventory.ration_pack, 8, "moving changes nothing that's owned");
});

test("gear: a weapon goes in hand with the old one back in the bag, only a small one on the hip, armor worn, and taking off puts it away", () => {
  const game = newGame();
  addItem(game, "service_rifle");
  addItem(game, "flak_vest");
  bag.settleBag(game);
  const before = game.equipped.weapon;
  const rifle = at(game, "pack", "service_rifle");
  const reply = run(game, { action: "move", from: { at: "pack", x: rifle.x, y: rifle.y }, to: { at: "weapon" } });
  assert.equal(game.equipped.weapon, "service_rifle");
  assert.match(reply.said, /In hand: the Service Rifle/);
  assert.ok(view(game).pack.items.some((one) => one.id === before) || view(game).pockets.items.some((one) => one.id === before), "the old weapon is back in the bag");
  assert.throws(() => run(game, { action: "move", from: { at: "weapon" }, to: { at: "sidearm" } }), /hip/, "a rifle doesn't go on the hip");
  const pistol = [...game.bag.pack, ...game.bag.pockets].find((one) => one.id === before);
  run(game, { action: "move", from: { at: game.bag.pack.includes(pistol) ? "pack" : "pockets", x: pistol.x, y: pistol.y }, to: { at: "sidearm" } });
  assert.equal(game.equipped.sidearm, before);
  run(game, { action: "equip", from: { at: "pack", ...pick(game, "flak_vest") } });
  assert.equal(game.equipped.armor, "flak_vest");
  run(game, { action: "stow", from: { at: "armor" } });
  assert.equal(game.equipped.armor, null);
  assert.ok(view(game).pack.items.some((one) => one.id === "flak_vest"));
  // Losing the only one of something takes it off the hip too.
  removeItem(game, before);
  assert.equal(game.equipped.sidearm, null);
});
const pick = (game, id) => {
  const one = game.bag.pack.find((entry) => entry.id === id);
  return { x: one.x, y: one.y };
};

test("the belt: supplies only, used from it, and in a fight only the belt's supplies are on offer, each use taking one off it", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "medkit", 3);
  addItem(game, "energy_cell", 2);
  addItem(game, "lockbreaker");
  bag.settleBag(game);
  const cell = at(game, "pack", "energy_cell");
  assert.throws(() => run(game, { action: "move", from: { at: "pockets", ...pocketOf(game, "lockbreaker") }, to: { at: "belt", i: 3 } }), /supplies/);
  run(game, { action: "move", from: { at: "pack", x: cell.x, y: cell.y }, to: { at: "belt", i: 3 } });
  assert.equal(game.bag.belt[3]?.id, "energy_cell");
  startCombat(game, "dock_thug");
  const offered = game.combat && publicState(game).combat.actions.filter((one) => one.action.type === "item").map((one) => one.action.id);
  const onBelt = game.bag.belt.filter(Boolean).map((one) => one.id);
  assert.deepEqual([...offered].sort(), [...new Set(onBelt)].sort(), "only what's on the belt");
  const cells = game.inventory.energy_cell;
  combatAction(game, { type: "item", id: "energy_cell" });
  assert.equal(game.inventory.energy_cell, cells - 1);
  assert.equal(game.bag.belt[3]?.n ?? 0, 1, "it came off the belt");
  if (game.combat) assert.throws(() => combatAction(game, { type: "item", id: "lockbreaker" }), /belt/);
  assert.throws(() => run(game, { action: "move", from: { at: "belt", i: 3 }, to: { at: "pack", x: 0, y: 4 } }), /fight/, "no rearranging in a fight");
});
test("the same supply in two places on the belt is one button in a fight, with both counted", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "medkit", 6);
  bag.settleBag(game);
  game.bag.belt = [{ id: "medkit", n: 4 }, { id: "medkit", n: 3 }, null, null];
  game.inventory.medkit = 7;
  bag.settleBag(game);
  startCombat(game, "dock_thug");
  const kits = publicState(game).combat.actions.filter((one) => one.action.type === "item" && one.action.id === "medkit");
  assert.equal(kits.length, 1);
  assert.match(kits[0].label, /Medkit x7/);
});
const pocketOf = (game, id) => {
  const one = game.bag.pockets.find((entry) => entry.id === id);
  return { x: one.x, y: one.y };
};

test("a sidearm can be drawn in a fight, which takes the turn and changes the weapon used, and drawn back", () => {
  const game = newGame();
  addItem(game, "service_rifle");
  bag.settleBag(game);
  const pistol = game.equipped.weapon;
  game.equipped.weapon = "service_rifle";
  game.equipped.sidearm = pistol;
  bag.settleBag(game);
  startCombat(game, "dock_thug");
  const draw = publicState(game).combat.actions.find((one) => one.action.type === "draw");
  assert.match(draw.label, new RegExp(`Draw your ${ITEMS[pistol].name}`));
  assert.equal(publicState(game).combatProfile.weapon, "Service Rifle");
  combatAction(game, { type: "draw" });
  if (game.combat) {
    assert.equal(publicState(game).combatProfile.weapon, ITEMS[pistol].name);
    assert.match(publicState(game).combat.actions.find((one) => one.action.type === "draw").label, /Back to your Service Rifle/);
  }
  const plain = newGame(7);
  plain.equipped.sidearm = null;
  startCombat(plain, "dock_thug");
  assert.ok(!publicState(plain).combat.actions.some((one) => one.action.type === "draw"), "nothing on the hip, nothing to draw");
});

test("carrying more than the load makes the player tire faster, and buying with no room is refused", () => {
  const light = newGame();
  const heavy = newGame();
  addItem(heavy, "marine_plate", 3);
  assert.ok(!bag.overloaded(light) && bag.overloaded(heavy));
  light.needs.fatigue = 0;
  heavy.needs.fatigue = 0;
  passTime(light, 4, "active");
  passTime(heavy, 4, "active");
  assert.ok(heavy.needs.fatigue > light.needs.fatigue * 1.5, `${heavy.needs.fatigue} against ${light.needs.fatigue}`);
  const full = newGame();
  addItem(full, "marine_plate", 5);
  addItem(full, "smugglers_coat", 6);
  addItem(full, "flak_vest", 6);
  full.credits = 100000;
  const place = Object.keys(LOCATIONS).find((id) => LOCATIONS[id].market?.includes("medkit") && LOCATIONS[id].market.some((one) => ITEMS[one]?.type === "armor"));
  full.location = place;
  const armor = LOCATIONS[place].market.find((one) => ITEMS[one]?.type === "armor");
  const owned = full.inventory[armor] ?? 0;
  assert.throws(() => buy(full, armor), /no room/);
  assert.equal(full.inventory[armor] ?? 0, owned, "and nothing was bought");
  const kits = full.inventory.medkit ?? 0;
  buy(full, "medkit");
  assert.equal(full.inventory.medkit, kits + 1, "something small still fits");
});

test("putting something down leaves a pile in the room that opens beside the pack, and taking the last of it clears it", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "ration_pack", 3);
  bag.settleBag(game);
  const rations = at(game, "pack", "ration_pack");
  run(game, { action: "drop", from: { at: "pack", x: rations.x, y: rations.y } });
  assert.equal(game.inventory.ration_pack ?? 0, 0);
  const pile = walkView(game).things.find((one) => one.pile);
  assert.ok(pile && pile.holds, "the pile is in the room");
  run(game, { action: "open", key: pile.store });
  const open = view(game).open;
  assert.equal(open.name, "Things you left");
  assert.equal(open.items[0].id, "ration_pack");
  run(game, { action: "take", from: { at: "open", x: open.items[0].x, y: open.items[0].y } });
  assert.equal(game.inventory.ration_pack, 3);
  assert.ok(!walkView(game).things.some((one) => one.pile), "an empty pile is gone");
  assert.throws(() => run(game, { action: "drop", from: { at: "pockets", ...storyItem(game) } }), /hold on/, "story items stay");
});
const storyItem = (game) => {
  addItem(game, "beacon_shard");
  bag.settleBag(game);
  return pocketOf(game, "beacon_shard");
};

test("a thing with a holds line opens with what's in it, keeps what's taken out and put in, and leaving the room shuts it", () => {
  const thing = WORLD_MAPS.meridian.levels.bridge.things.l;
  const saved = structuredClone(thing);
  try {
    thing.holds = { medkit: 2, service_rifle: 1 };
    clearMaps();
    const game = newGame();
    const locker = walkView(game).things.find((one) => one.name === "Ready room locker");
    assert.ok(locker.holds && locker.store);
    run(game, { action: "open", key: locker.store });
    const shut = structuredClone(game);
    publicState(game);
    assert.deepEqual(game, shut, "showing what's open changes nothing in the save");
    let open = view(game).open;
    assert.deepEqual(open.items.map((one) => one.id).sort(), ["medkit", "service_rifle"]);
    const rifle = open.items.find((one) => one.id === "service_rifle");
    run(game, { action: "move", from: { at: "open", x: rifle.x, y: rifle.y }, to: { at: "pack", x: 0, y: 4 } });
    assert.equal(game.inventory.service_rifle, 1);
    addItem(game, "ration_pack", 2);
    bag.settleBag(game);
    const rations = at(game, "pack", "ration_pack");
    run(game, { action: "move", from: { at: "pack", x: rations.x, y: rations.y }, to: { at: "open", x: 5, y: 4 } });
    open = view(game).open;
    assert.deepEqual(open.items.map((one) => one.id).sort(), ["medkit", "ration_pack"]);
    assert.equal(game.inventory.ration_pack ?? 0, 0);
    // Out of the room, it's shut, and still holds what was left in it.
    walkCommand(game, { action: "go", to: `exit:${walkView(game).exits[0].key}` });
    assert.equal(view(game).open, null);
    assert.deepEqual(game.stores[locker.store].items.map((one) => one.id).sort(), ["medkit", "ration_pack"]);
  } finally {
    WORLD_MAPS.meridian.levels.bridge.things.l = saved;
    clearMaps();
  }
});

test("the people beaten in a fight leave their loot on the floor, a machine only what its file says, and a weapon now and then", () => {
  const game = newGame();
  const left = bag.leaveLoot(game, [{ id: "dock_thug", weapon: "Shock Baton", loot: null }], () => 0);
  assert.ok(left.length >= 2, "with every roll coming up, the usual chances and the weapon");
  const pile = walkView(game).things.find((one) => one.pile);
  assert.equal(pile.name, "What they left");
  run(game, { action: "open", key: pile.store });
  assert.ok(view(game).open.items.some((one) => one.id === "shock_baton"));
  const drone = newGame();
  assert.deepEqual(bag.leaveLoot(drone, [{ id: "drone", machine: true, loot: null }], () => 0), []);
  assert.deepEqual(bag.leaveLoot(drone, [{ id: "drone", machine: true, loot: { energy_cell: 100 } }], () => 0.5), ["Energy Cell"]);
});

test("the checker names an item that's the wrong size, and loot that isn't an item or has a chance past 100", () => {
  const items = { rifle: { size: "4x1" }, wall: { size: "9x2" }, blob: { size: "big" }, knife: {} };
  const problems = bagProblems(items, { doc: { combat: { loot: { rifle: 50, ghost_gun: 10 } } } }, { drone: { loot: { knife: 150 } } }, { cols: 8, rows: 5 });
  assert.deepEqual(problems, [
    "items/wall.txt: at 9x2 it's bigger than the pack, which is 8 by 5.",
    "items/blob.txt: its size should be squares across by down, like 2x1, not big.",
    "characters/doc.txt: its loot names ghost_gun, which isn't one of the items in world/items.",
    "enemies/drone.txt: the chance of knife in its loot is 150, and it should be from 0 to 100.",
  ]);
});
