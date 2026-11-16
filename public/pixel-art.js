// The pixel-art test: the isometric view with its floors and walls drawn in a bought pixel-art pack in place of the
// game's own drawing, so the owner can judge the look. Only the pictures change: the rooms, the furniture, the people,
// the light and everything else are the game's own.
//
// The pack is @pixel_Salvaje's Isometric Space Station (https://pixel-salvaje.itch.io/isometric-space-station). Its
// licence lets the game use and change it but not give the files away, so they live in licensed/isospace, which git
// leaves out and nothing public copies, and the server hands them only to this page (server.js, /licensed/). Without
// them the view draws as it always has, and Settings says the pack wasn't found.
//
// The sheets are 1024 by 1024, in cells of 128: a floor tile is a diamond 128 wide and 64 high, the same 2:1 shape as
// the game's own tiles, so a tile of the pack is one tile of the view, two of the game's squares side by side. A wall
// is a thin slab along one edge of a tile, 88 pixels high (1.375 tiles); it's stood up to the game's own wall height,
// so that nothing else in the room has to move.
//
// The doors between rooms are the pack's: a door is a slab like a wall, with sixteen pictures of it sliding open and
// shut, stood in the front of its doorway.
//
// Most of the furniture is drawn from a second pack by the same artist, Isometric Interiors
// (https://pixel-salvaje.itch.io/isometric-interiors), in licensed/interiors, under the same licence: a file to a
// picture, drawn at the same size as the first pack's (a floor tile 128 pixels wide), some of them from four sides.
// The first pack's own few pieces fill in (the plot table, desks with their terminals, barrels, crates), and stand in
// for the second pack's where that one isn't in the folder. Bunks and cots stay the game's own, since people are drawn
// lying in them under their blankets, and so do the wall's windows and screens, which show the ship's power.

import { FURNITURE_BY_ID, furnitureVersion, setPackFurniture } from "./furniture.js";

const BASE = "licensed/isospace/";
const SHEETS = { level: "IsoSpace_Level.png", assets: "IsoSpace_Assets.png", doors: "IsoSpace_Doors.png" };
const INTERIORS = "licensed/interiors/";
// The doors sheet: four rows of eight a door, sixteen pictures from shut to open and back, by look and by the way the
// door's face looks. Picture 0 is shut with an amber light, 1 shut and green, 2 shut and red (locked), 3 to 8 sliding
// open, 9 open, 10 to 15 sliding shut.
const DOOR_ROWS = { dark: { downLeft: 0, downRight: 2 }, light: { downRight: 4, downLeft: 6 } };
const OPENING = [3, 4, 5, 6, 7, 8];
// A picture of a piece of furniture: a cell of the first pack's assets sheet, or a file of the second pack.
const cell = (cx, cy) => ({ id: `assets:${cx},${cy}`, sheet: "assets", x: cx * 128, y: cy * 128, w: 128, h: 128 });
const from = (path) => ({ id: path, file: path });
const fourWays = (stem, tail = "") => ({ s: from(`${stem}A${tail}.png`), e: from(`${stem}B${tail}.png`), w: from(`${stem}C${tail}.png`), n: from(`${stem}D${tail}.png`) });
// The game's furniture the packs have a piece for (public/furniture.js names them), each with the ways it can be drawn,
// the first whose pictures are in the folder winning. A way is one picture (picture), one by look (dark, light), one
// for each way the piece faces (faces: the pack's A looks toward the player, B to the right, C to the left, D away),
// or any of a few, the same one every time for the same piece (any). times: the piece is long, so the picture is drawn
// so many times along it. on: another picture stood on top of it, lift tiles up. A picture drawn from one side only is turned
// round for a piece facing east or west. A crate is a crate on the plan, not one of the pieces.
const PIECES = {
  "plot-table": [{ picture: cell(0, 0) }],
  desk: [{ dark: cell(5, 0), light: cell(7, 1) }],
  barrel: [{ picture: cell(1, 0) }],
  crate: [{ dark: cell(3, 0), light: cell(5, 1) }],
  locker: [{ picture: from("Office/Office_Metallic_Closet_Ani/Metallic_Closet_Base.png") }, { dark: cell(7, 0), light: cell(4, 1) }],
  chair: [{ faces: fourWays("Chairs/Chair_4_", "_Tile") }],
  "command-chair": [{ faces: fourWays("Chairs/GChair_9_") }],
  bench: [{ picture: from("Tables/Table_Corridor.png"), times: 2 }],
  table: [{ picture: from("Tables/Office_Kitchen_Table.png") }],
  "long-table": [{ picture: from("Tables/Office_Kitchen_Table.png"), times: 3 }],
  shelf: [{ picture: from("Office/Rack.png") }],
  screen: [{ picture: from("Computer/Vertical_Screen.png") }],
  kettle: [{ picture: from("Kitchen/Oven.png"), on: from("Kitchen/Pot_Full.png"), lift: 0.86 }],
  plant: [{ any: [from("Plants/Plant_3.png"), from("Plants/Plant_2.png"), from("Plants/Plant_5.png"), from("Plants/Plant_1.png")] }],
  basin: [{ picture: from("Bathroom/WC_Tap_Ani/Wc_Tap_1.png") }],
};
const picturesOf = (way) => [way.picture, way.dark, way.light, way.on, ...Object.values(way.faces ?? {}), ...(way.any ?? [])].filter(Boolean);
// How much bigger the pack's furniture is drawn than its own size: as much as its walls are stood up, so they keep to
// each other and to the game's people.
const WALL_PACK_HEIGHT = 1.375;
// The game's own furniture whose picture in the packs is wood or orange, and is drawn in steel: the benches and the
// washbasins' cabinets. (A piece of the packs put on a deck as itself says so in world/furniture.txt, "in steel".)
const STEEL_FILES = new Set(["Tables/Table_Corridor.png", "Bathroom/WC_Tap_Ani/Wc_Tap_1.png"]);

