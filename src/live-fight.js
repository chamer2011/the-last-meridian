// A fight in the room, in real time. The rules of a fight stay src/combat.js's: the same dice, abilities, energy, belt,
// talking them down, running, followers, people arriving, and endings. This adds where everyone stands, walking, line
// of fire, cover and reach, and time: everyone acts again once they're ready, and the page says how much time has
// passed, so the fight only goes on while the page runs it, and stands still while the player has it stopped.
//
// A square is half a tile wide and one tile deep, as everywhere in the rooms, so distances are worked out in tiles.
//
// A battle (src/battles.js) is fought the same way across a whole deck, with as many on each side as the battle brings:
// see A battle, below.

import {
  addNotes, alive, attackFollower, attackPlayer, bringArrivals, checkAllowed, combatActions, currentWeapon, endCombat, fill, fleeBonus, fleeDc,
  followerAttacks, playerAttack, someoneTakesPrisoners, tryParley, useAbility,
} from "./combat.js";
import { ITEMS } from "./data.js";
import { attrMod, oddsFor, practice, roll, useItem } from "./rules.js";
import { canStand, fightGround, standAfterFight } from "./walk.js";
import { COMBAT_TEXT } from "./world.js";
import { drawnWeapon, spendFromBelt } from "./bag.js";
import { bodyOf, legWound, paceOf, woundsNow, woundsPace } from "./body.js";

const WIDTH = 0.5;
// How fast anyone walks in a fight, in tiles a second.
export const FIGHT_SPEED = 3.6;
// The fight goes on in twentieths of a second, and one request moves it on half a second at most, so a page that's
// slow to ask doesn't skip anything.
const STEP = 0.05;
const LONGEST_TICK = 0.5;
// Seconds that count as a round: for people arriving partway through, and for how long a fight took.
export const ROUND_SECONDS = 6;
// Close enough to hit with something held, in tiles.
export const REACH = 1.6;
// How close to the one being aimed at something in the way has to be, to be cover for them; and what cover is worth,
// the same +3 to defense that Take cover gives in rounds.
const COVER_NEAR = 1.5;
export const COVER = 3;
// Talking someone down needs them to be able to hear it.
const TALK_REACH = 12;
// How far the others look for somewhere better to stand each time they think, in tiles.
const PLAN_REACH = { melee: 4, range: 5 };
// The furthest the player can be sent with one click, in tiles of walking.
const ORDER_REACH = 60;
// In a battle: the furthest anyone can shoot or be shot, in tiles; how near someone has to be to be fought from where
// one stands; how far someone walks before thinking again when they go looking; and how long a battle goes on once the
// player's down, in seconds of the fight, before whoever's left against them gives up.
export const BATTLE_SIGHT = 16;
const ENGAGE = 12;
const MARCH = 10;
const WITHOUT_YOU = 180;

const YOU = "you";
const spotKey = (x, y) => `${x},${y}`;
const squareOf = (p) => ({ x: Math.round(p.x), y: Math.round(p.y) });
const tilesApart = (a, b) => Math.hypot((a.x - b.x) * WIDTH, a.y - b.y);

// ---- Who fights how ------------------------------------------------------------------------------------------------

// Whether someone closes in or shoots, from what they fight with: one of the game's weapons by its skill, and anything
// else by its name. Hands, claws, teeth and blades close in; guns, lasers and the Resonance reach across a room.
const SHOOTING = /rifle|carbine|pistol|sidearm|gun|laser|fire|note|lance|resonance|stunner|cannon|launcher|blaster|beam|bow\b/i;
export function reachOf(fighter) {
  if (fighter.reach === "melee" || fighter.reach === "range") return fighter.reach;
  const name = String(fighter.weapon ?? "").trim();
  const item = Object.values(ITEMS).find((one) => one.type === "weapon" && one.name.toLowerCase() === name.toLowerCase());
  if (item) return item.skill === "melee" ? "melee" : "range";
  return SHOOTING.test(name) ? "range" : "melee";
}
const yourReach = (game) => (currentWeapon(game).skill === "melee" ? "melee" : "range");
// How long between one thing and the next, in seconds: an agile player is a little quicker.
const yourRate = (game) => Math.max(1.8, Math.round((2.6 - 0.15 * attrMod(game, "agility")) * 100) / 100);
const rateOf = (fighter, side) => (fighter.boss ? 2.6 : side === "ally" ? 2.8 : reachOf(fighter) === "melee" ? 2.5 : 3);

// What an order needs: to see the one it's aimed at, to reach them, to be heard by them, or nothing.
const SELF = new Set(["field_patch", "evade", "rally"]);
function needOf(game, action) {
  if (action.type === "attack" || (action.type === "ability" && ["overcharged_shot", "foresight"].includes(action.id))) return yourReach(game);
  if (action.type === "ability" && !SELF.has(action.id)) return "range";
  if (action.type === "parley") return "hear";
  return null;
}

// ---- The room -----------------------------------------------------------------------------------------------------

// What's in the room as far as a shot goes: walls stop it, and anything lower, a console, a crate, a thing, is cover.
function shapeOf(level) {
  const walls = level.layers.walls;
  const scenery = level.layers.scenery;
  const under = level.layers.under ?? [];
  const wallAt = (x, y) => walls[y]?.[x] === "#" || scenery[y]?.[x] === "|" || under[y]?.[x] === "w";
  const lowAt = (x, y) => !wallAt(x, y) && ((scenery[y]?.[x] ?? " ") !== " " || level.solid.has(spotKey(x, y)) || under[y]?.[x] === "s");
  return { wallAt, lowAt };
}

// The room a fight is in isn't saved with it: it's read again from the level, and kept while the server runs.
const grounds = new WeakMap();
function groundOf(game) {
  const c = game.combat;
  const known = grounds.get(c);
  if (known) return known;
  const found = fightGround(game);
  if (!found) return null;
  // A battle is fought across the whole deck, so there's no room to keep to: only the room the other side makes for.
  const battle = c.battle ? { area: null, battle: true, goalArea: found.level.areas.find((one) => one.id === c.battle.target) ?? null } : {};
  const ground = { ...found, ...battle, shape: shapeOf(found.level) };
  grounds.set(c, ground);
  return ground;
}

