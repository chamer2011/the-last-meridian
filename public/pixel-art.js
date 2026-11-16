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
  bench: [{ picture: from("Tables/Table_Corridor.png"), times: 3 }],
  table: [{ picture: from("Tables/Office_Kitchen_Table.png") }],
  "long-table": [{ picture: from("Tables/Office_Kitchen_Table.png"), times: 4 }],
  shelf: [{ picture: from("Office/Rack.png") }],
  screen: [{ picture: from("Computer/Vertical_Screen.png") }],
  kettle: [{ picture: from("Kitchen/Oven.png"), on: from("Kitchen/Pot_Full.png"), lift: 0.7 }],
  plant: [{ any: [from("Plants/Plant_3.png"), from("Plants/Plant_2.png"), from("Plants/Plant_5.png"), from("Plants/Plant_1.png")] }],
  basin: [{ picture: from("Bathroom/WC_Tap_Ani/Wc_Tap_1.png") }],
  // What the plan's own marks are drawn as (not furniture anyone places): a console of a bank, and a bank's odd square.
  // A bunk is the pack's, which is a tile long where the game's is two: two of them end to end. Its picture runs along
  // the plan's rows as it's drawn (lengthways), so it's turned round for a bunk that runs down the plan's columns.
  bunk: [{ picture: cell(4, 0), times: 2, lengthways: true }],
  // A sickbay cot is the second pack's plain bed, its wooden frame drawn in steel (STEEL_FILES): one, in the middle of
  // the cot's place, which is longer than it is.
  cot: [{ picture: from("Bedroom/Bed_G_4.png") }],
  // The lamp on a wall that lights a room, and goes dark with the room's power.
  "plan-lamp": [{ picture: from("Lamps/Lamp_Modern.png") }],
  // What the plan's own marks are drawn as (not furniture anyone places): a console of a bank, and a bank's odd square.
  "plan-console": [{ picture: cell(7, 1) }],
  "plan-terminal": [{ picture: cell(5, 0) }],
  // In a galley a bank is its counters and stoves: the second pack's kitchen unit, its wood drawn in steel, and its stove.
  "plan-counter": [{ picture: from("Kitchen/Kitchen_A_Tile.png") }],
  // A big machine's parts: the pump units either side of an engine's burning heart, the tanks with lit cores that stand
  // in it, and what a heap of scrap is (a stack of drums or a pile of cases).
  "plan-pump": [{ picture: cell(6, 0) }],
  "plan-tank": [{ picture: cell(3, 1) }],
  "plan-scrap": [{ any: [cell(1, 0), cell(2, 0)] }],
  "plan-stove": [{ picture: from("Kitchen/Oven.png") }],
  // The parts of a place's systems that hang on its walls, where the second pack has a fitting for one: a camera on
  // its bracket (the first picture of the pack's sixteen of it turning), a switch with its green light on, its red
  // one, or neither, a vent's grille, a junction box on its conduit, and the small screen of a door's keypad.
  "part:camera": [{ picture: { id: "Lab/Camera_1_Ani.png#0", file: "Lab/Camera_1_Ani.png", x: 0, y: 0, w: 64, h: 64 } }],
  "part:switch-on": [{ picture: from("Lab/Switch_B.png") }],
  "part:switch-off": [{ picture: from("Lab/Switch_C.png") }],
  "part:switch-dead": [{ picture: from("Lab/Switch_A.png") }],
  "part:vent": [{ picture: from("Kitchen/Rack.png") }],
  "part:box": [{ picture: from("Lab/Pipe_Horizontal_Box.png") }],
  "part:keypad": [{ picture: from("Lab/Screen_Small.png") }],
  // The camera's sixteen pictures as it turns; the alarm's light, a dome; and the big units, which stand at the foot of
  // their wall: the comms relay a rack of lights, the navigation core a glass-fronted cabinet, the air plant a standing
  // unit with its duct, the engines' own part a pump unit. The first pack's rack stands in without the second pack.
  "part:turning": [{ any: Array.from({ length: 16 }, (_, n) => ({ id: `Lab/Camera_1_Ani.png#${n}`, file: "Lab/Camera_1_Ani.png", x: (n % 4) * 64, y: Math.floor(n / 4) * 64, w: 64, h: 64 })) }],
  "part:alarm": [{ picture: from("Lab/Camera_2.png") }],
  "part:relay": [{ picture: { id: "Lab/Server_1.png#0", file: "Lab/Server_1.png", x: 0, y: 0, w: 128, h: 128 } }, { picture: cell(7, 0) }],
  "part:core": [{ picture: from("Lab/Server_2_A.png") }, { picture: cell(7, 0) }],
  "part:air": [{ picture: from("Lab/Ac_Big_2.png") }],
  "part:engines": [{ picture: cell(6, 0) }],
  // What a thing that's none of the game's furniture is drawn as, by its name (thingPicture, below).
  "thing:case": [{ picture: from("Lab/Tool_Box_A.png") }],
  "thing:box": [{ picture: from("Office/White_Box.png") }],
  "thing:tank": [{ picture: cell(3, 1) }],
  "thing:rack": [{ picture: cell(7, 0) }],
  "thing:terminal": [{ picture: cell(5, 0) }],
  "thing:pod": [{ picture: cell(0, 1) }],
  "thing:urn": [{ picture: from("Tables/Office_Kitchen_Table.png"), on: from("Kitchen/Ketel_7.png"), lift: 0.48 }],
  "thing:paper": [{ picture: from("Office/Paper_1.png") }],
  "thing:frame": [{ picture: from("Office/Picture_Frame.png") }],
  "thing:chip": [{ picture: from("Lab/Tools_Electric.png") }],
  "thing:small": [{ picture: from("Lab/Plastic_Box_2_Full.png") }],
  // What runs along a bare stretch of wall: a pipe, a bundle of cables, cables in a tray.
  "run:pipe": [{ picture: from("Lab/Pipe_Horizontal.png") }],
  "run:cable": [{ picture: from("Lab/Cable_Horizontal_2.png") }],
  "run:tray": [{ picture: from("Lab/Cable_Horizontal_1.png") }],
};
const picturesOf = (way) => [way.picture, way.dark, way.light, way.on, ...Object.values(way.faces ?? {}), ...(way.any ?? [])].filter(Boolean);
// The pack's walls are 1.375 tiles high and the game's 1.7, so the pack's are stood up taller to the game's height.
// Its furniture is drawn at its own size all the same, at the owner's word ("higher walls and smaller objects"), and
// the game's people as much smaller as that makes it beside the game's own (PACK_FIGURE), so they still fit its chairs.
const WALL_PACK_HEIGHT = 1.375;
export const PACK_FIGURE = WALL_PACK_HEIGHT / 1.7;
// The game's own furniture whose picture in the packs is wood or orange, and is drawn in steel: the benches and the
// washbasins' cabinets. (A piece of the packs put on a deck as itself says so in world/furniture.txt, "in steel".)
const STEEL_FILES = new Set(["Tables/Table_Corridor.png", "Bathroom/WC_Tap_Ani/Wc_Tap_1.png", "Bedroom/Bed_G_4.png", "Kitchen/Kitchen_A_Tile.png"]);

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

