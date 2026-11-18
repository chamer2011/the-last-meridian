// The Godot view (godot/): what the game hands it about the decks, and the two promises
// it's built on. The bought art is never inside the Godot project, where Godot would copy it and git might take it;
// and the game's reader for Godot only reads: no save, no port, nothing written. This file looks at the real decks
// (its name keeps test/kept-ship.mjs from pointing it at the kept copy), as Godot does.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// A copy of the game without the Godot view (the public one, until it's put on its list) has nothing here to check.
const absent = fs.existsSync(path.join(root, "godot", "project.godot")) && fs.existsSync(path.join(root, "tools", "godot-decks.mjs")) ? false : "the Godot view isn't in this copy of the game";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The reader, run the way Godot runs it: as a program of its own, with the real decks.
function ask(env = {}) {
  const out = path.join(tmp, `decks-${Math.random().toString(36).slice(2)}.json`);
  const clean = { ...process.env, ...env };
  for (const key of ["GAME_MAPS_DIR", "GAME_LIFE_DIR", "GAME_DATA_DIR", ...(env.GAME_LICENSED_DIR ? [] : ["GAME_LICENSED_DIR"])]) if (!(key in env)) delete clean[key];
  const ran = spawnSync(process.execPath, [path.join(root, "tools", "godot-decks.mjs"), `--out=${out}`], { cwd: root, env: clean, encoding: "utf8" });
  assert.equal(ran.status, 0, ran.stderr);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

// Every file under a folder, as paths from it.
function filesUnder(dir, from = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(dir, entry.name), from) : [path.relative(from, path.join(dir, entry.name)).split(path.sep).join("/")]));
}

