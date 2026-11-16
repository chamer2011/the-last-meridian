// The isometric view: the same rooms, people and clicks as the walk-around view, drawn from an angle
// instead of in console art. The game makes every bit of it itself: the metal, the rock and the rust
// are worked out here, from each level's file and world/looks.json, so every room in the world has it,
// with no art from anywhere else and no graphics engine. walk.js still does the walking, and the
// server still decides everything.

import { el } from "./dom.js";
import { FURNITURE_BY_ID, footprintOf, squaresOf } from "./furniture.js";
import { hideLoading, showLoading } from "./loading.js";
import { PACK_FIGURE, PIXEL_UNIT, cameraTurns, drawPixelBigMachine, drawPixelCrate, drawPixelDoor, drawPixelFixture, drawPixelFloors, drawPixelLowWall, drawPixelMachine, drawPixelPart, drawPixelPiece, drawPixelPost, drawPixelRail, drawPixelScrap, drawPixelStairs, drawPixelStood, drawPixelTank, drawPixelThing, drawPixelWall, drawPixelWallRun, machineAt, packBed, packKey, pixelArtOn, pixelDoorDepth, pixelKey, setLightDim, stairsUp } from "./pixel-art.js";

// A console square is about twice as tall as it's wide, so two columns make one tile.
export const CELL_WIDTH = 0.5;
export const WALL_HEIGHT = 1.7;
export const CUT_WALL_HEIGHT = 0.24;
const CUT_ROCK_HEIGHT = 0.3;
const BUILDING_HEIGHT = 1.25;
const FLOOR_EDGE = 0.22;
const DAIS_HEIGHT = 0.22;
const AMBIENT_BOOST = 1.6;
const SIZES = { smallest: 46, largest: 84 };
// The most pixels the picture of a level is drawn at, so a whole deck doesn't ask too much of a computer.

// Zooming out goes only 40% as far as it once did (to 0.82 of the usual size, not 0.55), at the owner's asking on
// 2026-11-10: further out, the ship was too small to read.
const ZOOMS = { smallest: 0.82, largest: 1.7 };
const MOST_TEXTURES = 300;
const FONT = '"Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';
const BACKGROUND = "#030403";
const FALLBACK_COLORS = { floor: "#3a4040", walls: "#6a6e6c", scenery: "#8a8e80", writing: "#d8d4c0" };
const FALLBACK_LOOK = { floor: "deck", walls: "panels", rough: "rock", ambient: "#5c5f63", lights: ["#e0b070", "#8fb8c8"], glow: "#6fd0a0", fire: "#ff9a50" };

// A ship's look, round its rooms and on their walls: the hull's skin outside the walls, with the frames across it,
// bulkhead doors between the rooms, pipes along the walls and light strips at the top of them. A place's look names
// one (style), and meridian-ship-style in localStorage tries another on, for picking one.
const HULL_REACH = 3;
const HULL_DROP = 0.3;
const SHIP_STYLES = {
  // Each tints the walls, the floors and the light of every room towards its own colour, by so much.
  navy: { name: "navy", hull: "#3c434c", rib: "#5c6670", ribEvery: 4, frame: "#8d949c", trim: "#d8c060", pipes: 0.35, pipe: "#60666c", strips: 0.7, strip: "#cfe4ff", passage: "deck", grime: 0, walls: ["#4a5668", 0.42], floors: ["#2e3642", 0.38], ambient: ["#4a5a78", 0.3] },
  worn: { name: "worn", hull: "#3a3028", rib: "#56483c", ribEvery: 3, frame: "#6e5a44", trim: "#c08a30", pipes: 0.85, pipe: "#5a4a3c", strips: 0.45, strip: "#ffc070", passage: "grate", grime: 1, walls: ["#6a4a30", 0.45], floors: ["#4a3a28", 0.4], ambient: ["#5a4028", 0.35] },
  clean: { name: "clean", hull: "#7a828a", rib: "#9aa2aa", ribEvery: 5, frame: "#b8c0c8", trim: "#4f7fb0", pipes: 0.1, pipe: "#9aa2aa", strips: 1, strip: "#eaf4ff", passage: "tile", grime: 0, walls: ["#c0c8d0", 0.5], floors: ["#9aa2a8", 0.45], ambient: ["#8a96a4", 0.4] },
};
const tinted = (color, tint) => (tint ? mix(color, tint[0], tint[1]) : color);
// How much the packs' Light look is toned down in a room of a Dark ship: what the place's look says ("pixelLight", 1
// being the pack's own Light), or what meridian-pixel-light in localStorage tries on, for picking one.
function lightDimOf(look) {
  let tried = null;
  try {
    tried = localStorage.getItem("meridian-pixel-light");
  } catch {
    tried = null;
  }
  const value = Number(tried ?? look.pixelLight ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
function shipStyleOf(look) {
  let picked = null;
  try {
    picked = localStorage.getItem("meridian-ship-style");
  } catch {
    picked = null;
  }
  return SHIP_STYLES[picked] ?? SHIP_STYLES[look.style] ?? null;
}
const SKIN = ["#d8b090", "#b98a64", "#8e6444", "#664834", "#e4c4a8"];
const HAIR = ["#2a2420", "#4a3424", "#6e5a3c", "#8a8680", "#1c1c20", "#5a2c20"];
const TROUSERS = ["#34322c", "#2c3034", "#3a342a", "#2a2c2a", "#40362c"];

// ---- From the plan to the screen ----------------------------------------

// Everything's worked out in tiles, and multiplied up by the size of a tile at the last moment.
export const project = (wx, wy, z = 0) => ({ u: (wx - wy) / 2, v: (wx + wy) / 4 - z / 2 });
export const cellCentre = (x, y) => ({ wx: (x + 0.5) * CELL_WIDTH, wy: y + 0.5 });

// Which square of the plan a point on the screen falls on, at floor level.
export function cellAt(u, v) {
  return { x: Math.floor((2 * v + u) / CELL_WIDTH), y: Math.floor(2 * v - u) };
}

// ---- Working out a level ------------------------------------------------

const kindOfMark = (mark) => (mark === "~" ? "water" : "*'.,`;".includes(mark) ? "spark" : "block");
const seeThrough = (kind) => ["floor", "door", "dim", "thing", "exit"].includes(kind);
const walkable = (kind) => kind === "floor" || kind === "door";
const hashOf = (x, y) => {
  const h = Math.imul((x * 73856093) ^ (y * 19349663), 2654435761) >>> 0;
  return (h >>> 8) / 16777216;
};

function heightOfMark(mark, look) {
  if (mark === "%") return look.rough === "plants" ? 0.3 : look.rough === "scrap" ? 0.6 : 1.05;
  if (mark === "\"") return 0.3;
  if ("|/\\".includes(mark)) return 1.05;
  if ("[]".includes(mark)) return 0.62;
  if (mark === "!") return 0.85;
  return 0.46;
}

// What a mark on the plan is, going by the marks around it.
function styleOfMark(mark, x, y, marks, look) {
  if (mark === "%") return look.rough;
  if (mark === "\"") return "plants";
  if (mark === "!") return "lamp";
  if ("|/\\".includes(mark)) return "post";
  if (mark === "[" && marks[y][x + 1] === "]") return "crate";
  if (mark === "]" && marks[y][x - 1] === "[") return "crate";
  if ("=[]<>(){}^&".includes(mark)) return look.machines === false ? "bench" : "machine";
  return "ledge";
}

// What's on each square, how high it stands and what it's like, from the same layers the console view
// draws. This doesn't touch the screen, so every level in the game can be checked by the tests.
export function buildScene(view) {
  const { cols, lines, layers } = view;
  const look = { ...FALLBACK_LOOK, ...view.look };
  const style = shipStyleOf(look);
  setLightDim(lightDimOf(look));
  if (style) look.ambient = tinted(hexOr(look.ambient, FALLBACK_LOOK.ambient), style.ambient);
  // On a deck, each room drawn there can have lamps of its own colour, and a room with its lights out has none lit.
  const areas = view.areas ?? [];
  const areaAt = (x, y) => areas.filter((area) => x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h).sort((a, b) => a.w * a.h - b.w * b.h)[0] ?? null;
  const darkAt = (x, y) => Boolean(areaAt(x, y)?.dark);
  // A room with no power has its screens dark and its consoles still, whether its lights are on a switch or not.
  const unpoweredAt = (x, y) => areaAt(x, y)?.power === false;
  const grid = (fill) => Array.from({ length: lines }, () => Array(cols).fill(fill));
  const kinds = grid("blank");
  const marks = grid(" ");
  const floors = grid(" ");
  const heights = grid(0);
  const styles = grid(null);
  const inPlan = (x, y) => x >= 0 && y >= 0 && x < cols && y < lines;
  const kindAt = (x, y) => (inPlan(x, y) ? kinds[y][x] : "out");
  const charAt = (layer, x, y) => layers[layer]?.[y]?.[x] ?? " ";

  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (charAt("floor", x, y) !== " ") {
        kinds[y][x] = "floor";
        floors[y][x] = charAt("floor", x, y);
      } else if (charAt("doors", x, y) !== " ") kinds[y][x] = "door";
      else if (charAt("walls", x, y) !== " ") kinds[y][x] = "wall";
      else if (charAt("scenery", x, y) !== " ") {
        marks[y][x] = charAt("scenery", x, y);
        kinds[y][x] = kindOfMark(marks[y][x]);
      }
    }
  }
  // Words are painted on whatever's under them.
  (layers.under ?? []).forEach((row, y) => [...row].forEach((was, x) => {
    if (was === "f") kinds[y][x] = "floor";
    else if (was === "w") kinds[y][x] = "wall";
    else if (was === "d") kinds[y][x] = "door";
    else if (was === "s") {
      marks[y][x] = "-";
      kinds[y][x] = "block";
    }
  }));
  // A wave on its own is a cloud or a wisp of steam. It's only water if there are more of them.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (marks[y][x] === "~" && ![-2, -1, 1, 2].some((dx) => marks[y][x + dx] === "~")) kinds[y][x] = "spark";
    }
  }
  // Stars come one at a time. A row of them is something burning.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (marks[y][x] === "*" && (marks[y][x - 1] === "*" || marks[y][x + 1] === "*")) kinds[y][x] = "glow";
    }
  }
  for (const thing of view.things ?? []) if (inPlan(thing.x, thing.y) && thing.part?.mount !== "wall") kinds[thing.y][thing.x] = "thing";
  for (const exit of view.exits ?? []) if (inPlan(exit.x, exit.y)) kinds[exit.y][exit.x] = "exit";

  const runs = [];
  (layers.writing ?? []).forEach((row, y) => {
    for (const match of row.matchAll(/\S+(?: {1,2}\S+)*/g)) runs.push({ text: match[0], x: match.index, y, length: match[0].length });
  });

  // Gaps between waves are water too.
  const isWave = (x, y) => marks[y]?.[x] === "~" && kinds[y][x] === "water";
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] === "blank" && (isWave(x - 1, y) || isWave(x + 1, y))) kinds[y][x] = "water";
    }
  }

  // Empty squares are outside if they reach the edge of the plan, the ground if they're beside somewhere
  // to walk, and the inside of something if they're shut in by its outline.
  const seen = grid(false);
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] !== "blank" || seen[y][x]) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[y][x] = true;
      let edge = false;
      let beside = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          const kind = kindAt(nx, ny);
          if (kind === "out") edge = true;
          else if (kind === "floor" || kind === "door") beside = true;
          else if (kind === "blank" && !seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      const kind = edge ? "void" : beside ? "dim" : "inside";
      const height = Math.min(BUILDING_HEIGHT, 0.7 + cells.length * 0.02);
      for (const [cx, cy] of cells) {
        kinds[cy][cx] = kind;
        if (kind === "inside") {
          heights[cy][cx] = height;
          styles[cy][cx] = "body";
        }
      }
    }
  }
  // On a ship, the hull's skin shows a little way out beyond the walls, where there'd be nothing, and the stars
  // begin beyond it. Each square of it knows how far out it is, for the frames across it and the edge where it
  // curves away.
  const hull = grid(0);
  if (style) {
    const outside = (x, y) => inPlan(x, y) && (kinds[y][x] === "void" || kinds[y][x] === "spark");
    let ring = [];
    for (let y = 0; y < lines; y += 1) for (let x = 0; x < cols; x += 1) if (kinds[y][x] !== "void" && kinds[y][x] !== "spark") ring.push([x, y]);
    for (let distance = 1; distance <= HULL_REACH && ring.length; distance += 1) {
      const next = [];
      for (const [cx, cy] of ring) {
        // To the squares at its corners as well as beside it, so the skin turns a corner of the hull square and not in steps.
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1], [cx + 1, cy + 1], [cx - 1, cy + 1], [cx + 1, cy - 1], [cx - 1, cy - 1]]) {
          if (!outside(nx, ny) || hull[ny][nx]) continue;
          hull[ny][nx] = distance;
          kinds[ny][nx] = "hull";
          next.push([nx, ny]);
        }
      }
      ring = next;
    }
  }

  // Walls and rock between the camera and the room are cut down, or nobody could see in.
  const hides = (x, y) => seeThrough(kindAt(x, y - 1)) || seeThrough(kindAt(x - 1, y)) || seeThrough(kindAt(x - 1, y - 1));
  // An outline stands as high as whatever it's the outline of.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] === "block") {
        let height = heightOfMark(marks[y][x], look);
        let style = styleOfMark(marks[y][x], x, y, marks, look);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (kindAt(x + dx, y + dy) === "inside" && heights[y + dy][x + dx] > height) {
              height = heights[y + dy][x + dx];
              style = "body";
            }
          }
        }
        if ((style === "rock" || style === "ice") && hides(x, y)) height = CUT_ROCK_HEIGHT;
        heights[y][x] = height;
        styles[y][x] = style;
      } else if (kinds[y][x] === "wall") {
        heights[y][x] = hides(x, y) ? CUT_WALL_HEIGHT : WALL_HEIGHT;
        styles[y][x] = "wall";
      }
    }
  }
  // One big thing in place of what's drawn on the plan, standing on a dais that covers whatever can't be walked on.
  const { shape } = look;
  if (shape) {
    for (let y = shape.from[1]; y <= shape.to[1]; y += 1) {
      for (let x = shape.from[0]; x <= shape.to[0]; x += 1) {
        if (!["block", "inside", "dim", "spark", "glow"].includes(kindAt(x, y))) continue;
        kinds[y][x] = "block";
        marks[y][x] = "-";
        heights[y][x] = DAIS_HEIGHT;
        styles[y][x] = "dais";
      }
    }
  }
  for (const run of runs) {
    const kind = kinds[run.y][run.x];
    run.on = kind === "wall" ? "wall" : heights[run.y][run.x] > 0 ? "roof" : "ground";
    // Words on bare ground are on the level's floor, as far as anyone can see.
    if (kind === "dim") for (let i = 0; i < run.length; i += 1) if (kinds[run.y][run.x + i] === "dim") kinds[run.y][run.x + i] = "floor";
  }

  const heightAt = (x, y) => (inPlan(x, y) ? heights[y][x] : 0);
  const blocks = [];
  const ground = [];
  const water = [];
  const sparks = [];
  const glows = [];
  let bounds = null;
  const spanOf = (x, y, top, bottom = 0) => {
    const found = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
    for (const [wx, wy] of [[x * CELL_WIDTH, y], [(x + 1) * CELL_WIDTH, y], [x * CELL_WIDTH, y + 1], [(x + 1) * CELL_WIDTH, y + 1]]) {
      for (const z of [top, bottom]) {
        const { u, v } = project(wx, wy, z);
        found.minU = Math.min(found.minU, u);
        found.maxU = Math.max(found.maxU, u);
        found.minV = Math.min(found.minV, v);
        found.maxV = Math.max(found.maxV, v);
      }
    }
    return found;
  };
  const reach = (span) => {
    bounds = bounds ?? { ...span };
    bounds.minU = Math.min(bounds.minU, span.minU);
    bounds.maxU = Math.max(bounds.maxU, span.maxU);
    bounds.minV = Math.min(bounds.minV, span.minV);
    bounds.maxV = Math.max(bounds.maxV, span.maxV);
  };
  // The squares of the rooms that are in the packs' Light look whatever the ship's is (world/looks.json, "pixel"): the
  // pixel-art view lays their floors, walls and furniture from that look.
  const light = Array.from({ length: lines }, (_, y) => Array.from({ length: cols }, (_, x) => areaAt(x, y)?.look?.pixel === "light"));
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const kind = kinds[y][x];
      if (kind === "void") continue;
      const { wx, wy } = cellCentre(x, y);
      reach(spanOf(x, y, heightAt(x, y), kind === "hull" ? -HULL_DROP - 1 : -FLOOR_EDGE));
      if (kind === "water") water.push({ x, y, seed: hashOf(x, y) });
      else if (kind === "glow") glows.push({ x, y, seed: hashOf(x, y) });
      else if (kind === "spark") sparks.push({ x, y, seed: hashOf(x, y), mark: marks[y][x] });
      else if (kind === "hull") ground.push({ x, y, kind, seed: hashOf(x, y), mark: " ", ring: hull[y][x], rib: Math.floor(x / 2) % style.ribEvery === 0 });
      // On a deck, the floor of the deck itself, between the rooms drawn on it, is a passage.
      else ground.push({ x, y, kind, seed: hashOf(x, y), mark: floors[y][x], passage: Boolean(style) && kind === "floor" && areas.length > 0 && !areaAt(x, y), ...(light[y][x] ? { light: true } : {}) });
      if (heights[y][x] > 0) {
        blocks.push({
          type: "block",
          x,
          y,
          h: heights[y][x],
          style: styles[y][x],
          mark: marks[y][x],
          seed: hashOf(x, y),
          right: heightAt(x + 1, y),
          left: heightAt(x, y + 1),
          back: heightAt(x, y - 1),
          side: heightAt(x - 1, y),
          depth: wx + wy,
          span: spanOf(x, y, heights[y][x]),
          // Whether the rooms a wall's two faces look into have their lights on, for the strips along its top.
          litLeft: !darkAt(x, y + 1),
          litRight: !darkAt(x + 1, y),
          ...(styles[y][x] === "machine" && unpoweredAt(x, y) ? { off: true } : {}),
          // What a bank of the plan's consoles is in this room, where its look says (a galley's counters and stoves).
          ...(styles[y][x] === "machine" && areaAt(x, y)?.look?.banks ? { bank: areaAt(x, y).look.banks } : {}),
        });
      }
    }
  }
  if (shape) {
    const wx = ((shape.from[0] + shape.to[0] + 1) / 2) * CELL_WIDTH;
    const wy = (shape.from[1] + shape.to[1] + 1) / 2;
    const radius = (shape.to[1] - shape.from[1] + 1) / 2 - 0.15;
    const h = DAIS_HEIGHT + 0.32;
    const top = project(wx, wy, h);
    // The whole of it is drawn after the dais under it, though people are only behind it if they're behind the middle of it.
    blocks.push({ type: "block", style: shape.kind, x: shape.from[0], y: shape.from[1], wx, wy, radius, h, seed: 0, mark: " ", right: 0, left: 0, back: 0, side: 0, depth: wx + wy, frontDepth: (shape.to[0] + 1) * CELL_WIDTH + shape.to[1] + 1, span: { minU: top.u - radius, maxU: top.u + radius, minV: top.v - radius / 2, maxV: top.v + radius / 2 + h } });
  }
  // Furniture (public/furniture.js), as blocks of its own, with the light some of it gives off.
  const furniture = furnish(view, { kinds, heights, blocks, painted: (x, y) => runs.some((run) => run.y === y && x >= run.x && x < run.x + run.length), unpowered: unpoweredAt });
  // A deck's stairs stand where the plan has their row of posts (stairsOf, below): one block each beside the posts,
  // which only the pixel-art view draws, in the posts' place.
  const stairs = stairsOf(view, styles);
  for (const stair of stairs) {
    for (const block of blocks) if (block.style === "post" && block.y === stair.y && block.x >= stair.x0 && block.x < stair.x1) block.stair = true;
    const [x0, x1] = [stair.x0 * CELL_WIDTH, stair.x1 * CELL_WIDTH];
    const up = stair.way === "up" ? stairsUp({ x0, x1 }) : null;
    // What stands up is as long as its flights and its landing; a well is flat, and drawn before anything near it.
    const [from, to, top] = up ? [up.top - up.landing, up.foot, up.high + 0.3] : [x0, x1, 0];
    const span = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
    for (const wx of [from, to]) for (const wy of [stair.y, stair.y + 1]) for (const z of [0, top]) {
      const { u, v } = project(wx, wy, z);
      span.minU = Math.min(span.minU, u);
      span.maxU = Math.max(span.maxU, u);
      span.minV = Math.min(span.minV, v);
      span.maxV = Math.max(span.maxV, v);
    }
    blocks.push({ type: "block", style: "stairs", way: stair.way, x: stair.x0, y: stair.y, x0, y0: stair.y, x1, y1: stair.y + 1, h: top, seed: 0, mark: " ", right: 0, left: 0, back: 0, side: 0, depth: up ? (from + to) / 2 + stair.y + 0.5 : x0 + stair.y, span, ...(light[stair.y]?.[stair.x0] ? { light: true } : {}) });
  }
  // Big machines, for the pixel-art view (public/pixel-art.js). A machine square with more of its kind above or below
  // it is part of one. Beside the burning heart of an engine (a run of glow between two machines, or a round mark
  // between two) it's pumps, and tanks stand in the heart; anywhere else it's hull, like the ship's boat. The floor
  // along a big machine's foot is painted with hazard stripes, and an engine has a rail round it. None of it changes
  // what stands where: the tanks and rails are blocks of their own that only that view draws.
  const machineHere = (x, y) => styles[y]?.[x] === "machine";
  const roundAt = (x, y) => marks[y]?.[x] === "0" && machineHere(x - 1, y) && machineHere(x + 1, y);
  const heartAt = (x, y) => {
    if (roundAt(x, y)) return { from: x, to: x };
    if (kinds[y]?.[x] !== "glow") return null;
    let from = x;
    while (kinds[y]?.[from - 1] === "glow") from -= 1;
    let to = x;
    while (kinds[y]?.[to + 1] === "glow") to += 1;
    return machineHere(from - 1, y) && machineHere(to + 1, y) ? { from, to } : null;
  };
  const big = new Map();
  for (const block of blocks) {
    const { x, y } = block;
    if (block.style === "machine") {
      const side = heartAt(x + 1, y) ? "e" : heartAt(x - 1, y) ? "w" : null;
      if (side) Object.assign(block, { big: "engine", heartSide: side });
      else if (machineAt(x, y, machineHere).block) block.big = "hull";
      if (block.big) big.set(`${x},${y}`, block.big);
    } else if (roundAt(x, y)) {
      block.tank = true;
      big.set(`${x},${y}`, "heart");
    }
  }
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const heart = kinds[y][x] === "glow" ? heartAt(x, y) : null;
      if (!heart) continue;
      big.set(`${x},${y}`, "heart");
      // A tank on every other square of the heart, from its first.
      if ((x - heart.from) % 2 === 0) blocks.push({ type: "block", style: "tank", x, y, h: 1.1, seed: hashOf(x, y), mark: " ", right: 0, left: 0, back: 0, side: 0, depth: (x + 0.5) * CELL_WIDTH + y + 0.5, span: spanOf(x, y, 1.2) });
    }
  }
  // The ship's boat: a stretch of hull with a middle to it has a well there, with the pack's control console at its
  // forward end and two seats behind it, facing forward.
  const hullAt = (x, y) => big.get(`${x},${y}`) === "hull";
  const wells = blocks.filter((block) => block.big === "hull" && hullAt(block.x - 1, block.y) && hullAt(block.x + 1, block.y) && hullAt(block.x, block.y - 1) && hullAt(block.x, block.y + 1));
  for (const block of wells) block.inner = true;
  if (wells.length >= 8) {
    const rows = wells.map((block) => block.y);
    const cy = (Math.min(...rows) + Math.max(...rows) + 1) / 2;
    const bow = Math.min(...wells.filter((block) => block.y === Math.floor(cy)).map((block) => block.x)) * CELL_WIDTH;
    const stand = (piece, cx, facing) => {
      const [sx, sy] = [Math.floor(cx / CELL_WIDTH), Math.floor(cy)];
      const lift = wells.find((block) => block.x === sx && block.y === sy)?.h ?? 0.46;
      blocks.push({ type: "block", style: "stood", piece, facing, cx, cy, lift, x: sx, y: sy, h: lift + 0.9, seed: 0, mark: " ", right: 0, left: 0, back: 0, side: 0, depth: cx + cy + 0.45, span: spanOf(sx, sy, lift + 1) });
    };
    stand("plan-console", bow + 0.5, "e");
    stand("command-chair", bow + 1.25, "w");
    stand("command-chair", bow + 2, "w");
  }
  const striped = new Map();
  for (const [key, what] of big) {
    const [x, y] = key.split(",").map(Number);
    for (const [edge, nx, ny, from] of [["n", x, y - 1, "s"], ["s", x, y + 1, "n"], ["w", x - 1, y, "e"], ["e", x + 1, y, "w"]]) {
      if (!walkable(kinds[ny]?.[nx])) continue;
      striped.set(`${nx},${ny}`, (striped.get(`${nx},${ny}`) ?? "") + from);
      if (what === "hull") continue;
      const depth = { n: (x + 0.5) * CELL_WIDTH + y + 0.01, s: (x + 0.5) * CELL_WIDTH + y + 0.99, w: x * CELL_WIDTH + y + 0.51, e: (x + 1) * CELL_WIDTH + y + 0.49 }[edge];
      blocks.push({ type: "block", style: "rail", edge, x, y, h: 0.5, seed: 0, mark: " ", right: 0, left: 0, back: 0, side: 0, depth, span: spanOf(x, y, 0.6) });
    }
  }
  for (const cell of ground) {
    const sides = striped.get(`${cell.x},${cell.y}`);
    if (sides) cell.hazard = sides;
  }
  blocks.sort((a, b) => a.depth - b.depth);

  // A room on fire burns on a few of its squares, more as it grows: each a flicker on the floor with light of its own,
  // flames over it every frame (drawFlames) and smoke over the room (drawSmoke). The same squares every time, in an
  // order of the room's own, so a fire that grows keeps burning where it was.
  const burntSquares = (area, size) => {
    const squares = [];
    for (let y = area.y; y < area.y + area.h; y += 1) for (let x = area.x; x < area.x + area.w; x += 1) if (kindAt(x, y) === "floor" && areaAt(x, y) === area) squares.push({ x, y, order: hashOf(x * 7 + area.x, y * 13 + area.y) });
    squares.sort((a, b) => a.order - b.order);
    return squares.slice(0, 1 + size * 2);
  };
  const fires = [];
  for (const area of areas.filter((one) => one.fire > 0)) {
    for (const { x, y } of burntSquares(area, area.fire)) {
      const seed = hashOf(x, y);
      fires.push({ x, y, seed, room: area.id, size: area.fire });
      glows.push({ x, y, seed: 0.85 + seed * 0.15 });
    }
  }
  // Where a fire burned, the soot it left on the same squares, fading as the crew clean it away (src/wear.js); and the
  // stains where people fell.
  const stains = [];
  for (const area of areas.filter((one) => one.scorched && !(one.fire > 0))) {
    for (const { x, y } of burntSquares(area, area.scorched.size)) stains.push({ kind: "scorch", x, y, left: area.scorched.left });
  }
  for (const mark of view.marks ?? []) if (inPlan(mark.x, mark.y)) stains.push(mark);
  // A hole in the hull: on one of the room's walls the camera sees from inside it, with space beyond it where it can be.
  const breaches = [];
  for (const area of areas.filter((one) => one.breach)) {
    const inRoom = (x, y) => seeThrough(kindAt(x, y)) && areaAt(x, y) === area;
    const walls = [];
    for (let y = area.y - 1; y <= area.y + area.h; y += 1) {
      for (let x = area.x - 1; x <= area.x + area.w; x += 1) {
        if (kindAt(x, y) !== "wall") continue;
        const face = inRoom(x, y + 1) ? "s" : inRoom(x + 1, y) ? "e" : null;
        if (!face) continue;
        const beyond = face === "s" ? kindAt(x, y - 1) : kindAt(x - 1, y);
        walls.push({ x, y, face, outside: !seeThrough(beyond) && beyond !== "wall", order: hashOf(x * 3 + 1, y * 5 + 2) });
      }
    }
    walls.sort((a, b) => Number(b.outside) - Number(a.outside) || a.order - b.order);
    if (walls[0]) breaches.push({ x: walls[0].x, y: walls[0].y, face: walls[0].face, room: area.id });
  }
  // What grows in a room grows on its beds a stage at a time as the room gives what it grows, each bed at a stage of
  // its own; anywhere else, beds are drawn as they always were.
  for (const grow of view.growing ?? []) {
    const area = areas.find((one) => one.id === grow.room);
    if (!area) continue;
    for (const block of blocks) {
      if (block.style !== "plants" || areaAt(block.x, block.y) !== area) continue;
      let start = block.x;
      while (marks[block.y][start - 1] === "\"") start -= 1;
      block.growth = growthStage(grow.made, start, block.y);
    }
  }
  // On a ship, the doorways between rooms, where doors slide (drawn every frame, drawDoorPanels): each in the plane its
  // frame is in, and not where a way out is drawn, a locked door being one.
  const exitAt = new Set((view.exits ?? []).map((exit) => `${exit.x},${exit.y}`));
  const doorways = style ? ground.filter((cell) => cell.kind === "door" && !exitAt.has(`${cell.x},${cell.y}`)).map((cell) => ({ x: cell.x, y: cell.y, along: doorAlong(kinds, cell.x, cell.y) })) : [];

  // Lamps you can see, on the walls at the back of the room, and a pool of light on the floor in front of each.
  const lights = [];
  const addLight = (x, y, color, radius, power) => {
    const { wx, wy } = cellCentre(x, y);
    lights.push({ wx, wy, color, radius, power });
  };
  const pick = (seed) => look.lights[Math.floor(seed * look.lights.length) % look.lights.length];
  const pickAt = (x, y, seed) => {
    const own = areaAt(x, y)?.look?.lights;
    return own?.length ? own[Math.floor(seed * own.length) % own.length] : pick(seed);
  };
  const painted = (x, y) => runs.some((run) => run.y === y && x >= run.x && x < run.x + run.length);
  const mounted = new Set((view.things ?? []).filter((thing) => thing.part?.mount === "wall").map((thing) => `${thing.x},${thing.y}`));
  const fixtures = [];
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] !== "wall" || heights[y][x] !== WALL_HEIGHT || painted(x, y) || mounted.has(`${x},${y}`) || furniture.wallUsed.has(`${x},${y}`)) continue;
      const seed = hashOf(x, y);
      if (seeThrough(kindAt(x, y + 1)) && (x + y * 5) % 18 === 7) {
        const off = darkAt(x, y + 1);
        fixtures.push({ x, y, face: "left", color: pickAt(x, y + 1, seed), ...(off ? { off: true } : {}) });
        if (!off) addLight(x, y + 2, pickAt(x, y + 1, seed), 3.6 + seed * 1.4, 0.95);
      } else if (!seeThrough(kindAt(x, y + 1)) && seeThrough(kindAt(x + 1, y)) && (x + y * 3) % 9 === 4) {
        const off = darkAt(x + 1, y);
        fixtures.push({ x, y, face: "right", color: pickAt(x + 1, y, seed), ...(off ? { off: true } : {}) });
        if (!off) addLight(x + 3, y, pickAt(x + 1, y, seed), 3.6 + seed * 1.4, 0.95);
      }
    }
  }
  // And a thinner scatter over the rest of the floor, so that nowhere's completely black. Where there are no lamps
  // on the walls, this is all the light there is.
  const fill = fixtures.length >= 2 ? 0.5 : 1;
  for (let y = 2; y < lines + 2; y += 6) {
    for (let x = 4; x < cols + 4; x += 15) {
      const seed = hashOf(x, y);
      const lx = x + Math.floor(seed * 7) - 3;
      const ly = y + Math.floor(hashOf(y, x) * 4) - 2;
      if (seeThrough(kindAt(lx, ly)) && !darkAt(lx, ly)) addLight(lx, ly, pickAt(lx, ly, seed), 3.2 + seed * 2.6, (0.7 + hashOf(lx, ly) * 0.3) * fill);
    }
  }
  glows.filter((cell) => cell.seed > 0.8).forEach((cell) => addLight(cell.x, cell.y, look.fire, 2.6, 0.9));
  if (!lights.length && ground.length) {
    const middle = ground[Math.floor(ground.length / 2)];
    addLight(middle.x, middle.y, pick(0.3), 5, 0.9);
  }
  blocks.filter((block) => block.style === "lamp" && block.seed > 0.5 && !darkAt(block.x, block.y)).forEach((block) => addLight(block.x, block.y, pickAt(block.x, block.y, block.seed), 2.4, 0.8));
  blocks.filter((block) => block.style === "machine" && block.seed > 0.86 && !block.off).forEach((block) => addLight(block.x, block.y, look.glow, 1.5, 0.5));
  for (const exit of view.exits ?? []) addLight(exit.x, exit.y, exit.closed ? "#c86048" : "#d8d0b0", 1.8, 0.55);
  for (const light of furniture.lights) if (!darkAt(light.x, light.y)) addLight(light.x, light.y, light.color, light.radius, light.power);
  // A whole level goes dark where it's one room. On a deck, the rooms drawn there go dark one by one, below.
  const dark = Boolean(view.room?.dark) && !areas.length;
  if (dark) {
    lights.length = 0;
    glows.filter((cell) => cell.seed > 0.8).forEach((cell) => addLight(cell.x, cell.y, look.fire, 2.6, 0.9));
    for (const exit of view.exits ?? []) addLight(exit.x, exit.y, "#c83a28", 2.4, 0.5);
    for (const thing of view.things ?? []) if (thing.part?.works && ["console", "relay", "nav core", "engines"].includes(thing.part.kind)) addLight(thing.x, thing.y + (thing.part.face === "back" ? 1 : 0), thing.part.kind === "engines" ? "#d07038" : "#5fd0a0", 1.4, 0.4);
    for (const fixture of fixtures) fixture.off = true;
  }

  return {
    cols,
    lines,
    kinds,
    heights,
    styles,
    blocks,
    ground,
    water,
    sparks,
    glows,
    runs,
    lights,
    fixtures,
    junk: ground.filter((cell) => cell.kind === "dim" && cell.seed > 0.68),
    look: dark ? { ...look, ambient: mix(hexOr(look.ambient, FALLBACK_LOOK.ambient), "#000000", 0.74) } : look,
    style,
    dark,
    darkAreas: areas.filter((area) => area.dark),
    fires,
    breaches,
    doorways,
    marks: stains,
    // How worn and cluttered the place looks, 0 to 3 each, where it's said (the ship: src/wear.js).
    wear: view.wear ?? null,
    light,
    // Which squares are part of a big machine, and what part ("engine", "heart" or "hull"), for the pixel-art view.
    big,
    // The wall squares with something on them (a window, a screen, a part of the systems, a lamp, painted words), so
    // the pixel-art view runs its pipes and cables along the bare ones only.
    fitted: new Set([
      ...blocks.filter((block) => block.wallX !== undefined).map((block) => `${block.wallX},${block.wallY}`),
      ...(view.things ?? []).filter((thing) => thing.part?.mount === "wall").map((thing) => `${thing.x},${thing.y}`),
      ...fixtures.map((fixture) => `${fixture.x},${fixture.y}`),
      ...runs.filter((run) => run.on === "wall").flatMap((run) => Array.from({ length: run.length }, (_, i) => `${run.x + i},${run.y}`)),
    ]),
    // Where the floor is worn by walking (wornPaths, below).
    worn: wornPaths(view, kinds),
    bounds: bounds ?? { minU: -1, maxU: 1, minV: -1, maxV: 1 },
    colors: { ...FALLBACK_COLORS, ...view.colors },
  };
}

