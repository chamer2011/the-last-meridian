// Chatter (step 6 of the furniture plan): what people say to nobody in particular, over their heads, by what's going on
// aboard and with them. The lines are world/chatter.txt's, by moment; this works out which moments are true for whom
// and hands each person near the player a line or two, which the room's picture (public/iso.js) has them say now and
// then. Nobody hears it and nothing changes because of it.

import fs from "node:fs";
import path from "node:path";
import { addChecker } from "./room-hooks.js";
import { keyAt, woundsNow } from "./body.js";
import { mutinyHolds } from "./command.js";
import { worldDir } from "./paths.js";
import { alarmRinging, roomDark, roomPowered, systemsOf } from "./systems.js";

export const CHATTER_FILE = process.env.GAME_CHATTER_FILE ?? path.join(worldDir, "chatter.txt");
// The moments, the most particular first: someone says something from the first that's true for them, or the next.
export const MOMENTS = ["Fire here", "The alarm", "Hull breached", "Fire aboard", "No power", "In the dark", "Someone died", "After the mutiny", "Grumbling", "A good table", "Hungry", "Short of food", "Short of medicine", "Hurt", "Under way", "Low morale", "High morale", "Eating", "At work", "No tea", "No drink", "At night", "Anywhere"];
// The longest a line can be, since it hangs over a head.
export const LONGEST = 60;
// How near the player someone has to be to be heard: squares across count half, as they're half as wide.
const NEAR = 10;
// How long a line stays the one someone would say, in hours of the game's clock.
const SLOT_HOURS = 0.5;

const plain = (text) => String(text ?? "").trim().toLowerCase();
const momentNamed = (name) => MOMENTS.find((one) => plain(one) === plain(name)) ?? null;

// The file, read into { moments: { name: [lines] }, problems }. Every problem names its line.
export function parseChatter(text) {
  const moments = {};
  const problems = [];
  let current = null;
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    const at = `world/chatter.txt line ${i + 1}`;
    if (!line || line.startsWith("#")) return;
    if (line.startsWith("-")) {
      const words = line.slice(1).trim();
      if (!current) problems.push(`${at}: a line before any moment, so nobody would say it`);
      else if (!words) problems.push(`${at}: a dash with nothing after it`);
      else {
        if (words.length > LONGEST) problems.push(`${at}: "${words.slice(0, 30)}..." is ${words.length} letters long, more than the ${LONGEST} that fit over a head`);
        moments[current].push(words);
      }
      return;
    }
    if (line.endsWith(":")) {
      const name = momentNamed(line.slice(0, -1));
      if (!name) {
        problems.push(`${at}: there's no moment called "${line.slice(0, -1)}"; the moments are ${MOMENTS.join(", ")}`);
        current = null;
        return;
      }
      if (moments[name]) problems.push(`${at}: ${name} is here twice; its lines are put together`);
      moments[name] ??= [];
      current = name;
      return;
    }
    problems.push(`${at}: "${line.slice(0, 40)}" is neither a moment (a name and a colon) nor a line (starting with "- ")`);
  });
  return { moments, problems };
}

// The file as it is now, read again whenever it's changed.
let read = null;
export function chatterModel() {
  let stamp = null;
  try {
    stamp = fs.statSync(CHATTER_FILE).mtimeMs;
  } catch {
    return null;
  }
  if (read?.stamp !== stamp) read = { stamp, model: parseChatter(fs.readFileSync(CHATTER_FILE, "utf8")) };
  return read.model;
}
addChecker(() => chatterModel()?.problems ?? []);

const nowOf = (game) => game.clock?.hours ?? 0;
const hashOf = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

