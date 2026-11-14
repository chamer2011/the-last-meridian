// The things to find, step 2 of the loot plan: 300 new items in world/items, Claude's drafts, in ten families (clothes,
// weapons, armor, food and drink, medicine, tools and gadgets, parts and salvage, papers and data, personal things,
// contraband), each saying which kinds of container it turns up in and how rare it is, with a drawing of its own; two
// new things an item can do, ease stress and carry words to read; and the character creator's shop left as it was.
// Nothing is in a container yet: that's step 3.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-loot-items-"));

const { ITEM, parseWorldText } = await import("../public/world-text.js");
const { ITEMS, STATS } = await import("../src/data.js");
const { SKILLS, CONTEXTS } = await import("../src/character-data.js");
const { createGameFromDraft, creatorSetup, normalizeDraft, randomDraft } = await import("../src/creator.js");
const { addItem, publicState, useItem } = await import("../src/rules.js");
const bag = await import("../src/bag.js");
const { walkView } = await import("../src/walk.js");
const loot = await import("../src/loot.js");
const { parseLootText } = await import("../public/loot-text.js");

const itemsDir = path.join(path.dirname(loot.LOOT_DIR), "items");
const enemiesDir = path.join(path.dirname(loot.LOOT_DIR), "enemies");
const kinds = parseLootText(fs.readFileSync(path.join(loot.LOOT_DIR, "containers.txt"), "utf8")).value.kinds;
const found = Object.entries(ITEMS).filter(([, item]) => item.foundIn?.length);
const drafts = Object.entries(ITEMS).filter(([, item]) => item.draft);
const squares = (item) => String(item.size).split("x").map(Number);
// What the inventory's squares hold of a drawing at its 9px type (public/style.css): 26px squares less the border,
// 5.4px a character across and 9.45px a row down.
const across = (w) => Math.floor((w * 26 - 4) / 5.4);
const down = (h) => Math.floor((h * 26 - 4) / 9.45);
const plain = (words) => String(words).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, "");
const newGame = () => createGameFromDraft(randomDraft({ seed: 42, archetype: "officer" }));

test("the 300 things to find are Claude's drafts, each in a file of its own that reads with nothing wrong", () => {
  assert.equal(drafts.length, 300);
  for (const [id, item] of drafts) {
    assert.equal(item.draft, "Claude's, not yet edited by the owner", id);
    const { problems } = parseWorldText(fs.readFileSync(path.join(itemsDir, `${id}.txt`), "utf8"), ITEM, id);
    assert.deepEqual(problems, [], id);
  }
  assert.ok(found.length >= 320, "the drafts and the game's own items that turn up too");
  assert.equal(loot.lootItemCount(), found.length);
  assert.deepEqual(loot.lootProblems(), []);
});

test("everything found in containers is something they hold, with a rarity, its own drawing that fits its squares, and room in every container it's in", () => {
  const sizes = new Map(kinds.map((kind) => [kind.name, kind.size]));
  for (const [id, item] of found) {
    assert.ok(["weapon", "armor", "consumable", "gadget", "goods"].includes(item.type), `${id} is ${item.type}`);
    assert.ok(["common", "uncommon", "rare"].includes(item.rarity), `${id} says how rare it is`);
    assert.ok(item.price >= 1 && item.weight > 0, `${id} has a price and a weight`);
    assert.ok(item.desc?.length > 10, `${id} has its line`);
    const [w, h] = squares(item);
    assert.ok(item.art?.length, `${id} has a drawing`);
    assert.ok(item.art.length <= down(h) && item.art.every((row) => row.length <= across(w)), `${id}'s drawing fits its ${item.size} squares`);
    for (const kind of item.foundIn) {
      const box = sizes.get(kind);
      assert.ok(box, `${id}: ${kind} is a kind of container`);
      assert.ok(w <= box.cols && h <= box.rows, `${id} (${item.size}) fits in a ${kind} (${box.cols}x${box.rows})`);
    }
  }
});

