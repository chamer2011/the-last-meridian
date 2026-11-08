// Rooms drawn in Tiled (https://www.mapeditor.org), the free map editor.
//
// A place's rooms can be Tiled maps: world/maps/<place>/<room>.tmj, or .tmx, the kind Tiled saves unless it's told
// otherwise, named after the room's id. Each one is that room, in place of anything world/maps/<place>.json says about
// it. Tiled draws a room isometric, the way the game does, and one of its tiles is a square of floor the size the game
// draws, which is two of the game's squares side by side: those started as letters on a screen, so they're half as wide
// as they are deep. A tile says what it puts on the room's plan with its mark property, one character for a tile that's
// the same all over, such as a wall, or two for one with something on its back half and something else on its front
// half, such as a thin wall. Its floor property says which of those characters are floor. People, things, ways out and
// where the player starts are objects, and they stand on whichever half of a tile they're on. Words are text objects.
//
// This turns a Tiled room into the same shape as a room in the JSON files, so the rest of the game doesn't know where a
// room came from, and a room the other way, for tools/to-tiled.mjs and the tests. Reading a room changes nothing.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const TILE_WIDTH = 128;
const TILE_HEIGHT = 64;
// The biggest map the game draws, in the game's squares: a whole deck, which the view scrolls across. In Tiled that's
// 100 tiles across and 60 down.
const MOST_ACROSS = 200;
const MOST_DOWN = 60;
const ROOM_FILE = /\.(tmj|tmx|json)$/i;
const START = "@";
const VOID = " ";
const FLIPS = 0x0fffffff;
const MARKS = { person: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", thing: "abcdefghijklmnopqrstuvwxyz", exit: "1234567890" };
const ROLES = { person: "person", people: "person", thing: "thing", things: "thing", exit: "exit", "way out": "exit", start: "start", label: "label", writing: "writing", words: "writing", room: "area", area: "area" };
// What a property holds, where it isn't a line of words: one per line, or written out as JSON.
const LISTS = new Set(["asks", "asksOther", "aliases"]);
const OBJECTS = new Set(["closed", "holds"]);
const COLORS = ["floor", "walls", "scenery", "writing"];
// A tile's own properties, which an object made from it shouldn't take as its own.
const TILE_ONLY = ["mark", "floor", "what"];
// The parts of a room that a Tiled file draws. Anything else about the room can still come from the place's JSON file.
export const DRAWN = ["plan", "floor", "people", "things", "exits", "writing", "labels", "areas", "starts"];
// A room's id from its name, when it doesn't say one: the_long_mess.
export const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// ---- Tiled's XML files, .tmx and .tsx -------------------------------------------------------------------------

// Enough XML for the files Tiled writes: elements, their attributes, and the words inside them.
function parseXml(text) {
  const root = { name: "", attrs: {}, children: [], text: "" };
  const stack = [root];
  const words = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const key = e.toLowerCase();
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[key];
    return named ?? String.fromCodePoint(key.startsWith("#x") ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10));
  });
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      stack.at(-1).text += words(text.slice(i));
      break;
    }
    if (lt > i) stack.at(-1).text += words(text.slice(i, lt));
    const skip = (open, close) => {
      if (!text.startsWith(open, lt)) return false;
      const end = text.indexOf(close, lt + open.length);
      if (open === "<![CDATA[") stack.at(-1).text += text.slice(lt + open.length, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + close.length;
      return true;
    };
    if (skip("<!--", "-->") || skip("<![CDATA[", "]]>") || skip("<?", "?>") || skip("<!", ">")) continue;
    const gt = tagEnd(text, lt);
    const inner = text.slice(lt + 1, gt);
    i = gt + 1;
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      const at = stack.map((node) => node.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      continue;
    }
    const closed = inner.endsWith("/");
    const body = closed ? inner.slice(0, -1) : inner;
    const name = body.match(/^\s*([^\s/>]+)/);
    if (!name) throw new Error("there's an element with no name");
    const node = { name: name[1], attrs: {}, children: [], text: "" };
    for (const m of body.slice(name[0].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[m[1]] = words(m[2] ?? m[3]);
    stack.at(-1).children.push(node);
    if (!closed) stack.push(node);
  }
  const top = root.children[0];
  if (!top) throw new Error("there's nothing in it");
  return top;
}

function tagEnd(text, from) {
  let quote = null;
  for (let i = from + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  throw new Error("an element never ends");
}

const kids = (node, name) => node?.children.filter((child) => child.name === name) ?? [];
const kid = (node, name) => kids(node, name)[0] ?? null;
const num = (value, fallback = 0) => (value === undefined || value === null || value === "" ? fallback : Number(value));

// ---- Properties -----------------------------------------------------------------------------------------------

// Tiled keeps a colour as #aarrggbb, and the game as #rrggbb.
const colorOf = (value) => {
  const text = String(value ?? "");
  return /^#[0-9a-f]{8}$/i.test(text) ? `#${text.slice(3)}` : text;
};

function valueOf(type, value) {
  if (type === "int" || type === "float") return Number(value);
  if (type === "bool") return value === true || value === "true";
  if (type === "color") return colorOf(value);
  if (type === "class") return value && typeof value === "object" ? value : {};
  return value === undefined || value === null ? "" : typeof value === "string" ? value : String(value);
}

function jsonProps(list) {
  if (!list) return {};
  // Tiled before 1.2 kept them as one object of names and values.
  if (!Array.isArray(list)) return { ...list };
  return Object.fromEntries(list.filter((one) => one?.name).map((one) => [one.name, valueOf(one.type ?? "string", one.value)]));
}

function xmlProps(node) {
  const props = {};
  for (const one of kids(kid(node, "properties"), "property")) {
    const type = one.attrs.type ?? "string";
    props[one.attrs.name] = type === "class" ? xmlProps(one) : valueOf(type, one.attrs.value ?? one.text);
  }
  return props;
}

// ---- Reading a map and its tilesets into one shape, whichever kind of file they are ----------------------------

function decodeTiles(text, encoding, compression) {
  if (!encoding || encoding === "csv") return String(text).split(",").map((one) => one.trim()).filter(Boolean).map(Number);
  if (encoding !== "base64") throw new Error(`its tiles are written as ${encoding}, which the game can't read: save it with the tile layer format set to CSV`);
  let bytes = Buffer.from(String(text).trim(), "base64");
  if (compression === "zlib") bytes = zlib.inflateSync(bytes);
  else if (compression === "gzip") bytes = zlib.gunzipSync(bytes);
  else if (compression === "zstd" && zlib.zstdDecompressSync) bytes = zlib.zstdDecompressSync(bytes);
  else if (compression) throw new Error(`its tiles are packed with ${compression}, which the game can't read: set the tile layer format to CSV, under Map > Map Properties`);
  const gids = [];
  for (let i = 0; i + 3 < bytes.length; i += 4) gids.push(bytes.readUInt32LE(i));
  return gids;
}

function jsonLayers(list, inherited = true) {
  return (list ?? []).flatMap((layer) => {
    const visible = inherited && layer.visible !== false;
    if (layer.type === "group") return jsonLayers(layer.layers, visible);
    if (layer.type === "tilelayer") {
      const decode = (data) => (Array.isArray(data) ? data : decodeTiles(data, layer.encoding, layer.compression));
      const chunks = layer.chunks
        ? layer.chunks.map((chunk) => ({ x: chunk.x, y: chunk.y, width: chunk.width, height: chunk.height, data: decode(chunk.data) }))
        : [{ x: 0, y: 0, width: layer.width, height: layer.height, data: decode(layer.data ?? []) }];
      return [{ kind: "tiles", name: layer.name ?? "", visible, chunks }];
    }
    if (layer.type === "objectgroup") {
      const objects = (layer.objects ?? []).map((one) => ({
        id: one.id,
        name: one.name ?? "",
        cls: one.type ?? one.class ?? "",
        x: num(one.x),
        y: num(one.y),
        width: num(one.width),
        height: num(one.height),
        gid: one.gid ? one.gid & FLIPS : 0,
        point: Boolean(one.point),
        text: one.text ? String(one.text.text ?? "") : null,
        visible: one.visible !== false,
        props: jsonProps(one.properties),
      }));
      return [{ kind: "objects", name: layer.name ?? "", visible, objects }];
    }
    return [];
  });
}

function xmlLayers(node, inherited = true) {
  return node.children.flatMap((layer) => {
    const visible = inherited && layer.attrs.visible !== "0";
    if (layer.name === "group") return xmlLayers(layer, visible);
    if (layer.name === "layer") {
      const data = kid(layer, "data");
      const { encoding, compression } = data?.attrs ?? {};
      const read = (holder) => (kids(holder, "tile").length && !encoding ? kids(holder, "tile").map((tile) => num(tile.attrs.gid)) : decodeTiles(holder.text, encoding, compression));
      const chunks = kids(data, "chunk").length
        ? kids(data, "chunk").map((chunk) => ({ x: num(chunk.attrs.x), y: num(chunk.attrs.y), width: num(chunk.attrs.width), height: num(chunk.attrs.height), data: read(chunk) }))
        : [{ x: 0, y: 0, width: num(layer.attrs.width), height: num(layer.attrs.height), data: data ? read(data) : [] }];
      return [{ kind: "tiles", name: layer.attrs.name ?? "", visible, chunks }];
    }
    if (layer.name === "objectgroup") {
      const objects = kids(layer, "object").map((one) => ({
        id: num(one.attrs.id),
        name: one.attrs.name ?? "",
        cls: one.attrs.type ?? one.attrs.class ?? "",
        x: num(one.attrs.x),
        y: num(one.attrs.y),
        width: num(one.attrs.width),
        height: num(one.attrs.height),
        gid: one.attrs.gid ? num(one.attrs.gid) & FLIPS : 0,
        point: Boolean(kid(one, "point")),
        text: kid(one, "text") ? kid(one, "text").text : null,
        visible: one.attrs.visible !== "0",
        props: xmlProps(one),
      }));
      return [{ kind: "objects", name: layer.attrs.name ?? "", visible, objects }];
    }
    return [];
  });
}

// A tileset, from its own file or written into the map. Each tile has its class and its properties.
function jsonTileset(data) {
  const tiles = new Map();
  for (const tile of data.tiles ?? []) tiles.set(num(tile.id), { cls: tile.type ?? tile.class ?? "", props: jsonProps(tile.properties), image: tile.image ?? "" });
  return { name: data.name ?? "", tiles, alignment: data.objectalignment ?? "unspecified" };
}

function xmlTileset(node) {
  const tiles = new Map();
  for (const tile of kids(node, "tile")) tiles.set(num(tile.attrs.id), { cls: tile.attrs.type ?? tile.attrs.class ?? "", props: xmlProps(tile), image: kid(tile, "image")?.attrs.source ?? "" });
  return { name: node.attrs.name ?? "", tiles, alignment: node.attrs.objectalignment ?? "unspecified" };
}

// Reads a tileset file, .tsj or .tsx, keeping it for as long as the file stays the same.
const tilesetsRead = new Map();
function readTileset(file) {
  const { mtimeMs, size } = fs.statSync(file);
  const known = tilesetsRead.get(file);
  if (known && known.mtimeMs === mtimeMs && known.size === size) return known.tileset;
  const text = fs.readFileSync(file, "utf8");
  const tileset = /^\s*</.test(text) ? xmlTileset(parseXml(text)) : jsonTileset(JSON.parse(text));
  tilesetsRead.set(file, { mtimeMs, size, tileset });
  return tileset;
}

// A map file, .tmj, .json or .tmx, in one shape: its size, how it's drawn, its properties, its layers and its tilesets.
// The tilesets are read from their own files, which are listed in uses, so a change to one is noticed too.
export function readMapFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const folder = path.dirname(file);
  const uses = [];
  const external = (source) => {
    const full = path.resolve(folder, source);
    uses.push(full);
    return readTileset(full);
  };
  if (/^\s*</.test(text)) {
    const node = parseXml(text);
    if (node.name !== "map") throw new Error("it isn't a Tiled map");
    return {
      orientation: node.attrs.orientation ?? "orthogonal",
      width: num(node.attrs.width),
      height: num(node.attrs.height),
      tilewidth: num(node.attrs.tilewidth, TILE_WIDTH),
      tileheight: num(node.attrs.tileheight, TILE_HEIGHT),
      infinite: node.attrs.infinite === "1",
      properties: xmlProps(node),
      tilesets: kids(node, "tileset").map((one) => ({ firstgid: num(one.attrs.firstgid, 1), ...(one.attrs.source ? external(one.attrs.source) : xmlTileset(one)) })),
      layers: xmlLayers(node),
      uses,
    };
  }
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || !Array.isArray(data.layers) || !data.orientation) throw new Error("it isn't a Tiled map");
  return {
    orientation: data.orientation,
    width: num(data.width),
    height: num(data.height),
    tilewidth: num(data.tilewidth, TILE_WIDTH),
    tileheight: num(data.tileheight, TILE_HEIGHT),
    infinite: Boolean(data.infinite),
    properties: jsonProps(data.properties),
    tilesets: (data.tilesets ?? []).map((one) => ({ firstgid: num(one.firstgid, 1), ...(one.source ? external(one.source) : jsonTileset(one)) })),
    layers: jsonLayers(data.layers),
    uses,
  };
}