// What's true for everyone at a place right now.
export function placeMoments(game, place) {
  const now = nowOf(game);
  const hour = ((now % 24) + 24) % 24;
  const aboard = place === game.ship?.at || place === "meridian";
  const shipHere = aboard && game.ship;
  const fires = Object.values(game.emergencies?.fires ?? {}).filter((one) => one.place === place);
  const day = Math.floor((now * 60) / 1440);
  const meals = game.logistics?.[place]?.meals?.days ?? {};
  const hungry = [day, day - 1].some((d) => {
    const one = meals[d];
    return one && one.missed > 0 && one.missed / Math.max(1, one.served + one.missed) > 0.1;
  });
  const lately = (hours, within) => hours !== undefined && now - hours >= 0 && now - hours < within;
  const true_ = new Set(["Anywhere"]);
  if (alarmRinging(game, place)) true_.add("The alarm");
  if (Object.values(game.emergencies?.breaches ?? {}).some((one) => one.place === place)) true_.add("Hull breached");
  if (fires.length) true_.add("Fire aboard");
  if (Object.values(game.dead ?? {}).some((one) => one.place === place && lately(one.at, 72))) true_.add("Someone died");
  if (aboard && lately(game.battles?.mutiny?.hours, 120)) true_.add("After the mutiny");
  if (aboard && mutinyHolds(game, "grumbling", place)) true_.add("Grumbling");
  // The crew's comforts (src/comforts.js): a good table laid this evening, and what they've run out of.
  const comforts = game.logistics?.[place]?.comforts;
  if (comforts?.table?.n && comforts.table.day === day) true_.add("A good table");
  if (comforts?.out?.leaf !== undefined) true_.add("No tea");
  if (comforts?.out?.drink !== undefined) true_.add("No drink");
  if (hungry) true_.add("Hungry");
  if (shipHere && game.ship.out?.food > 0) true_.add("Short of food");
  if (shipHere && game.ship.out?.medicine > 0) true_.add("Short of medicine");
  if (shipHere && game.ship.underWay) true_.add("Under way");
  if (shipHere && (game.ship.morale ?? 55) < 35) true_.add("Low morale");
  if (shipHere && (game.ship.morale ?? 55) >= 70) true_.add("High morale");
  if (hour >= 22 || hour < 6) true_.add("At night");
  return true_;
}

// What's true for one person: everything true for the place, and what's true of their room, of what they're doing and
// of them. person is as the room view has them (src/walk.js): key, name, doing, room.
export function momentsFor(game, place, person, forPlace = placeMoments(game, place)) {
  const moments = new Set(forPlace);
  const room = person.room;
  if (room && game.emergencies?.fires?.[`${place}|${room}`]) moments.add("Fire here");
  if (room && systemsOf(place)) {
    if (!roomPowered(game, place, room)) moments.add("No power");
    if (roomDark(game, place, room)) moments.add("In the dark");
  }
  const doing = plain(person.doing);
  const eating = /\b(eat|eating|breakfast|lunch|dinner|supper)\b/.test(doing);
  if (eating) moments.add("Eating");
  const hour = ((nowOf(game) % 24) + 24) % 24;
  if (!eating && hour >= 7 && hour < 19 && doing && !/\b(rest|resting|letters|notebook|lying|tea|walking the ship|sitting with|asleep)\b/.test(doing)) moments.add("At work");
  if (woundsNow(game, keyAt(place, person.key)).length) moments.add("Hurt");
  return moments;
}

// Which half hour of the clock it is: what anyone would say changes from one to the next.
export const chatterSlot = (game) => Math.floor(nowOf(game) / SLOT_HOURS);

// The lines someone would say now: one from each of the first two moments true for them that have lines, the same
// for half an hour of the clock and then others. Nothing for anyone asleep, laid up or talking to the player.
export function linesFor(game, place, person, forPlace = placeMoments(game, place), model = chatterModel()) {
  if (!model || person.asleep || person.down || person.dead) return [];
  if (game.talk?.key === person.key) return [];
  const moments = momentsFor(game, place, person, forPlace);
  const slot = chatterSlot(game);
  const lines = [];
  for (const name of MOMENTS) {
    if (!moments.has(name)) continue;
    const said = model.moments[name] ?? [];
    if (!said.length) continue;
    lines.push(said[Math.floor(hashOf(`${person.key}|${name}|${slot}`) * said.length)]);
    if (lines.length >= 2) break;
  }
  return [...new Set(lines)];
}

// The room view's people, each near the player given what they might say (src/walk.js calls this). Reading this
// changes nothing.
export function withChatter(game, place, views, spot) {
  const model = chatterModel();
  if (!model || !spot) return views;
  const forPlace = placeMoments(game, place);
  return views.map((view) => {
    if (Math.abs(view.x - spot.x) / 2 + Math.abs(view.y - spot.y) > NEAR) return view;
    const chatter = linesFor(game, place, view, forPlace, model);
    return chatter.length ? { ...view, chatter } : view;
  });
}
