// Drawings in the game's console style, for the top of a page of the ship's log (a part's DRAWING: line, see
// world/scenes/_how-to-write-a-scene.txt): world/drawings/<name>.txt, each a few lines of plain characters, read
// afresh each time, since they're small and whoever draws may have just changed one. A line that starts with // is a
// note for whoever draws, and isn't drawn.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";

export const DRAWINGS_DIR = process.env.GAME_DRAWINGS_DIR ?? path.join(worldDir, "drawings");
// As big as fits at the top of a page beside its title.
export const MOST_LINES = 8;
export const MOST_WIDE = 32;

const fileOf = (name) => path.join(DRAWINGS_DIR, `${name}.txt`);
const linesOf = (text) => String(text).replace(/\r/g, "").split("\n").filter((line) => !line.trimStart().startsWith("//")).map((line) => line.replace(/\s+$/, ""));
const trimmed = (lines) => {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out.at(-1).trim()) out.pop();
  return out;
};

// The drawings there are, by name: every .txt in the folder but the how-to.
export function drawingNames() {
  if (!fs.existsSync(DRAWINGS_DIR)) return [];
  return fs.readdirSync(DRAWINGS_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_")).map((name) => name.slice(0, -4)).sort();
}

// A drawing's lines, cut to what fits, or null when there's no drawing by that name.
export function drawingOf(name) {
  if (!name || !/^[a-z0-9_]+$/.test(name) || !fs.existsSync(fileOf(name))) return null;
  return trimmed(linesOf(fs.readFileSync(fileOf(name), "utf8"))).slice(0, MOST_LINES).map((line) => [...line].slice(0, MOST_WIDE).join(""));
}

// What's wrong with the drawings, for npm run check-story: too many lines, or a line too wide.
export function drawingProblems() {
  const problems = [];
  for (const name of drawingNames()) {
    const lines = trimmed(linesOf(fs.readFileSync(fileOf(name), "utf8")));
    if (!lines.length) problems.push(`world/drawings/${name}.txt has nothing to draw`);
    if (lines.length > MOST_LINES) problems.push(`world/drawings/${name}.txt is ${lines.length} lines; a page has room for ${MOST_LINES}`);
    const wide = Math.max(0, ...lines.map((line) => [...line].length));
    if (wide > MOST_WIDE) problems.push(`world/drawings/${name}.txt is ${wide} characters wide; a page has room for ${MOST_WIDE}`);
  }
  return problems;
}