// ---- A map into a room ----------------------------------------------------------------------------------------

const lines = (value) => String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const words = (value) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

// What an object's properties say, as the room in a JSON file would have them: a list one to a line, JSON written
// out, and nothing left empty.
function fieldsOf(props, skip) {
  const fields = {};
  for (const [name, value] of Object.entries(props)) {
    if (skip.has(name) || value === "" || value === null || value === undefined) continue;
    if (LISTS.has(name)) {
      const list = Array.isArray(value) ? value : lines(value);
      if (list.length) fields[name] = list;
    } else if (OBJECTS.has(name) && typeof value === "string") {
      fields[name] = JSON.parse(value);
    } else fields[name] = value;
  }
  return fields;
}

function roleOf(object, tile, props) {
  const named = ROLES[String(object.cls || tile?.cls || "").trim().toLowerCase()];
  if (named) return named;
  if (object.text !== null) return "label";
  if (props.person) return "person";
  if (props.to) return "exit";
  if (/^start$/i.test(object.name.trim())) return "start";
  return "thing";
}

const ROLE_WORDS = { person: "a person", thing: "a thing", exit: "a way out", start: "where you start" };
const described = (role, object) => (object.name ? `${ROLE_WORDS[role] ?? "something"} called ${object.name}` : ROLE_WORDS[role] ?? "something");