// Whether a shot from one spot reaches another, and whether whoever's there is behind something.
export function lineOfFire(shape, from, to) {
  const ax = (from.x + 0.5) * WIDTH;
  const ay = from.y + 0.5;
  const bx = (to.x + 0.5) * WIDTH;
  const by = to.y + 0.5;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
  const mine = spotKey(Math.round(from.x), Math.round(from.y));
  const theirs = spotKey(Math.round(to.x), Math.round(to.y));
  let cover = false;
  for (let i = 1; i < steps; i += 1) {
    const px = ax + ((bx - ax) * i) / steps;
    const py = ay + ((by - ay) * i) / steps;
    const cx = Math.floor(px / WIDTH);
    const cy = Math.floor(py);
    const here = spotKey(cx, cy);
    if (here === mine || here === theirs) continue;
    if (shape.wallAt(cx, cy)) return { clear: false, cover: false };
    if (shape.lowAt(cx, cy)) {
      const near = Math.hypot(bx - px, by - py);
      if (near <= COVER_NEAR && near < Math.hypot(px - ax, py - ay)) cover = true;
    }
  }
  return { clear: true, cover };
}

// Every square that can be walked to from one, and what the walk there costs in tiles.
const MOVES = [[1, 0, 0.5], [-1, 0, 0.5], [0, 1, 1], [0, -1, 1], [1, 1, 1.118], [1, -1, 1.118], [-1, 1, 1.118], [-1, -1, 1.118]];
function reachFrom(level, from, budget, blocked) {
  const first = { x: from.x, y: from.y, cost: 0, from: null };
  const best = new Map([[spotKey(from.x, from.y), first]]);
  const open = [first];
  while (open.length) {
    let at = 0;
    for (let i = 1; i < open.length; i += 1) if (open[i].cost < open[at].cost) at = i;
    const now = open.splice(at, 1)[0];
    if (best.get(spotKey(now.x, now.y)) !== now) continue;
    for (const [dx, dy, step] of MOVES) {
      const x = now.x + dx;
      const y = now.y + dy;
      const here = spotKey(x, y);
      if (!canStand(level, x, y) || blocked.has(here)) continue;
      if (dx && dy && (!canStand(level, now.x + dx, now.y) || !canStand(level, now.x, now.y + dy))) continue;
      const cost = now.cost + step;
      if (cost > budget) continue;
      const known = best.get(here);
      if (known && known.cost <= cost) continue;
      const node = { x, y, cost, from: now };
      best.set(here, node);
      open.push(node);
    }
  }
  return best;
}
function pathTo(node) {
  const path = [];
  for (let at = node; at && at.from; at = at.from) path.unshift({ x: at.x, y: at.y });
  return path;
}

// The same for a whole deck, kept in order by a heap so it stays quick across thousands of squares: from some squares,
// as far as the budget goes, or until a square that stop says is the one.
function heapPush(heap, node) {
  heap.push(node);
  for (let i = heap.length - 1; i > 0;) {
    const up = (i - 1) >> 1;
    if (heap[up].cost <= heap[i].cost) break;
    [heap[up], heap[i]] = [heap[i], heap[up]];
    i = up;
  }
}
function heapPop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    for (let i = 0; ;) {
      const a = 2 * i + 1;
      const b = a + 1;
      let low = i;
      if (a < heap.length && heap[a].cost < heap[low].cost) low = a;
      if (b < heap.length && heap[b].cost < heap[low].cost) low = b;
      if (low === i) break;
      [heap[low], heap[i]] = [heap[i], heap[low]];
      i = low;
    }
  }
  return top;
}
function walkCosts(level, starts, { budget = Infinity, blocked = null, stop = null } = {}) {
  const best = new Map();
  const heap = [];
  for (const start of starts) {
    const node = { x: start.x, y: start.y, cost: 0, from: null };
    best.set(spotKey(start.x, start.y), node);
    heapPush(heap, node);
  }
  while (heap.length) {
    const now = heapPop(heap);
    if (best.get(spotKey(now.x, now.y)) !== now) continue;
    if (stop?.(now)) return { best, found: now };
    for (const [dx, dy, step] of MOVES) {
      const x = now.x + dx;
      const y = now.y + dy;
      const here = spotKey(x, y);
      if (!canStand(level, x, y) || blocked?.has(here)) continue;
      if (dx && dy && (!canStand(level, now.x + dx, now.y) || !canStand(level, now.x, now.y + dy))) continue;
      const cost = now.cost + step;
      if (cost > budget) continue;
      const known = best.get(here);
      if (known && known.cost <= cost) continue;
      const node = { x, y, cost, from: now };
      best.set(here, node);
      heapPush(heap, node);
    }
  }
  return { best, found: null };
}

// ---- Everyone in it -------------------------------------------------------------------------------------------------

// The player and everyone else, each with where they are and how soon they're ready.
function bodies(game) {
  const c = game.combat;
  return [
    { key: YOU, side: "us", live: c.live.you, fighter: null },
    ...c.allies.filter((one) => one.live).map((one) => ({ key: one.key, side: "us", live: one.live, fighter: one })),
    ...c.enemies.filter((one) => one.live).map((one) => ({ key: one.key, side: "them", live: one.live, fighter: one })),
  ];
}
const standing = (game, body) => (body.fighter ? body.fighter.hp > 0 && !body.fighter.out : game.hp > 0);
// Someone with a wound they can't stand on, such as a broken leg, fights from where they are (src/body.js).
const legOf = (game, body) => legWound(body.fighter ? body.fighter.wounds : woundsNow(game, YOU));
// And someone with a limp walks slower: the player by their whole body, anyone else by the wounds they have.
const paceIn = (game, body) => (body.fighter ? woundsPace(body.fighter.wounds) : paceOf(bodyOf(game, YOU)));
const reachOfBody = (game, body) => (body.fighter ? body.live.reach : yourReach(game));
const facing = (game, body) => bodies(game).filter((other) => other.side !== body.side && standing(game, other));
// Where nobody else can be walked through: everyone still standing, and everyone in the room who isn't in the fight.
function taken(game, ground, except) {
  const squares = new Set(ground.people.filter((person) => !fightingAs(game, person.key)).map((person) => spotKey(person.x, person.y)));
  for (const body of bodies(game)) {
    if (body === except || !standing(game, body)) continue;
    const spot = squareOf(body.live);
    squares.add(spotKey(spot.x, spot.y));
  }
  return squares;
}
// Too close to someone to stop on: their square and the ones either side.
function crowded(game, except, extra = []) {
  const squares = new Set();
  const spots = [...bodies(game).filter((body) => body.key !== except.key && standing(game, body)).map((body) => squareOf(body.live)), ...extra];
  for (const spot of spots) for (const dx of [-1, 0, 1]) squares.add(spotKey(spot.x + dx, spot.y));
  return squares;
}
const fightingAs = (game, personKey) => game.combat.enemies.some((one) => one.person === personKey) || game.combat.allies.some((one) => one.person === personKey);

