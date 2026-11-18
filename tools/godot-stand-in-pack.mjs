// A made-up copy of the two bought pixel-art packs, in plain grey shapes, for checking the Godot view (godot/) on a
// computer that hasn't the real ones: a cloud session, say. The packs' licence forbids giving their files away, so
// they're only ever in licensed/ on the owner's computer; this draws stand-ins from what the repository does say about
// them: the first pack's measurements (public/pixel-art.js: where a floor tile's corners are in its cell, a wall
// slab's feet and top, the low wall's arms, a flight of stairs, the doors' sixteen pictures) and, for the furniture,
// each piece's line in world/furniture.txt (how many squares it takes and how high it stands). Nothing in them is
// copied from the packs, and none of it is for anyone to see in the game.
//
//   node tools/godot-stand-in-pack.mjs <an empty folder outside the game's own>
//
// then point the game's reader and Godot at it:
//
//   GAME_LICENSED_DIR=<that folder> godot --path godot
//
// It won't write inside the game's folder, so a stand-in can never be taken for the real art or committed.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { projectDir } from "../src/paths.js";

const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!target) {
  console.error("Say where to make the stand-in packs: node tools/godot-stand-in-pack.mjs <a folder>");
  process.exit(1);
}
const rel = path.relative(projectDir, target);
if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
  console.error("That's inside the game's own folder. Stand-ins go somewhere else, so they're never taken for the real art.");
  process.exit(1);
}
process.env.GAME_LICENSED_DIR = target;
process.env.GAME_DATA_DIR ??= path.join(target, ".data");

// ---- A picture, and a PNG of it -------------------------------------------------------------------------------------

const picture = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const shade = (colour, by) => (typeof colour === "string" ? rgb(colour) : colour).map((value) => Math.max(0, Math.min(255, Math.round(value * by))));

// Fills a shape, a pixel being in it when its middle is.
function fill(pic, points, colour, alpha = 255) {
  const [r, g, b] = typeof colour === "string" ? rgb(colour) : colour;
  const ys = points.map((point) => point[1]);
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(pic.h - 1, Math.ceil(Math.max(...ys))); y += 1) {
    const cy = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % points.length];
      if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) crossings.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((a, b2) => a - b2);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(crossings[i] - 0.5)); x <= Math.min(pic.w - 1, Math.floor(crossings[i + 1] - 0.5)); x += 1) {
        pic.data.set([r, g, b, alpha], (y * pic.w + x) * 4);
      }
    }
  }
}

// A line a pixel or two thick.
function line(pic, [x0, y0], [x1, y1], colour, wide = 1) {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const [nx, ny] = [((y1 - y0) / length) * wide * 0.5, (-(x1 - x0) / length) * wide * 0.5];
  fill(pic, [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], colour);
}