// Turns a map, as readMapFile gives it, into a room: { level, problems }. A problem leaves the room as near to what's
// drawn as it can be. personId turns whatever's in a person's person property into their id.
export function roomFromMap(map, { personId = (text) => text, rooms = null } = {}) {
  const problems = [];
  const say = (message) => problems.push(message);
  if (!["isometric", "orthogonal"].includes(map.orientation)) say(`it's drawn ${map.orientation}, and a room has to be isometric: change it under Map > Map Properties`);
  const across = map.tilewidth || TILE_WIDTH;
  const down = map.tileheight || TILE_HEIGHT;
  // Where an object is, in tiles. Tiled measures everything in an isometric map by the tile's height, both ways.
  const inTiles = (x, y) => (map.orientation === "orthogonal" ? [x / across, y / down] : [x / down, y / down]);
  const sets = [...map.tilesets].sort((a, b) => a.firstgid - b.firstgid);
  const tileOf = (gid) => {
    const set = sets.filter((one) => one.firstgid <= gid).at(-1);
    return set ? { set, id: gid - set.firstgid, tile: set.tiles.get(gid - set.firstgid) ?? null } : null;
  };
  // A tile object's position is the middle of its picture's bottom edge, in an isometric map, unless its tileset says
  // otherwise. In a flat map it's the bottom left corner. This is how far its feet are from that.
  const feet = (object, alignment = "unspecified") => {
    if (map.orientation !== "orthogonal" && alignment === "unspecified") return [0, 0];
    const [w, h] = [object.width, object.height];
    const side = /left/.test(alignment) || alignment === "unspecified" ? w / 2 : /right/.test(alignment) ? -w / 2 : 0;
    const up = /^top/.test(alignment) ? h : alignment === "left" || alignment === "right" || alignment === "center" ? h / 2 : 0;
    return map.orientation === "orthogonal" ? [side, up] : [0, 0];
  };
  const tileLayers = map.layers.filter((layer) => layer.kind === "tiles" && layer.visible);
  const objects = map.layers.filter((layer) => layer.kind === "objects" && layer.visible).flatMap((layer) => layer.objects.filter((one) => one.visible));

  // The room's size: the whole map, or for an endless map, from wherever anything's drawn to wherever it stops.
  let [left, top, width, height] = [0, 0, map.width, map.height];
  if (map.infinite) {
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const layer of tileLayers) for (const chunk of layer.chunks) chunk.data.forEach((gid, i) => {
      if (!(gid & FLIPS)) return;
      const x = chunk.x + (i % chunk.width);
      const y = chunk.y + Math.floor(i / chunk.width);
      Object.assign(box, { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) });
    });
    if (box.left === Infinity) {
      say("there's nothing drawn in it");
      Object.assign(box, { left: 0, top: 0, right: 0, bottom: 0 });
    }
    [left, top, width, height] = [box.left, box.top, box.right - box.left + 1, box.bottom - box.top + 1];
  }

  // The tile on each square is the one on the highest layer that has one there.
  const shown = Array.from({ length: height }, () => Array(width).fill(0));
  for (const layer of tileLayers) for (const chunk of layer.chunks) chunk.data.forEach((raw, i) => {
    const gid = raw & FLIPS;
    const x = chunk.x + (i % chunk.width) - left;
    const y = chunk.y + Math.floor(i / chunk.width) - top;
    if (gid && x >= 0 && y >= 0 && x < width && y < height) shown[y][x] = gid;
  });
  const floors = [...words(map.properties.floor)];
  const notFloor = new Set();
  const unmarked = new Map();
  const plan = shown.map((row) => row.flatMap((gid) => {
    if (!gid) return [VOID, VOID];
    const found = tileOf(gid);
    const mark = [...words(found?.tile?.props.mark)];
    if (!found || mark.length < 1 || mark.length > 2) {
      const which = found ? `tile ${found.id} of the ${found.set.name || "unnamed"} tileset` : `a tile that isn't in any tileset (${gid})`;
      unmarked.set(which, (unmarked.get(which) ?? 0) + 1);
      return ["#", "#"];
    }
    const pair = [mark[0], mark[1] ?? mark[0]];
    const floor = words(found.tile.props.floor);
    for (const ch of pair) {
      if (ch === VOID) continue;
      if (!floor.includes(ch)) notFloor.add(ch);
      else if (!floors.includes(ch)) floors.push(ch);
    }
    return pair;
  }));
  for (const [which, count] of unmarked) say(`${which} doesn't say what it is in the room, so the game takes it for a wall (${count} square${count === 1 ? "" : "s"}): give it a mark property`);
  // One mark is either floor or not, all over a room, since the plan only has the mark.
  const both = floors.filter((ch) => notFloor.has(ch));
  if (both.length) say(`the mark${both.length === 1 ? "" : "s"} ${both.join(" ")} ${both.length === 1 ? "is" : "are"} floor on some tiles and not on others, and the game takes ${both.length === 1 ? "it" : "them"} for floor all over the room`);

  // People, things, ways out and where the player starts, each on one of the game's squares. A map that's a whole
  // deck has its rooms drawn on it as rectangles with the class Room, each with a name and an id, and can have a
  // place to start in each of them.
  const labels = [];
  const writing = [];
  const placed = [];
  const starts = [];
  const areas = [];
  const taken = new Map();
  for (const object of objects) {
    const found = object.gid ? tileOf(object.gid) : null;
    const props = { ...(found?.tile?.props ?? {}), ...object.props };
    const role = roleOf(object, found?.tile, props);
    if (role === "area") {
      const name = object.name.trim() || words(props.name).trim();
      if (!name) {
        say("a room drawn on the map has no name, so it's left out: give it one");
        continue;
      }
      const [ax, ay] = inTiles(object.x, object.y);
      const [aw, ah] = map.orientation === "orthogonal" ? [object.width / across, object.height / down] : [object.width / down, object.height / down];
      const x0 = Math.max(0, Math.round((ax - left) * 2));
      const y0 = Math.max(0, Math.round(ay - top));
      const x1 = Math.min(width * 2, Math.round((ax - left + aw) * 2));
      const y1 = Math.min(height, Math.round(ay - top + ah));
      if (x1 - x0 < 1 || y1 - y0 < 1) {
        say(`the room ${name} drawn on the map is outside it or has no size, so it's left out`);
        continue;
      }
      const id = words(props.id).trim() || slugOf(name);
      if (!/^[a-z0-9_]+$/.test(id)) {
        say(`the room ${name} has an id the game can't use, ${id}: small letters, numbers and _ only`);
        continue;
      }
      if (areas.some((one) => one.id === id)) {
        say(`two rooms drawn on the map have the id ${id}, so the second is left out`);
        continue;
      }
      areas.push({ id, name, x: x0, y: y0, w: x1 - x0, h: y1 - y0, ...fieldsOf(props, new Set(["id", "name", ...TILE_ONLY])) });
      continue;
    }
    // A shape is where its middle is, and anything else is where its point is: the feet, for a tile object.
    const shape = !object.gid && !object.point && object.text === null;
    const [dx, dy] = shape ? [object.width / 2, object.height / 2] : object.gid ? feet(object, found?.set.alignment) : [0, 0];
    const [tx, ty] = inTiles(object.x + dx, object.y + dy);
    // Feet put on the edge between two tiles, as Tiled does when it snaps them to the grid, stand on the one above.
    const x = Math.floor((tx - left) * 2 + 1e-6);
    const y = Math.floor(ty - top - (object.gid ? 0.1 : 0) + 1e-6);
    if (x < 0 || y < 0 || x >= width * 2 || y >= height) {
      say(`${role === "label" || role === "writing" ? `the words "${object.text ?? object.name}"` : described(role, object)} ${role === "label" || role === "writing" ? "are" : "is"} outside the room`);
      continue;
    }
    if (role === "label" || role === "writing") {
      const text = object.text ?? object.name;
      if (!text.trim()) continue;
      if (role === "writing") writing.push([x, y, text]);
      else labels.push({ text, at: [x, y] });
      continue;
    }
    const spot = `${x},${y}`;
    if (taken.has(spot)) {
      say(`${described(role, object)} is on the same square as ${taken.get(spot)}, so it's left out`);
      continue;
    }
    // The first place to start is the map's own; the others are where the story puts the player in each room.
    if (role === "start") {
      starts.push({ x, y });
      if (starts.length > 1) continue;
    }
    let fields = {};
    try {
      if (role === "person") {
        const id = personId(words(props.person).trim());
        if (!id) {
          say(`${described(role, object)} has no person property saying who they are, so they're left out`);
          continue;
        }
        fields = { id, ...(object.name.trim() ? { label: object.name.trim() } : {}), ...fieldsOf(props, new Set(["person", "label", ...TILE_ONLY])) };
      } else if (role === "thing") {
        const name = object.name.trim() || words(props.name).trim();
        if (!name) {
          say("a thing has no name, so it's left out: give it one");
          continue;
        }
        fields = { name, ...fieldsOf(props, new Set(["name", ...TILE_ONLY])) };
      } else if (role === "exit") {
        const name = object.name.trim();
        const to = words(props.to).trim() || (rooms?.has(name) ? name : "");
        if (!to) {
          say(`${described(role, object)} doesn't say where it goes: give it a to property, the id of the room it leads to`);
          continue;
        }
        fields = { to, ...(name && name !== to ? { label: name } : {}), ...fieldsOf(props, new Set(["to", "label", ...TILE_ONLY])) };
      }
    } catch (err) {
      say(`${described(role, object)} has a property that can't be read: ${err.message}`);
      continue;
    }
    taken.set(spot, described(role, object));
    placed.push({ role, x, y, fields, mark: words(props.mark), object });
  }

  // Each of them gets the letter or number it's known by on the plan: the one it says, if that's free, or the next.
  const used = new Set(plan.flat());
  const legend = { person: {}, thing: {}, exit: {} };
  const marked = new Map();
  for (const one of placed) {
    if (one.role === "start") continue;
    if (one.mark.length === 1 && MARKS[one.role].includes(one.mark) && !used.has(one.mark)) {
      used.add(one.mark);
      marked.set(one, one.mark);
    }
  }
  for (const one of placed) {
    if (one.role === "start" || marked.has(one)) continue;
    const mark = [...MARKS[one.role]].find((ch) => !used.has(ch));
    if (!mark) {
      say(`there are too many ${one.role === "person" ? "people" : one.role === "thing" ? "things" : "ways out"} in the room, so ${described(one.role, one.object)} is left out`);
      continue;
    }
    used.add(mark);
    marked.set(one, mark);
  }
  for (const one of placed) {
    const mark = one.role === "start" ? START : marked.get(one);
    if (!mark) continue;
    if (one.role !== "start") legend[one.role][mark] = one.fields;
    plan[one.y][one.x] = mark;
  }
  // A room whose last tiles have nothing on their front halves ends half a tile sooner, as the game's squares can.
  if (plan.length && plan[0].length > 1 && plan.every((row) => row.at(-1) === VOID)) for (const row of plan) row.pop();

  // What the room's called, and its colours, from the map's own properties.
  const props = map.properties;
  const level = {};
  if (words(props.name).trim()) level.name = words(props.name).trim();
  if (lines(props.aliases).length) level.aliases = lines(props.aliases);
  if (words(props.district).trim()) level.district = words(props.district).trim();
  if (words(props.desc).trim()) level.desc = words(props.desc).trim();
  const colors = Object.fromEntries(COLORS.map((key) => [key, words(props[`${key} color`]).trim()]).filter(([, value]) => value));
  if (Object.keys(colors).length) level.colors = colors;
  level.floor = floors.length ? floors.join("") : ".";
  level.plan = plan.map((row) => row.join(""));
  if (Object.keys(legend.person).length) level.people = legend.person;
  if (Object.keys(legend.thing).length) level.things = legend.thing;
  if (Object.keys(legend.exit).length) level.exits = legend.exit;
  if (writing.length) level.writing = writing;
  if (labels.length) level.labels = labels;
  if (areas.length) level.areas = areas;
  if (starts.length > 1) level.starts = starts;
  if (width * 2 > MOST_ACROSS || height > MOST_DOWN) say(`it's ${width} tiles across and ${height} down, and a map can be ${MOST_ACROSS / 2} across and ${MOST_DOWN} down at most`);
  return { level, problems };
}