// Whether one can hit the other from where they stand, and whether the other has cover.
function sightBetween(game, ground, from, reach, target) {
  if (reach === "melee") return tilesApart(from, target) <= REACH ? { ok: true, cover: false } : { ok: false, cover: false, why: "out of reach" };
  if (reach === "hear") return tilesApart(from, target) <= TALK_REACH ? { ok: true, cover: false } : { ok: false, cover: false, why: "too far to hear you" };
  if (ground.battle && tilesApart(from, target) > BATTLE_SIGHT) return { ok: false, cover: false, why: "too far to shoot" };
  const line = lineOfFire(ground.shape, from, target);
  return line.clear ? { ok: true, cover: line.cover } : { ok: false, cover: false, why: "no line of fire" };
}

// ---- Starting it ----------------------------------------------------------------------------------------------------

// The squares by the ways into the room, nearest the way first, inside the room where it has walls drawn round it.
function squaresBy(game, ground, way, count) {
  const inRoom = (x, y) => !ground.area || (x >= ground.area.x && x < ground.area.x + ground.area.w && y >= ground.area.y && y < ground.area.y + ground.area.h);
  const found = [];
  if (count < 1) return found;
  const busy = taken(game, ground, null);
  for (const spot of [...reachFrom(ground.level, way, 8, new Set()).values()].sort((a, b) => a.cost - b.cost)) {
    if (!inRoom(spot.x, spot.y) || busy.has(spotKey(spot.x, spot.y)) || found.some((one) => tilesApart(one, spot) < 1)) continue;
    found.push({ x: spot.x, y: spot.y });
    if (found.length >= count) break;
  }
  return found;
}
// Somewhere a few steps from the player, for anyone who has to come from nowhere in particular.
function squaresNearYou(game, ground, near, far, count) {
  const busy = taken(game, ground, null);
  const found = [];
  if (count < 1) return found;
  for (const spot of [...reachFrom(ground.level, ground.you, far, busy).values()].sort((a, b) => a.cost - b.cost)) {
    if (spot.cost < near || found.some((one) => tilesApart(one, spot) < 1)) continue;
    found.push({ x: spot.x, y: spot.y });
    if (found.length >= count) break;
  }
  return found;
}

function newLive(fighter, side, spot) {
  const reach = reachOf(fighter);
  return { x: spot.x, y: spot.y, path: [], reach, rate: rateOf(fighter, side), cool: side === "ally" ? 0.8 + Math.random() * 0.8 : 1.2 + Math.random() * 1.2, think: 0.2 + Math.random() * 0.8, mark: null };
}

// Puts everyone in the fight who has no place yet somewhere in the room: someone who's already in it where they stand,
// a follower beside the player, and anyone else coming in by the way into the room furthest from the player.
function placeEveryone(game, ground) {
  const c = game.combat;
  const deed = game.deedFight?.key ?? null;
  const here = (fighter) => ground.people.find((person) => !fightingAs(game, person.key) && (person.key === fighter.id || (fighter === c.enemies[0] && person.key === deed)));
  const comers = [];
  for (const [side, list] of [["ally", c.allies], ["enemy", c.enemies]]) {
    for (const fighter of list) {
      if (fighter.live) continue;
      // Someone coming up in a battle comes in where the battle says (src/battles.js), as near to it as there's room.
      if (fighter.enter) {
        const spot = squaresBy(game, ground, fighter.enter, 1)[0] ?? squaresNearYou(game, ground, 5, 9, 1)[0] ?? ground.you;
        fighter.live = newLive(fighter, side, spot);
        continue;
      }
      const person = here(fighter);
      if (person) {
        fighter.person = person.key;
        fighter.live = newLive(fighter, side, person);
      } else comers.push({ fighter, side });
    }
  }
  const allies = comers.filter((one) => one.side === "ally");
  const enemies = comers.filter((one) => one.side === "enemy");
  squaresNearYou(game, ground, 0.5, 4, allies.length).forEach((spot, i) => {
    allies[i].fighter.live = newLive(allies[i].fighter, "ally", spot);
  });
  if (enemies.length) {
    const way = [...ground.ways].sort((a, b) => tilesApart(b, ground.you) - tilesApart(a, ground.you))[0];
    let spots = way ? squaresBy(game, ground, way, enemies.length) : [];
    if (spots.length < enemies.length) spots = [...spots, ...squaresNearYou(game, ground, 5, 9, enemies.length - spots.length)];
    enemies.forEach(({ fighter }, i) => {
      fighter.live = newLive(fighter, "enemy", spots[i] ?? ground.you);
    });
  }
  // Nobody stands where there's no room for them.
  for (const { fighter, side } of comers) if (!fighter.live) fighter.live = newLive(fighter, side, ground.you);
}

// The fight moves into the room the player's in. Training fights stay in their window, and so does a fight where there's
// no room to have it in.
export function goLive(game) {
  const c = game.combat;
  if (!c) throw new Error("There's no fight right now.");
  if (c.live) return;
  if (c.training) throw new Error("A simulated fight stays in its window.");
  if (c.away) throw new Error(`This fight is ${c.away}, not in the room.`);
  if (c.round > 1) throw new Error("This fight is already under way in its window.");
  const ground = groundOf(game);
  if (!ground) throw new Error("There's nowhere to have this fight in the room.");
  c.live = { t: 0, you: { x: ground.you.x, y: ground.you.y, path: [], rate: yourRate(game), cool: 0, target: null, queued: null, waited: false, chase: 0 } };
  placeEveryone(game, ground);
}