// Wood and orange turned to worn steel: a colour between red-orange and yellow-brown, strong enough to be one, keeps
// how light it is, a little darkened, and takes the ship's blue-grey. Anything else is left as it was (null).
export function steelOf(r, g, b) {
  const [hi, lo] = [Math.max(r, g, b), Math.min(r, g, b)];
  const light = (hi + lo) / 510;
  if (hi === lo || light < 0.1 || light > 0.93) return null;
  const spread = hi - lo;
  const strong = spread / 255 / (1 - Math.abs(2 * light - 1));
  let hue = hi === r ? ((g - b) / spread) % 6 : hi === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  hue = (hue * 60 + 360) % 360;
  if (strong < 0.25 || hue < 8 || hue > 50) return null;
  // Blue-grey, with a little more colour in it the stronger the wood's was.
  const [h, s, l] = [208, 0.1 + 0.12 * Math.min(1, strong), light * 0.86];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  return [m, x + m, c + m].map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255));
}
// A copy of a picture with its wood and orange in steel.
function inSteel(image) {
  if (typeof document === "undefined") return image;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth ?? image.width;
  canvas.height = image.naturalHeight ?? image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = pixels;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const steel = steelOf(data[i], data[i + 1], data[i + 2]);
    if (steel) [data[i], data[i + 1], data[i + 2]] = steel;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
// The two looks of the pack: where each one's floors and walls are on the level sheet, in cells across and down.
const LOOKS = {
  dark: { floors: [0, 1, 2, 3, 4, 5, 6, 7], floorRow: 0, wallRow: 1 },
  light: { floors: [0, 1, 2, 3, 4], floorRow: 4, wallRow: 5 },
};
// Which floor goes where: most of the deck is plain plating and panels, the passages are grilles, and a second kind of
// floor on the plan is the mesh. By cell across on the floor row.
const FLOOR_PICKS = {
  dark: { plain: [0, 0, 0, 2, 2, 2, 3, 3, 0, 2, 4, 5], passage: [6, 7], second: [1] },
  light: { plain: [0, 0, 1, 1, 4, 0, 1], passage: [2, 3], second: [3] },
};
// A floor tile's top face: its top, right and left corners, in pixels of its cell.
const FLOOR_CORNERS = [[64, 56], [128, 88], [0, 88]];
// A wall slab's face that looks down and to the right (a wall along the plan's columns): the near end's foot, the far
// end's foot and the near end's top. Cells 0 to 2 of the wall row.
const WALL_DOWN_RIGHT = { cells: [0, 1, 2], corners: [[40, 124], [104, 92], [40, 36]] };
// A wall slab's face that looks down and to the left (a wall along the plan's rows): the left end's foot, the right
// end's foot and the left end's top. Cells 5 to 7 of the wall row.
const WALL_DOWN_LEFT = { cells: [5, 6, 7], corners: [[24, 92], [88, 124], [24, 4]] };

const state = { on: false, look: "dark", images: null, files: {}, loaded: false, failed: false, second: null, tops: {}, boxes: {}, listeners: new Set(), pack: {}, wanted: new Set(), loading: {}, version: 0, settle: 0, scratch: null, forced: false, lightDim: 1, dimmed: {} };

// ---- Any piece of the packs, as furniture ---------------------------------------------------------------------------
// The game says what each piece of the packs is (src/pack-furniture.js, world/furniture.txt), and the page's list of
// furniture takes them in (public/furniture.js). Each is drawn from its own picture, or from the one of its four
// sides that faces the camera, and a picture is only fetched once a piece that needs it is on a deck being drawn:
// until it has come, the game draws a plain shape, and then the room is drawn again.

// Asks the game for the packs' pieces. True if it has them; false for a game started before it knew them.
export async function loadPack() {
  try {
    const response = await fetch("/api/furniture");
    if (!response.ok) return false;
    const { furniture } = await response.json();
    setPackFurniture(furniture);
    // A piece that's to be in steel has its own copy of each picture, recoloured as it comes (want, below).
    const made = (picture, steel) => (picture ? { id: `pk:${picture.file}|${picture.x ?? ""},${picture.y ?? ""}${steel ? "|steel" : ""}`, file: `pk:${picture.file}${steel ? "|steel" : ""}`, path: picture.file, ...(steel ? { steel: true } : {}), ...(picture.x === undefined ? {} : { x: picture.x, y: picture.y, w: picture.w, h: picture.h }) } : null);
    state.pack = {};
    for (const one of furniture) {
      if (one.faces) state.pack[one.id] = { faces: Object.fromEntries(Object.entries(one.faces).map(([facing, picture]) => [facing, made(picture, one.steel)])) };
      else if (one.picture) state.pack[one.id] = { picture: made(one.picture, one.steel) };
    }
    changed();
    return true;
  } catch {
    return false;
  }
}

// Part of every picture's name, with pixelKey: it changes when the packs' pieces are told afresh and when a picture
// one of them was waiting for has come, so the room is drawn again with it.
export const packKey = () => `${furnitureVersion()}.${state.version}`;

// Which way a flat thing's picture leans: "s" if its top runs down to the right, as on a wall seen from the room below
// it on the plan, "e" if it runs down to the left, as on a wall seen from the room to its right, null if it does
// neither (a round clock). From its pixels as a canvas gives them, and the box its solid ones fill.
export function slantOf(data, w, box) {
  const wide = box.x1 - box.x0 + 1;
  if (wide < 6) return null;
  const top = (from, to) => {
    let best = Infinity;
    for (let x = from; x <= to; x += 1) {
      for (let y = box.y0; y <= box.y1 && y < best; y += 1) {
        if (data[(y * w + x) * 4 + 3] >= 250) best = y;
      }
    }
    return best;
  };
  const third = Math.max(1, Math.floor(wide / 3));
  const left = top(box.x0, box.x0 + third - 1);
  const right = top(box.x1 - third + 1, box.x1);
  if (Math.abs(left - right) < 3) return null;
  return left < right ? "s" : "e";
}

// Fetches a picture a piece on the deck needs, and measures it. The room is drawn again a moment after the last of a
// batch has come.
function want(picture) {
  if (state.wanted.has(picture.id) || typeof Image === "undefined") return;
  state.wanted.add(picture.id);
  state.loading[picture.file] ??= new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = `licensed/${picture.path.split("/").map(encodeURIComponent).join("/")}`;
  });
  state.loading[picture.file].then((image) => {
    if (image) {
      state.files[picture.file] = picture.steel ? inSteel(image) : image;
      state.scratch ??= document.createElement("canvas");
      const ctx = state.scratch.getContext("2d", { willReadFrequently: true });
      const { x = 0, y = 0, w = image.naturalWidth, h = image.naturalHeight } = picture;
      state.scratch.width = w;
      state.scratch.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const box = solidBox(data, w, h);
      if (box) state.boxes[picture.id] = { ...box, w, h, slant: slantOf(data, w, box) };
    }
    clearTimeout(state.settle);
    state.settle = setTimeout(() => {
      state.version += 1;
      changed();
    }, 120);
  });
}

