// People in a pixel style (public/pixel-people.js): the parts that need no screen. What a figure's picture is made
// from, which picture a pose is, and how a drawn figure is turned into pixel art.
import test from "node:test";
import assert from "node:assert/strict";
import { FIGURE_BOX, WALK_FRAMES, figureDots, figurePalette, pixelate, setFigureRest, spriteKey, stepOfFrame, walkFrame } from "../public/pixel-people.js";
import { pixelPeople, setPixelArt } from "../public/pixel-art.js";

const LOOK = { coat: "#7c9484", coatDark: "#54665a", trousers: "#2c3430", skin: "#d8b090", hair: "#2a2420", vest: false, pack: false, long: false, hat: false };

test("a figure is made of its own few colours: each cloth with its shaded side, skin, hair and boots", () => {
  const plain = figurePalette(LOOK);
  assert.deepEqual(plain[0], [0x7c, 0x94, 0x84], "the coat as it is");
  assert.ok(plain.some((c) => c.join() === [0x2c, 0x34, 0x30].join()), "the trousers");
  assert.ok(plain.some((c) => c.join() === [0xd8, 0xb0, 0x90].join()), "the skin");
  assert.ok(plain.some((c) => c.join() === [0x2a, 0x24, 0x20].join()), "the hair");
  assert.ok(plain.length <= 12, "few enough to be flat");
  // A vest and a pack bring their own colours; a hat is the coat's colour, darker, where the hair was.
  assert.ok(figurePalette({ ...LOOK, vest: true, pack: true }).length > plain.length);
  assert.ok(!figurePalette({ ...LOOK, hat: true }).some((c) => c.join() === [0x2a, 0x24, 0x20].join()));
  // A look with a colour missing still gives a palette.
  assert.ok(figurePalette({}).every((c) => c.length === 3 && c.every(Number.isFinite)));
});

test("a walk is a few pictures round, and a step is always one of them", () => {
  assert.equal(walkFrame(0), 0);
  assert.equal(walkFrame(Math.PI), WALK_FRAMES / 2);
  assert.equal(walkFrame(Math.PI * 2), 0);
  assert.equal(walkFrame(Math.PI * 2 * 5 + 0.01), 0);
  for (const step of [-7.3, -0.2, 0.4, 3.9, 12.1, 400.5]) {
    const frame = walkFrame(step);
    assert.ok(Number.isInteger(frame) && frame >= 0 && frame < WALK_FRAMES, `${step} gave ${frame}`);
  }
  for (let frame = 0; frame < WALK_FRAMES; frame += 1) assert.equal(walkFrame(stepOfFrame(frame)), frame);
});

test("one picture does for everyone who looks and stands the same, whichever way they face across the screen", () => {
  const standing = { look: LOOK };
  assert.equal(spriteKey(standing), spriteKey({ look: { ...LOOK }, flip: true, ring: "red", raise: 0.2 }));
  const keys = new Set([
    spriteKey(standing),
    spriteKey({ look: LOOK, back: true }),
    spriteKey({ look: LOOK, seated: true }),
    spriteKey({ look: LOOK, asleep: true }),
    spriteKey({ look: LOOK, walking: true, step: 0 }),
    spriteKey({ look: LOOK, walking: true, step: Math.PI }),
    spriteKey({ look: { ...LOOK, coat: "#aa3030" } }),
    spriteKey({ look: { ...LOOK, hat: true } }),
  ]);
  assert.equal(keys.size, 8, "each of these is its own picture");
  // Two steps in the same part of the stride are the same picture.
  assert.equal(spriteKey({ look: LOOK, walking: true, step: 0.01 }), spriteKey({ look: LOOK, walking: true, step: 0.02 }));
});

