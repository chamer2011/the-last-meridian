// The ports' dealers in rig parts (step 5 of the hacking rework): world/dealers/<id>.txt, one for each port that has
// one, read again whenever one has changed (looked at no more than once a second). Haven's market sells ordinary parts
// at fair prices and buys only what still works; Kessara's fence sells the rare things at a markup, buys anything, broken
// too, and is kinder to friends of whoever holds the port; Tessen Colony's workshop sells air bottles for the
// Graveyard's wrecks, tools for the bench and scrap by the sack, and buys scrap. Each one bought makes the next dearer
// until the port restocks, one of everything a day; each dealer wants a kind of part, a different one on alternate
// days, and pays half again for it; a good talker (the market's own price edge) pays less and gets more. A program
// whose file says it's sold at a port is sold by that port's dealer. Nothing is rolled.
//
// The Market menu shows the dealer where the player is, from rigView(game).dealer; its orders come through /api/rig.
// game.dealers: { bought: { "kessara|racing_core": 1 }, friends: { kessara: the day they last sold there } }.
// GAME_DEALERS_DIR points tests at a copy.
import fs from "node:fs";
import path from "node:path";
import { addChecker, addDayWork } from "./room-hooks.js";
import { worldDir } from "./paths.js";
import { ITEMS, LOCATIONS, FACTIONS } from "./data.js";
import { PART_KINDS, benchToolById, rigPartById } from "./rig-parts.js";
import { programById, programsNow } from "./programs.js";
import { giveRigPart, hasTool, inUse, partName, partOf } from "./rig.js";
import { openPurse, purseOf } from "./trade.js";
import { isCaptain } from "./role.js";
import { addItem, changeStanding, clamp, priceEdge, removeItem } from "./rules.js";
import { roomFor } from "./bag.js";

export const DEALERS_DIR = process.env.GAME_DEALERS_DIR ?? path.join(worldDir, "dealers");
// My numbers: each one bought makes the next a fifth dearer; a broken part fetches 5 at a dealer that buys anything;
// a friend's step (a fifth of their standing with whoever holds the port, -2 to 3) is 5% either way; a part sells for
// half its worth where anything is bought and two fifths elsewhere, worn half that, wanted half again.
export const DEALING = { dearer: 0.2, broken: 5, friendStep: 0.05, friendEvery: 20, sellAnything: 0.5, sellWorking: 0.4, worn: 0.5, wanted: 1.5, scrapAtOnce: 5, programPrice: 30 };
const KINDS = { cell: "cell", cells: "cell", memory: "memory", core: "core", cores: "core", board: "board", boards: "board", casing: "casing", casings: "casing", link: "link", links: "link", sink: "sink", sinks: "sink", "heat sink": "sink", "heat sinks": "sink", extra: "extra", extras: "extra", scrap: "scrap" };
export const KIND_WORDS = { cell: "cells", memory: "memory", core: "cores", board: "boards", casing: "casings", link: "links", sink: "heat sinks", extra: "extras", scrap: "scrap" };
const BUYS = { anything: "anything, broken too", "what works": "only what still works", scrap: "scrap" };

const dayOf = (game) => Math.floor((game.clock?.hours ?? 0) / 24);
const aWord = (name) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;

// ---- The files ----------------------------------------------------------------------------------------

// What a line under Sells is: a rig part, a tool for the bench, or an item.
function whatIs(id) {
  if (rigPartById(id)) return "part";
  if (benchToolById(id)) return "tool";
  if (ITEMS[id]) return "item";
  return null;
}