// A battle starts in the room straight away (src/battles.js): everyone where the battle has put them, and whoever comes
// later where the battle says they come in, when they come.
export function goBattle(game, spots) {
  const c = game.combat;
  if (!c?.battle) throw new Error("There's no battle right now.");
  if (c.live) return;
  const ground = groundOf(game);
  if (!ground) throw new Error("There's nowhere to have this battle in the room.");
  const you = spots.you ?? ground.you;
  c.live = { t: 0, you: { x: you.x, y: you.y, path: [], rate: yourRate(game), cool: 0, target: null, queued: null, waited: false, chase: 0 } };
  for (const [side, list] of [["ally", c.allies], ["enemy", c.enemies]]) {
    for (const fighter of list) if (spots[fighter.key]) fighter.live = newLive(fighter, side, spots[fighter.key]);
  }
  placeEveryone(game, ground);
}

// ---- Walking ---------------------------------------------------------------------------------------------------------

function walkOn(live, dt) {
  let left = FIGHT_SPEED * dt;
  while (left > 0 && live.path.length) {
    const next = live.path[0];
    const d = tilesApart(live, next);
    if (d <= left) {
      live.x = next.x;
      live.y = next.y;
      live.path.shift();
      left -= d;
    } else {
      live.x += ((next.x - live.x) * left) / d;
      live.y += ((next.y - live.y) * left) / d;
      left = 0;
    }
  }
}

// Where someone else would rather stand, and who they'd go for from there: someone who shoots wants a clear shot and to
// be shot at as little as they can, and someone who closes in wants to be next to the nearest of the other side.
function planFor(game, ground, body, foes = facing(game, body)) {
  if (!foes.length) return { path: [], score: 0, stay: 0, target: null };
  const reach = body.live.reach;
  const area = reachFrom(ground.level, squareOf(body.live), PLAN_REACH[reach] ?? 5, taken(game, ground, body));
  // In a battle, where someone else is already walking to is as good as taken.
  const near = crowded(game, body, ground.battle ? bodies(game).filter((one) => one.key !== body.key && one.live?.path?.length).map((one) => one.live.path.at(-1)) : []);
  // In a battle, whoever holds the room the other side makes for keeps to it.
  const keep = ground.battle && body.fighter?.holds ? ground.goalArea : ground.area;
  const inRoom = (spot) => !keep || (spot.x >= keep.x && spot.x < keep.x + keep.w && spot.y >= keep.y && spot.y < keep.y + keep.h);
  let best = null;
  let stay = -Infinity;
  for (const spot of area.values()) {
    if (spot.cost > 0 && (near.has(spotKey(spot.x, spot.y)) || !inRoom(spot))) continue;
    let score;
    let target = null;
    if (reach === "melee") {
      let nearest = Infinity;
      for (const foe of foes) {
        const d = tilesApart(spot, foe.live);
        if (d < nearest) {
          nearest = d;
          target = foe;
        }
      }
      score = -nearest * 10 - spot.cost * 0.2;
    } else {
      let top = null;
      for (const foe of foes) {
        const line = lineOfFire(ground.shape, spot, foe.live);
        if (!line.clear) continue;
        const defense = foe.fighter ? foe.fighter.defense : 12;
        // In a room the player is the one to shoot at; in a battle they're one of many.
        const value = oddsFor(body.fighter.attack, defense + (line.cover ? COVER : 0)) + (foe.key === YOU && !ground.battle ? 6 : 0) + (body.live.mark === foe.key ? 8 : 0);
        if (!top || value > top.value) top = { foe, value };
      }
      let danger = 0;
      for (const foe of foes) {
        if (reachOfBody(game, foe) === "melee") {
          if (tilesApart(spot, foe.live) <= 3) danger += 0.7;
          continue;
        }
        const back = lineOfFire(ground.shape, foe.live, spot);
        if (back.clear) danger += back.cover ? 0.4 : 1;
      }
      score = (top ? 40 + top.value * 0.5 : 0) - danger * 9 - spot.cost * 1.6;
      target = top?.foe ?? null;
    }
    if (spot.cost === 0) stay = score;
    if (!best || score > best.score) best = { spot, score, target };
  }
  return { path: best ? pathTo(best.spot) : [], score: best?.score ?? 0, stay, target: best?.target?.key ?? null };
}

// The player, with something held, walks up to whoever they're going for.
function closeIn(game, ground, target) {
  const you = game.combat.live.you;
  if (you.chase > 0 || legOf(game, bodies(game)[0])) return;
  you.chase = 0.5;
  const area = reachFrom(ground.level, squareOf(you), 14, taken(game, ground, bodies(game)[0]));
  let best = null;
  for (const spot of area.values()) {
    const d = tilesApart(spot, target.live);
    if (d <= REACH && (!best || spot.cost < best.cost)) best = spot;
  }
  if (best) you.path = pathTo(best);
}

// ---- Doing things ---------------------------------------------------------------------------------------------------

const enemyOf = (game, key) => alive(game.combat.enemies).find((one) => one.key === key && one.live) ?? null;
// Cover is set on whoever's aimed at just for the shot, and taken off again.
function withCover(target, cover, run) {
  target.cover = cover ? COVER : 0;
  try {
    return run();
  } finally {
    delete target.cover;
  }
}

// One of the player's orders, the same as a round's in src/combat.js, less what the room does instead: taking cover
// is standing behind something.
function runOrder(game, c, action, target, log) {
  if (action.type === "attack") playerAttack(game, c, target, log);
  else if (action.type === "item") {
    spendFromBelt(game, action.id);
    log.push({ by: YOU, on: YOU, gained: 1, hp: { [YOU]: game.hp }, text: useItem(game, action.id), tone: "good" });
  } else if (action.type === "draw") {
    c.drawn = !c.drawn;
    const now = ITEMS[drawnWeapon(game)];
    log.push({ by: YOU, text: c.drawn ? `You draw your ${now.name}.` : `You put the sidearm away and go back to your ${now?.name ?? "bare hands"}.`, tone: "info" });
  } else if (action.type === "flee") {
    const die = roll(1, 20);
    const total = die + fleeBonus(game);
    const dc = fleeDc(c);
    addNotes(c, log, practice(game, "athletics", 2));
    if (die === 20 || (die !== 1 && total >= dc)) {
      log.push({ by: YOU, text: COMBAT_TEXT.player.fleeSuccess[roll(0, COMBAT_TEXT.player.fleeSuccess.length - 1)], tone: "info", math: `${total} vs ${dc}` });
      return finish(game, "fled", log);
    }
    log.push({ by: YOU, text: fill(COMBAT_TEXT.player.fleeFail, { enemy: target }), tone: "dim", math: `${total} vs ${dc}` });
  } else if (action.type === "parley") tryParley(game, c, target, action.id, log);
  else if (action.type === "surrender") return finish(game, "surrendered", log);
  else useAbility(game, c, action.id, target, log);
  return null;
}