const state = { on: false, look: "dark", people: "drawn", images: null, files: {}, loaded: false, failed: false, second: null, tops: {}, boxes: {}, listeners: new Set(), pack: {}, wanted: new Set(), loading: {}, version: 0, settle: 0, scratch: null, forced: false, lightDim: 1, dimmed: {} };

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
export function setPixelArt({ on, look, people }) {
  const was = `${pixelKey()}/${state.people}`;
  state.on = !!on;
  state.look = LOOKS[look] ? look : "dark";
  state.people = people === "pixel" ? "pixel" : "drawn";
  if (state.on && !state.images) loadSheets();
  if (`${pixelKey()}/${state.people}` !== was) changed();
}

// How people are drawn in this view: false for the game's own figures as they are, true for the pixel style the
// owner is trying (public/pixel-people.js).
export const pixelPeople = () => pixelArtOn() && state.people === "pixel";

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
    // Which wall a flat fitting was drawn for goes with it (slantOf), for the ones the game hangs on walls itself.
    if (box) state.boxes[picture.id] = { ...box, w, h, slant: slantOf(data, w, box) };
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
  // Hazard paint on the floor along the foot of a big machine.
  for (const cell of cells) if (cell.hazard) paintHazard(painter, cell, cellWidth);
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
    if (tile.kind === "plain" && replacedPlate(tile.tx, tile.ty)) {
      // A plate that isn't the one the deck was built with: a shade off the rest, bolted down at its corners.
      const corner = (dx, dy) => at(tile.tx + dx, tile.ty + dy);
      ctx.beginPath();
      for (const point of [corner(0.05, 0.05), corner(0.95, 0.05), corner(0.95, 0.95), corner(0.05, 0.95)]) ctx.lineTo(...point);
      ctx.closePath();
      ctx.fillStyle = hash(tile.tx, tile.ty, 8) < 0.5 ? "rgba(196,210,214,.1)" : "rgba(0,0,0,.18)";
      ctx.fill();
      ctx.fillStyle = "rgba(8,10,10,.75)";
      const r = Math.max(1, painter.unit * 0.012);
      for (const [px, py] of [corner(0.14, 0.14), corner(0.86, 0.14), corner(0.86, 0.86), corner(0.14, 0.86)]) ctx.fillRect(px - r, py - r / 2, r * 2, r);
    }
  }
  ctx.restore();
}

// Whether a tile of plain floor is a plate put in since the ship was built: about one in sixteen, the same every time.
export const replacedPlate = (tx, ty) => hash(tx, ty, 7) < 0.0625;

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

// The pack's low wall: on the level sheet, under each look's walls, across two cells, as two arms from a far corner. One
// runs a tile along the plan's columns (down and to the left) and one a tile along its rows (down and to the right),
// each with a post half way. An arm's far foot, its near foot, and a point a tile above the far foot, in pixels of the
// two cells together; and the stretch of them it's cut from.
const LOW_DOWN_LEFT = { corners: [[128, 86], [64, 118], [128, 22]], from: 40, wide: 100 };
const LOW_DOWN_RIGHT = { corners: [[128, 86], [192, 118], [128, 22]], from: 116, wide: 100 };
// How far above the floor the sill under a low wall is.
const SILL = 0.05;

// A stretch of a sheet's row of cells, drawn so that three of its points land on three points of the picture.
function drawStretch(painter, row, arm, to, look) {
  const { ctx, ratio } = painter;
  const [a, b, c, d, e, f] = mapping(arm.corners, to);
  ctx.save();
  ctx.setTransform(a * ratio, b * ratio, c * ratio, d * ratio, e * ratio, f * ratio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sheetFor("level", look), arm.from, row * 128, arm.wide, 128, arm.from, 0, arm.wide, 128);
  ctx.restore();
}

