// What the Godot view (godot/) needs to draw the Meridian's decks, worked out by the game's own code and handed over as
// one piece of JSON. Godot runs this once when it starts (godot/scripts/deck_data.gd):
//
//   node tools/godot-decks.mjs --out=<a file to write>     (or with no --out, to the screen)
//
// Godot draws and the game's rules stay here, in JavaScript. So nothing about where a wall, a door or a chair stands is
// worked out twice. The decks are read by the game's reader (src/tiled.js, through src/world.js), made into levels by
// compileLevel (src/walk.js), described for their picture by draftLook, and handed over by src/godot-view.js, which
// is what the game itself hands Godot for a game being played.
//
// This is the ship with no game behind it, for walking her empty decks (Godot's "--empty") and for checking the
// drawing: it reads no save, opens no port and writes nothing but the one file it's asked for. As a
// guard, GAME_DATA_DIR is a temporary folder that's thrown away, and every way of writing a file is shut off for
// anywhere else before the game's code is loaded.

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

const outArg = process.argv.find((word) => word.startsWith("--out="));
const outFile = outArg ? path.resolve(outArg.slice("--out=".length)) : null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "almagest-godot-"));
process.env.GAME_DATA_DIR = tmp;

// ---- Nothing is written anywhere else -------------------------------------------------------------------------------

const realWrite = fs.writeFileSync.bind(fs);
const realRemove = fs.rmSync.bind(fs);
const inside = (dir, target) => {
  const rel = path.relative(dir, path.resolve(String(target)));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
// Each way of writing, with which of its words says where it writes: copying and renaming say it second.
const WRITERS = { writeFileSync: 0, appendFileSync: 0, mkdirSync: 0, rmSync: 0, rmdirSync: 0, unlinkSync: 0, truncateSync: 0, renameSync: 1, copyFileSync: 1, cpSync: 1, writeFile: 0, appendFile: 0, mkdir: 0, rm: 0, rmdir: 0, unlink: 0, truncate: 0, rename: 1, copyFile: 1, cp: 1, createWriteStream: 0 };
const guarded = (name, real, where) => (...words) => {
  if (!inside(tmp, words[where])) throw new Error(`tools/godot-decks.mjs only reads: ${name} was asked for ${words[where]}.`);
  return real(...words);
};
for (const [name, where] of Object.entries(WRITERS)) {
  if (typeof fs[name] === "function") fs[name] = guarded(name, fs[name].bind(fs), where);
  if (typeof fs.promises[name] === "function") fs.promises[name] = guarded(name, fs.promises[name].bind(fs.promises), where);
}
syncBuiltinESMExports();
// Whatever the game's code has to say while it loads goes beside the answer, not into it.
console.log = (...words) => console.error(...words);

// ---- The answer -----------------------------------------------------------------------------------------------------

const PLACE = "meridian";

async function answer() {
  const { WORLD_MAPS } = await import("../src/world.js");
  const { LOCATIONS } = await import("../src/data.js");
  const { compileLevel, draftLook, canStand } = await import("../src/walk.js");
  const { godotLevel, godotRound, godotStatics } = await import("../src/godot-view.js");

  const file = WORLD_MAPS[PLACE];
  if (!file?.levels) throw new Error("The game has no decks for the Meridian.");
  const decks = [];
  for (const [id, raw] of Object.entries(file.levels)) {
    const level = compileLevel(id, raw, LOCATIONS[PLACE]?.gm?.districts);
    const look = draftLook(PLACE, level);
    // Each way out says which room it's in, as the game's own view of a deck does: the stairs are found by it.
    const glyphOf = (exit) => (exit.x === 0 ? "<" : exit.x === level.width - 1 ? ">" : exit.y === 0 ? "^" : "v");
    const exits = level.exits.map((exit) => ({ key: exit.key, x: exit.x, y: exit.y, label: exit.label ?? file.levels[exit.to]?.name ?? exit.to, glyph: glyphOf(exit) }));
    look.exits = exits.map((exit) => ({ ...exit, room: level.roomAt(exit.x, exit.y) }));
    decks.push(godotLevel(id, look, {
      name: level.name,
      start: level.start,
      // Where the player can walk: "." for a square that can be stood on, as the game's own view has it.
      floor: Array.from({ length: level.height }, (_, y) => Array.from({ length: level.width }, (_, x) => (canStand(level, x, y) ? "." : " ")).join("")),
      // With no game to say where a way out leads, each says so itself.
      exits: exits.map((exit, i) => ({ ...exit, to: level.exits[i].to, via: level.exits[i].via ?? null })),
    }));
  }
  return { ok: true, place: PLACE, name: LOCATIONS[PLACE]?.name ?? "The Meridian", ...godotStatics(), decks, round: godotRound };
}

let code = 0;
let text;
try {
  const { round, ...out } = await answer();
  text = JSON.stringify(out, round);
} catch (error) {
  code = 1;
  text = JSON.stringify({ ok: false, error: String(error?.message ?? error) });
}
try {
  realRemove(tmp, { recursive: true, force: true });
} catch {
  // A temporary folder left behind is the computer's to clear.
}
if (outFile) realWrite(outFile, text);
else process.stdout.write(`${text}\n`);
process.exitCode = code;
