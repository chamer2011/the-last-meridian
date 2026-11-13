// The stand-in pictures for Tiled: plain shaded blocks for walls, floors, doors and scenery, and little markers for
// people, things, ways out and where the player starts. They're only there so a room can be laid out in Tiled; the game
// draws its own. Drawn here with no other program, and saved as PNG files.

import zlib from "node:zlib";

// A tile's picture: 128 wide, with the square of floor at the bottom, 64 high, and room above it for what stands on it.
export const PIECE = { width: 128, height: 160 };
export const FIGURES = {
  person: { width: 48, height: 96 },
  thing: { width: 40, height: 56 },
  exit: { width: 40, height: 64 },
  start: { width: 40, height: 64 },
};

// ---- Drawing ------------------------------------------------------------------------------------------------

const picture = (width, height) => ({ width, height, data: new Float64Array(width * height * 4) });

function inside(points, x, y) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Fills a shape, four by four samples to a pixel so the edges come out smooth.
function fill(pic, points, [r, g, b], alpha = 1) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(pic.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(pic.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    let hits = 0;
    for (let sy = 0; sy < 4; sy += 1) for (let sx = 0; sx < 4; sx += 1) if (inside(points, x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits += 1;
    if (!hits) continue;
    const cover = (hits / 16) * alpha;
    const i = (y * pic.width + x) * 4;
    const under = pic.data[i + 3];
    const out = cover + under * (1 - cover);
    for (const [k, value] of [[0, r], [1, g], [2, b]]) pic.data[i + k] = (value * cover + pic.data[i + k] * under * (1 - cover)) / out;
    pic.data[i + 3] = out;
  }
}

const circle = (cx, cy, rx, ry = rx, sides = 20) => Array.from({ length: sides }, (_, i) => [cx + rx * Math.cos((i / sides) * Math.PI * 2), cy + ry * Math.sin((i / sides) * Math.PI * 2)]);

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, sum]);
}

