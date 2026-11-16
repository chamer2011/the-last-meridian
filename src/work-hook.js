// The written story and the ship's work board (step 6 of the logistics rework): what a scene, a conversation, a
// computer's program or a request can ask about the board, and change on it. The words are read here, and nothing is
// imported, because what reads the scenes can't import the board (which reads half the game): src/work.js tells this
// file how each is answered and played, as src/requests.js tells src/request-hook.js.
//
// Conditions, after ?:
//   work waiting                          some job has been left waiting: asking for a hand or for goods, and getting
//                                         neither for as long as the place's file says (its left waiting line)
//   work waiting hands | goods            ... for want of hands, or for want of goods
//   work waiting medbay|engines|galley|repairs    ... in that part of the ship
//   work first medbay|engines|galley|repairs|none   what's been put first on the board (none: as it comes)
//   work job <name> waiting|taken|done|none         how a job the story gave the board stands
// Effects, after *:
//   work first <part>|none: The reason, as the Work page says it      (it stands a day, then the first officer looks again)
//   work job <name> in <room>, <N> minutes|hours, by <who>[, urgent]: What the job is, as the Work page says it
//   work job <name> off: The reason                                   (taken off the board, done or not)
// A job done leaves the fact work_<name>_done on the record, for a scene or a story's notes to ask about.

// The parts of the ship the board can put first, as src/work.js has them.
export const WORK_PARTS = ["medbay", "engines", "galley", "repairs"];
export const JOB_STATES = ["waiting", "taken", "done", "none"];
const NAME = /^[a-z][a-z0-9_]{1,29}$/;

let handlers = { holds: () => false, step: () => [], problem: () => null };
// src/work.js tells it how: whether a condition holds, what an effect does, and what's wrong with a story's job.
export const tellWork = (given) => {
  handlers = { ...handlers, ...given };
};
export const workHolds = (game, term) => Boolean(handlers.holds(game, term));
export const storyWork = (game, step) => handlers.step(game, step) ?? [];

// The fact a story's job leaves when it's done.
export const storyJobFact = (name) => `work_${name}_done`;
// Every fact the scenes' jobs can leave, for the checker: a scene can wait on these.
export function workFacts(scenes) {
  return [...new Set([...JSON.stringify(scenes ?? {}).matchAll(/"command":"work_job","name":"([a-z0-9_]+)"/g)].map((one) => storyJobFact(one[1])))];
}

// A condition's words after "work": { term fields } or { problem }.
export function readWorkAsk(rest) {
  const words = rest.map((one) => String(one).trim().toLowerCase()).filter(Boolean);
  const [what, ...more] = words;
  if (what === "waiting") {
    const of = more.join(" ").replace(/^for\s+/, "").replace(/^the\s+/, "") || null;
    if (of && !["hands", "goods", ...WORK_PARTS].includes(of)) return { problem: `"work waiting" can be followed by hands, goods, or a part of the ship (${WORK_PARTS.join(", ")})` };
    return { what, of };
  }
  if (what === "first") {
    const part = more.join(" ").replace(/^the\s+/, "");
    return [...WORK_PARTS, "none"].includes(part) ? { what, part } : { problem: `"work first" is followed by one of ${WORK_PARTS.join(", ")}, or none` };
  }
  if (what === "job") {
    const [name, state, ...extra] = more;
    if (!NAME.test(name ?? "") || !JOB_STATES.includes(state) || extra.length) return { problem: `"work job" is followed by the job's name, as the line that gave it has it, and one of ${JOB_STATES.join(", ")}` };
    return { what, name, state };
  }
  return { problem: `"work" is followed by waiting, first or job` };
}

// One "* work ..." line: { do } or { problem }. words are what came after "work", before the colon.
const FIRST_HELP = `work first is written * work first medbay: The reason, with one of ${WORK_PARTS.join(", ")}, or none`;
const JOB_HELP = "a job for the board is written * work job its_name in The Lighter Bay, 2 hours, by the deckhands: What the job is, with urgent after the people if it can't wait";
export function readWorkEffect(words, after) {
  const what = String(words[0] ?? "").toLowerCase();
  if (what === "first") {
    const part = words.slice(1).join(" ").toLowerCase().replace(/^the\s+/, "");
    if (![...WORK_PARTS, "none"].includes(part)) return { problem: FIRST_HELP };
    return after ? { do: { command: "work_first", part, reason: after } } : { problem: "work first needs a colon and the reason after it, as the Work page is to say it" };
  }
  if (what !== "job") return { problem: `work is followed by first or job: ${FIRST_HELP}; ${JOB_HELP}` };
  const name = String(words[1] ?? "").toLowerCase();
  if (!NAME.test(name)) return { problem: `${JOB_HELP}. Its name is lowercase letters, digits and underscores, 30 at most` };
  const rest = words.slice(2).join(" ").trim();
  if (/^off$/i.test(rest)) return after ? { do: { command: "work_job_off", name, reason: after } } : { problem: "work job off needs a colon and the reason after it" };
  let room = null;
  let minutes = null;
  let urgent = false;
  const carriers = [];
  let listing = false;
  for (const piece of rest.split(/\s*[;,]\s*/).map((one) => one.trim()).filter(Boolean)) {
    const span = piece.match(/^(?:for\s+)?(\d+)\s*(minutes?|hours?)$/i);
    if (/^in\s+/i.test(piece) && !room) {
      room = piece.replace(/^in\s+/i, "").trim();
      listing = false;
    } else if (span) {
      minutes = Number(span[1]) * (/^hour/i.test(span[2]) ? 60 : 1);
      listing = false;
    } else if (/^urgent$/i.test(piece)) {
      urgent = true;
      listing = false;
    } else if (/^(?:done\s+|carried\s+)?by\s+/i.test(piece)) {
      carriers.push(piece.replace(/^(?:done\s+|carried\s+)?by\s+/i, "").replace(/^then\s+/i, "").trim());
      listing = true;
    } else if (listing) carriers.push(piece.replace(/^then\s+/i, "").trim());
    else return { problem: `${JOB_HELP}. The game doesn't follow "${piece}"` };
  }
  if (!room || !minutes || !carriers.length) return { problem: `${JOB_HELP}. It needs ${!room ? "the room, after in" : !minutes ? "how long it takes" : "who does it, after by"}` };
  if (minutes > 24 * 60) return { problem: "a job for the board takes a day at most" };
  if (!after) return { problem: "a job for the board needs a colon and what the job is after it, as the Work page is to say it" };
  const step = { command: "work_job", name, room, minutes, carriers, ...(urgent ? { urgent: true } : {}), reason: after };
  const problem = handlers.problem(step);
  return problem ? { problem: `work job ${name}: ${problem}` } : { do: step };
}