test("weapons, armor and supplies sit on the game's own numbers, and the new gadgets add one point to a skill nothing else helps", () => {
  for (const [id, item] of drafts) {
    if (item.type === "weapon") {
      assert.ok(item.damage[0] >= 2 && item.damage[1] <= 14 && item.damage[0] < item.damage[1], `${id}: damage ${item.damage}`);
      assert.ok(STATS[item.stat] && SKILLS[item.skill], `${id}: ${item.stat} and ${item.skill}`);
    }
    if (item.type === "armor") assert.ok(item.defense >= 0 && item.defense <= 4, `${id}: defense ${item.defense}`);
    if (item.type === "consumable") {
      const effect = Object.entries(item.effect ?? {});
      assert.ok(effect.length, `${id} does something`);
      for (const [key, amount] of effect) {
        assert.ok(["hp", "energy", "stress", "dress"].includes(key), `${id}: ${key}`);
        assert.ok(amount > 0, `${id}: ${key} ${amount}`);
      }
    }
    for (const [skill, amount] of Object.entries(item.fx?.skills ?? {})) assert.ok(SKILLS[skill] && amount === 1, `${id}: ${skill} ${amount}`);
    for (const [where, amount] of Object.entries(item.fx?.context ?? {})) assert.ok(CONTEXTS[where] && amount === 1, `${id}: ${where} ${amount}`);
  }
  const helped = Object.values(ITEMS).filter((item) => !item.draft).flatMap((item) => Object.keys(item.fx?.skills ?? {}));
  for (const [id, item] of drafts) for (const skill of Object.keys(item.fx?.skills ?? {})) assert.ok(!helped.includes(skill), `${id} helps ${skill}, which a gadget already helps`);
  assert.equal(drafts.filter(([, item]) => item.type === "weapon").length, 31, "thirty weapons, and a ghost pistol among the contraband");
  assert.ok(drafts.filter(([, item]) => item.restricted).length >= 10, "contraband and the military's own aren't for sale to just anyone");
});

test("no two items share a name, and none of the drafts is named like an enemy's weapon, so nobody drops one in a fight", () => {
  const names = new Map();
  for (const [id, item] of Object.entries(ITEMS)) {
    for (const words of [plain(item.name), plain(id.replace(/_/g, " "))]) {
      assert.ok(!names.has(words) || names.get(words) === id, `${id} and ${names.get(words)} are both "${words}"`);
      names.set(words, id);
    }
  }
  const weapons = new Set(fs.readdirSync(enemiesDir).filter((file) => file.endsWith(".txt"))
    .map((file) => fs.readFileSync(path.join(enemiesDir, file), "utf8").match(/^weapon:\s*(.+)$/m)?.[1]).filter(Boolean).map(plain));
  for (const [id, item] of drafts) assert.ok(!weapons.has(plain(item.name)), `${id} is named like an enemy's weapon`);
});

test("every kind of container holds common, uncommon and rare things", () => {
  for (const kind of kinds) {
    const held = loot.itemsFoundIn(kind.name);
    for (const rarity of ["common", "uncommon", "rare"]) assert.ok(held.some((one) => one.rarity === rarity), `a ${kind.name} has ${rarity} things`);
  }
  assert.ok(loot.itemsFoundIn("armory").every(({ id }) => ITEMS[id].type !== "goods" || ITEMS[id].read), "an armory holds gear");
  assert.ok(loot.itemsFoundIn("medicine cabinet").every(({ id }) => ITEMS[id].type === "consumable"), "a medicine cabinet holds supplies");
});