// ---- A place's rooms ------------------------------------------------------------------------------------------

// Every room drawn for a place, from its folder: { rooms: { id: level }, problems, stamp, uses }. A file that can't be
// read is left out and says why. The stamp changes whenever any of the files does, and the tilesets they use, in uses.
// known has the ids of the place's other rooms, so a way out can be named after the room it leads to.
export function readPlaceRooms(folder, { personId, label = folder, known = [] } = {}) {
  const problems = [];
  const rooms = {};
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => ROOM_FILE.test(name)).sort() : [];
  const byRoom = new Map();
  for (const name of files) {
    const id = name.replace(ROOM_FILE, "");
    byRoom.set(id, [...(byRoom.get(id) ?? []), name]);
  }
  const uses = new Set();
  const ids = new Set([...known, ...byRoom.keys()]);
  for (const [id, names] of byRoom) {
    // Two files for one room: the one saved last is the one that counts.
    const name = names.length === 1 ? names[0] : [...names].sort((a, b) => fs.statSync(path.join(folder, b)).mtimeMs - fs.statSync(path.join(folder, a)).mtimeMs)[0];
    if (names.length > 1) problems.push(`${label}/${name}: there's more than one file for the room ${id} (${names.join(", ")}), and the game uses the one saved last`);
    try {
      const map = readMapFile(path.join(folder, name));
      for (const one of map.uses) uses.add(one);
      const { level, problems: found } = roomFromMap(map, { personId, rooms: ids });
      rooms[id] = level;
      for (const one of found) problems.push(`${label}/${name}: ${one}`);
    } catch (err) {
      problems.push(`${label}/${name}: it can't be read, so the room is left out: ${err.message}`);
    }
  }
  return { rooms, problems, stamp: stampOf(folder, files, [...uses]), uses: [...uses] };
}