test("no picture is ever inside the Godot project: the packs are read from licensed/ and nowhere else", { skip: absent }, () => {
  // Godot copies whatever picture it finds in its project into godot/.godot/imported, so none may be there at all,
  // the packs' least of all. (A picture of the game's own, if one's ever wanted there, gets its name added here.)
  const allowed = new Set([]);
  const pictures = filesUnder(path.join(root, "godot")).filter((file) => /\.(png|jpe?g|webp|gif|bmp|tga|svg|ctex|exr|hdr|ktx2?|dds)$/i.test(file) && !allowed.has(file));
  assert.deepEqual(pictures, []);
  const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
  for (const line of ["licensed/", "godot/.godot/", "godot-engine/"]) assert.ok(ignored.includes(line), `${line} is left out of git`);
  // Nor does anything in it name a pack's picture to load as a resource of its own.
  for (const file of filesUnder(path.join(root, "godot")).filter((one) => /\.(gd|tscn|tres|godot)$/.test(one) && !one.startsWith(".godot/"))) {
    const text = fs.readFileSync(path.join(root, "godot", file), "utf8");
    assert.ok(!/res:\/\/[^"'\n]*\.(png|jpe?g|webp)/i.test(text), `${file} loads no picture from inside the project`);
  }
  // And it isn't in what's published or packaged for others.
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(!pkg.build.files.some((entry) => entry.startsWith("godot")), "the Godot view isn't in the installer");
});

test("the game tells Godot what's on the three decks, from the decks as they're drawn", { skip: absent }, () => {
  const before = fs.existsSync(path.join(root, "data"));
  const answer = ask();
  assert.equal(answer.ok, true);
  assert.equal(answer.place, "meridian");
  assert.deepEqual(answer.decks.map((deck) => deck.id), ["deck1", "deck2", "deck3"]);
  assert.equal(answer.numbers.cellWidth, 0.5);
  assert.equal(answer.numbers.wallHeight, 1.7);
  assert.equal(answer.numbers.pixelUnit, 64);
  for (const deck of answer.decks) {
    const { scene } = deck;
    // The plan, a row to a line, and where the player can walk on it.
    assert.equal(deck.floor.length, deck.lines);
    assert.equal(scene.kinds.length, deck.lines);
    assert.ok(deck.floor.every((row) => row.length === deck.cols) && scene.kinds.every((row) => row.length === deck.cols), deck.id);
    assert.equal(deck.floor[deck.start.y][deck.start.x], ".", `${deck.id}: the player starts on floor`);
    assert.ok(deck.floor.join("").split(".").length > 1500, `${deck.id}: most of a deck can be walked on`);
    // Floor the game says can be walked on is floor in the picture too, or a doorway: never a wall.
    for (let y = 0; y < deck.lines; y += 1) for (let x = 0; x < deck.cols; x += 1) if (deck.floor[y][x] === ".") assert.ok("fd".includes(scene.kinds[y][x]), `${deck.id}: ${x},${y} is ${scene.kinds[y][x]}`);
    // What stands on it, from the back of the deck to the front.
    assert.ok(scene.blocks.length > 1000, deck.id);
    assert.ok(scene.blocks.every((block, i) => i === 0 || block.depth >= scene.blocks[i - 1].depth), `${deck.id}: in order`);
    assert.ok(scene.blocks.some((block) => block.style === "stairs"), `${deck.id}: its stairs are found`);
    assert.ok(scene.ground.length > 3000 && scene.lights.length > 20 && scene.doorways.length > 20, deck.id);
    assert.ok(deck.areas.length >= 10 && deck.labels.length > 0, deck.id);
    // Every way out leads to a deck there is, and comes out beside a way out there.
    for (const exit of deck.exits) {
      const there = answer.decks.find((one) => one.id === exit.to);
      assert.ok(there, `${deck.id}: ${exit.label}`);
      const other = there.exits.find((one) => one.key === exit.via);
      assert.ok(other, `${deck.id}: ${exit.label} comes out somewhere`);
      assert.ok([[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => there.floor[other.y + dy]?.[other.x + dx] === "."), `${deck.id}: there's floor beside where ${exit.label} comes out`);
    }
  }
  // Without the packs it says so, and names no picture: Godot draws plain shapes.
  assert.deepEqual(answer.packs, { isospace: false, interiors: false });
  assert.equal(answer.ways.console, null);
  assert.ok(answer.decks.every((deck) => deck.scene.blocks.every((block) => !block.pic)));
  // It made no data folder, and left the game's own folder as it was.
  assert.equal(fs.existsSync(path.join(root, "data")), before);
});

test("with the packs in the folder, every piece on the decks has its picture named", { skip: absent }, () => {
  // A made-up copy of the packs in plain shapes (tools/godot-stand-in-pack.mjs), which is what the Godot view is
  // checked with where the real ones aren't. It refuses to be made inside the game's own folder.
  const inside = spawnSync(process.execPath, [path.join(root, "tools", "godot-stand-in-pack.mjs"), path.join(root, "licensed")], { cwd: root, encoding: "utf8" });
  assert.notEqual(inside.status, 0);
  assert.ok(!fs.existsSync(path.join(root, "licensed", "isospace", "IsoSpace_Level.png")) || fs.statSync(path.join(root, "licensed", "isospace", "IsoSpace_Level.png")).mtimeMs < Date.now() - 5000, "nothing was made in licensed/");
  const packs = path.join(tmp, "packs");
  const made = execFileSync(process.execPath, [path.join(root, "tools", "godot-stand-in-pack.mjs"), packs], { cwd: root, encoding: "utf8", env: { ...process.env, GAME_DATA_DIR: path.join(tmp, "data") } });
  assert.match(made, /three sheets/);
  assert.ok(!/finds no picture/.test(made), made);
  const answer = ask({ GAME_LICENSED_DIR: packs });
  assert.deepEqual(answer.packs, { isospace: true, interiors: true });
  assert.equal(answer.licensed, packs);
  const own = new Set(["wall-screen", "window"]);
  for (const deck of answer.decks) {
    for (const block of deck.scene.blocks) {
      if (block.style !== "piece" || own.has(block.kind)) continue;
      assert.ok(block.pic?.picture?.src, `${deck.id}: ${block.kind} has a picture`);
      assert.ok(fs.existsSync(path.join(packs, block.pic.picture.src)), `${deck.id}: ${block.pic.picture.src} is in the folder`);
    }
    // A thing is drawn by what its name says it is, or not at all where it's only somewhere to look.
    for (const thing of deck.things) assert.ok(thing.looks || thing.nothing || thing.pic, `${deck.id}: ${thing.name}`);
  }
  // The plan's own marks: consoles, crates, the engines' pumps and tanks, the lamps on the walls, pipes and cables.
  for (const key of ["lamp", "console", "terminal", "counter", "stove", "pump", "tank"]) assert.ok(answer.ways[key]?.picture?.src, key);
  assert.ok(answer.ways.crate.dark && answer.ways.crate.light && answer.ways.post.s && answer.ways.scrap.every(Boolean) && Object.values(answer.ways.runs).every(Boolean));
  // A room in the Light look names the Light picture, for Godot to tone down; wood is named to be drawn in steel.
  const said = answer.decks.flatMap((deck) => deck.scene.blocks.filter((block) => block.pic).map((block) => block.pic.picture));
  assert.ok(said.some((picture) => picture.look === "light"));
  assert.ok(said.some((picture) => picture.steel));
});