// Asked for by Settings: whether the test is on, and in which of the pack's two looks. The sheets are fetched the
// first time it's turned on.
export function setPixelArt({ on, look }) {
  const was = pixelKey();
  state.on = !!on;
  state.look = LOOKS[look] ? look : "dark";
  if (state.on && !state.images) loadSheets();
  if (pixelKey() !== was) changed();
}

// Told whenever what the view should draw changes (turned on or off, another look, the sheets arrived).
export function onPixelArt(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

// Whether the pack is there to draw with: null while it loads, true once it has, false if it isn't in the game's folder.
export function pixelArtFound() {
  if (state.failed) return false;
  return state.loaded ? true : null;
}

// Whether the second pack, with most of the furniture, is in the game's folder: null until the page knows.
export function pixelFurnitureFound() {
  return state.loaded ? state.second : null;
}

// What the pictures of the room are drawn with, as one short string: part of every picture's name, so turning the test
// on or off, or the sheets arriving, draws the room again.
export function pixelKey() {
  return pixelArtOn() ? `px-${state.look}${state.look === "dark" && state.lightDim < 0.995 ? `@${state.lightDim}` : ""}` : "drawn";
}

// A room of a Dark ship can be in the pack's Light look (the medbay, the galley), toned down so that it sits with the
// rest: its floors, walls and furniture are drawn from a copy of the sheet that's dimmed and greyed by so much. 1 is
// the pack's own Light, which is also what a ship that's Light all through gets.
export function setLightDim(value) {
  const dim = Math.min(1, Math.max(0.35, Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1));
  if (dim === state.lightDim) return;
  state.lightDim = dim;
  state.dimmed = {};
}
export const lightDim = () => state.lightDim;
function sheetFor(sheet, look) {
  const image = state.images[sheet];
  if (look !== "light" || state.look === "light" || state.lightDim >= 0.995 || typeof document === "undefined") return image;
  if (!state.dimmed[sheet]) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.filter = `brightness(${state.lightDim}) saturate(${(0.45 + state.lightDim * 0.55).toFixed(3)})`;
    ctx.drawImage(image, 0, 0);
    state.dimmed[sheet] = canvas;
  }
  return state.dimmed[sheet];
}

