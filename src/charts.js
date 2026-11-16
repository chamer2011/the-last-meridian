// The chart program on the Meridian's navigation computer: the star map as a program on NAVCOM 7's desktop, on the plot
// table on her bridge (the computer whose file says `charts: yes`). The page draws the chart from the places it
// already knows (public/navplot.js); this sends what a jump costs the ship herself, whoever is asking, and does what
// Engage asks.
//
// Who can give the order was the owner's choice (2026-11-16): anyone who gets into the computer, not only whoever has
// the chair. The computer is the captain's own (theirOwn in src/computers.js), so anyone else is past a logon first.

import { LOCATIONS } from "./data.js";
import { STAR_MAP } from "./world.js";
import { SHIP_ID, logForShip, shipCommand, shipOf, shipsJumpCost } from "./ship.js";
import { clockLabel, jumpShip } from "./rules.js";
import { jumpBlocked, navigationDown } from "./systems.js";
import { isCaptain } from "./role.js";

export const CHART_PROGRAM = "Navplot";
// Moving the ship from someone else's NAVCOM is about as loud as anything done there.
const NOISE_ENGAGE = 3;

const spotOf = (id) => (id ? STAR_MAP.places[id] ?? null : null);

// It's one of the computer's programs, so a session a trusted machine let in for less doesn't get it.
export const mayChart = (session) => !session?.rights || ["everything", "programs"].some((word) => session.rights.includes(word));

// What the program shows that the page can't work out by itself: what a jump to each place costs the Meridian from
// where she is, and why one can't be made. For anyone who isn't the captain the page's own places carry a passage's
// fare and hours, which is not what the chart is for.
export function chartView(game, session) {
  if (session?.locked || !mayChart(session) || !game.ship) return null;
  const ship = shipOf(game);
  const blocked = jumpBlocked(game, { whoever: true });
  const byHand = navigationDown(game);
  const places = {};
  for (const id of Object.keys(LOCATIONS)) {
    if (id === SHIP_ID || !spotOf(id)) continue;
    const cost = shipsJumpCost(game, id);
    const here = id === ship.at;
    const short = ship.fuel < cost.fuel ? `Needs ${cost.fuel} fuel, and the Meridian has ${ship.fuel}.` : null;
    places[id] = { fuel: cost.fuel, hours: cost.hours, here, why: here ? null : blocked ?? short };
  }
  return {
    name: CHART_PROGRAM,
    byHand,
    blocked,
    // How far each fuel's worth reaches, for the rings round the ship.
    rings: Object.values(STAR_MAP.jumps).filter((band) => band.reach < 900).map((band) => ({ reach: band.reach, fuel: band.fuel + (byHand ? 1 : 0) })),
    places,
    // As things stand a captain's jump puts them ashore where she arrives, and the session ends with it.
    ashore: isCaptain(game),
  };
}

// Engage. For the captain it's the same order as Set course on the Star Map, and as things stand it puts them ashore
// where she arrives, so nobody is at the computer any more. For anyone else who got in, she jumps with them aboard,
// her log says it wasn't the chair's order, and whatever watches the computer hears it.
export function engageFromChart(game, session, content, id, { act, finish, say }) {
  if (!content?.charts) throw new Error("There's no chart on this computer.");
  if (!mayChart(session)) throw new Error("From where you came in, this computer doesn't let you run its programs.");
  const place = LOCATIONS[id];
  if (!place || id === SHIP_ID || !spotOf(id)) throw new Error("That place isn't on the chart.");
  const ship = shipOf(game);
  if (ship.at === id) throw new Error(`The Meridian is at ${place.name} already.`);
  const tell = (lines) => {
    const said = lines.filter(Boolean);
    if (said.length) game.transcript?.push({ role: "notice", text: said.join("\n") });
  };
  if (isCaptain(game)) {
    const { message, notes = [] } = shipCommand(game, { action: "course", id });
    tell(notes);
    if (game.computer !== session) return { over: true };
    // Ashore where she arrived, so nobody's at the plot table any more. The jump's own line says what happened, so
    // the captain's own computer closes without another.
    if (game.location !== session.place) {
      if (!session.yours) return finish(game, session);
      game.computer = null;
      return { over: true, summary: `[NAV] ${message}` };
    }
    say(session, message);
    return act(game, session, { noise: 0, minutes: 1 }) ?? { over: false };
  }
  const logged = [];
  const { cost, saved, notes } = jumpShip(game, id, { underWay: () => logged.push(...logForShip(game, "NAV", `Jumped to ${place.name} on an order from the plot table that wasn't the chair's.`)) });
  const text = `Jumped to ${place.name} in ${cost.hours} hours.${saved ? " A clean jump saved the fuel." : ""} Fuel left: ${ship.fuel}.`;
  tell([`[NAV] ${text} It's now ${clockLabel(game)}.`, ...logged, ...notes]);
  if (game.computer !== session) return { over: true };
  say(session, `The Meridian jumps. ${text}`, "warn");
  return act(game, session, { noise: NOISE_ENGAGE, minutes: 1 }) ?? { over: false };
}
