// The rig coming out of the pocket and going back (public/rig-motion.js): what it's doing so long after it was told to,
// when the rig itself is on the screen and when its tab is, a press in the middle turning it round from where it is,
// and the stylesheet's animations lasting as long as the page thinks they do. And the rig starting up as it comes out
// (step 2 of the rig's plan): when each line of its check of its parts comes up, what its lamps do meanwhile, and when
// the page next has something to draw. Nothing here needs a screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RIG_CHECK, RIG_MOVE, rigCheckLamp, rigCheckNext, rigCheckShown, rigCheckTimes, rigMoveFrom, rigNextChange, rigPhase, rigShown, rigTurned } from "../public/rig-motion.js";

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
  // The screen going off: the picture, the line and the dot each run the whole of it.
  assert.equal(lasts("rig-off-tube"), RIG_MOVE.off);
  assert.equal(lasts("rig-off-beam"), RIG_MOVE.off);
  assert.equal(lasts("rig-off-dot"), RIG_MOVE.off);
  // Each is started as far in as the move has got, and each has its pictures.
  for (const name of ["rig-out", "rig-away", "rig-grow", "rig-shrink", "rig-tab-in", "rig-row-out", "rig-row-away", "rig-off-tube", "rig-off-beam", "rig-off-dot"]) assert.ok(css.includes(`@keyframes ${name} `), name);
  assert.equal(css.split("var(--rig-at, 0ms)").length - 1, 8);
  // And none of it plays for someone whose computer is set to show no animations.
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.desk\.rig-out \.device-row/);
});

test("the computer's window uses the move to decide what's drawn", () => {
  const page = fs.readFileSync(path.join(here, "..", "public", "computer.js"), "utf8");
  assert.match(page, /import \{ [^}]*rigNextChange, rigPhase, rigTurned \} from "\.\/rig-motion\.js";/);
  // The rig is drawn by rigShown at a computer and at a panel, never by the out flag alone, or it would vanish at once.
  assert.equal(page.split("rigShown()").length - 1, 2);
  assert.ok(!/const rig = !?comp\.rigOut/.test(page));
});

test("going away from rest begins with the screen going off, and only then does the rig leave", () => {
  const move = rigMoveFrom("away", 0, { off: true });
  assert.deepEqual(move, { dir: "away", at: 0, off: true });
  assert.deepEqual(rigPhase(move, 0), { phase: "off", ms: 0 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.off - 1), { phase: "off", ms: RIG_MOVE.off - 1 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.off), { phase: "away", ms: 0 });
  assert.deepEqual(rigPhase(move, RIG_MOVE.off + RIG_MOVE.away + 40), { phase: "tab", ms: 40 });
  assert.equal(rigPhase(move, RIG_MOVE.off + RIG_MOVE.away + RIG_MOVE.tab), null);
  // The rig is still there while its screen goes off and while it slides in, and each change is told to the page.
  assert.equal(rigShown(false, move, 10), true);
  assert.equal(rigShown(false, move, RIG_MOVE.off + 10), true);
  assert.equal(rigShown(false, move, RIG_MOVE.off + RIG_MOVE.away), false);
  assert.equal(rigNextChange(move, 100), RIG_MOVE.off - 100);
  assert.equal(rigNextChange(move, RIG_MOVE.off + 100), RIG_MOVE.away - 100);
  // Coming out never has one, and going away has none unless it's asked for.
  assert.deepEqual(rigMoveFrom("out", 0, { off: true }), { dir: "out", at: 0 });
  assert.deepEqual(rigMoveFrom("away", 0), { dir: "away", at: 0 });
});