// One file, read into { id, name, at, line, buys, scrapPrice, markup, friends, wants: [kinds], sells: [{ id, n, price,
// each }], problems }. Every problem names its file and line.
export function parseDealer(id, text) {
  const d = { id, name: id, at: null, line: "", buys: null, scrapPrice: 0, markup: 1, friends: false, wants: [], sells: [], problems: [] };
  const at = (n, message) => d.problems.push(`dealers/${id}.txt line ${n}: ${message}`);
  let part = null;
  String(text ?? "").replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (i === 0 && line.startsWith("#")) {
      d.name = line.slice(1).trim() || d.name;
      return;
    }
    if (!line || line.startsWith("#") || /^draft:/i.test(line)) return;
    if (/^sells:$/i.test(line)) {
      part = "sells";
      return;
    }
    if (part === "sells") {
      const m = /^([a-z0-9_]+): (\d+)(?:, (\d+) credits)?(?:, (\d+) at a time)?$/i.exec(line);
      if (!m) return at(i + 1, `a line under Sells is written like "memory_4: 2", or "scrap: 3, 15 credits, 3 at a time"`);
      const thing = m[1].toLowerCase();
      d.sells.push({ id: thing, n: Number(m[2]), price: m[3] ? Number(m[3]) : null, each: Number(m[4] ?? 1), line: i + 1 });
      return;
    }
    const m = /^([a-z ]+):\s*(.*)$/i.exec(line);
    if (!m) return at(i + 1, `"${line.slice(0, 40)}" isn't a line this file knows`);
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "at") d.at = value.toLowerCase();
    else if (key === "in a line") d.line = value;
    else if (key === "buys") {
      const b = /^(anything|what works|scrap)(?:, (\d+) credits each)?$/i.exec(value);
      if (!b) return at(i + 1, `buys is one of: anything, what works, or scrap with its price, like "scrap, 4 credits each"`);
      d.buys = b[1].toLowerCase();
      if (d.buys === "scrap") d.scrapPrice = Number(b[2] ?? 0) || at(i + 1, `say what scrap fetches here, like "scrap, 4 credits each"`) || 0;
    } else if (key === "markup") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return at(i + 1, "markup is a number, like 1.5 for half again");
      d.markup = n;
    } else if (key === "friends pay less") d.friends = /^yes$/i.test(value);
    else if (key === "wants") {
      for (const word of value.split(",").map((one) => one.trim().toLowerCase()).filter(Boolean)) {
        if (KINDS[word]) d.wants.push(KINDS[word]);
        else at(i + 1, `"${word}" isn't a kind of part: write cells, memory, cores, boards, casings, links, heat sinks, extras or scrap`);
      }
    } else at(i + 1, `there's no line called "${key}"`);
  });
  if (!d.at) d.problems.push(`dealers/${id}.txt: it needs an at line, the place it's at`);
  if (!d.buys) d.problems.push(`dealers/${id}.txt: it needs a buys line`);
  return d;
}

