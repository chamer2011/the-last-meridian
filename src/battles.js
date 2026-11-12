// Battles: a fight fought by everyone on a deck at once, in the room, in real time (world/battles/<id>.txt, read by
// public/battle-text.js). The mutiny that opens the game is one. This reads the files, says what's wrong in them for
// the checker, and starts one: who on the deck fights and who takes cover, who's against the player and where they come
// in, who comes up later, and then the fight, which src/live-fight.js runs in the room on src/combat.js's rules.

import fs from "node:fs";
import path from "node:path";
import { parseBattleText } from "../public/battle-text.js";
import { findCharacter, findEnemy } from "./campaign.js";
import { fighterBody } from "./body.js";
import { startCombat } from "./combat.js";
import { jobByWords, jobOf, lostReason, onJob } from "./command.js";
import { ENEMIES, LOCATIONS } from "./data.js";
import { lifeOf } from "./life.js";
import { ROUND_SECONDS, goBattle } from "./live-fight.js";
import { worldDir } from "./paths.js";
import { canStand, fightGround, mapFor, roomsOn, startInRoom, walkOf } from "./walk.js";

export const BATTLES_DIR = process.env.GAME_BATTLES_DIR ?? path.join(worldDir, "battles");

// ---- The files ----------------------------------------------------------------------------------------------------

// Every battle's file, read afresh each time, since they're small and a writer may have just changed one.
export function loadBattles(dir = BATTLES_DIR) {
  const battles = {};
  const problems = [];
  if (!fs.existsSync(dir)) return { battles, problems };
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const id = name.slice(0, -4);
    const { battle, problems: found } = parseBattleText(fs.readFileSync(path.join(dir, name), "utf8"), id);
    battles[id] = battle;
    for (const one of found) problems.push({ file: name, id, ...one });
  }
  return { battles, problems };
}

export const battleOf = (id, dir = BATTLES_DIR) => loadBattles(dir).battles[id] ?? null;

