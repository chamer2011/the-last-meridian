// The crew's jobs by hand (the hands-on plan, step 1). What the crew does by itself, the player can do with their own
// hands:
//
// - Work a machine. In a room with a machine that needs someone (the galley, the garden), "You can" offers the work.
//   Standing there already counted the player as its worker; this passes the time at work, says what came of it,
//   practises the job's skill and tires like work. Nothing comes from nothing: the machine runs as it always does,
//   with the player as its worker, and needs its power, its makings and room for what it makes.
// - Treat someone. With a medkit, anyone hurt has their worst wound dressed or splinted, anywhere, and the medkit is
//   used up. In a medbay, a patient who's waiting is treated with the medbay's own doses, in its minutes over the
//   player's Medicine (src/medbay.js, treatByHand).
// - Piecework. Crew aboard the Meridian are paid by the piece for real work at their own job: a go at their job's
//   machine, a patient treated, a repair by their own hands, a load carried into a store an errand of their job keeps
//   up while it's short. A piece is a quarter of a shift's pay, and six are paid in a day. The shift itself, eight
//   hours skipped for the whole pay, stays as it was.
//
// It registers itself with src/room-hooks.js; nothing else in the game calls it.

import { addClockWork, addOrder, addPersonActs, addRoomActs } from "./room-hooks.js";
import { dressWounds, handsFree, keyAt, waitingTreatment } from "./body.js";
import { findCharacter } from "./campaign.js";
import { YOU, commandOf, jobById, jobOf, rememberRequest } from "./command.js";
import { ITEMS } from "./data.js";
import { logisticsOf, stockOf, tripOf } from "./logistics.js";
import { wantedNow } from "./work.js";
import { treatByHand, treatableByHand } from "./medbay.js";
import { putsOf } from "./puts.js";
import { jobHere } from "./role.js";
import { passTime, practice, removeItem, skillRank } from "./rules.js";

const SHIP = "meridian";
// Too tired to work, as for a shift.
const TOO_TIRED = 85;
// A piece pays a quarter of a shift, and six are paid in a day: half as much again as the shift skipped.
const PIECE_SHARE = 4;
export const MOST_PIECES = 6;
// How long a medkit takes on someone else.
const KIT_MINUTES = 20;

const nowOf = (game) => game.clock?.hours ?? 0;
const dayOf = (game) => Math.floor(nowOf(game) / 24);
const spell = (minutes) => (minutes % 60 === 0 ? `${minutes / 60 === 1 ? "an" : minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`);
const counted = (item, n) => {
  const name = (ITEMS[item]?.name ?? item).toLowerCase();
  return `${n} ${name}${n === 1 || /(s|produce)$/.test(name) ? "" : "s"}`;
};
const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// ---- Working a machine --------------------------------------------------------------------------------

// What the work's called on the button, and in the line that says it was done, by the machine's own verb in the
// logistics file. A machine with another verb is worked by its name.
const WORK_WORDS = { cooks: ["Cook a pot", "cook"], grows: ["Tend the beds", "tend the beds"] };
const wordsFor = (m) => WORK_WORDS[m.verb] ?? [`Work the ${m.name}`, `work the ${m.name}`];
// The machines in a room that someone has to work: not a generator, which only wants feeding.
export const machinesIn = (place, room) => (logisticsOf(place)?.machines ?? []).filter((m) => m.room === room && m.needs?.worker && !m.generator);
// The job a machine is the work of: the one its line names, or the one whose room it's in.
const jobOfMachine = (place, m) => (m.needs.job ? jobById(place, m.needs.job) : commandOf(place)?.jobs.find((job) => job.room === m.room) ?? null);

function cantWork(game) {
  if ((game.needs?.fatigue ?? 0) >= TOO_TIRED) return "You're too tired to work. Get some sleep first.";
  if (!handsFree(game, game.location, YOU)) return "You can't work with a hand that's no use. Let it heal first.";
  return null;
}

addRoomActs((game, { place, room }) => machinesIn(place, room).map((m) => {
  const why = cantWork(game);
  return { id: "work-machine", key: m.id, label: `${wordsFor(m)[0]} (${spell(m.every).replace(/^an /, "1 ")})`, detail: why ?? `in the ${m.name}, with your own hands`, ...(why ? { disabled: true } : {}) };
}));