function png(pic) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "ascii"), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const stride = pic.w * 4;
  const raw = Buffer.alloc(pic.h * (stride + 1));
  for (let y = 0; y < pic.h; y += 1) raw.set(pic.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pic.w, 0);
  ihdr.writeUInt32BE(pic.h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function save(relative, pic) {
  const file = path.join(target, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png(pic));
}

// ---- Shapes at the packs' size: a tile 128 pixels across and 64 down ------------------------------------------------

// A box standing on the floor: a tiles along the plan's rows, d along its columns, h high, from z0 up, its middle on
// the floor at (cx, cy) of the picture, off by (ox, oy) tiles.
function box(pic, cx, cy, a, d, h, colour, { z0 = 0, ox = 0, oy = 0, mark = null } = {}) {
  const at = (wx, wy, z) => [cx + (wx + ox - wy - oy) * 64, cy + (wx + ox + wy + oy) * 32 - z * 64];
  const [x0, x1, y0, y1] = [-a / 2, a / 2, -d / 2, d / 2];
  const z1 = z0 + h;
  fill(pic, [at(x1, y0, z1), at(x1, y1, z1), at(x1, y1, z0), at(x1, y0, z0)], shade(colour, 0.62));
  fill(pic, [at(x0, y1, z1), at(x1, y1, z1), at(x1, y1, z0), at(x0, y1, z0)], shade(colour, 0.85));
  fill(pic, [at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], shade(colour, 1.15));
  line(pic, at(x0, y1, z1), at(x1, y1, z1), shade(colour, 1.4));
  line(pic, at(x1, y1, z1), at(x1, y0, z1), shade(colour, 1.4));
  // A mark on its top, toward its front: a light that's on, the side a seat faces.
  if (mark) fill(pic, [at(x0 * 0.5, y1 * 0.2, z1), at(x1 * 0.5, y1 * 0.2, z1), at(x1 * 0.5, y1 * 0.8, z1), at(x0 * 0.5, y1 * 0.8, z1)], mark);
}

// A picture just big enough for a box of that size, with the box in it.
function boxPicture(a, d, h, colour, extra = {}) {
  const pad = 2;
  const w = Math.max(8, Math.ceil((a + d) * 64) + pad * 2);
  const tall = Math.max(8, Math.ceil((a + d) * 32 + h * 64) + pad * 2);
  const pic = picture(w, tall);
  box(pic, w / 2, tall - pad - (a + d) * 16, a, d, h, colour, extra);
  return pic;
}

// A seat seen from one of its four sides: A faces the camera (the plan's south), B the east, C the west, D away.
function seatPicture(a, d, h, colour, side) {
  const pad = 2;
  const w = Math.ceil((a + d) * 64) + pad * 2;
  const tall = Math.ceil((a + d) * 32 + h * 64) + pad * 2;
  const pic = picture(w, tall);
  const [cx, cy] = [w / 2, tall - pad - (a + d) * 16];
  const back = { A: { oy: -d / 2 + 0.04, a, d: 0.08 }, D: { oy: d / 2 - 0.04, a, d: 0.08 }, B: { ox: -a / 2 + 0.04, a: 0.08, d }, C: { ox: a / 2 - 0.04, a: 0.08, d } }[side];
  const seat = () => box(pic, cx, cy, a, d, h * 0.45, colour);
  const rest = () => box(pic, cx, cy, back.a, back.d, h, shade(colour, 0.8), { ox: back.ox ?? 0, oy: back.oy ?? 0 });
  // The far part first.
  if (side === "A" || side === "B") { rest(); seat(); } else { seat(); rest(); }
  return pic;
}

// Something flat on a wall, as the packs draw one for a wall seen from the room below it on the plan: its top runs
// down to the right.
function panelPicture(wide, high, colour, light = null) {
  const pic = picture(wide + 2, Math.ceil(wide / 2 + high) + 2);
  const at = (t, z) => [1 + t * wide, 1 + (t * wide) / 2 + (1 - z) * high];
  fill(pic, [at(0, 1), at(1, 1), at(1, 0), at(0, 0)], shade(colour, 1));
  line(pic, at(0, 1), at(1, 1), shade(colour, 1.4));
  if (light) fill(pic, [at(0.2, 0.75), at(0.8, 0.75), at(0.8, 0.3), at(0.2, 0.3)], light);
  return pic;
}

// ---- The first pack's three sheets ----------------------------------------------------------------------------------

function levelSheet() {
  const sheet = picture(1024, 1024);
  const into = (cx, cy, draw) => draw((points, colour) => fill(sheet, points.map(([x, y]) => [cx * 128 + x, cy * 128 + y]), colour), (a, b, colour, wide) => line(sheet, [cx * 128 + a[0], cy * 128 + a[1]], [cx * 128 + b[0], cy * 128 + b[1]], colour, wide));
  for (const [base, floor, wall] of [[0, "#3c4a4c", "#4a5a5e"], [4, "#a9b4b3", "#c2ccca"]]) {
    // Floors: the top face of a tile, and the thickness under its two near edges.
    for (let i = 0; i < 8; i += 1) {
      into(i, base, (poly, stroke) => {
        const tone = 0.82 + (i % 4) * 0.08;
        poly([[0, 88], [64, 120], [64, 128], [0, 96]], shade(floor, 0.5));
        poly([[64, 120], [128, 88], [128, 96], [64, 128]], shade(floor, 0.38));
        poly([[64, 56], [128, 88], [64, 120], [0, 88]], shade(floor, tone));
        stroke([64, 56], [128, 88], shade(floor, tone * 1.25));
        stroke([64, 56], [0, 88], shade(floor, tone * 1.25));
        // A grille or a mesh has a darker middle.
        if (i === 1 || i === 6 || i === 7 || (base === 4 && (i === 2 || i === 3))) poly([[64, 68], [104, 88], [64, 108], [24, 88]], shade(floor, tone * 0.62));
      });
    }
    // Walls: a slab whose face looks down and to the right (cells 0 to 2), and one whose face looks down and to the
    // left (cells 5 to 7), each 88 pixels high and an eighth of a tile thick.
    for (let i = 0; i < 3; i += 1) {
      const tone = 0.9 + i * 0.07;
      into(i, base + 1, (poly, stroke) => {
        poly([[40, 124], [104, 92], [104, 4], [40, 36]], shade(wall, tone * 0.72));
        poly([[40, 36], [104, 4], [96, 0], [32, 32]], shade(wall, 0.42));
        stroke([40, 80], [104, 48], shade(wall, tone * 0.5), 2);
        stroke([40 + 21 * (i + 1) * 0.6, 124 - 10.5 * (i + 1) * 0.6], [40 + 21 * (i + 1) * 0.6, 36 - 10.5 * (i + 1) * 0.6], shade(wall, tone * 0.55));
      });
      into(5 + i, base + 1, (poly, stroke) => {
        poly([[24, 92], [88, 124], [88, 36], [24, 4]], shade(wall, tone));
        poly([[24, 4], [88, 36], [96, 32], [32, 0]], shade(wall, 0.42));
        stroke([24, 48], [88, 80], shade(wall, tone * 0.7), 2);
        stroke([24 + 21 * (i + 1) * 0.6, 92 + 10.5 * (i + 1) * 0.6], [24 + 21 * (i + 1) * 0.6, 4 + 10.5 * (i + 1) * 0.6], shade(wall, tone * 0.75));
      });
    }
    // The low wall: two arms from a far corner at (128, 86) of its two cells, each a tile long with a post half way.
    into(0, base + 2, (poly) => {
      const low = 20;
      poly([[128, 86], [64, 118], [64, 118 - low], [128, 86 - low]], shade(wall, 0.95));
      poly([[128, 86], [192, 118], [192, 118 - low], [128, 86 - low]], shade(wall, 0.7));
      poly([[128, 86 - low], [64, 118 - low], [68, 116 - low], [132, 84 - low]], shade(wall, 1.3));
      poly([[128, 86 - low], [192, 118 - low], [188, 116 - low], [124, 84 - low]], shade(wall, 1.3));
      for (const [px, py] of [[96, 102], [160, 102], [128, 86]]) poly([[px - 3, py], [px + 3, py], [px + 3, py - 30], [px - 3, py - 30]], shade(wall, 1.1));
    });
    // Stairs: a flight rising toward the plan's west with its far rail (cell 0), and its near rail (cell 1), which goes
    // over it cell on cell. The middle of the flight's top edge is at (33, 39).
    const [tx, ty] = [33, 39];
    const far = [tx + 20.8, ty - 10.4];
    const near = [tx - 20.8, ty + 10.4];
    const down = [40, 20 + 46.08];
    into(0, base + 3, (poly, stroke) => {
      poly([far, near, [near[0] + down[0], near[1] + down[1]], [far[0] + down[0], far[1] + down[1]]], shade(wall, 0.8));
      for (let step = 1; step < 6; step += 1) stroke([far[0] + (down[0] * step) / 6, far[1] + (down[1] * step) / 6], [near[0] + (down[0] * step) / 6, near[1] + (down[1] * step) / 6], shade(wall, 0.45), 2);
      stroke([far[0], far[1] - 20], [far[0] + down[0], far[1] + down[1] - 20], shade(wall, 1.3), 2);
      stroke(far, [far[0], far[1] - 20], shade(wall, 1.3), 2);
      stroke([far[0] + down[0], far[1] + down[1]], [far[0] + down[0], far[1] + down[1] - 20], shade(wall, 1.3), 2);
    });
    into(1, base + 3, (poly, stroke) => {
      stroke([near[0], near[1] - 20], [near[0] + down[0], near[1] + down[1] - 20], shade(wall, 1.4), 2);
      stroke(near, [near[0], near[1] - 20], shade(wall, 1.4), 2);
      stroke([near[0] + down[0], near[1] + down[1]], [near[0] + down[0], near[1] + down[1] - 20], shade(wall, 1.4), 2);
    });
  }
  return sheet;
}

// The doors: a slab like a wall's with a frame round an opening, sixteen pictures of each: 0 shut with an amber light,
// 1 shut and green, 2 shut and red, 3 to 8 sliding open, 9 open, 10 to 15 sliding shut.
function doorsSheet() {
  const sheet = picture(1024, 1024);
  const rows = [["dark", "left", 0], ["dark", "right", 2], ["light", "right", 4], ["light", "left", 6]];
  for (const [look, way, row] of rows) {
    const frame = look === "dark" ? "#59666c" : "#c5cecd";
    for (let n = 0; n < 16; n += 1) {
      const [ox, oy] = [(n % 8) * 128, (row + Math.floor(n / 8)) * 128];
      // A point of the slab's face: s along its foot, t up it.
      const at = (s, t) => (way === "left" ? [ox + 24 + 64 * s, oy + 92 + 32 * s - 88 * t] : [ox + 40 + 64 * s, oy + 124 - 32 * s - 88 * t]);
      const quad = (s0, s1, t0, t1, colour) => fill(sheet, [at(s0, t1), at(s1, t1), at(s1, t0), at(s0, t0)], colour);
      const open = n <= 2 ? 0 : n <= 8 ? (n - 2) / 7 : n === 9 ? 1 : 1 - (n - 9) / 7;
      quad(0, 0.12, 0, 1, shade(frame, 1));
      quad(0.88, 1, 0, 1, shade(frame, 0.85));
      quad(0, 1, 0.86, 1, shade(frame, 1.1));
      // The two leaves, each sliding into its post.
      const leaf = 0.38 * (1 - open);
      if (leaf > 0.005) {
        quad(0.12, 0.12 + leaf, 0, 0.86, shade(frame, 0.6));
        quad(0.88 - leaf, 0.88, 0, 0.86, shade(frame, 0.52));
        quad(0.12, 0.12 + leaf, 0.1, 0.16, "#b89a2c");
        quad(0.88 - leaf, 0.88, 0.1, 0.16, "#b89a2c");
      }
      quad(0.44, 0.56, 0.9, 0.96, n === 0 ? "#ffb347" : n === 2 ? "#ff4b3a" : "#58e07a");
    }
  }
  return sheet;
}

// The first pack's sixteen pieces of furniture, as the catalogue names them (src/pieces.js), each a box in its cell.
const ASSETS = [
  [0, 0, 0.9, 0.9, 0.5, "#48606a", "#7dffa8"], [1, 0, 0.6, 0.6, 0.7, "#5b5a3a"], [2, 0, 0.7, 0.7, 0.5, "#4c5560"], [3, 0, 0.8, 0.8, 0.75, "#3d464e"],
  [4, 0, 0.9, 0.45, 1.1, "#2c3238"], [5, 0, 0.8, 0.4, 0.75, "#4a545c", "#86dcff"], [6, 0, 0.45, 0.4, 0.6, "#5a6068"], [7, 0, 0.4, 0.4, 1.25, "#30363c", "#86dcff"],
  [0, 1, 0.5, 0.9, 0.5, "#8a9aa0"], [1, 1, 0.4, 0.4, 0.7, "#3b4c61"], [2, 1, 0.9, 0.45, 0.6, "#6a7078"], [3, 1, 0.45, 0.45, 1.0, "#50606a", "#7dffe0"],
  [4, 1, 0.4, 0.4, 1.25, "#b4bcc0"], [5, 1, 0.8, 0.8, 0.75, "#aeb6b8"], [6, 1, 0.45, 0.45, 1.2, "#9aa4a8"], [7, 1, 0.9, 0.42, 0.7, "#4a5660", "#86dcff"],
];
function assetsSheet() {
  const sheet = picture(1024, 1024);
  for (const [cx, cy, a, d, h, colour, lit] of ASSETS) box(sheet, cx * 128 + 64, cy * 128 + 124 - (a + d) * 16, a, d, h, colour, { mark: lit ?? null });
  return sheet;
}

// ---- The second pack: a picture a file ------------------------------------------------------------------------------

const TONES = { seat: "#6f7c8c", bed: "#62788c", table: "#868d95", stand: "#6c747c", opens: "#566472", wall: "#98a4ae", rug: "#4d4658", small: "#a9aeb4" };
// What's drawn in wood or orange in the real pack is drawn so here, so the recolouring to steel can be seen to work.
const WOOD = "#b0703a";

// A piece's picture from what world/furniture.txt says of it.
function fromFacts(facts, side = null) {
  const colour = facts.steel ? WOOD : TONES[facts.what] ?? TONES.stand;
  // The packs' pictures are a little smaller than the squares the game gives them.
  const a = Math.max(0.2, facts.across * 0.5 * 0.8);
  const d = Math.max(0.2, facts.down * 0.8);
  if (facts.what === "wall") return panelPicture(44, 30, colour, facts.lit);
  if (facts.what === "rug") return boxPicture(a, d, 0.02, colour);
  if (facts.what === "small") return boxPicture(0.16, 0.16, Math.max(0.08, facts.high), colour, { mark: facts.lit });
  if (facts.what === "seat" && side) return seatPicture(Math.min(a, 0.4), Math.min(d, 0.4), Math.max(0.5, facts.high), colour, side);
  return boxPicture(a, d, Math.max(0.1, facts.high), colour, { mark: facts.lit });
}

// The pictures the game's own pieces are drawn from (PIECES in public/pixel-art.js), where furniture.txt has no line
// for the file: across, down and high in tiles, or a panel on a wall.
const OWN = [
  [/Chairs\/Chair_4_([A-D])_Tile/, (m) => seatPicture(0.36, 0.36, 0.6, "#4a6a9a", m[1])],
  [/Chairs\/GChair_9_([A-D])/, (m) => seatPicture(0.5, 0.5, 0.85, "#4a3f30", m[1])],
  [/Tables\/Table_Corridor/, () => boxPicture(0.6, 0.25, 0.3, WOOD)],
  [/Tables\/Office_Kitchen_Table/, () => boxPicture(0.66, 0.66, 0.48, TONES.table)],
  [/Metallic_Closet_Base/, () => boxPicture(0.38, 0.38, 1.25, TONES.opens)],
  [/Office\/Rack/, () => boxPicture(0.8, 0.35, 1.3, TONES.opens)],
  [/Computer\/Vertical_Screen/, () => boxPicture(0.3, 0.12, 0.9, "#30363c", { mark: "#86dcff" })],
  [/Kitchen\/Oven/, () => boxPicture(0.6, 0.6, 0.7, "#c8ccce", { mark: "#ff9a50" })],
  [/Kitchen\/Pot_Full/, () => boxPicture(0.3, 0.3, 0.25, "#7a8088")],
  [/Kitchen\/Ketel_7/, () => boxPicture(0.2, 0.2, 0.25, "#8a9096")],
  [/Kitchen\/Kitchen_A_Tile/, () => boxPicture(0.45, 0.6, 0.7, WOOD)],
  [/Kitchen\/Rack/, () => panelPicture(40, 14, "#30343a")],
  [/Plants\/Plant_\d/, () => boxPicture(0.25, 0.25, 0.6, "#54763a")],
  [/Wc_Tap_1/, () => boxPicture(0.4, 0.35, 0.7, WOOD)],
  [/Bedroom\/Bed_G_4/, () => boxPicture(0.7, 1.4, 0.35, WOOD)],
  [/Lamps\/Lamp_Modern/, () => panelPicture(40, 8, "#dfeaff", "#ffffff")],
  [/Lab\/Camera_2/, () => panelPicture(16, 14, "#d0d4d8")],
  [/Lab\/Switch_[ABC]/, () => panelPicture(12, 16, "#b8bec4")],
  [/Lab\/Pipe_Horizontal_Box/, () => panelPicture(64, 18, "#666a64", "#d8b030")],
  [/Lab\/Pipe_Horizontal/, () => panelPicture(64, 8, "#60666c")],
  [/Lab\/Cable_Horizontal_\d/, () => panelPicture(64, 6, "#2e3236")],
  [/Lab\/Screen_Small/, () => panelPicture(16, 14, "#22282c", "#58e07a")],
  [/Lab\/Server_2_A/, () => boxPicture(0.45, 0.4, 1.25, "#3a4248", { mark: "#86dcff" })],
  [/Lab\/Ac_Big_2/, () => boxPicture(0.5, 0.4, 1.35, "#aab2b6")],
  [/Lab\/Tool_Box_A/, () => boxPicture(0.3, 0.2, 0.2, "#a03a30")],
  [/Lab\/Tools_Electric/, () => boxPicture(0.2, 0.15, 0.04, "#2f6a48")],
  [/Lab\/Plastic_Box_2_Full/, () => boxPicture(0.22, 0.18, 0.14, "#4a70a8")],
  [/Office\/White_Box/, () => boxPicture(0.35, 0.35, 0.3, "#d8dcdc")],
  [/Office\/Paper_1/, () => boxPicture(0.18, 0.24, 0.01, "#e8e6da")],
  [/Office\/Picture_Frame/, () => boxPicture(0.14, 0.05, 0.18, "#8a6a40")],
];
// Files that are several pictures side by side (SHEETS in src/pieces.js): how many across and down, and one of them.
const SEVERAL = [
  [/Lab\/Camera_1_Ani/, 4, 4, 64, () => panelPicture(26, 16, "#cfd4d8")],
  [/Lab\/Server_1\.png/, 2, 2, 128, () => boxPicture(0.4, 0.4, 1.2, "#2c3238", { mark: "#86dcff" })],
];

function severalPicture(across, down, size, one) {
  const sheet = picture(across * size, down * size);
  for (let n = 0; n < across * down; n += 1) {
    const part = one();
    const [ox, oy] = [(n % across) * size + Math.floor((size - part.w) / 2), Math.floor(n / across) * size + (size - part.h - 2)];
    for (let y = 0; y < part.h; y += 1) for (let x = 0; x < part.w; x += 1) {
      const from = (y * part.w + x) * 4;
      if (part.data[from + 3]) sheet.data.set(part.data.subarray(from, from + 4), ((oy + y) * sheet.w + ox + x) * 4);
    }
  }
  return sheet;
}

// ---- Making them ----------------------------------------------------------------------------------------------------

const { pieceWay } = await import("../public/pixel-art.js");
const { FURNITURE } = await import("../public/furniture.js");
const { pieceKey } = await import("../src/pieces.js");
const { furnitureFacts, furnitureForPage } = await import("../src/pack-furniture.js");

save("isospace/IsoSpace_Level.png", levelSheet());
save("isospace/IsoSpace_Doors.png", doorsSheet());
save("isospace/IsoSpace_Assets.png", assetsSheet());
fs.writeFileSync(path.join(target, "_about.txt"), "Grey stand-ins for the two pixel-art packs, made by tools/godot-stand-in-pack.mjs for checking the Godot view.\nNothing here is from the packs themselves.\n");

// Every file of the second pack the game's own pieces are drawn from: asked of the game, saying yes to every picture.
const wanted = new Set();
const kinds = [...FURNITURE.map((one) => one.id), "bunk", "cot", "crate", "plan-lamp", "plan-console", "plan-terminal", "plan-counter", "plan-pump", "plan-tank", "plan-scrap", "plan-stove", "part:camera", "part:switch-on", "part:switch-off", "part:switch-dead", "part:vent", "part:box", "part:keypad", "part:turning", "part:alarm", "part:relay", "part:core", "part:air", "part:engines", "thing:case", "thing:box", "thing:tank", "thing:rack", "thing:terminal", "thing:pod", "thing:urn", "thing:paper", "thing:frame", "thing:chip", "thing:small", "run:pipe", "run:cable", "run:tray"];
for (const kind of kinds) for (const facing of ["n", "e", "s", "w"]) for (const look of ["dark", "light"]) for (const seed of [0, 0.3, 0.6, 0.99]) {
  pieceWay(kind, facing, seed, { look, has: (one) => {
    if (one.file) wanted.add(one.file);
    return true;
  } });
  // What's stood on top of another (a pot on its stove) is a picture too.
  const way = pieceWay(kind, facing, seed, { look, has: () => true });
  if (way?.on?.file) wanted.add(way.on.file);
}
const written = new Set();
for (const file of wanted) {
  const several = SEVERAL.find(([of]) => of.test(file));
  const own = OWN.map(([of, make]) => [file.match(of), make]).find(([found]) => found);
  const pic = several ? severalPicture(several[1], several[2], several[3], several[4]) : own ? own[1](own[0]) : boxPicture(0.4, 0.4, 0.4, TONES.stand);
  save(`interiors/${file}`, pic);
  written.add(file);
}

// Every piece world/furniture.txt knows, under a name the catalogue reads back as that piece: its four sides for a
// seat, one picture for anything else. A name the catalogue would take a letter or a word off goes in a folder of its
// own, which is a piece by the folder's name.
let made = 0;
for (const facts of furnitureFacts().values()) {
  const found = facts.id.match(/^interiors\/(.+)\/([^/]+)$/);
  if (!found) continue;
  const [, folder, key] = found;
  const plain = pieceKey(`${key}.png`) === key;
  const files = facts.what === "seat" ? ["A", "B", "C", "D"].map((side) => [`${folder}/${plain ? "" : `${key}/`}${key}_${side}.png`, side]) : [[`${folder}/${plain ? "" : `${key}/`}${key}${plain ? "" : "_1"}.png`, null]];
  // A piece the game's own furniture is drawn from too has its pictures already.
  if ([...written].some((file) => file.startsWith(`${folder}/`) && pieceKey(path.basename(file)) === key)) continue;
  for (const [file, side] of files) {
    if (written.has(file)) continue;
    save(`interiors/${file}`, fromFacts(facts, side));
    written.add(file);
    made += 1;
  }
}

// And whether the game finds a picture for every piece it knows.
const page = furnitureForPage();
const without = page.filter((one) => one.id.startsWith("interiors/") && !one.faces && !one.picture).map((one) => one.id);
console.log(`Stand-in packs made in ${target}: three sheets, ${written.size} pictures (${made} from world/furniture.txt).`);
if (without.length) console.log(`The game finds no picture for ${without.length} of them:\n  ${without.join("\n  ")}`);
