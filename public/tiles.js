// The top-down view: the plan of the room drawn from above in pictures from a tileset, in place of the console art of
// the walk-around view. It's a test of how the game would look in ready-made top-down art, beside the isometric view,
// and changes nothing else: the people, things and ways out are the walk-around view's own marks, placed over it, and
// walking, clicking and the right-click menu are the walk-around view's too.
//
// The plan's squares are half as wide as they are deep, so one square tile of a tileset covers two of them side by side,
// the way one tile in Tiled does. Walls, floors and doors come from the tileset; the furniture has no pictures in the
// free packs, so it's drawn here in simple shapes in the pack's colours; and the game's own light goes over it all:
// rooms without power dimmed, dark rooms darker, the glow of screens and lamps, a fire's light.

import { FURNITURE_BY_ID, footprintOf } from "./furniture.js";

// The tilesets, each with where its pieces are on its sheet, counted in its own tiles from the top left.
export const TILE_PACKS = {
  techlab: {
    name: "Tech Lab",
    src: "art/topdown-techlab/tileset.png",
    tile: 16,
    // A wall's face, two tiles wide and two tall: plain, with a terminal, with a panel.
    faces: [[3, 1], [3, 1], [5, 1], [3, 1], [1, 1]],
    rim: [11, 1],
    sideLeft: [10, 3],
    sideRight: [13, 3],
    door: [7, 1],
    // A floor plate is two tiles by two: the left half from one column, the right from another, so no stripe shows.
    plate: { left: 1, right: 8, top: 4 },
    grate: { row: 7, cols: [3, 4, 5, 6] },
    stripe: [2, 4],
    space: "#05070b",
    wallTop: "#07090d",
    shadow: "rgba(0, 0, 0, .38)",
    furniture: { metal: "#4b5361", edge: "#262b34", top: "#5d6676", accent: "#3ad6c0", cloth: "#2f6f78", sheet: "#c9d3d6", wood: "#5a4a3a" },
  },
  interior: {
    name: "Sci-fi Interior",
    src: "art/topdown-scifi-interior/scifitiles-sheet.png",
    tile: 32,
    faces: [[0, 3], [0, 3], [1, 3], [0, 3], [2, 3]],
    faceWidth: 1,
    faceHeight: 1,
    wallTopTile: [2, 1],
    door: [0, 0],
    doorWidth: 2,
    doorHeight: 1,
    // The floor has a hazard edge where it meets a wall, three tiles by three: corners, edges and the middle.
    autotile: { col: 5, row: 0 },
    space: "#100e18",
    wallTop: "#22202e",
    shadow: "rgba(20, 16, 40, .28)",
    furniture: { metal: "#8d96ad", edge: "#4c5268", top: "#b4bccf", accent: "#4aa8ff", cloth: "#3f5fa8", sheet: "#f2f4f8", wood: "#8a6a4a" },
  },
};
export const packOf = (id) => TILE_PACKS[id] ?? TILE_PACKS.techlab;

// The sheets, loaded once, and every top-down picture on the page drawn again when one arrives.
const sheets = new Map();
function sheetOf(pack) {
  if (!sheets.has(pack.src)) {
    const img = new Image();
    img.onload = () => {
      for (const canvas of document.querySelectorAll("canvas.walk-tiles")) canvas.drawTiles?.();
    };
    img.src = pack.src;
    sheets.set(pack.src, img);
  }
  return sheets.get(pack.src);
}

// A number from 0 to 1 that's always the same for the same square, so the plan doesn't change from one drawing to the
// next.
const hashOf = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

// What each square of the plan is: a wall, a door, floor, or the space outside.
function gridOf(view) {
  const { cols, lines, layers } = view;
  const areas = view.areas ?? [];
  const inArea = (x, y) => areas.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
  const at = (layer, x, y) => layers[layer]?.[y]?.[x] ?? " ";
  const kinds = [];
  for (let y = 0; y < lines; y += 1) {
    const row = [];
    for (let x = 0; x < cols; x += 1) {
      if (at("walls", x, y) !== " ") row.push("wall");
      else if (at("doors", x, y) !== " ") row.push("door");
      else if (at("floor", x, y) !== " " || inArea(x, y) || (!areas.length && view.floor?.[y]?.[x] === ".")) row.push("floor");
      else row.push("space");
    }
    kinds.push(row);
  }
  const kindAt = (x, y) => kinds[y]?.[x] ?? "space";
  const open = (x, y) => kindAt(x, y) === "floor" || kindAt(x, y) === "door";
  const areaAt = (x, y) => {
    let best = null;
    for (const a of areas) if (x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h && (!best || a.w * a.h < best.w * best.h)) best = a;
    return best;
  };
  return { kinds, kindAt, open, areaAt, scenery: (x, y) => at("scenery", x, y) };
}

