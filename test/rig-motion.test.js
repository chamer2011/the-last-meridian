// The rig coming out of the pocket and going back (public/rig-motion.js): what it's doing so long after it was told to,
// when the rig itself is on the screen and when its tab is, a press in the middle turning it round from where it is,
// and the stylesheet's animations lasting as long as the page thinks they do. Nothing here needs a screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RIG_MOVE, rigMoveFrom, rigNextChange, rigPhase, rigShown, rigTurned } from "../public/rig-motion.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("coming out is one move, and it's over when its time is up", () => {
  const move = rigMoveFrom("out", 1000);
  assert.deepEqual(rigPhase(move, 1000), { phase: "out", ms: 0 });
  assert.deepEqual(rigPhase(move, 1000 + RIG_MOVE.out - 1), { phase: "out", ms: RIG_MOVE.out - 1 });
  assert.equal(rigPhase(move, 1000 + RIG_MOVE.out), null);
  assert.equal(rigPhase(null, 1000), null);
  // A clock read a moment before the move began doesn't put it before its start.
  assert.deepEqual(rigPhase(move, 990), { phase: "out", ms: 0 });
});

test("going away is the rig going in, then its tab coming out", () => {
  const move = rigMoveFrom("away", 0);
  assert.deepEqual(rigPhase(move, 0), { phase: "away", ms: 0 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.away - 1), { phase: "away", ms: RIG_MOVE.away - 1 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.away), { phase: "tab", ms: 0 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.away + 40), { phase: "tab", ms: 40 });
  assert.equal(rigPhase(move, RIG_MOVE.away + RIG_MOVE.tab), null);
});

test("the rig is on the screen while it's out and while it's still going in, and its tab after that", () => {
  assert.equal(rigShown(true, null, 0), true);
  assert.equal(rigShown(false, null, 0), false);
  // Out and on its way: it's there from the first moment.
  assert.equal(rigShown(true, rigMoveFrom("out", 0), 10), true);
  // Put away: still drawn while it slides in, gone once the tab comes out, and gone for good after.
  const away = rigMoveFrom("away", 0);
  assert.equal(rigShown(false, away, RIG_MOVE.away - 1), true);
  assert.equal(rigShown(false, away, RIG_MOVE.away), false);
  assert.equal(rigShown(false, away, RIG_MOVE.away + RIG_MOVE.tab + 500), false);
});

test("the page is told when the move's next change comes", () => {
  assert.equal(rigNextChange(null, 0), null);
  assert.equal(rigNextChange(rigMoveFrom("out", 0), 100), RIG_MOVE.out - 100);
  const away = rigMoveFrom("away", 0);
  assert.equal(rigNextChange(away, 100), RIG_MOVE.away - 100);
  assert.equal(rigNextChange(away, RIG_MOVE.away + 50), RIG_MOVE.tab - 50);
  assert.equal(rigNextChange(away, RIG_MOVE.away + RIG_MOVE.tab), null);
});

test("a press in the middle turns the rig round from where it is", () => {
  // Halfway out, told to go back: the way back begins half done.
  const out = rigMoveFrom("out", 0);
  const back = rigTurned(out, RIG_MOVE.out / 2, "away");
  assert.equal(back.dir, "away");
  assert.deepEqual(rigPhase(back, RIG_MOVE.out / 2), { phase: "away", ms: RIG_MOVE.away / 2 });
  // A quarter of the way back in, told to come out: three quarters of the way out already.
  const away = rigMoveFrom("away", 0);
  const again = rigTurned(away, RIG_MOVE.away / 4, "out");
  assert.equal(again.dir, "out");
  assert.equal(Math.round(rigPhase(again, RIG_MOVE.away / 4).ms), Math.round(RIG_MOVE.out * 0.75));
  // Barely begun, told to turn: nearly all the way back already, so it's over almost at once.
  const quick = rigTurned(out, 10, "away");
  assert.ok(rigNextChange(quick, 10) < 20);
});

test("with nothing to turn round from, a move begins at its start", () => {
  assert.deepEqual(rigTurned(null, 500, "out"), { dir: "out", at: 500 });
  // Over and done with.
  assert.deepEqual(rigTurned(rigMoveFrom("out", 0), RIG_MOVE.out + 1, "away"), { dir: "away", at: RIG_MOVE.out + 1 });
  // The rig has gone in and only its tab is still coming out: taking it out starts from the pocket.
  const away = rigMoveFrom("away", 0);
  assert.deepEqual(rigTurned(away, RIG_MOVE.away + 20, "out"), { dir: "out", at: RIG_MOVE.away + 20 });
  // Told the way it's already going.
  assert.deepEqual(rigTurned(rigMoveFrom("out", 0), 100, "out"), { dir: "out", at: 100 });
});

test("the stylesheet's animations last as long as the page thinks they do", () => {
  const css = fs.readFileSync(path.join(here, "..", "public", "desktop.css"), "utf8");
  const lasts = (name) => {
    const found = css.match(new RegExp(`animation: ${name} (\\d+)ms`));
    assert.ok(found, `desktop.css has no animation called ${name} with its time in milliseconds`);
    return Number(found[1]);
  };
  assert.equal(lasts("rig-out"), RIG_MOVE.out);
  assert.equal(lasts("rig-row-out"), RIG_MOVE.out);
  assert.equal(lasts("rig-away"), RIG_MOVE.away);
  assert.equal(lasts("rig-row-away"), RIG_MOVE.away);
  assert.equal(lasts("rig-tab-in"), RIG_MOVE.tab);
  // Each is started as far in as the move has got, and each has its pictures.
  for (const name of ["rig-out", "rig-away", "rig-grow", "rig-shrink", "rig-tab-in", "rig-row-out", "rig-row-away"]) assert.ok(css.includes(`@keyframes ${name} `), name);
  assert.equal(css.split("var(--rig-at, 0ms)").length - 1, 5);
  // And none of it plays for someone whose computer is set to show no animations.
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.desk\.rig-out \.device-row/);
});

test("the computer's window uses the move to decide what's drawn", () => {
  const page = fs.readFileSync(path.join(here, "..", "public", "computer.js"), "utf8");
  assert.match(page, /import \{ rigNextChange, rigPhase, rigTurned \} from "\.\/rig-motion\.js";/);
  // The rig is drawn by rigShown at a computer and at a panel, never by the out flag alone, or it would vanish at once.
  assert.equal(page.split("rigShown()").length - 1, 2);
  assert.ok(!/const rig = !?comp\.rigOut/.test(page));
});
