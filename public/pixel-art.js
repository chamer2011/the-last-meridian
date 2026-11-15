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

const BASE = "licensed/isospace/";
const SHEETS = { level: "IsoSpace_Level.png" };
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

const state = { on: false, look: "dark", images: null, loaded: false, failed: false, tops: {}, listeners: new Set() };

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

// What the pictures of the room are drawn with, as one short string: part of every picture's name, so turning the test
// on or off, or the sheets arriving, draws the room again.
export function pixelKey() {
  return pixelArtOn() ? `px-${state.look}` : "drawn";
}

// Whether the room should be drawn in the pack's pictures now.
export function pixelArtOn() {
  return state.on && state.loaded;
}

// The size of a tile the room is drawn at, with the wheel at rest, while the test is on: half the pack's own, so its
// pixels are halved evenly and not smeared.
export const PIXEL_UNIT = 64;

function changed() {
  for (const listener of state.listeners) listener();
}

function loadSheets() {
  state.images = {};
  const waiting = Object.entries(SHEETS).map(([name, file]) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([name, image]);
    image.onerror = () => reject(new Error(file));
    image.src = BASE + file;
  }));
  Promise.all(waiting).then((pairs) => {
    for (const [name, image] of pairs) state.images[name] = image;
    readTops();
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

// A cell of the level sheet onto the canvas, with three of its points on three of the view's.
function drawCell(painter, cx, cy, from, to) {
  const { ctx, ratio } = painter;
  const [a, b, c, d, e, f] = mapping(from, to);
  ctx.save();
  ctx.setTransform(a * ratio, b * ratio, c * ratio, d * ratio, e * ratio, f * ratio);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.images.level, cx * 128, cy * 128, 128, 128, 0, 0, 128, 128);
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
  const { ctx, at } = painter;
  const look = LOOKS[state.look];
  const picks = FLOOR_PICKS[state.look];
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
  ctx.fillStyle = state.look === "dark" ? "#1e2322" : "#7e8482";
  ctx.fill();
  ctx.clip();
  for (const tile of [...tiles.values()].sort((p, q) => p.tx + p.ty - (q.tx + q.ty) || p.tx - q.tx)) {
    const choices = picks[tile.kind];
    const pick = choices[Math.floor(hash(tile.tx, tile.ty, 1) * choices.length)];
    const to = [at(tile.tx, tile.ty), at(tile.tx + 1, tile.ty), at(tile.tx, tile.ty + 1)];
    drawCell(painter, look.floors[pick], look.floorRow, FLOOR_CORNERS, to);
  }
  ctx.restore();
}

// A wall standing its full height: the game's own block, with its top in the pack's colour and a slab of the pack's
// wall on each face that shows. A face along the plan's rows is half a tile wide and the pack's wall a whole tile, so
// both halves of a tile's wall are drawn from the same slab, each kept to its own half. Returns false if the test isn't
// on, so the game draws the wall itself.
export function drawPixelWall(painter, block, { cellWidth, sameWallRight, sameWallLeft }) {
  if (!pixelArtOn()) return false;
  const { ctx, at } = painter;
  const { x, y, h } = block;
  const look = LOOKS[state.look];
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
      drawCell(painter, cell, look.wallRow, WALL_DOWN_LEFT.corners, to);
    } else if (first || !sameWallLeft) {
      ctx.save();
      ctx.beginPath();
      for (const point of [at(x0, y + 1, -0.05), at(x1, y + 1, -0.05), at(x1, y + 0.8, h + 0.3), at(x0, y + 0.8, h + 0.3)]) ctx.lineTo(...point);
      ctx.closePath();
      ctx.clip();
      drawCell(painter, cell, look.wallRow, WALL_DOWN_LEFT.corners, to);
      ctx.restore();
    }
  }
  // The face looking down and to the right, along the plan's column: a square is a whole tile deep, so it's a whole slab.
  if (block.right < h) {
    const cell = WALL_DOWN_RIGHT.cells[Math.floor(hash(Math.round(x1 * 2), y, 3) * WALL_DOWN_RIGHT.cells.length)];
    drawCell(painter, cell, look.wallRow, WALL_DOWN_RIGHT.corners, [at(x1, y + 1, 0), at(x1, y, 0), at(x1, y + 1, h)]);
  }
  return true;
}