test("the screen only goes off for a rig at rest, and a press while it does leaves the rig where it is", () => {
  // At rest and told to go: the screen goes off first.
  assert.deepEqual(rigTurned(null, 500, "away", { off: true }), { dir: "away", at: 500, off: true });
  // Still on its way out, where its screen is dark anyway: it turns round at once, with nothing to switch off.
  const back = rigTurned(rigMoveFrom("out", 0), RIG_MOVE.out / 2, "away", { off: true });
  assert.equal(back.off, undefined);
  assert.equal(rigPhase(back, RIG_MOVE.out / 2).phase, "away");
  // Told to come out while its screen is going off: it hasn't moved, so it's out already.
  const going = rigMoveFrom("away", 0, { off: true });
  const stay = rigTurned(going, 200, "out");
  assert.equal(stay.dir, "out");
  assert.equal(rigPhase(stay, 200), null);
  assert.equal(rigNextChange(stay, 200), null);
  // Told to come out once it's sliding in: from where it is, as before.
  const sliding = rigTurned(going, RIG_MOVE.off + RIG_MOVE.away / 4, "out");
  assert.equal(Math.round(rigPhase(sliding, RIG_MOVE.off + RIG_MOVE.away / 4).ms), Math.round(RIG_MOVE.out * 0.75));
});