test("a drawn figure becomes pixel art: hard edges, its own colours, a dark line round it", () => {
  const [w, h] = [7, 7];
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x, y, r, g, b, a) => data.set([r, g, b, a], (y * w + x) * 4);
  // A three by three block of a blended coat colour in the middle, with a faint dot beside it and a soft one below.
  for (let y = 2; y <= 4; y += 1) for (let x = 2; x <= 4; x += 1) put(x, y, 120, 150, 130, 255);
  put(5, 3, 120, 150, 130, 40); // too faint to count
  put(3, 5, 215, 172, 146, 180); // solid enough, nearly skin
  const palette = figurePalette(LOOK);
  const outline = [1, 2, 3];
  pixelate(data, w, h, palette, outline);
  const at = (x, y) => [...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
  assert.deepEqual(at(3, 3), [0x7c, 0x94, 0x84, 255], "the block is the coat's own colour, wholly solid");
  assert.deepEqual(at(3, 5), [0xd8, 0xb0, 0x90, 255], "the soft dot is skin, wholly solid");
  assert.deepEqual(at(5, 3), [1, 2, 3, 255], "the faint dot is gone, and the line runs where it was, beside the block");
  assert.deepEqual(at(1, 3), [1, 2, 3, 255], "the line on the other side");
  assert.deepEqual(at(3, 1), [1, 2, 3, 255], "and above");
  assert.deepEqual(at(3, 6), [1, 2, 3, 255], "and under the dot below");
  assert.equal(at(1, 1)[3], 0, "a corner the figure doesn't touch stays clear");
  assert.equal(at(0, 0)[3], 0);
  // Every dot is now clear or wholly solid, and every solid one is the line or one of the figure's colours.
  const allowed = new Set([...palette, outline].map((c) => c.join()));
  for (let i = 0; i < w * h; i += 1) {
    const [r, g, b, a] = data.slice(i * 4, i * 4 + 4);
    assert.ok(a === 0 || a === 255, `dot ${i} is half there`);
    if (a) assert.ok(allowed.has([r, g, b].join()), `dot ${i} is a colour of its own: ${[r, g, b]}`);
  }
});

test("a figure's dots are a whole number of the screen's, on a plain screen and on a sharp one", () => {
  const rest = 1.4875;
  setFigureRest(rest, 1);
  assert.ok(Math.abs(figureDots() - rest) < 1e-9, "one dot to a dot");
  setFigureRest(rest, 2);
  assert.ok(Math.abs(figureDots() - rest) < 1e-9, "two of the screen's to one of the figure's");
  setFigureRest(rest, 1.5);
  assert.ok(Math.abs(figureDots() - rest * 0.75) < 1e-9, "two of the screen's again, so fewer, larger dots");
  setFigureRest(rest, 1.25);
  assert.ok(Math.abs(figureDots() - rest * 1.25) < 1e-9, "one of the screen's");
  for (const ratio of [1, 1.25, 1.5, 2, 3]) {
    setFigureRest(rest, ratio);
    const screenDotsPerFigureDot = (rest * ratio) / figureDots();
    assert.ok(Math.abs(screenDotsPerFigureDot - Math.round(screenDotsPerFigureDot)) < 1e-9, `at ${ratio}`);
  }
  // Nonsense leaves it as it was.
  setFigureRest(rest, 1);
  setFigureRest(0, 1);
  setFigureRest(Number.NaN, 1);
  assert.ok(Math.abs(figureDots() - rest) < 1e-9);
  assert.ok(FIGURE_BOX.up > 30 && FIGURE_BOX.left >= 10, "the box holds a figure thirty units tall with its arms out");
});

test("people are drawn as they always were unless the pixel-art view is on and the owner has asked for the trial", () => {
  assert.equal(pixelPeople(), false, "to begin with");
  // Asked for, but the view's pictures aren't there (no pack in a test): still the game's own figures.
  setPixelArt({ on: true, look: "dark", people: "pixel" });
  assert.equal(pixelPeople(), false);
  setPixelArt({ on: false, look: "dark", people: "drawn" });
  assert.equal(pixelPeople(), false);
});