// A room on a deck, by its name, its id or one of its other names: "The Bridge", "the bridge" and "bridge" are one.
const plain = (words) => String(words ?? "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
export function roomOnDeck(map, deck, words) {
  const want = plain(words);
  return roomsOn(map, deck).find((room) => room.id === words || plain(room.id) === want || plain(room.name) === want || (room.aliases ?? []).some((one) => plain(one) === want)) ?? null;
}

// Whoever a line under With you names: someone with a file, or everyone doing a job on the watch bill.
function whoWords(place, words) {
  const person = findCharacter(null, words);
  if (person) return { person: person.id };
  const job = jobByWords(place, words);
  return job ? { job } : null;
}

// What's wrong with one battle, against the rest of the world, in plain words.
export function battleProblems(battle) {
  const problems = [];
  const where = (line) => `${battle.id}.txt${line ? ` (line ${line})` : ""}`;
  if (!battle.place) problems.push(`${where()}: place: is needed, the place it's fought at`);
  else if (!LOCATIONS[battle.place]) problems.push(`${where()}: there's no place called ${battle.place}`);
  const map = battle.place && LOCATIONS[battle.place] ? mapFor(battle.place) : null;
  if (battle.place && LOCATIONS[battle.place] && !map) problems.push(`${where()}: ${battle.place} has no map to fight in`);
  const level = map && battle.deck ? map.levels[battle.deck] : null;
  if (!battle.deck) problems.push(`${where()}: deck: is needed, the deck it's fought on`);
  else if (map && !level) problems.push(`${where()}: ${battle.place} has no deck called ${battle.deck}. Its decks are ${Object.keys(map.levels).join(", ")}`);
  const room = (words, what, line) => {
    if (!level) return;
    if (!roomOnDeck(map, battle.deck, words)) problems.push(`${where(line)}: ${what} names ${words}, which isn't a room on ${battle.deck}. Its rooms are ${roomsOn(map, battle.deck).map((one) => one.name).join(", ")}`);
  };
  if (!battle.target) problems.push(`${where()}: they make for: is needed, the room the other side heads for`);
  else room(battle.target, "they make for:");
  if (battle.cover) room(battle.cover, "the rest take cover in:");
  if (battle.crewAs && !ENEMIES[battle.crewAs]) problems.push(`${where()}: crew fight as: names ${battle.crewAs}, which isn't in world/enemies`);
  if (battle.against.length && !battle.against.some((one) => !one.after)) problems.push(`${where(battle.against[0].line)}: at least one group against you has to come at the start, with no seconds in`);
  for (const one of battle.against) {
    if (!ENEMIES[one.enemy]) problems.push(`${where(one.line)}: there's no enemy called ${one.enemy} in world/enemies`);
    room(one.room, `${one.how} ${one.room}`, one.line);
  }
  for (const one of battle.with) {
    if (one.everyone) continue;
    room(one.room, `${one.how} ${one.room}`, one.line);
    const who = battle.place ? whoWords(battle.place, one.who) : null;
    if (!who) problems.push(`${where(one.line)}: ${one.who} isn't someone with a file in world/characters, or a job on ${battle.place}'s watch bill`);
    else if (who.job && !battle.crewAs) problems.push(`${where(one.line)}: ${one.who} are crew, so the battle needs crew fight as: to say who they fight as`);
  }
  return problems;
}

// Every battle's problems, for npm run check-story: what can't be read, then what doesn't fit the world.
export function allBattleProblems(dir = BATTLES_DIR) {
  const { battles, problems } = loadBattles(dir);
  return {
    count: Object.keys(battles).length,
    problems: [
      ...problems.map((one) => `${one.file} (line ${one.line}): ${one.message}`),
      ...Object.values(battles).flatMap(battleProblems),
    ],
  };
}

// Whether a scene's BATTLE line names a battle there's a file for, and one with nothing wrong in it.
export function battleProblem(id, dir = BATTLES_DIR) {
  const battle = battleOf(id, dir);
  if (!battle) return `there's no battle called ${id} in world/battles`;
  return battleProblems(battle)[0] ?? null;
}

// ---- Where everyone stands --------------------------------------------------------------------------------------

const keyOf = (x, y) => `${x},${y}`;
const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const inside = (room, spot) => !room?.area || (spot.x >= room.area.x && spot.x < room.area.x + room.area.w && spot.y >= room.area.y && spot.y < room.area.y + room.area.h);

// Where people come into a room: at its way down to another deck, as if they'd come up the stairs, or anywhere in it.
function entryOf(level, room, how) {
  if (how === "up") {
    const way = level.exits.find((exit) => level.roomAt(exit.x, exit.y) === room.id);
    if (way) return { x: way.x, y: way.y };
  }
  return { x: room.start.x, y: room.start.y };
}

// Free squares near a spot, the nearest first, a little apart, inside the room when there's room in it.
function spotsNear(level, from, count, taken, room) {
  const seen = new Set([keyOf(from.x, from.y)]);
  const queue = [from];
  const found = [];
  const apart = (a, b) => Math.hypot((a.x - b.x) * 0.5, a.y - b.y) >= 1;
  for (let i = 0; i < queue.length && found.length < count; i += 1) {
    const at = queue[i];
    if (canStand(level, at.x, at.y) && !taken.has(keyOf(at.x, at.y)) && inside(room, at) && found.every((one) => apart(one, at))) found.push({ x: at.x, y: at.y });
    for (const [dx, dy] of STEPS) {
      const next = { x: at.x + dx, y: at.y + dy };
      const key = keyOf(next.x, next.y);
      if (seen.has(key) || !canStand(level, next.x, next.y)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  // A room too full for everyone: the nearest squares outside it as well.
  if (found.length < count && room) return [...found, ...spotsNear(level, from, count - found.length, new Set([...taken, ...found.map((one) => keyOf(one.x, one.y))]), null)];
  for (const one of found) taken.add(keyOf(one.x, one.y));
  return found;
}

// The round of the fight someone comes in on, from the seconds the file gives: the nearest six seconds, the second
// round at the soonest (src/combat.js brings arrivals by rounds, and a fight in the room counts six seconds a round).
const roundFor = (seconds) => 1 + Math.max(1, Math.round(seconds / ROUND_SECONDS));

// ---- Starting one ---------------------------------------------------------------------------------------------------

// Starts a battle where the player is. Everyone is checked before anything changes, so one that can't be fought leaves
// no fight behind. Returns the notes for the story and what the battle is called.
export function startBattle(game, id, { leadIn = null } = {}) {
  if (game.combat) throw new Error("A fight is already underway.");
  const battle = battleOf(id);
  if (!battle) throw new Error(`There's no battle called ${id} in world/battles.`);
  const wrong = battleProblems(battle);
  if (wrong.length) throw new Error(`The battle ${id} can't be fought: ${wrong[0]}`);
  if (game.location !== battle.place) throw new Error(`${battle.title} is fought at ${LOCATIONS[battle.place].name}, and you're not there.`);
  const place = battle.place;
  const map = mapFor(place);
  const level = map.levels[battle.deck];
  const target = roomOnDeck(map, battle.deck, battle.target);
  // The player fights it on that deck: anywhere else at the place, they're in the room the others make for.
  const walk = walkOf(game);
  if (walk.room || walk.level !== battle.deck) startInRoom(game, target.id);
  // Everyone's day is kept in the save from here on, so whoever's beaten is laid where they fell.
  lifeOf(game);
  const people = game.life.places[place] ?? {};
  const everyone = battle.with.some((one) => one.everyone);
  const before = fightGround(game);
  const deck = [];
  const cover = [];
  for (const person of before.people) {
    // Whoever's down, dead or being carried isn't in it, and neither is anyone who's only passing through someone's file.
    if (person.down || person.dead || person.carried) continue;
    const own = person.crowd ? null : findEnemy(game.campaign, person.key);
    if (everyone && own?.named) deck.push({ spec: person.key, key: person.key, name: person.short, x: person.x, y: person.y });
    else if (everyone && person.crowd && battle.crewAs && typeof jobOf(game, place, person.key) === "string") deck.push({ spec: `${battle.crewAs} as ${person.key}`, key: person.key, name: person.key, x: person.x, y: person.y, crowd: true });
    else cover.push(person);
  }
  // Whoever doesn't fight takes cover where the file says, if there's room for them.
  const coverRoom = battle.cover ? roomOnDeck(map, battle.deck, battle.cover) : null;
  const busy = new Set([...before.people.map((one) => keyOf(one.x, one.y)), keyOf(before.you.x, before.you.y)]);
  if (coverRoom) {
    const spots = spotsNear(level, coverRoom.start, cover.length, busy, coverRoom);
    cover.forEach((person, i) => {
      const state = people[person.key];
      if (state && spots[i]) Object.assign(state, { level: battle.deck, x: spots[i].x, y: spots[i].y, path: null });
    });
  }
  const onDeck = new Set(deck.map((one) => one.key));
  // Who's against the player: the groups that come at the start, where they come in, and the rest later.
  const spots = { you: { x: before.you.x, y: before.you.y } };
  const taken = new Set([...busy, ...cover.map((one) => keyOf(people[one.key]?.x ?? one.x, people[one.key]?.y ?? one.y))]);
  const enemies = [];
  const arrivals = [];
  const waves = [];
  let total = 0;
  for (const group of battle.against) {
    const room = roomOnDeck(map, battle.deck, group.room);
    const enter = entryOf(level, room, group.how);
    total += group.count;
    if (!group.after) {
      const placed = spotsNear(level, enter, group.count, taken, room);
      for (let i = 0; i < group.count; i += 1) enemies.push({ who: group.enemy, spot: placed[i] ?? enter });
    } else {
      const round = roundFor(group.after);
      for (let i = 0; i < group.count; i += 1) arrivals.push({ who: group.enemy, side: "enemy", round, extra: { enter } });
      waves.push({ round, side: "enemy", ...(group.words ? { words: group.words } : {}) });
    }
  }
  // Who comes up later on the player's side: someone with a file, or everyone doing a job, who's on their feet and aboard.
  for (const one of battle.with) {
    if (one.everyone) continue;
    const room = roomOnDeck(map, battle.deck, one.room);
    const enter = entryOf(level, room, one.how);
    const round = roundFor(one.after);
    const who = whoWords(place, one.who);
    const keys = who.person ? [who.person] : onJob(game, place, who.job);
    let came = 0;
    for (const key of keys) {
      if (key === "you" || onDeck.has(key) || lostReason(game, place, key)) continue;
      if (who.person) arrivals.push({ who: key, side: "ally", round, extra: { enter } });
      else arrivals.push({ who: `${battle.crewAs} as ${key}`, side: "ally", round, extra: { enter, prose: key, ...fighterBody(game, { name: key, place }) } });
      onDeck.add(key);
      came += 1;
    }
    if (came) waves.push({ round, side: "ally", ...(one.words ? { words: one.words } : {}) });
  }
  const notes = startCombat(game, enemies[0].who, {
    followers: enemies.slice(1).map((one) => one.who),
    allies: deck.map((one) => one.spec),
    arrivals,
    leadIn,
    battle: {
      id,
      title: battle.title,
      target: target.id,
      total,
      giveUp: battle.giveUp ?? null,
      ...(battle.gaveUpLine ? { gaveUpLine: battle.gaveUpLine } : {}),
      waves,
    },
  });
  const c = game.combat;
  enemies.forEach((one, i) => {
    spots[c.enemies[i].key] = one.spot;
  });
  deck.forEach((one, i) => {
    const fighter = c.allies[i];
    // They're in the room already, so it draws them once, as fighters; a crew member fights with their own body.
    fighter.person = one.key;
    if (one.crowd) Object.assign(fighter, fighterBody(game, { name: one.key, place }), { prose: one.name });
    // Whoever's in the room the others make for when it starts holds it.
    if (inside(target, one)) fighter.holds = true;
    spots[fighter.key] = { x: one.x, y: one.y };
  });
  goBattle(game, spots);
  return { notes, title: battle.title, against: total, with: deck.length, coming: arrivals.filter((one) => one.side === "ally").length };
}
