// What's in the containers, step 1 of the loot plan: world/loot/containers.txt names the kinds of container, what a
// thing is called to be one, how big it is and how many things it holds, the rooms and places with more or fewer, and
// what the decks' furniture opens as; items say where they're found and how rare they are, and carry their own
// drawings. Nothing opens yet; this checks the files are read, written back and checked as they should be.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-loot-"));

const { parseLootText, writeLootText, readKindLine, readAdjustLine, readFurnitureLine, RARITIES } = await import("../public/loot-text.js");
const { ITEM, parseWorldText, writeWorldText } = await import("../public/world-text.js");
const { artFor } = await import("../public/item-art.js");
const { ITEMS } = await import("../src/data.js");
await import("../src/walk.js");
const loot = await import("../src/loot.js");

const fileText = fs.readFileSync(path.join(loot.LOOT_DIR, "containers.txt"), "utf8");
const itemsDir = path.join(path.dirname(loot.LOOT_DIR), "items");

test("the containers file reads with nothing wrong, and writes back exactly as it is", () => {
  const { value, problems } = parseLootText(fileText);
  assert.deepEqual(problems, []);
  assert.ok(value.kinds.length >= 10, "ten kinds of container");
  assert.ok(value.kinds.some((kind) => kind.name === "dresser") && value.kinds.some((kind) => kind.name === "armory"));
  assert.equal(writeLootText(value), fileText.replace(/\r\n/g, "\n"));
});

