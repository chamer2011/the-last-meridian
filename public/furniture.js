// The furniture the game draws in its rooms, and what the rest of the game needs to know about each piece: its name,
// how much of the deck it takes, whether it's in the way, and whether it hangs on a wall. The game reads it
// (src/tiled.js, src/walk.js, src/map-editor.js) and so does the page (public/iso.js draws the pieces, public/mapedit.js
// puts them down).
//
// A piece is { kind, x, y, facing } in a deck's file: x and y are its back left square, as the plan counts them, a
// square being half a tile across and a whole tile down; facing is n, e, s or w, the way someone sitting in it looks,
// the way a locker's door or a console's screen faces, the end of a bed the pillow isn't at. A piece that hangs on a
// wall (a window, a screen) is on a wall square, on whichever side of it the room is, and doesn't face anywhere.

export const FACINGS = ["n", "e", "s", "w"];
export const FACING_WORDS = { n: "the bow end of the deck", e: "the right of the screen", s: "you", w: "the left of the screen" };

// size is [across, down] in tiles when facing n or s, turned when facing e or w. blocks: whether people have to walk
// round it (a bed or a chair is somewhere to be, so it doesn't). seat: someone stopping on it sits in it; bed: someone
// asleep or laid up on it lies in it, and someone awake sits on its edge. lit: the colour of the light it gives off.
export const FURNITURE = [
  { id: "chair", name: "Chair", about: "A seat at a console or a table", size: [0.5, 0.5], blocks: false, seat: true },
  { id: "bench", name: "Bench", about: "A long bench to sit on", size: [2, 0.5], blocks: false, seat: true },
  { id: "command-chair", name: "Command chair", about: "A big chair on a step, for whoever has the deck", size: [1, 1], blocks: false, seat: true },
  { id: "table", name: "Table", about: "A small square table", size: [1, 1], blocks: true },
  { id: "long-table", name: "Long table", about: "A long table for a mess or a wardroom", size: [2, 1], blocks: true },
  { id: "desk", name: "Desk", about: "A desk with a terminal on it", size: [1, 0.5], blocks: true, lit: "#86dcff" },
  { id: "bunk", name: "Bunk", about: "A bunk, one over the other", size: [1, 2], blocks: false, bed: true },
  { id: "cot", name: "Cot", about: "A sickbay cot with white sheets", size: [1, 2], blocks: false, bed: true },
  { id: "locker", name: "Locker", about: "A tall locker", size: [0.5, 0.5], blocks: true },
  { id: "shelf", name: "Shelves", about: "Shelves with boxes and tins on them", size: [1, 0.5], blocks: true },
  { id: "plot-table", name: "Plot table", about: "A chart table with a picture glowing over it", size: [1, 1], blocks: true, lit: "#7dffa8" },
  { id: "screen", name: "Screen on a stand", about: "A screen standing on a post", size: [0.5, 0.5], blocks: true, lit: "#86dcff" },
  { id: "kettle", name: "Kettle", about: "A big cooking pot on its stove", size: [1, 1], blocks: true, lit: "#ff9a50" },
  { id: "barrel", name: "Barrel", about: "A drum of something", size: [0.5, 0.5], blocks: true },
  { id: "plant", name: "Potted plant", about: "Something green in a pot", size: [0.5, 0.5], blocks: true },
  { id: "basin", name: "Basin", about: "A washbasin with a tap", size: [0.5, 0.5], blocks: true },
  { id: "wall-screen", name: "Screen on a wall", about: "A screen on a wall, on the side the room's on", wall: true, lit: "#86dcff" },
  { id: "window", name: "Window", about: "A window in a wall, with the stars outside", wall: true, lit: "#9cc4ff" },
];
export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((one) => [one.id, one]));
export const isFurniture = (kind) => Object.hasOwn(FURNITURE_BY_ID, kind);