// What a place's rooms look like on disk: their names, sizes and when they were saved, and the tilesets'.
function stampOf(folder, files, uses = []) {
  const one = (file) => {
    try {
      const { mtimeMs, size } = fs.statSync(file);
      return `${file}:${mtimeMs}:${size}`;
    } catch {
      return `${file}:gone`;
    }
  };
  return [...files.map((name) => one(path.join(folder, name))), ...uses.map(one)].join("|");
}

// The stamp for a folder now, without reading the rooms, to see whether anything's changed since.
export function stampNow(folder, uses = []) {
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => ROOM_FILE.test(name)).sort() : [];
  return stampOf(folder, files, uses);
}

// ---- A room out to Tiled, for tools/to-tiled.mjs and the tests ----------------------------------------------------

// The pieces a room's tiles are made of: each pair of the game's squares side by side, with which of them are floor.
// What's under someone is floor, and under a thing or a way out it's whatever's beside it, so that the tile is whole.
function piecesOf(level) {
  const width = Math.max(1, ...level.plan.map((row) => row.length));
  const across = Math.ceil(width / 2);
  const rows = level.plan.map((row) => row.padEnd(across * 2));
  const floorMarks = [...(level.floor ?? ".")];
  const floors = new Set(floorMarks);
  const stands = (ch) => ch === START || Boolean(level.people?.[ch]);
  const sits = (ch) => Boolean(level.things?.[ch] || level.exits?.[ch]);
  const under = (ch, other) => (stands(ch) ? floorMarks[0] : sits(ch) ? (stands(other) || sits(other) ? floorMarks[0] : other) : ch);
  return rows.map((row) => Array.from({ length: across }, (_, i) => {
    const a = row[2 * i];
    const b = row[2 * i + 1];
    const pair = [under(a, b), under(b, a)];
    if (pair[0] === VOID && pair[1] === VOID) return null;
    const mark = pair[0] === pair[1] ? pair[0] : pair.join("");
    return { mark, floor: [...new Set(pair.filter((ch) => floors.has(ch)))].join("") };
  }));
}