test("a kind's line says its words, its size and how many things, and a wrong one says what's wrong in plain words", () => {
  assert.deepEqual(readKindLine("dresser: called dresser, wardrobe; 6x4; 1 to 4 things"), { name: "dresser", words: ["dresser", "wardrobe"], size: { cols: 6, rows: 4 }, things: [1, 4] });
  assert.deepEqual(readKindLine("safe: called safe; 4x3; 2 things").things, [2, 2]);
  assert.match(readKindLine("dresser: called dresser; 6x4").problem, /three, separated by semicolons/);
  assert.match(readKindLine("dresser: dresser; 6x4; 1 to 4 things").problem, /starts with called/);
  assert.match(readKindLine("dresser: called dresser; six by four; 1 to 4 things").problem, /across by down/);
  assert.deepEqual(readAdjustLine("rooms called cabin, office: one more"), { what: "rooms", words: ["cabin", "office"], by: 1 });
  assert.deepEqual(readAdjustLine("places graveyard: two fewer"), { what: "places", words: ["graveyard"], by: -2 });
  assert.match(readAdjustLine("rooms called cabin: lots more").problem, /isn't a number/);
  assert.deepEqual(readFurnitureLine("barrel: crate"), { piece: "barrel", rules: [], otherwise: "crate" });
  const shelf = readFurnitureLine("shelf: pantry in The Galley; crate anywhere else");
  assert.deepEqual(shelf.rules, [{ kind: "pantry", rooms: ["The Galley"] }]);
  assert.equal(shelf.otherwise, "crate");
  const { problems } = parseLootText("# Loot\n\nKinds:\n- dresser: called dresser\nCrates:\n");
  assert.equal(problems.length, 2);
  assert.equal(problems[0].line, 4);
  assert.match(problems[1].message, /isn't a part of this file/);
});

test("a thing's name says what kind of container it is, the longer words winning, whole words only", () => {
  assert.equal(loot.containerKindOf("The bosun's dresser")?.name, "dresser");
  assert.equal(loot.containerKindOf("A weapons locker")?.name, "armory", "weapons locker is an armory, not a crew locker");
  assert.equal(loot.containerKindOf("Footlocker with no name on it")?.name, "crew locker");
  assert.equal(loot.containerKindOf("Sacks of ration grain")?.name, "pantry");
  assert.equal(loot.containerKindOf("Medicine cabinet")?.name, "medicine cabinet");
  assert.equal(loot.containerKindOf("A crowbar"), null, "bar is a whole word, not part of crowbar");
  assert.equal(loot.containerKindOf("The plot table"), null);
});

test("the furniture opens as its line says, by the room it stands in", () => {
  assert.equal(loot.furnitureKindOf("shelf", "The Galley")?.name, "pantry");
  assert.equal(loot.furnitureKindOf("shelf", "Engineering")?.name, "tool shelf");
  assert.equal(loot.furnitureKindOf("shelf", "The Quiet Room")?.name, "crate");
  assert.equal(loot.furnitureKindOf("locker", "The Armory")?.name, "armory");
  assert.equal(loot.furnitureKindOf("locker", "The Hot Bunks")?.name, "crew locker");
  assert.equal(loot.furnitureKindOf("desk", "The Bridge")?.name, "desk");
  assert.equal(loot.furnitureKindOf("chair", "The Bridge"), null, "a chair doesn't open");
});

test("rooms and places can hold more or fewer things, and both add up", () => {
  assert.equal(loot.lootAdjustment("meridian", "The Officers' Cabins"), 1);
  assert.equal(loot.lootAdjustment("vantor", "The Officers' Cabins"), 2);
  assert.equal(loot.lootAdjustment("graveyard", "The Hot Bunks"), -2);
  assert.equal(loot.lootAdjustment("meridian", "The Bridge"), 0);
});

test("the checker finds nothing wrong in the game's files, and names an item that's found somewhere that doesn't exist", () => {
  assert.deepEqual(loot.lootProblems(), []);
  ITEMS.__test_coat = { name: "Test Coat", type: "armor", foundIn: ["dresser", "wardrobe of dreams"], rarity: "legendary" };
  ITEMS.__test_relic = { name: "Test Relic", type: "story", foundIn: ["safe"] };
  try {
    const problems = loot.lootProblems();
    assert.ok(problems.some((one) => /__test_coat\.txt: found in names wardrobe of dreams/.test(one)), problems.join("\n"));
    assert.ok(problems.some((one) => /__test_coat\.txt: rarity is legendary/.test(one)));
    assert.ok(problems.some((one) => /__test_relic\.txt: it's a story item/.test(one)));
    assert.equal(problems.length, 3);
    assert.deepEqual(loot.itemsFoundIn("dresser").map((one) => one.id), ["__test_coat"]);
  } finally {
    delete ITEMS.__test_coat;
    delete ITEMS.__test_relic;
  }
  assert.deepEqual(loot.itemsFoundIn("dresser"), [], "no item says it's found anywhere yet: that's step 2");
  assert.deepEqual(RARITIES, ["common", "uncommon", "rare"]);
});

test("an item's found in, rarity and drawing read and write back exactly, its spaces kept", () => {
  const text = "# Test Coat\ntype: armor\nfound in: dresser, crew locker\nrarity: uncommon\n\nIn a line:\nA coat.\n\nDrawing:\n` _/\\_ `\n`|.||.|`\n`|_||_|`\n";
  const { value, problems } = parseWorldText(text, ITEM, "test_coat");
  assert.deepEqual(problems, []);
  assert.deepEqual(value.foundIn, ["dresser", "crew locker"]);
  assert.equal(value.rarity, "uncommon");
  assert.deepEqual(value.art, [" _/\\_ ", "|.||.|", "|_||_|"]);
  assert.equal(writeWorldText(value, ITEM), text);
});

test("every item file still reads back exactly, and the drawings that were in the code are in the files", () => {
  for (const file of fs.readdirSync(itemsDir).filter((one) => one.endsWith(".txt") && !one.startsWith("_"))) {
    const text = fs.readFileSync(path.join(itemsDir, file), "utf8").replace(/\r\n/g, "\n");
    const { value, problems } = parseWorldText(text, ITEM, file.slice(0, -4));
    assert.deepEqual(problems, [], file);
    assert.equal(writeWorldText(value, ITEM), text, file);
  }
  assert.deepEqual(ITEMS.smugglers_coat.art, [" _/\\_ ", "|.||.|", "| || |", "|_||_|"]);
  assert.deepEqual(ITEMS.sidearm.art, ["[##]=-"]);
  assert.deepEqual(artFor(ITEMS.smugglers_coat), ITEMS.smugglers_coat.art, "the inventory draws an item's own drawing");
  assert.deepEqual(artFor({ type: "weapon" }), ["=[#]=-"], "and an item without one as its kind");
  assert.equal(Object.values(ITEMS).filter((item) => item.art?.length).length, 61, "the 61 drawings the code had");
});
