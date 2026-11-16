// The rig coming out of the player's pocket and going back, at a computer or a panel (public/computer.js): how long
// each part of it takes, and what it's doing so long after it began. It's kept apart from the page so that it can be
// checked without a screen (test/rig-motion.test.js).
//
// Out: the rig slides out from behind the computer's edge, where its tab was. Away: it slides back in, and then its tab
// slides out again, the tab being the rig's edge showing. The page draws by the phase and by how far into it the move
// is (the stylesheet's animations start that far in), so a redraw in the middle carries on from where it was. Coming
// out, and the tab coming out, begin with a moment's hold: the window has just been drawn again for it, and the frames
// that takes would otherwise be the first of the slide.

// How long each part takes, in milliseconds. public/desktop.css has the same numbers on its animations.
export const RIG_MOVE = { out: 420, away: 300, tab: 190 };

// A move begun: which way, "out" or "away", and when, in the page's own milliseconds.
export const rigMoveFrom = (dir, now) => ({ dir, at: now });

// What a move is doing now: { phase, ms }, the phase "out", "away" or "tab" and how far into it, or null once it's
// over, or when there's none.
export function rigPhase(move, now) {
  if (!move) return null;
  const ms = Math.max(0, now - move.at);
  if (move.dir === "out") return ms < RIG_MOVE.out ? { phase: "out", ms } : null;
  if (ms < RIG_MOVE.away) return { phase: "away", ms };
  return ms < RIG_MOVE.away + RIG_MOVE.tab ? { phase: "tab", ms: ms - RIG_MOVE.away } : null;
}

// Whether the rig itself is on the screen: out, or still on its way back in. Once it's in, its tab is.
export const rigShown = (out, move, now) => Boolean(out) || rigPhase(move, now)?.phase === "away";

// How long until the move's phase changes, or null when nothing's moving.
export function rigNextChange(move, now) {
  const doing = rigPhase(move, now);
  return doing ? RIG_MOVE[doing.phase] - doing.ms : null;
}

// The rig told to go the other way in the middle of a move turns round at once: the new move begins as far along as
// the old one had left to go, so the rig carries on from about where it is. Told anything else, it begins at the start.
export function rigTurned(move, now, dir) {
  const doing = rigPhase(move, now);
  if (!doing || doing.phase === "tab" || doing.phase === dir) return rigMoveFrom(dir, now);
  const done = doing.ms / RIG_MOVE[doing.phase];
  return { dir, at: now - (1 - done) * RIG_MOVE[dir] };
}