function png(pic) {
  const rows = Buffer.alloc(pic.height * (pic.width * 4 + 1));
  for (let y = 0; y < pic.height; y += 1) {
    rows[y * (pic.width * 4 + 1)] = 0;
    for (let x = 0; x < pic.width; x += 1) {
      const i = (y * pic.width + x) * 4;
      const o = y * (pic.width * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k += 1) rows[o + k] = Math.round(Math.min(255, Math.max(0, pic.data[i + k])));
      rows[o + 3] = Math.round(Math.min(1, pic.data[i + 3]) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pic.width, 0);
  header.writeUInt32BE(pic.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- Colours ------------------------------------------------------------------------------------------------

const rgb = (hex) => {
  const n = parseInt(String(hex).replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = ([r, g, b], by) => [r * by, g * by, b * by];
const mix = (a, b, by) => a.map((value, i) => value * (1 - by) + b[i] * by);

const COLORS = {
  wall: rgb("#7f8a96"),
  door: rgb("#d9a441"),
  machine: rgb("#4f8f8a"),
  crate: rgb("#8a6a42"),
  plants: rgb("#5f8f3f"),
  post: rgb("#9aa0a6"),
  lamp: rgb("#8a8a80"),
  glow: rgb("#ffd27a"),
  water: rgb("#3f6f9f"),
  rubble: rgb("#7a6a58"),
  ledge: rgb("#8e9aa6"),
  spark: rgb("#f4f4ff"),
  floor: rgb("#56606a"),
};

// ---- A piece ------------------------------------------------------------------------------------------------

const MACHINE = "=[]<>(){}^&";
const SPARKS = "*'.,`;";

// What one of the game's squares is, going by its mark and whether it's floor here, as the isometric view would have it.
export function kindOf(ch, floor) {
  if (ch === " ") return "nothing";
  if (floor) return "floor";
  if (ch === "#") return "wall";
  if (ch === "+") return "door";
  if (ch === "~") return "water";
  if (SPARKS.includes(ch)) return "sparks";
  if (ch === '"') return "plants";
  if (ch === "!") return "lamp";
  if ("|/\\".includes(ch)) return "post";
  if (ch === "%") return "rubble";
  if (MACHINE.includes(ch)) return "machine";
  return "ledge";
}

// What a piece is, in a few words, for its what property in Tiled.
export function pieceWords(piece) {
  const [back, front = back] = [...piece.mark];
  const word = (ch) => {
    const kind = kindOf(ch, piece.floor.includes(ch));
    return kind === "nothing" ? "nothing" : `${kind} (${ch})`;
  };
  if (piece.mark === "[]") return "crate ([])";
  return back === front ? word(back) : `${word(back)} at the back, ${word(front)} at the front`;
}

const at = (wx, wy, z = 0) => [64 + (wx - wy) * 64, 96 + (wx + wy) * 32 - z * 64];

// A box on the floor, from x to x + w across the tile and y to y + d down it, h high.
function box(pic, x, y, w, d, h, color, z = 0) {
  fill(pic, [at(x, y + d, z), at(x + w, y + d, z), at(x + w, y + d, z + h), at(x, y + d, z + h)], shade(color, 0.7));
  fill(pic, [at(x + w, y, z), at(x + w, y + d, z), at(x + w, y + d, z + h), at(x + w, y, z + h)], shade(color, 0.86));
  fill(pic, [at(x, y, z + h), at(x + w, y, z + h), at(x + w, y + d, z + h), at(x, y + d, z + h)], shade(color, 1.12));
}

function flat(pic, x, w, color, z = 0) {
  fill(pic, [at(x, 0, z), at(x + w, 0, z), at(x + w, 1, z), at(x, 1, z)], shade(color, 0.82));
  fill(pic, [at(x + 0.03, 0.03, z), at(x + w - 0.03, 0.03, z), at(x + w - 0.03, 0.97, z), at(x + 0.03, 0.97, z)], color);
}

function half(pic, ch, isFloor, x, floorColors) {
  const kind = kindOf(ch, isFloor);
  const floorColor = floorColors[ch] ?? COLORS.floor;
  if (kind === "nothing") return;
  if (kind === "floor") return flat(pic, x, 0.5, floorColor);
  if (kind === "wall") return box(pic, x, 0, 0.5, 1, 1, COLORS.wall);
  if (kind === "door") {
    flat(pic, x, 0.5, mix(COLORS.floor, COLORS.door, 0.35));
    box(pic, x + 0.05, 0.05, 0.4, 0.9, 0.1, COLORS.door);
    return;
  }
  if (kind === "water") {
    flat(pic, x, 0.5, COLORS.water);
    for (const y of [0.3, 0.65]) fill(pic, [at(x + 0.08, y), at(x + 0.42, y), at(x + 0.42, y + 0.05), at(x + 0.08, y + 0.05)], mix(COLORS.water, [255, 255, 255], 0.35));
    return;
  }
  if (kind === "sparks") {
    for (const [dx, dy, z] of [[0.15, 0.25, 0.5], [0.35, 0.6, 0.25], [0.2, 0.8, 0.7]]) fill(pic, circle(...at(x + dx, dy, z), 2.2), COLORS.spark);
    return;
  }
  if (kind === "plants") {
    box(pic, x + 0.04, 0.04, 0.42, 0.92, 0.3, COLORS.plants);
    for (const [dx, dy] of [[0.15, 0.3], [0.3, 0.55], [0.18, 0.78]]) fill(pic, circle(...at(x + dx, dy, 0.32), 4, 2.5), mix(COLORS.plants, [255, 255, 200], 0.3));
    return;
  }
  if (kind === "lamp") {
    flat(pic, x, 0.5, floorColor);
    box(pic, x + 0.19, 0.44, 0.12, 0.12, 0.75, COLORS.lamp);
    box(pic, x + 0.15, 0.4, 0.2, 0.2, 0.12, COLORS.glow, 0.75);
    return;
  }
  if (kind === "post") return box(pic, x + 0.17, 0.42, 0.16, 0.16, 1.05, COLORS.post);
  if (kind === "rubble") {
    box(pic, x + 0.04, 0.08, 0.42, 0.84, 0.3, COLORS.rubble);
    box(pic, x + 0.12, 0.3, 0.26, 0.4, 0.22, shade(COLORS.rubble, 1.1), 0.3);
    return;
  }
  if (kind === "machine") {
    const h = "[]".includes(ch) ? 0.62 : 0.46;
    box(pic, x + 0.02, 0.06, 0.46, 0.88, h, COLORS.machine);
    fill(pic, [at(x + 0.1, 0.2, h), at(x + 0.4, 0.2, h), at(x + 0.4, 0.3, h), at(x + 0.1, 0.3, h)], mix(COLORS.machine, [160, 255, 220], 0.5));
    return;
  }
  box(pic, x + 0.02, 0.04, 0.46, 0.92, 0.46, COLORS.ledge);
}

// A piece's picture: { mark, floor }, with the floor colours by mark.
export function pieceImage(piece, floorColors = {}) {
  const pic = picture(PIECE.width, PIECE.height);
  const [back, front = back] = [...piece.mark];
  if (piece.mark === "[]") {
    box(pic, 0.08, 0.08, 0.84, 0.84, 0.62, COLORS.crate);
    fill(pic, [at(0.08, 0.5, 0.62), at(0.92, 0.5, 0.62), at(0.92, 0.54, 0.62), at(0.08, 0.54, 0.62)], shade(COLORS.crate, 0.8));
  } else {
    half(pic, back, piece.floor.includes(back), 0, floorColors);
    half(pic, front, piece.floor.includes(front), 0.5, floorColors);
  }
  return png(pic);
}

// The markers for what stands in a room, each with its feet at the middle of its bottom edge.
export function figureImage(kind) {
  const { width, height } = FIGURES[kind];
  const pic = picture(width, height);
  const cx = width / 2;
  fill(pic, circle(cx, height - 4, width * 0.32, 4), [0, 0, 0], 0.35);
  if (kind === "person") {
    fill(pic, [[cx - 9, 62], [cx - 2, 62], [cx - 3, height - 4], [cx - 9, height - 4]], [40, 44, 48]);
    fill(pic, [[cx + 2, 62], [cx + 9, 62], [cx + 9, height - 4], [cx + 3, height - 4]], [40, 44, 48]);
    fill(pic, [[cx - 12, 30], [cx + 12, 30], [cx + 13, 66], [cx - 13, 66]], [95, 208, 138]);
    fill(pic, [[cx - 12, 30], [cx + 12, 30], [cx + 10, 36], [cx - 10, 36]], [70, 170, 110]);
    fill(pic, circle(cx, 19, 9), [216, 176, 144]);
    fill(pic, [...circle(cx, 16, 9.5, 6).slice(10), [cx + 9.5, 16]], [42, 36, 32]);
  } else if (kind === "thing") {
    fill(pic, [[cx - 1.5, 30], [cx + 1.5, 30], [cx + 1.5, height - 5], [cx - 1.5, height - 5]], [120, 100, 40]);
    fill(pic, [[cx, 4], [cx + 15, 18], [cx, 32], [cx - 15, 18]], [150, 115, 30]);
    fill(pic, [[cx, 7], [cx + 12, 18], [cx, 29], [cx - 12, 18]], [255, 204, 77]);
    fill(pic, [[cx - 2, 11], [cx + 2, 11], [cx + 1.5, 20], [cx - 1.5, 20]], [120, 90, 20]);
    fill(pic, circle(cx, 24, 2), [120, 90, 20]);
  } else if (kind === "exit") {
    fill(pic, [[cx - 5, 26], [cx + 5, 26], [cx + 5, height - 6], [cx - 5, height - 6]], [79, 208, 208]);
    fill(pic, [[cx, 4], [cx + 16, 28], [cx - 16, 28]], [79, 208, 208]);
    fill(pic, [[cx, 10], [cx + 9, 24], [cx - 9, 24]], [180, 245, 245]);
  } else {
    fill(pic, [[cx - 2, 6], [cx + 1, 6], [cx + 1, height - 5], [cx - 2, height - 5]], [230, 230, 235]);
    fill(pic, [[cx + 1, 6], [cx + 18, 14], [cx + 1, 22]], [120, 190, 255]);
  }
  return png(pic);
}