// Whether the room should be drawn in the pack's pictures now.
export function pixelArtOn() {
  return (state.on || state.forced) && state.loaded;
}

// For the map editor's picture of the deck it's changing, which is in the packs' pictures whatever view the game is
// in: everything drawn while `draw` runs is drawn with them, and the sheets are fetched the first time it's asked.
// (Until they've come, or if they aren't on this computer, it's the game's own drawing.)
export function asPixelArt(draw) {
  if (!state.images && !state.failed && typeof Image !== "undefined") loadSheets();
  const was = state.forced;
  state.forced = true;
  try {
    return draw();
  } finally {
    state.forced = was;
  }
}

// The size of a tile the room is drawn at, with the wheel at rest, while the test is on: half the pack's own, so its
// pixels are halved evenly and not smeared.
export const PIXEL_UNIT = 64;

function changed() {
  for (const listener of state.listeners) listener();
}

function loadSheets() {
  state.images = {};
  const load = (src) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(src));
    image.src = src;
  });
  const sheets = Promise.all(Object.entries(SHEETS).map(([name, file]) => load(BASE + file).then((image) => [name, image])));
  // A file of the second pack: its folders' names have spaces and brackets in them, so each part is made safe for a link.
  const paths = [...new Set(Object.values(PIECES).flat().flatMap(picturesOf).filter((picture) => picture.file).map((picture) => picture.file))];
  const link = (path) => INTERIORS + path.split("/").map(encodeURIComponent).join("/");
  const files = Promise.all(paths.map((path) => load(link(path)).then((image) => [path, image], () => null)));
  Promise.all([sheets, files]).then(([pairs, found]) => {
    for (const [name, image] of pairs) state.images[name] = image;
    for (const one of found) if (one) state.files[one[0]] = STEEL_FILES.has(one[0]) ? inSteel(one[1]) : one[1];
    state.second = found.some(Boolean);
    readTops();
    readBoxes();
    state.loaded = true;
    changed();
  }).catch(() => {
    state.failed = true;
    changed();
  });
}