// The way into a room's floor: a passage or a stair gets the grating, a room the plates.
const PASSAGE = /passage|corridor|crawl|keel|stair|bulkhead|lift/i;

// Draws a half of a tile (the left or right half, for one of the plan's half-width squares) into a square of the plan.
function half(ctx, img, pack, col, row, side, dx, dy, dw, dh, rows = 1) {
  const t = pack.tile;
  ctx.drawImage(img, col * t + side * (t / 2), row * t, t / 2, t * rows, dx, dy, dw, dh);
}

function drawFloor(ctx, img, pack, grid, x, y, cw, ch) {
  const tx = Math.floor(x / 2);
  const side = x % 2;
  const area = grid.areaAt(x, y);
  if (pack.autotile) {
    // The edge of the floor shows where a whole tile's neighbour isn't floor.
    const floorTile = (ax, ay) => grid.open(ax * 2, ay) || grid.open(ax * 2 + 1, ay);
    const col = pack.autotile.col + (side === 0 ? (floorTile(tx - 1, y) ? 1 : 0) : (floorTile(tx + 1, y) ? 1 : 2));
    const row = pack.autotile.row + (floorTile(tx, y - 1) ? (floorTile(tx, y + 1) ? 1 : 2) : 0);
    half(ctx, img, pack, col, row, side, x * cw, y * ch, cw, ch);
    return;
  }
  if (pack.grate && area && PASSAGE.test(`${area.id} ${area.name}`)) {
    half(ctx, img, pack, pack.grate.cols[tx % pack.grate.cols.length], pack.grate.row, side, x * cw, y * ch, cw, ch);
    return;
  }
  const { plate } = pack;
  half(ctx, img, pack, tx % 2 === 0 ? plate.left : plate.right, plate.top + (y % 2), side, x * cw, y * ch, cw, ch);
}

// A wall seen from above at a slant: its face where there's floor below it, its rim where there's floor above, its
// side where there's floor beside it, and its top, dark, everywhere else.
function drawWall(ctx, img, pack, grid, x, y, cw, ch) {
  const tx = Math.floor(x / 2);
  const side = x % 2;
  const dx = x * cw;
  const dy = y * ch;
  if (grid.open(x, y + 1)) {
    // A face two tiles wide covers two of the plan's tiles, so the same face runs on across both.
    const wide = pack.faceWidth === 1 ? 1 : 2;
    const [col, row] = pack.faces[Math.floor(hashOf(Math.floor(tx / wide), y) * pack.faces.length)];
    half(ctx, img, pack, col + (tx % wide), row, side, dx, dy, cw, ch, pack.faceHeight ?? 2);
    return;
  }
  ctx.fillStyle = pack.wallTop;
  ctx.fillRect(dx, dy, cw, ch);
  if (pack.wallTopTile) half(ctx, img, pack, pack.wallTopTile[0], pack.wallTopTile[1], side, dx, dy, cw, ch);
  if (pack.rim && grid.open(x, y - 1)) half(ctx, img, pack, pack.rim[0] + (tx % 2), pack.rim[1], side, dx, dy, cw, ch);
  else if (pack.sideLeft && grid.open(x - 1, y)) half(ctx, img, pack, pack.sideLeft[0], pack.sideLeft[1], 0, dx, dy, cw, ch);
  else if (pack.sideRight && grid.open(x + 1, y)) half(ctx, img, pack, pack.sideRight[0], pack.sideRight[1], 1, dx, dy, cw, ch);
  else if (!pack.rim && (grid.open(x, y - 1) || grid.open(x - 1, y) || grid.open(x + 1, y))) {
    // A pack with no rim of its own gets a light edge where the wall meets the floor.
    ctx.fillStyle = "rgba(255, 255, 255, .22)";
    if (grid.open(x, y - 1)) ctx.fillRect(dx, dy, cw, Math.max(1, ch * 0.08));
    if (grid.open(x - 1, y)) ctx.fillRect(dx, dy, Math.max(1, cw * 0.14), ch);
    if (grid.open(x + 1, y)) ctx.fillRect(dx + cw - Math.max(1, cw * 0.14), dy, Math.max(1, cw * 0.14), ch);
  }
}