test("the page switches the screen off, and takes the rig off the computer once it's in the pocket", () => {
  const page = fs.readFileSync(path.join(here, "..", "public", "computer.js"), "utf8");
  // The screen goes off only when it's on: the rig at rest, not starting up, and with a screen showing.
  assert.match(page, /const off = !rigStill\(\) && !rigDoing\(\) && !checkNow\(\) && \(!rigFolded\(\) \|\| Boolean\(comp\.rigSlide\)\);/);
  // Where UNPLUG is on offer is where going back in the pocket unplugs: never at a junction box or a camera, which
  // are reached only through the rig, nor over the network.
  assert.match(page, /const canUnplug = \(view\) => Boolean\(view\?\.reach\?\.plugged\) && !view\.reach\.remote && !THROUGH_RIG\.includes\(view\.look\);/);
  assert.match(page, /canUnplug\(view\) && el\("button", \{[^}]*title: "Take your rig off this one"/);
  // It comes off when the rig has gone in, not when it's told to go, so a change of mind on the way keeps it on.
  assert.match(page, /if \(before\.phase === "away"\) rigGone\(\);/);
  assert.match(page, /if \(!comp\.rigMove\) rigGone\(\);/);
  // Its lead stays while the screen goes off, and the picture that squeezes is the tabs and the page together.
  assert.match(page, /doing && doing\.phase !== "off"/);
  assert.match(page, /class: "pocket-tube"/);
  const css = fs.readFileSync(path.join(here, "..", "public", "desktop.css"), "utf8");
  assert.match(css, /\.desk\.rig-off \.pocket-tube \{ animation: rig-off-tube/);
  assert.match(css, /\.desk \.pocket-screen\.dark \.pocket-tube \{ visibility: hidden; \}/);
  const slide = css.match(/animation: rig-page-out (\d+)ms [^;]*var\(--page-at, 0ms\)/);
  assert.ok(slide, "desktop.css has no rig-page-out animation started by --page-at");
  assert.ok(Number(slide[1]) <= RIG_MOVE.away, "the page is back in the strip before the strip has gone");
});

test("the rig's check of its parts takes 1.7 seconds for five kinds of part, each line with its state a moment after", () => {
  const times = rigCheckTimes(5);
  assert.equal(times.head, 90);
  assert.deepEqual(times.lines[0], { at: 215, state: 330 });
  assert.deepEqual(times.lines[4], { at: 1175, state: 1290 });
  assert.equal(times.ready, 1440);
  assert.equal(times.done, 1700);
  // A line more, a line's time longer; none at all, and it only says it's ready.
  assert.equal(rigCheckTimes(6).done - times.done, RIG_CHECK.row + RIG_CHECK.state);
  assert.deepEqual(rigCheckTimes(0), { head: 90, lines: [], ready: 90 + RIG_CHECK.ready, done: 90 + RIG_CHECK.ready + RIG_CHECK.hold });
});

test("the screen is dark while the rig's on its way, then the check comes up a line at a time and ends on READY", () => {
  assert.deepEqual(rigCheckShown(5, -300), { dark: true, head: false, rows: 0, states: 0, ready: false, done: false });
  assert.deepEqual(rigCheckShown(5, 0), { dark: false, head: false, rows: 0, states: 0, ready: false, done: false });
  assert.deepEqual(rigCheckShown(5, 100), { dark: false, head: true, rows: 0, states: 0, ready: false, done: false });
  // A line is up before it says how the part is.
  assert.deepEqual(rigCheckShown(5, 220), { dark: false, head: true, rows: 1, states: 0, ready: false, done: false });
  assert.deepEqual(rigCheckShown(5, 330), { dark: false, head: true, rows: 1, states: 1, ready: false, done: false });
  assert.deepEqual(rigCheckShown(5, 1300), { dark: false, head: true, rows: 5, states: 5, ready: false, done: false });
  assert.deepEqual(rigCheckShown(5, 1440), { dark: false, head: true, rows: 5, states: 5, ready: true, done: false });
  assert.equal(rigCheckShown(5, 1700).done, true);
});

test("its lamps are off as it arrives, blink while it checks, and are themselves again from READY", () => {
  assert.equal(rigCheckLamp(5, -1), "off");
  assert.equal(rigCheckLamp(5, 0), "busy");
  assert.equal(rigCheckLamp(5, 1439), "busy");
  assert.equal(rigCheckLamp(5, 1440), null);
});

test("the page is told when the check next changes, and that it's over", () => {
  // On its way: nothing to draw until it has arrived.
  assert.equal(rigCheckNext(5, -420), 420);
  assert.equal(rigCheckNext(5, 0), 90);
  assert.equal(rigCheckNext(5, 90), 125);
  assert.equal(rigCheckNext(5, 215), 115);
  assert.equal(rigCheckNext(5, 1300), 140);
  assert.equal(rigCheckNext(5, 1440), 260);
  assert.equal(rigCheckNext(5, 1700), null);
  // Stepping from change to change gets through all of it: the dark, the heading, five lines and five states, READY.
  let ms = -420;
  let steps = 0;
  for (let next = rigCheckNext(5, ms); next !== null; next = rigCheckNext(5, ms)) {
    ms += next;
    steps += 1;
  }
  assert.equal(ms, 1700);
  assert.equal(steps, 14);
});

test("the stylesheet and the page play the check the way the times say", () => {
  const css = fs.readFileSync(path.join(here, "..", "public", "desktop.css"), "utf8");
  // In a narrow window the rig's page slides out of its strip first, for as long as the page allows for it.
  const slide = css.match(/animation: rig-page-in (\d+)ms [^;]*var\(--page-at, 0ms\)/);
  assert.ok(slide, "desktop.css has no rig-page-in animation started by --page-at");
  assert.equal(Number(slide[1]), RIG_CHECK.page);
  assert.ok(css.includes("@keyframes rig-page-in "));
  // The check lies over the rig's whole screen.
  assert.match(css, /\.desk \.pocket-screen \{ position: relative; \}/);
  assert.match(css, /\.desk \.pocket-fx \{ position: absolute; inset: 0;/);
  const page = fs.readFileSync(path.join(here, "..", "public", "computer.js"), "utf8");
  // It starts each time the rig comes out, unless no animations are shown; connecting's own screen is as it was.
  assert.match(page, /if \(comp\.rigOut\) \{[^]*?if \(!rigStill\(\) && view\.rigCheck\) startRigCheck\(\);/);
  assert.match(page, /const BOOT_MS = 3000;/);
  // Putting the rig away ends it, and so does going on to another computer.
  assert.match(page, /rigBoot: null, unplug: null, woke: false \}\);/);
  assert.match(page, /const off = [^;]*;\s*stopRigCheck\(\);/);
  // What it shows comes from the game's own list of the rig's parts.
  assert.match(page, /view\.rigCheck/);
});