// Pieces from the bought pixel-art packs join the list here, under their own ids ("interiors/Chairs/GChair_9"), once
// the game has read what each is from world/furniture.txt (src/pack-furniture.js on the game's side; the page asks
// the game for them). They have the same facts as the pieces above, and besides: pack (true), what (seat, bed, table,
// stand, opens, wall, rug or small), high (how tall, in tiles), and opens (the piece of the game's own whose
// containers something to open has). FURNITURE stays the game's own pieces; these are only found by id.
const packIds = new Set();
let packVersion = 0;
export function setPackFurniture(list) {
  for (const id of packIds) delete FURNITURE_BY_ID[id];
  packIds.clear();
  for (const one of list ?? []) {
    if (!one?.id || Object.hasOwn(FURNITURE_BY_ID, one.id)) continue;
    FURNITURE_BY_ID[one.id] = one;
    packIds.add(one.id);
  }
  packVersion += 1;
}
export const packFurniture = () => [...packIds].map((id) => FURNITURE_BY_ID[id]);
// Goes up whenever the packs' pieces are told afresh, so a picture drawn with the old ones can be told from a new one.
export const furnitureVersion = () => packVersion;

// How many squares across and down a piece takes, facing the way it faces.
export function footprintOf(piece) {
  const kind = FURNITURE_BY_ID[piece?.kind];
  if (!kind || kind.wall) return { across: 1, down: 1 };
  const [across, down] = piece.facing === "e" || piece.facing === "w" ? [kind.size[1], kind.size[0]] : kind.size;
  return { across: Math.max(1, Math.round(across / 0.5)), down: Math.max(1, Math.round(down)) };
}

// Every square a piece takes, as [x, y].
export function squaresOf(piece) {
  const { across, down } = footprintOf(piece);
  const out = [];
  for (let dy = 0; dy < down; dy += 1) for (let dx = 0; dx < across; dx += 1) out.push([piece.x + dx, piece.y + dy]);
  return out;
}

// What a thing is drawn as: what its own looks line says ("box" for the plain box things have always been), or what
// the words in its name say it is, or nothing, for a box.
const BY_NAME = [
  [["captain's chair", "command chair"], "command-chair"],
  [["chair", "seat", "stool"], "chair"],
  [["bench"], "bench"],
  [["plot table", "chart table", "holo"], "plot-table"],
  [["repeater", "monitor", "terminal", "screen"], "screen"],
  [["locker", "cabinet", "wardrobe"], "locker"],
  [["kettle", "stove", "cooking pot"], "kettle"],
  [["bunk"], "bunk"],
  [["cot", "sickbed"], "cot"],
  [["desk"], "desk"],
  [["shelf", "shelves"], "shelf"],
  [["barrel", "drum", "keg"], "barrel"],
  [["plant", "pot of", "seedling"], "plant"],
  [["basin", "sink"], "basin"],
  [["table"], "table"],
];
// What a name is a name of: the last word before anything that only says where it is or what's with it ("A cot with
// its curtain drawn" is a cot, "Data chip in the comms tray" a chip, "Hot-bunk slate" a slate), or after "a row of".
const WHERE = /\s+(?:with|in|on|under|for|facing|from|at|by|behind|beside|against|near|of)\s+/;
const MANY = ["row", "pair", "set", "stack", "line"];
function headOf(name) {
  const parts = name.split(WHERE);
  let head = parts[0].trim().split(/\s+/).at(-1) ?? "";
  if (MANY.includes(head) && /\s+of\s+/.test(name)) head = name.split(/\s+of\s+/)[1].split(WHERE)[0].trim().split(/\s+/).at(-1) ?? "";
  return { head, before: parts[0] };
}
export function looksOf(thing) {
  if (thing?.looks) return thing.looks === "box" || !isFurniture(thing.looks) || FURNITURE_BY_ID[thing.looks].wall ? null : thing.looks;
  const { head, before } = headOf(String(thing?.name ?? "").toLowerCase());
  // Names of more than one word ("the captain's chair") are looked for whole; one word only in what the name is of.
  return BY_NAME.find(([keys]) => keys.some((key) => (key.includes(" ") ? before.includes(key) : head.includes(key))))?.[1] ?? null;
}