// A wall that's been cut down so the room behind it can be seen (a wall with floor behind it, or to its left): in the
// pixel-art view, the pack's low wall along the middle of it, on a dark sill the size of the wall's square. A wall along
// the plan's row has one arm to a tile, which is two squares, each square showing its own half; a wall down the plan's
// column has one to a square. wallAt(x, y) says whether a square is wall. False if the test isn't on.
export function drawPixelLowWall(painter, block, { cellWidth, wallAt, look = state.look }) {
  if (!pixelArtOn()) return false;
  const { ctx, at } = painter;
  const { x, y } = block;
  const x0 = x * cellWidth;
  const x1 = x0 + cellWidth;
  const face = (points, colour) => {
    ctx.beginPath();
    for (const point of points) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  };
  // The sill: its two faces toward the room's viewer where nothing stands in front of them, and its top.
  const top = state.tops[look === "light" && state.look === "dark" ? "dark" : look] ?? "#2a2f2e";
  if (!wallAt(x, y + 1)) face([at(x0, y + 1, SILL), at(x1, y + 1, SILL), at(x1, y + 1, 0), at(x0, y + 1, 0)], "#121514");
  if (!wallAt(x + 1, y)) face([at(x1, y, SILL), at(x1, y + 1, SILL), at(x1, y + 1, 0), at(x1, y, 0)], "#0c0e0d");
  face([at(x0, y, SILL), at(x1, y, SILL), at(x1, y + 1, SILL), at(x0, y + 1, SILL)], top);
  const row = LOOKS[look].wallRow + 1;
  const along = wallAt(x - 1, y) || wallAt(x + 1, y);
  const down = wallAt(x, y - 1) || wallAt(x, y + 1);
  if (down) {
    const middle = x0 + cellWidth / 2;
    drawStretch(painter, row, LOW_DOWN_LEFT, [at(middle, y, SILL), at(middle, y + 1, SILL), at(middle, y, SILL + 1)], look);
  }
  if (along || !down) {
    // This square's half of the tile's arm, kept to the square.
    const tile = Math.floor(x0 + 1e-6);
    ctx.save();
    ctx.beginPath();
    for (const point of [at(x0, y + 0.95, -0.05), at(x1, y + 0.95, -0.05), at(x1, y + 0.05, 0.8), at(x0, y + 0.05, 0.8)]) ctx.lineTo(...point);
    ctx.closePath();
    ctx.clip();
    drawStretch(painter, row, LOW_DOWN_RIGHT, [at(tile, y + 0.5, SILL), at(tile + 1, y + 0.5, SILL), at(tile, y + 0.5, SILL + 1)], look);
    ctx.restore();
  }
  return true;
}

// The pack's stairs: on the level sheet, two rows under each look's walls. The first cell is a flight that rises toward
// the west (the plan's smaller x), its far rail with it; the second is its near rail, drawn over it cell on cell. (The
// third and fourth are the same turned to rise north.) top: where the middle of the flight's top edge is in its cell.
// A flight is run tiles long, rises rise tiles, and is wide tiles across.
export const FLIGHT = { top: [33, 39], run: 0.625, rise: 0.72, wide: 0.65 };
const STAIR_STEEL = ["#262e2d", "#161b1b", "#0e1212"];

// One flight with both its rails, at the pack's own size: the middle of its top edge at xTop, yc on the plan, zTop up.
function drawFlight(painter, look, xTop, yc, zTop, bright = 1) {
  const { ctx, ratio, at, unit } = painter;
  const scale = unit / 128;
  const [px, py] = at(xTop, yc, zTop);
  const row = (LOOKS[look].wallRow + 2) * 128;
  const sheet = sheetFor("level", look);
  ctx.save();
  ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * (px - scale * FLIGHT.top[0]), ratio * (py - scale * FLIGHT.top[1]));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Down a well it's lit from the deck above it, or it couldn't be made out against the dark.
  if (bright !== 1) ctx.filter = `brightness(${bright})`;
  ctx.drawImage(sheet, 0, row, 128, 128, 0, 0, 128, 128);
  ctx.drawImage(sheet, 128, row, 128, 128, 0, 0, 128, 128);
  ctx.restore();
}

// A box of plain steel in the stairs' own dark: its top, its side toward the camera and its side to the right.
function solid(painter, [x0, y0, x1, y1], z0, z1, [top, front, side] = STAIR_STEEL) {
  const { ctx, at } = painter;
  const face = (points, colour) => {
    ctx.beginPath();
    for (const point of points) ctx.lineTo(...point);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  };
  face([at(x1, y0, z1), at(x1, y1, z1), at(x1, y1, z0), at(x1, y0, z0)], side);
  face([at(x0, y1, z1), at(x1, y1, z1), at(x1, y1, z0), at(x0, y1, z0)], front);
  face([at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], top);
}

// How a staircase going up stands in its place: two flights, the second from the top of the first, to a landing as high
// as the walls nearly are; in the middle of its place along it, its foot at the east end. All along the plan's x.
export function stairsUp({ x0, x1 }) {
  const landing = Math.min(0.45, Math.max(0.15, x1 - x0 - FLIGHT.run * 2 - 0.1));
  const foot = (x0 + x1) / 2 + (FLIGHT.run * 2 + landing) / 2;
  return { foot, mid: foot - FLIGHT.run, top: foot - FLIGHT.run * 2, landing, high: FLIGHT.rise * 2 };
}

