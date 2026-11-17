// The rig coming out of the player's pocket and going back, at a computer or a panel (public/computer.js): how long
// each part of it takes, and what it's doing so long after it began. It's kept apart from the page so that it can be
// checked without a screen (test/rig-motion.test.js).
//
// Out: the rig slides out from behind the computer's edge, where its tab was. Away: its screen goes off first, where
// it's on (the picture squeezes to a bright line, the line to a dot, and the dot fades), then it slides back in with
// its screen dark, and then its tab slides out again, the tab being the rig's edge showing. The page draws by the
// phase and by how far into it the move is (the stylesheet's animations start that far in), so a redraw in the middle
// carries on from where it was. Coming out, and the tab coming out, begin with a moment's hold: the window has just
// been drawn again for it, and the frames that takes would otherwise be the first of the slide.

// How long each part takes, in milliseconds. public/desktop.css has the same numbers on its animations.
export const RIG_MOVE = { out: 420, off: 600, away: 300, tab: 190 };

// A move begun: which way, "out" or "away", and when, in the page's own milliseconds. Going away begins with the
// screen going off when off says so: the rig was out and at rest, with its screen on.
export const rigMoveFrom = (dir, now, { off = false } = {}) => (dir === "away" && off ? { dir, at: now, off: true } : { dir, at: now });

// What a move is doing now: { phase, ms }, the phase "out", "off", "away" or "tab" and how far into it, or null once
// it's over, or when there's none.
export function rigPhase(move, now) {
  if (!move) return null;
  let ms = Math.max(0, now - move.at);
  if (move.dir === "out") return ms < RIG_MOVE.out ? { phase: "out", ms } : null;
  if (move.off) {
    if (ms < RIG_MOVE.off) return { phase: "off", ms };
    ms -= RIG_MOVE.off;
  }
  if (ms < RIG_MOVE.away) return { phase: "away", ms };
  return ms < RIG_MOVE.away + RIG_MOVE.tab ? { phase: "tab", ms: ms - RIG_MOVE.away } : null;
}

// Whether the rig itself is on the screen: out, or its screen going off, or still on its way back in. Once it's in,
// its tab is.
export const rigShown = (out, move, now) => Boolean(out) || ["off", "away"].includes(rigPhase(move, now)?.phase);

// How long until the move's phase changes, or null when nothing's moving.
export function rigNextChange(move, now) {
  const doing = rigPhase(move, now);
  return doing ? RIG_MOVE[doing.phase] - doing.ms : null;
}

// The rig told to go the other way in the middle of a move turns round at once: the new move begins as far along as
// the old one had left to go, so the rig carries on from about where it is. Told anything else, it begins at the start,
// with its screen going off first if off says so. While its screen is going off the rig hasn't moved yet: told to come
// out then, it's there already.
export function rigTurned(move, now, dir, { off = false } = {}) {
  const doing = rigPhase(move, now);
  if (doing?.phase === "off") return dir === "out" ? { dir, at: now - RIG_MOVE.out } : move;
  if (!doing || doing.phase === "tab" || doing.phase === dir) return rigMoveFrom(dir, now, { off });
  const done = doing.ms / RIG_MOVE[doing.phase];
  return { dir, at: now - (1 - done) * RIG_MOVE[dir] };
}

// ---- The rig starting up as it comes out -----------------------------------------------------------------------------
// Each time the rig comes out of the pocket it checks its own parts on its screen. The screen is dark while the rig is
// on its way. Once it has arrived: a heading, then a line to each kind of part it's built from, how that part is a
// moment after its line, then READY, and a moment later the rig's own page. Times are milliseconds from when the rig
// arrived, so they're below zero while it's still coming.

// How long each step takes. A line comes `row` after the step before it and its state `state` after the line; READY
// comes `ready` after the last state and stays for `hold`. In a narrow window, where the rig is a strip with no screen
// of its own, its page takes `page` to slide out of it first.
export const RIG_CHECK = { head: 90, row: 125, state: 115, ready: 150, hold: 260, page: 160 };

// When each thing comes up, for a rig with so many lines to its check.
export function rigCheckTimes(rows) {
  const lines = [];
  let t = RIG_CHECK.head;
  for (let i = 0; i < Math.max(0, rows); i += 1) {
    const at = t + RIG_CHECK.row;
    t = at + RIG_CHECK.state;
    lines.push({ at, state: t });
  }
  const ready = t + RIG_CHECK.ready;
  return { head: RIG_CHECK.head, lines, ready, done: ready + RIG_CHECK.hold };
}

// What's on the screen so long after the rig arrived: dark while it's still coming, then whether the heading is up,
// how many lines and how many of their states, whether it has said READY, and whether it's over.
export function rigCheckShown(rows, ms) {
  const times = rigCheckTimes(rows);
  return {
    dark: ms < 0,
    head: ms >= times.head,
    rows: times.lines.filter((line) => ms >= line.at).length,
    states: times.lines.filter((line) => ms >= line.state).length,
    ready: ms >= times.ready,
    done: ms >= times.done,
  };
}

// The rig's two lamps meanwhile: "off" while it's on its way, "busy" (blinking) while it checks, and null, which is
// whatever they'd show anyway, from READY on.
export function rigCheckLamp(rows, ms) {
  const shown = rigCheckShown(rows, ms);
  return shown.dark ? "off" : shown.ready ? null : "busy";
}

// How long until what's shown changes next, or null once it's over.
export function rigCheckNext(rows, ms) {
  const times = rigCheckTimes(rows);
  const marks = [0, times.head, ...times.lines.flatMap((line) => [line.at, line.state]), times.ready, times.done];
  const next = marks.find((mark) => mark > ms);
  return next === undefined ? null : next - ms;
}