test("letters, logs and keepsakes: dozens of things with words to read, none of them too long to show", () => {
  const readable = Object.entries(ITEMS).filter(([, item]) => item.read);
  assert.ok(readable.length >= 35, `${readable.length} things to read`);
  for (const [id, item] of readable) {
    assert.ok(item.read.length >= 40 && item.read.length <= 600, `${id}'s words are ${item.read.length} characters`);
    assert.ok(!/:\s*$/.test(item.read), `${id}'s words don't end in a colon`);
  }
});

test("reading something keeps its words in What you know, once; the window gets them; something with nothing written on it says so", () => {
  const game = newGame();
  bag.settleBag(game);
  addItem(game, "unsent_letter");
  addItem(game, "harmonica");
  bag.settleBag(game);
  const where = (id) => {
    for (const at of ["pockets", "pack"]) {
      const one = game.bag[at].find((entry) => entry.id === id);
      if (one) return { at, x: one.x, y: one.y };
    }
    return null;
  };
  const shown = [...publicState(game).bag.pockets.items, ...publicState(game).bag.pack.items].find((one) => one.id === "unsent_letter");
  assert.equal(shown.read, ITEMS.unsent_letter.read, "the window has the words to show");
  const lore = (game.lore ?? []).length;
  const first = bag.bagCommand(game, { action: "read", from: where("unsent_letter") });
  assert.match(first.said, /You read the Unsent Letter\. It's in What you know now\./);
  const kept = game.lore.find((entry) => entry.id === "item:unsent_letter");
  assert.equal(kept.name, "Unsent Letter");
  assert.equal(kept.text, ITEMS.unsent_letter.read);
  assert.equal(game.lore.length, lore + 1);
  const again = bag.bagCommand(game, { action: "read", from: where("unsent_letter") });
  assert.equal(again.said, "You read the Unsent Letter.");
  assert.equal(game.lore.length, lore + 1, "kept once");
  assert.equal(game.inventory.unsent_letter, 1, "reading it keeps it");
  assert.throws(() => bag.bagCommand(game, { action: "read", from: where("harmonica") }), /nothing written on the Harmonica/);
  // And in something that's open: a letter put down can be read where it lies.
  bag.bagCommand(game, { action: "drop", from: where("unsent_letter") });
  bag.bagCommand(game, { action: "open", key: walkView(game).things.find((one) => one.pile).store });
  const letter = publicState(game).bag.open.items.find((one) => one.id === "unsent_letter");
  assert.ok(letter, "the letter lies in the pile");
  assert.match(bag.bagCommand(game, { action: "read", from: { at: "open", x: letter.x, y: letter.y } }).said, /You read the Unsent Letter/);
});

test("a supply that eases the mind takes stress off, and says so", () => {
  const game = newGame();
  game.needs.stress = 50;
  addItem(game, "tea_brick");
  const said = useItem(game, "tea_brick");
  assert.ok(game.needs.stress < 50, `stress ${game.needs.stress}`);
  assert.match(said, /-\d+ stress/);
  game.needs.stress = 0;
  addItem(game, "sleeping_pills");
  assert.match(useItem(game, "sleeping_pills"), /no stress to ease/);
  assert.equal(game.needs.stress, 0);
  assert.ok(!bag.fightable(ITEMS.sleeping_pills), "something only for the nerves isn't for the belt in a fight");
  assert.ok(bag.fightable(ITEMS.ration_bar), "food that heals is");
});

test("the character creator's shop is as it was: the things only found in containers aren't for sale there", () => {
  const gear = new Set(creatorSetup().gear.map((one) => one.id));
  for (const [id] of drafts) assert.ok(!gear.has(id), `${id} isn't in the creator's shop`);
  for (const id of ["medkit", "sidearm", "flak_vest", "ration_pack", "tool_roll"]) assert.ok(gear.has(id), `${id} still is: a market sells it`);
  assert.ok(!gear.has("scrap"), "scrap was only for sale there by accident, and it's found in crates now");
  assert.deepEqual(normalizeDraft({ gear: { crew_jumpsuit: 1, medkit: 1 } }).gear, { medkit: 1 });
});