// What the player does once they're ready: what they asked for, or else another go at whoever they're aiming at.
function playerActs(game, ground, log) {
  const c = game.combat;
  const you = c.live.you;
  const queued = you.queued;
  const order = queued ?? (you.target ? { type: "attack", target: you.target } : null);
  if (!order) return null;
  const target = order.target ? enemyOf(game, order.target) : null;
  if (order.target && !target) {
    if (queued) you.queued = null;
    else you.target = null;
    return null;
  }
  const need = needOf(game, order);
  let cover = false;
  if (need && target) {
    const sight = sightBetween(game, ground, you, need, target.live);
    if (!sight.ok) {
      const leg = need === "melee" ? legOf(game, bodies(game)[0]) : null;
      if (leg && !you.stuck) {
        you.stuck = true;
        log.push({ text: `You can't get to them with ${leg.words}.`, tone: "dim" });
      }
      if (ground.battle) approach(game, ground, target, need);
      else if (need === "melee") closeIn(game, ground, target);
      return null;
    }
    cover = sight.cover;
  }
  const aimedAt = target ?? alive(c.enemies)[0];
  try {
    checkAllowed(game, c, order, aimedAt);
  } catch (err) {
    you.queued = null;
    log.push({ text: err.message, tone: "dim" });
    return null;
  }
  // Evading lasts until the player does something else.
  c.guard = 0;
  you.queued = null;
  you.cool = you.rate;
  you.waited = false;
  return withCover(aimedAt, cover, () => runOrder(game, c, order, aimedAt, log));
}

// Followers choose for themselves: whoever the player's aiming at, if they can hit them, or else the weakest they can.
function followerActs(game, ground, body, log) {
  const c = game.combat;
  const reach = body.live.reach;
  const choices = alive(c.enemies).filter((one) => one.live).map((one) => ({ one, sight: sightBetween(game, ground, body.live, reach, one.live) })).filter(({ sight }) => sight.ok);
  if (!choices.length) return;
  const wanted = choices.find(({ one }) => one.key === c.live.you.target) ?? choices.reduce((low, next) => (next.one.hp < low.one.hp ? next : low));
  body.live.cool = body.live.rate;
  withCover(wanted.one, wanted.sight.cover, () => followerAttacks(c, body.fighter, null, log, wanted.one));
}

// The other side goes for the player more than anyone, as it does in rounds, and for whoever they can hit.
function enemyActs(game, ground, body, log) {
  const c = game.combat;
  const enemy = body.fighter;
  if (enemy.stunned) {
    enemy.stunned = false;
    body.live.cool = body.live.rate;
    log.push({ on: enemy.key, text: fill(enemy.lines?.stunned ?? COMBAT_TEXT.enemy.stunned, { enemy }), tone: "good" });
    return;
  }
  const reach = body.live.reach;
  const options = facing(game, body).map((foe) => ({ foe, sight: sightBetween(game, ground, body.live, reach, foe.live) })).filter(({ sight }) => sight.ok);
  if (!options.length) return;
  const marked = options.find(({ foe }) => foe.key === body.live.mark);
  // The player draws more of their attention in a room, as in rounds; in a battle, everyone's fair game.
  const weighted = ground.battle ? options : options.flatMap((option) => (option.foe.key === YOU ? [option, option] : [option]));
  const { foe, sight } = marked ?? weighted[roll(0, weighted.length - 1)];
  body.live.mark = foe.key;
  body.live.cool = body.live.rate;
  if (foe.key === YOU) {
    const evading = c.guard;
    c.guard = evading + (sight.cover ? COVER : 0);
    try {
      attackPlayer(game, c, enemy, log);
    } finally {
      c.guard = evading;
    }
  } else withCover(foe.fighter, sight.cover, () => attackFollower(c, enemy, foe.fighter, log));
}

// The fight's over: the player stays where they ended up, and the rest is src/combat.js's.
function finish(game, ended, log) {
  const c = game.combat;
  c.round = Math.max(1, Math.ceil(c.live.t / ROUND_SECONDS));
  const you = squareOf(c.live.you);
  standAfterFight(game, you.x, you.y);
  return endCombat(game, ended, log);
}

// ---- A battle -------------------------------------------------------------------------------------------------------
// Everyone thinks the same way as in a room about whoever's near them. Someone with nobody near goes looking: the other
// side for the room they make for, and the player's side for the nearest of them, except whoever holds that room, who
// stays in it. When as many of the other side as the battle says are out of it, the rest give up. If the player goes
// down, it's fought out without them, and whoever's still against them at the end gives up to the rest of the crew.

// Someone walking a long way stops for someone to fight: one within reach with nothing in the way, or for someone with
// something held, right beside them.
function nearFoe(game, body) {
  const ground = groundOf(game);
  return facing(game, body).some((foe) => {
    const far = tilesApart(body.live, foe.live);
    if (body.live.reach === "melee") return far <= REACH * 1.5;
    return far <= ENGAGE && lineOfFire(ground.shape, body.live, foe.live).clear;
  });
}
const insideArea = (area, spot) => Boolean(area) && spot.x >= area.x && spot.x < area.x + area.w && spot.y >= area.y && spot.y < area.y + area.h;

// How far every square of the deck is from the room the other side makes for, worked out once for the battle.
function goalField(ground) {
  if (ground.field) return ground.field;
  const area = ground.goalArea;
  const starts = [];
  if (area) for (let y = area.y; y < area.y + area.h; y += 1) for (let x = area.x; x < area.x + area.w; x += 1) if (canStand(ground.level, x, y)) starts.push({ x, y });
  ground.field = walkCosts(ground.level, starts).best;
  return ground.field;
}

