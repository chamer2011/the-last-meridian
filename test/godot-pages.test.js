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
async function startServer() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-godot-pages-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port), GAME_LICENSED_DIR: path.join(data, "no-packs") };
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
