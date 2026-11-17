// The player's own death, and the page of the ship's log their game ends on. Asked for on 2026-11-16, in the owner's
// words: "My character doens't die when I don't have health anymore, why". What it is was chosen by them on a page of
// five questions: the same things kill the player as kill the crew (no air, bleeding out, a wound gone bad, a fever
// nobody doses), they go down first and are carried to the medbay like anyone (src/collapse.js), and a lost fight
// still ends on a cot; what they see is a page of the ship's log, with a way back to a morning the game kept by itself
// (server.js) and a new game; and a ship with nobody left alive but them doesn't end the game.
//
// game.over = { at, when, place, room, cause, line, said, more }: the hour and the clock's words for it, where, what
// of (air, bled, infection or illness), the sentence that says it, the line the story got, and what became of the
// ship in a line or two. Once it's there the clock doesn't move (src/rules.js), the server takes no orders, and the
// page shows its ending (public/ending.js), with the last things the story said before it. Reading any of it writes
// nothing.

import { illnessKinds } from "./body.js";
import { commandOf, holderKey, officerName, stillAlive } from "./command.js";
import { LOCATIONS } from "./data.js";
import { medbayCalled } from "./medbay.js";
import { registerDead } from "./register.js";
import { aboardShip, isCaptain } from "./role.js";
import { mapFor, roomOf } from "./walk.js";
import { PART_WORDS } from "../public/health-text.js";

const SHIP = "meridian";
const nowOf = (game) => game.clock?.hours ?? 0;
// A room as a line says it: "the Long Mess", "Medbay".
const roomWords = (place, room) => (roomOf(mapFor(place), room)?.name ?? "").replace(/^The /, "the ");
const placeWords = (place) => (place === SHIP ? "aboard the CFS Meridian" : `at ${LOCATIONS[place]?.name ?? place}`);
// The clock's words for an hour of the game, as the top bar has them.
export function clockWords(hours) {
  const minutes = Math.floor(hours * 60 + 1e-6);
  const two = (n) => String(n).padStart(2, "0");
  return `Day ${Math.floor(minutes / 1440) + 1}, ${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`;
}

// Whether the player has died: nothing more happens in this game.
export const isOver = (game) => Boolean(game?.over);

// How they died, in words that follow "Died on day 14 aboard the CFS Meridian,".
function causeWords(game, { cause, part, kind, room }) {
  const place = game.location;
  const fell = game.fell ?? null;
  const there = room ? roomWords(place, room) : "";
  if (cause === "air") return `for want of air${there ? `, in ${there}` : ""}`;
  // Where they lay at the end: on a cot or the floor of the place's medbay, or where they fell.
  const lying = fell?.bed ? (fell.bed.startsWith("@") ? `on the floor of ${medbayCalled(place)}` : `on a cot in ${medbayCalled(place)}`) : `where you fell${there ? `, in ${there}` : ""}`;
  if (cause === "infection") return `of the wound in your ${PART_WORDS[part] ?? "body"} gone bad, untreated, ${lying}`;
  if (cause === "illness") return `of ${illnessKinds().find((one) => one.id === kind)?.words ?? "an illness"}, with no medicine to dose it`;
  return `of your wounds: you bled to death ${lying}`;
}

// What became of the ship, in a line or two, for someone who died aboard her or with her.
function shipWords(game, at) {
  if (!game.ship || !aboardShip(game)) return [];
  const day = Math.floor(at / 24);
  const died = Object.values(game.dead ?? {}).filter((one) => one.place === SHIP && one.day === day).length + registerDead(game).filter((one) => one.day === day).length;
  const aboard = Math.max(0, game.ship.aboard ?? 0);
  if (game.systems?.[SHIP]?.nowhere) {
    return [`The Meridian had no air left anywhere aboard. ${died ? `${died} had died of it that day already, and ${aboard} were` : `${aboard} were`} still aboard when you did.`];
  }
  const lines = [`${aboard} ${aboard === 1 ? "was" : "were"} aboard the Meridian when you died${died ? `, and ${died} more had died that day` : ""}.`];
  if (isCaptain(game)) {
    const post = commandOf(SHIP)?.posts.find((one) => one.watchBill) ?? null;
    const key = post ? holderKey(game, SHIP, post.id) : null;
    lines.push(key && key !== "you" && stillAlive(game, key) && !game.down?.[`id:${key}`]?.dead ? `${officerName(game, SHIP, post.id)} has the chair now.` : "Nobody's left who would take the chair.");
  }
  return lines;
}

// The last things the story said before the player died, for the page: what was happening. They're read from the
// story as it stands, since the lines of the very stretch of time that killed them are only written into it once
// that's over. What the air or a wound took in numbers is left out: it says nothing by then.
const NUMBERS_ONLY = /^\[(STRESS|XP)\]|^\[HEALTH\] [-+]\d/;
function lastLines(game, said, fell = null, many = 5) {
  const all = [];
  for (const entry of game.transcript ?? []) {
    if (entry.role !== "notice" || typeof entry.text !== "string") continue;
    for (const line of entry.text.split("\n")) if (line.trim()) all.push(line.trim());
  }
  const at = all.lastIndexOf(said);
  const before = (at < 0 ? all : all.slice(0, at)).filter((line) => !NUMBERS_ONLY.test(line));
  // The line where they went down comes first, if what came after it has pushed it out of the last few.
  const tail = before.slice(-many);
  const shown = fell && before.includes(fell) && !tail.includes(fell) ? [fell, ...before.slice(-(many - 1))] : tail;
  return shown.map((line) => (line.length > 220 ? `${line.slice(0, 217)}...` : line));
}

// The player dies: at a time, of a cause (air, bled, infection, illness), with the part or the illness it was, and
// the room for a death of the air. Why nobody could help, when that's known, is the line their fall kept
// (game.fell.help, src/collapse.js). It returns lines for the story.
export function playerDies(game, { at = nowOf(game), cause = "bled", part = null, kind = null, room = null } = {}) {
  if (isOver(game)) return [];
  const place = game.location;
  const where = room ?? game.fell?.room ?? null;
  const words = causeWords(game, { cause, part, kind, room: where });
  const line = `Died on day ${Math.floor(at / 24) + 1} ${placeWords(place)}, ${words}.`;
  const more = [...(game.fell?.help ? [game.fell.help] : []), ...shipWords(game, at)];
  const said = `[HEALTH] You die ${placeWords(place)}, ${words}.`;
  game.over = { at, when: clockWords(at), place, room: where, cause, line, said, more, ...(game.fell?.said ? { fell: game.fell.said } : {}) };
  return [said];
}

// What the page shows of it, or null while the player's alive.
export function endingView(game) {
  const over = game.over;
  return over ? { when: over.when, line: over.line, more: over.more ?? [], last: lastLines(game, over.said, over.fell ?? null) } : null;
}