addOrder("work-machine", (game, body, { room }) => {
  const place = game.location;
  const m = machinesIn(place, room).find((one) => one.id === String(body.key ?? ""));
  if (!m) throw new Error("There's no work of that kind in this room.");
  const why = cantWork(game);
  if (why) throw new Error(why);
  const made = () => game.logistics?.[place]?.machines?.[m.id]?.made ?? 0;
  const before = made();
  const notes = passTime(game, m.every / 60, "work");
  const goes = made() - before;
  const waiting = game.logistics?.[place]?.machines?.[m.id]?.waiting ?? null;
  const into = logisticsOf(place).stores.find((store) => store.id === m.into);
  const what = !m.gives ? null : m.gives.count ? `${goes * m.gives.n} ${m.gives.unit}` : counted(m.gives.item, goes * m.gives.n);
  const doing = wordsFor(m)[1];
  const line = goes > 0
    ? `[WORK] You ${doing} for ${spell(m.every)}${what ? `: ${what} into the ${into?.name ?? "stores"}` : ""}.`
    : `[WORK] You ${doing} for ${spell(m.every)}, and nothing comes of it${waiting ? `: ${waiting}` : " yet"}.`;
  const job = jobOfMachine(place, m);
  const out = [line, ...(job?.skills?.[0] ? practice(game, job.skills[0], 1) : [])];
  if (goes > 0 && job) out.push(...piece(game, job.id));
  return { said: [...out, ...notes].join("\n") };
});

// ---- Treating someone ----------------------------------------------------------------------------------

// Something in the pack that dresses a wound, as a medkit does.
const kitOf = (game) => Object.keys(game.inventory ?? {}).find((id) => game.inventory[id] > 0 && ITEMS[id]?.effect?.dress) ?? null;
const nameOf = (game, entry) => (entry.id ? findCharacter(game.campaign, entry.id)?.name : null) ?? entry.name ?? "them";
// Whoever was treated remembers it, aboard the Meridian, where people's memories are kept (src/command.js).
function thanks(game, key, words) {
  if (game.location === SHIP) rememberRequest(game, key, "story", { words, w: 6 });
}

addPersonActs((game, entry, key) => {
  const bodyKey = keyAt(game.location, key);
  const held = game.bodies?.[bodyKey];
  // Nearly everyone is well, and this is asked for everyone in sight twice a second.
  if (!held?.wounds?.length || held.died || game.dead?.[bodyKey]) return null;
  const acts = [];
  const here = treatableByHand(game, game.location, bodyKey);
  if (here) acts.push({ id: "treat-here", label: "Treat them yourself", detail: `${here.words}: ${here.doses} dose${here.doses === 1 ? "" : "s"}, about ${here.minutes} minutes` });
  const kit = kitOf(game);
  const wound = kit ? waitingTreatment(game, bodyKey)[0] : null;
  if (wound) acts.push({ id: "treat-kit", label: `Treat with your ${ITEMS[kit].name.toLowerCase()}`, detail: `${wound.words}, ${KIT_MINUTES} minutes` });
  return acts;
});

const entryFor = (people, body) => {
  const key = String(body.key ?? "").replace(/^person:/, "");
  const entry = people.find((one) => (one.id ?? one.name) === key);
  if (!entry) throw new Error("They aren't there any more.");
  return { key, entry };
};

addOrder("treat-kit", (game, body, { people }) => {
  const { key, entry } = entryFor(people, body);
  const kit = kitOf(game);
  if (!kit) throw new Error("You've nothing to treat them with.");
  const done = dressWounds(game, keyAt(game.location, key), ITEMS[kit].effect.dress);
  if (!done.length) throw new Error("There's nothing a medkit can do for them.");
  removeItem(game, kit, 1);
  const notes = passTime(game, KIT_MINUTES / 60, "active");
  thanks(game, key, "had a wound seen to by you, from your own medkit");
  const line = `[HEALTH] You've ${listed(done)} for ${nameOf(game, entry)}, and the ${ITEMS[kit].name.toLowerCase()} is used up.`;
  return { said: [line, ...practice(game, "medicine", 1), ...piece(game, "nurse"), ...notes].join("\n") };
});