// The next stretch towards the room they make for, downhill across the deck, round anyone in the way.
function marchPath(game, ground, body) {
  const field = goalField(ground);
  const blocked = taken(game, ground, body);
  const level = ground.level;
  let at = squareOf(body.live);
  const path = [];
  let walked = 0;
  for (let i = 0; i < 60 && walked < MARCH; i += 1) {
    const here = field.get(spotKey(at.x, at.y))?.cost ?? Infinity;
    if (here === 0) break;
    let next = null;
    for (const [dx, dy, step] of MOVES) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!canStand(level, x, y) || blocked.has(spotKey(x, y))) continue;
      if (dx && dy && (!canStand(level, at.x + dx, at.y) || !canStand(level, at.x, at.y + dy))) continue;
      const cost = field.get(spotKey(x, y))?.cost;
      if (cost === undefined || cost >= here) continue;
      if (!next || cost < next.cost) next = { x, y, cost, step };
    }
    if (!next) break;
    path.push({ x: next.x, y: next.y });
    walked += next.step;
    at = next;
  }
  return path;
}

// The first stretch of the way to the nearest of the other side: near enough to shoot, or to hit with something held.
function huntPath(game, ground, body, foes) {
  const me = squareOf(body.live);
  const nearest = foes.reduce((best, foe) => (tilesApart(me, foe.live) < tilesApart(me, best.live) ? foe : best));
  // Near enough to hit with something held, or to shoot from: in range, with nothing in the way.
  const there = body.live.reach === "melee"
    ? (node) => tilesApart(node, nearest.live) <= REACH
    : (node) => tilesApart(node, nearest.live) <= ENGAGE * 0.75 && lineOfFire(ground.shape, node, nearest.live).clear;
  const { found } = walkCosts(ground.level, [me], { budget: 90, blocked: taken(game, ground, body), stop: there });
  const path = [];
  let walked = 0;
  let from = me;
  for (const step of found ? pathTo(found) : []) {
    walked += tilesApart(from, step);
    if (walked > MARCH) break;
    path.push(step);
    from = step;
  }
  return path;
}

function planBattle(game, ground, body) {
  const foes = facing(game, body);
  if (!foes.length) return { path: [], score: 0, stay: 0, target: null };
  // Someone near, through a wall, isn't someone to fight from here: near is a shot to be had a few steps away, or for
  // someone with something held, a few steps to them.
  const near = foes.filter((foe) => tilesApart(body.live, foe.live) <= ENGAGE);
  if (near.length && body.live.reach === "melee" && near.some((foe) => tilesApart(body.live, foe.live) <= 3)) return planFor(game, ground, body, near);
  if (near.length && body.live.reach !== "melee") {
    const plan = planFor(game, ground, body, near);
    if (plan.target) return plan;
  }
  const inGoal = insideArea(ground.goalArea, squareOf(body.live));
  if (body.fighter?.holds && inGoal) return { path: [], score: 0, stay: 0, target: null };
  const path = body.side === "them" && !inGoal ? marchPath(game, ground, body) : huntPath(game, ground, body, foes);
  return { path, score: 0, stay: 0, target: null, march: true };
}

// The player, with nobody in reach of what they've asked for, walks to where they can reach them.
function approach(game, ground, target, need) {
  const you = game.combat.live.you;
  if (you.chase > 0 || legOf(game, bodies(game)[0])) return;
  you.chase = 0.8;
  const ok = (node) => (need === "melee" ? tilesApart(node, target.live) <= REACH
    : need === "hear" ? tilesApart(node, target.live) <= TALK_REACH - 1
      : tilesApart(node, target.live) <= BATTLE_SIGHT - 1 && lineOfFire(ground.shape, node, target.live).clear);
  const { found } = walkCosts(ground.level, [squareOf(you)], { budget: ORDER_REACH, blocked: taken(game, ground, bodies(game)[0]), stop: ok });
  if (found) you.path = pathTo(found);
}

// A group's line, once they've come.
function waveLines(c, log) {
  for (const wave of c.battle.waves ?? []) {
    if (wave.told || wave.round > c.round) continue;
    wave.told = true;
    if (wave.words) log.push({ battle: true, text: wave.words, tone: wave.side === "enemy" ? "bad" : "good" });
  }
}

// When enough of the other side are out of it, down or talked out of it, the rest of them give up.
function battleBroken(game, log) {
  const c = game.combat;
  const rule = c.battle.giveUp;
  if (!rule) return false;
  const out = c.enemies.filter((one) => one.hp <= 0 || one.out).length;
  if (out < Math.ceil((c.battle.total * rule.of) / rule.in)) return false;
  const left = alive(c.enemies);
  if (!left.length) return false;
  for (const one of left) Object.assign(one, { out: "gave_up", outAs: "Gave up" });
  c.arrivals = c.arrivals.filter((one) => one.side !== "enemy");
  log.push({ battle: true, text: c.battle.gaveUpLine ?? "The rest of them give up.", tone: "good" });
  return true;
}

// A battle's won when nobody against the player is still fighting, and nobody's still to come up.
const battleWon = (game) => won(game) && !game.combat.arrivals.some((one) => one.side === "enemy");

function actInBattle(game, ground, log) {
  const c = game.combat;
  const over = () => {
    battleBroken(game, log);
    return battleWon(game) ? finishBattle(game, ground, "victory", log) : null;
  };
  if (yourReady(game)) {
    const done = playerActs(game, ground, log);
    if (done) return done;
    const ended = over();
    if (ended) return ended;
  }
  for (const body of bodies(game)) {
    if (body.key === YOU || !standing(game, body) || body.live.cool > 0 || body.live.path.length) continue;
    if (body.side === "us") followerActs(game, ground, body, log);
    else enemyActs(game, ground, body, log);
    const ended = over();
    if (ended) return ended;
    if (game.hp <= 0) {
      foughtWithoutYou(game, ground, log);
      return finishBattle(game, ground, "defeat", log);
    }
  }
  return null;
}

// The player's down: the rest of it is fought out at once, without them, until one side's out of it or the time runs
// out. Only who went down, and the battle's own lines, are kept of what happened.
function foughtWithoutYou(game, ground, log) {
  const c = game.combat;
  const kept = [{ text: "You've gone down. The fight goes on without you.", tone: "bad" }];
  const from = c.live.t;
  while (c.live.t - from < WITHOUT_YOU) {
    const step = [];
    advance(game, ground, 0.1, step);
    for (const body of bodies(game)) {
      if (body.key === YOU || !standing(game, body) || body.live.cool > 0 || body.live.path.length) continue;
      if (body.side === "us") followerActs(game, ground, body, step);
      else enemyActs(game, ground, body, step);
    }
    const broken = battleBroken(game, step);
    kept.push(...step.filter((event) => event.down || event.battle));
    if (broken || battleWon(game)) break;
    if (!alive(c.allies).length && !c.arrivals.some((one) => one.side === "ally")) break;
  }
  // Whoever's still against them gives up to the rest of the crew, who've come up from below.
  const left = alive(c.enemies);
  for (const one of left) Object.assign(one, { out: "gave_up", outAs: "Gave up", overpowered: true });
  c.arrivals = c.arrivals.filter((one) => one.side !== "enemy");
  if (left.length) kept.push({ battle: true, text: `The rest of the crew came up from below, and the last ${left.length === 1 ? "one of them gave up" : `${left.length} of them gave up`}.`, tone: "info" });
  log.push(...kept);
}

