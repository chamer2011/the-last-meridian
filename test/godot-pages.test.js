// The Godot view's menus (src/godot-pages.js, src/godot-pages-worker.js, src/mini-dom.js): each menu is built by the
// page's own code on a small stand-in for a page and handed to Godot as a tree, and a click in Godot runs the button's
// own listener, which sends its order to the game as the page does. Over the real server.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-pages-"));
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { projectDir } = await import("../src/paths.js");
const { Element, describe, fire, makeDocument } = await import("../src/mini-dom.js");

const servers = [];
async function startServer(more = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-pages-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port), GAME_LICENSED_DIR: path.join(data, "no-packs"), ...more };
  const child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  servers.push(child);
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
  const address = `http://127.0.0.1:${port}`;
  const get = async (route) => (await fetch(address + route)).json();
  const post = async (route, body = {}) => {
    const res = await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const page = (body) => post("/api/godot/page", body);
  return { data, get, post, page };
}
after(() => {
  for (const child of servers) child.kill();
});

// A game past its opening, left as a save for the server to open.
function leaveSave(data, slot = "slot1") {
  const game = createGameFromDraft(randomDraft({ seed: 17, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story has begun." });
  fs.writeFileSync(path.join(data, "saves", `${slot}.json`), JSON.stringify(game));
}

// The words of a tree, and the first element of it that passes a test.
const words = (node) => (typeof node === "string" ? node : (node.k ?? []).map(words).join(""));
function find(node, passes) {
  if (typeof node === "string") return null;
  if (passes(node)) return node;
  for (const child of node.k ?? []) {
    const found = find(child, passes);
    if (found) return found;
  }
  return null;
}
const button = (tree, says) => find(tree, (node) => node.t === "button" && words(node).includes(says));

test("the stand-in page: elements, their classes and words, and a click that runs what the page's code hung on it", async () => {
  const document = makeDocument();
  let clicked = 0;
  const row = document.createElement("div");
  row.className = "menu-row small";
  const press = document.createElement("button");
  press.addEventListener("click", async () => { clicked += 1; });
  press.append("Wait ", "1 day");
  press.setAttribute("title", "A day goes by");
  press.disabled = false;
  const off = document.createElement("button");
  off.disabled = true;
  off.append("Never");
  const where = document.createElement("span");
  where.setAttribute("style", "left:12ch;top:calc(3 * var(--map-row))");
  row.append(press, off, where, null, "after");
  assert.ok(row instanceof Element);
  assert.equal(row.querySelector("button"), press);
  assert.equal(row.querySelector(".small"), null, "it looks inside, not at itself");
  assert.equal(row.textContent, "Wait 1 dayNeverafter");
  const ids = [];
  const tree = describe(row, ids);
  assert.deepEqual(tree, {
    t: "div",
    c: "menu-row small",
    k: [
      { t: "button", id: 0, on: ["click"], tip: "A day goes by", k: ["Wait ", "1 day"] },
      { t: "button", d: 1, k: ["Never"] },
      { t: "span", st: "left:12ch;top:calc(3 * var(--map-row))" },
      "after",
    ],
  });
  await fire(ids[0], "click");
  assert.equal(clicked, 1);
  // A fold opens and shuts in place, as the page's own code does it.
  row.classList.toggle("open", true);
  assert.equal(row.className, "menu-row small open");
  row.replaceChildren("gone");
  assert.equal(press.parentNode, null);
  assert.deepEqual(describe(row, []), { t: "div", c: "menu-row small open", k: ["gone"] });
});

test("the stand-in page: a style set a thing at a time, a list to pick from, and something that's a button by its role", async () => {
  const document = makeDocument();
  const box = document.createElement("div");
  box.className = "board-node beat";
  box.setAttribute("role", "button");
  box.style.left = "150px";
  box.style.zIndex = 3;
  box.style.top = "";
  assert.equal(box.style.cssText, "left:150px;z-index:3");
  assert.equal(box.style.left, "150px");
  assert.ok(box.matches(".board-label, .board-node"), "any of a few selectors will do");
  const pick = document.createElement("select");
  for (const value of ["one", "two", "three"]) {
    const option = document.createElement("option");
    option.value = value;
    option.selected = value === "two";
    option.append(value.toUpperCase());
    pick.append(option);
  }
  assert.equal(pick.options.length, 3);
  assert.equal(pick.value, "two", "the choice marked as picked");
  pick.value = "three";
  assert.equal(pick.value, "three");
  const ids = [];
  const tree = describe(box, ids);
  // Nothing listens on it, and it can be clicked all the same: the page hears those clicks from further up.
  assert.deepEqual(tree, { t: "div", c: "board-node beat", id: 0, on: ["click"], st: "left:150px;z-index:3" });
  assert.deepEqual(describe(pick, []).k[1], { t: "option", v: "two", sel: 1, k: ["TWO"] });
  // How big something is drawn is only known where whoever draws it has said.
  assert.equal(box.offsetHeight, 0);
  Element.sizeOf = (node) => (node === box ? { w: 230, h: 96 } : null);
  assert.equal(box.offsetHeight, 96);
  assert.equal(pick.offsetHeight, 0);
  Element.sizeOf = null;
  // What the page's code set listening on the page itself hears what's sent there.
  let heard = null;
  document.addEventListener("pointerdown", () => { throw new Error("another window's listener"); });
  document.addEventListener("pointerdown", (event) => { heard = event.target; });
  await document.send("pointerdown", { target: box });
  assert.equal(heard, box);
});

test("with no game open there are no menus", async () => {
  const { page } = await startServer();
  assert.deepEqual(await page({ op: "open", menu: "ship" }), { status: 200, game: false });
});

test("a menu is handed over as the page builds it, with the rail's buttons, and a click on a button does what it does", async () => {
  const { data, post, page, get } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const ship = await page({ op: "open", menu: "ship" });
  assert.equal(ship.status, 200);
  assert.equal(ship.menu, "ship");
  assert.equal(ship.label, "Ship");
  assert.equal(ship.tree.c, "menu-body");
  assert.match(words(ship.tree), /900 aboard/);
  assert.deepEqual(ship.rail.map((group) => group.title), ["The story", "The ship", "Gear", "Game"]);
  const entries = ship.rail.flatMap((group) => group.entries);
  assert.equal(entries.find((entry) => entry.id === "ship").kind, "menu");
  assert.equal(entries.find((entry) => entry.id === "inventory").kind, "window");
  assert.equal(entries.find((entry) => entry.id === "board").kind, "board");
  assert.equal(entries.find((entry) => entry.id === "mapedit").kind, "editor");
  // Nothing has changed, so looking again says so and sends nothing.
  assert.deepEqual(await page({ op: "look" }), { status: 200, game: true, on: "menu", same: true, of: ship.of });

  // Wait a day: the button's own listener sends the order, and the menu comes back as it now stands.
  const day = async () => Number((await get("/api/state")).game.clock.label.match(/Day (\d+)/)[1]);
  const before = await day();
  const wait = button(ship.tree, "Wait 1 day");
  assert.ok(wait && wait.on.includes("click"));
  const waited = await page({ op: "click", id: wait.id, of: ship.of });
  assert.equal(waited.message.ok, true);
  assert.match(waited.message.text, /holds position for 1 day/);
  assert.equal(await day(), before + 1);
  assert.notEqual(waited.of, ship.of);

  // A fold opens in place: nothing is asked of the game for it.
  const fold = find(waited.tree, (node) => node.t === "section" && String(node.c).includes("fold") && words(node).includes("Ship's log"));
  assert.ok(!String(fold.c).split(" ").includes("open"));
  const opened = await page({ op: "click", id: button(fold, "Ship's log").id, of: waited.of });
  const now = find(opened.tree, (node) => node.t === "section" && String(node.c).includes("fold") && words(node).includes("Ship's log"));
  assert.ok(String(now.c).split(" ").includes("open"));
  assert.match(words(button(now, "Ship's log")), /^- /);

  // A click that names a menu built before this one is never taken for another button: the menu is just handed over again.
  const stale = await page({ op: "click", id: wait.id, of: ship.of });
  assert.equal(stale.menu, "ship");
  assert.equal(await day(), before + 1, "and no second day went by");
});

test("every menu on the rail can be built, a button of one menu opens another, and the star map sets a course", async () => {
  const { data, post, page, get } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const first = await page({ op: "open", menu: "leads" });
  for (const entry of first.rail.flatMap((group) => group.entries).filter((one) => one.kind === "menu")) {
    const menu = await page({ op: "open", menu: entry.id });
    assert.equal(menu.status, 200, `${entry.label}: ${menu.error ?? ""}`);
    assert.equal(menu.menu, entry.id);
    assert.ok(words(menu.tree).length > 20, `${entry.label} has something in it`);
  }
  // What isn't a menu is Godot's to open, and it's told so.
  const window = await page({ op: "open", menu: "inventory" });
  assert.deepEqual(window.effects, [{ type: "window", id: "inventory" }]);
  // The Ship menu's button for the star map.
  const ship = await page({ op: "open", menu: "ship" });
  const map = await page({ op: "click", id: button(ship.tree, "Open the star map").id, of: ship.of });
  assert.equal(map.menu, "map");
  // A star picked, then its course set: the ship jumps, and the menu gets out of the way of the new place.
  const star = find(map.tree, (node) => node.t === "button" && String(node.c).includes("map-star") && words(node).includes("Haven"));
  assert.match(star.st, /^left:\d+ch;top:calc\(\d+ \* var\(--map-row\)\)$/);
  const picked = await page({ op: "click", id: star.id, of: map.of });
  const card = find(picked.tree, (node) => String(node.c).includes("map-details"));
  assert.match(words(card), /Haven Station/);
  const gone = await page({ op: "click", id: button(card, "Set course").id, of: picked.of });
  assert.ok(gone.effects.some((effect) => effect.type === "close"));
  assert.equal((await get("/api/state")).game.ship.at, "haven");
});

test("Settings in Godot keep to what's the game's: a save made from there is on the disk, and a load says to open the game again", async () => {
  const { data, post, page } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const settings = await page({ op: "open", menu: "settings" });
  assert.doesNotMatch(words(settings.tree), /Story view|Interface size|Popup font/, "the browser page's own settings aren't offered");
  const row = find(settings.tree, (node) => String(node.c).includes("menu-row") && words(node).includes("Slot 2"));
  assert.match(words(row), /empty/);
  const saved = await page({ op: "click", id: button(row, "Save").id, of: settings.of });
  assert.match(saved.message.text, /Saved to slot 2/);
  assert.ok(fs.existsSync(path.join(data, "saves", "slot2.json")));
  const again = find(saved.tree, (node) => String(node.c).includes("menu-row") && words(node).includes("Slot 2"));
  const loaded = await page({ op: "click", id: button(again, "Load").id, of: saved.of });
  assert.deepEqual(loaded.effects.map((effect) => effect.type), ["close", "reload"]);
});

test("the registry printout is the page's own, a page at a time, and tearing it off puts it away", async () => {
  const { data, post, page } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const sheet = await page({ op: "open", on: "sheet" });
  assert.equal(sheet.on, "sheet");
  assert.match(words(sheet.tree), /FLEET REGISTRY/);
  assert.match(words(sheet.tree), /ATTRIBUTES/);
  // The menu that's open is another thing altogether, with its own numbers.
  const ship = await page({ op: "open", menu: "ship" });
  assert.equal(ship.on, "menu");
  const skills = await page({ op: "click", on: "sheet", id: button(sheet.tree, "SKILLS").id, of: sheet.of });
  assert.match(words(skills.tree), /PRACTICE/);
  assert.equal((await page({ op: "look" })).same, true, "the menu wasn't touched by it");
  const torn = await page({ op: "click", on: "sheet", id: button(skills.tree, "TEAR OFF").id, of: skills.of });
  assert.equal(torn.closed, true);
});

test("a captain is made in Godot with the page's own creator, with no game open, and the game begins", async () => {
  const { page, get } = await startServer();
  const title = await get("/api/godot/saves");
  assert.equal(title.playing, null);
  assert.ok(Array.isArray(title.saves) && title.where.folder);
  const start = await page({ op: "open", on: "creator" });
  assert.equal(start.on, "creator");
  assert.match(words(start.tree), /OPEN A NEW DOSSIER/i);
  // A ready-made captain, straight to the review, and Begin.
  const ready = await page({ op: "click", on: "creator", id: button(start.tree, "Fleet Officer").id, of: start.of });
  assert.match(words(ready.tree), /REVIEW/i);
  const begin = find(ready.tree, (node) => node.t === "button" && String(node.c).split(" ").includes("begin") && !node.d);
  assert.ok(begin, "there's a way to begin");
  const begun = await page({ op: "click", on: "creator", id: begin.id, of: ready.of });
  assert.deepEqual(begun.effects.map((effect) => effect.type), ["close", "reload"]);
  const now = await get("/api/godot/saves");
  assert.equal(typeof now.playing.name, "string");
  assert.equal(now.playing.over, false);
});

test("a computer's desktop is the page's own too: an icon opens its window, and Esc logs off", async () => {
  const { data, post, page, get } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  assert.equal((await page({ op: "open", on: "computer" })).closed, true, "nobody's at a computer yet");
  // The captain sits down at the plot table, which is theirs: straight in.
  const room = (await get("/api/godot/walk")).walk;
  const table = room.things.find((thing) => /plot table/i.test(thing.name));
  await post("/api/walk", { action: "go", to: `thing:${table.id}` });
  assert.ok((await post("/api/walk", { action: "use", key: table.id })).computer);
  const desk = await page({ op: "open", on: "computer" });
  assert.equal(desk.on, "computer");
  const os = find(desk.tree, (node) => String(node.c).split(" ").includes("os"));
  assert.ok(os, "there's a desktop");
  const icon = find(os, (node) => node.t === "button" && String(node.c).includes("icon") && words(node).includes("Systems"));
  // Its picture is a few coloured rectangles, which come through for Godot to draw.
  const picture = find(icon, (node) => node.t === "svg");
  assert.ok(picture.svg.rects.length > 0 && picture.svg.w === 16);
  const before = JSON.stringify(desk.tree).split('"win ').length;
  const opened = await page({ op: "click", on: "computer", id: icon.id, of: desk.of });
  assert.ok(JSON.stringify(opened.tree).split('"win ').length > before, "a window opened");
  assert.match(words(opened.tree), /Doors/);
  const left = await page({ op: "key", on: "computer", key: "Escape" });
  assert.equal(left.closed, true);
  assert.equal((await post("/api/godot/tick", { ms: 0, rate: 10 })).state.computer, false);
});

test("the quest log and the simulator's fight window are the page's own too", async () => {
  const { data, post, page } = await startServer();
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const log = await page({ op: "open", on: "quests" });
  assert.equal(log.on, "quests");
  assert.match(words(log.tree), /What happened/);
  const shut = await page({ op: "click", on: "quests", id: button(log.tree, "Close").id, of: log.of });
  assert.equal(shut.closed, true);
  // No fight, no fight window; one run in the simulator from Enemies met, and there is one, with its orders.
  assert.equal((await page({ op: "open", on: "fight" })).closed, true);
  const met = await page({ op: "open", menu: "bestiary" });
  const run = button(met.tree, "Run in simulator");
  assert.ok(run && !run.d, "the simulator's aboard");
  await page({ op: "click", id: run.id, of: met.of });
  const fight = await page({ op: "open", on: "fight" });
  assert.match(words(fight.tree), /simulation/i);
  assert.ok(button(fight.tree, "Attack"), "there's an order to give");
});

test("the Story board is the page's own too: boxes where its code stacks them, a click on one to read and change it, and Close", async () => {
  // Its stories are a copy, though nothing here saves one.
  const stories = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-board-"));
  fs.cpSync(path.join(projectDir, "world", "stories"), stories, { recursive: true });
  const { data, post, page } = await startServer({ GAME_STORIES_DIR: stories });
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const board = await page({ op: "open", on: "board" });
  assert.equal(board.on, "board");
  const all = (node, cls, out = []) => {
    if (typeof node === "string") return out;
    if (String(node.c ?? "").split(" ").includes(cls)) out.push(node);
    for (const child of node.k ?? []) all(child, cls, out);
    return out;
  };
  const place = (node) => ({ x: Number(/left:(-?[\d.]+)px/.exec(node.st)[1]), y: Number(/top:(-?[\d.]+)px/.exec(node.st)[1]) });
  const boxes = all(board.tree, "board-node");
  assert.ok(boxes.length > 5, "a story is a board of boxes");
  // Each can be clicked, and those in one column are stacked clear of each other: the heights are worked out here.
  assert.ok(boxes.every((box) => box.id !== undefined && box.on.includes("click")));
  const columns = {};
  for (const box of boxes) (columns[place(box).x] ??= []).push(place(box).y);
  const tallest = Object.values(columns).sort((a, b) => b.length - a.length)[0];
  assert.ok(tallest.length > 2);
  for (let i = 1; i < tallest.length; i += 1) assert.ok(tallest[i] - tallest[i - 1] >= 60, `a box has room above the next (${tallest[i - 1]} then ${tallest[i]})`);
  // The arrows are lines through points, and the lists to pick from come with their choices.
  const wires = find(board.tree, (node) => node.t === "svg");
  assert.ok(wires.svg.paths.length > 3 && wires.svg.paths.every((one) => typeof one[0] === "string" && one.length >= 5));
  const lists = all(board.tree, "board-head")[0].k.filter((node) => node.t === "select");
  assert.equal(lists.length, 2);
  assert.equal(lists[0].v, "story");
  assert.ok(find(lists[1], (node) => node.t === "optgroup" && node.label), "the stories come under their kinds");
  // A click on a box picks it: its words are beside the sheet in a box to change them in.
  const lead = boxes.find((box) => words(box).includes("The lead"));
  const picked = await page({ op: "click", on: "board", id: lead.id, of: board.of });
  assert.ok(all(picked.tree, "board-node").some((box) => box.c.includes("selected") && words(box).includes("The lead")));
  const side = all(picked.tree, "board-inspector")[0];
  const area = find(side, (node) => node.t === "textarea");
  assert.ok(area && area.v.length > 20, "the lead's words, to change");
  // New words, kept: the box on the sheet has them, and nothing is saved until Save.
  await page({ op: "input", on: "board", id: area.id, of: picked.of, value: "A lead rewritten in the Godot window." });
  const again = await page({ op: "look", on: "board" });
  const kept = await page({ op: "click", on: "board", id: button(all(again.tree ?? picked.tree, "board-inspector")[0], "Keep").id, of: again.of ?? picked.of });
  assert.ok(all(kept.tree, "board-node").some((box) => words(box).includes("A lead rewritten in the Godot window.")));
  assert.ok(!fs.readdirSync(stories).some((file) => fs.readFileSync(path.join(stories, file), "utf8").includes("rewritten in the Godot window")));
  // Close asks first about what isn't saved, and the second time puts the board away.
  const asked = await page({ op: "click", on: "board", id: button(kept.tree, "Close").id, of: kept.of });
  assert.match(words(all(asked.tree, "board-status")[0]), /aren't saved/);
  const shut = await page({ op: "click", on: "board", id: button(asked.tree, "Close").id, of: asked.of });
  assert.equal(shut.closed, true);
});

test("the Map editor is the page's own too: its deck comes as shapes to draw, and the pointer on it paints, as on the page", async () => {
  // The decks it saves into are a copy.
  const kept = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-mapedit-"));
  const maps = path.join(kept, "maps");
  const life = path.join(kept, "life");
  fs.cpSync(process.env.GAME_MAPS_DIR ?? path.join(projectDir, "world", "maps"), maps, { recursive: true });
  fs.cpSync(process.env.GAME_LIFE_DIR ?? path.join(projectDir, "world", "life"), life, { recursive: true });
  const { data, get, post, page } = await startServer({ GAME_MAPS_DIR: maps, GAME_LIFE_DIR: life });
  leaveSave(data);
  await post("/api/load", { slot: "slot1" });
  const has = (node, cls) => String(node.c ?? "").split(" ").includes(cls);
  const editor = await page({ op: "open", on: "mapedit", wide: 1400, high: 860 });
  assert.equal(editor.on, "mapedit");
  assert.equal(find(editor.tree, (node) => has(node, "mapedit-decks")).k.length, 3, "a button a deck");
  // The plan is the page's own drawing, kept as shapes: fitted to the window it was told of, a square 6 by 12.
  const plan = (tree) => find(tree, (node) => node.t === "canvas" && node.cv);
  const deck = await get("/api/map/meridian/deck1");
  assert.equal(plan(editor.tree).st, `width:${deck.width * 6}px;height:${deck.height * 12}px`);
  const shapes = plan(editor.tree).cv;
  assert.ok(shapes.length > 500 && shapes.length < deck.width * deck.height, "floor beside floor is one shape");
  assert.deepEqual(shapes[0], ["r", 0, 0, deck.width * 6, deck.height * 12, "#020503ff"]);
  assert.ok(shapes.some((shape) => shape[0] === "t" && shape[1] === "The Bridge"), "the rooms' names are written on it");
  assert.ok(!find(editor.tree, (node) => node.t === "button" && words(node) === "Picture" && !node.hidden), "the picture under the plan is the browser's");
  // A square of plain floor with floor all round it and nothing standing near.
  const taken = new Set([...deck.people, ...deck.things, ...deck.exits, ...deck.spots, ...(deck.start ? [deck.start] : [])].map((one) => `${one.x},${one.y}`));
  const plain = (x, y) => deck.grid[y]?.[x] === deck.floor && !taken.has(`${x},${y}`);
  let spot = null;
  for (let y = 2; y < deck.height - 2 && !spot; y += 1) for (let x = 2; x < deck.width - 2 && !spot; x += 1) {
    let clear = !(deck.furniture ?? []).some((piece) => Math.abs(piece.x - x) < 6 && Math.abs(piece.y - y) < 4);
    for (let dy = -2; dy <= 2 && clear; dy += 1) for (let dx = -2; dx <= 2 && clear; dx += 1) clear = plain(x + dx, y + dy);
    if (clear) spot = { x, y };
  }
  assert.ok(spot, "there's open floor somewhere on the deck");
  const at = [spot.x * 6 + 3, spot.y * 12 + 6];
  // The pointer resting there says what's under it; a lamp is picked to paint, and a press there paints one.
  const over = await page({ op: "pointer", on: "mapedit", id: plan(editor.tree).id, of: editor.of, events: [["move", ...at]] });
  assert.match(words(find(over.tree, (node) => has(node, "mapedit-where"))), /^floor in /);
  const lamp = await page({ op: "click", on: "mapedit", id: button(over.tree, "Lamp").id, of: over.of });
  assert.ok(button(lamp.tree, "Lamp").pressed, "the paint in hand is lit");
  const painted = await page({ op: "pointer", on: "mapedit", id: plan(lamp.tree).id, of: lamp.of, events: [["down", ...at], ["move", ...at], ["up", ...at]] });
  const lit = (tree) => plan(tree).cv.filter((shape) => shape[0] === "r" && shape[5] === "#ffe08aff" && shape[1] === spot.x * 6 && shape[2] === spot.y * 12).length;
  assert.equal(lit(editor.tree), 0);
  assert.equal(lit(painted.tree), 1, "a lamp's colour on that square");
  assert.equal(words(button(painted.tree, "Save")), "Save *");
  // Saved: the game tries the deck out first, and keeps it in the copy; the deck in the game's own folder is as it was.
  const saved = await page({ op: "click", on: "mapedit", id: button(painted.tree, "Save").id, of: painted.of });
  assert.match(words(find(saved.tree, (node) => has(node, "mapedit-says"))), /^Saved\./);
  assert.equal((await get("/api/map/meridian/deck1")).grid[spot.y][spot.x], "!");
  // Close puts it away.
  const shut = await page({ op: "click", on: "mapedit", id: button(saved.tree, "Close").id, of: saved.of });
  assert.equal(shut.closed, true);
});
