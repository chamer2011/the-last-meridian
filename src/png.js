// Reads a PNG's pixels far enough to say where the picture is in its frame: which pixels are solid. The catalogue of
// pieces (src/pieces.js) measures a piece of furniture's picture with it, to guess how much floor the piece takes.
// It reads the pictures the packs have: eight bits a channel with their own see-through channel, and pictures with a
// palette of up to 256 colours. Anything else (sixteen bits a channel, interlaced) it leaves alone, and says nothing
// is known.

import fs from "node:fs";
import zlib from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// How see-through each pixel is, a number from 0 (nothing there) to 255 (solid) for each, row by row; null for a file
// that isn't a PNG this can read.
export function alphaOf(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let width = 0;
  let height = 0;
  let depth = 8;
  let type = 6;
  let clear = null;
  const data = [];
  for (let pos = 8; pos + 12 <= buf.length;) {
    const length = buf.readUInt32BE(pos);
    const name = buf.toString("ascii", pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      if (body[12]) return null;
    } else if (name === "IDAT") data.push(body);
    else if (name === "tRNS") clear = body;
    pos += 12 + length;
  }
  const channels = CHANNELS[type];
  if (!channels || !width || !height || depth === 16 || (type !== 3 && depth !== 8)) return null;
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(data));
  } catch {
    return null;
  }
  const step = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < height * (stride + 1)) return null;
  const alpha = new Uint8Array(width * height);
  let above = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= step ? row[i - step] : 0;
      const up = above[i];
      const corner = i >= step ? above[i - step] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const guess = left + up - corner;
        const toLeft = Math.abs(guess - left);
        const toUp = Math.abs(guess - up);
        const toCorner = Math.abs(guess - corner);
        value += toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner;
      }
      row[i] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      let a = 255;
      if (type === 6) a = row[x * 4 + 3];
      else if (type === 4) a = row[x * 2 + 1];
      else if (type === 3) {
        const bit = x * depth;
        const index = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        a = clear && index < clear.length ? clear[index] : 255;
      }
      alpha[y * width + x] = a;
    }
    above = row;
  }
  return { width, height, alpha };
}

// Where the solid part of a picture is, in the whole file or in one square of it ({ x, y, w, h }): the box it fills
// (x0, y0 to x1, y1, counted from the square's corner), and how far across the box its lowest point is (front, from 0
// at the left to 1 at the right), which says how a thing drawn from a corner divides between its two sides. The
// packs' soft shadows are half see-through and don't count. Null when there's nothing solid, or the file can't be read.
const known = new Map();
export function solidBoxOf(file, square = null) {
  let stamp = 0;
  try {
    stamp = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const key = `${file}|${stamp}|${square ? `${square.x},${square.y},${square.w},${square.h}` : ""}`;
  if (known.has(key)) return known.get(key);
  const picture = alphaOf(file);
  let box = null;
  if (picture) {
    const from = square ?? { x: 0, y: 0, w: picture.width, h: picture.height };
    const found = { x0: from.w, y0: from.h, x1: -1, y1: -1 };
    for (let y = 0; y < from.h && from.y + y < picture.height; y += 1) {
      for (let x = 0; x < from.w && from.x + x < picture.width; x += 1) {
        if (picture.alpha[(from.y + y) * picture.width + from.x + x] < 250) continue;
        if (x < found.x0) found.x0 = x;
        if (x > found.x1) found.x1 = x;
        if (y < found.y0) found.y0 = y;
        if (y > found.y1) found.y1 = y;
      }
    }
    if (found.x1 >= 0) {
      // The lowest two rows of it: the middle of what's solid there.
      let sum = 0;
      let count = 0;
      for (let y = Math.max(found.y0, found.y1 - 1); y <= found.y1; y += 1) {
        for (let x = found.x0; x <= found.x1; x += 1) {
          if (picture.alpha[(from.y + y) * picture.width + from.x + x] < 250) continue;
          sum += x;
          count += 1;
        }
      }
      const wide = found.x1 - found.x0;
      box = { ...found, w: from.w, h: from.h, front: wide > 0 && count ? (sum / count - found.x0) / wide : 0.5 };
    }
  }
  known.set(key, box);
  return box;
}