// ---- Colors -------------------------------------------------------------

function rgbOf(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const see = (hex, alpha) => {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};
const mix = (hex, other, by) => {
  const [r, g, b] = rgbOf(hex);
  const [r2, g2, b2] = rgbOf(other);
  return `#${[r + (r2 - r) * by, g + (g2 - g) * by, b + (b2 - b) * by].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
};
const scaled = (hex, by) => mix(hex, by > 1 ? "#ffffff" : "#000000", by > 1 ? by - 1 : 1 - by);
const hexOr = (color, fallback) => (/^#[0-9a-f]{6}$/i.test(color ?? "") ? color : fallback);

// ---- What things are made of --------------------------------------------

// A little random-number maker of its own, so that the same room always gets the same scratches.
function randomFrom(text) {
  let seed = 0;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function grain(ctx, size, amount, random) {
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const by = (random() - 0.5) * amount;
    image.data[i] += by;
    image.data[i + 1] += by;
    image.data[i + 2] += by;
  }
  ctx.putImageData(image, 0, 0);
}

function stains(ctx, size, color, count, spread, strength, random) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = spread * (0.4 + random());
    const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, see(color, strength * (0.4 + random() * 0.6)));
    blot.addColorStop(1, see(color, 0));
    ctx.fillStyle = blot;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function scratches(ctx, size, count, random, color = "rgba(255,255,255,.07)") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const long = 6 + random() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * long, y + Math.sin(angle) * long);
    ctx.stroke();
  }
}

function crack(ctx, size, random, strength = 0.4) {
  let x = random() * size;
  let y = random() * size;
  ctx.strokeStyle = `rgba(0,0,0,${strength})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 7; i += 1) {
    x += (random() - 0.5) * 18 + 3;
    y += (random() - 0.5) * 18 + 3;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function rivet(ctx, x, y) {
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

function seams(ctx, size, random) {
  ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.1})`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(0, 0, size, 2);
  ctx.fillStyle = "rgba(255,255,255,.1)";
  ctx.fillRect(2, 2, 1, size - 2);
  ctx.fillRect(2, 2, size - 2, 1);
}

const RUST = "#6a3a18";

// One tile of each floor: 128 by 128, and the size it's drawn at doesn't matter much.
const FLOORS = {
  // The hull's skin, seen from above: a plate to each square, with seams and rivets between, and worn in places.
  plating(ctx, size, random, variant) {
    grain(ctx, size, 12, random);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, size, 3);
    ctx.fillRect(0, 0, 3, size);
    ctx.fillRect(size / 2 - 1, 0, 3, size);
    ctx.fillStyle = "rgba(255,255,255,.08)";
    ctx.fillRect(3, 3, size - 3, 1);
    ctx.fillRect(3, 3, 1, size - 3);
    ctx.fillRect(size / 2 + 2, 3, 1, size - 3);
    for (let y = 10; y < size; y += 18) {
      rivet(ctx, 8, y);
      rivet(ctx, size / 2 - 6, y);
      rivet(ctx, size / 2 + 7, y);
      rivet(ctx, size - 6, y);
    }
    for (let x = 12; x < size; x += 20) rivet(ctx, x, 8);
    scratches(ctx, size, 5, random);
    stains(ctx, size, "#000000", 4, 30, 0.22, random);
    if (variant === 1) stains(ctx, size, RUST, 7, 28, 0.36, random);
  },
  deck(ctx, size, random, variant) {
    grain(ctx, size, 16, random);
    if (variant === 1) {
      // Tread plate.
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let y = 6; y < size; y += 14) for (let x = (y % 28 ? 0 : 7) + 3; x < size; x += 14) ctx.fillRect(x, y, 6, 2);
    }
    stains(ctx, size, RUST, 3 + Math.floor(random() * 4), 26, 0.28, random);
    stains(ctx, size, "#000000", 3, 34, 0.25, random);
    scratches(ctx, size, 7, random);
    if (variant === 3) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(40, 44, 48, 40);
      ctx.fillStyle = "rgba(255,255,255,.1)";
      for (let x = 44; x < 88; x += 8) ctx.fillRect(x, 44, 2, 40);
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(40, 44, 48, 40);
    }
    seams(ctx, size, random);
    for (const [x, y] of [[7, 7], [size - 8, 7], [7, size - 8], [size - 8, size - 8]]) rivet(ctx, x, y);
  },
  grate(ctx, size, random) {
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,255,255,.1)";
    for (let i = 0; i < size; i += 10) {
      ctx.fillRect(i, 0, 3, size);
      ctx.fillRect(0, i, size, 3);
    }
    grain(ctx, size, 14, random);
    stains(ctx, size, RUST, 4, 24, 0.3, random);
    seams(ctx, size, random);
  },
  concrete(ctx, size, random) {
    grain(ctx, size, 26, random);
    stains(ctx, size, "#000000", 6, 30, 0.2, random);
    stains(ctx, size, "#ffffff", 3, 24, 0.05, random);
    crack(ctx, size, random);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(0, 0, size, 1);
    ctx.fillRect(0, 0, 1, size);
  },
  dirt(ctx, size, random) {
    grain(ctx, size, 34, random);
    stains(ctx, size, "#000000", 7, 26, 0.22, random);
    stains(ctx, size, "#b09868", 4, 22, 0.1, random);
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = random() > 0.5 ? "rgba(0,0,0,.35)" : "rgba(255,240,210,.14)";
      ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 2);
    }
  },
  soil(ctx, size, random) {
    grain(ctx, size, 30, random);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    for (let y = 8; y < size; y += 16) ctx.fillRect(0, y, size, 6);
    stains(ctx, size, "#000000", 5, 24, 0.2, random);
  },
  stone(ctx, size, random) {
    const half = size / 2;
    for (const [x, y] of [[0, 0], [half, 0], [0, half], [half, half]]) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.09})`;
      ctx.fillRect(x, y, half, half);
    }
    grain(ctx, size, 20, random);
    stains(ctx, size, "#000000", 5, 26, 0.18, random);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, 0, 2, size);
    ctx.fillRect(half, 0, 2, size);
    ctx.fillRect(0, half, size, 2);
    if (random() > 0.6) crack(ctx, size, random, 0.3);
  },
  tile(ctx, size, random) {
    const step = size / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.07})`;
        ctx.fillRect(x * step, y * step, step, step);
      }
    }
    grain(ctx, size, 10, random);
    stains(ctx, size, "#2a2418", 4, 24, 0.22, random);
    ctx.fillStyle = "rgba(0,0,0,.42)";
    for (let i = 0; i < size; i += step) {
      ctx.fillRect(i, 0, 1, size);
      ctx.fillRect(0, i, size, 1);
    }
  },
  wood(ctx, size, random) {
    const plank = size / 4;
    for (let y = 0; y < 4; y += 1) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,220,180" : "0,0,0"},${random() * 0.12})`;
      ctx.fillRect(0, y * plank, size, plank);
    }
    ctx.strokeStyle = "rgba(0,0,0,.14)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size / 3, y + random() * 4 - 2, (size * 2) / 3, y + random() * 4 - 2, size, y);
      ctx.stroke();
    }
    grain(ctx, size, 14, random);
    stains(ctx, size, "#000000", 3, 26, 0.2, random);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    for (let y = 0; y < 4; y += 1) ctx.fillRect(0, y * plank, size, 1);
    ctx.fillRect(Math.floor(random() * size), 0, 1, plank);
    ctx.fillRect(Math.floor(random() * size), plank * 2, 1, plank);
  },
  carpet(ctx, size, random) {
    grain(ctx, size, 22, random);
    ctx.strokeStyle = "rgba(255,220,160,.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76);
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.28);
    ctx.lineTo(size * 0.72, size / 2);
    ctx.lineTo(size / 2, size * 0.72);
    ctx.lineTo(size * 0.28, size / 2);
    ctx.closePath();
    ctx.stroke();
    stains(ctx, size, "#000000", 5, 28, 0.2, random);
  },
  rock(ctx, size, random) {
    grain(ctx, size, 34, random);
    stains(ctx, size, "#000000", 9, 28, 0.3, random);
    stains(ctx, size, "#ffffff", 3, 18, 0.05, random);
    for (let i = 0; i < 3; i += 1) crack(ctx, size, random, 0.35);
  },
  ice(ctx, size, random) {
    grain(ctx, size, 12, random);
    stains(ctx, size, "#ffffff", 5, 30, 0.12, random);
    stains(ctx, size, "#102030", 4, 26, 0.2, random);
    scratches(ctx, size, 12, random, "rgba(255,255,255,.14)");
    crack(ctx, size, random, 0.2);
  },
  wet(ctx, size, random) {
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 6, 30, 0.3, random);
    stains(ctx, size, "#9fc8d8", 3, 22, 0.14, random);
    crack(ctx, size, random, 0.3);
    seams(ctx, size, random);
  },
  alien(ctx, size, random) {
    grain(ctx, size, 8, random);
    ctx.strokeStyle = "rgba(200,210,255,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(random() * size, 0);
      ctx.bezierCurveTo(random() * size, size / 3, random() * size, (size * 2) / 3, random() * size, size);
      ctx.stroke();
    }
    stains(ctx, size, "#000000", 4, 34, 0.25, random);
  },
};

const pipeAcross = (ctx, size, y, thick) => {
  const pipe = ctx.createLinearGradient(0, y, 0, y + thick);
  pipe.addColorStop(0, "rgba(255,255,255,.16)");
  pipe.addColorStop(0.35, "rgba(255,255,255,.04)");
  pipe.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = pipe;
  ctx.fillRect(0, y, size, thick);
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.fillRect(0, y + thick, size, 2);
};

// One tile's length of each wall, the height of a wall.
const WALLS = {
  panels(ctx, size, random, variant) {
    grain(ctx, size, 14, random);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, 1, size);
    ctx.fillRect(size / 2, 0, 1, size);
    ctx.fillRect(0, size * 0.34, size, 2);
    ctx.fillRect(0, size * 0.72, size, 2);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    ctx.fillRect(0, size * 0.72, size, size * 0.28);
    for (let x = 6; x < size; x += 20) {
      rivet(ctx, x, size * 0.34 + 5);
      rivet(ctx, x, size * 0.72 + 5);
    }
    pipeAcross(ctx, size, size * 0.1, 9);
    if (variant === 1) pipeAcross(ctx, size, size * 0.21, 5);
    stains(ctx, size, RUST, 3, 18, 0.22, random);
    for (let i = 0; i < 5; i += 1) {
      const x = random() * size;
      const y = size * (0.3 + random() * 0.4);
      const run = ctx.createLinearGradient(0, y, 0, y + 34);
      run.addColorStop(0, see(RUST, 0.4));
      run.addColorStop(1, see(RUST, 0));
      ctx.fillStyle = run;
      ctx.fillRect(x, y, 2 + random() * 3, 34);
    }
    if (variant === 2) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(size * 0.58, size * 0.42, size * 0.3, size * 0.2);
      ctx.fillStyle = "rgba(180,220,200,.28)";
      ctx.fillRect(size * 0.6, size * 0.44, size * 0.1, size * 0.04);
    }
  },
  hull(ctx, size, random) {
    grain(ctx, size, 20, random);
    stains(ctx, size, RUST, 8, 26, 0.34, random);
    stains(ctx, size, "#000000", 5, 24, 0.3, random);
    for (let i = 0; i < 2; i += 1) {
      const x = random() * size * 0.6;
      const y = random() * size * 0.6;
      const w = size * (0.25 + random() * 0.3);
      const h = size * (0.2 + random() * 0.3);
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},.06)`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
    pipeAcross(ctx, size, size * 0.15, 7);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0, 0, 1, size);
  },
  concrete(ctx, size, random) {
    grain(ctx, size, 24, random);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    for (let y = size / 4; y < size; y += size / 4) ctx.fillRect(0, y, size, 1);
    stains(ctx, size, "#000000", 6, 24, 0.22, random);
    for (let i = 0; i < 5; i += 1) {
      const x = random() * size;
      const run = ctx.createLinearGradient(0, 0, 0, size);
      run.addColorStop(0, "rgba(0,0,0,.25)");
      run.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = run;
      ctx.fillRect(x, 0, 2 + random() * 5, size * (0.4 + random() * 0.6));
    }
    crack(ctx, size, random);
  },
  rock(ctx, size, random) {
    grain(ctx, size, 36, random);
    stains(ctx, size, "#000000", 12, 26, 0.32, random);
    stains(ctx, size, "#ffffff", 5, 16, 0.06, random);
    for (let i = 0; i < 5; i += 1) crack(ctx, size, random, 0.4);
  },
  brick(ctx, size, random) {
    const high = size / 8;
    for (let row = 0; row < 8; row += 1) {
      const offset = row % 2 ? size / 6 : 0;
      for (let x = -size / 3 + offset; x < size; x += size / 3) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,200,170" : "0,0,0"},${random() * 0.16})`;
        ctx.fillRect(x, row * high, size / 3, high);
        ctx.fillStyle = "rgba(0,0,0,.5)";
        ctx.fillRect(x, row * high, 1, high);
      }
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, row * high, size, 1);
    }
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 5, 26, 0.2, random);
  },
  wood(ctx, size, random) {
    const plank = size / 5;
    for (let x = 0; x < 5; x += 1) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,220,180" : "0,0,0"},${random() * 0.14})`;
      ctx.fillRect(x * plank, 0, plank, size);
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(x * plank, 0, 1, size);
    }
    ctx.strokeStyle = "rgba(0,0,0,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i += 1) {
      const x = random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + random() * 4 - 2, size / 3, x + random() * 4 - 2, (size * 2) / 3, x, size);
      ctx.stroke();
    }
    grain(ctx, size, 14, random);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, size * 0.14, size, 4);
    ctx.fillRect(0, size * 0.8, size, 4);
  },
  tile(ctx, size, random) {
    const step = size / 6;
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.07})`;
        ctx.fillRect(x * step, y * step, step, step);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,.3)";
    for (let i = 0; i < size; i += step) {
      ctx.fillRect(i, 0, 1, size);
      ctx.fillRect(0, i, size, 1);
    }
    ctx.fillStyle = "rgba(20,50,50,.5)";
    ctx.fillRect(0, size * 0.66, size, size * 0.34);
    grain(ctx, size, 10, random);
    stains(ctx, size, "#2a2418", 4, 22, 0.25, random);
  },
  stone(ctx, size, random) {
    const high = size / 4;
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 ? size / 4 : 0;
      for (let x = -size / 2 + offset; x < size; x += size / 2) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.1})`;
        ctx.fillRect(x, row * high, size / 2, high);
        ctx.fillStyle = "rgba(0,0,0,.5)";
        ctx.fillRect(x, row * high, 2, high);
      }
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, row * high, size, 2);
    }
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 5, 26, 0.18, random);
  },
  ice(ctx, size, random) {
    grain(ctx, size, 12, random);
    stains(ctx, size, "#ffffff", 7, 24, 0.16, random);
    stains(ctx, size, "#102030", 6, 24, 0.24, random);
    for (let i = 0; i < 4; i += 1) crack(ctx, size, random, 0.25);
  },
  alien(ctx, size, random) {
    grain(ctx, size, 8, random);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, size * 0.5, size, size * 0.5);
    ctx.fillStyle = "rgba(190,200,255,.16)";
    ctx.fillRect(0, size * 0.48, size, 2);
    ctx.fillRect(size * 0.3, 0, 1, size);
    stains(ctx, size, "#000000", 4, 28, 0.25, random);
  },
};

// The base color of each, which each room's own colors lean on a little.
export const FLOOR_COLORS = { deck: "#6a6e70", grate: "#5a5c5a", concrete: "#74726a", dirt: "#786650", soil: "#5a4a38", stone: "#74726a", tile: "#8a8e8c", wood: "#7a6044", carpet: "#6e3e46", rock: "#6a6054", ice: "#92a4b2", wet: "#566468", alien: "#62667a" };
export const WALL_COLORS = { panels: "#6e7274", hull: "#74624e", concrete: "#7a7870", rock: "#6a6052", brick: "#7a5a4a", wood: "#725a3e", tile: "#969a98", stone: "#7a7870", ice: "#98a8b4", alien: "#6a6e80" };

const textures = new Map();

// Each one's made once and kept, so that going back to a room is no slower than going there the first time.
function madeOnce(key, make) {
  if (!textures.has(key)) {
    if (textures.size >= MOST_TEXTURES) textures.clear();
    const canvas = newCanvas(128, 128);
    make(canvas.getContext("2d", { willReadFrequently: true }), 128, randomFrom(key));
    textures.set(key, canvas);
  }
  return textures.get(key);
}

function textureFor(kind, table, color, variant = 0) {
  return madeOnce(`${kind}|${color}|${variant}`, (ctx, size, random) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    table[kind](ctx, size, random, variant);
  });
}

function consoleTop(steel, glow) {
  return madeOnce(`console|${steel}|${glow}`, (ctx, size, random) => {
    ctx.fillStyle = scaled(steel, 0.7);
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 2; row += 1) {
      const y = 14 + row * 58;
      ctx.fillStyle = "#050807";
      ctx.fillRect(10, y, 108, 40);
      ctx.fillStyle = see(glow, 0.3 + random() * 0.3);
      ctx.fillRect(13, y + 3, 102, 34);
      ctx.fillStyle = see(glow, 0.65);
      for (let i = 0; i < 5; i += 1) ctx.fillRect(18, y + 7 + i * 6, 20 + random() * 70, 2);
    }
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, 2, size);
  });
}

function crateSide(color) {
  return madeOnce(`crate|${color}`, (ctx, size, random) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    WALLS.wood(ctx, size, random);
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.strokeStyle = scaled(color, 1.1);
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(size - 6, size - 6);
    ctx.stroke();
  });
}

function scrapPile(tint) {
  return madeOnce(`scrap|${tint}`, (ctx, size, random) => {
    ctx.fillStyle = "#26231f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 46; i += 1) {
      const base = random() > 0.5 ? RUST : mix("#5a5e60", tint, 0.2);
      ctx.fillStyle = scaled(base, 0.5 + random() * 0.8);
      ctx.save();
      ctx.translate(random() * size, random() * size);
      ctx.rotate(random() * Math.PI);
      ctx.fillRect(-4 - random() * 14, -2 - random() * 5, 8 + random() * 22, 3 + random() * 8);
      ctx.restore();
    }
  });
}

function materialsFor(scene) {
  const { look, colors } = scene;
  const floorKind = FLOORS[look.floor] ? look.floor : "deck";
  const wallKind = WALLS[look.walls] ? look.walls : "panels";
  const floorColor = tinted(mix(FLOOR_COLORS[floorKind], colors.floor, floorKind === "carpet" ? 0.5 : 0.22), scene.style?.floors);
  const wallColor = tinted(mix(WALL_COLORS[wallKind], colors.walls, 0.14), scene.style?.walls);
  const steel = tinted(mix("#5a5e60", colors.scenery, 0.12), scene.style?.walls && [scene.style.walls[0], scene.style.walls[1] * 0.4]);
  const rock = mix(WALL_COLORS.rock, colors.scenery, 0.2);
  const crate = mix("#7a6040", colors.scenery, 0.1);
  return {
    floor: [0, 1, 2, 3].map((variant) => textureFor(floorKind, FLOORS, floorColor, variant)),
    floorAlt: [0, 1].map((variant) => textureFor(floorKind, FLOORS, scaled(floorColor, 0.78), variant + 8)),
    floorColor,
    wall: [0, 1, 2].map((variant) => textureFor(wallKind, WALLS, wallColor, variant)),
    wallTop: scaled(wallColor, 0.16),
    body: [0, 1].map((variant) => textureFor(wallKind, WALLS, scaled(wallColor, 0.85), variant + 4)),
    roof: textureFor(floorKind === "carpet" || floorKind === "tile" ? "concrete" : floorKind, FLOORS, scaled(wallColor, 0.72), 5),
    steel: textureFor("panels", WALLS, steel, 7),
    steelTop: textureFor("deck", FLOORS, scaled(steel, 0.9), 6),
    console: consoleTop(steel, look.glow),
    consoleOff: consoleTop(steel, "#0e1513"),
    crate: crateSide(crate),
    crateTop: textureFor("wood", FLOORS, crate, 3),
    rock: textureFor("rock", WALLS, rock, 1),
    rockTop: textureFor("rock", FLOORS, scaled(rock, 0.8), 1),
    ice: textureFor("ice", WALLS, WALL_COLORS.ice, 1),
    iceTop: textureFor("ice", FLOORS, FLOOR_COLORS.ice, 1),
    scrap: scrapPile(colors.scenery),
    plant: mix("#4e6e38", colors.scenery, 0.3),
    // A ship's hull outside its walls, and the floor of the passages between its rooms, in its own style.
    style: scene.style ?? null,
    hull: scene.style ? textureFor("plating", FLOORS, scene.style.hull, scene.style.grime > 0.5 ? 1 : 0) : null,
    passage: scene.style ? textureFor(FLOORS[scene.style.passage] ? scene.style.passage : floorKind, FLOORS, scaled(floorColor, 0.9), 2) : null,
  };
}

// ---- Drawing the room ---------------------------------------------------

// Draws in tiles, onto whichever canvas it's given: the kept picture of the room, or the screen itself.
function painterFor(ctx, ratio, unit, ox, oy) {
  const at = (wx, wy, z = 0) => {
    const { u, v } = project(wx, wy, z);
    return [u * unit + ox, v * unit + oy];
  };
  return {
    ctx,
    ratio,
    unit,
    at,
    // Puts the top left corner of an image at one point, with its edges running along two others.
    plane(origin, across, down) {
      ctx.setTransform(
        ratio * (across[0] - origin[0]),
        ratio * (across[1] - origin[1]),
        ratio * (down[0] - origin[0]),
        ratio * (down[1] - origin[1]),
        ratio * origin[0],
        ratio * origin[1],
      );
    },
    flat() {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
  };
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

// Draws an image on a side of something, the right way up, with less light towards the floor.
function drawSide(painter, image, source, top, bottom, darkness, sink) {
  const { ctx } = painter;
  const from = Math.max(0, 128 * (1 - top / WALL_HEIGHT));
  const high = Math.min(128 - from, Math.max(1, 128 * ((top - bottom) / WALL_HEIGHT)));
  ctx.drawImage(image, source[0], from, source[1], high, 0, 0, 1.01, 1);
  const shade = ctx.createLinearGradient(0, 0, 0, 1);
  shade.addColorStop(0, `rgba(0,0,0,${darkness})`);
  shade.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, darkness + sink)})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1.01, 1);
  painter.flat();
}

// The side of something that faces down and to the left of the screen.
function leftFace(painter, image, x, y, top, bottom, darkness) {
  const { at, plane } = painter;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  plane(at(x0, y + 1, top), at(x1, y + 1, top), at(x0, y + 1, bottom));
  drawSide(painter, image, [(x % 2) * 64, 64], top, bottom, darkness, 0.38);
}

// The side of something that faces down and to the right of the screen.
function rightFace(painter, image, x, y, top, bottom, darkness) {
  const { at, plane } = painter;
  const x1 = (x + 1) * CELL_WIDTH;
  plane(at(x1, y + 1, top), at(x1, y, top), at(x1, y + 1, bottom));
  drawSide(painter, image, [0, 128], top, bottom, darkness, 0.3);
}

function topFace(painter, image, x, y, h, overlay = 0) {
  const { ctx, at, plane, flat } = painter;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  plane(at(x0, y, h), at(x1, y, h), at(x0, y + 1, h));
  ctx.drawImage(image, (x % 2) * 64, 0, 64, 128, 0, 0, 1.01, 1.01);
  if (overlay) {
    ctx.fillStyle = `rgba(0,0,0,${overlay})`;
    ctx.fillRect(0, 0, 1.01, 1.01);
  }
  flat();
}

// A great wheel on its dais, the sort people bet on, as round as a wheel ought to be.
function drawWheel(painter, block) {
  const { ctx, at, plane, flat } = painter;
  const { wx, wy, radius, h } = block;
  const onLevel = (z) => plane(at(wx - radius, wy - radius, z), at(wx + radius, wy - radius, z), at(wx - radius, wy + radius, z));
  const disc = (r, color) => {
    ctx.beginPath();
    ctx.arc(0.5, 0.5, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  for (let z = DAIS_HEIGHT; z < h; z += 0.03) {
    onLevel(z);
    disc(0.5, "#3e2e12");
  }
  onLevel(h);
  disc(0.5, "#8a6a24");
  const slices = 24;
  for (let i = 0; i < slices; i += 1) {
    const from = (i / slices) * Math.PI * 2;
    const to = ((i + 1) / slices) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0.5, 0.5);
    ctx.arc(0.5, 0.5, 0.46, from, to);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? "#2a5a30" : i % 2 ? "#6a1c18" : "#141210";
    ctx.fill();
    ctx.strokeStyle = "#c8a040";
    ctx.lineWidth = 0.004;
    ctx.stroke();
  }
  ctx.strokeStyle = "#e0bc58";
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.46, 0, Math.PI * 2);
  ctx.stroke();
  disc(0.27, "#5a4020");
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.3;
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(0.5 + Math.cos(angle) * 0.27, 0.5 + Math.sin(angle) * 0.27);
  }
  ctx.stroke();
  disc(0.06, "#e8c868");
  disc(0.025, "#5a4020");
  flat();
}