// A deck's stairs, in the pixel-art view, where the plan has their row of posts (stairsOf in public/iso.js finds them;
// stair is { way, x0, y0, x1, y1 } in tiles). The way down is a well in the deck with the pack's flight going down into
// it from its west end, hazard paint along its near edges; the way up is two of the pack's flights, one from the top
// of the other, to a landing on posts. False if the test isn't on, and the game draws its posts.
export function drawPixelStairs(painter, stair, { look = state.look } = {}) {
  if (!pixelArtOn()) return false;
  const { ctx, at } = painter;
  const yc = (stair.y0 + stair.y1) / 2;
  const half = FLIGHT.wide / 2;
  if (stair.way === "up") {
    const { mid, top, landing, high } = stairsUp(stair);
    const post = (x, y, h) => solid(painter, [x - 0.03, y - 0.03, x + 0.03, y + 0.03], 0, h);
    for (const [x, h] of [[top - landing, high], [top, high], [mid, FLIGHT.rise]]) post(x, yc - half, h);
    solid(painter, [top - landing, yc - half, top, yc + half], high - 0.06, high);
    drawFlight(painter, look, top, yc, high);
    drawFlight(painter, look, mid, yc, FLIGHT.rise);
    for (const [x, h] of [[top - landing, high], [top, high], [mid, FLIGHT.rise]]) post(x, yc + half, h);
    return true;
  }
  // The well: all of the stairs' place but a rim. What's below the deck is seen only through its mouth.
  const [ax, ay, bx, by] = [stair.x0 + 0.06, stair.y0 + 0.14, stair.x1 - 0.06, stair.y1 - 0.14];
  const mouth = [at(ax, ay), at(bx, ay), at(bx, by), at(ax, by)];
  const trace = (points) => {
    ctx.beginPath();
    for (const point of points) ctx.lineTo(...point);
    ctx.closePath();
  };
  ctx.save();
  trace(mouth);
  ctx.clip();
  ctx.fillStyle = "#040606";
  ctx.fill();
  // Its far walls, going down into the dark.
  const deep = 1.6;
  const wall = (from, to, colour) => {
    const [a, b, c, d] = [at(...from, 0), at(...to, 0), at(...to, -deep), at(...from, -deep)];
    const shade = ctx.createLinearGradient(a[0], a[1], d[0], d[1]);
    shade.addColorStop(0, colour);
    shade.addColorStop(0.75, "#040606");
    trace([a, b, c, d]);
    ctx.fillStyle = shade;
    ctx.fill();
  };
  wall([ax, ay], [bx, ay], "#2a3534");
  wall([ax, by], [ax, ay], "#1a2221");
  drawFlight(painter, look, ax + 0.1, yc, 0, 1.7);
  // Darker the further down it goes.
  const [from, to] = [at(ax, yc), at(ax + 1.5, yc + 1.2)];
  const dark = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  dark.addColorStop(0, "rgba(2,4,4,0)");
  dark.addColorStop(0.3, "rgba(2,4,4,0)");
  dark.addColorStop(1, "rgba(2,4,4,.9)");
  trace(mouth);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.restore();
  // A lip round the mouth, and hazard paint along the two edges nearest the camera.
  ctx.lineWidth = Math.max(1, painter.unit * 0.02);
  ctx.strokeStyle = "#2c3534";
  trace(mouth);
  ctx.stroke();
  hazardBand(painter, [ax, by], [bx, by], 0.07);
  hazardBand(painter, [bx, ay], [bx, by], 0.07);
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
    const sideways = facing === "e" || facing === "w";
    return { picture, flip: !way.faces && (way.lengthways ? !sideways : sideways), times: way.times ?? 1, on: way.on ?? null, lift: way.lift ?? 0, look: way.light && picture === way.light ? "light" : null };
  }
  return null;
}