// The colour of the top of a wall in each look, read from the pack itself, for the tops of the game's thick walls.
function readTops() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  for (const [name, look] of Object.entries(LOOKS)) {
    // Just inside the top of the first wall's slab.
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(state.images.level, WALL_DOWN_RIGHT.cells[0] * 128 + 96, look.wallRow * 128 + 3, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    state.tops[name] = `rgb(${r},${g},${b})`;
  }
}

// Where each piece of furniture is in its picture, so it can be stood in the middle of the game's piece: the box its
// solid pixels fill, read once. The second pack draws a soft shadow under its pieces, half see-through, which isn't
// part of the piece.
function readBoxes() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  for (const picture of new Map(Object.values(PIECES).flat().flatMap(picturesOf).map((one) => [one.id, one])).values()) {
    const image = picture.file ? state.files[picture.file] : state.images[picture.sheet];
    if (!image) continue;
    const { x = 0, y = 0, w = image.naturalWidth ?? image.width, h = image.naturalHeight ?? image.height } = picture;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const box = solidBox(data, w, h);
    if (box) state.boxes[picture.id] = { ...box, w, h };
  }
}

// The box the solid pixels of a picture fill, from its pixels as a canvas gives them (four numbers a pixel).
export function solidBox(data, w, h) {
  const box = { x0: w, y0: h, x1: -1, y1: -1 };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] < 250) continue;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
    }
  }
  return box.x1 < 0 ? null : box;
}

// The point of a piece's picture that stands on the middle of its place on the floor: halfway across, and up from its
// lowest pixel by a quarter of its width, which is the middle of the diamond it stands on.
export function standingPoint(box) {
  const width = box.x1 - box.x0 + 1;
  return [box.x0 + width / 2, box.y1 + 1 - width / 4];
}

// The transform that takes three points of a cell of a sheet to three points on the canvas, as the six numbers a
// canvas's setTransform takes.
export function mapping(from, to) {
  const [p0, p1, p2] = from;
  const [q0, q1, q2] = to;
  const a1 = [p1[0] - p0[0], p1[1] - p0[1]];
  const a2 = [p2[0] - p0[0], p2[1] - p0[1]];
  const b1 = [q1[0] - q0[0], q1[1] - q0[1]];
  const b2 = [q2[0] - q0[0], q2[1] - q0[1]];
  const det = a1[0] * a2[1] - a2[0] * a1[1];
  const inv = [a2[1] / det, -a2[0] / det, -a1[1] / det, a1[0] / det];
  const a = b1[0] * inv[0] + b2[0] * inv[2];
  const c = b1[0] * inv[1] + b2[0] * inv[3];
  const b = b1[1] * inv[0] + b2[1] * inv[2];
  const d = b1[1] * inv[1] + b2[1] * inv[3];
  return [a, b, c, d, q0[0] - a * p0[0] - c * p0[1], q0[1] - b * p0[0] - d * p0[1]];
}

// A cell of a sheet onto the canvas, with three of its points on three of the view's.
function drawCell(painter, cx, cy, from, to, sheet = "level", look = state.look) {
  const { ctx, ratio } = painter;
  const [a, b, c, d, e, f] = mapping(from, to);
  ctx.save();
  ctx.setTransform(a * ratio, b * ratio, c * ratio, d * ratio, e * ratio, f * ratio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sheetFor(sheet, look), cx * 128, cy * 128, 128, 128, 0, 0, 128, 128);
  ctx.restore();
}