export const pieceKey = (piece) => `${piece.mark}|${piece.floor}`;
const isFloorPiece = (piece) => [...piece.mark].every((ch) => piece.floor.includes(ch));
// Marks for what's out in the open rather than on a floor, unless they're the floor: stars, sparks and water.
const OUT_THERE = "*'.,`;~";
const props = (list) => list.filter(([, , value]) => value !== undefined && value !== "").map(([name, type, value]) => ({ name, type, value }));
const asLines = (value) => (Array.isArray(value) ? value.join("\n") : value);
const asText = (value) => (value && typeof value === "object" ? JSON.stringify(value) : value);
const tiledColor = (value) => (/^#[0-9a-f]{6}$/i.test(String(value)) ? `#ff${String(value).slice(1)}` : value);

// A room as a Tiled map. gidOf gives a piece's tile, and figures the tiles people, things, ways out and the start stand
// on, with their pictures' sizes.
export function roomToMap(level, { gidOf, figures, tileset = "../tiles/stand-ins.tsj" }) {
  const pieces = piecesOf(level);
  const across = pieces[0]?.length ?? 1;
  const down = pieces.length;
  const floorMarks = [...(level.floor ?? ".")];
  const underneath = { mark: floorMarks[0], floor: floorMarks[0] };
  const floor = [];
  const walls = [];
  for (const row of pieces) for (const piece of row) {
    if (!piece) {
      floor.push(0);
      walls.push(0);
    } else if (isFloorPiece(piece)) {
      floor.push(gidOf(piece));
      walls.push(0);
    } else {
      // Floor goes under what stands on it, so it's still there if that's taken away: not under a wall alone, or
      // anything at the edge of the dark outside, or what's out in it, such as stars and water.
      const marks = [...piece.mark];
      const onFloor = !marks.includes(VOID) && marks.some((ch) => ch !== "#") && !marks.some((ch) => OUT_THERE.includes(ch) && !piece.floor.includes(ch));
      floor.push(onFloor ? gidOf(underneath) : 0);
      walls.push(gidOf(piece));
    }
  }
  let nextId = 1;
  const at = (x, y) => ({ x: ((x + 0.5) / 2) * TILE_HEIGHT, y: (y + 0.5) * TILE_HEIGHT });
  const standing = [];
  const words = [];
  const rows = level.plan;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const figure = (kind, name, list) => standing.push({ id: nextId++, name, type: "", gid: figures[kind].gid, ...at(x, y), width: figures[kind].width, height: figures[kind].height, rotation: 0, visible: true, ...(list.length ? { properties: list } : {}) });
    if (ch === START) figure("start", "Start", []);
    else if (level.people?.[ch]) {
      const { id, label, ...rest } = level.people[ch];
      figure("person", label ?? "", props([["person", "string", id], ...Object.entries(rest).map(([name, value]) => [name, "string", asText(asLines(value))]), ["mark", "string", ch]]));
    } else if (level.things?.[ch]) {
      const { name, ...rest } = level.things[ch];
      figure("thing", name, props([...Object.entries(rest).map(([key, value]) => [key, "string", asText(asLines(value))]), ["mark", "string", ch]]));
    } else if (level.exits?.[ch]) {
      const { to, label, ...rest } = level.exits[ch];
      figure("exit", label ?? to, props([["to", "string", to], ...Object.entries(rest).map(([key, value]) => [key, "string", asText(value)]), ["mark", "string", ch]]));
    }
  }));
  const color = tiledColor(level.colors?.writing ?? "#d8d4c0");
  const text = (type, [x, y], content) => words.push({ id: nextId++, name: "", type, x: (x / 2) * TILE_HEIGHT, y: y * TILE_HEIGHT, width: Math.max(32, content.length * 9), height: 20, rotation: 0, visible: true, text: { text: content, wrap: false, pixelsize: 14, color } });
  for (const [x, y, content] of level.writing ?? []) text("Writing", [x, y], content);
  for (const label of level.labels ?? []) text("Label", label.at, label.text);
  // The rooms drawn on a deck, as rectangles, and where the story puts the player in each.
  const rooms = (level.areas ?? []).map((area) => {
    const { id, name, x, y, w, h, ...rest } = area;
    return { id: nextId++, name, type: "Room", x: (x / 2) * TILE_HEIGHT, y: y * TILE_HEIGHT, width: (w / 2) * TILE_HEIGHT, height: h * TILE_HEIGHT, rotation: 0, visible: true, properties: props([["id", "string", id], ...Object.entries(rest).map(([key, value]) => [key, "string", asText(asLines(value))])]) };
  });
  const mainStart = rows.flatMap((row, y) => [...row].map((ch, x) => (ch === START ? { x, y } : null))).find(Boolean);
  for (const start of level.starts ?? []) {
    if (mainStart && start.x === mainStart.x && start.y === mainStart.y) continue;
    standing.push({ id: nextId++, name: "Start", type: "", gid: figures.start.gid, ...at(start.x, start.y), width: figures.start.width, height: figures.start.height, rotation: 0, visible: true });
  }
  const layer = (id, name, data) => ({ id, name, type: "tilelayer", width: across, height: down, x: 0, y: 0, opacity: 1, visible: true, data });
  const objectLayer = (id, name, objects) => ({ id, name, type: "objectgroup", draworder: "topdown", objects, x: 0, y: 0, opacity: 1, visible: true });
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.11.2",
    class: "Room",
    orientation: "isometric",
    renderorder: "right-down",
    width: across,
    height: down,
    tilewidth: TILE_WIDTH,
    tileheight: TILE_HEIGHT,
    infinite: false,
    compressionlevel: -1,
    nextlayerid: rooms.length ? 6 : 5,
    nextobjectid: nextId,
    properties: props([
      ["name", "string", level.name],
      ["aliases", "string", level.aliases?.join("\n")],
      ["district", "string", level.district],
      ["desc", "string", level.desc],
      ["floor", "string", level.floor ?? "."],
      ...COLORS.map((key) => [`${key} color`, /^#[0-9a-f]{6}$/i.test(String(level.colors?.[key])) ? "color" : "string", tiledColor(level.colors?.[key])]),
    ]),
    tilesets: [{ firstgid: 1, source: tileset }],
    layers: [layer(1, "Floor", floor), layer(2, "Walls and things", walls), objectLayer(3, "People and things", standing), objectLayer(4, "Words", words), ...(rooms.length ? [objectLayer(5, "Rooms", rooms)] : [])],
  };
}