addOrder("treat-here", (game, body, { people }) => {
  const { key } = entryFor(people, body);
  const why = cantWork(game);
  if (why) throw new Error(why);
  const done = treatByHand(game, game.location, keyAt(game.location, key));
  const notes = passTime(game, done.hours, "work");
  thanks(game, key, "was treated by you, with your own hands");
  const line = `[HEALTH] ${done.line}, with ${done.doses} dose${done.doses === 1 ? "" : "s"}.`;
  return { said: [line, ...practice(game, "medicine", 1), ...piece(game, "nurse"), ...notes].join("\n") };
});

// ---- Piecework -----------------------------------------------------------------------------------------

// The player's job on the Meridian's watch bill, with what a shift of it pays them, or null: the captain has none,
// and nor has anyone away from the place they work.
function myJob(game) {
  const job = jobHere(game);
  if (!job || game.location !== SHIP) return null;
  const id = jobOf(game, SHIP, YOU);
  return id ? { id, pay: job.pay + skillRank(game, job.skill) } : null;
}

// A piece of the day's work done at a job: paid if it's the player's own job and the day's pieces aren't all paid.
// It returns the line that says so, or nothing.
function piece(game, jobId, what = null) {
  const mine = myJob(game);
  if (!mine || mine.id !== jobId) return [];
  const today = dayOf(game);
  const kept = game.pieces?.day === today ? game.pieces : { ...(game.pieces ?? {}), day: today, n: 0 };
  game.pieces = kept;
  if (kept.n >= MOST_PIECES) return [];
  const pay = Math.max(1, Math.ceil(mine.pay / PIECE_SHARE));
  game.pieces = { ...kept, n: kept.n + 1 };
  game.credits += pay;
  return [`[WORK] ${what ? `${what} ` : ""}That's a piece of your day's work: ${pay} credits (${kept.n + 1} of ${MOST_PIECES} today).`];
}
// How many pieces have been paid today, for the page and the tests. Reading it changes nothing.
export const piecesToday = (game) => (game.pieces?.day === dayOf(game) ? game.pieces.n : 0);

// What the player has done with their own hands that the game counts elsewhere (src/puts.js): repairs, for a tech,
// and loads carried into the stores their job is named to carry for (a store's carried by, in world/logistics).
function countedWork(game, jobId) {
  const totals = {};
  if (jobId === "tech") {
    const prefix = `fixed:${SHIP}|`;
    totals.repairs = Object.entries(game.puts ?? {}).reduce((sum, [key, n]) => (key.startsWith(prefix) ? sum + n : sum), 0);
  }
  const model = logisticsOf(SHIP);
  for (const want of model?.wants ?? []) {
    const store = model.stores.find((one) => one.id === want.store);
    if (store?.carriers.some((one) => one.job === jobId)) totals[`want:${want.store}:${want.item}`] = putsOf(game, store.key, want.item);
  }
  return totals;
}

// Each time the clock moves: anything of that kind done since last time is a piece. A load only counts if the store
// had fewer than it wants, as its own line says, so nobody's paid for filling what's full.
addClockWork((game) => {
  const mine = myJob(game);
  if (!mine) return [];
  const totals = countedWork(game, mine.id);
  const seen = game.pieces?.seen;
  const notes = [];
  if (seen) {
    const model = logisticsOf(SHIP);
    for (const [key, total] of Object.entries(totals)) {
      // Something counted for the first time (a store the file has only now given a want) starts from here.
      if (!(key in seen)) continue;
      const more = total - seen[key];
      if (more <= 0) continue;
      if (key === "repairs") {
        for (let i = 0; i < more; i += 1) notes.push(...piece(game, mine.id, "A repair by your own hands."));
        continue;
      }
      const want = model.wants.find((one) => `want:${one.store}:${one.item}` === key);
      const store = model.stores.find((one) => one.id === want.store);
      // It had fewer than it wants before this load went in.
      if ((stockOf(game, SHIP, want.item, store.name) ?? 0) - more >= wantedNow(game, SHIP, want)) continue;
      for (let i = 0; i < Math.min(3, Math.ceil(more / tripOf(model, want.item))); i += 1) notes.push(...piece(game, mine.id, `${counted(want.item, more)} carried to the ${store.name}.`));
    }
  }
  if (!seen || Object.keys(totals).some((key) => totals[key] !== seen[key])) game.pieces = { day: dayOf(game), n: 0, ...(game.pieces ?? {}), seen: totals };
  return notes;
});