let cache = null;
// Every dealer, with what's wrong in their files. Read again when a file changes.
export function dealersNow() {
  const now = Date.now();
  if (cache && now - cache.looked < 1000) return cache;
  let files = [];
  try {
    files = fs.readdirSync(DEALERS_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  } catch {
    files = [];
  }
  const stamp = files.map((name) => {
    try {
      return `${name}:${fs.statSync(path.join(DEALERS_DIR, name)).mtimeMs}`;
    } catch {
      return name;
    }
  }).join("|");
  if (cache?.stamp === stamp) {
    cache.looked = now;
    return cache;
  }
  const list = files.map((name) => parseDealer(name.slice(0, -4), fs.readFileSync(path.join(DEALERS_DIR, name), "utf8")));
  cache = { stamp, looked: now, list, byPlace: Object.fromEntries(list.filter((d) => d.at).map((d) => [d.at, d])) };
  return cache;
}
export const dealerAt = (place) => dealersNow().byPlace[String(place ?? "")] ?? null;
export const dealerName = (place) => dealerAt(place)?.name ?? null;

// What's wrong in the files that needs the rest of the game to see: places, what's sold, programs sold where nobody is.
export function dealerProblems() {
  const { list } = dealersNow();
  const out = list.flatMap((d) => d.problems);
  const places = new Set();
  for (const d of list) {
    if (d.at && !LOCATIONS[d.at]) out.push(`dealers/${d.id}.txt: there's no place called ${d.at}`);
    if (d.at && places.has(d.at)) out.push(`dealers/${d.id}.txt: another dealer is at ${d.at} already`);
    places.add(d.at);
    if (d.friends && !LOCATIONS[d.at]?.faction) out.push(`dealers/${d.id}.txt: friends pay less, but ${LOCATIONS[d.at]?.name ?? d.at} isn't held by a faction`);
    for (const one of d.sells) {
      if (!whatIs(one.id)) out.push(`dealers/${d.id}.txt line ${one.line}: ${one.id} isn't a rig part, a tool for the bench or an item`);
      else if (whatIs(one.id) !== "item" && one.each > 1) out.push(`dealers/${d.id}.txt line ${one.line}: only items come more than one at a time`);
    }
  }
  for (const p of programsNow().list.filter((one) => one.soldAt)) if (!dealersNow().byPlace[p.soldAt]) out.push(`programs/${p.id}.txt: it's sold at ${p.soldAt}, where there's no dealer in world/dealers`);
  return out;
}
addChecker(() => (fs.existsSync(DEALERS_DIR) ? dealerProblems() : []));

// ---- Prices -------------------------------------------------------------------------------------------

const boughtOf = (game, dealer, id) => game.dealers?.bought?.[`${dealer.id}|${id}`] ?? 0;
// A friend of whoever holds the port is a step or more of friendship to a dealer whose friends pay less: a fifth of
// their standing, from -2 to 3.
export function friendSteps(game, dealer) {
  if (!dealer?.friends) return 0;
  const faction = LOCATIONS[dealer.at]?.faction;
  return clamp(Math.round((game.factions?.[faction] ?? 0) / DEALING.friendEvery), -2, 3);
}
export const wantedToday = (game, dealer) => (dealer.wants.length ? dealer.wants[dayOf(game) % dealer.wants.length] : null);

const baseOf = (one) => one.price ?? (whatIs(one.id) === "part" ? rigPartById(one.id).worth : whatIs(one.id) === "tool" ? benchToolById(one.id).price : ITEMS[one.id]?.price ?? 0);
const programPrice = (p) => p.price ?? p.hacking * DEALING.programPrice;
// What buying one costs now: dearer for each bought since the port restocked, the markup, a friend's discount, and the
// player's own way with a price.
export function buyPriceAt(game, dealer, base, bought = 0) {
  const friend = 1 - DEALING.friendStep * friendSteps(game, dealer);
  return Math.max(1, Math.round(base * dealer.markup * (1 + DEALING.dearer * bought) * friend * (1 - priceEdge(game))));
}
// What a spare part fetches here, or 0 if this dealer won't buy it.
export function sellPriceAt(game, dealer, item) {
  const p = rigPartById(item?.id);
  if (!p || dealer.buys === "scrap") return 0;
  if (item.cond === "broken") return dealer.buys === "anything" ? DEALING.broken : 0;
  const wanted = p.kind === wantedToday(game, dealer) ? DEALING.wanted : 1;
  const friend = 1 + DEALING.friendStep * friendSteps(game, dealer);
  const share = dealer.buys === "anything" ? DEALING.sellAnything : DEALING.sellWorking;
  return Math.max(1, Math.round(p.worth * share * (item.cond === "worn" ? DEALING.worn : 1) * wanted * friend * (1 + priceEdge(game))));
}
const scrapPriceAt = (game, dealer) => Math.max(1, Math.round(dealer.scrapPrice * (1 + priceEdge(game))));

// ---- What's for sale, and what the player would get --------------------------------------------------

// Tools for the bench are the ship's, so the captain pays for them out of the ship's purse; everything else comes out
// of the player's own credits.
const paidFromPurse = (game, one) => whatIs(one.id) === "tool" && isCaptain(game) && Boolean(game.ship);
const fundsFor = (game, one) => (paidFromPurse(game, one) ? purseOf(game) : game.credits ?? 0);

function nameOfThing(one) {
  const kind = whatIs(one.id);
  if (kind === "part") return rigPartById(one.id).name;
  if (kind === "tool") return benchToolById(one.id).name;
  const name = ITEMS[one.id]?.name ?? one.id;
  return one.each > 1 ? `${name}, ${one.each} at a time` : name;
}
function noteOf(one) {
  const kind = whatIs(one.id);
  if (kind === "part") return `${PART_KINDS[rigPartById(one.id).kind]}: ${rigPartById(one.id).what}`;
  if (kind === "tool") return `A tool for the bench: ${benchToolById(one.id).what}.`;
  return ITEMS[one.id]?.desc ?? "";
}

// Why one of what's for sale can't be bought now, or null.
function whyNot(game, dealer, one, price) {
  const kind = whatIs(one.id);
  if (!kind) return "it's gone from the world's files";
  if (kind === "tool" && hasTool(game, one.id)) return "it's on your bench";
  if (one.n - boughtOf(game, dealer, one.id) <= 0) return "sold out until the port restocks";
  if (fundsFor(game, one) < price) return paidFromPurse(game, one) ? "the ship's purse can't cover it" : "you can't afford it";
  if (kind === "item" && !roomFor(game, one.id)) return "no room in your pack";
  return null;
}

export function dealerView(game) {
  const dealer = dealerAt(game.location);
  if (!dealer || !game.rig) return null;
  const want = wantedToday(game, dealer);
  const sells = dealer.sells.filter((one) => whatIs(one.id)).map((one) => {
    const price = buyPriceAt(game, dealer, baseOf(one), boughtOf(game, dealer, one.id));
    const kind = whatIs(one.id);
    return {
      id: one.id, kind, name: nameOfThing(one), note: noteOf(one), price, left: Math.max(0, one.n - boughtOf(game, dealer, one.id)),
      purse: paidFromPurse(game, one), owned: kind === "tool" && hasTool(game, one.id), why: whyNot(game, dealer, one, price),
    };
  });
  const programs = programsNow().list.filter((p) => p.soldAt === dealer.at).map((p) => {
    const price = buyPriceAt(game, dealer, programPrice(p));
    const owned = game.rig.programs.includes(p.id);
    return { id: p.id, name: p.name, what: p.what, hacking: p.hacking, size: p.size, price, owned, why: owned ? "it's on your rig" : (game.credits ?? 0) < price ? "you can't afford it" : null };
  });
  const spare = game.rig.parts.filter((item) => !inUse(game.rig, item.uid) && rigPartById(item.id)).map((item) => {
    const price = sellPriceAt(game, dealer, item);
    return { uid: item.uid, name: partName(item), cond: item.cond, price, why: price ? null : dealer.buys === "scrap" ? "only buys scrap" : "won't buy it broken" };
  });
  const scrap = game.inventory?.scrap ?? 0;
  return {
    id: dealer.id,
    name: dealer.name,
    line: dealer.line,
    buys: BUYS[dealer.buys] ?? dealer.buys,
    wants: want ? KIND_WORDS[want] : null,
    friends: dealer.friends ? { steps: friendSteps(game, dealer), faction: FACTIONS[LOCATIONS[dealer.at]?.faction]?.name ?? null, standing: game.factions?.[LOCATIONS[dealer.at]?.faction] ?? 0 } : null,
    credits: game.credits ?? 0,
    purse: isCaptain(game) && game.ship && sells.some((one) => one.purse) ? purseOf(game) : null,
    sells,
    programs,
    spare,
    scrap: dealer.buys === "scrap" ? { have: scrap, price: scrapPriceAt(game, dealer), n: Math.min(DEALING.scrapAtOnce, scrap) } : null,
  };
}

// ---- Buying and selling -------------------------------------------------------------------------------

const noteBought = (game, dealer, id) => {
  game.dealers ??= { bought: {}, friends: {} };
  game.dealers.bought ??= {};
  const key = `${dealer.id}|${id}`;
  game.dealers.bought[key] = (game.dealers.bought[key] ?? 0) + 1;
};

// The orders from the Market menu: deal-buy, deal-program, deal-sell and deal-scrap. Returns { said, notes }.
export function dealCommand(game, body) {
  const dealer = dealerAt(game.location);
  if (!dealer) throw new Error("There's nobody here who deals in rig parts.");
  if (game.talk) throw new Error("Finish the talk first.");
  const notes = [];
  if (body.action === "deal-buy") {
    const one = dealer.sells.find((line) => line.id === String(body.id ?? ""));
    if (!one) throw new Error("That isn't sold here.");
    const price = buyPriceAt(game, dealer, baseOf(one), boughtOf(game, dealer, one.id));
    const why = whyNot(game, dealer, one, price);
    if (why) throw new Error(`You can't buy that: ${why}.`);
    const kind = whatIs(one.id);
    if (paidFromPurse(game, one)) {
      openPurse(game);
      game.ship.purse -= price;
    } else game.credits -= price;
    noteBought(game, dealer, one.id);
    const paid = paidFromPurse(game, one) ? `${price} credits from the ship's purse` : `${price} credits`;
    if (kind === "part") {
      giveRigPart(game, one.id, { from: `Bought at ${dealer.name}.` });
      return { said: `Bought ${aWord(rigPartById(one.id).name.toLowerCase())} for ${paid}. It's with your rig's spare parts.`, notes };
    }
    if (kind === "tool") {
      game.rig.tools = [...(game.rig.tools ?? []), one.id];
      return { said: `Bought ${aWord(benchToolById(one.id).name.toLowerCase())} for ${paid}. It goes on the Repair Bay's bench.`, notes };
    }
    addItem(game, one.id, one.each);
    const name = ITEMS[one.id].name.toLowerCase();
    return { said: `Bought ${one.each > 1 ? `${one.each} ${name}` : aWord(name)} for ${paid}.`, notes };
  }
  if (body.action === "deal-program") {
    const p = programById(body.id);
    if (!p || p.soldAt !== dealer.at) throw new Error("That isn't sold here.");
    if (game.rig.programs.includes(p.id)) throw new Error(`Your rig has ${p.name} already.`);
    const price = buyPriceAt(game, dealer, programPrice(p));
    if ((game.credits ?? 0) < price) throw new Error(`You can't afford ${p.name}.`);
    game.credits -= price;
    game.rig.programs.push(p.id);
    return { said: `Bought ${p.name} for ${price} credits. It's on your rig: load it on the Rig page.`, notes };
  }
  if (body.action === "deal-sell") {
    const item = partOf(game.rig, String(body.uid ?? ""));
    if (!item) throw new Error("Your rig has no such part.");
    if (inUse(game.rig, item.uid)) throw new Error("Take it out of the rig first.");
    const price = sellPriceAt(game, dealer, item);
    if (!price) throw new Error(dealer.buys === "scrap" ? `${dealer.name} only buys scrap.` : `${dealer.name} won't buy it broken.`);
    game.rig.parts = game.rig.parts.filter((one) => one.uid !== item.uid);
    game.credits = (game.credits ?? 0) + price;
    const said = `Sold ${aWord(`${item.cond === "new" ? "" : `${item.cond} `}${partName(item).toLowerCase()}`)} at ${dealer.name} for ${price} credits.`;
    // A friend of the port is one who keeps coming back: a sale there counts with whoever holds it, once a day.
    if (dealer.friends && game.dealers?.friends?.[dealer.id] !== dayOf(game)) {
      game.dealers ??= { bought: {}, friends: {} };
      game.dealers.friends = { ...(game.dealers.friends ?? {}), [dealer.id]: dayOf(game) };
      const line = changeStanding(game, LOCATIONS[dealer.at]?.faction, 1, `you sold to ${dealer.name.replace(/^Kessara's /, "the ")}`);
      if (line) notes.push(line);
    }
    return { said, notes };
  }
  if (body.action === "deal-scrap") {
    if (dealer.buys !== "scrap") throw new Error(`${dealer.name} doesn't buy scrap.`);
    const n = Math.min(DEALING.scrapAtOnce, game.inventory?.scrap ?? 0);
    if (!n) throw new Error("You've no scrap to sell.");
    const price = scrapPriceAt(game, dealer);
    removeItem(game, "scrap", n);
    game.credits = (game.credits ?? 0) + n * price;
    return { said: `Sold ${n} scrap at ${dealer.name} for ${n * price} credits.`, notes };
  }
  throw new Error("Unknown order.");
}

// A day at the ports: each takes in one more of everything it sells, and its prices ease back.
addDayWork((game) => {
  const bought = game.dealers?.bought;
  if (!bought) return [];
  for (const key of Object.keys(bought)) {
    bought[key] -= 1;
    if (bought[key] <= 0) delete bought[key];
  }
  return [];
});