// A number from 0 to 1 for a tile, the same every time.
function hash(x, y, salt = 0) {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ salt * 83492791, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// The floor of one stretch of the picture: every tile any of these floor cells is on, back to front, kept inside the
// cells, so a tile's thickness under it is hidden by the tiles in front and nothing spills off the floor. Each cell is
// { x, y, passage, second }, x in the game's half-width squares.
export function drawPixelFloors(painter, cells, cellWidth) {
  if (!cells.length) return;
  // A room in the other look (the medbay's Light, on a Dark ship) has its own stretch of floor, laid after the rest.
  const other = state.look === "dark" ? "light" : null;
  const theirs = other ? cells.filter((cell) => cell.look === other) : [];
  const mine = theirs.length ? cells.filter((cell) => cell.look !== other) : cells;
  if (mine.length) layFloor(painter, mine, cellWidth, state.look);
  if (theirs.length) layFloor(painter, theirs, cellWidth, other);
}
function layFloor(painter, cells, cellWidth, which) {
  const { ctx, at } = painter;
  const look = LOOKS[which];
  const picks = FLOOR_PICKS[which];
  const tiles = new Map();
  ctx.save();
  ctx.beginPath();
  for (const cell of cells) {
    const x0 = cell.x * cellWidth;
    const x1 = x0 + cellWidth;
    ctx.moveTo(...at(x0, cell.y));
    ctx.lineTo(...at(x1, cell.y));
    ctx.lineTo(...at(x1, cell.y + 1));
    ctx.lineTo(...at(x0, cell.y + 1));
    ctx.closePath();
    const tx = Math.floor(x0);
    const key = `${tx},${cell.y}`;
    if (!tiles.has(key)) tiles.set(key, { tx, ty: cell.y, kind: cell.passage ? "passage" : cell.second ? "second" : "plain" });
  }
  // Under the tiles, the floor's own dark, so the joins between them don't show what's under the room.
  const dim = which === "light" && state.look === "dark" ? state.lightDim : 1;
  ctx.fillStyle = which === "dark" ? "#1e2322" : `rgb(${Math.round(126 * dim)},${Math.round(132 * dim)},${Math.round(130 * dim)})`;
  ctx.fill();
  ctx.clip();
  for (const tile of [...tiles.values()].sort((p, q) => p.tx + p.ty - (q.tx + q.ty) || p.tx - q.tx)) {
    const choices = picks[tile.kind];
    const pick = choices[Math.floor(hash(tile.tx, tile.ty, 1) * choices.length)];
    const to = [at(tile.tx, tile.ty), at(tile.tx + 1, tile.ty), at(tile.tx, tile.ty + 1)];
    drawCell(painter, look.floors[pick], look.floorRow, FLOOR_CORNERS, to, "level", which);
  }
  ctx.restore();
}

// A wall standing its full height: the game's own block, with its top in the pack's colour and a slab of the pack's
// wall on each face that shows. A face along the plan's rows is half a tile wide and the pack's wall a whole tile, so
// both halves of a tile's wall are drawn from the same slab, each kept to its own half. Returns false if the test isn't
// on, so the game draws the wall itself.
export function drawPixelWall(painter, block, { cellWidth, sameWallRight, sameWallLeft, lookLeft = state.look, lookRight = state.look }) {
  if (!pixelArtOn()) return false;
  const { ctx, at } = painter;
  const { x, y, h } = block;
  const x0 = x * cellWidth;
  const x1 = x0 + cellWidth;
  // The top, short of the front edge where a slab stands, whose own top is drawn there (the slab may have been drawn
  // already, by the square to the left).
  const front = block.left < h ? y + 1 - 0.125 : y + 1;
  ctx.beginPath();
  for (const point of [at(x0, y, h), at(x1, y, h), at(x1, front, h), at(x0, front, h)]) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = state.tops[state.look] ?? "#2a2f2e";
  ctx.fill();
  // The face looking down and to the left, along the plan's row: the whole tile's slab when the square beside it
  // shows the same face (so there's no join between the halves), else just this square's half.
  if (block.left < h) {
    const tile = Math.floor(x0 + 1e-6);
    const cell = WALL_DOWN_LEFT.cells[Math.floor(hash(tile, y, 2) * WALL_DOWN_LEFT.cells.length)];
    const to = [at(tile, y + 1, 0), at(tile + 1, y + 1, 0), at(tile, y + 1, h)];
    const first = Math.abs(x0 - tile) < 1e-6;
    if (first && sameWallRight) {
      drawCell(painter, cell, LOOKS[lookLeft].wallRow, WALL_DOWN_LEFT.corners, to, "level", lookLeft);
    } else if (first || !sameWallLeft) {
      ctx.save();
      ctx.beginPath();
      for (const point of [at(x0, y + 1, -0.05), at(x1, y + 1, -0.05), at(x1, y + 0.8, h + 0.3), at(x0, y + 0.8, h + 0.3)]) ctx.lineTo(...point);
      ctx.closePath();
      ctx.clip();
      drawCell(painter, cell, LOOKS[lookLeft].wallRow, WALL_DOWN_LEFT.corners, to, "level", lookLeft);
      ctx.restore();
    }
  }
  // The face looking down and to the right, along the plan's column: a square is a whole tile deep, so it's a whole slab.
  if (block.right < h) {
    const cell = WALL_DOWN_RIGHT.cells[Math.floor(hash(Math.round(x1 * 2), y, 3) * WALL_DOWN_RIGHT.cells.length)];
    drawCell(painter, cell, LOOKS[lookRight].wallRow, WALL_DOWN_RIGHT.corners, [at(x1, y + 1, 0), at(x1, y, 0), at(x1, y + 1, h)], "level", lookRight);
  }
  return true;
}

// Which of a door's sixteen pictures it shows: shut and red when locked, shut and green when shut, then one of the six
// sliding open by how far open it is.
export function doorPicture(open, locked = false) {
  if (locked) return 2;
  if (open < 0.06) return 1;
  return OPENING[Math.min(OPENING.length - 1, Math.floor(open * OPENING.length))];
}

// A door between rooms, in the front of its doorway, in the line of the walls beside it. A doorway along the plan's
// row is half a tile wide and the pack's door a whole tile, so a door on its own is centred on it, over the edges of
// the walls either side (as a frame is wider than its opening), and two doorways side by side share one door. Returns
// false if the test isn't on, or for the second of two doorways side by side, which has nothing to draw.
export function drawPixelDoor(painter, { x, y, along, kinds }, open, { cellWidth, wallHeight, locked = false }) {
  if (!pixelArtOn()) return false;
  const { at } = painter;
  const picture = doorPicture(open, locked);
  const rows = DOOR_ROWS[state.look];
  const column = picture % 8;
  const x0 = x * cellWidth;
  if (along === "x") {
    if (kinds?.[y]?.[x - 1] === "door") return true;
    const pair = kinds?.[y]?.[x + 1] === "door";
    const a = pair ? x0 : x0 + cellWidth / 2 - 0.5;
    drawCell(painter, column, rows.downLeft + Math.floor(picture / 8), WALL_DOWN_LEFT.corners, [at(a, y + 1, 0), at(a + 1, y + 1, 0), at(a, y + 1, wallHeight)], "doors");
  } else {
    const face = x0 + cellWidth;
    drawCell(painter, column, rows.downRight + Math.floor(picture / 8), WALL_DOWN_RIGHT.corners, [at(face, y + 1, 0), at(face, y, 0), at(face, y + 1, wallHeight)], "doors");
  }
  return true;
}

// Where a door drawn by drawPixelDoor stands, for putting it in order with the people round it: the line of its front.
export function pixelDoorDepth({ x, y, along }, cellWidth) {
  return along === "x" ? (x + 0.5) * cellWidth + y + 1 - 0.02 : (x + 1) * cellWidth + y + 0.5 - 0.02;
}

// How a piece of the game's furniture is drawn from the packs: which picture, whether it's turned round, and what goes
// with it. Null if the packs have nothing for it, or the pictures it would take aren't in the folder.
export function pieceWay(kind, facing = "s", seed = 0, { look = state.look, has = (picture) => !!state.boxes[picture.id] } = {}) {
  // A piece of the packs put on a deck as itself: its own picture, fetched the first time it's needed.
  const own = state.pack[kind];
  if (own) {
    const picture = own.faces ? own.faces[facing] ?? own.faces.s : own.picture;
    if (!picture) return null;
    if (!has(picture)) {
      want(picture);
      return null;
    }
    return { picture, flip: !own.faces && (facing === "e" || facing === "w"), times: 1, on: null, lift: 0 };
  }
  for (const way of PIECES[kind] ?? []) {
    const picture = way.faces ? way.faces[facing] ?? way.faces.s : way.any ? way.any[Math.min(way.any.length - 1, Math.floor(seed * way.any.length))] : way[look] ?? way.picture;
    if (!picture || !has(picture) || (way.on && !has(way.on))) continue;
    // Which look's picture it is, where the piece has one for each: a Light one in a Dark ship is toned down.
    return { picture, flip: !way.faces && (facing === "e" || facing === "w"), times: way.times ?? 1, on: way.on ?? null, lift: way.lift ?? 0, look: way.light && picture === way.light ? "light" : null };
  }
  return null;
}

// One picture of a piece, stood with its middle on a point of the floor (cx, cy, in tiles) or so far above it, as much
// bigger than its own size as the pack's walls are stood up, so they keep to each other and to the game's people.
function drawPicture(painter, picture, cx, cy, { flip = false, lift = 0, wallHeight, middle = false, look = null }) {
  const box = state.boxes[picture.id];
  const { ctx, ratio, at, unit } = painter;
  const scale = (unit / 128) * (wallHeight / WALL_PACK_HEIGHT);
  const turn = flip ? -1 : 1;
  // What's hung on a wall is placed by its middle; anything else by where it stands.
  const [ax, ay] = middle ? [(box.x0 + box.x1 + 1) / 2, (box.y0 + box.y1 + 1) / 2] : standingPoint(box);
  const [px, py] = at(cx, cy, lift);
  const image = picture.file ? state.files[picture.file] : sheetFor(picture.sheet, look ?? state.look);
  ctx.save();
  ctx.setTransform(ratio * scale * turn, 0, 0, ratio * scale, ratio * (px - scale * turn * ax), ratio * (py - scale * ay));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, picture.x ?? 0, picture.y ?? 0, box.w, box.h, 0, 0, box.w, box.h);
  ctx.restore();
}