const listed = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// What happens to the people when a battle ends, before the fight itself is put away (src/aftermath.js): the fallen
// laid down, the other side's taken prisoner, what it costs aboard. The rules can't load that file, so it says.
let battleEnding = null;
export const tellBattleEnding = (fn) => {
  battleEnding = fn;
};

// A battle's over: everyone on the player's side who's still standing stays where it left them, and goes back to their
// day from there; the rest is src/combat.js's, as for any fight; then what the story keeps of it, in a line and a record.
function finishBattle(game, ground, ended, log) {
  const c = game.combat;
  const battle = c.battle;
  const down = c.enemies.filter((one) => one.hp <= 0).length;
  const gaveUp = c.enemies.filter((one) => one.hp > 0 && one.out === "gave_up").length;
  const talked = c.enemies.filter((one) => one.hp > 0 && one.out && one.out !== "gave_up").length;
  const overpowered = c.enemies.filter((one) => one.overpowered).length;
  const fallen = c.allies.filter((one) => one.hp <= 0).map((one) => one.prose);
  const people = game.life?.places?.[game.location] ?? {};
  for (const one of c.allies) {
    const state = one.body?.who ? people[one.body.who] : null;
    const spot = one.live ? squareOf(one.live) : null;
    if (one.hp > 0 && state && spot && canStand(ground.level, spot.x, spot.y)) Object.assign(state, { level: ground.level.id, x: spot.x, y: spot.y, path: null });
  }
  // Two of the fallen don't lie on one square: the second is moved to the nearest one free, which is where they fell.
  // (This comes before the people are laid down, so they lie where they're drawn.)
  const lying = new Set();
  for (const one of [...c.allies, ...c.enemies]) {
    if (one.hp > 0 || !one.live) continue;
    let spot = squareOf(one.live);
    if (lying.has(spotKey(spot.x, spot.y))) {
      const { found } = walkCosts(ground.level, [spot], { budget: 6, stop: (node) => !lying.has(spotKey(node.x, node.y)) });
      if (found) spot = { x: found.x, y: found.y };
    }
    lying.add(spotKey(spot.x, spot.y));
    one.live.x = spot.x;
    one.live.y = spot.y;
  }
  // The people first: the fallen laid down, the other side's taken prisoner, and what it costs aboard, so that the hours
  // a player who went down spends on a cot are hours the medics spend on everyone.
  if (battleEnding) addNotes(c, log, battleEnding(game, c, ground, ended) ?? []);
  const outcome = finish(game, ended, log);
  outcome.battle = battle.title;
  const them = [`${down} of them down`, gaveUp ? `${gaveUp} gave up` : null, talked ? `${talked} talked out of it` : null].filter(Boolean).join(", ");
  const ours = fallen.length ? `Down on your side: ${listed(fallen)}.` : "Nobody on your side went down.";
  const brig = gaveUp + talked ? ` ${gaveUp + talked === 1 ? "The one who gave up is" : "Those who gave up are"} taken to the brig${down ? ", and the rest will follow once they're on their feet" : ""}.` : "";
  const woke = /came to/.test(outcome.summary ?? "");
  const summary = ended === "defeat"
    ? `You went down in ${battle.title}, and it was fought out without you: ${them}. ${ours}${brig}${woke ? " You came to in the medbay." : ""}`
    : `${battle.title} is over: ${them}. ${ours}${brig}`;
  outcome.summary = summary;
  if (game.lastFight) game.lastFight.summary = summary;
  // What the story after it can read: how it ended, how many on each side, and who went down.
  game.battles ??= {};
  game.battles[battle.id] = { result: outcome.result, day: Math.floor(game.clock.hours / 24) + 1, hours: game.clock.hours, total: battle.total, down, gaveUp, talked, overpowered, fallen, youDown: ended === "defeat" };
  return outcome;
}

// ---- Time going by ---------------------------------------------------------------------------------------------------

function advance(game, ground, dt, log) {
  const c = game.combat;
  c.live.t += dt;
  c.live.you.chase = Math.max(0, c.live.you.chase - dt);
  for (const body of bodies(game)) {
    if (!standing(game, body)) {
      body.live.path = [];
      continue;
    }
    if (legOf(game, body)) body.live.path = [];
    else walkOn(body.live, dt * paceIn(game, body));
    body.live.cool = Math.max(0, body.live.cool - dt);
    // In a battle, someone walking a long way stops when one of the other side comes near, and thinks again.
    if (ground.battle && body.key !== YOU && body.live.marching) {
      if (!body.live.path.length) body.live.think = Math.min(body.live.think, 0.2);
      else if (nearFoe(game, body)) {
        body.live.path = [];
        body.live.think = 0;
      } else continue;
      body.live.marching = false;
    }
  }
  for (const body of bodies(game)) {
    if (body.key === YOU || !standing(game, body) || body.live.path.length) continue;
    body.live.think -= dt;
    if (body.live.think > 0) continue;
    body.live.think = 1.3 + Math.random();
    const plan = ground.battle ? planBattle(game, ground, body) : planFor(game, ground, body);
    if (plan.target) body.live.mark = plan.target;
    if (plan.path.length && !legOf(game, body) && (plan.march || body.live.reach === "melee" || plan.score > plan.stay + 7)) {
      body.live.path = plan.path;
      body.live.marching = Boolean(plan.march);
    }
  }
  // People due partway through come in by the way into the room, round by round as they would have. In a battle, a
  // group's own line says they've come, once.
  const round = 1 + Math.floor(c.live.t / ROUND_SECONDS);
  while (c.round < round) {
    bringArrivals(c, log);
    c.round += 1;
    if (c.battle) waveLines(c, log);
  }
  placeEveryone(game, ground);
}

