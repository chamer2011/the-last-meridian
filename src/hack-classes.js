// The classes of computer, from a door panel to the Beacon or the Choir (step 3 of the hacking rework): each one's name,
// whether a trace that finds the player leaves a mark on the record, and the watcher's numbers. The watcher counts the
// noise the player makes: it notices them at `notices` (and everything is one louder from then on), starts a trace at
// `traces` that finds them `finds` minutes of the session later, and cuts them off at `cuts`. The hacking part of
// world/checks.json can change any of it, and its `training.room` is what training adds to notices, traces and cuts,
// from untrained to master. This file reads nothing, so anything can read it.

export const DEFAULT_CLASSES = {
  easy: { name: "Door panel", mark: false, notices: 5, traces: 9, finds: 8, cuts: 13 },
  moderate: { name: "Crew terminal", mark: false, notices: 4, traces: 8, finds: 6, cuts: 12 },
  hard: { name: "Ship's main system", mark: true, notices: 3, traces: 6, finds: 5, cuts: 9 },
  very_hard: { name: "Ministry or Navy server", mark: true, notices: 3, traces: 5, finds: 4, cuts: 8 },
  nearly_impossible: { name: "The Beacon or the Choir", mark: true, notices: 2, traces: 4, finds: 3, cuts: 6 },
};
export const DEFAULT_ROOM = [0, 1, 1, 2, 3];

export const classOf = (text, difficulty) => ({ ...(DEFAULT_CLASSES[difficulty] ?? DEFAULT_CLASSES.moderate), ...(text?.classes?.[difficulty] ?? {}) });
// Every class, in order from the least important computer to the most.
export const allClasses = (text) => Object.keys(DEFAULT_CLASSES).map((difficulty) => ({ difficulty, ...classOf(text, difficulty) }));
// What training adds to the watcher's numbers at a training tier, 0 (untrained) to 4 (a master).
export const roomFor = (text, tier) => {
  const room = Array.isArray(text?.training?.room) ? text.training.room : DEFAULT_ROOM;
  return Number(room[Math.max(0, Math.min(room.length - 1, tier))] ?? 0) || 0;
};