// A piece of the game's furniture, if the packs have one like it: drawn in its place, and true; else false, and the
// game draws its own. A long piece's picture is drawn several times along it, the far one first.
export function drawPixelPiece(painter, piece, { wallHeight, look = state.look }) {
  if (!pixelArtOn() || piece.kind === "crate") return false;
  const kind = FURNITURE_BY_ID[piece.kind];
  if (kind?.pack && kind.wall) {
    // A fitting of the packs on a wall: its picture by its middle, on the face of the wall the room sees, turned
    // round if it was drawn for the other kind of wall.
    const hung = pieceWay(piece.kind, "s");
    if (!hung) return false;
    const [wx, wy] = piece.face === "s" ? [(piece.x0 + piece.x1) / 2, piece.y1 + 0.04] : [piece.x1 + 0.04, (piece.y0 + piece.y1) / 2];
    const lean = state.boxes[hung.picture.id].slant;
    drawPicture(painter, hung.picture, wx, wy, { flip: Boolean(lean) && lean !== piece.face, lift: kind.high ?? 0.95, wallHeight, middle: true });
    return true;
  }
  const way = pieceWay(piece.kind, piece.facing ?? "s", piece.seed ?? 0, { look });
  if (!way) return false;
  const cx = (piece.x0 + piece.x1) / 2;
  const cy = (piece.y0 + piece.y1) / 2;
  const across = piece.x1 - piece.x0 >= piece.y1 - piece.y0;
  // Evenly along the piece's length, each in the middle of its share of it.
  const along = (from, to) => Array.from({ length: way.times }, (_, i) => from + ((i + 0.5) * (to - from)) / way.times);
  const spots = across ? along(piece.x0, piece.x1).map((x) => [x, cy]) : along(piece.y0, piece.y1).map((y) => [cx, y]);
  for (const [x, y] of spots) {
    drawPicture(painter, way.picture, x, y, { flip: way.flip, lift: piece.lift ?? 0, wallHeight, look: way.look });
    if (way.on) drawPicture(painter, way.on, x, y, { lift: way.lift, wallHeight });
  }
  return true;
}

// A crate on the plan, on its square.
export function drawPixelCrate(painter, { x, y }, { cellWidth, wallHeight, look = state.look }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay("crate", "s", 0, { look });
  if (!way) return false;
  drawPicture(painter, way.picture, (x + 0.5) * cellWidth, y + 0.5, { wallHeight, look: way.look });
  return true;
}
