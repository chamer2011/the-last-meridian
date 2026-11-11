// The Story board's Requests page (organic quests step 7): every request as a box, one request's lines on top and parts,
// the checker's problems, and saving into a copy of world/scenes. The page in the browser is checked by hand.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-board-requests-"));
process.env.GAME_DATA_DIR = dataDir;
// The board saves into a copy of the scenes, never the real ones.
const scenesCopy = path.join(dataDir, "scenes");
fs.cpSync(fileURLToPath(new URL("../world/scenes/", import.meta.url)), scenesCopy, { recursive: true });
process.env.GAME_SCENES_DIR = scenesCopy;

const { boardWorldItem, boardWorldList, checkBoardScene, saveBoardWorldItem } = await import("../src/board.js");

test("the Requests page lists every request, grouped by the lives it's for, after Every request", () => {
  const items = boardWorldList("request");
  assert.deepEqual(items[0], { id: "every", name: "Every request", kind: "all of them" });
  const medicine = items.find((one) => one.id === "medicine");
  assert.deepEqual(medicine, { id: "medicine", name: "Medicine for the medbay", kind: "for the captain" });
  assert.equal(items.find((one) => one.id === "port_food")?.kind, "for anyone");
  const every = boardWorldItem("request", "every");
  assert.equal(every.value.overview, true);
  const shift = every.value.kinds.find((one) => one.id === "extra_shift");
  assert.deepEqual({ group: shift.group, order: shift.order, asks: shift.asks, needs: shift.needs, by: shift.by, problems: shift.problems }, { group: "crew", order: true, asks: "your officer", needs: "work a shift", by: "1 day", problems: 0 });
  assert.throws(() => saveBoardWorldItem("request", "every", "# x"), /made from their files/);
});

test("one request: its file, its parts as a scene's, and the checker's problems as a request", () => {
  const item = boardWorldItem("request", "medicine");
  assert.equal(item.value.title, "Medicine for the medbay");
  assert.match(item.value.header, /^for: the captain$/m);
  for (const name of ["ask", "yes", "done", "failed", "gone"]) assert.ok(item.value.parts.some((one) => one.name === name), name);
  assert.ok(item.value.parts.some((one) => one.name === "ask" && one.choices.some((choice) => choice.to === "yes")));
  assert.deepEqual(item.problems, []);
  // A line on top that's wrong is a request's problem, and the file isn't saved while it can't be read at all.
  const broken = item.text.replace("by: 5 days", "by: whenever");
  assert.match(checkBoardScene("medicine", broken, "request").problems.join(" "), /request_medicine: by: is how long they give you/);
  assert.equal(saveBoardWorldItem("request", "medicine", "== ask\n> Choice with nowhere to go").saved, false);
  assert.throws(() => boardWorldItem("request", "moonbeams"), /There's no request called moonbeams/);
});

test("saving a request writes the copy of its file, and the checker looks at it again", () => {
  const item = boardWorldItem("request", "medicine");
  const changed = item.text.replace("by: 5 days", "by: 6 days");
  const saved = saveBoardWorldItem("request", "medicine", changed);
  assert.equal(saved.saved, true);
  assert.deepEqual(saved.problems, []);
  assert.match(fs.readFileSync(path.join(scenesCopy, "request_medicine.txt"), "utf8"), /^by: 6 days$/m);
  assert.notEqual(fs.readFileSync(fileURLToPath(new URL("../world/scenes/request_medicine.txt", import.meta.url)), "utf8"), changed, "the real file is untouched");
  const again = boardWorldItem("request", "every").value.kinds.find((one) => one.id === "medicine");
  assert.equal(again.by, "6 days");
});