// A door across a wall that runs left to right is the pack's door, stretched over every square of it; one in a wall
// that runs up and down is an open frame on the floor.
function drawDoors(ctx, img, pack, grid, cw, ch) {
  const { kinds } = grid;
  for (let y = 0; y < kinds.length; y += 1) {
    for (let x = 0; x < kinds[y].length; x += 1) {
      if (kinds[y][x] !== "door" || kinds[y][x - 1] === "door") continue;
      let run = 1;
      while (kinds[y][x + run] === "door") run += 1;
      const across = grid.kindAt(x - 1, y) !== "wall" && grid.kindAt(x + run, y) !== "wall";
      const t = pack.tile;
      if (!across) {
        const [col, row] = pack.door;
        ctx.drawImage(img, col * t, row * t, t * (pack.doorWidth ?? 2), t * (pack.doorHeight ?? 2), x * cw, y * ch, run * cw, ch);
      } else {
        for (let i = 0; i < run; i += 1) drawFloor(ctx, img, pack, grid, x + i, y, cw, ch);
        ctx.fillStyle = pack.wallTop;
        ctx.fillRect(x * cw, y * ch, run * cw, ch * 0.18);
        ctx.fillRect(x * cw, y * ch + ch * 0.82, run * cw, ch * 0.18);
        ctx.fillStyle = pack.furniture.accent;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x * cw, y * ch + ch * 0.46, run * cw, ch * 0.08);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// What the plan draws as scenery inside a room (the console banks drawn in brackets on the walk-around view): a bank
// of screens.
function drawScenery(ctx, pack, grid, x, y, cw, ch) {
  const glyph = grid.scenery(x, y);
  if (glyph === " " || grid.kindAt(x, y) !== "floor") return;
  const f = pack.furniture;
  const dx = x * cw;
  const dy = y * ch;
  ctx.fillStyle = f.edge;
  ctx.fillRect(dx, dy + ch * 0.12, cw, ch * 0.76);
  ctx.fillStyle = f.metal;
  ctx.fillRect(dx, dy + ch * 0.18, cw, ch * 0.5);
  if (glyph === "=" || glyph === "[" || glyph === "]") {
    ctx.fillStyle = f.accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(dx + (glyph === "[" ? cw * 0.3 : 0), dy + ch * 0.26, glyph === "]" ? cw * 0.7 : glyph === "[" ? cw * 0.7 : cw, ch * 0.16);
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

// The furniture, in simple shapes in the pack's colours, since the free packs have no pictures of it.
function drawPiece(ctx, piece, cw, ch, pal) {
  const kind = FURNITURE_BY_ID[piece.kind];
  if (!kind) return;
  const { across, down } = footprintOf(piece);
  const x = piece.x * cw;
  const y = piece.y * ch;
  const w = across * cw;
  const h = down * ch;
  const pad = Math.min(w, h) * 0.08;
  const facing = piece.facing ?? "s";
  const box = (fill, ix, iy, iw, ih, r = 3) => {
    ctx.fillStyle = fill;
    roundRect(ctx, ix, iy, iw, ih, r);
    ctx.fill();
  };
  const outline = () => {
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.05);
    ctx.stroke();
  };
  // The back of a seat, on the side away from where it faces.
  const back = (thick) => {
    const t = thick * Math.min(w, h);
    if (facing === "s") box(pal.edge, x + pad, y + pad, w - 2 * pad, t);
    if (facing === "n") box(pal.edge, x + pad, y + h - pad - t, w - 2 * pad, t);
    if (facing === "e") box(pal.edge, x + pad, y + pad, t, h - 2 * pad);
    if (facing === "w") box(pal.edge, x + w - pad - t, y + pad, t, h - 2 * pad);
  };
  switch (piece.kind) {
    case "chair":
    case "bench":
      box(pal.metal, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 4);
      outline();
      back(0.28);
      break;
    case "command-chair":
      box(pal.edge, x + pad * 0.5, y + pad * 0.5, w - pad, h - pad, 6);
      box(pal.cloth, x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56, 5);
      outline();
      back(0.22);
      break;
    case "table":
    case "long-table":
      box(pal.edge, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 3);
      box(pal.top, x + pad * 1.8, y + pad * 1.8, w - 3.6 * pad, h - 3.6 * pad, 2);
      break;
    case "desk":
      box(pal.edge, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 2);
      box(pal.top, x + pad * 1.6, y + pad * 1.6, w - 3.2 * pad, h - 3.2 * pad, 2);
      box(pal.accent, x + w * 0.25, y + h * 0.18, w * 0.5, h * 0.22, 1);
      break;
    case "bunk":
    case "cot": {
      box(pal.edge, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 3);
      box(piece.kind === "cot" ? pal.sheet : pal.cloth, x + pad * 1.8, y + pad * 1.8, w - 3.6 * pad, h - 3.6 * pad, 3);
      // The pillow is at the end the bed doesn't face.
      const p = 0.22;
      const pill = { s: [x + w * 0.2, y + pad * 2.2, w * 0.6, h * p * 0.6], n: [x + w * 0.2, y + h - pad * 2.2 - h * p * 0.6, w * 0.6, h * p * 0.6], e: [x + pad * 2.2, y + h * 0.2, w * p * 0.6, h * 0.6], w: [x + w - pad * 2.2 - w * p * 0.6, y + h * 0.2, w * p * 0.6, h * 0.6] }[facing];
      box(pal.sheet, ...pill, 3);
      if (piece.kind === "bunk") {
        ctx.fillStyle = "rgba(0, 0, 0, .25)";
        ctx.fillRect(x + pad * 1.8, y + h * 0.5, w - 3.6 * pad, Math.max(1, h * 0.03));
      }
      break;
    }
    case "locker":
      box(pal.metal, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 2);
      outline();
      ctx.fillStyle = pal.edge;
      ctx.fillRect(x + w / 2 - 0.5, y + pad, 1, h - 2 * pad);
      break;
    case "shelf":
      box(pal.edge, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 2);
      for (let i = 0; i < 4; i += 1) box(i % 2 ? pal.wood : pal.top, x + pad * 2 + i * (w - 4 * pad) / 4, y + h * 0.28, (w - 4 * pad) / 4 - 2, h * 0.44, 1);
      break;
    case "plot-table":
      box(pal.edge, x + pad, y + pad, w - 2 * pad, h - 2 * pad, 4);
      box("#7dffa8", x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6, 3);
      ctx.strokeStyle = "rgba(0, 60, 30, .6)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x + w * 0.2 + (w * 0.6 * i) / 4, y + h * 0.2);
        ctx.lineTo(x + w * 0.2 + (w * 0.6 * i) / 4, y + h * 0.8);
        ctx.stroke();
      }
      break;
    case "screen":
      box(pal.edge, x + pad * 2, y + pad * 2, w - 4 * pad, h - 4 * pad, 2);
      box("#86dcff", x + w * 0.28, y + h * 0.28, w * 0.44, h * 0.3, 1);
      break;
    case "kettle":
      ctx.fillStyle = pal.edge;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.42, h * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff9a50";
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.28, h * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "barrel":
      ctx.fillStyle = pal.metal;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.4, h * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      outline();
      break;
    case "plant":
      ctx.fillStyle = pal.wood;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.36, h * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3f9a4a";
      for (let i = 0; i < 5; i += 1) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2 + Math.cos(i * 1.3) * w * 0.16, y + h / 2 + Math.sin(i * 1.3) * h * 0.16, w * 0.16, h * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "basin":
      box(pal.sheet, x + pad * 2, y + pad * 2, w - 4 * pad, h - 4 * pad, 6);
      box("#9cc8e0", x + w * 0.3, y + h * 0.3, w * 0.4, h * 0.4, 4);
      break;
    case "wall-screen":
      box("#86dcff", x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.4, 1);
      break;
    case "window":
      box("#0a1428", x + w * 0.05, y + h * 0.2, w * 0.9, h * 0.6, 1);
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(x + w * (0.2 + hashOf(piece.x, piece.y) * 0.6), y + h * 0.4, 1.5, 1.5);
      break;
    default:
      box(pal.metal, x + pad, y + pad, w - 2 * pad, h - 2 * pad);
  }
}

// The game's own light over the art: rooms without power dimmed, dark rooms darker, screens and lamps glowing, fires.
function drawLight(ctx, view, cw, ch) {
  const areas = view.areas ?? [];
  const unlit = (x, y) => areas.some((a) => (a.dark || a.power === false) && x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const piece of view.furniture ?? []) {
    const lit = FURNITURE_BY_ID[piece.kind]?.lit;
    if (!lit || unlit(piece.x, piece.y)) continue;
    const { across, down } = footprintOf(piece);
    const cx = (piece.x + across / 2) * cw;
    const cy = (piece.y + down / 2) * ch;
    const r = Math.max(cw, ch) * 2.6;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    glow.addColorStop(0, `${lit}55`);
    glow.addColorStop(1, `${lit}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  for (const area of areas) {
    if (!area.fire) continue;
    const cx = (area.x + area.w / 2) * cw;
    const cy = (area.y + area.h / 2) * ch;
    const r = Math.max(area.w * cw, area.h * ch) * 0.6;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    glow.addColorStop(0, `rgba(255, 120, 40, ${0.2 + 0.1 * area.fire})`);
    glow.addColorStop(1, "rgba(255, 80, 20, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(area.x * cw, area.y * ch, area.w * cw, area.h * ch);
  }
  ctx.restore();
  for (const area of areas) {
    if (area.dark) ctx.fillStyle = "rgba(0, 0, 0, .66)";
    else if (area.power === false) ctx.fillStyle = "rgba(0, 0, 20, .3)";
    else if (area.breach) ctx.fillStyle = "rgba(150, 190, 255, .12)";
    else continue;
    ctx.fillRect(area.x * cw, area.y * ch, area.w * cw, area.h * ch);
  }
}

// The space outside, with a few stars.
function drawSpace(ctx, pack, x, y, cw, ch) {
  ctx.fillStyle = pack.space;
  ctx.fillRect(x * cw, y * ch, cw, ch);
  if (hashOf(x * 3 + 1, y * 7 + 2) > 0.93) {
    ctx.fillStyle = hashOf(x, y) > 0.5 ? "#cfd8ff" : "#8090c0";
    ctx.fillRect(x * cw + hashOf(y, x) * cw, y * ch + hashOf(x + 5, y) * ch, 1.5, 1.5);
  }
}

function drawAll(canvas, view, pack) {
  const plan = canvas.parentElement;
  if (!plan) return;
  const img = sheetOf(pack);
  const width = plan.offsetWidth;
  const height = plan.offsetHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const cw = width / view.cols;
  const ch = height / view.lines;
  const grid = gridOf(view);
  const ready = img.complete && img.naturalWidth > 0;
  for (let y = 0; y < view.lines; y += 1) {
    for (let x = 0; x < view.cols; x += 1) {
      const kind = grid.kinds[y][x];
      if (kind === "space") drawSpace(ctx, pack, x, y, cw, ch);
      else if (!ready) {
        ctx.fillStyle = kind === "wall" ? pack.wallTop : "#333";
        ctx.fillRect(x * cw, y * ch, cw, ch);
      } else if (kind === "floor") drawFloor(ctx, img, pack, grid, x, y, cw, ch);
      else if (kind === "wall") drawWall(ctx, img, pack, grid, x, y, cw, ch);
    }
  }
  if (ready) {
    drawDoors(ctx, img, pack, grid, cw, ch);
    // The shadow a wall's face throws on the floor in front of it.
    ctx.fillStyle = pack.shadow;
    for (let y = 1; y < view.lines; y += 1) for (let x = 0; x < view.cols; x += 1) if (grid.kinds[y][x] === "floor" && grid.kinds[y - 1][x] === "wall") ctx.fillRect(x * cw, y * ch, cw, ch * 0.3);
  }
  for (let y = 0; y < view.lines; y += 1) for (let x = 0; x < view.cols; x += 1) drawScenery(ctx, pack, grid, x, y, cw, ch);
  for (const piece of view.furniture ?? []) drawPiece(ctx, piece, cw, ch, pack.furniture);
  drawLight(ctx, view, cw, ch);
}

// The picture, as a canvas under the walk-around view's marks. It draws itself once it's on the page, and again when
// its sheet arrives or the window changes size.
export function tilesLayer(view, packId) {
  const pack = packOf(packId);
  const canvas = document.createElement("canvas");
  canvas.className = "walk-tiles";
  canvas.setAttribute("aria-hidden", "true");
  canvas.drawTiles = () => drawAll(canvas, view, pack);
  // Once it's on the page: at the next frame, or soon after for a page in the background, whose frames wait.
  requestAnimationFrame(() => canvas.drawTiles());
  setTimeout(() => canvas.drawTiles(), 60);
  return canvas;
}

window.addEventListener("resize", () => {
  for (const canvas of document.querySelectorAll("canvas.walk-tiles")) canvas.drawTiles?.();
});
