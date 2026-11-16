// Loaded before every test file by `npm test` (node --import ./test/kept-ship.mjs --test test/): points the game at
// the ship as she was drawn when the tests were written (test/kept-ship/, see its _about.txt), so that redrawing the
// real decks can't break them. A test file with "as-drawn" in its name is left looking at the real decks, and so is
// anything run with GAME_SHIP=as-drawn or with folders of its own already chosen.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const asDrawn = process.env.GAME_SHIP === "as-drawn" || process.argv.some((word) => path.basename(String(word)).includes("as-drawn"));
if (!asDrawn) {
  process.env.GAME_MAPS_DIR ??= path.join(here, "kept-ship", "maps");
  process.env.GAME_LIFE_DIR ??= path.join(here, "kept-ship", "life");
}