const yourReady = (game) => game.hp > 0 && game.combat.live.you.cool <= 0 && !game.combat.live.you.path.length;
const won = (game) => !alive(game.combat.enemies).length;

function act(game, ground, log) {
  const c = game.combat;
  if (c.battle) return actInBattle(game, ground, log);
  if (yourReady(game)) {
    const over = playerActs(game, ground, log);
    if (over) return over;
    if (won(game)) return finish(game, "victory", log);
  }
  for (const body of bodies(game)) {
    if (body.key === YOU || !standing(game, body) || body.live.cool > 0 || body.live.path.length) continue;
    if (body.side === "us") followerActs(game, ground, body, log);
    else enemyActs(game, ground, body, log);
    if (won(game)) return finish(game, "victory", log);
    if (game.hp <= 0) return finish(game, "defeat", log);
  }
  return null;
}

// The page says how much time has gone by, and the fight goes on that long. With stop-when-ready asked for, it stops
// the moment the player can act, before they do, and goes on from there when it's next asked.
export function liveTick(game, { ms = 0, stopWhenReady = false } = {}) {
  const c = game.combat;
  if (!c?.live) throw new Error("There's no fight in the room right now.");
  const ground = groundOf(game);
  if (!ground) throw new Error("There's nowhere to have this fight in the room.");
  const log = [];
  let left = Math.max(0, Math.min(Number(ms) || 0, LONGEST_TICK * 1000)) / 1000;
  while (left > 1e-9) {
    const dt = Math.min(STEP, left);
    left -= dt;
    advance(game, ground, dt, log);
    if (stopWhenReady && yourReady(game) && !c.live.you.waited) {
      c.live.you.waited = true;
      return { over: false, events: log, ready: true };
    }
    const over = act(game, ground, log);
    if (over) return over;
  }
  return { over: false, events: log };
}

// An order from the player: walk somewhere, go for someone, or do something once they're ready. Nothing happens until
// the fight's running.
export function liveOrder(game, body) {
  const c = game.combat;
  if (!c?.live) throw new Error("There's no fight in the room right now.");
  const ground = groundOf(game);
  const you = c.live.you;
  if (game.hp <= 0) throw new Error("You're down.");
  if (body.type === "move") {
    const leg = legOf(game, bodies(game)[0]);
    if (leg) throw new Error(`You can't walk with ${leg.words}.`);
    const x = Math.round(Number(body.x));
    const y = Math.round(Number(body.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Walk where?");
    const area = reachFrom(ground.level, squareOf(you), ORDER_REACH, taken(game, ground, bodies(game)[0]));
    let best = area.get(spotKey(x, y)) ?? null;
    // Somewhere that can't be stood on: as near to it as there's floor.
    if (!best) for (const spot of area.values()) if (tilesApart(spot, { x, y }) <= 2 && (!best || tilesApart(spot, { x, y }) < tilesApart(best, { x, y }))) best = spot;
    if (!best) throw new Error("You can't get there from here.");
    you.path = pathTo(best);
    you.chase = 2;
    return { over: false, events: [] };
  }
  if (body.type === "stop") {
    you.path = [];
    you.target = null;
    you.queued = null;
    return { over: false, events: [] };
  }
  const target = body.target ? enemyOf(game, body.target) : null;
  if (body.target && !target) throw new Error("They're not in the fight any more.");
  const order = { type: body.type, ...(body.id ? { id: body.id } : {}), ...(target ? { target: target.key } : {}) };
  if (order.type === "cover") throw new Error("In the room, cover is standing behind something.");
  checkAllowed(game, c, order, target ?? alive(c.enemies)[0]);
  if (order.type === "attack") {
    you.target = target?.key ?? alive(c.enemies)[0]?.key ?? null;
    you.queued = null;
  } else {
    if (target && ["ability", "parley"].includes(order.type)) you.target ??= target.key;
    you.queued = order;
  }
  return { over: false, events: [] };
}

// ---- What the page is shown -------------------------------------------------------------------------------------------

// The actions, as in rounds, less taking cover, and with "this round" read as the time until the player acts again.
export function liveActions(game) {
  return combatActions(game)
    .filter((one) => one.action.type !== "cover")
    .map((one) => ({ ...one, ...(one.detail ? { detail: one.detail.replace("this round", "until you act again").replace("for a round", "for a moment") } : {}) }));
}

// Where everyone is and how soon each is ready, who has cover, and what the player can hit from where they stand.
export function liveView(game) {
  const c = game.combat;
  if (!c?.live) return null;
  const ground = groundOf(game);
  const you = c.live.you;
  const coverFor = (body) => {
    if (!ground || !standing(game, body)) return false;
    const shots = facing(game, body).filter((foe) => reachOfBody(game, foe) === "range" && (!ground.battle || tilesApart(foe.live, body.live) <= BATTLE_SIGHT)).map((foe) => lineOfFire(ground.shape, foe.live, body.live)).filter((line) => line.clear);
    return shots.length > 0 && shots.every((line) => line.cover);
  };
  const all = bodies(game);
  const readiness = (live) => (live.rate ? Math.max(0, Math.min(1, 1 - live.cool / live.rate)) : 1);
  const order = you.queued ?? (you.target ? { type: "attack", target: you.target } : null);
  return {
    t: Math.round(c.live.t * 100) / 100,
    you: {
      x: you.x,
      y: you.y,
      to: you.path.at(-1) ?? null,
      ready: readiness(you),
      rate: you.rate,
      reach: yourReach(game),
      target: you.target,
      queued: you.queued,
      covered: coverFor(all[0]),
      waiting: Boolean(order && game.hp > 0),
    },
    fighters: Object.fromEntries(all.slice(1).map((body) => [body.key, {
      x: body.live.x,
      y: body.live.y,
      ready: readiness(body.live),
      reach: body.live.reach,
      covered: coverFor(body),
      person: body.fighter.person ?? null,
      side: body.side,
    }])),
    // From where the player stands, with what they hold: whether they can hit each of the other side, and through cover.
    sight: ground ? Object.fromEntries(alive(c.enemies).filter((one) => one.live).map((one) => [one.key, {
      ...sightBetween(game, ground, you, yourReach(game), one.live),
      shot: sightBetween(game, ground, you, "range", one.live),
      heard: tilesApart(you, one.live) <= TALK_REACH,
    }])) : {},
    canGiveUp: someoneTakesPrisoners(c),
  };
}