// One picture of a piece, stood with its middle on a point of the floor (cx, cy, in tiles) or so far above it, at the
// pack's own size: half its pixels at 64 a tile, so they stay even.
function drawPicture(painter, picture, cx, cy, { flip = false, lift = 0, wallHeight, middle = false, anchor = null, look = null, dim = false }) {
  const box = state.boxes[picture.id];
  const { ctx, ratio, at, unit } = painter;
  const scale = unit / 128;
  const turn = flip ? -1 : 1;
  // What's hung on a wall is placed by its middle; anything else by where it stands.
  // (Or by a point of the picture's own, where it has to stay put from one picture to the next: a camera's bracket.)
  const [ax, ay] = anchor ?? (middle ? [(box.x0 + box.x1 + 1) / 2, (box.y0 + box.y1 + 1) / 2] : standingPoint(box));
  const [px, py] = at(cx, cy, lift);
  const image = picture.file ? state.files[picture.file] : sheetFor(picture.sheet, look ?? state.look);
  ctx.save();
  ctx.setTransform(ratio * scale * turn, 0, 0, ratio * scale, ratio * (px - scale * turn * ax), ratio * (py - scale * ay));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Something with its power off is drawn dark and dull.
  if (dim) ctx.filter = "brightness(0.5) saturate(0.4)";
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

// Which of a bank's squares a console of the plan stands on, and what's drawn there. A bank is a run of console squares
// along a row: the pack's control console is a tile across, which is two squares, so there's one to each two squares
// from the bank's left end, and its narrower terminal desk on an odd last square, or on a square with none beside it.
// The second square of a pair has nothing of its own. A run with more of the same above or below it is no bank of
// consoles but one big machine (the ship's boat, an engine): block is true, and the game draws that itself.
// isMachine(x, y) says whether a square is a console's.
export function machineAt(x, y, isMachine, bank = null) {
  let start = x;
  while (isMachine(start - 1, y)) start -= 1;
  let end = x;
  while (isMachine(end + 1, y)) end += 1;
  for (let at = start; at <= end; at += 1) if (isMachine(at, y - 1) || isMachine(at, y + 1)) return { draw: null, block: true, start, end };
  const nth = x - start;
  // A galley's bank is a unit to every square: counters, with a stove for the second of every three.
  if (bank === "galley") return { draw: nth % 3 === 1 ? "plan-stove" : "plan-counter", across: 1, galley: true, start, end };
  if (nth % 2 === 1) return { draw: null, start, end };
  return x + 1 <= end ? { draw: "plan-console", across: 2, start, end } : { draw: "plan-terminal", across: 1, start, end };
}

// A console drawn on the plan, as the pack's: true if it's been seen to (drawn, or part of the console beside it), false
// if the test isn't on or the pictures aren't there, and the game draws its own block. Its front is toward the floor in
// front of the bank (below it on the plan), or turned to the floor at the bank's right-hand end when there's none below;
// with its power off it's dark.
export function drawPixelMachine(painter, block, { cellWidth, isMachine, floorAt }) {
  if (!pixelArtOn()) return false;
  const { x, y } = block;
  const found = machineAt(x, y, isMachine, block.bank);
  if (found.block) return false;
  const way = pieceWay(found.draw ?? "plan-console");
  if (!way) return false;
  if (!found.draw) return true;
  let below = false;
  for (let at = found.start; at <= found.end && !below; at += 1) below = floorAt(at, y + 1);
  // (The kitchen's units are drawn with their fronts the other way from the consoles'.)
  const flip = found.galley ? below : !below && floorAt(found.end + 1, y);
  drawPicture(painter, way.picture, (x + found.across / 2) * cellWidth, y + 0.5, { flip, dim: Boolean(block.off) });
  return true;
}

// How people lie in each bed the packs draw. runs: which way its picture runs as it's drawn, along the plan's rows
// ("x") or down its columns ("y"), its pillow at the far end; turned round, it's the other. head: how far from its
// middle the pillow is, in tiles. tiers: how high the bedding is, for each bed one above another. abreast: how many lie
// side by side. under: whoever's in it is seen through its lid. blankets: each has a blanket of their own colour over
// them (the pack's bunk has no bedding to show anyone under).
const BUNK_PLAN = { runs: "x", head: 0.24, tiers: [0.2, 0.62], blankets: true };
const BED_PLAN = { runs: "y", head: 0.38, tiers: [0.3] };
function bedPlan(id) {
  if (id === "isospace/bunk") return BUNK_PLAN;
  if (id === "isospace/pod") return { runs: "y", head: 0.16, tiers: [0.24], under: true };
  if (id.endsWith("Bed_M_4")) return { runs: "y", head: 0.72, tiers: [0.3], abreast: 2 };
  // A mattress on the floor.
  if (["Bed_A_4", "Bed_B_4", "Bed_C_4"].some((one) => id.endsWith(one))) return { ...BED_PLAN, tiers: [0.09] };
  return BED_PLAN;
}
// The game's own beds that the packs draw: a bunk is the pack's twice, end to end, with people in the far one.
const OWN_BEDS = { bunk: { ...BUNK_PLAN, twice: true }, cot: BED_PLAN };

// A bed the packs have something to say about: a piece of the packs that's a bed, in any view, or one of the game's own
// beds while the packs are drawing it. For each of those who can lie in it, where their head is (wx, wy on the floor,
// z up); run, the way they lie from there ("x" or "y", toward the bigger end) and long, how far; cx, cy, the bed's
// middle; under and blankets as above; and pictured, whether the bed is the pack's picture now or a plain shape, on
// whose top everyone lies side by side. Null for any other piece.
export function packBed(piece) {
  const kind = FURNITURE_BY_ID[piece?.kind];
  const sideways = piece?.facing === "e" || piece?.facing === "w";
  let plan;
  let flipped = sideways;
  let pictured = false;
  if (kind?.pack) {
    if (kind.what !== "bed") return null;
    plan = bedPlan(piece.kind);
    pictured = pixelArtOn() && Boolean(pieceWay(piece.kind, piece.facing ?? "s"));
  } else if (OWN_BEDS[piece?.kind]) {
    if (!pixelArtOn() || !pieceWay(piece.kind)) return null;
    plan = OWN_BEDS[piece.kind];
    if (PIECES[piece.kind][0].lengthways) flipped = !sideways;
    pictured = true;
  } else return null;
  const run = (plan.runs === "x") !== flipped ? "x" : "y";
  let cx = (piece.x0 + piece.x1) / 2;
  let cy = (piece.y0 + piece.y1) / 2;
  if (plan.twice && run === "y") cy = piece.y0 + (piece.y1 - piece.y0) / 4;
  if (plan.twice && run === "x") cx = piece.x0 + (piece.x1 - piece.x0) / 4;
  const beside = plan.abreast === 2 ? [-0.28, 0.28] : [0];
  const tiers = pictured ? plan.tiers : [kind?.high ?? 0.5];
  const across = pictured ? beside : plan.tiers.length * beside.length === 2 ? [-0.2, 0.2] : [0];
  const places = [];
  for (const z of tiers) for (const off of across) places.push(run === "y" ? { wx: cx + off, wy: cy - plan.head, z } : { wx: cx - plan.head, wy: cy + off, z });
  return { run, places, cx, cy, head: plan.head, long: plan.head * 2 + 0.06, under: Boolean(plan.under) && pictured, blankets: Boolean(plan.blankets) || !pictured, pictured };
}

// A lamp on a wall, as the pack's strip light: on the face of the wall the room sees, so high up it, dark when the
// room's lights are out. False if the test isn't on or the picture isn't there.
export function drawPixelFixture(painter, { x, y, face, off }, { cellWidth, high }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay("plan-lamp");
  if (!way) return false;
  const [wx, wy] = face === "left" ? [(x + 0.5) * cellWidth, y + 1.04] : [(x + 1) * cellWidth + 0.04, y + 0.5];
  // Turned round if it was drawn for the other kind of wall.
  const lean = state.boxes[way.picture.id].slant;
  drawPicture(painter, way.picture, wx, wy, { flip: Boolean(lean) && lean !== (face === "left" ? "s" : "e"), lift: high, middle: true, dim: Boolean(off) });
  return true;
}

// How each of those parts is put up. A fitting hangs on its wall by its middle, lift tiles up, turned by which wall its
// picture was drawn for (lean, where its pixels don't say). A camera hangs by the plate of its bracket (hung, in pixels
// of its picture), so that it stays put as it turns. A big unit stands on the floor (stand): against its wall, let a
// little way into it so there's room to stand in front of it, or on its own square where there's no wall; front is the
// way its picture's front looks ("s" or "e"), and high how tall it is, for the light the game puts over it.
const PART_HANG = {
  camera: { lift: 1.4, lean: "s", hung: [58, 32.5] },
  "light switch": { lift: 0.8 },
  vent: { lift: 0.32 },
  "junction box": { lift: 0.78 },
  "door panel": { lift: 0.82 },
  speaker: { lift: 1.3 },
  relay: { stand: true, front: "s", high: 1.2 },
  "nav core": { stand: true, front: "s", high: 1.25 },
  "air plant": { stand: true, front: "s", high: 1.35 },
  engines: { stand: true, front: "e", high: 0.75 },
};
const PART_PICTURES = { camera: "part:camera", vent: "part:vent", "junction box": "part:box", "door panel": "part:keypad", speaker: "part:alarm", relay: "part:relay", "nav core": "part:core", "air plant": "part:air", engines: "part:engines" };

// Which of the packs' pieces a part of the systems is drawn as, by what it is and how it stands: a switch shows its
// green light on, its red one off, and neither with no power. Null for a part the packs have nothing for (a wall
// console, docking clamps), and for a fitting that isn't on a wall.
export function partPicture(part) {
  const hang = part && PART_HANG[part.kind];
  if (!hang || (part.mount !== "wall" && !hang.stand)) return null;
  if (part.kind === "light switch") return part.word === "off" ? "part:switch-off" : part.works ? "part:switch-on" : "part:switch-dead";
  return PART_PICTURES[part.kind];
}

// Whether a camera turns on its bracket: one on a wall that works and has nothing over it.
export const cameraTurns = (part) => Boolean(part && part.kind === "camera" && part.mount === "wall" && part.works && part.word !== "covered");

// A part of the systems as the packs' piece: a fitting on the face of the wall the room sees, a big unit standing at
// the foot of it; dark and dull when it isn't working. frame picks which of a camera's sixteen pictures. Gives back
// where the game's own mark for it goes on the screen (a fitting's middle, the top of a unit) and which way it's turned
// (turn, 1 or -1); null if the test isn't on or the packs have no picture for it, and the game draws its own. With
// draw false it only says where.
export function drawPixelPart(painter, thing, { cellWidth, draw = true, frame = 0 }) {
  if (!pixelArtOn()) return null;
  const { part } = thing;
  const id = partPicture(part);
  const way = id && pieceWay(id);
  if (!way) return null;
  const hang = PART_HANG[part.kind];
  const side = part.face === "side";
  const dim = !part.works && part.kind !== "light switch";
  if (hang.stand) {
    const onWall = part.mount === "wall";
    const [sx, sy] = !onWall ? [(thing.x + 0.5) * cellWidth, thing.y + 0.5] : side ? [(thing.x + 1) * cellWidth + 0.06, thing.y + 0.5] : [(thing.x + 0.5) * cellWidth, thing.y + 1.06];
    const flip = onWall && (side ? "e" : "s") !== hang.front;
    if (draw) drawPicture(painter, way.picture, sx, sy, { flip, dim });
    return { at: painter.at(sx, sy, hang.high), turn: flip ? -1 : 1 };
  }
  const [wx, wy] = side ? [(thing.x + 1) * cellWidth + 0.04, thing.y + 0.5] : [(thing.x + 0.5) * cellWidth, thing.y + 1.04];
  const turning = part.kind === "camera" ? PIECES["part:turning"][0].any[frame] : null;
  const picture = turning && state.boxes[turning.id] ? turning : way.picture;
  const lean = hang.lean ?? state.boxes[picture.id].slant;
  const flip = Boolean(lean) && lean !== (side ? "e" : "s");
  if (draw) drawPicture(painter, picture, wx, wy, { flip, lift: hang.lift, middle: !hang.hung, anchor: hang.hung ?? null, dim });
  // A camera's body is out from its plate, toward the room.
  const [px, py] = painter.at(wx, wy, hang.lift);
  const out = hang.hung ? painter.unit * 0.17 * (flip ? 1 : -1) : 0;
  return { at: [px + out, py + (hang.hung ? painter.unit * 0.02 : 0)], turn: flip ? -1 : 1 };
}

// What runs along a bare stretch of wall, high up: a pipe, cables, or cables in a tray.
const WALL_RUNS = ["run:pipe", "run:cable", "run:tray"];

// Whether a wall's face has a run along it, and of what: by the stretch of wall it's part of (three tiles of a wall
// along the plan's rows, face "s"; three squares of one down its columns, face "e"), about one stretch in three, and
// the same every time. Null for none.
export function wallRun(x, y, face) {
  const [sx, sy, salt] = face === "s" ? [Math.floor(x / 6), y, 31] : [x, Math.floor(y / 3), 37];
  if (hash(sx, sy, salt) >= 0.34) return null;
  return WALL_RUNS[Math.floor(hash(sx, sy, salt + 1) * WALL_RUNS.length)];
}

// The pipes and cables on a wall's faces, in the pixel-art view: south and east say which of its two faces are bare
// (public/iso.js knows). One length to a square of a wall along the rows, two to a square of one down the columns,
// which is twice as long; turned round where the picture was drawn for the other kind of wall.
export function drawPixelWallRun(painter, block, { cellWidth, south, east }) {
  if (!pixelArtOn()) return;
  const { x, y } = block;
  const hang = (id, wx, wy, face) => {
    const way = pieceWay(id);
    if (!way) return;
    const lean = state.boxes[way.picture.id].slant;
    drawPicture(painter, way.picture, wx, wy, { flip: Boolean(lean) && lean !== face, lift: id === "run:pipe" ? 1.22 : 1.34, middle: true });
  };
  const along = south && wallRun(x, y, "s");
  if (along) hang(along, (x + 0.5) * cellWidth, y + 1.04, "s");
  const down = east && wallRun(x, y, "e");
  if (down) for (const part of [0.25, 0.75]) hang(down, (x + 1) * cellWidth + 0.04, y + part, "e");
}

// ---- Big machines, posts and scrap ----------------------------------------------------------------------------------

// Hazard paint: yellow and black along a line on the floor (from and to, in tiles), wide tiles to one side of it (the
// far side, with a number below nothing). The stripes go by where they are on the deck, so they meet from square to
// square.
const HAZARD = ["#b89a2c", "#1a1c18"];
const HAZARD_STEP = 0.125;
export function hazardBand(painter, [fx, fy], [tx, ty], wide = 0.07) {
  const { ctx, at } = painter;
  const alongX = fy === ty;
  const [a, b] = alongX ? [Math.min(fx, tx), Math.max(fx, tx)] : [Math.min(fy, ty), Math.max(fy, ty)];
  for (let s = Math.floor(a / HAZARD_STEP + 1e-6); s * HAZARD_STEP < b - 1e-6; s += 1) {
    const [p, q] = [Math.max(a, s * HAZARD_STEP), Math.min(b, (s + 1) * HAZARD_STEP)];
    const corners = alongX ? [[p, fy], [q, fy], [q, fy + wide], [p, fy + wide]] : [[fx, p], [fx, q], [fx + wide, q], [fx + wide, p]];
    ctx.beginPath();
    for (const [wx, wy] of corners) ctx.lineTo(...at(wx, wy));
    ctx.closePath();
    ctx.fillStyle = HAZARD[((s % 2) + 2) % 2];
    ctx.fill();
  }
}

// The hazard paint on a square of floor beside a big machine: along each of its edges the machine is on (hazard is
// some of "n", "s", "e" and "w").
function paintHazard(painter, cell, cellWidth) {
  const x0 = cell.x * cellWidth;
  const x1 = x0 + cellWidth;
  if (cell.hazard.includes("n")) hazardBand(painter, [x0, cell.y], [x1, cell.y], 0.07);
  if (cell.hazard.includes("s")) hazardBand(painter, [x0, cell.y + 1], [x1, cell.y + 1], -0.07);
  if (cell.hazard.includes("w")) hazardBand(painter, [x0, cell.y], [x0, cell.y + 1], 0.07);
  if (cell.hazard.includes("e")) hazardBand(painter, [x1, cell.y], [x1, cell.y + 1], -0.07);
}

// A rail along one edge of a square (edge is "n", "s", "e" or "w"): a length of the pack's low wall with its post,
// standing on the line between a machine and the floor beside it. Along the plan's rows a length is a tile, which is
// two squares, so each square shows its own half.
export function drawPixelRail(painter, block, { cellWidth, look = state.look }) {
  if (!pixelArtOn()) return false;
  const { ctx, at } = painter;
  const { x, y, edge } = block;
  const row = LOOKS[look].wallRow + 1;
  const x0 = x * cellWidth;
  const x1 = x0 + cellWidth;
  if (edge === "n" || edge === "s") {
    const wy = edge === "n" ? y : y + 1;
    const tile = Math.floor(x0 + 1e-6);
    ctx.save();
    ctx.beginPath();
    for (const point of [at(x0, wy + 0.2, -0.05), at(x1, wy + 0.2, -0.05), at(x1, wy - 0.2, 0.8), at(x0, wy - 0.2, 0.8)]) ctx.lineTo(...point);
    ctx.closePath();
    ctx.clip();
    drawStretch(painter, row, LOW_DOWN_RIGHT, [at(tile, wy, 0), at(tile + 1, wy, 0), at(tile, wy, 1)], look);
    ctx.restore();
  } else {
    const wx = edge === "w" ? x0 : x1;
    drawStretch(painter, row, LOW_DOWN_LEFT, [at(wx, y, 0), at(wx, y + 1, 0), at(wx, y, 1)], look);
  }
  return true;
}

// What a big machine's square is drawn as: one beside the burning heart of an engine (block.big "engine") is two of the
// pack's pump units, one behind the other, their pipes toward the heart; any other (the ship's boat) is a length of
// dark hull, as a wall of the pack's that's only as high as the machine is. sameRight and sameLeft say whether the
// squares beside it are hull of the same height showing the same face. False if the test isn't on.
export function drawPixelBigMachine(painter, block, { cellWidth, flip = false, sameRight = false, sameLeft = false }) {
  if (!pixelArtOn()) return false;
  if (block.big !== "engine") {
    if (!drawPixelWall(painter, block, { cellWidth, sameWallRight: sameRight, sameWallLeft: sameLeft })) return false;
    // The middle of a stretch of hull is its well, darker than its rim.
    if (block.inner) {
      const { ctx, at } = painter;
      const [x0, x1, h] = [block.x * cellWidth, (block.x + 1) * cellWidth, block.h];
      ctx.beginPath();
      for (const point of [at(x0, block.y, h), at(x1, block.y, h), at(x1, block.y + 1, h), at(x0, block.y + 1, h)]) ctx.lineTo(...point);
      ctx.closePath();
      ctx.fillStyle = "rgba(6,10,12,.62)";
      ctx.fill();
    }
    return true;
  }
  const way = pieceWay("plan-pump");
  if (!way) return false;
  for (const part of [0.27, 0.73]) drawPicture(painter, way.picture, (block.x + 0.5) * cellWidth, block.y + part, { flip });
  return true;
}

// A piece of the packs the room view stands somewhere itself (the console and the seats in the well of the ship's
// boat): by its name in PIECES, the way it faces, where its middle is on the plan and how high it stands.
export function drawPixelStood(painter, { piece, facing = "s", cx, cy, lift = 0 }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay(piece, facing);
  if (!way) return false;
  drawPicture(painter, way.picture, cx, cy, { flip: way.flip, lift });
  return true;
}

// One of the pack's tanks with a lit core, standing on a square of an engine's burning heart.
export function drawPixelTank(painter, block, { cellWidth }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay("plan-tank");
  if (!way) return false;
  drawPicture(painter, way.picture, (block.x + 0.5) * cellWidth, block.y + 0.5, {});
  return true;
}

// Something tall and narrow on the plan (the Map editor's Locker) is the packs' locker, its door toward the floor.
export function drawPixelPost(painter, block, { cellWidth, flip = false }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay("locker", flip ? "e" : "s");
  if (!way) return false;
  drawPicture(painter, way.picture, (block.x + 0.5) * cellWidth, block.y + 0.5, { flip: way.flip });
  return true;
}

// A heap of scrap on the plan is the pack's stack of drums or its pile of cases, the same one every time.
export function drawPixelScrap(painter, block, { cellWidth }) {
  if (!pixelArtOn()) return false;
  const way = pieceWay("plan-scrap", "s", block.seed ?? 0);
  if (!way) return false;
  drawPicture(painter, way.picture, (block.x + 0.5) * cellWidth, block.y + 0.5, {});
  return true;
}

// ---- Things by their names ------------------------------------------------------------------------------------------

// What a thing that's none of the game's furniture is drawn as, by the words in its name: the first line with one of
// its words in the name, as whole words. null is nothing at all, for what's somewhere to look and not an object (only
// its mark shows there). Anything no line knows is a small case.
const THING_WORDS = [
  [["viewport", "chalked names", "queue", "empty hold", "frame thirty", "duct"], null],
  [["gauges", "gauge"], "thing:terminal"],
  [["capacitor", "controller"], "thing:rack"],
  [["scan bed"], "thing:pod"],
  [["reactor", "coolant", "tank", "tanks"], "thing:tank"],
  [["urn", "kettle", "samovar"], "thing:urn"],
  [["chest", "footlocker", "trunk", "crate", "sack", "bedroll", "bedrolls", "patches", "bundle"], "thing:box"],
  [["photograph", "picture", "portrait"], "thing:frame"],
  [["rota", "slate", "manifest", "list", "ledger", "notice", "letter", "papers"], "thing:paper"],
  [["chip", "circuit"], "thing:chip"],
  [["chalk", "medal", "tabs", "tool roll", "coin"], "thing:small"],
];
export function thingPicture(name) {
  const words = ` ${String(name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  for (const [any, piece] of THING_WORDS) if (any.some((word) => words.includes(` ${word} `))) return piece;
  return "thing:case";
}

// A thing on the floor that's none of the game's furniture, as the packs' piece for what its name says it is; true if
// it's been seen to (drawn, or nothing to draw), false if the test isn't on or the picture isn't there, and the game
// draws its plain box.
export function drawPixelThing(painter, thing, { cellWidth }) {
  if (!pixelArtOn()) return false;
  const piece = thingPicture(thing.name);
  if (piece === null) return true;
  const way = pieceWay(piece);
  if (!way) return false;
  const [cx, cy] = [(thing.x + 0.5) * cellWidth, thing.y + 0.5];
  drawPicture(painter, way.picture, cx, cy, {});
  if (way.on) drawPicture(painter, way.on, cx, cy, { lift: way.lift });
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