// Clutter in the corners nobody can walk into: drums, boxes and sacks.
function drawJunk(painter, cell) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
  const kind = (cell.seed * 97) % 1;
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath();
  ctx.ellipse(x, y, unit * 0.13, unit * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind < 0.4) {
    const wide = unit * 0.095;
    const high = unit * 0.25;
    const body = ctx.createLinearGradient(x - wide, 0, x + wide, 0);
    body.addColorStop(0, "#5a4a36");
    body.addColorStop(0.45, "#6e5438");
    body.addColorStop(1, "#2a2218");
    ctx.fillStyle = body;
    ctx.fillRect(x - wide, y - high, wide * 2, high);
    ctx.beginPath();
    ctx.ellipse(x, y, wide, wide * 0.45, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#35291c";
    ctx.beginPath();
    ctx.ellipse(x, y - high, wide, wide * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(x - wide, y - high * 0.62, wide * 2, 1);
    ctx.fillRect(x - wide, y - high * 0.3, wide * 2, 1);
  } else if (kind < 0.75) {
    const x0 = (cell.x + 0.12) * CELL_WIDTH;
    const x1 = (cell.x + 0.88) * CELL_WIDTH;
    const y0 = cell.y + 0.25;
    const y1 = cell.y + 0.75;
    const h = 0.22 + kind * 0.2;
    polygon(ctx, [at(x1, y0, h), at(x1, y1, h), at(x1, y1), at(x1, y0)], "#2c2418");
    polygon(ctx, [at(x0, y1, h), at(x1, y1, h), at(x1, y1), at(x0, y1)], "#463a26");
    polygon(ctx, [at(x0, y0, h), at(x1, y0, h), at(x1, y1, h), at(x0, y1, h)], "#5e4e34");
  } else {
    ctx.fillStyle = "#4e4634";
    ctx.beginPath();
    ctx.ellipse(x, y - unit * 0.05, unit * 0.12, unit * 0.075, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(x + unit * 0.03, y - unit * 0.025, unit * 0.09, unit * 0.045, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A lamp's housing, on the wall.
function drawFixture(painter, fixture) {
  // In the pixel-art view the lamp is the pack's strip light (public/pixel-art.js).
  if (drawPixelFixture(painter, fixture, { cellWidth: CELL_WIDTH, high: WALL_HEIGHT * 0.72 })) return;
  const { ctx } = painter;
  const { left, right, top, bottom } = fixtureCorners(painter, fixture);
  ctx.beginPath();
  ctx.moveTo(...left);
  ctx.lineTo(...right);
  ctx.lineTo(...bottom);
  ctx.lineTo(...top);
  ctx.closePath();
  ctx.fillStyle = "#14130f";
  ctx.fill();
  ctx.strokeStyle = fixture.off ? "rgba(255,245,225,.08)" : "rgba(255,245,225,.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Where a lamp is, on whichever side of the wall faces the room.
function fixtureCorners(painter, { x, y, face }) {
  const { at } = painter;
  const z = WALL_HEIGHT * 0.72;
  const high = 0.12;
  if (face === "left") {
    const wy = y + 1;
    const from = (x + 0.15) * CELL_WIDTH;
    const to = (x + 0.85) * CELL_WIDTH;
    return { left: at(from, wy, z + high), right: at(to, wy, z + high), bottom: at(to, wy, z), top: at(from, wy, z), middle: at((from + to) / 2, wy, z + high / 2) };
  }
  const wx = (x + 1) * CELL_WIDTH;
  return { left: at(wx, y + 0.8, z + high), right: at(wx, y + 0.2, z + high), bottom: at(wx, y + 0.2, z), top: at(wx, y + 0.8, z), middle: at(wx, y + 0.5, z + high / 2) };
}

// Which way a doorway runs: along the screen's width ("x") where it's in a wall with wall to its left or right, else
// down it ("y").
function doorAlong(kinds, x, y) {
  const at = (dx, dy) => kinds[y + dy]?.[x + dx];
  // A doorway two squares wide has a door beside it, and the wall past that.
  const walled = (dx, dy) => at(dx, dy) === "wall" || (at(dx, dy) === "door" && at(dx * 2, dy * 2) === "wall");
  const across = walled(-1, 0) || walled(1, 0);
  const down = walled(0, -1) || walled(0, 1);
  return across || !down ? "x" : "y";
}

const PLANT_COLORS = ["#6a8a44", "#54763a", "#7a9650", "#465f30"];

// A bed in a garden goes through five stages (turned earth, seedlings, leaves, flowers, fruit) and round again, a stage
// each time the garden has given what it grows GROW_EVERY times, so only while it's working; each bed starts at a stage
// of its own, by where it is.
export const GROW_STAGES = 5;
export const GROW_EVERY = 6;
export const growthStage = (made, x, y) => (Math.floor(Math.max(0, made) / GROW_EVERY) + Math.floor(hashOf(x * 11 + 3, y * 17 + 5) * GROW_STAGES)) % GROW_STAGES;

function drawPlants(painter, block, color) {
  const { ctx, at, unit } = painter;
  ctx.lineWidth = Math.max(1, unit * 0.022);
  ctx.lineCap = "round";
  const random = randomFrom(`${block.x},${block.y}`);
  // A bed nobody grows anything in is drawn as it always was; a garden's bed by its stage, from turned earth to fruit.
  const stage = block.growth;
  const count = stage === undefined ? 7 : [2, 5, 7, 8, 8][stage];
  const [least, more] = stage === undefined ? [0.14, 0.14] : [[0.025, 0.02], [0.05, 0.04], [0.1, 0.08], [0.15, 0.12], [0.16, 0.12]][stage];
  if (stage === 0) {
    ctx.strokeStyle = "rgba(34,24,14,.6)";
    for (const across of [0.3, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(...at((block.x + 0.12) * CELL_WIDTH, block.y + across));
      ctx.lineTo(...at((block.x + 0.88) * CELL_WIDTH, block.y + across));
      ctx.stroke();
    }
  }
  for (let i = 0; i < count; i += 1) {
    const [x, y] = at((block.x + 0.1 + random() * 0.8) * CELL_WIDTH, block.y + 0.1 + random() * 0.8);
    const lean = (random() - 0.5) * unit * 0.1;
    const high = unit * (least + random() * more);
    ctx.strokeStyle = mix(PLANT_COLORS[Math.floor(random() * PLANT_COLORS.length)], color, 0.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x, y - high * 0.6, x + lean, y - high);
    ctx.stroke();
    // Flowers, and then fruit, at the tips.
    if (stage >= 3) {
      ctx.fillStyle = stage === 3 ? "#e6dfb4" : random() > 0.5 ? "#d4472f" : "#e6a232";
      ctx.beginPath();
      ctx.arc(x + lean, y - high, Math.max(1, unit * (stage === 3 ? 0.012 : 0.019)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBlock(painter, block, materials) {
  const { ctx, at, unit } = painter;
  const { x, y, h, style } = block;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  if (style === "piece") {
    // The pixel-art test draws the pack's piece where it has one like it (public/pixel-art.js).
    if (!drawPixelPiece(painter, block, { wallHeight: WALL_HEIGHT, ...lookOfPiece(block) })) drawPiece(painter, block);
    return;
  }
  if (style === "plants") {
    drawPlants(painter, block, materials.plant);
    return;
  }
  if (style === "wheel") {
    drawWheel(painter, block);
    return;
  }
  if (style === "wall") {
    // A wall its full height, in the pixel-art test, is the pack's: whether the squares beside it show the same face
    // says whether a tile's two halves are drawn as one (public/pixel-art.js).
    if (h === WALL_HEIGHT && pixelArtOn()) {
      const { heights, styles } = iso.scene;
      const fullWall = (wx) => styles[y]?.[wx] === "wall" && heights[y]?.[wx] === WALL_HEIGHT && (heights[y + 1]?.[wx] ?? 0) < WALL_HEIGHT;
      // Each face is in the look of the room it's a wall of: the one in front of it.
      const lit = iso.scene.light;
      const faces = (wx) => Boolean(lit?.[y + 1]?.[wx]);
      if (drawPixelWall(painter, block, { cellWidth: CELL_WIDTH, sameWallRight: fullWall(x + 1) && faces(x + 1) === faces(x), sameWallLeft: fullWall(x - 1) && faces(x - 1) === faces(x), ...(faces(x) ? { lookLeft: "light" } : {}), ...(lit?.[y]?.[x + 1] ? { lookRight: "light" } : {}) })) {
        // Pipes and cables run along stretches of bare wall: a face that looks into a room, with nothing hung on it
        // or on the wall either side of it, and the same wall going on both ways (so never across a corner or a door).
        const { kinds, fitted } = iso.scene;
        const bare = (wx, wy) => styles[wy]?.[wx] === "wall" && heights[wy]?.[wx] === WALL_HEIGHT && !fitted?.has(`${wx},${wy}`);
        const room = (fx, fy) => seeThrough(kinds[fy]?.[fx]);
        const south = [x - 1, x, x + 1].every((wx) => bare(wx, y) && room(wx, y + 1));
        const east = [y - 1, y, y + 1].every((wy) => bare(x, wy) && room(x + 1, wy));
        if (south || east) drawPixelWallRun(painter, block, { cellWidth: CELL_WIDTH, south, east });
        return;
      }
    }
    // A wall cut down so the room can be seen, in the pixel-art view, is the pack's low wall on a sill; in the look of
    // the room it's cut down to show.
    if (h === CUT_WALL_HEIGHT) {
      const lit = iso.scene?.light;
      if (drawPixelLowWall(painter, block, { cellWidth: CELL_WIDTH, wallAt: (wx, wy) => iso.scene?.kinds[wy]?.[wx] === "wall", ...(lit?.[y - 1]?.[x] || lit?.[y]?.[x - 1] ? { look: "light" } : {}) })) return;
    }
    const image = materials.wall[Math.floor(hashOf(Math.floor(x / 2), y) * 3)];
    if (block.left < h) leftFace(painter, image, x, y, h, block.left, 0.05);
    if (block.right < h) rightFace(painter, image, x, y, h, block.right, 0.42);
    if (materials.style) drawWallDetail(painter, block, materials.style);
    polygon(ctx, [at(x0, y, h), at(x1, y, h), at(x1, y + 1, h), at(x0, y + 1, h)], materials.wallTop);
    // A worn edge, so that the top reads as the cut end of a thick wall.
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,245,225,.16)";
    ctx.lineWidth = 1;
    if (block.left < h) {
      ctx.moveTo(...at(x0, y + 1, h));
      ctx.lineTo(...at(x1, y + 1, h));
    }
    if (block.right < h) {
      ctx.moveTo(...at(x1, y, h));
      ctx.lineTo(...at(x1, y + 1, h));
    }
    ctx.stroke();
    return;
  }
  if (style === "stairs") {
    // A deck's stairs are the pack's in the pixel-art view (public/pixel-art.js); in any other, the row of posts.
    drawPixelStairs(painter, block, block.light ? { look: "light" } : {});
    return;
  }
  // What only the pixel-art view draws: a rail round an engine, a tank standing in its heart.
  if (style === "rail") {
    drawPixelRail(painter, block, { cellWidth: CELL_WIDTH });
    return;
  }
  if (style === "tank") {
    drawPixelTank(painter, block, { cellWidth: CELL_WIDTH });
    return;
  }
  if (style === "stood") {
    drawPixelStood(painter, block);
    return;
  }
  if (style === "post") {
    // The posts of a stair give way to the pack's stairs in the pixel-art view.
    if (block.stair && pixelArtOn()) return;
    // Any other is the packs' locker there, its door toward the floor in front of it, or the floor to its right.
    const floorAt = (fx, fy) => walkable(iso.scene?.kinds[fy]?.[fx]);
    // (An upright one only: a brace drawn slanting stays a brace.)
    if (block.mark === "|" && drawPixelPost(painter, block, { cellWidth: CELL_WIDTH, flip: !floorAt(x, y + 1) && floorAt(x + 1, y) })) return;
    // Thinner than the square it's on, and round, as far as anyone can tell at this size.
    const inset = 0.09;
    const left = x0 + inset;
    const right = x1 - inset;
    const back = y + inset * 2;
    const front = y + 1 - inset * 2;
    polygon(ctx, [at(right, back, h), at(right, front, h), at(right, front), at(right, back)], "#20211f");
    polygon(ctx, [at(left, front, h), at(right, front, h), at(right, front), at(left, front)], "#3a3c38");
    polygon(ctx, [at(left, back, h), at(right, back, h), at(right, front, h), at(left, front, h)], "#55574f");
    return;
  }
  if (style === "lamp") {
    const [lx, ly] = at(x0 + CELL_WIDTH / 2, y + 0.5);
    ctx.fillStyle = "#26261f";
    ctx.fillRect(lx - 1, ly - unit * 0.42, 2, unit * 0.42);
    ctx.fillStyle = "#ffe0a0";
    ctx.beginPath();
    ctx.arc(lx, ly - unit * 0.44, Math.max(1.5, unit * 0.035), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (style === "crate" && drawPixelCrate(painter, block, { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT, ...(iso.scene?.light?.[y]?.[x] ? { look: "light" } : {}) })) return;
  // In the pixel-art view a big machine is the pack's pumps or a length of dark hull, the round thing between two pumps
  // a tank, and a heap of scrap its drums and cases (public/pixel-art.js).
  if (block.tank && drawPixelTank(painter, block, { cellWidth: CELL_WIDTH })) return;
  if (style === "scrap" && drawPixelScrap(painter, block, { cellWidth: CELL_WIDTH })) return;
  if (style === "machine" && block.big) {
    const { heights, big } = iso.scene ?? {};
    const hull = (wx) => big?.get(`${wx},${y}`) === "hull" && heights?.[y]?.[wx] === h && (heights?.[y + 1]?.[wx] ?? 0) < h;
    if (drawPixelBigMachine(painter, block, { cellWidth: CELL_WIDTH, flip: block.heartSide === "w", sameRight: hull(x + 1), sameLeft: hull(x - 1) })) return;
  }
  // A console of the plan, in the pixel-art view, is the pack's (public/pixel-art.js).
  if (style === "machine" && drawPixelMachine(painter, block, { cellWidth: CELL_WIDTH, isMachine: (mx, my) => iso.scene?.styles[my]?.[mx] === "machine", floorAt: (fx, fy) => walkable(iso.scene?.kinds[fy]?.[fx]) })) return;
  const side = { crate: materials.crate, rock: materials.rock, ice: materials.ice, scrap: materials.scrap, body: materials.body[Math.floor(block.seed * 2)], bench: materials.body[Math.floor(block.seed * 2)], dais: materials.body[0] }[style] ?? materials.steel;
  const top = { crate: materials.crateTop, machine: block.off ? materials.consoleOff : materials.console, rock: materials.rockTop, ice: materials.iceTop, scrap: materials.scrap, body: materials.roof, bench: materials.roof, dais: materials.roof }[style] ?? materials.steelTop;
  if (block.left < h) leftFace(painter, side, x, y, h, block.left, 0.08);
  if (block.right < h) rightFace(painter, side, x, y, h, block.right, 0.4);
  topFace(painter, top, x, y, h, style === "body" ? 0.12 : 0);
}

// A way out, as a door in the wall if there's a wall it can be in.
function drawDoor(painter, item) {
  const { ctx, at } = painter;
  const { exit, along, tall } = item;
  const x0 = exit.x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  const y0 = exit.y;
  const y1 = y0 + 1;
  const high = tall ? WALL_HEIGHT * 0.86 : 0;
  // A way out in a wall, in the pixel-art test, is the pack's door, shut and red when it's locked.
  if (tall && drawPixelDoor(painter, { x: exit.x, y: exit.y, along, kinds: iso.scene?.kinds }, exit.closed ? 0 : 1, { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT, locked: !!exit.closed })) return;
  if (!tall) {
    if (exit.closed) {
      polygon(ctx, [at(x0, y0 + 0.42, 0.75), at(x1, y0 + 0.42, 0.75), at(x1, y0 + 0.58, 0.75), at(x0, y0 + 0.58, 0.75)], "#6e3a2c");
      polygon(ctx, [at(x0, y0 + 0.58, 0.75), at(x1, y0 + 0.58, 0.75), at(x1, y0 + 0.58), at(x0, y0 + 0.58)], "#46251c");
    }
    return;
  }
  const opening = along === "x"
    ? [at(x0, y0, high), at(x1, y0, high), at(x1, y0), at(x0, y0)]
    : [at(x0, y1, high), at(x0, y0, high), at(x0, y0), at(x0, y1)];
  polygon(ctx, opening, exit.closed ? "#3c2a22" : "#050605");
  ctx.strokeStyle = exit.closed ? "#a05840" : "#8a8a78";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(...opening[3]);
  ctx.lineTo(...opening[0]);
  ctx.lineTo(...opening[1]);
  ctx.lineTo(...opening[2]);
  ctx.stroke();
  if (exit.closed) {
    ctx.beginPath();
    ctx.moveTo(...opening[0]);
    ctx.lineTo(...opening[2]);
    ctx.moveTo(...opening[1]);
    ctx.lineTo(...opening[3]);
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.stroke();
  }
}

// On a ship, what runs along a wall's faces: a pipe or two part way up, the same along the whole of a wall, and a
// strip of light at the top, where the room it looks into has its lights on.
function drawWallDetail(painter, block, style) {
  const { ctx, at } = painter;
  const { x, y, h } = block;
  if (h < WALL_HEIGHT) return;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  const band = (points, color) => polygon(ctx, points, color);
  const pipe = (a, b, z) => {
    const t = 0.1;
    band([at(...a, z + t), at(...b, z + t), at(...b, z), at(...a, z)], scaled(style.pipe, 0.95));
    band([at(...a, z + t), at(...b, z + t), at(...b, z + t * 0.6), at(...a, z + t * 0.6)], see("#ffffff", 0.14));
    band([at(...a, z + t * 0.25), at(...b, z + t * 0.25), at(...b, z), at(...a, z)], see("#000000", 0.3));
  };
  const strip = (a, b, lit) => {
    const z = WALL_HEIGHT - 0.18;
    if (!lit) {
      band([at(...a, z + 0.07), at(...b, z + 0.07), at(...b, z), at(...a, z)], "#1a1c1a");
      return;
    }
    band([at(...a, z + 0.07), at(...b, z + 0.07), at(...b, z), at(...a, z)], style.strip);
    band([at(...a, z), at(...b, z), at(...b, z - 0.14), at(...a, z - 0.14)], see(style.strip, 0.24));
  };
  // As the ship wears, rust runs down from the pipes and the foot of the walls goes dark (scene.wear, src/wear.js).
  const grime = iso.scene?.wear?.grime ?? 0;
  const rust = (a, b, seed) => {
    if (!grime) return;
    band([at(...a, 0.3), at(...b, 0.3), at(...b, 0), at(...a, 0)], see("#140f0a", 0.16 + grime * 0.08));
    if (seed > 1 - grime * 0.22) {
      const t = 0.25 + (seed * 7 % 0.5);
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const q = [a[0] + (b[0] - a[0]) * (t + 0.08), a[1] + (b[1] - a[1]) * (t + 0.08)];
      band([at(...p, 1.18), at(...q, 1.18), at(...q, 0.35 + seed * 0.3), at(...p, 0.25 + seed * 0.3)], see("#7a4424", 0.22 + grime * 0.08));
    }
  };
  // Along a row, the walls' faces that look down the screen; along a column, the ones that look right.
  if (block.left < h) {
    const a = [x0, y + 1];
    const b = [x1, y + 1];
    rust(a, b, hashOf(x * 3 + 5, y * 7 + 1));
    if (hashOf(y, 7) < style.pipes) pipe(a, b, 1.18);
    if (hashOf(y, 7) < style.pipes * 0.5) pipe(a, b, 1.3);
    if (hashOf(y, 13) < style.strips) strip(a, b, block.litLeft);
  }
  if (block.right < h) {
    const a = [x1, y + 1];
    const b = [x1, y];
    rust(a, b, hashOf(x * 5 + 2, y * 3 + 9));
    if (hashOf(x, 11) < style.pipes) pipe(a, b, 1.18);
    if (hashOf(x, 11) < style.pipes * 0.5) pipe(a, b, 1.3);
    if (hashOf(x, 17) < style.strips) strip(a, b, block.litRight);
  }
}

// A bulkhead door where a wall opens into the next room: two posts, a lintel with a stripe along it, and a sill.
function drawFrame(painter, item, style) {
  const { ctx, at } = painter;
  const { x, y, along } = item;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  const y0 = y;
  const y1 = y0 + 1;
  const high = WALL_HEIGHT * 0.94;
  const post = 0.14;
  const lintel = 0.16;
  const face = (points, color) => polygon(ctx, points, color);
  if (along === "x") {
    // The opening runs along the screen's width, in the plane at the back of the square.
    const px = CELL_WIDTH * post;
    face([at(x0, y0, 0.02), at(x1, y0, 0.02), at(x1, y0 + 0.14, 0.02), at(x0, y0 + 0.14, 0.02)], scaled(style.frame, 0.6));
    face([at(x0, y0, high), at(x0 + px, y0, high), at(x0 + px, y0), at(x0, y0)], scaled(style.frame, 0.9));
    face([at(x1 - px, y0, high), at(x1, y0, high), at(x1, y0), at(x1 - px, y0)], scaled(style.frame, 0.75));
    face([at(x0, y0, high), at(x1, y0, high), at(x1, y0, high - lintel), at(x0, y0, high - lintel)], style.frame);
    face([at(x0, y0, high - lintel), at(x1, y0, high - lintel), at(x1, y0, high - lintel - 0.04), at(x0, y0, high - lintel - 0.04)], style.trim);
    return;
  }
  // The opening runs down the screen, in the plane at the square's left side.
  const py = post;
  face([at(x0, y0, 0.02), at(x0 + CELL_WIDTH * 0.14, y0, 0.02), at(x0 + CELL_WIDTH * 0.14, y1, 0.02), at(x0, y1, 0.02)], scaled(style.frame, 0.6));
  face([at(x0, y1, high), at(x0, y1 - py, high), at(x0, y1 - py), at(x0, y1)], scaled(style.frame, 0.75));
  face([at(x0, y0 + py, high), at(x0, y0, high), at(x0, y0), at(x0, y0 + py)], scaled(style.frame, 0.6));
  face([at(x0, y1, high), at(x0, y0, high), at(x0, y0, high - lintel), at(x0, y1, high - lintel)], scaled(style.frame, 0.85));
  face([at(x0, y1, high - lintel), at(x0, y0, high - lintel), at(x0, y0, high - lintel - 0.04), at(x0, y1, high - lintel - 0.04)], scaled(style.trim, 0.9));
}

// What each kind of part looks like: how high on the wall it hangs, how much of the square it takes, and its colors.
const PART_LOOKS = {
  "junction box": { z0: 0.55, z1: 0.95, inset: 0.08, color: "#666a64", trim: "#d8b030" },
  "air plant": { z0: 0.08, z1: 1.25, inset: 0, color: "#4c5450", trim: "#88a0a0" },
  vent: { z0: 0.12, z1: 0.42, inset: 0.08, color: "#30343a", trim: "#8a9298" },
  "light switch": { z0: 0.7, z1: 0.86, inset: 0.32, color: "#b8b0a0", trim: "#605848" },
  camera: { z0: 1.32, z1: 1.52, inset: 0.24, color: "#242628", trim: "#9aa0a6" },
  speaker: { z0: 1.16, z1: 1.42, inset: 0.2, color: "#463e3a", trim: "#a83228" },
  relay: { z0: 0.35, z1: 1.2, inset: 0.06, color: "#2a3234", trim: "#60d090" },
  console: { z0: 0.6, z1: 1.02, inset: 0.05, color: "#1c2220", trim: "#3fbf8f" },
  engines: { z0: 0.06, z1: 1.4, inset: 0, color: "#58483a", trim: "#d07038" },
  "nav core": { z0: 0.4, z1: 1.3, inset: 0.06, color: "#283240", trim: "#6aa0e0" },
  "docking clamps": { z0: 0.3, z1: 1.1, inset: 0.06, color: "#5a5840", trim: "#c8b860" },
  "door panel": { z0: 0.62, z1: 0.98, inset: 0.3, color: "#26292b", trim: "#6fe08a" },
  machine: { z0: 0.4, z1: 1, inset: 0.08, color: "#58584e", trim: "#a0a090" },
};
const PART_WORDS = { "junction box": "power", "air plant": "air plant", vent: "vent", "light switch": "lights", camera: "camera", speaker: "alarm", relay: "comms", console: "console", engines: "engines", "nav core": "nav", "docking clamps": "clamps", "door panel": "keypad", machine: "machine" };
const partLook = (thing) => PART_LOOKS[thing.part.kind] ?? PART_LOOKS.machine;

// The face a part is on: the front of its wall facing the room, or the front of the unit it stands on. Corners go
// top left, top right, bottom right, bottom left, and point(u, v) finds a spot across and down it.
function partFace(painter, thing, z0, z1, inset) {
  const { at } = painter;
  const { x, y } = thing;
  let corners;
  if (thing.part.mount === "wall" && thing.part.face === "side") {
    const wx = (x + 1) * CELL_WIDTH;
    corners = [at(wx, y + 1 - inset, z1), at(wx, y + inset, z1), at(wx, y + inset, z0), at(wx, y + 1 - inset, z0)];
  } else {
    const wy = thing.part.mount === "wall" ? y + 1 : y + 0.78;
    const from = (x + Math.max(inset, thing.part.mount === "wall" ? 0 : 0.16)) * CELL_WIDTH;
    const to = (x + 1 - Math.max(inset, thing.part.mount === "wall" ? 0 : 0.16)) * CELL_WIDTH;
    corners = [at(from, wy, z1), at(to, wy, z1), at(to, wy, z0), at(from, wy, z0)];
  }
  const [tl, tr, br, bl] = corners;
  const point = (u, v) => {
    const top = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u];
    const bottom = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u];
    return [top[0] + (bottom[0] - top[0]) * v, top[1] + (bottom[1] - top[1]) * v];
  };
  return { corners, point };
}

// What the game still puts on a part the pack draws (public/pixel-art.js), to show how it stands: a junction box's
// light and the slash across one that's cut, the tape over a sealed vent, the cloth over a covered camera, and the
// colour of a keypad's screen (green, red once its door is locked, dark with no power).
const UNIT_LIGHTS = { relay: "#60d090", "nav core": "#6aa0e0", "air plant": "#88c0c0", engines: "#d07038" };
function drawPartMarks(painter, thing, { at: [px, py], turn }) {
  const { ctx, unit } = painter;
  const { kind, word, works, locked } = thing.part;
  const dot = (dx, dy, r, colour) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(px + dx * unit * turn, py + dy * unit, Math.max(1, r * unit), 0, Math.PI * 2);
    ctx.fill();
  };
  const slash = (colour, width) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px - unit * 0.07, py + unit * 0.06);
    ctx.lineTo(px + unit * 0.07, py - unit * 0.06);
    ctx.stroke();
    ctx.lineCap = "butt";
  };
  if (kind === "junction box") {
    dot(0.085, -0.045, 0.014, works ? "#60d070" : "#5a1a14");
    if (word === "cut") slash("#d04030", 2);
  } else if (kind === "vent" && word === "sealed") slash("#8a7a50", Math.max(3, unit * 0.06));
  else if (kind === "camera" && word === "covered") dot(0, 0, 0.06, "#7a7466");
  else if (kind === "door panel") dot(0, 0, 0.028, !works ? "rgba(8,10,10,.85)" : locked ? "rgba(220,60,40,.8)" : "rgba(110,224,138,.75)");
  else if (kind === "speaker" && word === "cut") slash("#c8c0b0", 1.5);
  // A big unit has one light over it: its own colour while it works, amber if it's jammed, dark red if it's dead.
  else if (UNIT_LIGHTS[kind]) dot(0, 0, 0.016, works ? UNIT_LIGHTS[kind] : word === "jammed" ? "#d8a040" : "#5a1a14");
}

function drawPart(painter, thing) {
  // In the pixel-art view a part on a wall is the pack's fitting where it has one, with the game's marks over it.
  if (cameraTurns(thing.part) && drawPixelPart(painter, thing, { cellWidth: CELL_WIDTH, draw: false })) return;
  const fitted = drawPixelPart(painter, thing, { cellWidth: CELL_WIDTH });
  if (fitted) {
    drawPartMarks(painter, thing, fitted);
    return;
  }
  const { ctx, at, unit } = painter;
  const look = partLook(thing);
  const { works, word, kind } = thing.part;
  // Where there's no wall, the part stands on a squat unit of its own.
  if (thing.part.mount === "floor") {
    const x0 = thing.x * CELL_WIDTH + 0.08;
    const x1 = x0 + CELL_WIDTH - 0.16;
    const y0 = thing.y + 0.22;
    const y1 = thing.y + 0.78;
    const h = Math.min(1.1, Math.max(0.6, look.z1));
    polygon(ctx, [at(x1, y0, h), at(x1, y1, h), at(x1, y1), at(x1, y0)], scaled(look.color, 0.62));
    polygon(ctx, [at(x0, y1, h), at(x1, y1, h), at(x1, y1), at(x0, y1)], scaled(look.color, 0.85));
    polygon(ctx, [at(x0, y0, h), at(x1, y0, h), at(x1, y1, h), at(x0, y1, h)], scaled(look.color, 1.15));
  }
  const z0 = thing.part.mount === "floor" ? Math.min(0.9, look.z0 * 0.6 + 0.12) : look.z0;
  const z1 = thing.part.mount === "floor" ? Math.min(1.05, Math.max(z0 + 0.18, look.z1 * 0.7)) : look.z1;
  const { corners, point } = partFace(painter, thing, z0, z1, look.inset);
  polygon(ctx, corners, look.color);
  ctx.strokeStyle = "rgba(0,0,0,.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  corners.forEach((one, i) => (i ? ctx.lineTo(...one) : ctx.moveTo(...one)));
  ctx.closePath();
  ctx.stroke();
  const line = (u0, v0, u1, v1, color, width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(...point(u0, v0));
    ctx.lineTo(...point(u1, v1));
    ctx.stroke();
  };
  const patch = (u0, v0, u1, v1, color) => polygon(ctx, [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)], color);
  const dot = (u, v, radius, color) => {
    const [px, py] = point(u, v);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, radius * unit), 0, Math.PI * 2);
    ctx.fill();
  };
  const broken = !works;
  switch (kind) {
    case "junction box":
      patch(0, 0, 1, 0.22, word === "cut" ? "#4a3a20" : look.trim);
      for (let i = 0; i < 4; i += 1) line(0.1 + i * 0.25, 0, 0.0 + i * 0.25, 0.22, "rgba(0,0,0,.6)", 1.5);
      line(0.7, 0.4, 0.7, word === "off" ? 0.85 : 0.5, "#c8c0b0", 2);
      dot(0.25, 0.6, 0.018, works ? "#60d070" : "#3a1a14");
      if (word === "cut") line(0.15, 0.35, 0.85, 0.9, "#d04030", 2);
      break;
    case "vent":
      if (word === "sealed") patch(0.05, 0.1, 0.95, 0.9, "#8a7a50");
      else for (let i = 1; i <= 4; i += 1) line(0.1, i * 0.19, 0.9, i * 0.19, broken ? "#1a1c1e" : look.trim, 1.5);
      break;
    case "light switch":
      line(0.5, 0.5, 0.5, word === "off" ? 0.8 : 0.2, look.trim, 2);
      break;
    case "camera":
      if (word === "covered") patch(0, 0, 1, 1, "#7a7466");
      dot(0.22, 0.5, 0.026, word === "covered" ? "#5a554a" : look.trim);
      break;
    case "speaker":
      dot(0.5, 0.5, 0.05, "#2a2420");
      dot(0.5, 0.5, 0.03, broken ? "#3a2420" : look.trim);
      if (word === "cut") line(0.1, 0.9, 0.9, 0.1, "#c8c0b0", 1.5);
      break;
    case "door panel":
      // A two-line screen, green while its door is open, red once it's locked, over a pad of keys.
      patch(0.12, 0.08, 0.88, 0.34, !works ? "#0c0e0e" : thing.part.locked ? "#c84030" : look.trim);
      for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) dot(0.28 + col * 0.22, 0.5 + row * 0.16, 0.012, works ? "#c8ccc4" : "#3a3c3a");
      break;
    case "relay":
      for (let row = 0; row < 4; row += 1) for (let col = 0; col < 3; col += 1) dot(0.25 + col * 0.25, 0.18 + row * 0.2, 0.012, works ? look.trim : word === "jammed" ? "#d8a040" : "#2a2a26");
      break;
    case "console":
      patch(0.1, 0.12, 0.9, 0.7, works ? scaled(look.trim, 0.8) : "#0c100e");
      if (works) for (let i = 0; i < 3; i += 1) line(0.18, 0.24 + i * 0.13, 0.7 - i * 0.12, 0.24 + i * 0.13, "rgba(220,255,235,.55)", 1);
      break;
    case "air plant":
      for (const u of [0.3, 0.72]) {
        dot(u, 0.42, 0.11, "#2a302e");
        dot(u, 0.42, 0.07, works ? "#6a7e7a" : "#3a403e");
        line(u - 0.12, 0.42, u + 0.12, 0.42, "#1a1e1c", 1.5);
      }
      patch(0.08, 0.78, 0.92, 0.88, works ? look.trim : "#4a3a30");
      break;
    case "engines":
      for (let i = 1; i <= 6; i += 1) line(i * 0.14, 0.1, i * 0.14, 0.9, "rgba(0,0,0,.5)", 1.5);
      patch(0.1, 0.72, 0.9, 0.86, works ? look.trim : "#2a2420");
      break;
    case "nav core":
      for (let i = 1; i <= 5; i += 1) line(0.08, i * 0.16, 0.92, i * 0.16, "rgba(0,0,0,.55)", 1.5);
      for (let i = 0; i < 5; i += 1) dot(0.82, 0.08 + i * 0.16, 0.012, works ? look.trim : "#2a3038");
      break;
    case "docking clamps":
      for (let i = 1; i <= 4; i += 1) line(i * 0.2, 0.05, i * 0.2, 0.95, "rgba(0,0,0,.6)", 1.5);
      line(0.5, 0.75, word === "locked" ? 0.8 : 0.2, 0.3, word === "locked" ? "#d04030" : look.trim, 2.5);
      break;
    default:
      dot(0.5, 0.4, 0.02, works ? "#60d070" : "#3a1a14");
      if (broken) line(0.2, 0.8, 0.8, 0.2, "rgba(0,0,0,.7)", 2);
  }
}

// The pack's camera at one of its sixteen turns, with its red light on its body.
function cameraProp(painter, thing, frame, blink) {
  const fitted = drawPixelPart(painter, thing, { cellWidth: CELL_WIDTH, frame });
  if (!fitted) return;
  const { ctx, unit } = painter;
  ctx.fillStyle = blink ? "#ff3020" : "#5a1810";
  ctx.beginPath();
  ctx.arc(fitted.at[0], fitted.at[1] - unit * 0.035, Math.max(1.2, unit * 0.014), 0, Math.PI * 2);
  ctx.fill();
}

// What moves on a part: a watching camera's red light, a ringing speaker, a screen.
function drawPartLights(painter, now, view) {
  const { ctx, at, unit } = painter;
  for (const thing of view.things ?? []) {
    const part = thing.part;
    if (!part || !part.works) continue;
    if (!painter.seen?.(at((thing.x + 0.5) * CELL_WIDTH, thing.y + 0.5, 1), unit * 2)) continue;
    const look = partLook(thing);
    const floor = part.mount === "floor";
    const z0 = floor ? Math.min(0.9, look.z0 * 0.6 + 0.12) : look.z0;
    const z1 = floor ? Math.min(1.05, Math.max(z0 + 0.18, look.z1 * 0.7)) : look.z1;
    const { corners, point } = partFace(painter, thing, z0, z1, look.inset);
    if (part.kind === "camera") {
      const on = iso.calm || Math.floor(now / 700 + thing.x) % 2 === 0;
      // The pack's camera is drawn with its light every frame, as it turns (cameraProp, below).
      if (drawPixelPart(painter, thing, { cellWidth: CELL_WIDTH, draw: false })) continue;
      const [px, py] = point(0.8, 0.4);
      ctx.fillStyle = on ? "#ff3020" : "#5a1810";
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.2, unit * 0.014), 0, Math.PI * 2);
      ctx.fill();
    } else if (part.kind === "speaker" && part.ringing) {
      const beat = iso.calm ? 0.6 : 0.5 + 0.5 * Math.sin(now / 160);
      ctx.fillStyle = `rgba(255,40,24,${0.35 + beat * 0.5})`;
      // The pack's alarm is a dome, lit red all over while it rings.
      const dome = drawPixelPart(painter, thing, { cellWidth: CELL_WIDTH, draw: false });
      ctx.beginPath();
      if (dome) ctx.arc(dome.at[0], dome.at[1], unit * 0.1, 0, Math.PI * 2);
      else corners.forEach((one, i) => (i ? ctx.lineTo(...one) : ctx.moveTo(...one)));
      ctx.closePath();
      ctx.fill();
    } else if (part.kind === "console") {
      const flicker = iso.calm ? 0.12 : 0.08 + 0.08 * Math.abs(Math.sin(now / 900 + thing.y));
      ctx.fillStyle = `rgba(120,255,200,${flicker})`;
      ctx.beginPath();
      [point(0.1, 0.12), point(0.9, 0.12), point(0.9, 0.7), point(0.1, 0.7)].forEach((one, i) => (i ? ctx.lineTo(...one) : ctx.moveTo(...one)));
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawThing(painter, thing) {
  if (thing.part) {
    drawPart(painter, thing);
    return;
  }
  // A thing that looks like a piece of furniture is drawn as one (furnish, below), not as a box; one of the ship's
  // stores as what's in it, every frame (drawStoreCrates); a container that's a piece of the deck's furniture is that
  // piece, drawn already.
  if (thing.looks || thing.stock?.goods || thing.onPiece) return;
  // In the pixel-art view it's the packs' piece for what its name says it is, or a small case (public/pixel-art.js).
  if (drawPixelThing(painter, thing, { cellWidth: CELL_WIDTH })) return;
  const { ctx, at } = painter;
  const x0 = thing.x * CELL_WIDTH + 0.05;
  const x1 = x0 + CELL_WIDTH - 0.1;
  const y0 = thing.y + 0.2;
  const y1 = thing.y + 0.8;
  const h = 0.3;
  polygon(ctx, [at(x1, y0, h), at(x1, y1, h), at(x1, y1), at(x1, y0)], "#2c2418");
  polygon(ctx, [at(x0, y1, h), at(x1, y1, h), at(x1, y1), at(x0, y1)], "#463a26");
  polygon(ctx, [at(x0, y0, h), at(x1, y0, h), at(x1, y1, h), at(x0, y1, h)], "#6e5c3c");
}

// Words painted along a level, on the floor, along a wall, or on top of something.
function paintWords(painter, text, where) {
  const { ctx, ratio, unit } = painter;
  const size = where.size ?? unit * 0.42;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  const scale = where.length ? (where.length * CELL_WIDTH * unit * 0.5 * 0.92) / Math.max(1, ctx.measureText(text).width) : 1;
  const across = Math.min(scale, 1.1);
  const [px, py] = where.at;
  if (where.upright) ctx.setTransform(ratio * across, ratio * across * 0.5, 0, ratio, ratio * px, ratio * py);
  else ctx.setTransform(ratio * across, ratio * across * 0.5, ratio * -0.72, ratio * 0.36, ratio * px, ratio * py);
  ctx.fillStyle = where.color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Bits of rubbish on the floor. They're only marks: nobody trips over them.
// How much of the floor has rubbish on it, by how cluttered the place is (0 to 3): the share of squares above the mark;
// and how much has grime on it, by how worn (0 to 3). A place nobody says is a 1 for rubbish and has no grime.
const CLUTTER_ABOVE = [0.94, 0.84, 0.74, 0.62];
const GRIME_ABOVE = [1, 0.9, 0.8, 0.68];

function drawLitter(painter, cell, clutter = 1) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
  const random = randomFrom(`litter${cell.x},${cell.y}`);
  const kind = random();
  // Past a point, what's left lying about is the rubbish of people who've stopped caring: cups, trays, rags.
  if (clutter >= 2 && random() < 0.2 + (clutter - 2) * 0.2) {
    drawRubbish(painter, x, y, random);
    return;
  }
  if (kind < 0.4) {
    // A dark stain.
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(x, y, unit * (0.1 + random() * 0.14), unit * (0.05 + random() * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind < 0.7) {
    // Some bits of scrap.
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = random() > 0.5 ? "rgba(90,58,30,.8)" : "rgba(120,122,112,.55)";
      ctx.fillRect(x + (random() - 0.5) * unit * 0.3, y + (random() - 0.5) * unit * 0.14, 1 + random() * unit * 0.05, 1 + random() * unit * 0.02);
    }
  } else if (kind < 0.85) {
    // A scrap of paper.
    ctx.fillStyle = "rgba(190,184,160,.42)";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * 3);
    ctx.fillRect(-unit * 0.03, -unit * 0.02, unit * 0.06, unit * 0.04);
    ctx.restore();
  } else {
    // A length of cable.
    ctx.strokeStyle = "rgba(10,10,10,.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - unit * 0.14, y);
    ctx.bezierCurveTo(x - unit * 0.05, y - unit * 0.06, x + unit * 0.05, y + unit * 0.06, x + unit * 0.15, y - unit * 0.01);
    ctx.stroke();
  }
}

// The rubbish of a ship nobody's tidying: a tin cup on its side, a meal tray, a rag, a crumpled wrapper.
function drawRubbish(painter, x, y, random) {
  const { ctx, unit } = painter;
  const pick = random();
  ctx.save();
  ctx.translate(x + (random() - 0.5) * unit * 0.16, y + (random() - 0.5) * unit * 0.06);
  if (pick < 0.3) {
    ctx.fillStyle = "rgba(150,156,160,.75)";
    ctx.beginPath();
    ctx.ellipse(0, 0, unit * 0.035, unit * 0.022, random() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(40,30,20,.6)";
    ctx.fillRect(-1, -1, 2, 2);
  } else if (pick < 0.55) {
    ctx.rotate(random() * 0.6 - 0.3);
    ctx.fillStyle = "rgba(96,104,108,.8)";
    ctx.fillRect(-unit * 0.08, -unit * 0.03, unit * 0.16, unit * 0.06);
    ctx.fillStyle = "rgba(160,140,90,.6)";
    ctx.fillRect(-unit * 0.06, -unit * 0.015, unit * 0.05, unit * 0.03);
  } else if (pick < 0.8) {
    ctx.rotate(random() * 3);
    ctx.fillStyle = random() > 0.5 ? "rgba(120,90,60,.6)" : "rgba(90,100,110,.6)";
    ctx.beginPath();
    ctx.moveTo(-unit * 0.07, 0);
    ctx.quadraticCurveTo(-unit * 0.02, -unit * 0.05, unit * 0.06, -unit * 0.01);
    ctx.quadraticCurveTo(unit * 0.02, unit * 0.04, -unit * 0.07, 0);
    ctx.fill();
  } else {
    ctx.fillStyle = random() > 0.5 ? "rgba(190,60,40,.6)" : "rgba(200,180,80,.55)";
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Grime on a worn floor: oil and rust soaked into the plates, and on the worst of it a puddle with a sheen.
function drawGrime(painter, cell, grime) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
  const random = randomFrom(`grime${cell.x},${cell.y}`);
  const wide = unit * (0.1 + random() * 0.12 + grime * 0.03);
  ctx.fillStyle = random() > 0.5 ? `rgba(20,16,12,${0.18 + grime * 0.05})` : `rgba(90,52,26,${0.14 + grime * 0.05})`;
  ctx.beginPath();
  ctx.ellipse(x + (random() - 0.5) * unit * 0.1, y, wide, wide * 0.45, random() * 0.6 - 0.3, 0, Math.PI * 2);
  ctx.fill();
  if (grime >= 3 && random() > 0.6) {
    ctx.strokeStyle = "rgba(150,170,190,.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, wide * 0.6, wide * 0.25, 0, Math.PI * 1.1, Math.PI * 1.7);
    ctx.stroke();
  }
}

// What happened in a room, fading as it's cleaned away: soot where a fire burned, a dark stain where someone fell.
function drawMark(painter, mark) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((mark.x + 0.5) * CELL_WIDTH, mark.y + 0.5);
  const left = Math.max(0, Math.min(1, mark.left ?? 1));
  if (mark.kind === "scorch") {
    const reach = unit * 0.42;
    const soot = ctx.createRadialGradient(x, y, 0, x, y, reach);
    soot.addColorStop(0, `rgba(8,6,5,${0.75 * left})`);
    soot.addColorStop(0.6, `rgba(30,20,12,${0.4 * left})`);
    soot.addColorStop(1, "rgba(30,20,12,0)");
    ctx.fillStyle = soot;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.5);
    ctx.translate(-x, -y);
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // A stain where someone lay, and a smear or two where they were moved.
  const random = randomFrom(`fallen${mark.x},${mark.y}`);
  ctx.fillStyle = `rgba(92,18,14,${0.5 * left})`;
  ctx.beginPath();
  ctx.ellipse(x, y, unit * 0.16, unit * 0.07, random() * 0.5 - 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(70,14,10,${0.35 * left})`;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(x + (random() - 0.5) * unit * 0.4, y + (random() - 0.5) * unit * 0.16, unit * (0.015 + random() * 0.025), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- The kept picture of the room ---------------------------------------

function closedKey(view) {
  return (view.exits ?? []).map((exit) => exit.closed).join();
}

// A lamp's color, a little stronger than it says, because most of it gets lost in the dark.
function vivid(hex) {
  const [r, g, b] = rgbOf(hex);
  const grey = (r + g + b) / 3;
  const push = (n) => Math.max(0, Math.min(255, Math.round(grey + (n - grey) * 1.5)));
  return `#${[push(r), push(g), push(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// How much light reaches each part of the room. It's multiplied over everything, moving or not. The
// second picture is just the pools of light, which go on top again, faintly, as a colored haze.
function drawLightmap(scene, unit, left, top, width, height) {
  // A quarter the size of the picture, and smaller still for a whole deck, since it's all soft light anyway.
  const by = Math.min(0.25, Math.sqrt(LIGHTMAP_PIXELS / Math.max(1, width * height)));
  const canvas = newCanvas(width * by, height * by);
  const ctx = canvas.getContext("2d");
  const haze = newCanvas(width * by, height * by);
  const hazeCtx = haze.getContext("2d");
  hazeCtx.fillStyle = "#000";
  hazeCtx.fillRect(0, 0, haze.width, haze.height);
  hazeCtx.globalCompositeOperation = "lighter";
  const [ar, ag, ab] = rgbOf(hexOr(scene.look.ambient, FALLBACK_LOOK.ambient));
  ctx.fillStyle = `rgb(${Math.min(255, ar * AMBIENT_BOOST)},${Math.min(255, ag * AMBIENT_BOOST)},${Math.min(255, ab * AMBIENT_BOOST)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Rooms drawn on a deck whose lights are out are dark on their own, the rest of the deck staying lit.
  for (const area of scene.darkAreas ?? []) {
    const corners = [[area.x, area.y], [area.x + area.w, area.y], [area.x + area.w, area.y + area.h], [area.x, area.y + area.h]].map(([x, y]) => {
      const { u, v } = project(x * CELL_WIDTH, y);
      return [(u * unit - left) * by, (v * unit - top) * by];
    });
    ctx.fillStyle = mix(hexOr(scene.look.ambient, FALLBACK_LOOK.ambient), "#000000", 0.74);
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter";
  for (const light of scene.lights) {
    const { u, v } = project(light.wx, light.wy);
    const x = (u * unit - left) * by;
    const y = (v * unit - top) * by;
    const radius = light.radius * unit * 0.66 * by;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.25, 0.72);
    const color = vivid(light.color);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    pool.addColorStop(0, see(color, 0.95 * light.power));
    pool.addColorStop(0.45, see(color, 0.42 * light.power));
    pool.addColorStop(1, see(color, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
    hazeCtx.save();
    hazeCtx.translate(x, y);
    hazeCtx.scale(1.25, 0.72);
    hazeCtx.fillStyle = pool;
    hazeCtx.fillRect(-radius, -radius, radius * 2, radius * 2);
    hazeCtx.restore();
  }
  return { canvas, haze };
}

// Everything that doesn't move, drawn once, in small tiles: the whole level, at the size it's shown at with the wheel
// at rest, kept for as long as the scene lasts and scaled when the wheel turns, so that zooming never draws anything
// afresh. The tiles are drawn a few a frame, the ones in view and then the nearest first, so that nothing waits on
// them, and until each is drawn the picture before it (the same level before a light went out, say, or the whole
// level small) shows in its place, scaled: the level never goes blank.
const TILE = 256;
// The most pixels in a picture's lightmap: it's soft light, so it needn't be sharp.
const LIGHTMAP_PIXELS = 500000;
// The most pixels in the whole level's picture: on a sharper screen a deck is drawn a little smaller and scaled up.
const MOST_PICTURE = 40e6;
// The whole level small, under whatever hasn't been drawn yet: the size it's drawn at, and its little tiles.
const FAR_UNIT = 14;
const FAR_TILE = 128;
// How long one frame may spend drawing tiles before the rest wait for the next.
const TILE_TIME = { walking: 8, still: 24 };

// A picture of the level at a size: where it sits, in the canvas's own measure, and the tiles of it drawn so far.
// Nothing is drawn here; the tiles are, as they're needed. It's of the scene on screen, or of another level of the place
// with a scene of its own, drawn ahead so that it's there when the player walks into it.
function newPicture(view, unit, ratio, tile, key, { lit = true, scene = iso.scene, sceneId = iso.sceneId } = {}) {
  const { bounds } = scene;
  const pad = unit;
  const width = (bounds.maxU - bounds.minU) * unit + pad * 2;
  const height = (bounds.maxV - bounds.minV) * unit + pad * 2;
  const left = bounds.minU * unit - pad;
  const top = bounds.minV * unit - pad;
  // The materials are the same at every size, so they're made once for the scene.
  scene.materials ??= materialsFor(scene);
  const { materials } = scene;
  const cols = Math.ceil((width * ratio) / tile);
  const rows = Math.ceil((height * ratio) / tile);
  return {
    key,
    scene: sceneId,
    sceneOf: scene,
    level: levelKeyOf(view),
    ratio,
    unit,
    left,
    top,
    width,
    height,
    tile,
    cols,
    rows,
    total: cols * rows,
    tiles: new Map(),
    labels: view.labels ?? [],
    standing: standingOf(view, scene),
    materials,
    lightmap: lit ? drawLightmap(scene, unit, left, top, width, height) : null,
  };
}

// The size the whole level is drawn at: the size it's shown at with the wheel at rest, or a little less on a sharp
// screen, so that the picture stays within what every computer can hold.
function wholeUnitFor(scene, ratio, rest = iso.restUnit) {
  const { bounds } = scene;
  const spanU = bounds.maxU - bounds.minU;
  const spanV = bounds.maxV - bounds.minV;
  const most = Math.floor(Math.sqrt(MOST_PICTURE / Math.max(1, (spanU + 2) * (spanV + 2))) / ratio);
  return Math.max(Math.round(SIZES.smallest / 2), Math.min(rest || SIZES.smallest, most));
}

// The size a level is shown at with the wheel at rest: as big as it fits the view, between the smallest and the largest
// the room is drawn at. A deck never fits, so it's the smallest.
function restUnitFor(scene, width, height) {
  // The pixel-art test draws at half its pack's size, wherever it is, so the pictures' pixels are halved evenly.
  if (pixelArtOn()) return PIXEL_UNIT;
  const { bounds } = scene;
  const fit = Math.min(width / (bounds.maxU - bounds.minU + 1), height / (bounds.maxV - bounds.minV + 1));
  return Math.round(Math.min(SIZES.largest, Math.max(SIZES.smallest, fit)));
}

// A level's pictures: the newest, and while it still has gaps the whole one before it, to show under them. Once it's
// whole it's kept alone.
function keptPictures(pictures, newest) {
  if (newest.tiles.size >= newest.total) return [newest];
  const others = pictures.filter((one) => one !== newest);
  const before = others.filter((one) => one.tiles.size >= one.total).at(-1) ?? others.at(-1);
  return before ? [before, newest] : [newest];
}

// The whole level's picture for the scene, at its own size. A level of the place loaded with it has its picture drawn
// already; otherwise the picture before it stays while this one has gaps, to show under them, and goes once it's whole.
function stillPicture(view, ratio) {
  const unit = wholeUnitFor(iso.scene, ratio);
  const key = `${iso.sceneId}|${unit}|${ratio}`;
  if (iso.room?.key === key) return iso.room;
  const entry = levelEntry(levelKeyOf(view));
  let room = entry.pictures.find((one) => one.key === key);
  if (!room) {
    room = newPicture(view, unit, ratio, TILE, key);
    entry.pictures.push(room);
  }
  entry.pictures = keptPictures(entry.pictures, room);
  iso.room = room;
  iso.lightmap = room.lightmap;
  iso.materials = room.materials;
  return room;
}

// The whole level small, in little tiles drawn when there's a moment to spare. It shows, scaled up, wherever the
// level's own picture hasn't been drawn yet, so the level never goes blank, however fast the wheel turns.
function farPicture(view, ratio) {
  const key = `${iso.sceneId}|far|${ratio}`;
  if (iso.far?.key !== key) iso.far = newPicture(view, FAR_UNIT, ratio, FAR_TILE, key, { lit: false });
  return iso.far;
}

// The stretch of the picture, in units of the view, that a run of cells covers, from the floor up to a height.
function uvBox(x0, y0, x1, y1, z = 0) {
  const box = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
  for (const [wx, wy] of [[x0 * CELL_WIDTH, y0], [x1 * CELL_WIDTH, y0], [x1 * CELL_WIDTH, y1], [x0 * CELL_WIDTH, y1]]) {
    for (const zz of z ? [0, z] : [0]) {
      const { u, v } = project(wx, wy, zz);
      box.minU = Math.min(box.minU, u);
      box.maxU = Math.max(box.maxU, u);
      box.minV = Math.min(box.minV, v);
      box.maxV = Math.max(box.maxV, v);
    }
  }
  return box;
}

// Everything that stands up, from the back of the room to the front, each with the stretch of the picture it covers.
function standingOf(view, scene) {
  const standing = scene.blocks.map((block) => ({ ...block, box: block.span, tall: false }));
  for (const thing of view.things) {
    // A container that's a piece of the deck's furniture stands already, as the piece.
    if (thing.onPiece) continue;
    const { wx, wy } = cellCentre(thing.x, thing.y);
    standing.push({ type: "thing", thing, depth: wx + wy, box: uvBox(thing.x, thing.y, thing.x + 1, thing.y + 1, 2.5), tall: true });
  }
  for (const exit of view.exits) {
    const { wx, wy } = cellCentre(exit.x, exit.y);
    const tallAt = (x, y) => (scene.heights[y]?.[x] ?? 0) > 1;
    const along = tallAt(exit.x - 1, exit.y) || tallAt(exit.x + 1, exit.y) ? "x" : "y";
    const tall = tallAt(exit.x - 1, exit.y) || tallAt(exit.x + 1, exit.y) || tallAt(exit.x, exit.y - 1) || tallAt(exit.x, exit.y + 1);
    standing.push({ type: "door", exit, along, tall, depth: wx + wy - 0.4, box: uvBox(exit.x - 1, exit.y - 1, exit.x + 2, exit.y + 2, 3), wide: true });
  }
  for (const run of scene.runs) {
    if (run.on === "wall" || run.on === "roof") {
      const h = scene.heights[run.y][run.x];
      standing.push({ type: "words", run, depth: (run.x + run.length) * CELL_WIDTH + run.y + 1, box: uvBox(run.x, run.y, run.x + run.length, run.y + 1, h + 1.5), wide: true });
    }
  }
  for (const cell of scene.junk) {
    const { wx, wy } = cellCentre(cell.x, cell.y);
    standing.push({ type: "junk", cell, depth: wx + wy, box: uvBox(cell.x, cell.y, cell.x + 1, cell.y + 1, 1) });
  }
  for (const fixture of scene.fixtures) {
    const { wx, wy } = cellCentre(fixture.x, fixture.y);
    standing.push({ type: "fixture", fixture, depth: wx + wy + 0.01, box: uvBox(fixture.x - 1, fixture.y - 1, fixture.x + 2, fixture.y + 2, 3), wide: true });
  }
  // On a ship, a bulkhead door frames every opening between rooms, across it, in the line of the wall it's in (a wall
  // cut low in front of the room counts as much as a tall one).
  if (scene.style) {
    for (const cell of scene.ground) {
      if (cell.kind !== "door") continue;
      const { wx, wy } = cellCentre(cell.x, cell.y);
      const along = doorAlong(scene.kinds, cell.x, cell.y);
      standing.push({ type: "frame", x: cell.x, y: cell.y, along, depth: wx + wy - 0.4, box: uvBox(cell.x - 1, cell.y - 1, cell.x + 2, cell.y + 2, 3), wide: true });
    }
  }
  standing.sort((a, b) => (a.frontDepth ?? a.depth) - (b.frontDepth ?? b.depth));
  return standing;
}

// One tile of the still picture, drawn afresh: everything that reaches into it, in the same order as the whole picture
// would be, so that the tiles join without a seam.
function drawTile(room, tx, ty) {
  const { scene } = iso;
  const { unit, ratio, left, top, materials, tile: TILE } = room;
  const canvas = newCanvas(TILE, TILE);
  const ctx = canvas.getContext("2d");
  const size = TILE / ratio;
  const ox = -left - tx * size;
  const oy = -top - ty * size;
  const painter = painterFor(ctx, ratio, unit, ox, oy);
  const { at, plane, flat } = painter;
  // Whether something reaches into this tile, with room round it for what hangs over the edge of its own stretch.
  const reaches = (box, margin) => {
    if (!box) return true;
    const x0 = box.minU * unit - left;
    const x1 = box.maxU * unit - left;
    const y0 = box.minV * unit - top;
    const y1 = box.maxV * unit - top;
    return x1 + margin >= tx * size && x0 - margin <= (tx + 1) * size && y1 + margin >= ty * size && y0 - margin <= (ty + 1) * size;
  };
  flat();

  // The floor. Each cell's stretch is worked out once for the scene, since every tile asks about every cell.
  const mainFloor = scene.ground.find((cell) => cell.kind === "floor")?.mark;
  scene.groundBoxes ??= scene.ground.map((cell) => uvBox(cell.x, cell.y, cell.x + 1, cell.y + 1, 1));
  const ground = scene.ground.filter((cell, i) => reaches(scene.groundBoxes[i], unit * 0.8));
  // All the cells with the same look are filled at once, through the texture laid as a pattern along the floor's own
  // slant: a few fills for the tile instead of one for every cell, and no seams between them.
  const quad = (cell) => {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    ctx.moveTo(...at(x0, cell.y));
    ctx.lineTo(...at(x1, cell.y));
    ctx.lineTo(...at(x1, cell.y + 1));
    ctx.lineTo(...at(x0, cell.y + 1));
    ctx.closePath();
  };
  const byLook = new Map();
  const dim = [];
  const hull = [];
  for (const cell of ground) {
    if (cell.kind === "dim") {
      dim.push(cell);
      continue;
    }
    if (cell.kind === "hull") {
      hull.push(cell);
      continue;
    }
    const seed = hashOf(Math.floor(cell.x / 2), cell.y);
    const second = cell.kind === "floor" && cell.mark !== " " && cell.mark !== mainFloor;
    const image = cell.passage && materials.passage ? materials.passage : second ? materials.floorAlt[Math.floor(seed * 2)] : materials.floor[Math.floor(seed * 4)];
    if (!byLook.has(image)) byLook.set(image, []);
    byLook.get(image).push(cell);
  }
  // The hull's skin, a step below the deck, its outer edge curving away into the dark, with a frame across it every
  // few squares.
  if (hull.length) {
    const { style } = materials;
    const drop = -HULL_DROP;
    const quadAt = (cell, z) => {
      const x0 = cell.x * CELL_WIDTH;
      const x1 = x0 + CELL_WIDTH;
      ctx.moveTo(...at(x0, cell.y, z));
      ctx.lineTo(...at(x1, cell.y, z));
      ctx.lineTo(...at(x1, cell.y + 1, z));
      ctx.lineTo(...at(x0, cell.y + 1, z));
      ctx.closePath();
    };
    ctx.beginPath();
    for (const cell of hull) quadAt(cell, drop);
    ctx.fillStyle = scaled(style.hull, 0.7);
    ctx.fill();
    plane(at(0, 0, drop), at(2 * CELL_WIDTH, 0, drop), at(0, 1, drop));
    const pattern = ctx.createPattern(materials.hull, "repeat");
    pattern.setTransform(new DOMMatrix().scale(1 / materials.hull.width, 1 / materials.hull.height));
    ctx.fillStyle = pattern;
    ctx.fill();
    flat();
    // The frames.
    ctx.beginPath();
    for (const cell of hull) if (cell.rib) quadAt(cell, drop + 0.04);
    ctx.fillStyle = see(style.rib, 0.85);
    ctx.fill();
    ctx.beginPath();
    for (const cell of hull) {
      if (!cell.rib) continue;
      const x0 = cell.x * CELL_WIDTH;
      ctx.moveTo(...at(x0, cell.y, drop + 0.04));
      ctx.lineTo(...at(x0 + CELL_WIDTH, cell.y, drop + 0.04));
    }
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Where the skin ends, it falls away.
    const outerKind = (x, y) => scene.kinds[y]?.[x];
    for (const cell of hull) {
      if (cell.ring !== HULL_REACH) continue;
      const x0 = cell.x * CELL_WIDTH;
      const x1 = x0 + CELL_WIDTH;
      const y1 = cell.y + 1;
      const fall = (points) => {
        const top = Math.min(points[0][1], points[1][1]);
        const bottom = Math.max(points[2][1], points[3][1]);
        const shade = ctx.createLinearGradient(0, top, 0, bottom);
        shade.addColorStop(0, scaled(style.hull, 0.55));
        shade.addColorStop(1, "#030403");
        ctx.beginPath();
        points.forEach((one, i) => (i ? ctx.lineTo(...one) : ctx.moveTo(...one)));
        ctx.closePath();
        ctx.fillStyle = shade;
        ctx.fill();
      };
      if (outerKind(cell.x + 1, cell.y) !== "hull") fall([at(x1, cell.y, drop), at(x1, y1, drop), at(x1, y1, drop - 1), at(x1, cell.y, drop - 1)]);
      if (outerKind(cell.x, cell.y + 1) !== "hull") fall([at(x0, y1, drop), at(x1, y1, drop), at(x1, y1, drop - 1), at(x0, y1, drop - 1)]);
    }
  }
  if (dim.length) {
    ctx.beginPath();
    for (const cell of dim) quad(cell);
    ctx.fillStyle = scaled(materials.floorColor, 0.28);
    ctx.fill();
  }
  // The pixel-art test lays its own floor tiles in place of the game's (public/pixel-art.js).
  if (pixelArtOn()) {
    drawPixelFloors(painter, [...byLook.values()].flat().map((cell) => ({ x: cell.x, y: cell.y, passage: !!cell.passage, second: cell.kind === "floor" && cell.mark !== " " && cell.mark !== mainFloor, ...(cell.light ? { look: "light" } : {}), ...(cell.hazard ? { hazard: cell.hazard } : {}) })), CELL_WIDTH);
    byLook.clear();
  }
  for (const [image, cells] of byLook) {
    ctx.beginPath();
    for (const cell of cells) quad(cell);
    ctx.fillStyle = scaled(materials.floorColor, 0.7);
    ctx.fill();
    // The texture covers two cells across and one down, so it's laid in those units, from the floor's own origin.
    plane(at(0, 0), at(2 * CELL_WIDTH, 0), at(0, 1));
    const pattern = ctx.createPattern(image, "repeat");
    pattern.setTransform(new DOMMatrix().scale(1 / image.width, 1 / image.height));
    ctx.fillStyle = pattern;
    ctx.fill();
    flat();
  }
  // Where a floor stops at water or the dark, its edge shows.
  const open = (x, y) => {
    const kind = scene.kinds[y]?.[x];
    return kind === undefined || kind === "water" || kind === "void" || kind === "spark" || kind === "hull";
  };
  // Against the hull the deck's edge goes down to the hull's skin.
  const edgeDepth = (x, y) => (scene.kinds[y]?.[x] === "hull" ? -HULL_DROP : -FLOOR_EDGE);
  const edge = scaled(materials.floorColor, 0.32);
  for (const cell of ground) {
    if (cell.kind === "hull") continue;
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const y1 = cell.y + 1;
    if (open(cell.x + 1, cell.y)) polygon(ctx, [at(x1, cell.y), at(x1, y1), at(x1, y1, edgeDepth(cell.x + 1, cell.y)), at(x1, cell.y, edgeDepth(cell.x + 1, cell.y))], scaled(edge, 0.7));
    if (open(cell.x, cell.y + 1)) polygon(ctx, [at(x0, y1), at(x1, y1), at(x1, y1, edgeDepth(cell.x, cell.y + 1)), at(x0, y1, edgeDepth(cell.x, cell.y + 1))], edge);
  }
  // Rubbish, more of it the more cluttered the place is; grime, the more worn it is; and hazard paint at the doors.
  const wear = scene.wear;
  const littered = wear ? CLUTTER_ABOVE[wear.clutter] : 0.84;
  const grimed = wear ? GRIME_ABOVE[wear.grime] : 1;
  for (const cell of ground) {
    if (cell.kind === "floor" && hashOf(cell.x * 5 + 1, cell.y * 3 + 2) > grimed) drawGrime(painter, cell, wear.grime);
    if (cell.kind === "floor" && cell.seed > littered) drawLitter(painter, cell, wear?.clutter ?? 1);
    if (cell.kind === "exit" || cell.kind === "door") {
      const x0 = cell.x * CELL_WIDTH;
      for (let i = 0; i < 4; i += 1) {
        polygon(ctx, [at(x0, cell.y + i * 0.25), at(x0 + CELL_WIDTH, cell.y + i * 0.25), at(x0 + CELL_WIDTH, cell.y + i * 0.25 + 0.25), at(x0, cell.y + i * 0.25 + 0.25)], i % 2 ? "#26241c" : "#7c6c30");
      }
    }
  }
  // Where people walk, the floor is worn paler: every way across this stretch drawn as one band on a canvas of its own,
  // then blurred and laid faintly over the floor, the way the shadows are, so the ways run into one another.
  const worn = (scene.worn ?? []).filter((path) => reaches((path.box ??= uvBox(path.x0, path.y0, path.x1, path.y1, 0)), unit * 1.5));
  if (worn.length) {
    const wide = unit * 0.3;
    const soften = Math.max(1.5, unit * 0.11 * ratio);
    const edge = Math.ceil(soften * 3 + wide * ratio) + 2;
    const size = Math.ceil((TILE + edge * 2) * 0.5);
    const lane = newCanvas(size, size);
    const lctx = lane.getContext("2d");
    const lanePainter = painterFor(lctx, ratio * 0.5, unit, ox + edge / ratio, oy + edge / ratio);
    lanePainter.flat();
    lctx.strokeStyle = "#fff";
    lctx.lineWidth = wide;
    lctx.lineCap = "round";
    lctx.lineJoin = "round";
    for (const path of worn) {
      lctx.beginPath();
      path.points.forEach(([wx, wy], i) => (i ? lctx.lineTo(...lanePainter.at(wx, wy)) : lctx.moveTo(...lanePainter.at(wx, wy))));
      lctx.stroke();
    }
    const soft = newCanvas(size, size);
    const softCtx = soft.getContext("2d");
    softCtx.filter = `blur(${soften * 0.5}px)`;
    softCtx.drawImage(lane, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 0.075 + (scene.wear?.grime ?? 1) * 0.015;
    ctx.drawImage(soft, -edge, -edge, size / 0.5, size / 0.5);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    flat();
  }
  for (const mark of scene.marks ?? []) drawMark(painter, mark);
  const paint = mix(hexOr(scene.colors.writing, FALLBACK_COLORS.writing), "#c8c4b0", 0.5);
  for (const label of room.labels) {
    if (!reaches(uvBox(label.x, label.y, label.x + label.text.length, label.y + 1, 0.5), unit * 3)) continue;
    paintWords(painter, label.text, { at: at(label.x * CELL_WIDTH, label.y + 0.5), size: unit * 0.34, color: see(paint, 0.5) });
  }
  for (const run of scene.runs.filter((one) => one.on === "ground")) {
    if (!reaches(uvBox(run.x, run.y, run.x + run.length, run.y + 1, 0.5), unit * 3)) continue;
    paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 0.5), size: unit * 0.34, color: see(paint, 0.5) });
  }

  // Soft shadows around everything that stands on the floor, which is most of what makes it look solid. They're all
  // drawn sharp on one canvas a little bigger than the tile, and blurred once as they go on, which costs a fraction of
  // blurring each one, and keeps the blur at the tile's edges the same as in one whole picture.
  // They're drawn and blurred at half size, since a blur has no sharp edges to lose, which costs a quarter as much.
  const blur = Math.max(2, unit * 0.14 * ratio);
  const reach = Math.ceil(blur * 3) + 2;
  const half = 0.5;
  const across = Math.ceil((TILE + reach * 2) * half);
  const shadow = newCanvas(across, across);
  const sctx = shadow.getContext("2d");
  const shadowPainter = painterFor(sctx, ratio * half, unit, ox + reach / ratio, oy + reach / ratio);
  shadowPainter.flat();
  sctx.fillStyle = "#000";
  for (const block of scene.blocks) {
    if (block.style === "piece") {
      if (!block.shadow || !reaches(block.span, unit * 1.5)) continue;
      const [x0, y0, x1, y1] = block.shadow;
      sctx.beginPath();
      for (const [wx, wy] of [[x0, y0], [x1 + 0.07, y0], [x1 + 0.07, y1 + 0.07], [x0, y1 + 0.07]]) sctx.lineTo(...shadowPainter.at(wx, wy));
      sctx.closePath();
      sctx.fill();
      continue;
    }
    if (block.style === "plants" || block.style === "lamp" || block.style === "stairs" || block.style === "rail" || block.style === "tank" || block.style === "stood" || block.wx !== undefined) continue;
    if (!reaches(block.span, unit * 1.5)) continue;
    const x0 = block.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const grow = Math.min(0.28, block.h * 0.22);
    sctx.beginPath();
    for (const [wx, wy] of [[x0, block.y], [x1 + grow, block.y], [x1 + grow, block.y + 1 + grow], [x0, block.y + 1 + grow]]) sctx.lineTo(...shadowPainter.at(wx, wy));
    sctx.closePath();
    sctx.fill();
  }
  const soft = newCanvas(across, across);
  const softCtx = soft.getContext("2d");
  softCtx.filter = `blur(${blur * half}px)`;
  softCtx.drawImage(shadow, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.82;
  ctx.drawImage(soft, -reach, -reach, across / half, across / half);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  flat();

  // Then everything that stands up, from the back of the room to the front.
  for (const item of room.standing) {
    if (!reaches(item.box, item.wide ? unit * 2 : unit * 0.8)) continue;
    if (item.type === "block") drawBlock(painter, item, materials);
    else if (item.type === "junk") drawJunk(painter, item.cell);
    else if (item.type === "fixture") drawFixture(painter, item.fixture);
    else if (item.type === "thing") drawThing(painter, item.thing);
    else if (item.type === "door") drawDoor(painter, item);
    // In the pixel-art test the pack's door, drawn every frame, is its own frame.
    else if (item.type === "frame") {
      if (!pixelArtOn()) drawFrame(painter, item, scene.style);
    }
    else if (item.type === "words") {
      const { run } = item;
      const h = scene.heights[run.y][run.x];
      if (run.on === "wall") {
        const low = h < 1;
        paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 1, low ? h : h * 0.52), size: low ? unit * 0.2 : unit * 0.34, length: run.length, upright: true, color: see(paint, 0.62) });
      } else {
        paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 0.5, h), size: unit * 0.3, color: see(paint, 0.62) });
      }
    }
  }
  return canvas;
}

// A tile of the picture, drawn now if it hasn't been, and rasterised at once, so that the time it takes is counted
// in this frame and not in some later one.
function tileOf(room, tx, ty) {
  const key = `${tx},${ty}`;
  let tile = room.tiles.get(key);
  if (tile) return tile;
  // A level drawn ahead of the player is drawn with its own scene: whatever reads the scene while the tile's being drawn
  // reads that one.
  const shown = iso.scene;
  iso.scene = room.sceneOf ?? shown;
  try {
    tile = drawTile(room, tx, ty);
  } finally {
    iso.scene = shown;
  }
  tile.getContext("2d").getImageData(0, 0, 1, 1);
  room.tiles.set(key, tile);
  return tile;
}

// The tile of a picture still to be drawn that's nearest a point, in tiles, or null once they all have been.
function nearestMissing(room, cx, cy) {
  if (room.tiles.size >= room.total) return null;
  let best = null;
  for (let ty = 0; ty < room.rows; ty += 1) {
    for (let tx = 0; tx < room.cols; tx += 1) {
      if (room.tiles.has(`${tx},${ty}`)) continue;
      const far = (tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2;
      if (!best || far < best.far) best = { tx, ty, far };
    }
  }
  return best;
}

// Where a picture's tiles go on the canvas, at a scale, and which of them are in view.
function layoutOf(one, scale, ox, oy, ratio, canvasWidth, canvasHeight) {
  const step = one.tile * scale;
  const baseX = Math.round((ox + one.left * scale) * ratio);
  const baseY = Math.round((oy + one.top * scale) * ratio);
  return {
    step,
    baseX,
    baseY,
    firstX: Math.max(0, Math.floor(-baseX / step)),
    lastX: Math.min(one.cols - 1, Math.floor((canvasWidth - baseX) / step)),
    firstY: Math.max(0, Math.floor(-baseY / step)),
    lastY: Math.min(one.rows - 1, Math.floor((canvasHeight - baseY) / step)),
    middleX: (canvasWidth / 2 - baseX) / step,
    middleY: (canvasHeight / 2 - baseY) / step,
  };
}

// The still picture onto the canvas, scaled to the size the view is at. The tiles in view are drawn as they're needed,
// as many a frame as the frame has time for, and until each is drawn the picture before shows in its place, with the
// whole level's small picture under that: the level never goes blank. With time to spare in a frame, the small
// picture is finished and then the rest of the level, nearest the view first, until the whole of it is drawn.
function drawStill(ctx, room, far, ox, oy, ratio, canvasWidth, canvasHeight, now) {
  const { unit } = iso;
  const scale = unit / room.unit;
  const place = (one, s) => layoutOf(one, s, ox, oy, ratio, canvasWidth, canvasHeight);
  // Draws a picture's tiles in view, scaled, drawing missing ones only while may() allows. True when any is missing.
  const paint = (one, s, may) => {
    const { step, baseX, baseY, firstX, lastX, firstY, lastY } = place(one, s);
    let missing = false;
    for (let ty = firstY; ty <= lastY; ty += 1) {
      for (let tx = firstX; tx <= lastX; tx += 1) {
        const tile = one.tiles.get(`${tx},${ty}`) ?? (may() ? tileOf(one, tx, ty) : null);
        // Scaled tiles overlap the next by a pixel, so no hairline shows between them.
        if (tile) ctx.drawImage(tile, baseX + tx * step, baseY + ty * step, step + (s === 1 ? 0 : 1), step + (s === 1 ? 0 : 1));
        else missing = true;
      }
    }
    return missing;
  };
  const never = () => false;
  // Whether any tile in view of a picture, at a scale, is still to be drawn.
  const anyMissing = (one, s) => {
    if (one.tiles.size >= one.total) return false;
    const { firstX, lastX, firstY, lastY } = place(one, s);
    for (let ty = firstY; ty <= lastY; ty += 1) for (let tx = firstX; tx <= lastX; tx += 1) if (!one.tiles.has(`${tx},${ty}`)) return true;
    return false;
  };
  // Under whatever isn't drawn yet: the small picture, and the picture before over it.
  if (anyMissing(room, scale)) {
    if (far?.tiles.size) paint(far, unit / far.unit, never);
    const before = levelEntry(room.level).pictures.find((one) => one !== room && one.ratio === room.ratio);
    if (before) paint(before, unit / before.unit, never);
  }
  const deadline = now + (iso.youMoving ? TILE_TIME.walking : TILE_TIME.still);
  let drawn = 0;
  const may = () => {
    drawn += 1;
    return drawn === 1 || performance.now() < deadline;
  };
  if (paint(room, scale, may)) {
    iso.redraw = true;
    return;
  }
  // Once the level's own picture is whole, the small one isn't wanted, and the picture before it goes.
  if (room.tiles.size >= room.total) {
    const entry = levelEntry(room.level);
    if (entry.pictures.length > 1) entry.pictures = [room];
    return;
  }
  // The small picture, then the rest of the level, nearest the view first.
  for (const one of [far, room].filter(Boolean)) {
    const { middleX, middleY } = place(one, unit / one.unit);
    let next = nearestMissing(one, middleX, middleY);
    if (!next) continue;
    while (next && may()) {
      tileOf(one, next.tx, next.ty);
      next = nearestMissing(one, middleX, middleY);
    }
    iso.redraw = true;
    return;
  }
}

// ---- People -------------------------------------------------------------

function lookFor(key, color, crowd) {
  let sum = 0;
  for (const ch of String(key)) sum = (sum * 31 + ch.codePointAt(0)) >>> 0;
  const coat = mix(hexOr(color, "#6a6a60"), "#55544c", crowd ? 0.68 : 0.42);
  return {
    coat,
    coatDark: scaled(coat, 0.62),
    trousers: TROUSERS[sum % TROUSERS.length],
    skin: SKIN[(sum >>> 3) % SKIN.length],
    hair: HAIR[(sum >>> 5) % HAIR.length],
    vest: (sum >>> 7) % 3 === 0,
    pack: (sum >>> 9) % 4 === 0,
    long: (sum >>> 11) % 4 === 0,
    hat: (sum >>> 13) % 5 === 0,
  };
}

// A fighter who isn't someone already in the room looks like the others of their side, each a little different.
const fighterLooks = new Map();
function fighterLook(one) {
  const known = fighterLooks.get(one.key);
  if (known && known.color === one.color) return known.look;
  const look = lookFor(one.key, one.color ?? (one.side === "enemy" ? "#b0503a" : "#8ec5ff"), false);
  fighterLooks.set(one.key, { color: one.color, look });
  return look;
}

const YOU_LOOK = { coat: "#7c9484", coatDark: "#54665a", trousers: "#2c3430", skin: "#d8b090", hair: "#2a2420", vest: true, pack: true, long: false, hat: false };

const limb = (ctx, x0, y0, x1, y1, width, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

// Someone standing on the floor, with the point between their feet at x, y. They're drawn thirty units
// tall, facing away from the camera or towards it, and a mirror image does for the other direction.
// The size people are drawn at, as the tile's width to draw them by: in the pixel-art view the packs' furniture is its
// own size, smaller than the game's, and people are as much smaller, so a chair still fits whoever sits in it.
export const figureUnit = (unit) => (pixelArtOn() ? unit * PACK_FIGURE : unit);

function drawPerson(ctx, x, y, unit, person) {
  const scale = (unit * 0.86) / 30;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  if (person.asleep) ctx.ellipse(0, 0, unit * 0.3, unit * 0.1, 0, 0, Math.PI * 2);
  else ctx.ellipse(0, 0, unit * 0.15, unit * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  if (person.ring) {
    ctx.strokeStyle = person.ring;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, unit * 0.22, unit * 0.11, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A seat higher than a chair's lifts whoever's in it.
  if (person.raise) ctx.translate(0, (-person.raise * unit) / 2);
  ctx.scale(person.flip ? -scale : scale, scale);
  ctx.lineCap = "round";
  const { look } = person;
  if (person.asleep) {
    ctx.fillStyle = look.coat;
    ctx.beginPath();
    ctx.roundRect(-9, -4, 14, 5, 2);
    ctx.fill();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(7, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // Someone lying where they fell has a mark over them: a red cross, for anyone to see from across the room.
    if (person.mark) {
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = "rgba(20,6,4,.85)";
      ctx.beginPath();
      ctx.moveTo(0, -16);
      ctx.lineTo(0, -8);
      ctx.moveTo(-4, -12);
      ctx.lineTo(4, -12);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ff6b5b";
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  // Someone sitting has their legs out in front along the seat and down to the floor, and the rest of them lower.
  const sitting = Boolean(person.seated);
  if (sitting) {
    limb(ctx, -1.2, -8.2, 3.2, -7.6, 2.6, scaled(look.trousers, 0.8));
    limb(ctx, 3.2, -7.6, 3.3, -0.6, 2.3, scaled(look.trousers, 0.8));
    limb(ctx, 3.3, -0.6, 4.6, 0, 2.3, "#141310");
    limb(ctx, 1.6, -8.2, 5.8, -7.8, 2.6, look.trousers);
    limb(ctx, 5.8, -7.8, 5.9, -0.6, 2.3, look.trousers);
    limb(ctx, 5.9, -0.6, 7.2, 0, 2.3, "#1c1a16");
    ctx.translate(0, 6);
  }
  const swing = person.walking && !iso.calm && !sitting ? Math.sin(person.step) * 3.2 : 0;
  const lift = person.walking && !iso.calm && !sitting ? Math.abs(Math.sin(person.step)) * 0.6 : 0;
  ctx.translate(0, -lift);
  // The far leg and arm first; sitting, the arms reach forward, to a console or a table.
  if (!sitting) {
    limb(ctx, -1.5, -14, -1.8 - swing, -1, 2.6, scaled(look.trousers, 0.8));
    limb(ctx, -1.8 - swing, -1, -1.2 - swing, 0, 2.6, "#141310");
  }
  const farHand = sitting ? [3.6, -17] : [-5 + swing * 0.7, -14];
  limb(ctx, -4.3, -23, farHand[0], farHand[1], 2, look.coatDark);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(farHand[0], farHand[1] + 0.8, 1, 0, Math.PI * 2);
  ctx.fill();
  if (!sitting) {
    limb(ctx, 1.5, -14, 1.8 + swing, -1, 2.6, look.trousers);
    limb(ctx, 1.8 + swing, -1, 2.4 + swing, 0, 2.6, "#1c1a16");
  }
  // A pack on their back goes behind them if they're facing the camera, and in front of the coat if not.
  if (look.pack && !person.back) {
    ctx.fillStyle = "#2c2a20";
    ctx.fillRect(-3.5, -24, 7, 8);
  }
  // The body, with its light side and its dark side.
  const bottom = look.long && !sitting ? -8 : -13.5;
  ctx.fillStyle = look.coat;
  ctx.beginPath();
  ctx.moveTo(-4.4, -24);
  ctx.lineTo(4.4, -24);
  ctx.lineTo(look.long ? 4 : 3.2, bottom);
  ctx.lineTo(look.long ? -4 : -3.2, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.beginPath();
  ctx.moveTo(0.6, -24);
  ctx.lineTo(4.4, -24);
  ctx.lineTo(look.long ? 4 : 3.2, bottom);
  ctx.lineTo(0.6, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fillRect(-4.2, -24, 8.2, 0.8);
  if (person.back) {
    if (look.pack) {
      ctx.fillStyle = "#3a3628";
      ctx.fillRect(-3.2, -23.4, 6.4, 7.6);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0.4, -23.4, 2.8, 7.6);
    }
  } else if (look.vest) {
    ctx.fillStyle = "rgba(20,18,14,.55)";
    ctx.fillRect(-2.8, -23, 5.6, 6.4);
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.fillRect(-2.2, -19.4, 1.8, 1.8);
    ctx.fillRect(0.4, -19.4, 1.8, 1.8);
  }
  ctx.fillStyle = "rgba(10,10,8,.6)";
  ctx.fillRect(-3.2, -15, 6.4, 0.9);
  // The near arm.
  const nearHand = sitting ? [8, -17] : [5 - swing * 0.7, -14];
  limb(ctx, 4.3, -23, nearHand[0], nearHand[1], 2.1, look.coat);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(nearHand[0], nearHand[1] + 0.8, 1, 0, Math.PI * 2);
  ctx.fill();
  // The head.
  ctx.fillStyle = scaled(look.skin, 0.8);
  ctx.fillRect(-1, -25, 2, 2);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0.3, -27.2, 2.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.24)";
  ctx.beginPath();
  ctx.arc(0.3, -27.2, 2.7, Math.PI * 1.6, Math.PI * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = look.hat ? scaled(look.coat, 0.7) : look.hair;
  ctx.beginPath();
  if (person.back) ctx.arc(0.3, -27.4, 2.8, 0, Math.PI * 2);
  else ctx.arc(0.3, -27.6, 2.8, Math.PI * 1.02, Math.PI * 1.98);
  ctx.closePath();
  ctx.fill();
  if (look.hat) ctx.fillRect(-3.2, -28.6, 7, 0.9);
  if (!person.back) {
    ctx.fillStyle = "rgba(20,12,8,.7)";
    ctx.fillRect(1, -27.4, 0.9, 0.7);
    ctx.fillRect(2.3, -27.4, 0.5, 0.7);
  }
  ctx.restore();
}

// Which way someone's facing: towards where they've just been going, and otherwise the way they last were.
function faceAlong(shown, dx, dy) {
  const across = dx * CELL_WIDTH - dy;
  const along = dx * CELL_WIDTH + dy;
  if (Math.abs(across) > 0.002) shown.flip = across < 0;
  if (Math.abs(along) > 0.002) shown.back = along < 0;
}

// ---- The view on the screen ---------------------------------------------

const iso = {
  canvas: null,
  hooks: null,
  scene: null,
  sceneId: null,
  room: null,
  lightmap: null,
  materials: null,
  zoom: 1,
  unit: 56,
  camera: null,
  you: null,
  shown: new Map(),
  // How far open each door between rooms is, 0 to 1, by "x,y" on the level.
  doors: new Map(),
  // What's being said over people's heads now, when someone next will, and who said what last (drawChatter).
  chatter: { shown: [], next: 0, said: new Map(), last: new Map() },
  hits: [],
  pointer: null,
  hover: null,
  frame: 0,
  lastFrame: 0,
  lastDraw: 0,
  fadeFrom: 0,
  calm: false,
  focus: null,
  covered: 0,
  // How much of the room's right side the room's own panel covers: the camera keeps the player in what's left.
  coverRight: 0,
  // A floating window that's about something in the room, and how far the room has slid to keep it clear of the window.
  clear: null,
  nudge: { x: 0, y: 0 },
  drawnNudge: { x: 0, y: 0 },
  // The size the level is shown at with the wheel at rest, which is the size its whole picture is drawn at.
  restUnit: 0,
  // The place whose map is loaded, the only one at a time: its key, each of its levels with its scene and its pictures,
  // and while it's loading, how far that's got (see "One place at a time" below).
  place: null,
  // The level the scene on screen is of.
  sceneLevel: null,
  // The whole level small, under whatever hasn't been drawn yet at the size wanted.
  far: null,
  // The dark round the edges of the view, made once for its size.
  vignette: null,
};

// The level a view is of: on the ship, the deck, whichever of its rooms the player's in.
const levelKeyOf = (view) => view.here.deck?.id ?? view.here.id;

// What the still picture of a level is drawn from, as one string: when it changes, the picture is drawn again. A deck's
// rooms are dark or lit each by itself, so the darkness of the room the player's in only counts off a deck.
function sceneIdOf(view) {
  const parts = (view.things ?? []).filter((thing) => thing.part).map((thing) => `${thing.id}=${thing.part.word}`).join(",");
  const darkRooms = (view.areas ?? []).filter((area) => area.dark).map((area) => area.id).join(",");
  // What changes the still picture of the level: rooms without power, rooms on fire or holed, the garden's stage.
  const state = [
    (view.areas ?? []).filter((area) => area.power === false).map((area) => area.id).join(","),
    (view.areas ?? []).filter((area) => area.fire || area.breach).map((area) => `${area.id}:${area.fire ?? 0}${area.breach ? "b" : ""}`).join(","),
    (view.growing ?? []).map((one) => `${one.room}:${Math.floor(one.made / GROW_EVERY)}`).join(","),
    view.wear ? `${view.wear.grime}${view.wear.clutter}` : "",
    (view.areas ?? []).filter((area) => area.scorched).map((area) => `${area.id}:${area.scorched.size}:${area.scorched.left}`).join(","),
    (view.marks ?? []).map((mark) => `${mark.kind[0]}${mark.x},${mark.y}:${mark.left}`).join(","),
  ].join("/");
  const dark = view.areas?.length ? "deck" : view.room?.dark ? "dark" : "lit";
  // And what it's drawn with: the game's own drawing, or the pixel-art test's pictures (public/pixel-art.js).
  return `${levelKeyOf(view)}|${view.here.drawn ?? 0}|${view.cols}x${view.lines}|${closedKey(view)}|${dark}|${darkRooms}|${parts}|${state}|${pixelKey()}|${packKey()}`;
}

function useScene(view) {
  const id = sceneIdOf(view);
  if (iso.sceneId === id) return;
  // The same level: on the ship, the same deck, whichever of its rooms the player's in.
  const level = levelKeyOf(view);
  const sameLevel = iso.sceneLevel === level;
  const entry = levelEntry(level);
  // A level loaded with the place is drawn already for the scene it had then: if it's the same now, that's used as it is.
  iso.scene = entry.sceneId === id ? entry.scene : buildScene(view);
  iso.sceneId = id;
  iso.sceneLevel = level;
  iso.room = null;
  Object.assign(entry, { view, scene: iso.scene, sceneId: id });
  // On the same level, the picture there is stays to show under the new one's gaps; another level starts afresh, with
  // its own picture from before, if it has one, under the gaps.
  if (sameLevel) return;
  iso.far = null;
  iso.camera = null;
  iso.you = null;
  iso.shown = new Map();
  iso.doors = new Map();
  iso.fadeFrom = performance.now();
}

// ---- One place at a time -------------------------------------------------------------------------------------------
// Only one place's map is loaded at a time. When the player arrives somewhere (a game opened or begun, the shuttle
// across to a dock), every level of it is drawn whole behind the loading screen (public/loading.js) before anything is
// shown: the ship's three decks, a port's rooms. They're kept while the player's there, so a deck or a room walked into
// is there at once, and leaving the place lets them all go before the next one loads.

// The place a view is of: which one, and how many times its rooms have been read from their files (a deck saved in the
// map editor is loaded again).
const placeKeyOf = (view) => `${view.place?.id ?? ""}|${view.place?.drawn ?? 0}`;
// How long a frame may spend drawing while the loading screen's up, and, with nothing going on in the room, how long
// it may spend on the place's other levels, kept whole at the size they'd be shown at.
const LOAD_TIME = 40;
const SPARE_TIME = 6;

// A level of the place: its view, scene and pictures, once there are any.
function levelEntry(level) {
  iso.place ??= { key: null, levels: new Map(), loading: null };
  if (!iso.place.levels.has(level)) iso.place.levels.set(level, { view: null, scene: null, sceneId: null, pictures: [] });
  return iso.place.levels.get(level);
}

// A level as the server describes it (src/walk.js, levelLook), with its scene made for drawing it.
function addLevel(view) {
  const entry = levelEntry(levelKeyOf(view));
  if (entry.sceneId === sceneIdOf(view)) return;
  Object.assign(entry, { view, scene: buildScene(view), sceneId: sceneIdOf(view), pictures: [] });
}

// A level's picture as it should be now: at the size it's shown at with the wheel at rest in a view of this size.
function wantedPicture(entry, { width, height, ratio }) {
  const unit = wholeUnitFor(entry.scene, ratio, restUnitFor(entry.scene, width, height));
  const key = `${entry.sceneId}|${unit}|${ratio}|${pixelKey()}|${packKey()}`;
  let picture = entry.pictures.find((one) => one.key === key);
  if (!picture) {
    picture = newPicture(entry.view, unit, ratio, TILE, key, { scene: entry.scene, sceneId: entry.sceneId });
    entry.pictures.push(picture);
    entry.pictures = keptPictures(entry.pictures, picture);
  }
  return picture;
}

// Draws the place's levels' missing tiles, the one on screen first, until a moment. Whether they're all whole, and how
// many tiles there are and are drawn.
function drawLevels(until, size, first) {
  const entries = [...iso.place.levels.entries()].filter(([, entry]) => entry.scene).sort(([a], [b]) => (a === first ? -1 : b === first ? 1 : 0));
  const pictures = entries.map(([, entry]) => [entry, wantedPicture(entry, size)]);
  let whole = true;
  for (const [entry, picture] of pictures) {
    for (let ty = 0; ty < picture.rows && performance.now() < until; ty += 1) {
      for (let tx = 0; tx < picture.cols && performance.now() < until; tx += 1) tileOf(picture, tx, ty);
    }
    if (picture.tiles.size < picture.total) whole = false;
    else if (entry.pictures.length > 1) entry.pictures = [picture];
  }
  return { whole, total: pictures.reduce((sum, [, one]) => sum + one.total, 0), drawn: pictures.reduce((sum, [, one]) => sum + one.tiles.size, 0) };
}

// A place arrives: whatever was loaded of the one before goes, all of it, and this one is loaded, the level the
// player's on from the room view itself, the rest as the server has them (iso.hooks.levels).
function beginPlace(view, key) {
  hideLoading();
  iso.place = { key, levels: new Map(), loading: { ready: false, name: view.place?.name ?? "", levels: 0, what: view.here.deck ? "decks" : "rooms" } };
  Object.assign(iso, { scene: null, sceneId: null, sceneLevel: null, room: null, far: null, lightmap: null, materials: null, camera: null, you: null, shown: new Map(), doors: new Map(), hits: [] });
  addLevel(view);
  const place = iso.place;
  const asked = iso.hooks.levels ? Promise.resolve().then(() => iso.hooks.levels()) : Promise.resolve(null);
  asked.then((data) => {
    if (iso.place !== place) return;
    for (const one of Object.values(data?.levels ?? {})) if (!place.levels.get(levelKeyOf(one))?.scene) addLevel(one);
    Object.assign(place.loading, { ready: true, name: data?.name ?? place.loading.name, levels: place.levels.size });
  }).catch(() => {
    // Without the others, the level the player's on is loaded by itself, and the others are drawn as they're walked into.
    if (iso.place === place) Object.assign(place.loading, { ready: true, levels: place.levels.size });
  });
}

// The loading screen while the place is drawn, under the Story board and the map editor, which have the screen while
// they're open. True while it isn't loaded yet, and nothing of it is to be drawn.
function loadingPlace(view) {
  if (iso.place?.key !== placeKeyOf(view)) beginPlace(view, placeKeyOf(view));
  const { loading } = iso.place;
  if (!loading) return false;
  const size = sizeCanvas();
  const covered = Boolean(document.getElementById("board") || document.getElementById("mapedit"));
  if (!loading.ready || !size.width || !size.height) {
    if (!covered) showLoading(loading);
    return true;
  }
  const { whole, total, drawn } = drawLevels(performance.now() + LOAD_TIME, size, levelKeyOf(view));
  if (!whole) {
    if (covered) hideLoading();
    else showLoading({ ...loading, share: total ? drawn / total : 0 });
    return true;
  }
  iso.place.loading = null;
  hideLoading();
  iso.fadeFrom = performance.now();
  iso.redraw = true;
  iso.hooks.loaded?.();
  return false;
}

// Whether a place's map is being loaded now, behind the loading screen, or is about to be, the room on screen being of a
// place that isn't loaded yet: the clock waits, nobody walks, and a story that hasn't begun waits to begin.
export function isoLoading() {
  if (!iso.canvas?.isConnected) return false;
  const view = iso.hooks?.view?.();
  if (!view) return false;
  return !iso.place || iso.place.key !== placeKeyOf(view) || Boolean(iso.place.loading);
}

// A game loaded or begun: whatever was loaded of the place before goes, and the place is loaded again for this game,
// even if it's the same place.
export function resetIso() {
  hideLoading();
  Object.assign(iso, { place: null, scene: null, sceneId: null, sceneLevel: null, room: null, far: null, lightmap: null, materials: null, hits: [] });
}

// People glide from square to square, and the player a good deal more quickly.
function ease(current, goal, dt, time) {
  const by = 1 - Math.exp(-dt / time);
  current.x += (goal.x - current.x) * by;
  current.y += (goal.y - current.y) * by;
  if (Math.abs(goal.x - current.x) < 0.01) current.x = goal.x;
  if (Math.abs(goal.y - current.y) < 0.01) current.y = goal.y;
}

function moveOne(shown, goal, dt, time) {
  const beforeX = shown.x;
  const beforeY = shown.y;
  ease(shown, goal, dt, time);
  const dx = shown.x - beforeX;
  const dy = shown.y - beforeY;
  const went = Math.abs(dx) * CELL_WIDTH + Math.abs(dy);
  shown.step += went * 5;
  shown.walking = went > 0;
  faceAlong(shown, dx, dy);
  return went > 0;
}

// The player is drawn right where they are, since their own walking is smooth already. A jump, such as the server
// putting them somewhere, isn't a walk.
function placeYou(you, spot) {
  const dx = spot.x - you.x;
  const dy = spot.y - you.y;
  you.x = spot.x;
  you.y = spot.y;
  const went = Math.abs(dx) * CELL_WIDTH + Math.abs(dy);
  you.walking = went > 0 && went < 2;
  if (!you.walking) return went > 0;
  you.step += went * 5;
  faceAlong(you, dx, dy);
  return true;
}

function moveEveryone(view, dt) {
  let moving = false;
  const spot = iso.hooks.spot();
  if (!iso.you || iso.calm) iso.you = { x: spot.x, y: spot.y, step: 0, back: false, flip: false };
  iso.youMoving = placeYou(iso.you, spot);
  if (iso.youMoving) moving = true;
  const here = new Set();
  for (const person of view.people) {
    here.add(person.key);
    let shown = iso.shown.get(person.key);
    if (!shown || iso.calm) {
      const seed = hashOf(person.x, person.y);
      shown = { x: person.x, y: person.y, step: seed * 6, back: seed > 0.5, flip: seed % 0.25 > 0.125, look: lookFor(person.key, person.color, person.crowd) };
      iso.shown.set(person.key, shown);
    }
    if (moveOne(shown, person, dt, 200)) moving = true;
  }
  for (const key of iso.shown.keys()) if (!here.has(key)) iso.shown.delete(key);
  return moving;
}

function sizeCanvas() {
  const { canvas } = iso;
  // However big the interface is being drawn, so that the room stays sharp.
  const ratio = (window.devicePixelRatio || 1) * scaleOfCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  return { width, height, ratio };
}

// The whole room if it fits at a sensible size. If not, the camera stays with the player, and with
// whoever's talking to them. Anything the popups cover at the bottom doesn't count as room, and nor does what the
// room's own panel covers on the right: the camera keeps to the rest, without the size changing.
function aim(width, height, dt) {
  const { bounds } = iso.scene;
  const seen = height - Math.min(iso.covered, height * 0.75);
  const across = width - Math.min(iso.coverRight, width * 0.5);
  const spanU = bounds.maxU - bounds.minU;
  const spanV = bounds.maxV - bounds.minV;
  // The size with the wheel at rest, which the whole level's picture is drawn at, and the size the wheel has it at.
  const rest = restUnitFor(iso.scene, width, height);
  iso.restUnit = rest;
  const unit = Math.round(rest * iso.zoom);
  iso.unit = unit;
  const { wx, wy } = cellCentre(iso.you.x, iso.you.y);
  let here = project(wx, wy);
  const them = iso.focus && iso.shown.get(iso.focus);
  if (them) {
    const spot = cellCentre(them.x, them.y);
    const there = project(spot.wx, spot.wy);
    const both = Math.abs(there.u - here.u) * unit < across * 0.85 && Math.abs(there.v - here.v) * unit < seen * 0.8;
    here = both ? { u: (here.u + there.u) / 2, v: (here.v + there.v) / 2 } : there;
  }
  const onAxis = (at, low, span, room) => {
    const size = room / unit;
    if (span + 1 <= size) return low + span / 2;
    return Math.max(low - 0.5 + size / 2, Math.min(low + span + 0.5 - size / 2, at));
  };
  const goal = { u: onAxis(here.u, bounds.minU, spanU, across), v: onAxis(here.v, bounds.minV, spanV, seen) };
  if (!iso.camera || iso.calm) iso.camera = { ...goal };
  const by = 1 - Math.exp(-dt / 160);
  iso.camera.u += (goal.u - iso.camera.u) * by;
  iso.camera.v += (goal.v - iso.camera.v) * by;
  // The room slides aside for a floating window, and back once it's gone, at the same pace.
  const slide = clearNudge(width, seen);
  if (iso.calm) iso.nudge = { ...slide };
  iso.nudge.x += (slide.x - iso.nudge.x) * by;
  iso.nudge.y += (slide.y - iso.nudge.y) * by;
  if (Math.abs(slide.x - iso.nudge.x) < 0.5 && Math.abs(slide.y - iso.nudge.y) < 0.5) iso.nudge = { ...slide };
  else iso.redraw = true;
  iso.drawnNudge = { x: Math.round(iso.nudge.x), y: Math.round(iso.nudge.y) };
  // Whole pixels, so that the texture on the floor stays crisp while the camera moves.
  return { ox: Math.round(across / 2 - iso.camera.u * unit) + iso.drawnNudge.x, oy: Math.round(seen / 2 - iso.camera.v * unit) + iso.drawnNudge.y };
}

// How far to slide the room so that what a floating window is about shows beside it, not under it: the least of down,
// up, left or right that puts it clear of the window and still in view, or nothing when it's already clear or can't be.
// The strip along the top, where the clock and the notes sit, doesn't count as in view. Where it was last drawn says
// where it is, less the slide it was drawn with.
const CLEAR_MARGIN = 30;
const CLEAR_EDGE = 24;
const CLEAR_TOP = 110;
function clearNudge(width, seen) {
  const clear = iso.clear;
  if (!clear) return { x: 0, y: 0 };
  const hit = iso.hits.find((one) => one.key === clear.key);
  if (!hit) return clear.last ?? { x: 0, y: 0 };
  const p = { x: hit.x + hit.w / 2 - iso.drawnNudge.x, y: hit.y + hit.h / 2 - iso.drawnNudge.y };
  const box = { left: clear.left - CLEAR_MARGIN, top: clear.top - CLEAR_MARGIN, right: clear.right + CLEAR_MARGIN, bottom: clear.bottom + CLEAR_MARGIN };
  let slide = { x: 0, y: 0 };
  if (p.x > box.left && p.x < box.right && p.y > box.top && p.y < box.bottom) {
    const fits = (t) => p.x + t.x >= CLEAR_EDGE && p.x + t.x <= width - CLEAR_EDGE && p.y + t.y >= CLEAR_TOP && p.y + t.y <= seen - CLEAR_EDGE;
    const options = [{ x: 0, y: box.bottom - p.y }, { x: 0, y: box.top - p.y }, { x: box.left - p.x, y: 0 }, { x: box.right - p.x, y: 0 }].filter(fits);
    if (options.length) slide = options.reduce((best, t) => (Math.hypot(t.x, t.y) < Math.hypot(best.x, best.y) ? t : best));
  }
  clear.last = slide;
  return slide;
}

function drawWater(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  if (!scene.water.length) return;
  const deep = mix("#0c2230", scene.colors.scenery, 0.1);
  const deeper = mix("#102a3a", scene.colors.scenery, 0.1);
  const wave = see(mix("#7fc8e8", scene.colors.scenery, 0.25), 0.4);
  for (const cell of scene.water) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const corner = at(x0, cell.y);
    if (!painter.seen?.(corner, unit * 2)) continue;
    polygon(ctx, [corner, at(x1, cell.y), at(x1, cell.y + 1), at(x0, cell.y + 1)], (Math.floor(cell.x / 2) + cell.y) % 2 ? deep : deeper);
    const swell = Math.sin(now / 900 + cell.seed * 40 + cell.x * 0.35 + cell.y * 0.8);
    if (swell > 0.45) {
      const c = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
      ctx.strokeStyle = wave;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c[0] - unit * 0.14, c[1] - unit * 0.02);
      ctx.quadraticCurveTo(c[0], c[1] + unit * 0.04 * swell, c[0] + unit * 0.14, c[1] - unit * 0.02);
      ctx.stroke();
    }
  }
}

// Whatever's burning, under the edges of whatever it's burning in.
function drawGlows(painter, now) {
  const { ctx, at } = painter;
  const { scene } = iso;
  const fire = hexOr(scene.look.fire, FALLBACK_LOOK.fire);
  for (const cell of scene.glows) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const corner = at(x0, cell.y);
    if (!painter.seen?.(corner, painter.unit * 2)) continue;
    const flicker = iso.calm ? 0.5 : 0.5 + 0.5 * Math.sin(now / (240 + cell.seed * 420) + cell.seed * 30);
    polygon(ctx, [corner, at(x1, cell.y), at(x1, cell.y + 1), at(x0, cell.y + 1)], mix(scaled(fire, 0.55), scaled(fire, 1.25), flicker));
  }
}

// A soft glow, made once and used for every lamp and every flame.
function glowSprite(color) {
  return madeOnce(`glow|${color}`, (ctx, size) => {
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, see(color, 0.9));
    glow.addColorStop(0.25, see(color, 0.32));
    glow.addColorStop(1, see(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  });
}

// What shines through the dark: this goes on after the light in the room, so that it isn't dimmed by it.
function drawShining(painter, now, view) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  ctx.globalCompositeOperation = "lighter";
  for (const fixture of scene.fixtures) {
    // A lamp in a room with its lights out doesn't shine.
    if (fixture.off) continue;
    if (!painter.seen?.(at((fixture.x + 0.5) * CELL_WIDTH, fixture.y + 0.5, 1), unit * 2)) continue;
    const { middle } = fixtureCorners(painter, fixture);
    const size = unit * 0.9;
    ctx.drawImage(glowSprite(vivid(fixture.color)), middle[0] - size / 2, middle[1] - size / 2, size, size);
  }
  const flame = glowSprite(vivid(hexOr(scene.look.fire, FALLBACK_LOOK.fire)));
  ctx.globalAlpha = iso.calm ? 0.5 : 0.42 + 0.14 * Math.sin(now / 300);
  for (const cell of scene.glows) {
    if (cell.seed < 0.5) continue;
    const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5, 0.1);
    if (!painter.seen?.([x, y], unit * 2)) continue;
    const size = unit * 1.1;
    ctx.drawImage(flame, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  // When the ship hasn't the power it wants, the screens that still have it stutter.
  if (view?.power?.short && !iso.calm) {
    const screen = glowSprite("#86dcff");
    for (const block of scene.blocks) {
      if (block.style !== "piece" || block.off || !SCREENS[block.kind]) continue;
      const point = block.face === "e" ? at((block.wallX + 1) * CELL_WIDTH, block.wallY + 0.5, SCREENS[block.kind]) : block.face === "s" ? at((block.wallX + 0.5) * CELL_WIDTH, block.wallY + 1, SCREENS[block.kind]) : at((block.x0 + block.x1) / 2, (block.y0 + block.y1) / 2, SCREENS[block.kind]);
      if (!painter.seen?.(point, unit) || flickering(now, block.seed)) continue;
      const size = unit * 0.7;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(screen, point[0] - size / 2, point[1] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
}

// Which pieces have a screen that flickers, and how high its glass is.
const SCREENS = { desk: 0.92, screen: 1.0, "wall-screen": 1.08, "plot-table": 0.9 };
// Whether something flickering is dark this moment: off now and then, irregularly, a little differently for each.
const flickering = (now, seed) => Math.sin(now / 83 + seed * 70) * Math.sin(now / 211 + seed * 13) > 0.25;

function drawSparks(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  for (const spark of scene.sparks) {
    const c = at((spark.x + spark.seed) * CELL_WIDTH, spark.y + 1 - spark.seed);
    if (!painter.seen?.(c, unit)) continue;
    const glow = 0.45 + 0.55 * Math.abs(Math.sin(now / 1400 + spark.seed * 30));
    ctx.fillStyle = see(scene.colors.writing, glow);
    const size = spark.mark === "*" ? unit * 0.05 : unit * 0.028;
    ctx.fillRect(c[0] - size / 2, c[1] - size / 2, size, size);
  }
}

// The little lights on the machines, which are the only thing in the room that moves by itself.
function drawLights(painter, now, view) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  const short = Boolean(view?.power?.short);
  for (const block of scene.blocks) {
    if (block.style !== "machine" || block.seed < 0.55 || block.off) continue;
    // When the ship hasn't the power it wants, the consoles' lights stutter.
    if (short && !iso.calm && flickering(now, block.seed)) continue;
    const middle = at((block.x + 0.5) * CELL_WIDTH, block.y + 0.5, block.h);
    if (!painter.seen?.(middle, unit)) continue;
    const lit = 0.3 + 0.7 * Math.abs(Math.sin(now / (500 + block.seed * 1500) + block.seed * 20));
    ctx.fillStyle = see(block.seed > 0.8 ? "#f0c060" : scene.look.glow, lit);
    ctx.fillRect(middle[0] - unit * 0.02, middle[1] - unit * 0.012, unit * 0.04, unit * 0.024);
  }
}

// The dark round the edges of the view, made once for its size.
function vignetteFor(width, height, ratio) {
  const key = `${width}x${height}@${ratio}`;
  if (iso.vignette?.key !== key) {
    const canvas = newCanvas(width * ratio, height * ratio);
    const vctx = canvas.getContext("2d");
    vctx.scale(ratio, ratio);
    const edges = vctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.45, width / 2, height / 2, Math.max(width, height) * 0.72);
    edges.addColorStop(0, "rgba(0,0,0,0)");
    edges.addColorStop(1, "rgba(0,0,0,.3)");
    vctx.fillStyle = edges;
    vctx.fillRect(0, 0, width, height);
    iso.vignette = { key, canvas };
  }
  return iso.vignette.canvas;
}

// The colour of the mark over someone who has something to ask: the ship's amber, apart from the gold of things.
const ASKS_COLOR = "#ffa94d";

function chip(ctx, text, x, y, color, { background = "rgba(4,6,5,.62)", size = 11, width, height }) {
  ctx.font = `700 ${size}px ${FONT}`;
  const wide = ctx.measureText(text).width + 8;
  const left = Math.max(2, Math.min(width - wide - 2, x - wide / 2));
  const top = Math.max(2, Math.min(height - size - 8, y - size - 6));
  ctx.fillStyle = background;
  ctx.fillRect(left, top, wide, size + 5);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 4, top + (size + 5) / 2 + 0.5);
  return { x: left, y: top, w: wide, h: size + 5 };
}

function draw(now, dt) {
  const { canvas } = iso;
  const view = iso.hooks.view();
  const { width, height, ratio } = sizeCanvas();
  if (!width || !height) return;
  const { scene } = iso;
  const ctx = canvas.getContext("2d");
  const { ox, oy } = aim(width, height, dt);
  const { unit } = iso;
  const room = stillPicture(view, ratio);
  // The level small is only wanted under a picture with gaps: one loaded with the place is whole.
  const far = room.tiles.size >= room.total ? null : farPicture(view, ratio);
  // The whole level's picture, scaled to the size the view is at.
  const scale = unit / room.unit;
  const painter = painterFor(ctx, ratio, unit, ox, oy);
  const { at } = painter;
  // Whether a point, in the canvas's own measure, is on the screen or near enough to show: what's drawn every frame
  // is only drawn where it can be seen, which on a deck leaves most of it out.
  painter.seen = (point, margin = unit) => point[0] > -margin && point[0] < width + margin && point[1] > -margin && point[1] < height + margin;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  painter.flat();

  drawWater(painter, now);
  drawSparks(painter, now);
  drawGlows(painter, now);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawStill(ctx, room, far, ox, oy, ratio, canvas.width, canvas.height, now);
  painter.flat();
  drawLights(painter, now, view);
  drawPartLights(painter, now, view);

  // Where the mouse is, if that's somewhere to walk.
  if (iso.hover?.kind === "floor" && (iso.hooks.fighting?.() || (!iso.hooks.blocked() && !iso.hooks.reading?.()))) {
    const { x, y } = iso.hover;
    if (walkable(scene.kinds[y]?.[x])) {
      const x0 = x * CELL_WIDTH;
      ctx.beginPath();
      for (const [wx, wy] of [[x0, y], [x0 + CELL_WIDTH, y], [x0 + CELL_WIDTH, y + 1], [x0, y + 1]]) ctx.lineTo(...at(wx, wy));
      ctx.closePath();
      ctx.strokeStyle = "rgba(230,225,190,.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Everyone, from the back of the room to the front, with whatever's in front of each of them put back over them.
  const figures = [];
  const extras = [];
  // Someone standing still on a seat sits in it, the way it faces; someone asleep or laid up on a bed lies in it.
  const sitIn = (figure, walking) => {
    const seat = walking ? null : restingOn(scene, figure.wx, figure.wy);
    const sitting = seat && sittingIn(seat, figure.wx, figure.wy);
    if (!sitting) return figure;
    Object.assign(figure, { wx: sitting.wx, wy: sitting.wy, seat, pose: sitting.pose });
    // In a chair they're drawn just after it; on a bed's edge, by where they sit, in front of it.
    figure.depth = FURNITURE_BY_ID[seat.kind].bed ? sitting.wx + sitting.wy : seat.depth + 0.01;
    if (sitting.over) extras.push({ type: "seatback", block: seat, tag: sitting.over, depth: figure.depth + 0.01 });
    return figure;
  };
  const youAt = cellCentre(iso.you.x, iso.you.y);
  figures.push(sitIn({ type: "you", wx: youAt.wx, wy: youAt.wy, depth: youAt.wx + youAt.wy }, iso.you.walking));
  // In a fight in the room, whoever's in it is drawn as a fighter (public/live-fight.js), and only once.
  const fighting = iso.hooks.fightHidden?.() ?? null;
  const beds = new Map();
  for (const person of view.people) {
    const shown = iso.shown.get(person.key);
    if (!shown || fighting?.has(person.key)) continue;
    const { wx, wy } = cellCentre(shown.x, shown.y);
    const lying = person.asleep || person.down;
    if (lying && !person.carried && !shown.walking) {
      const bed = restingOn(scene, wx, wy);
      // A bed of the packs, or one they draw, says how many it takes (public/pixel-art.js).
      const room = !FURNITURE_BY_ID[bed?.kind]?.bed ? 0 : packBed(bed)?.places.length ?? (bed.kind === "bunk" ? 2 : 1);
      if (room && (beds.get(bed)?.length ?? 0) < room) {
        if (!beds.has(bed)) beds.set(bed, []);
        beds.get(bed).push({ person, look: shown.look, mark: person.down && !person.onCot && !person.carried && !person.dead });
        continue;
      }
    }
    figures.push(lying ? { type: "person", person, shown, wx, wy, depth: wx + wy } : sitIn({ type: "person", person, shown, wx, wy, depth: wx + wy }, shown.walking));
  }
  for (const [bed, sleepers] of beds) extras.push({ type: "bed", block: bed, sleepers: sleepers.sort((a, b) => (a.person.key < b.person.key ? -1 : 1)), depth: bed.depth });
  for (const one of iso.hooks.fighters?.(dt / 1000) ?? []) {
    const { wx, wy } = cellCentre(one.x, one.y);
    figures.push({ type: "fighter", one, wx, wy, depth: wx + wy });
  }
  // What else moves among them, each put in order with them: the doors between rooms, sliding open for whoever comes
  // near and shut behind them; the ship's stores, as crates by how full they are; flames; a hole in the hull.
  const props = [];
  // A door on the move, a fire, a hole in the hull or something sparking wants more than the eight frames a second a
  // still room gets.
  let lively = (scene.fires?.length ?? 0) > 0 || (scene.breaches?.length ?? 0) > 0 || (view.things ?? []).some((thing) => thing.part?.sparks);
  for (const door of scene.doorways ?? []) {
    const key = `${door.x},${door.y}`;
    const { wx, wy } = cellCentre(door.x, door.y);
    const target = doorOpenFor(door, figures);
    const was = iso.doors.get(key) ?? target;
    const open = iso.calm ? target : was + (target - was) * (1 - Math.exp(-dt / 90));
    iso.doors.set(key, Math.abs(open - target) < 0.01 ? target : open);
    if (open !== target) lively = true;
    // The pixel-art test's door is drawn open as well as shut, since it's the doorway's frame too, in the front of the
    // doorway (public/pixel-art.js).
    if (pixelArtOn()) {
      if (!painter.seen(at(wx, wy, 0.8), unit * 2.5)) continue;
      const pixelDoor = { ...door, kinds: scene.kinds };
      props.push({ type: "prop", draw: () => drawPixelDoor(painter, pixelDoor, open, { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT }), depth: pixelDoorDepth(door, CELL_WIDTH), span: uvBox(door.x - 1, door.y, door.x + 2, door.y + 1, WALL_HEIGHT) });
      continue;
    }
    if (open > 0.97 || !painter.seen(at(wx, wy, 0.8), unit * 2)) continue;
    props.push({ type: "prop", draw: () => drawDoorPanels(painter, door, open, scene.style), depth: wx + wy - 0.39, span: uvBox(door.x, door.y, door.x + 1, door.y + 1, WALL_HEIGHT) });
  }
  // A camera that works turns on its bracket in the pixel-art view (the pack draws it sixteen ways), slowly, each from
  // its own place in the round; with it, its red light.
  if (pixelArtOn()) {
    for (const thing of view.things ?? []) {
      if (!cameraTurns(thing.part)) continue;
      const { wx, wy } = cellCentre(thing.x, thing.y);
      if (!painter.seen(at(wx, wy, 1.4), unit * 2)) continue;
      const frame = iso.calm ? 0 : Math.floor(now / 420 + thing.x * 5 + thing.y * 3) % 16;
      const blink = iso.calm || Math.floor(now / 700 + thing.x) % 2 === 0;
      props.push({ type: "prop", draw: () => cameraProp(painter, thing, frame, blink), depth: wx + wy + 0.02, span: uvBox(thing.x - 1, thing.y - 1, thing.x + 2, thing.y + 2, WALL_HEIGHT) });
    }
  }
  for (const thing of view.things ?? []) {
    if (!thing.stock?.goods || thing.looks) continue;
    const { wx, wy } = cellCentre(thing.x, thing.y);
    if (!painter.seen(at(wx, wy, 0.3), unit * 2)) continue;
    props.push({ type: "prop", draw: () => drawStoreCrates(painter, thing), depth: wx + wy + 0.001, span: uvBox(thing.x, thing.y, thing.x + 1, thing.y + 1, 0.6) });
  }
  for (const fire of scene.fires ?? []) {
    const { wx, wy } = cellCentre(fire.x, fire.y);
    if (!painter.seen(at(wx, wy, 0.4), unit * 2)) continue;
    props.push({ type: "prop", draw: () => drawFlames(painter, fire, now), depth: wx + wy + 0.02, span: uvBox(fire.x - 1, fire.y, fire.x + 2, fire.y + 1, 1.3) });
  }
  for (const breach of scene.breaches ?? []) {
    const { wx, wy } = cellCentre(breach.x, breach.y);
    if (!painter.seen(at(wx, wy, 0.8), unit * 3)) continue;
    props.push({ type: "prop", draw: () => drawBreachHole(painter, breach, now), depth: wx + wy + 0.4, span: uvBox(breach.x, breach.y, breach.x + 2, breach.y + 2, 1.4) });
  }
  iso.lively = lively;
  const covering = new Set();
  const cover = (depth, minU, maxU, minV, maxV, own) => {
    for (const block of scene.blocks) {
      if (block.depth <= depth || block.style === "plants" || block === own) continue;
      const { span } = block;
      if (span.maxU > minU && span.minU < maxU && span.maxV > minV && span.minV < maxV) covering.add(block);
    }
  };
  for (const figure of figures) {
    const { u, v } = project(figure.wx, figure.wy);
    cover(figure.depth, u - 0.25, u + 0.25, v - 0.95, v + 0.05, figure.seat);
  }
  for (const extra of extras) if (extra.type === "bed") cover(extra.depth, extra.block.span.minU, extra.block.span.maxU, extra.block.span.minV, extra.block.span.maxV, extra.block);
  for (const prop of props) cover(prop.depth, prop.span.minU, prop.span.maxU, prop.span.minV, prop.span.maxV, null);
  // A bed with someone in it is drawn with them, never again without them.
  for (const extra of extras) if (extra.type === "bed") covering.delete(extra.block);
  const order = [...figures, ...covering, ...extras, ...props].sort((a, b) => a.depth - b.depth);
  const hits = [];
  const hoverKey = iso.hover?.key;
  for (const item of order) {
    if (item.type === "block") drawBlock(painter, item, iso.materials);
    else if (item.type === "seatback") {
      // In the pixel-art test a chair seen from behind is one picture, so all of it goes over whoever's sitting in it.
      // A bed the packs draw is one picture too, but it's behind whoever sits on its edge: nothing of it goes over them.
      if (item.tag === "over" && packBed(item.block)?.pictured) continue;
      if (!drawPixelPiece(painter, item.block, { wallHeight: WALL_HEIGHT, ...lookOfPiece(item.block) })) drawPiece(painter, item.block, { only: item.tag ?? "back", sleepers: beds.get(item.block) ?? null });
    }
    else if (item.type === "prop") item.draw();
    else if (item.type === "bed") {
      for (const one of item.sleepers) one.ring = hoverKey === `person:${one.person.key}` ? "rgba(255,250,220,.9)" : null;
      // A bed of the packs is in the room's picture already: only whoever's asleep in it is drawn, into it.
      const packs = packBed(item.block);
      if (packs) drawPackSleepers(painter, item.block, item.sleepers, packs);
      else drawPiece(painter, item.block, { sleepers: item.sleepers });
      for (const one of item.sleepers) {
        if (!one.at) continue;
        const [x, y] = one.at;
        hits.push({ kind: "person", key: `person:${one.person.key}`, person: one.person, x: x - unit * 0.3, y: y - unit * 0.3, w: unit * 0.6, h: unit * 0.5, floorX: x, floorY: y + unit * 0.1 });
      }
    } else if (item.type === "fighter") {
      const { one, wx, wy } = item;
      const [x, y] = at(wx, wy);
      const fig = figureUnit(unit);
      const look = (one.person && iso.shown.get(one.person)?.look) ?? fighterLook(one);
      ctx.save();
      ctx.globalAlpha = one.fade ?? 1;
      drawPerson(ctx, x, y, fig, { look, flip: one.flip, back: one.back, walking: one.walking, step: one.step, asleep: one.down, ring: hoverKey === `fighter:${one.key}` && !one.down ? "rgba(255,250,220,.95)" : one.ring });
      ctx.restore();
      if (!one.down) hits.push({ kind: "fighter", key: `fighter:${one.key}`, fighter: one.key, side: one.side, x: x - fig * 0.22, y: y - fig * 0.92, w: fig * 0.44, h: fig, floorX: x, floorY: y, tall: fig });
    } else if (item.type === "person") {
      const { person, shown, wx, wy } = item;
      const [x, y] = at(wx, wy);
      const fig = figureUnit(unit);
      const hovered = hoverKey === `person:${person.key}`;
      drawPerson(ctx, x, y, fig, { look: shown.look, flip: shown.flip, back: shown.back, walking: shown.walking, step: shown.step, asleep: person.asleep || person.down, mark: person.down && !person.onCot && !person.carried && !person.dead, ring: hovered ? "rgba(255,250,220,.9)" : null, ...item.pose });
      hits.push({ kind: "person", key: `person:${person.key}`, person, x: x - fig * 0.22, y: y - fig * 0.92, w: fig * 0.44, h: fig * 1, floorX: x, floorY: y, tall: fig });
    } else {
      const [x, y] = at(item.wx, item.wy);
      const fig = figureUnit(unit);
      hits.push({ kind: "you", key: "person:you", x: x - fig * 0.22, y: y - fig * 0.92, w: fig * 0.44, h: fig, floorX: x, floorY: y, tall: fig });
      drawPerson(ctx, x, y, fig, { look: YOU_LOOK, flip: iso.you.flip, back: iso.you.back, walking: iso.you.walking, step: iso.you.step, ring: "rgba(180,240,190,.8)", ...item.pose });
    }
  }

  // The light in the room falls on everything, moving or not.
  const [youX, youY] = at(youAt.wx, youAt.wy);
  painter.flat();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(iso.lightmap.canvas, ox + room.left * scale, oy + room.top * scale, room.width * scale, room.height * scale);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.14;
  ctx.drawImage(iso.lightmap.haze, ox + room.left * scale, oy + room.top * scale, room.width * scale, room.height * scale);
  ctx.globalAlpha = 1;
  drawShining(painter, now, view);
  drawAfterLight(painter, now, view);
  // The player can always see a little way around themselves: a soft glow made once, drawn over them, rather than a
  // gradient laid over the whole screen every frame.
  ctx.globalCompositeOperation = "overlay";
  const lantern = madeOnce("lantern", (lctx, size) => {
    const glow = lctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, "rgba(255,240,215,.42)");
    glow.addColorStop(1, "rgba(255,240,215,0)");
    lctx.fillStyle = glow;
    lctx.fillRect(0, 0, size, size);
  });
  const reach = unit * 3.2;
  ctx.drawImage(lantern, youX - reach, youY - unit * 0.3 - reach, reach * 2, reach * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(vignetteFor(width, height, ratio), 0, 0, width, height);

  // Bad air hangs in the room, and a ringing alarm washes it red.
  const here = view.room;
  if (here?.thin) {
    ctx.fillStyle = `rgba(118,126,88,${Math.min(0.34, (100 - here.air) / 190)})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (here?.alarm) {
    const beat = iso.calm ? 0.5 : 0.5 + 0.5 * Math.sin(now / 240);
    ctx.fillStyle = `rgba(210,36,24,${(here.alarm.here ? 0.12 : 0.06) * (0.35 + beat * 0.65)})`;
    ctx.fillRect(0, 0, width, height);
  }

  // Names go on top of everything, so they can always be read, and only when they're wanted.
  const clip = { width, height };
  const writing = mix(hexOr(scene.colors.writing, FALLBACK_COLORS.writing), "#c8c4b0", 0.5);
  for (const exit of view.exits) {
    const { wx, wy } = cellCentre(exit.x, exit.y);
    // A way out's name goes on the far side of it, out of the way of whoever's standing beside it.
    const away = { v: [-0.5, 0.5], "^": [0.5, -0.5], "<": [-0.7, -0.35], ">": [0.7, 0.35] }[exit.glyph] ?? [0, 0];
    const [x, y] = at(wx + away[0], wy + away[1], 0.2);
    const hovered = hoverKey === `exit:${exit.key}`;
    const rect = chip(ctx, `${exit.glyph} ${exit.label}`, x, y, hovered ? BACKGROUND : exit.closed ? "#c88a70" : writing, { background: hovered ? writing : undefined, ...clip });
    hits.push({ kind: "exit", key: `exit:${exit.key}`, exit, ...rect });
  }
  for (const thing of view.things) {
    if (thing.part) {
      const part = thing.part;
      const wall = part.mount === "wall";
      const [x, y] = wall
        ? part.face === "side" ? at((thing.x + 1) * CELL_WIDTH, thing.y + 0.5, partLook(thing).z1 + 0.15) : at((thing.x + 0.5) * CELL_WIDTH, thing.y + 1, partLook(thing).z1 + 0.15)
        : at((thing.x + 0.5) * CELL_WIDTH, thing.y + 0.5, 1.15);
      if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
      const hovered = hoverKey === `thing:${thing.id}`;
      const near = Math.abs(thing.x - iso.you.x) * CELL_WIDTH + Math.abs(thing.y - iso.you.y) < 5;
      const tone = part.ringing ? "#ff6050" : part.works ? "#7fd8e0" : "#e0a050";
      const text = hovered ? `${thing.name}: ${part.word}` : near ? PART_WORDS[part.kind] ?? "part" : "·";
      const rect = chip(ctx, text, x, y, hovered ? BACKGROUND : tone, { background: hovered ? tone : "rgba(4,6,5,.5)", size: hovered || near ? 10 : 9, ...clip });
      hits.push({ kind: "thing", key: `thing:${thing.id}`, thing, ...rect });
      continue;
    }
    if (thing.onPiece || thing.quiet) {
      // A piece of furniture that opens, or a container a room was given (src/loot.js), has a quiet mark like a part's:
      // a dot from across the room, what it is from close by (or that it's empty), and its name under the mouse.
      const { wx, wy } = cellCentre(thing.x, thing.y);
      const [x, y] = at(wx, wy, 0.7);
      if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
      const hovered = hoverKey === `thing:${thing.id}`;
      const near = Math.abs(thing.x - iso.you.x) * CELL_WIDTH + Math.abs(thing.y - iso.you.y) < 5;
      const what = thing.empty ? "empty" : thing.name.replace(/^(a|an|the) /i, "").toLowerCase();
      const rect = chip(ctx, hovered ? thing.name : near ? what : "·", x, y, hovered ? BACKGROUND : "#e8c060", { background: hovered ? "#e8c060" : "rgba(4,6,5,.5)", size: hovered || near ? 10 : 9, ...clip });
      hits.push({ kind: "thing", key: `thing:${thing.id}`, thing, ...rect });
      continue;
    }
    const { wx, wy } = cellCentre(thing.x, thing.y);
    const bob = iso.calm ? 0 : Math.sin(now / 600 + thing.x) * unit * 0.02;
    const [x, y] = at(wx, wy, 0.5);
    if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
    const hovered = hoverKey === `thing:${thing.id}`;
    const rect = chip(ctx, hovered ? thing.name : "?", x, y + bob, hovered ? BACKGROUND : "#e8c060", { background: hovered ? "#e8c060" : undefined, size: 12, ...clip });
    hits.push({ kind: "thing", key: `thing:${thing.id}`, thing, ...rect });
  }
  for (const hit of hits.filter((one) => one.kind === "person")) {
    const { person } = hit;
    const hovered = hoverKey === hit.key;
    const shown = iso.shown.get(person.key);
    const near = shown && Math.abs(shown.x - iso.you.x) * CELL_WIDTH + Math.abs(shown.y - iso.you.y) < 5;
    // Someone with something to ask the player has a mark on their tag, seen from across the room (src/requests.js).
    if (!hovered && !person.asks && (person.crowd || person.walking || !near)) continue;
    if (hit.floorX < -8 || hit.floorY < -8 || hit.floorX > width + 8 || hit.floorY - unit > height + 8) continue;
    const name = hovered ? `${person.name}${person.doing ? `, ${person.doing}` : ""}` : person.short;
    const text = person.asks ? (hovered ? `! ${name}: has something to ask you` : near ? `! ${person.short}` : "!") : name;
    const tag = person.asks ? ASKS_COLOR : mix(hexOr(person.color, "#a0a090"), "#d8d4c0", 0.3);
    // The mark is a filled amber box, always, so it can't be taken for the gold ? over things.
    const filled = hovered || person.asks;
    chip(ctx, text, hit.floorX, hit.floorY - (hit.tall ?? unit) * 0.95, filled ? BACKGROUND : tag, { background: filled ? tag : undefined, size: person.asks && !hovered && !near ? 13 : 11, ...clip });
  }

  // Now and then someone near the player says something over their head (src/chatter.js).
  drawChatter(ctx, now, view, hits, clip, unit);

  // A fight in the room puts its health, readiness, names, odds and shots over everything.
  iso.hooks.fightOverlay?.({ ctx, at, unit, hover: hoverKey, chip: (c2, text, x, y, color, opts = {}) => chip(c2, text, x, y, color, { ...clip, ...opts }) });

  // A room the player has just walked into fades up.
  const fade = 1 - (now - iso.fadeFrom) / 300;
  if (fade > 0 && !iso.calm) {
    ctx.fillStyle = `rgba(3,4,3,${fade})`;
    ctx.fillRect(0, 0, width, height);
  }
  iso.hits = hits;
  iso.lastOrigin = { ox, oy };
  iso.hooks.drawn?.();
}

// Who the popups want kept in view, and how much of the bottom of the room they're covering.
export function isoLook({ person = null, bottom = 0 } = {}) {
  if (iso.focus === person && iso.covered === bottom) return;
  iso.focus = person;
  iso.covered = bottom;
  iso.redraw = true;
}

// How much of the room's right side the room's own panel covers, in the canvas's own measure: the camera moves over to
// keep the player in the part that's left. Nothing, and it moves back.
export function isoCover(right = 0) {
  const covered = Math.max(0, Math.round(right));
  if (iso.coverRight === covered) return;
  iso.coverRight = covered;
  iso.redraw = true;
}

// A window floating over the room that's about something in it, by its key, with the window's box in the canvas's own
// measure: the room slides aside to keep that thing clear of it. Nothing, and the room slides back.
export function isoKeepClear(key = null, box = null) {
  const was = iso.clear;
  if (!key || !box) {
    if (was) {
      iso.clear = null;
      iso.redraw = true;
    }
    return;
  }
  const same = was && was.key === key && ["left", "top", "right", "bottom"].every((side) => Math.abs(was[side] - box[side]) < 1);
  if (same) return;
  iso.clear = { key, left: box.left, top: box.top, right: box.right, bottom: box.bottom, last: was?.key === key ? was.last : null };
  iso.redraw = true;
}

// Where a thing, a part or a door was drawn, by its key (thing:<id> or exit:<key>), for putting a pane beside it.
export const isoMark = (key) => iso.hits.find((hit) => hit.key === key) ?? null;

// Where someone is in the view, for putting something over their head.
export function isoSpot(key) {
  return iso.hits.find((hit) => hit.key === `person:${key}`) ?? null;
}

function loop(now) {
  iso.frame = requestAnimationFrame(loop);
  if (!iso.canvas?.isConnected) {
    cancelAnimationFrame(iso.frame);
    iso.frame = 0;
    // A place still loading goes on loading when the room's back on screen, and its loading screen with it.
    hideLoading();
    return;
  }
  const dt = Math.min(100, now - (iso.lastFrame || now));
  iso.lastFrame = now;
  const view = iso.hooks.view();
  if (!view) return;
  // A place that isn't loaded yet is loaded first, behind the loading screen, and nothing of it is drawn until it is.
  if (loadingPlace(view)) return;
  iso.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useScene(view);
  const moving = moveEveryone(view, dt);
  const cameraMoving = iso.camera && iso.lastGoal !== `${Math.round(iso.camera.u * 50)},${Math.round(iso.camera.v * 50)}`;
  iso.lastGoal = iso.camera ? `${Math.round(iso.camera.u * 50)},${Math.round(iso.camera.v * 50)}` : "";
  // Nothing going on: just enough to keep the lights and the water moving.
  // Walking, every frame there is; anything else moving, thirty a second; nothing going on, eight.
  const every = iso.youMoving ? 0 : moving || cameraMoving || iso.redraw || iso.lively || iso.hooks.fighting?.() || now - iso.fadeFrom < 320 ? 1000 / 30 : 1000 / 8;
  if (now - iso.lastDraw < every) return;
  const since = now - iso.lastDraw;
  iso.lastDraw = now;
  iso.redraw = false;
  draw(now, Math.min(100, since));
  lookUnderPointer();
  // With nothing going on, the place's other levels are kept whole at the size they'd be shown at: after the window
  // changes size, say, so that walking into one never shows it being drawn.
  if (!iso.youMoving && !moving && !cameraMoving && iso.room?.tiles.size >= iso.room?.total) drawLevels(performance.now() + SPARE_TIME, sizeCanvas(), iso.sceneLevel);
}

// ---- Pointing and clicking ----------------------------------------------

function underPointer() {
  if (!iso.pointer || !iso.scene) return null;
  const box = iso.canvas.getBoundingClientRect();
  const scale = scaleOfCanvas();
  const px = (iso.pointer.x - box.left) / scale;
  const py = (iso.pointer.y - box.top) / scale;
  // The front of the room first, and names before the people they belong to.
  for (let i = iso.hits.length - 1; i >= 0; i -= 1) {
    const hit = iso.hits[i];
    if (hit.kind === "you") continue;
    if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) return hit;
  }
  if (!iso.lastOrigin) return null;
  const u = (px - iso.lastOrigin.ox) / iso.unit;
  const v = (py - iso.lastOrigin.oy) / iso.unit;
  const { x, y } = cellAt(u, v);
  // The very spot, as a position: its square's corner plus how far into it, less the half that puts a position at a middle.
  const point = { x: (2 * v + u) / CELL_WIDTH - 0.5, y: 2 * v - u - 0.5 };
  return x >= 0 && y >= 0 && x < iso.scene.cols && y < iso.scene.lines ? { kind: "floor", x, y, point, key: `floor:${x},${y}` } : null;
}

function titleFor(hit) {
  if (hit?.kind === "fighter") return hit.side === "enemy" ? "Click to go for them." : "";
  if (iso.hooks?.fighting?.()) return "";
  if (hit?.kind === "person" && hit.person.down && !hit.person.awake) return `${hit.person.name}${hit.person.doing ? `, ${hit.person.doing}` : ""}. Click for what you can do.`;
  if (hit?.kind === "person") return `${hit.person.name}${hit.person.doing ? `, ${hit.person.doing}` : ""}. Click to walk over and talk, or right-click for more.`;
  if (hit?.kind === "thing" && hit.thing.part) return `${hit.thing.name}, ${hit.thing.part.word}. Click to walk over and work it, or right-click for more.`;
  if (hit?.kind === "thing") return `${hit.thing.name}. Click to walk over and take a look, or right-click for more.`;
  if (hit?.kind === "exit") return hit.exit.closed ? `${hit.exit.label}. It's closed. Click to walk over and ask, or right-click for more.` : `${hit.exit.label}. Click to go through.`;
  return "";
}

// How much bigger than its own measure the canvas is being drawn on the screen.
function scaleOfCanvas() {
  const width = iso.canvas.clientWidth;
  return width ? iso.canvas.getBoundingClientRect().width / width : 1;
}

function lookUnderPointer() {
  const hit = underPointer();
  if ((hit?.key ?? null) !== (iso.hover?.key ?? null)) iso.redraw = true;
  iso.hover = hit;
  const blocked = iso.hooks.blocked();
  iso.canvas.style.cursor = iso.hooks.fighting?.() ? (hit?.kind === "fighter" && hit.side === "enemy" ? "pointer" : "crosshair") : iso.hooks.reading?.() ? "pointer" : blocked ? "default" : hit && hit.kind !== "floor" ? "pointer" : "crosshair";
  const title = titleFor(hit);
  if (iso.canvas.title !== title) iso.canvas.title = title;
}

function onMove(event) {
  iso.pointer = { x: event.clientX, y: event.clientY };
  lookUnderPointer();
}

function onLeave() {
  iso.pointer = null;
  lookUnderPointer();
}

function onClick(event) {
  iso.pointer = { x: event.clientX, y: event.clientY };
  if (iso.hooks.pressed?.()) return;
  const hit = underPointer();
  // In a fight in the room, a click is an order.
  if (iso.hooks.fightClick?.(hit)) return;
  if (!hit || iso.hooks.blocked()) return;
  if (hit.kind === "floor") iso.hooks.go({ action: "go", x: hit.x, y: hit.y }, null, hit.point);
  // Someone down who can't talk, the dead among them, has their menu instead.
  else if (hit.kind === "person" && hit.person.down && !hit.person.awake) iso.hooks.menu?.(hit.key, { x: event.clientX, y: event.clientY });
  else iso.hooks.go({ action: "go", to: hit.key });
}

// A right-click opens the menu of what can be done with whatever's under the pointer, or with the floor there.
function onContext(event) {
  event.preventDefault();
  iso.pointer = { x: event.clientX, y: event.clientY };
  const hit = underPointer();
  if (hit) iso.hooks.menu?.(hit.key, { x: event.clientX, y: event.clientY });
}

function onWheel(event) {
  event.preventDefault();
  iso.zoom = Math.min(ZOOMS.largest, Math.max(ZOOMS.smallest, iso.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
  iso.redraw = true;
}

// The level, as a canvas that goes where the console art would have gone.
export function isoFrameNode(hooks) {
  iso.hooks = hooks;
  iso.canvas ??= el("canvas", {
    class: "iso-canvas",
    id: "iso-canvas",
    role: "img",
    "aria-label": "The room you're in, drawn from an angle. The list beside it has everyone and everything in it.",
    onclick: onClick,
    oncontextmenu: onContext,
    onpointermove: onMove,
    onpointerleave: onLeave,
    onwheel: onWheel,
  });
  iso.redraw = true;
  if (!iso.frame) iso.frame = requestAnimationFrame(loop);
  return iso.canvas;
}

// ---- Furniture ----------------------------------------------------------------------------------------------------
// The pieces public/furniture.js names, each built of a few shaded boxes in the same light as everything else, turned
// the way it faces. A piece is a block of the scene of its own (style "piece"), so it's put in order with the walls and
// people like any other, throws a soft shadow, and some give off a little light of their own.

const KIT = {
  frame: "#5a636e", frameDark: "#363d46", frameDeep: "#22272d",
  seat: "#2c3948", seatTop: "#3b4c61", seatDark: "#1d2630",
  leather: "#4a3f30", webbing: "#6e6b3c",
  steel: "#6b737b", steelTop: "#828a92", steelDark: "#474e55",
  laminate: "#59636f", laminateEdge: "#3c444d",
  sheet: "#c9cfd1", sheetDark: "#9aa2a5", glass: "#0f3a49", amber: "#ffb45a",
};
// How high each piece stands, in the game's units, and how much of the floor its shadow covers (half across and half
// deep, from its middle, before it's turned).
const PIECE_TOP = { chair: 0.95, bench: 0.5, "command-chair": 1.35, table: 0.76, "long-table": 0.76, desk: 1.1, bunk: 1.5, cot: 0.62, locker: 1.5, shelf: 1.6, "plot-table": 1.5, screen: 1.2, kettle: 1.06, barrel: 0.8, plant: 0.9, basin: 0.86 };
const PIECE_SHADOW = { chair: [0.17, 0.17], bench: [0.92, 0.17], "command-chair": [0.4, 0.4], table: [0.45, 0.45], "long-table": [0.95, 0.43], desk: [0.46, 0.25], bunk: [0.45, 0.95], cot: [0.4, 0.9], locker: [0.2, 0.2], shelf: [0.46, 0.21], "plot-table": [0.46, 0.46], screen: [0.12, 0.08], kettle: [0.42, 0.42], barrel: [0.17, 0.17], plant: [0.14, 0.14], basin: [0.2, 0.16] };
// How much higher than a chair's a seat is, and which way someone sitting in a seat facing each way is drawn.
const SEAT_RAISE = { "command-chair": 0.07 };
const FACING_POSE = { n: { back: true, flip: false }, s: { back: false, flip: true }, e: { back: false, flip: false }, w: { back: true, flip: true } };

// The seat or bed in a scene under a point of the floor, if any.
export function restingOn(scene, wx, wy) {
  scene.seatsAndBeds ??= scene.blocks.filter((block) => block.style === "piece" && (FURNITURE_BY_ID[block.kind]?.seat || FURNITURE_BY_ID[block.kind]?.bed));
  return scene.seatsAndBeds.find((block) => wx > block.x0 && wx < block.x1 && wy > block.y0 && wy < block.y1) ?? null;
}

// How someone who's stopped awake on a seat or a bed is drawn there: where (a chair's middle; their own place along a
// bench; the edge of a bed, on the long side the camera sees), sitting which way, and which of the piece's parts are
// drawn again over them ("back": a chair's back between them and the camera; "over": a bunk's upper bed and its front
// posts, when they sit on the lower). Null for any other piece.
export function sittingIn(seat, wx, wy) {
  const kind = FURNITURE_BY_ID[seat?.kind];
  if (!kind?.seat && !kind?.bed) return null;
  if (kind.bed) {
    // A bed of the packs, or one they draw: on the side of it the camera sees, where they are along it. Its picture is
    // narrower than its place on the floor; as a plain shape it fills it.
    const packs = packBed(seat);
    if (packs) {
      const along = (value, middle) => Math.min(middle + packs.head, Math.max(middle - packs.head, value));
      const top = (packs.places[0]?.z ?? 0.3) + 0.08;
      return {
        wx: packs.run === "x" ? along(wx, packs.cx) : packs.pictured ? packs.cx + 0.3 : seat.x1 - 0.14,
        wy: packs.run === "y" ? along(wy, packs.cy) : packs.pictured ? packs.cy + 0.34 : seat.y1 - 0.2,
        pose: { seated: true, raise: Math.max(-0.25, top - 0.49), ...FACING_POSE[packs.run === "y" ? "e" : "s"] },
        over: null,
      };
    }
    const face = seat.facing === "e" || seat.facing === "w" ? "s" : "e";
    return {
      wx: face === "e" ? seat.x1 - 0.14 : wx,
      wy: face === "s" ? seat.y1 - 0.2 : wy,
      pose: { seated: true, raise: (seat.kind === "cot" ? 0.52 : 0.39) - 0.49, ...FACING_POSE[face] },
      over: seat.kind === "bunk" ? "over" : null,
    };
  }
  const along = seat.kind === "bench" ? (seat.facing === "e" || seat.facing === "w" ? "y" : "x") : null;
  return {
    wx: along === "x" ? wx : (seat.x0 + seat.x1) / 2,
    wy: along === "y" ? wy : (seat.y0 + seat.y1) / 2,
    pose: { seated: true, raise: SEAT_RAISE[seat.kind] ?? 0, ...FACING_POSE[seat.facing ?? "s"] },
    over: seat.facing === "n" || seat.facing === "w" ? "back" : null,
  };
}
const BLANKETS = ["#4a5a44", "#3e4f66", "#6a4a3a", "#5a4f63", "#4d5a5e"];
const SHELF_GOODS = ["#7a6a4e", "#5d6e7a", "#8a5a3a", "#6e7a5a", "#b0a890"];

// Where a part of a piece is on the floor: a0..a1 across it, to the right as someone facing the way it faces sees it,
// and b0..b1 toward its front, both in tiles from its middle.
function partRect(piece, a0, a1, b0, b1) {
  const cx = (piece.x0 + piece.x1) / 2;
  const cy = (piece.y0 + piece.y1) / 2;
  const [[rx, ry], [fx, fy]] = { n: [[1, 0], [0, -1]], s: [[-1, 0], [0, 1]], e: [[0, 1], [1, 0]], w: [[0, -1], [-1, 0]] }[piece.facing ?? "s"];
  const xs = [a0, a1].flatMap((a) => [b0, b1].map((b) => cx + a * rx + b * fx));
  const ys = [a0, a1].flatMap((a) => [b0, b1].map((b) => cy + a * ry + b * fy));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// How high the top of each of the game's own tables is, for a small thing of the packs put on one.
const TABLE_TOP = { table: 0.76, "long-table": 0.76, desk: 0.62, "plot-table": 0.7 };
// The same in the pixel-art view, where the game's tables are the packs' pictures at the packs' own size.
const PIXEL_TABLE_TOP = { table: 0.48, "long-table": 0.48, desk: 0.45, "plot-table": 0.33 };
// Whether a piece is a table (or something no taller than one) with this square under it.
function tableUnder(piece, x, y) {
  const kind = FURNITURE_BY_ID[piece.kind];
  if (!kind || kind.wall) return false;
  if (kind.pack ? !(kind.what === "table" || ((kind.what === "opens" || kind.what === "stand") && kind.high <= 1.1)) : !TABLE_TOP[piece.kind]) return false;
  const { across, down } = footprintOf({ kind: piece.kind, facing: piece.facing ?? "s" });
  return x >= piece.x && x < piece.x + across && y >= piece.y && y < piece.y + down;
}

// The furniture in a scene: what's drawn on the level, and the things that look like a piece of it.
function furnish(view, { kinds, heights, blocks, painted, unpowered = () => false }) {
  const lights = [];
  // A part of the ship's systems mounted on a wall square has it; a window or a screen there gives way.
  const wallUsed = new Set((view.things ?? []).filter((thing) => thing.part?.mount === "wall").map((thing) => `${thing.x},${thing.y}`));
  const floorAt = (x, y) => seeThrough(kinds[y]?.[x]);
  const pieces = [...(view.furniture ?? [])];
  for (const thing of view.things ?? []) {
    if (!thing.looks || thing.part || !FURNITURE_BY_ID[thing.looks]) continue;
    // A thing is on one square; a piece wider than that is laid from the pair of squares the thing is half of.
    const { across } = footprintOf({ kind: thing.looks, facing: thing.facing });
    pieces.push({ kind: thing.looks, facing: thing.facing ?? "s", x: across > 1 ? thing.x - (thing.x % 2) : thing.x, y: thing.y });
  }
  const add = (piece) => {
    const span = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
    for (const wx of [piece.x0, piece.x1]) for (const wy of [piece.y0, piece.y1]) for (const z of [0, piece.top]) {
      const { u, v } = project(wx, wy, z);
      span.minU = Math.min(span.minU, u);
      span.maxU = Math.max(span.maxU, u);
      span.minV = Math.min(span.minV, v);
      span.maxV = Math.max(span.maxV, v);
    }
    const cx = (piece.x0 + piece.x1) / 2;
    const cy = (piece.y0 + piece.y1) / 2;
    blocks.push({ type: "block", style: "piece", ...piece, x: Math.floor(cx / CELL_WIDTH), y: Math.floor(cy), h: piece.top, seed: hashOf(Math.floor(cx * 8), Math.floor(cy * 8)), right: 0, left: 0, back: 0, side: 0, depth: cx + cy + (piece.bias ?? 0), span });
  };
  for (const piece of pieces) {
    const kind = FURNITURE_BY_ID[piece.kind];
    if (!kind) continue;
    if (kind.wall) {
      // On whichever side of the wall the room is, of the two the camera sees.
      const { x, y } = piece;
      if (kinds[y]?.[x] !== "wall" || heights[y][x] !== WALL_HEIGHT || painted(x, y) || wallUsed.has(`${x},${y}`)) continue;
      const face = floorAt(x, y + 1) ? "s" : floorAt(x + 1, y) ? "e" : null;
      if (!face) continue;
      wallUsed.add(`${x},${y}`);
      const window = piece.kind === "window";
      const off = !window && unpowered(face === "s" ? x : x + 1, face === "s" ? y + 1 : y);
      add({ kind: piece.kind, face, x0: x * CELL_WIDTH, x1: (x + 1) * CELL_WIDTH, y0: y, y1: y + 1, top: WALL_HEIGHT, wallX: x, wallY: y, bias: face === "s" ? 0.51 : 0.3, ...(off ? { off: true } : {}) });
      if (!off && kind.lit) lights.push({ x: face === "s" ? x : x + 1, y: face === "s" ? y + 1 : y, color: kind.lit, radius: window ? 3.2 : 1.3, power: window ? 0.55 : 0.35 });
      continue;
    }
    const facing = piece.facing ?? "s";
    const { across, down } = footprintOf({ kind: piece.kind, facing });
    const placed = { kind: piece.kind, facing, x0: piece.x * CELL_WIDTH, x1: (piece.x + across) * CELL_WIDTH, y0: piece.y, y1: piece.y + down, top: kind.pack ? Math.max(0.05, kind.high ?? 1) : PIECE_TOP[piece.kind] ?? 1 };
    const off = Boolean(kind.lit) && unpowered(piece.x, piece.y);
    if (kind.pack && (kind.what === "rug" || kind.what === "small")) {
      // A piece of the packs that isn't in the way. What lies on the floor goes down before anyone who might stand on
      // it; a small thing sits on the table that has its square, if one has, and goes on after it.
      const under = kind.what === "small" ? pieces.find((other) => other !== piece && tableUnder(other, piece.x, piece.y)) : null;
      const lift = under ? (FURNITURE_BY_ID[under.kind].pack ? FURNITURE_BY_ID[under.kind].high : (pixelArtOn() ? PIXEL_TABLE_TOP : TABLE_TOP)[under.kind]) ?? 0.75 : 0;
      add({ ...placed, lift, top: lift + placed.top, bias: kind.what === "rug" ? -(across * CELL_WIDTH + down) / 2 - 0.05 : under ? 0.6 : 0, ...(off ? { off: true } : {}) });
      // A small thing with a warm light is a lamp, and throws it further than a screen's glow: the pool of warm light
      // at a station, in a room whose own light is cold.
      if (kind.lit && !off) lights.push({ x: piece.x, y: piece.y, color: kind.lit, ...(warmLight(kind.lit) ? { radius: 2.1, power: 0.62 } : { radius: 1.1, power: 0.32 }) });
      continue;
    }
    const [ha, hb] = PIECE_SHADOW[piece.kind] ?? (kind.pack ? [Math.max(0.1, across * CELL_WIDTH * 0.42), Math.max(0.1, down * 0.42)] : [0.2, 0.2]);
    add({ ...placed, shadow: partRect(placed, -ha, ha, -hb, hb), ...(off ? { off: true } : {}) });
    if (kind.lit && !off) {
      const big = piece.kind === "plot-table";
      lights.push({ x: piece.x + Math.floor(across / 2), y: piece.y + Math.floor(down / 2), color: kind.lit, radius: big ? 2.8 : piece.kind === "kettle" ? 1.6 : 1.2, power: big ? 0.85 : 0.42 });
    }
  }
  return { lights, wallUsed };
}

function box(painter, [x0, y0, x1, y1], z0, z1, top, front, side) {
  const { ctx, at } = painter;
  polygon(ctx, [at(x1, y0, z1), at(x1, y1, z1), at(x1, y1, z0), at(x1, y0, z0)], side);
  polygon(ctx, [at(x0, y1, z1), at(x1, y1, z1), at(x1, y1, z0), at(x0, y1, z0)], front);
  polygon(ctx, [at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], top);
}

// A box in three shades of one colour: its top, its side toward the camera, its side away to the right.
const shades = (hex) => [scaled(hex, 1.12), hex, scaled(hex, 0.68)];

function stroke(painter, points, color, width = 1) {
  const { ctx, at } = painter;
  ctx.beginPath();
  points.forEach(([wx, wy, z], i) => (i ? ctx.lineTo(...at(wx, wy, z)) : ctx.moveTo(...at(wx, wy, z))));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Something round standing on the floor: a drum, a pot.
function cylinder(painter, wx, wy, r, z0, z1, side, top) {
  const { ctx, at, unit } = painter;
  const [bx, by] = at(wx, wy, z0);
  const [tx, ty] = at(wx, wy, z1);
  const rx = r * unit * Math.SQRT1_2;
  const ry = rx / 2;
  const body = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  body.addColorStop(0, scaled(side, 1.15));
  body.addColorStop(0.55, side);
  body.addColorStop(1, scaled(side, 0.6));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(tx - rx, ty);
  ctx.ellipse(tx, ty, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.ellipse(tx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Something flat on a wall's face toward the room, a little in from the square's edges: its corners between two
// heights, and a point along it.
function wallFace(painter, piece, inset) {
  const { at } = painter;
  if (piece.face === "e") {
    const x = (piece.wallX + 1) * CELL_WIDTH + 0.003;
    const ya = piece.wallY + inset * 2;
    const yb = piece.wallY + 1 - inset * 2;
    return { corners: (za, zb) => [at(x, ya, zb), at(x, yb, zb), at(x, yb, za), at(x, ya, za)], along: (t, z) => [x, ya + (yb - ya) * t, z] };
  }
  const y = piece.wallY + 1.003;
  const xa = piece.wallX * CELL_WIDTH + inset;
  const xb = (piece.wallX + 1) * CELL_WIDTH - inset;
  return { corners: (za, zb) => [at(xa, y, zb), at(xb, y, zb), at(xb, y, za), at(xa, y, za)], along: (t, z) => [xa + (xb - xa) * t, y, z] };
}

// only: draw just the parts with that tag (a chair's back, drawn again in front of whoever's sitting in it).
// sleepers: who's lying in a bed, lowest first, each { look, ring, mark }; where their head was drawn is left on them.
// A piece of the bought packs where its picture isn't shown: in this view's own drawing, and in the pixel-art test for
// the moment before its picture has come. A plain shape of its size: a box as high as the piece, a seat with a back, a
// flat patch for what lies on the floor, a panel for what hangs on a wall, a little box for a small thing.
// ---- Where people walk ----------------------------------------------------------------------------------------------
// A floor wears where it's walked on: from each doorway and stair to every seat, bed and thing that can be reached from
// it, by the shortest way round what's in the way. The ways are worked out once for a level, as lines across the floor
// from the middle of one square to the middle of another, straightened wherever nothing stands between two points.
// Each is { points: [[wx, wy], ...] in tiles, x0, y0, x1, y1 in squares }.
export function wornPaths(view, kinds) {
  const lines = kinds.length;
  const cols = kinds[0]?.length ?? 0;
  const at = (x, y) => y * cols + x;
  // What nobody walks through: furniture that's in the way, and things.
  const taken = new Set();
  for (const piece of view.furniture ?? []) {
    const kind = FURNITURE_BY_ID[piece.kind];
    if (kind && !kind.wall && kind.blocks) for (const [x, y] of squaresOf(piece)) taken.add(at(x, y));
  }
  const floor = (x, y) => x >= 0 && y >= 0 && x < cols && y < lines && (kinds[y][x] === "floor" || kinds[y][x] === "door" || kinds[y][x] === "exit") && !taken.has(at(x, y));
  // From every doorway and stair at once, to everywhere: a square is half as wide as it's deep, so a step along a row
  // is half the way of a step along a column.
  const far = new Float32Array(cols * lines).fill(Infinity);
  const from = new Int32Array(cols * lines).fill(-1);
  const heap = [];
  const push = (cost, cell) => {
    heap.push([cost, cell]);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [i * 2 + 1, i * 2 + 2];
        let least = i;
        if (l < heap.length && heap[l][0] < heap[least][0]) least = l;
        if (r < heap.length && heap[r][0] < heap[least][0]) least = r;
        if (least === i) break;
        [heap[least], heap[i]] = [heap[i], heap[least]];
        i = least;
      }
    }
    return top;
  };
  for (let y = 0; y < lines; y += 1) for (let x = 0; x < cols; x += 1) if ((kinds[y][x] === "door" || kinds[y][x] === "exit") && floor(x, y)) {
    far[at(x, y)] = 0;
    push(0, at(x, y));
  }
  if (!heap.length) return [];
  while (heap.length) {
    const [cost, cell] = pop();
    if (cost > far[cell]) continue;
    const [x, y] = [cell % cols, Math.floor(cell / cols)];
    for (const [dx, dy, step] of [[1, 0, 0.5], [-1, 0, 0.5], [0, 1, 1], [0, -1, 1]]) {
      if (!floor(x + dx, y + dy)) continue;
      const next = at(x + dx, y + dy);
      if (cost + step < far[next]) {
        far[next] = cost + step;
        from[next] = cell;
        push(cost + step, next);
      }
    }
  }
  // Where people go: onto a seat or a bed, and up to a thing, from the square beside it that's nearest a door.
  const ends = new Set();
  const beside = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([bx, by]) => floor(bx, by) && far[at(bx, by)] < Infinity).sort((a, b) => far[at(...a)] - far[at(...b)])[0] ?? null;
  for (const piece of view.furniture ?? []) {
    const kind = FURNITURE_BY_ID[piece.kind];
    if (!kind || !(kind.seat || kind.bed)) continue;
    const [x, y] = squaresOf(piece)[0];
    const end = floor(x, y) && far[at(x, y)] < Infinity ? [x, y] : beside(x, y);
    if (end) ends.add(at(...end));
  }
  for (const thing of view.things ?? []) {
    if (thing.part || thing.x === undefined) continue;
    const end = beside(thing.x, thing.y);
    if (end) ends.add(at(...end));
  }
  const middle = (cell) => [((cell % cols) + 0.5) * CELL_WIDTH, Math.floor(cell / cols) + 0.5];
  // Whether the straight line between two squares' middles crosses only floor.
  const clear = (a, b) => {
    const [ax, ay] = middle(a);
    const [bx, by] = middle(b);
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2);
    for (let i = 1; i < steps; i += 1) {
      const [wx, wy] = [ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps];
      if (!floor(Math.floor(wx / CELL_WIDTH), Math.floor(wy))) return false;
    }
    return true;
  };
  const paths = [];
  for (const end of ends) {
    if (!(far[end] > 1)) continue;
    const cells = [];
    for (let cell = end; cell >= 0 && cells.length < 400; cell = from[cell]) cells.push(cell);
    // Straightened: from each point, straight to the furthest one along the way that can be seen from it.
    const kept = [cells[0]];
    for (let i = 0; i < cells.length - 1;) {
      let next = i + 1;
      for (let j = Math.min(cells.length - 1, i + 40); j > i + 1; j -= 1) if (clear(cells[i], cells[j])) { next = j; break; }
      kept.push(cells[next]);
      i = next;
    }
    const xs = cells.map((cell) => cell % cols);
    const ys = cells.map((cell) => Math.floor(cell / cols));
    paths.push({ points: kept.map(middle), x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + 1, y1: Math.max(...ys) + 1 });
  }
  return paths;
}

// Someone's head on a pillow: their face and hair, a ring round whoever the pointer's on, and a red cross over someone
// down where they fell. Where it was drawn is left on them.
function drawSleeperHead(painter, one, hx, hy, r) {
  const { ctx, unit } = painter;
  ctx.fillStyle = one.look.skin;
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = one.look.hair ?? "#2a2420";
  ctx.beginPath();
  ctx.arc(hx, hy - r * 0.1, r * 1.02, Math.PI * 0.95, Math.PI * 2.05);
  ctx.closePath();
  ctx.fill();
  if (one.ring) {
    ctx.strokeStyle = one.ring;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (one.mark) {
    // Down where they fell, as on the floor: a red cross over them.
    const s = unit / 34;
    ctx.lineCap = "round";
    for (const [width, colourOf] of [[3.6, "rgba(20,6,4,.85)"], [2, "#ff6b5b"]]) {
      ctx.lineWidth = width * s;
      ctx.strokeStyle = colourOf;
      ctx.beginPath();
      ctx.moveTo(hx, hy - 16 * s);
      ctx.lineTo(hx, hy - 8 * s);
      ctx.moveTo(hx - 4 * s, hy - 12 * s);
      ctx.lineTo(hx + 4 * s, hy - 12 * s);
      ctx.stroke();
    }
  }
  one.at = [hx, hy];
}

// The shape of someone under the bedding of a bed the packs draw: its own blanket, a little lighter on top of them and
// darker down their sides.
function drawUnderBedding(painter, [x0, y0, x1, y1], z0, z1) {
  const { ctx, at } = painter;
  polygon(ctx, [at(x1, y0, z1), at(x1, y1, z1), at(x1, y1, z0), at(x1, y0, z0)], "rgba(0,0,0,.3)");
  polygon(ctx, [at(x0, y1, z1), at(x1, y1, z1), at(x1, y1, z0), at(x0, y1, z0)], "rgba(0,0,0,.2)");
  polygon(ctx, [at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], "rgba(255,255,255,.16)");
}

// Whoever's asleep in a bed of the packs, or one they draw (bed is what packBed says of it, public/pixel-art.js): each
// a head on the pillow and the rest of them under the bedding, at the packs' own size in their picture, and the game's
// on a plain shape. In the pack's bunk each has a blanket of their own; under a pod's lid they're seen through it.
function drawPackSleepers(painter, piece, sleepers, bed) {
  const { ctx, at, unit } = painter;
  const random = randomFrom(`piece${piece.x0},${piece.y0}`);
  const r = unit * (bed.pictured ? 0.062 : 0.078);
  const wide = bed.pictured ? 0.1 : 0.14;
  bed.places.forEach(({ wx, wy, z }, i) => {
    // A colour for every place, so whoever's in the upper bed keeps theirs when the lower one's empty.
    const colour = BLANKETS[Math.floor(random() * BLANKETS.length)];
    const one = sleepers?.[i];
    if (!one) return;
    const rect = bed.run === "y" ? [wx - wide, wy + 0.1, wx + wide, wy + bed.long] : [wx + 0.1, wy - wide, wx + bed.long, wy + wide];
    if (bed.under) ctx.globalAlpha = 0.5;
    if (bed.blankets) box(painter, rect, z, z + 0.07, ...shades(scaled(colour, 1.15)));
    else drawUnderBedding(painter, rect, z, z + 0.07);
    drawSleeperHead(painter, one, ...at(wx, wy, z + 0.09), r);
    ctx.globalAlpha = 1;
  });
}

// The stairs of a deck: a run of four posts or more along a row of the plan, in a room with a way up or down (a way
// out of that room whose words begin "Up" or "Down"), is where its staircase stands. Each is { x0, x1, y, way }: the
// squares it takes (x1 isn't one of them) and "up" or "down". A room with both ways has a stair for each, on the half
// of the run that's on the side its own way out is. styles is the scene's, a row of squares at a time.
export function stairsOf(view, styles) {
  const areas = view.areas ?? [];
  if (!areas.length) return [];
  const roomAt = (x, y) => areas.filter((area) => x >= area.x && x < area.x + area.w && y >= area.y && y < area.y + area.h).sort((a, b) => a.w * a.h - b.w * b.h)[0] ?? null;
  const wayOf = (exit) => (/^\s*up\b/i.test(exit.label ?? "") ? "up" : /^\s*down\b/i.test(exit.label ?? "") ? "down" : null);
  const found = [];
  styles.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== "post") continue;
      let end = x;
      while (row[end + 1] === "post") end += 1;
      const room = end - x + 1 >= 4 ? roomAt(x, y) : null;
      const ways = room ? (view.exits ?? []).filter((exit) => exit.room === room.id && wayOf(exit)) : [];
      const up = ways.find((exit) => wayOf(exit) === "up");
      const down = ways.find((exit) => wayOf(exit) === "down");
      if (up && down) {
        const half = x + Math.ceil((end - x + 1) / 2);
        const first = up.x <= down.x ? "up" : "down";
        found.push({ x0: x, x1: half, y, way: first }, { x0: half, x1: end + 1, y, way: first === "up" ? "down" : "up" });
      } else if (up || down) found.push({ x0: x, x1: end + 1, y, way: up ? "up" : "down" });
      x = end;
    }
  });
  return found;
}

// The look a piece of furniture is drawn in by the pixel-art view, where its room has one of its own.
function lookOfPiece(piece) {
  return iso.scene?.light?.[Math.floor(piece.y0 + 1e-6)]?.[Math.round(piece.x0 / CELL_WIDTH)] ? { look: "light" } : {};
}

// Whether a light's colour is a warm one: a good deal more red in it than blue.
export function warmLight(hex) {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ""));
  return Boolean(found) && parseInt(found[1], 16) > parseInt(found[3], 16) + 48;
}

function drawPlainPiece(painter, piece, kind, only) {
  const { ctx, at } = painter;
  const glow = kind.lit && !piece.off ? scaled(kind.lit, 0.6) : null;
  if (kind.wall) {
    if (only) return;
    const face = wallFace(painter, piece, 0.04);
    const middle = Math.min(WALL_HEIGHT - 0.35, Math.max(0.35, kind.high ?? 0.95));
    polygon(ctx, face.corners(middle - 0.24, middle + 0.24), glow ?? "#56616b");
    stroke(painter, [face.along(0, middle - 0.24), face.along(0, middle + 0.24), face.along(1, middle + 0.24)], "rgba(190,205,220,.4)");
    return;
  }
  const edge = 0.05;
  const rect = [piece.x0 + edge, piece.y0 + edge, piece.x1 - edge, piece.y1 - edge];
  if (kind.what === "rug") {
    if (!only) polygon(ctx, [at(rect[0], rect[1], 0.012), at(rect[2], rect[1], 0.012), at(rect[2], rect[3], 0.012), at(rect[0], rect[3], 0.012)], "#4d4658");
    return;
  }
  if (kind.what === "small") {
    if (only) return;
    const cx = (piece.x0 + piece.x1) / 2;
    const cy = (piece.y0 + piece.y1) / 2;
    const z = piece.lift ?? 0;
    box(painter, [cx - 0.09, cy - 0.09, cx + 0.09, cy + 0.09], z, z + 0.16, ...shades(glow ?? "#8a8f96"));
    return;
  }
  if (kind.what === "seat") {
    const turned = piece.facing === "e" || piece.facing === "w";
    const wide = (turned ? piece.y1 - piece.y0 : piece.x1 - piece.x0) / 2 - edge;
    const deep = Math.min(0.25, (turned ? piece.x1 - piece.x0 : piece.y1 - piece.y0) / 2 - 0.02);
    if (!only) box(painter, partRect(piece, -wide, wide, -deep, deep), 0, 0.45, ...shades(KIT.seat));
    if (!only || only === "back") box(painter, partRect(piece, -wide, wide, -deep, -deep + 0.07), 0.45, 0.95, ...shades(KIT.seat));
    return;
  }
  if (only) return;
  const high = Math.max(0.1, kind.high ?? 1);
  if (!glow) {
    box(painter, rect, 0, high, ...shades(kind.what === "table" ? KIT.laminate : kind.what === "bed" ? "#5a6a78" : KIT.steel));
    return;
  }
  // Something lit is a dark cabinet with its light on it, as the game's own desks and screens are: a screen let into
  // the top of what's low enough to look down on, a strip up the front of what's taller.
  box(painter, rect, 0, high, KIT.frame, KIT.frameDark, KIT.frameDeep);
  if (high <= 1.05) {
    const in0 = Math.min(0.09, (rect[2] - rect[0]) / 4);
    const in1 = Math.min(0.14, (rect[3] - rect[1]) / 4);
    polygon(ctx, [at(rect[0] + in0, rect[1] + in1, high + 0.004), at(rect[2] - in0, rect[1] + in1, high + 0.004), at(rect[2] - in0, rect[3] - in1, high + 0.004), at(rect[0] + in0, rect[3] - in1, high + 0.004)], glow);
  } else {
    const mx = (rect[0] + rect[2]) / 2;
    const wide = Math.min(0.07, (rect[2] - rect[0]) / 4);
    polygon(ctx, [at(mx - wide, rect[3] + 0.003, high * 0.3), at(mx + wide, rect[3] + 0.003, high * 0.3), at(mx + wide, rect[3] + 0.003, high * 0.88), at(mx - wide, rect[3] + 0.003, high * 0.88)], glow);
  }
}

function drawPiece(painter, piece, { only = null, sleepers = null } = {}) {
  const { ctx, at, unit } = painter;
  if (FURNITURE_BY_ID[piece.kind]?.pack) {
    drawPlainPiece(painter, piece, FURNITURE_BY_ID[piece.kind], only);
    return;
  }
  const part = (a0, a1, b0, b1) => partRect(piece, a0, a1, b0, b1);
  const random = randomFrom(`piece${piece.x0},${piece.y0}`);
  // A piece's parts go on from the back of the room to the front, so whichever way it's turned the near ones cover;
  // a part with a higher rank goes on after all those with a lower one (a bunk's upper bed after the lower).
  const parts = [];
  const put = (rect, z0, z1, colors, then = null, { rank = 0, tag = null } = {}) => parts.push({ rect, z0, z1, colors, then, rank, tag, depth: (rect[0] + rect[2]) / 2 + (rect[1] + rect[3]) / 2 });
  const lay = () => {
    parts.sort((a, b) => a.rank - b.rank || a.depth - b.depth);
    for (const one of parts) {
      if (only && one.tag !== only) continue;
      if (one.colors) box(painter, one.rect, one.z0, one.z1, ...one.colors);
      one.then?.();
    }
  };
  // A point on the piece, across it and toward its front, at a height.
  const point = (a, b, z) => {
    const [x0, y0, x1, y1] = part(a, a, b, b);
    return at((x0 + x1) / 2, (y0 + y1) / 2, z);
  };
  // A flat panel across the front of a part, between two heights: a screen's glass, a stove's glow. Only drawn when
  // that side faces the camera.
  const frontFaces = piece.facing === "s" || piece.facing === "e";
  // Without power, a screen is dark glass with nothing on it.
  const glass = piece.off ? "#06090b" : KIT.glass;
  const panel = (a0, a1, b, z0, z1, color) => {
    if (!frontFaces) return null;
    polygon(ctx, [point(a0, b, z1), point(a1, b, z1), point(a1, b, z0), point(a0, b, z0)], color);
    return true;
  };
  const lines = (shown, a0, a1, b, zs) => {
    if (!shown || piece.off) return;
    zs.forEach((z, i) => {
      const [x0, y0] = point(a0 + (a1 - a0) * 0.1, b, z);
      const [x1, y1] = point(a0 + (a1 - a0) * (0.45 + i * 0.12), b, z);
      ctx.strokeStyle = "rgba(134,220,255,.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    });
  };
  const frameColors = [KIT.frame, KIT.frameDark, KIT.frameDeep];
  const steelColors = [KIT.steel, KIT.steelDark, KIT.frameDeep];
  const laminateColors = [KIT.laminate, KIT.laminateEdge, scaled(KIT.laminateEdge, 0.7)];
  switch (piece.kind) {
    case "bench":
      for (const a of [-0.8, 0.74]) put(part(a, a + 0.06, -0.12, 0.12), 0, 0.42, steelColors);
      put(part(-0.92, 0.92, -0.16, 0.16), 0.42, 0.49, laminateColors);
      break;
    case "chair":
      put(part(-0.12, 0.12, -0.12, 0.12), 0, 0.035, [KIT.frameDark, KIT.frameDeep, KIT.frameDeep]);
      put(part(-0.025, 0.025, -0.025, 0.025), 0.035, 0.38, frameColors);
      put(part(-0.16, 0.16, -0.13, 0.16), 0.38, 0.49, [KIT.seatTop, KIT.seat, KIT.seatDark]);
      put(part(-0.16, 0.16, -0.18, -0.13), 0.47, 0.95, [KIT.seatTop, KIT.seat, KIT.seatDark], null, { tag: "back" });
      break;
    case "command-chair":
      put(part(-0.42, 0.42, -0.42, 0.42), 0, 0.07, ["#3b4450", "#2a3139", "#1f252b"], () => stroke(painter, [[piece.x0 + 0.05, piece.y1 - 0.05, 0.07], [piece.x1 - 0.05, piece.y1 - 0.05, 0.07], [piece.x1 - 0.05, piece.y0 + 0.05, 0.07]], "rgba(255,200,110,.35)"));
      put(part(-0.07, 0.07, -0.07, 0.07), 0.07, 0.42, frameColors);
      put(part(-0.31, -0.23, -0.22, 0.22), 0.42, 0.68, frameColors);
      put(part(0.23, 0.31, -0.22, 0.22), 0.42, 0.68, frameColors, () => {
        const [px, py] = point(0.27, 0.18, 0.69);
        ctx.fillStyle = "rgba(134,220,255,.9)";
        ctx.fillRect(px - 1.5, py - 1, 3, 2);
      });
      put(part(-0.24, 0.24, -0.22, 0.2), 0.42, 0.56, shades(KIT.leather));
      put(part(-0.25, 0.25, -0.31, -0.21), 0.54, 1.25, shades(KIT.leather), null, { tag: "back" });
      put(part(-0.18, 0.12, -0.32, -0.31), 0.86, 0.98, shades(KIT.webbing), null, { tag: "back" });
      put(part(-0.2, 0.2, -0.3, -0.22), 1.25, 1.35, shades(scaled(KIT.leather, 1.2)), null, { tag: "back" });
      break;
    case "table":
      for (const a of [-0.38, 0.33]) for (const b of [-0.38, 0.33]) put(part(a, a + 0.05, b, b + 0.05), 0, 0.7, steelColors);
      put(part(-0.44, 0.44, -0.44, 0.44), 0.7, 0.76, laminateColors);
      break;
    case "long-table":
      for (const a of [-0.9, 0.85]) for (const b of [-0.36, 0.31]) put(part(a, a + 0.05, b, b + 0.05), 0, 0.7, steelColors);
      put(part(-0.94, 0.94, -0.42, 0.42), 0.7, 0.76, laminateColors, () => {
        // Mugs and trays left on it.
        for (let i = 0; i < 4; i += 1) {
          const [mx, my] = point(-0.8 + random() * 1.6, -0.3 + random() * 0.6, 0.77);
          ctx.fillStyle = random() > 0.5 ? "rgba(210,205,190,.75)" : "rgba(120,130,140,.75)";
          ctx.fillRect(mx - 1.5, my - 1.5, 3, 2.5);
        }
      });
      break;
    case "desk":
      put(part(-0.44, -0.4, -0.22, 0.18), 0, 0.68, steelColors);
      put(part(0.18, 0.44, -0.22, 0.18), 0, 0.68, steelColors);
      put(part(-0.46, 0.46, -0.25, 0.2), 0.68, 0.74, laminateColors);
      put(part(-0.2, 0.2, -0.21, -0.17), 0.74, 1.08, [KIT.frameDark, KIT.frameDeep, KIT.frameDeep], () => lines(panel(-0.17, 0.17, -0.165, 0.77, 1.05, glass), -0.17, 0.17, -0.165, [1.0, 0.93, 0.86]));
      break;
    case "bunk":
    case "cot": {
      const cot = piece.kind === "cot";
      // The posts behind the beds first, then the lower bed and whoever's in it, the upper and whoever's in it, and
      // the posts in front last.
      const middle = (piece.x0 + piece.x1) / 2 + (piece.y0 + piece.y1) / 2;
      for (const a of [-0.44, 0.4]) for (const b of [-0.94, 0.9]) {
        const rect = part(a, a + 0.04, b, b + 0.04);
        const front = (rect[0] + rect[2]) / 2 + (rect[1] + rect[3]) / 2 > middle;
        put(rect, 0, cot ? 0.45 : 1.5, frameColors, null, { rank: front ? 5 : 0, tag: front && !cot ? "over" : null });
      }
      // A bunk's upper bed, and its posts in front, are drawn again over anyone sitting on the lower ("over").
      const bed = (z, colour, rank, one, tag = null) => {
        put(part(-0.42, 0.42, -0.92, 0.92), z, z + 0.1, frameColors, null, { rank, tag });
        put(part(-0.4, 0.4, -0.9, -0.62), z + 0.1, z + 0.18, shades(KIT.sheet), null, { rank, tag });
        put(part(-0.41, 0.41, -0.55, 0.9), z + 0.1, z + 0.17, shades(colour), null, { rank, tag });
        if (one) lieIn(z + 0.17, colour, rank + 1, one, tag);
      };
      // Someone lying in a bed: their head on the pillow, their shoulders in their coat, the blanket over the rest.
      const lieIn = (z, colour, rank, one, tag) => {
        put(part(-0.1, 0.1, -0.86, -0.66), z, z + 0.02, null, () => {
          drawSleeperHead(painter, one, ...point(0, -0.76, z + 0.13), unit * 0.078);
        }, { rank, tag });
        put(part(-0.3, 0.3, -0.64, -0.42), z, z + 0.15, shades(one.look.coat), null, { rank, tag });
        put(part(-0.29, 0.29, -0.44, 0.8), z, z + 0.12, shades(scaled(colour, 1.12)), null, { rank, tag });
      };
      bed(cot ? 0.35 : 0.22, cot ? "#8fa6b8" : BLANKETS[Math.floor(random() * BLANKETS.length)], 1, sleepers?.[0]);
      if (!cot) bed(1.02, BLANKETS[Math.floor(random() * BLANKETS.length)], 3, sleepers?.[1], "over");
      break;
    }
    case "locker":
      put(part(-0.2, 0.2, -0.2, 0.2), 0, 1.5, ["#545c65", "#3a4149", "#292e34"], () => {
        if (!frontFaces) return;
        const [ax, ay] = point(0, 0.202, 0.06);
        const [bx, by] = point(0, 0.202, 1.44);
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        const [lx, ly] = point(0.08, 0.202, 0.8);
        ctx.fillStyle = KIT.amber;
        ctx.fillRect(lx - 1.2, ly - 1.2, 2.4, 2.4);
      });
      break;
    case "shelf":
      put(part(-0.46, 0.46, -0.22, -0.19), 0, 1.6, [KIT.frameDark, KIT.frameDeep, KIT.frameDeep]);
      for (const a of [-0.46, 0.42]) put(part(a, a + 0.04, -0.22, 0.2), 0, 1.6, frameColors);
      for (const z of [0.05, 0.45, 0.85, 1.25]) {
        put(part(-0.42, 0.42, -0.19, 0.19), z, z + 0.04, [KIT.steelTop, KIT.steelDark, KIT.frameDeep]);
        for (let a = -0.38; a < 0.32; a += 0.14 + random() * 0.08) {
          if (random() < 0.25) continue;
          const tall = 0.12 + random() * 0.2;
          put(part(a, a + 0.1, -0.15, 0.06 + random() * 0.08), z + 0.04, z + 0.04 + tall, shades(SHELF_GOODS[Math.floor(random() * SHELF_GOODS.length)]));
        }
      }
      break;
    case "plot-table":
      put(part(-0.13, 0.13, -0.13, 0.13), 0, 0.66, frameColors);
      put(part(-0.46, 0.46, -0.46, 0.46), 0.66, 0.78, ["#0b1c18", KIT.frameDark, KIT.frameDeep], () => {
        // Without power, the chart table is a dark slab.
        if (piece.off) return;
        const [x0, y0, x1, y1] = part(-0.46, 0.46, -0.46, 0.46);
        stroke(painter, [[x0, y0, 0.781], [x1, y0, 0.781], [x1, y1, 0.781], [x0, y1, 0.781], [x0, y0, 0.781]], "rgba(125,255,168,.6)");
        // Forty-one dots, and a few that aren't green.
        for (let i = 0; i < 41; i += 1) {
          const [px, py] = at(x0 + 0.06 + random() * (x1 - x0 - 0.12), y0 + 0.06 + random() * (y1 - y0 - 0.12), 0.785);
          ctx.fillStyle = random() > 0.88 ? "rgba(255,190,110,.95)" : "rgba(125,255,168,.95)";
          ctx.fillRect(px - 0.9, py - 0.6, 1.8, 1.2);
        }
        const [bx, by] = at((x0 + x1) / 2, (y0 + y1) / 2, 0.8);
        const [, ty] = at((x0 + x1) / 2, (y0 + y1) / 2, 1.45);
        const w = unit * 0.3;
        const glow = ctx.createLinearGradient(0, by, 0, ty);
        glow.addColorStop(0, "rgba(125,255,168,.32)");
        glow.addColorStop(1, "rgba(125,255,168,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.moveTo(bx - w, by);
        ctx.lineTo(bx + w, by);
        ctx.lineTo(bx + w * 0.55, ty);
        ctx.lineTo(bx - w * 0.55, ty);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(170,255,205,.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(bx, (by + ty) / 2, w * 0.42, w * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(bx, (by + ty) / 2, w * 0.62, w * 0.16, -0.25, 0, Math.PI * 2);
        ctx.stroke();
      });
      break;
    case "screen":
      put(part(-0.12, 0.12, -0.06, 0.06), 0, 0.04, [KIT.frameDark, KIT.frameDeep, KIT.frameDeep]);
      put(part(-0.025, 0.025, -0.025, 0.025), 0.04, 0.84, frameColors);
      put(part(-0.22, 0.22, -0.03, 0.03), 0.82, 1.18, [KIT.frameDark, KIT.frameDeep, KIT.frameDeep], () => lines(panel(-0.2, 0.2, 0.032, 0.85, 1.15, glass), -0.2, 0.2, 0.032, [1.1, 1.03, 0.96]));
      break;
    case "kettle": {
      put(part(-0.42, 0.42, -0.42, 0.42), 0, 0.42, ["#3d4248", "#2c3035", "#202327"], () => panel(-0.3, 0.3, 0.422, 0.09, 0.14, piece.off ? "rgba(46,32,24,.9)" : "rgba(255,140,60,.85)"));
      lay();
      const [x0, y0, x1, y1] = part(-0.42, 0.42, -0.42, 0.42);
      cylinder(painter, (x0 + x1) / 2, (y0 + y1) / 2, 0.31, 0.42, 0.98, KIT.steel, "#3a3f44");
      cylinder(painter, (x0 + x1) / 2, (y0 + y1) / 2, 0.27, 0.98, 1.04, KIT.steelTop, "#5a6168");
      return;
    }
    case "barrel": {
      const cx = (piece.x0 + piece.x1) / 2;
      const cy = (piece.y0 + piece.y1) / 2;
      cylinder(painter, cx, cy, 0.17, 0, 0.8, "#5b5a3a", "#3e3d28");
      for (const z of [0.25, 0.55]) {
        const [px, py] = at(cx, cy, z);
        const rx = 0.17 * unit * Math.SQRT1_2;
        ctx.strokeStyle = "rgba(0,0,0,.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, rx / 2, 0, 0, Math.PI);
        ctx.stroke();
      }
      return;
    }
    case "plant": {
      const cx = (piece.x0 + piece.x1) / 2;
      const cy = (piece.y0 + piece.y1) / 2;
      cylinder(painter, cx, cy, 0.14, 0, 0.3, "#6b4f3a", "#2a2018");
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, unit * 0.025);
      for (let i = 0; i < 9; i += 1) {
        const [x, y] = at(cx + (random() - 0.5) * 0.12, cy + (random() - 0.5) * 0.12, 0.3);
        const lean = (random() - 0.5) * unit * 0.22;
        const high = unit * (0.18 + random() * 0.16);
        ctx.strokeStyle = PLANT_COLORS[Math.floor(random() * PLANT_COLORS.length)];
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + lean * 0.3, y - high * 0.7, x + lean, y - high);
        ctx.stroke();
      }
      return;
    }
    case "basin":
      put(part(-0.07, 0.07, -0.07, 0.07), 0, 0.6, shades(KIT.sheet));
      put(part(-0.2, 0.2, -0.16, 0.16), 0.6, 0.74, [KIT.sheet, KIT.sheetDark, scaled(KIT.sheetDark, 0.8)], () => {
        const [x0, y0, x1, y1] = part(-0.15, 0.15, -0.11, 0.11);
        polygon(ctx, [at(x0, y0, 0.742), at(x1, y0, 0.742), at(x1, y1, 0.742), at(x0, y1, 0.742)], "rgba(70,90,100,.55)");
      });
      put(part(-0.02, 0.02, -0.16, -0.1), 0.74, 0.86, [KIT.steelTop, KIT.steel, KIT.steelDark]);
      break;
    case "wall-screen": {
      const face = wallFace(painter, piece, 0.05);
      polygon(ctx, face.corners(0.86, 1.3), piece.off ? "#05080a" : "#0b2733");
      if (!piece.off) for (let i = 0; i < 3; i += 1) stroke(painter, [face.along(0.1, 1.22 - i * 0.1), face.along(0.3 + ((piece.wallX * 3 + i * 5) % 4) * 0.13, 1.22 - i * 0.1)], "rgba(134,220,255,.8)");
      const [ax, ay] = at(...face.along(0.85, 0.95));
      ctx.fillStyle = piece.off ? "#3a2a18" : KIT.amber;
      ctx.fillRect(ax - 1, ay - 1, 2, 2);
      stroke(painter, [face.along(0, 0.86), face.along(0, 1.3), face.along(1, 1.3)], "rgba(150,170,190,.4)");
      return;
    }
    case "window": {
      const face = wallFace(painter, piece, 0.025);
      const high = WALL_HEIGHT - 0.18;
      polygon(ctx, face.corners(0.38, high), "#050b14");
      const [, topY] = at(...face.along(0, high));
      const [, bottomY] = at(...face.along(0, 0.38));
      const sky = ctx.createLinearGradient(0, topY, 0, bottomY);
      sky.addColorStop(0, "rgba(30,50,90,.55)");
      sky.addColorStop(1, "rgba(5,10,20,0)");
      polygon(ctx, face.corners(0.38, high), sky);
      for (let i = 0; i < 6; i += 1) {
        const [sx, sy] = at(...face.along(random(), 0.42 + random() * (high - 0.5)));
        ctx.fillStyle = `rgba(230,240,255,${0.45 + random() * 0.5})`;
        ctx.fillRect(sx, sy, random() > 0.8 ? 1.6 : 1, random() > 0.8 ? 1.6 : 1);
      }
      stroke(painter, [face.along(0, 0.38), face.along(0, high), face.along(1, high)], "rgba(170,185,200,.55)", 1.2);
      stroke(painter, [face.along(0.15, 0.6), face.along(0.6, 1.25)], "rgba(200,225,255,.12)", 2);
      return;
    }
    default:
      put(part(-0.2, 0.2, -0.2, 0.2), 0, 0.5, shades(KIT.steel));
  }
  lay();
}

// ---- The ship's state ---------------------------------------------------------------------------------------------
// What the room shows of how the ship is getting on, drawn every frame over the still picture of the level: doors that
// slide, the stores by how full they are, fire, a hole in the hull, sparks from what's broken, steam off the kettle.

// How open a door between rooms should be: open while anyone is near it (the player, anyone walking, anyone fighting),
// shut otherwise. A locked door is a way out of its own and isn't one of these.
export function doorOpenFor(door, movers) {
  const { wx, wy } = cellCentre(door.x, door.y);
  return movers.some((one) => Math.hypot((one.wx - wx) * 1.2, one.wy - wy) < 1.6) ? 1 : 0;
}

// A door between rooms, slid open by open (0 shut, 1 open): two panels meeting in the middle of its frame, in the
// plane the frame is in, each sliding into the post beside it, with the yellow stripe low across them.
function drawDoorPanels(painter, door, open, style) {
  const { ctx, at } = painter;
  const x0 = door.x * CELL_WIDTH;
  const y0 = door.y;
  const top = WALL_HEIGHT * 0.94 - 0.16;
  const shut = 1 - open;
  const metal = mix(style?.frame ?? "#6a7078", "#39414a", 0.45);
  const panel = (corner, shade) => {
    polygon(ctx, [corner(0, top), corner(1, top), corner(1, 0.02), corner(0, 0.02)], scaled(metal, shade));
    polygon(ctx, [corner(0, 0.17), corner(1, 0.17), corner(1, 0.1), corner(0, 0.1)], "#b89430");
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(...corner(1, top));
    ctx.lineTo(...corner(1, 0.02));
    ctx.stroke();
  };
  if (door.along === "x") {
    const a = x0 + CELL_WIDTH * 0.14;
    const b = x0 + CELL_WIDTH * 0.86;
    const m = (a + b) / 2;
    const y = y0 + 0.03;
    // Each panel's own edge (1) is the one that meets the other.
    panel((t, z) => at(a + (m - a) * shut * t, y, z), 1.08);
    panel((t, z) => at(b - (b - m) * shut * t, y, z), 0.9);
  } else {
    const a = y0 + 0.14;
    const b = y0 + 0.86;
    const m = (a + b) / 2;
    const x = x0 + 0.03;
    panel((t, z) => at(x, a + (m - a) * shut * t, z), 0.82);
    panel((t, z) => at(x, b - (b - m) * shut * t, z), 0.96);
  }
}

// What a store holds, slot by slot, for its picture: up to twelve, two layers of six, shared among what it keeps by how
// much of each it has, and at least one for anything there's any of.
export function crateSlots(stock, slots = 12) {
  if (!stock?.goods) return [];
  const of = stock.goods.reduce((sum, one) => sum + one.of, 0);
  if (!of) return [];
  const out = [];
  for (const one of stock.goods) {
    const share = one.n > 0 ? Math.max(1, Math.round((one.n / of) * slots)) : 0;
    for (let i = 0; i < share; i += 1) out.push(one.item);
  }
  return out.slice(0, slots);
}
const GOODS_LOOK = { ration_crate: "#7d6c48", produce: "#5f7d3c", parts_crate: "#5e6872", medicine_crate: "#cfcac0", fuel_cell: "#c99b3a" };

// One of the ship's stores as what's in it: crates, or fuel cells standing up, on a pallet, as many as it's full.
function drawStoreCrates(painter, thing) {
  const { ctx, at } = painter;
  const x0 = thing.x * CELL_WIDTH;
  const y0 = thing.y;
  box(painter, [x0 + 0.02, y0 + 0.05, x0 + CELL_WIDTH - 0.02, y0 + 0.95], 0, 0.06, ...shades("#4c4030"));
  crateSlots(thing.stock).forEach((item, i) => {
    const layer = Math.floor(i / 6);
    const row = Math.floor((i % 6) / 2);
    const col = i % 2;
    const cx = x0 + 0.13 + col * 0.24;
    const cy = y0 + 0.2 + row * 0.3;
    const z = 0.06 + layer * 0.23;
    const color = GOODS_LOOK[item] ?? "#7a6a50";
    if (item === "fuel_cell") {
      cylinder(painter, cx, cy, 0.07, z, z + 0.21, color, "#3a3228");
      return;
    }
    box(painter, [cx - 0.1, cy - 0.13, cx + 0.1, cy + 0.13], z, z + 0.2, ...shades(color));
    // A strap across its top, or a red cross on a crate of medicine.
    const mark = item === "medicine_crate" ? "#c03a2c" : "rgba(0,0,0,.35)";
    ctx.strokeStyle = mark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(...at(cx - 0.1, cy, z + 0.201));
    ctx.lineTo(...at(cx + 0.1, cy, z + 0.201));
    if (item === "medicine_crate") {
      ctx.moveTo(...at(cx, cy - 0.09, z + 0.201));
      ctx.lineTo(...at(cx, cy + 0.09, z + 0.201));
    }
    ctx.stroke();
  });
}

// A burning square: three tongues of flame, taller as the fire grows, never still.
function drawFlames(painter, fire, now) {
  const { ctx, at, unit } = painter;
  const { wx, wy } = cellCentre(fire.x, fire.y);
  const grow = 0.6 + Math.min(5, fire.size) * 0.12;
  for (let i = 0; i < 3; i += 1) {
    const phase = now / (170 + i * 37) + fire.seed * 40 + i * 2.1;
    const flicker = iso.calm ? 0.85 : 0.78 + 0.22 * Math.sin(phase) * Math.sin(phase * 1.7);
    const [x, y] = at(wx + (i - 1) * 0.11 + (iso.calm ? 0 : Math.sin(phase * 0.5) * 0.02), wy + (i % 2) * 0.14 - 0.07, 0);
    const high = unit * 0.42 * grow * flicker * (i === 1 ? 1.2 : 0.85);
    const wide = unit * 0.085 * grow;
    for (const [part, color] of [[1, i === 1 ? "#ff9a3c" : "#f0682a"], [0.5, "#ffe27a"]]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - wide * part, y);
      ctx.quadraticCurveTo(x - wide * part * 0.9, y - high * part * 0.6, x, y - high * (part === 1 ? 1 : 0.6));
      ctx.quadraticCurveTo(x + wide * part * 0.9, y - high * part * 0.6, x + wide * part, y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

// Where on its wall a hole in the hull is, as a point on the wall's face toward the room and the way into the room.
function breachFace(breach) {
  if (breach.face === "e") return { at: [(breach.x + 1) * CELL_WIDTH + 0.004, breach.y + 0.5, 0.85], across: [0, 1, 0], into: [1, 0, 0] };
  return { at: [(breach.x + 0.5) * CELL_WIDTH, breach.y + 1.004, 0.85], across: [1, 0, 0], into: [0, 1, 0] };
}

// A hole torn in the hull: a ragged black mouth on the wall, rimed white round its edge.
function drawBreachHole(painter, breach, now) {
  const { ctx, at } = painter;
  const { at: middle, across } = breachFace(breach);
  const random = randomFrom(`breach${breach.x},${breach.y}`);
  const points = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const reach = (i % 2 ? 0.12 : 0.24) + random() * 0.06;
    const side = Math.cos(angle) * reach * (breach.face === "e" ? 1.5 : 0.75);
    points.push(at(middle[0] + across[0] * side, middle[1] + across[1] * side, middle[2] + Math.sin(angle) * reach * 1.2));
  }
  polygon(ctx, points, "#010203");
  ctx.strokeStyle = `rgba(225,236,242,${iso.calm ? 0.7 : 0.55 + 0.2 * Math.sin(now / 400)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((point, i) => (i ? ctx.lineTo(...point) : ctx.moveTo(...point)));
  ctx.closePath();
  ctx.stroke();
}

// What goes on after the light in the room, so the dark doesn't dim it: smoke over a fire, air streaming out of a hole
// in the hull with a warning lamp beside it, sparks off what's broken, steam off a kettle with soup in it, and the red
// lamp of a door the systems have locked.
function drawAfterLight(painter, now, view) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  const still = iso.calm;
  // Smoke, two puffs rising off each burning square, thicker as the fire grows.
  for (const fire of scene.fires ?? []) {
    const { wx, wy } = cellCentre(fire.x, fire.y);
    if (!painter.seen(at(wx, wy, 1.5), unit * 3)) continue;
    for (let k = 0; k < 2; k += 1) {
      const p = still ? 0.4 + k * 0.3 : (now / 3200 + k / 2 + fire.seed * 3) % 1;
      const [x, y] = at(wx + Math.sin(p * 4 + fire.seed * 9) * 0.15, wy, 0.6 + p * 2.4);
      ctx.fillStyle = `rgba(24,22,20,${(0.26 + fire.size * 0.04) * (1 - p)})`;
      ctx.beginPath();
      ctx.arc(x, y, unit * (0.12 + p * 0.38), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Air streaming out of a hole in the hull, and an amber lamp blinking by it.
  ctx.globalCompositeOperation = "lighter";
  for (const breach of scene.breaches ?? []) {
    const face = breachFace(breach);
    const [mx, my, mz] = face.at;
    if (!painter.seen(at(mx, my, mz), unit * 4)) continue;
    const random = randomFrom(`vent${breach.x},${breach.y}`);
    ctx.lineWidth = 1.6;
    // A pale haze round the hole, where the air goes out.
    const [hx, hy] = at(mx, my, mz);
    const haze = unit * 1.1;
    ctx.globalAlpha = 0.35;
    ctx.drawImage(glowSprite("#cfe6f2"), hx - haze / 2, hy - haze / 2, haze, haze);
    ctx.globalAlpha = 1;
    for (let k = 0; k < 16; k += 1) {
      const side = (random() - 0.5) * 1.8;
      const lift = (random() - 0.5) * 0.7;
      const speed = 0.8 + random() * 0.6;
      const p = still ? (k + 0.5) / 10 : (now / (900 / speed) + k / 10) % 1;
      const far = 2.2 * (1 - p);
      const point = (d) => at(mx + face.into[0] * d + face.across[0] * side * d * 0.4, my + face.into[1] * d + face.across[1] * side * d * 0.4, mz + lift * d * 0.3);
      ctx.strokeStyle = `rgba(214,230,240,${0.18 + 0.55 * p})`;
      ctx.beginPath();
      ctx.moveTo(...point(far + 0.4));
      ctx.lineTo(...point(far));
      ctx.stroke();
    }
    const [lx, ly] = at(...point3(face, 0.3, 0.6));
    const size = unit * 0.9;
    ctx.globalAlpha = still ? 0.8 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 220));
    ctx.drawImage(glowSprite("#ffae30"), lx - size / 2, ly - size / 2, size, size);
    ctx.globalAlpha = 1;
  }
  // Sparks off what's broken: a burst every second or two, a few bright specks thrown out and falling.
  for (const thing of view.things ?? []) {
    if (!thing.part?.sparks) continue;
    const part = thing.part;
    const look = partLook(thing);
    const floor = part.mount === "floor";
    const z0 = floor ? Math.min(0.9, look.z0 * 0.6 + 0.12) : look.z0;
    const z1 = floor ? Math.min(1.05, Math.max(z0 + 0.18, look.z1 * 0.7)) : look.z1;
    const [px, py] = partFace(painter, thing, z0, z1, look.inset).point(0.5, 0.45);
    if (!painter.seen([px, py], unit * 2)) continue;
    const every = 1500 + hashOf(thing.x, thing.y) * 900;
    const burst = Math.floor((now + hashOf(thing.y, thing.x) * every) / every);
    const t = still ? 0.2 : ((now + hashOf(thing.y, thing.x) * every) % every) / 420;
    if (t > 1) continue;
    if (t < 0.3) {
      const size = unit * 0.75 * (1 - t);
      ctx.drawImage(glowSprite("#ffd27a"), px - size / 2, py - size / 2, size, size);
    }
    for (let i = 0; i < 9; i += 1) {
      const angle = Math.PI * (1.05 + hashOf(i * 13 + burst, thing.x * 7) * 0.9);
      const speed = unit * (0.25 + hashOf(burst, i * 5 + thing.y) * 0.35);
      const x = px + Math.cos(angle) * speed * t;
      const y = py + Math.sin(angle) * speed * t + unit * 0.5 * t * t;
      ctx.fillStyle = `rgba(255,236,170,${1 - t * 0.8})`;
      ctx.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  // Steam off a kettle with soup in it.
  for (const thing of view.things ?? []) {
    if (thing.looks !== "kettle" || !(thing.stock?.full > 0)) continue;
    // Where the kettle is drawn, as furnish lays a piece from the thing it is.
    const { across, down } = footprintOf({ kind: "kettle", facing: thing.facing });
    const wx = ((across > 1 ? thing.x - (thing.x % 2) : thing.x) + across / 2) * CELL_WIDTH;
    const wy = thing.y + down / 2;
    if (!painter.seen(at(wx, wy, 1.2), unit * 2)) continue;
    for (let k = 0; k < 3; k += 1) {
      const p = still ? 0.3 + k * 0.2 : (now / 2600 + k / 3) % 1;
      const [x, y] = at(wx + Math.sin(p * 5 + k) * 0.08, wy, 1.06 + p * 0.9);
      ctx.fillStyle = `rgba(232,236,240,${0.16 * (1 - p) * Math.min(1, thing.stock.full * 4)})`;
      ctx.beginPath();
      ctx.arc(x, y, unit * (0.06 + p * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // A door the systems have locked has its lock lit red, blinking.
  ctx.globalCompositeOperation = "lighter";
  const blink = still || Math.floor(now / 600) % 2 === 0;
  for (const exit of view.exits ?? []) {
    if (!exit.inner || !exit.closed || !blink) continue;
    const [x, y] = at((exit.x + 0.5) * CELL_WIDTH, exit.y + 0.5, WALL_HEIGHT * 0.88);
    if (!painter.seen([x, y], unit)) continue;
    const size = unit * 0.45;
    ctx.drawImage(glowSprite("#ff3a24"), x - size / 2, y - size / 2, size, size);
  }
  ctx.globalCompositeOperation = "source-over";
}

// A point on a hole's wall beside it, across it and up from its middle, in the game's measure.
function point3(face, side, up) {
  const [mx, my, mz] = face.at;
  return [mx + face.across[0] * side, my + face.across[1] * side, mz + up];
}

// ---- Chatter ------------------------------------------------------------------------------------------------------
// What people near the player say to nobody in particular (src/chatter.js gives each of them a line or two): every three
// to ten seconds someone on the screen who hasn't spoken in the last twenty says one of theirs, over their head, for a
// few seconds, two at most at once. Nobody does in a fight, or while a story's being read or a window's open.
const CHATTER = { every: 3000, more: 7000, lasts: 4600, most: 2, again: 20000 };

export function chatterNext(talk, people, seen, now, random = Math.random) {
  talk.shown = talk.shown.filter((one) => one.until > now);
  if (now < talk.next || talk.shown.length >= CHATTER.most) return null;
  talk.next = now + CHATTER.every + random() * CHATTER.more;
  const candidates = people.filter((person) => person.chatter?.length && seen.has(person.key) && !talk.shown.some((one) => one.key === person.key) && now - (talk.said.get(person.key) ?? -Infinity) > CHATTER.again);
  if (!candidates.length) return null;
  const person = candidates[Math.floor(random() * candidates.length)];
  const fresh = person.chatter.filter((line) => line !== talk.last.get(person.key));
  const lines = fresh.length ? fresh : person.chatter;
  const said = { key: person.key, text: lines[Math.floor(random() * lines.length)], from: now, until: now + CHATTER.lasts };
  talk.shown.push(said);
  talk.said.set(person.key, now);
  talk.last.set(person.key, said.text);
  return said;
}

function drawChatter(ctx, now, view, hits, clip, unit) {
  const talk = iso.chatter;
  if (iso.hooks.fighting?.() || iso.hooks.reading?.() || iso.hooks.blocked?.()) {
    talk.shown = [];
    return;
  }
  const heads = new Map(hits.filter((hit) => hit.kind === "person").map((hit) => [hit.person.key, hit]));
  chatterNext(talk, view.people ?? [], new Set(heads.keys()), now);
  for (const one of talk.shown) {
    const head = heads.get(one.key);
    if (!head) continue;
    const fade = iso.calm ? 1 : Math.max(0, Math.min(1, (now - one.from) / 250, (one.until - now) / 600));
    ctx.save();
    ctx.globalAlpha = fade;
    const box = chip(ctx, `“${one.text}”`, head.floorX, head.floorY - (head.tall ?? unit) * 1.24, "#d9d3ba", { background: "rgba(4,6,5,.58)", size: 10, ...clip });
    // A small tail under it, to whoever's saying it.
    const tip = Math.max(box.x + 4, Math.min(box.x + box.w - 4, head.floorX));
    ctx.fillStyle = "rgba(4,6,5,.58)";
    ctx.beginPath();
    ctx.moveTo(tip - 4, box.y + box.h);
    ctx.lineTo(tip + 4, box.y + box.h);
    ctx.lineTo(tip, box.y + box.h + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Someone mid-sentence wants the room drawn often enough to fade in and out.
  if (talk.shown.length) iso.lively = true;
}

// ---- The map editor's picture of the deck it's changing -------------------------------------------------------------
// The deck as the map editor has it, unsaved, drawn the way the room view would draw it (public/mapedit.js shows it
// beside its plan). The game describes the deck as it would any level (src/map-editor.js, deckLook), and this makes
// the same still picture from that, only the tiles in sight; shuts every door between rooms; stands someone at each
// post; and lays the room's light over it. Nothing moves. It keeps what it made for one description (told apart by
// `version`), so looking somewhere else on the same deck only draws the tiles that weren't drawn yet.
const previewOf = { sceneKey: null, scene: null, key: null, picture: null };

// Draws it into a canvas with a square of the deck (focus: { x, y }) in the middle, and a ring round another (ring),
// where the mouse is on the plan. Draws new tiles for at most `budget` milliseconds, and says whether the picture is
// whole where it shows: if it isn't, call again.
export function drawPreview(canvas, view, { version = 0, focus = null, ring = null, budget = 28 } = {}) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return true;
  const sceneKey = `${version}|${pixelKey()}|${packKey()}`;
  if (previewOf.sceneKey !== sceneKey) Object.assign(previewOf, { sceneKey, scene: buildScene(view), key: null, picture: null });
  const { scene } = previewOf;
  // The size the game shows a deck at with the wheel at rest, in a window of this one's size.
  const unit = wholeUnitFor(scene, ratio, restUnitFor(scene, window.innerWidth, window.innerHeight));
  const key = `${sceneKey}|${unit}|${ratio}`;
  if (previewOf.key !== key) Object.assign(previewOf, { key, picture: newPicture(view, unit, ratio, TILE, key, { scene, sceneId: key }) });
  const { picture } = previewOf;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  const middle = focus ?? { x: Math.floor(view.cols / 2), y: Math.floor(view.lines / 2) };
  const looked = project((middle.x + 0.5) * CELL_WIDTH, middle.y + 0.5, 0.5);
  const ox = Math.round(width / 2 - looked.u * unit);
  const oy = Math.round(height / 2 - looked.v * unit);
  previewOf.last = { ox, oy, unit, cols: view.cols, lines: view.lines };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const { step, baseX, baseY, firstX, lastX, firstY, lastY } = layoutOf(picture, 1, ox, oy, ratio, canvas.width, canvas.height);
  const until = performance.now() + budget;
  let whole = true;
  let made = 0;
  for (let ty = firstY; ty <= lastY; ty += 1) {
    for (let tx = firstX; tx <= lastX; tx += 1) {
      let tile = picture.tiles.get(`${tx},${ty}`);
      if (!tile && (made === 0 || performance.now() < until)) {
        tile = tileOf(picture, tx, ty);
        made += 1;
      }
      if (tile) ctx.drawImage(tile, baseX + tx * step, baseY + ty * step);
      else whole = false;
    }
  }
  const painter = painterFor(ctx, ratio, unit, ox, oy);
  const { at } = painter;
  painter.seen = (point, margin = unit) => point[0] > -margin && point[0] < width + margin && point[1] > -margin && point[1] < height + margin;
  // Whatever's drawn here reads the scene and its materials from where the room view keeps its own.
  const shown = { scene: iso.scene, materials: iso.materials };
  Object.assign(iso, { scene, materials: picture.materials });
  try {
    painter.flat();
    const props = [];
    for (const door of scene.doorways ?? []) {
      const { wx, wy } = cellCentre(door.x, door.y);
      if (!painter.seen(at(wx, wy, 0.8), unit * 2.5)) continue;
      if (pixelArtOn()) props.push({ depth: pixelDoorDepth(door, CELL_WIDTH), span: uvBox(door.x - 1, door.y, door.x + 2, door.y + 1, WALL_HEIGHT), draw: () => drawPixelDoor(painter, { ...door, kinds: scene.kinds }, 0, { cellWidth: CELL_WIDTH, wallHeight: WALL_HEIGHT }) });
      else props.push({ depth: wx + wy - 0.39, span: uvBox(door.x, door.y, door.x + 1, door.y + 1, WALL_HEIGHT), draw: () => drawDoorPanels(painter, door, 0, scene.style) });
    }
    for (const post of view.posts ?? []) {
      const { wx, wy } = cellCentre(post.x, post.y);
      const [x, y] = at(wx, wy);
      if (!painter.seen([x, y], unit * 2)) continue;
      const { u, v } = project(wx, wy);
      props.push({ depth: wx + wy, span: { minU: u - 0.25, maxU: u + 0.25, minV: v - 0.95, maxV: v + 0.05 }, draw: () => drawPerson(ctx, x, y, figureUnit(unit), { look: lookFor(post.id, null, false) }) });
    }
    // What stands nearer the camera than a door or a person, and over them on the screen, is drawn again over them.
    const covering = new Set();
    for (const prop of props) {
      for (const block of scene.blocks) {
        if (block.depth <= prop.depth || block.style === "plants") continue;
        const { span } = block;
        if (span.maxU > prop.span.minU && span.minU < prop.span.maxU && span.maxV > prop.span.minV && span.minV < prop.span.maxV) covering.add(block);
      }
    }
    for (const item of [...props, ...covering].sort((a, b) => a.depth - b.depth)) {
      if (item.draw) item.draw();
      else drawBlock(painter, item, picture.materials);
      painter.flat();
    }
  } finally {
    Object.assign(iso, shown);
  }
  if (picture.lightmap) {
    painter.flat();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(picture.lightmap.canvas, ox + picture.left, oy + picture.top, picture.width, picture.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.14;
    ctx.drawImage(picture.lightmap.haze, ox + picture.left, oy + picture.top, picture.width, picture.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  // Where the mouse is on the plan: the outline of that square on the floor.
  if (ring) {
    painter.flat();
    const [x0, x1, y0, y1] = [ring.x * CELL_WIDTH, (ring.x + 1) * CELL_WIDTH, ring.y, ring.y + 1];
    stroke(painter, [[x0, y0, 0.02], [x1, y0, 0.02], [x1, y1, 0.02], [x0, y1, 0.02], [x0, y0, 0.02]], "rgba(255,246,220,.95)", 1.5);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return whole;
}

// The square of the deck under a point of the editor's picture as it was last drawn, for a click on it (the point by
// the window's own measure, as a click gives it). Null before anything's drawn, or off the deck.
export function previewSquare(canvas, clientX, clientY) {
  const { last } = previewOf;
  if (!last) return null;
  const box = canvas.getBoundingClientRect();
  const { x, y } = cellAt((clientX - box.left - last.ox) / last.unit, (clientY - box.top - last.oy) / last.unit);
  return x >= 0 && y >= 0 && x < last.cols && y < last.lines ? { x, y } : null;
}
