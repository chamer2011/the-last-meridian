// People in a pixel style, for the pixel-art view (step 9 of the map's rework, a trial the owner switches on in
// Settings). The packs have no people, so the game still draws its own figure, with every pose it has: but onto a
// small picture of its own first, which is then made pixel art the way the packs' furniture is: hard edges, the
// figure's own few flat colours, and a dark line round it. The picture is kept, one for each look and pose, so a
// crowd costs a handful of small pictures and no more drawing than before.

// The figure's box, in its own units, with the point between the feet at 0, 0: wide enough for an arm, a pack, a
// sitter's legs and someone lying down, tall enough for a hat.
export const FIGURE_BOX = { left: 13, right: 13, up: 34, down: 4 };
// A walk is this many pictures round.
export const WALK_FRAMES = 8;
const OUTLINE = [17, 18, 23];
const SOLID_FROM = 110;

// How a figure is cut to a picture: so many of the picture's dots to one of the figure's thirty units of height.
// With the wheel at rest a dot is a whole number of the screen's own dots (one on a plain screen, two on a sharp
// one), so the figure's dots stay square and sharp, as the packs' furniture is at its own size.
let dots = 1.5;
export function setFigureRest(unitAtRest, ratio = 1) {
  const each = Math.max(1, Math.round(ratio));
  const next = (unitAtRest * ratio) / each;
  if (!(next > 0) || Math.abs(next - dots) < 1e-6) return;
  dots = next;
  sprites.clear();
}
export const figureDots = () => dots;

const rgbOf = (hex) => {
  const text = String(hex ?? "").replace("#", "");
  const full = text.length === 3 ? [...text].map((ch) => ch + ch).join("") : text;
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) || full.length !== 6 ? [106, 106, 96] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = ([r, g, b], by) => [Math.round(r * by), Math.round(g * by), Math.round(b * by)];
const mixed = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// The few colours a figure is made of: each cloth and its shaded side, skin, hair, boots, a pack. Everything the
// figure's drawing blends on the way (a shadow down the coat, a highlight on a shoulder) lands on the nearest of these.
export function figurePalette(look) {
  const coat = rgbOf(look?.coat);
  const trousers = rgbOf(look?.trousers);
  const skin = rgbOf(look?.skin);
  const colours = [
    coat, shade(coat, 0.7), rgbOf(look?.coatDark ?? look?.coat),
    trousers, shade(trousers, 0.8),
    skin, shade(skin, 0.78),
    look?.hat ? shade(coat, 0.7) : rgbOf(look?.hair),
    [24, 22, 18], // boots, a belt
  ];
  if (look?.vest) colours.push(mixed(coat, [20, 18, 14], 0.55));
  if (look?.pack) colours.push([44, 42, 32], [58, 54, 40]);
  return colours;
}

// Which of a walk's pictures a step is: the swing of the legs goes round once in two pi.
export function walkFrame(step, frames = WALK_FRAMES) {
  const turn = (Number(step) || 0) / (Math.PI * 2);
  return ((Math.round((turn - Math.floor(turn)) * frames) % frames) + frames) % frames;
}
export const stepOfFrame = (frame, frames = WALK_FRAMES) => (frame / frames) * Math.PI * 2;

// What tells one figure's picture from another's: who they look like and how they stand. Not which way they face
// across the screen (the picture is turned over for that), nor where they are.
export function spriteKey(person) {
  const look = person?.look ?? {};
  const pose = person?.asleep ? "lying" : person?.seated ? "sitting" : person?.walking ? `walk${walkFrame(person.step)}` : "standing";
  return [look.coat, look.coatDark, look.trousers, look.skin, look.hair, look.vest ? 1 : 0, look.pack ? 1 : 0, look.long ? 1 : 0, look.hat ? 1 : 0, person?.back ? "back" : "front", pose].join("|");
}

// Makes a drawn figure pixel art, in place: `data` is the picture's dots as red, green, blue and how solid, four
// numbers a dot. A dot more than a little solid becomes wholly so, in the nearest of the figure's own colours; the
// rest go clear; and every clear dot beside a solid one becomes the dark line round the figure.
export function pixelate(data, width, height, palette, outline = OUTLINE) {
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    if (data[at + 3] < SOLID_FROM) {
      data[at + 3] = 0;
      continue;
    }
    solid[i] = 1;
    let best = 0;
    let bestFar = Infinity;
    for (let p = 0; p < palette.length; p += 1) {
      const far = (data[at] - palette[p][0]) ** 2 + (data[at + 1] - palette[p][1]) ** 2 + (data[at + 2] - palette[p][2]) ** 2;
      if (far < bestFar) {
        bestFar = far;
        best = p;
      }
    }
    data[at] = palette[best][0];
    data[at + 1] = palette[best][1];
    data[at + 2] = palette[best][2];
    data[at + 3] = 255;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (solid[i]) continue;
      const beside = (x > 0 && solid[i - 1]) || (x < width - 1 && solid[i + 1]) || (y > 0 && solid[i - width]) || (y < height - 1 && solid[i + width]);
      if (!beside) continue;
      const at = i * 4;
      data[at] = outline[0];
      data[at + 1] = outline[1];
      data[at + 2] = outline[2];
      data[at + 3] = 255;
    }
  }
  return data;
}

// ---- The pictures themselves, in the page ------------------------------------------------------------------------

const sprites = new Map();
const MOST_SPRITES = 900;

// A figure's picture, made the first time it's asked for. `drawFigure(ctx, dots)` draws the figure with the point
// between its feet at 0, 0 and `dots` of the picture to one of its units; nothing else may be drawn by it (no shadow,
// no ring: those stay on the floor, under the picture).
export function figureSprite(person, drawFigure) {
  const key = spriteKey(person);
  const known = sprites.get(key);
  if (known) return known;
  // The feet sit on a whole dot, so the picture's dots land on the screen's.
  const footX = Math.round(FIGURE_BOX.left * dots);
  const footY = Math.round(FIGURE_BOX.up * dots);
  const width = footX + Math.ceil(FIGURE_BOX.right * dots);
  const height = footY + Math.ceil(FIGURE_BOX.down * dots);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(footX, footY);
  drawFigure(ctx, dots);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const picture = ctx.getImageData(0, 0, width, height);
  pixelate(picture.data, width, height, figurePalette(person.look));
  ctx.putImageData(picture, 0, 0);
  if (sprites.size >= MOST_SPRITES) sprites.clear();
  const made = { canvas, dots, width, height, footX, footY };
  sprites.set(key, made);
  return made;
}

// Puts a figure's picture in the room, at the place the canvas is already moved to: `scale` of the screen to one of
// the figure's units, turned over for someone facing the other way. A picture shown smaller than it was made is
// smoothed, as the packs' are; one shown at its own size or larger keeps its dots sharp.
export function drawFigureSprite(ctx, sprite, scale, flip, ratio = 1) {
  const by = scale / sprite.dots;
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = by * ratio < 0.999;
  ctx.save();
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sprite.canvas, -sprite.footX * by, -sprite.footY * by, sprite.width * by, sprite.height * by);
  ctx.restore();
  ctx.imageSmoothingEnabled = smooth;
}

export const forgetFigures = () => sprites.clear();
