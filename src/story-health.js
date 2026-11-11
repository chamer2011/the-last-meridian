// The written story and the body (health step 9). A scene, a conversation or a story's clock can ask how someone is:
// hurt, badly hurt, ill, able to walk, laid up in the medbay, or dead; and a scene can wound someone, heal them, or let
// them die, with its reason. What it does goes on the record, as a fact the stories can react to: tarrow_wounded,
// tarrow_healed, and a death's tarrow_died, besides the tarrow_lost_a_limb the game leaves when a limb goes.
//
// Someone is named as anywhere else in the scenes: their id or their name (tarrow, Kara Tarrow, Tarrow), a crowd name
// from a place's life file (Mess Hand Bao), a stand-in ({ringleader}), or you; conditions can also say any.

import { addWounds, cantGetUp, deathOf, factNameOf, isIllness, keyAt, nameOfKey, newWound, seeded, woundKindsByName, woundNames, woundRules, woundsNow } from "./body.js";
import { YOU, personByWords } from "./command.js";
import { die } from "./death.js";
import { fallDown, medbayOf } from "./medbay.js";
import { recordFact } from "./record.js";
import { WORLD_CHARACTERS, WORLD_LIFE } from "./world.js";
import { PART_WORDS, readWhere } from "../public/health-text.js";

const SHIP = "meridian";
const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9{}_]+/g, " ").trim();
const nowOf = (game) => game.clock?.hours ?? 0;
const isStandIn = (words) => /^\{[a-z_]+\}$/.test(String(words ?? "").trim());

// ---- Who ------------------------------------------------------------------------------------------------

// Who someone's words name: you, someone aboard the Meridian by the chain of command's reckoning, a story person by
// their id or name, or a crowd name at any place; with their body's key, who the life file knows them as, and the
// place whose file has a day for them, if any. Null for nobody the game knows.
export function personOf(words) {
  const want = String(words ?? "").trim();
  if (!want || isStandIn(want)) return null;
  if (/^you$/i.test(want)) return { key: YOU, who: YOU, place: null };
  const aboard = personByWords(SHIP, want);
  if (aboard && aboard !== "nobody") return aboard === YOU ? { key: YOU, who: YOU, place: null } : { key: keyAt(SHIP, aboard), who: aboard, place: SHIP };
  const asked = plain(want);
  for (const [id, file] of Object.entries(WORLD_CHARACTERS)) {
    const name = plain(file.name);
    if (asked === id || asked === name || name.split(" ").includes(asked) || (file.aliases ?? []).some((alias) => plain(alias) === asked)) {
      const place = Object.keys(WORLD_LIFE).find((one) => WORLD_LIFE[one].people?.[id]) ?? null;
      return { key: `id:${id}`, who: id, place };
    }
  }
  for (const [place, life] of Object.entries(WORLD_LIFE)) for (const group of life.crowd ?? []) for (const [name] of group.names) if (plain(name) === asked) return { key: keyAt(place, name), who: name, place };
  return null;
}
export const bodyKeyOf = (words) => personOf(words)?.key ?? null;
// Whether the checker should let a name through: someone the game knows, or a stand-in it fills in when it plays.
const known = (words) => isStandIn(words) || bodyKeyOf(words) !== null;

// ---- Asking ---------------------------------------------------------------------------------------------

// The words each condition starts with, and what it's called inside: hurt, badly hurt, ill, can walk (and can't walk,
// which is not can walk), laid up, dead.
const ASKS = { hurt: [[], "hurt"], badly: [["hurt"], "badly hurt"], ill: [[], "ill"], can: [["walk"], "can walk"], "can't": [["walk"], "can walk", true], cannot: [["walk"], "can walk", true], laid: [["up"], "laid up"], dead: [[], "dead"] };
export const HEALTH_ASKS = Object.keys(ASKS);
// "? can walk tarrow", "? not laid up any", "? badly hurt {ringleader}": what the scene's reader puts in the term, or a
// problem in words.
export function readHealthAsk(first, rest) {
  const [words, id, flip] = ASKS[first];
  const has = rest.slice(0, words.length).map((one) => one.toLowerCase());
  if (words.some((word, i) => has[i] !== word)) return { problem: `"${first}" is followed by ${words.join(" ")}: ${first} ${words.join(" ")} someone` };
  const who = rest.slice(words.length).join(" ");
  if (!who) return { problem: `"${id}" is followed by someone, by their id or name, or you${id === "can walk" ? "" : ", or any"}` };
  if (/^any$/i.test(who) && id === "can walk") return { problem: `"can walk" needs someone: can walk any doesn't say who` };
  if (!/^any$/i.test(who) && !known(who)) return { problem: `there's nobody called ${who} the game knows, for "${id}": write their id or name, a crowd name, or you` };
  return { id, who, flip: Boolean(flip) };
}
// Everyone whose body the game has kept, and the player: who "any" can be.
const keptKeys = (game) => [YOU, ...Object.keys(game.bodies ?? {})];
const lyingOf = (game, key) => {
  const d = game.down?.[key];
  return d && !d.dead ? d : null;
};
function asks(game, id, key) {
  if (!key) return false;
  const dead = Boolean(deathOf(game, key)) || (key.startsWith("id:") && game.contacts?.some((one) => one.status === "dead" && plain(one.name) === plain(WORLD_CHARACTERS[key.slice(3)]?.name)));
  if (id === "dead") return dead;
  if (dead) return false;
  const wounds = woundsNow(game, key);
  switch (id) {
    case "hurt": return wounds.some((wound) => !isIllness(wound));
    case "badly hurt": return wounds.some((wound) => !isIllness(wound) && woundRules(wound).serious);
    case "ill": return wounds.some(isIllness);
    case "laid up": {
      const d = lyingOf(game, key);
      return Boolean(d?.bed) && !d.going;
    }
    case "can walk": {
      // On their feet, or able to be: not out cold, with a leg to stand on and the blood to stand, and not still lying
      // where a beating left them. Someone resting on a cot who could get up can walk.
      if (cantGetUp(game, key)) return false;
      const d = lyingOf(game, key);
      return !(d && !d.going && !d.bed && nowOf(game) < (d.until ?? 0));
    }
    default: return false;
  }
}
// Whether a scene's health condition holds: the player's or someone's own, or anyone's.
export function healthHolds(game, term) {
  if (/^any$/i.test(term.who)) {
    if (term.id === "laid up") return Object.keys(game.down ?? {}).some((key) => asks(game, "laid up", key));
    if (term.id === "dead") return Object.keys(game.dead ?? {}).length > 0;
    return keptKeys(game).some((key) => asks(game, term.id, key));
  }
  return asks(game, term.id, bodyKeyOf(term.who));
}

// ---- Doing ----------------------------------------------------------------------------------------------

// "* wound tarrow deep cut on the left arm: reason", "* heal tarrow: reason", "* heal mess hand bao fever: reason",
// "* dies tarrow: of her wounds, before anyone came". What the scene's reader keeps, or a problem in words.
export const HEALTH_EFFECTS = ["wound", "heal", "dies"];
const kindsNamed = (words) => woundKindsByName(words);
// Someone, then a wound's name (or nothing, where allowed): the first split where the first words are someone.
function personThenWound(words, needWound) {
  for (let i = 1; i <= words.length; i += 1) {
    const who = words.slice(0, i).join(" ");
    const wound = words.slice(i).join(" ");
    if (!known(who)) continue;
    if (!wound && !needWound) return { who, wound: null };
    if (wound && kindsNamed(wound).length) return { who, wound };
  }
  return null;
}
export function readHealthEffect(verb, words, after) {
  const names = woundNames().join(", ");
  if (verb === "dies") {
    const who = words.join(" ");
    if (/^you$/i.test(who)) return { problem: "you can't die, for now: the game keeps the player alive" };
    if (!who || !known(who)) return { problem: `there's nobody called ${who || "nothing"} the game knows, to die` };
    return after ? { do: { command: "dies", who, reason: after } } : { problem: "dies needs a colon and how it happened after it, the way the names will say it: * dies tarrow: of her wounds, before anyone came" };
  }
  if (verb === "heal") {
    const found = personThenWound(words, false);
    if (!found) return { problem: `heal is written * heal someone: reason, or * heal someone a_wound: reason, with someone the game knows and a wound from the wounds file (${names})` };
    return after ? { do: { command: "heal", who: found.who, wound: found.wound, reason: after } } : { problem: "heal needs a colon and the reason after it" };
  }
  // A wound, on a part if it says: the last "on" starts where.
  const on = words.map((one) => one.toLowerCase()).lastIndexOf("on");
  const head = on > 0 ? words.slice(0, on) : words;
  const where = on > 0 ? words.slice(on + 1).join(" ") : null;
  const found = personThenWound(head, true);
  if (!found) return { problem: `wound is written * wound someone a_wound: reason, or * wound someone a_wound on a part: reason, with someone the game knows and a wound from the wounds file (${names})` };
  const kinds = kindsNamed(found.wound);
  if (where !== null) {
    const read = readWhere(where);
    if (read.problem) return { problem: `wound's part: ${read.problem}` };
    if (!kinds.some((kind) => kind.parts.some((part) => read.parts.includes(part)))) return { problem: `${found.wound} can't be on ${where}: the wounds file has it on ${[...new Set(kinds.flatMap((kind) => kind.parts))].map((part) => PART_WORDS[part]).join(", ")}` };
  }
  return after ? { do: { command: "wound", who: found.who, wound: found.wound, where, reason: after } } : { problem: "wound needs a colon and the reason after it" };
}

// The scene's effect, played: lines for the story. The facts it leaves are on the record.
export function storyHealth(game, step) {
  const key = bodyKeyOf(step.who);
  if (!key) throw new Error(`there's nobody called ${step.who} the game knows`);
  const name = nameOfKey(game, key);
  const now = nowOf(game);
  const day = Math.floor(now / 24) + 1;
  const from = game.scene?.id ?? "the story";
  const note = (id, text) => {
    try {
      recordFact(game, { id, text, from });
    } catch {
      // The record is full: what happened, happened.
    }
  };
  if (step.command === "dies") {
    if (key === YOU) throw new Error("the player can't die, for now");
    // They fall where they stand, so they lie under a blanket there until they're carried to where the dead are laid
    // out, like anyone who dies; at another place with a medbay, unseen.
    const { who, place } = personOf(step.who);
    if (place && !game.down?.[key]) {
      const state = place === game.location ? game.life?.places?.[place]?.[who] : null;
      if (state) fallDown(game, { who, place, level: state.level, x: state.x, y: state.y, why: "dead" });
      else if (medbayOf(place)?.room) fallDown(game, { who, place, level: null, x: 0, y: 0, why: "dead" });
    }
    return die(game, key, { at: now, cause: "story", words: step.reason, from });
  }
  if (step.command === "wound") {
    const parts = step.where ? readWhere(step.where).parts ?? null : null;
    const fits = kindsNamed(step.wound).flatMap((kind) => kind.parts.filter((part) => !parts || parts.includes(part)).map((part) => [kind, part]));
    if (!fits.length) throw new Error(`${step.wound} can't be on ${step.where}`);
    // Which arm, which part, by the game's own seed: the same in a replay of the same game.
    const roll = seeded(`${game.bodySeed ?? 1}|${key}|story|${now}|${step.wound}`);
    const [kind, part] = fits[Math.floor(roll() * fits.length)];
    const wound = newWound(kind, part, roll);
    addWounds(game, key, [wound]);
    note(factNameOf(key, "wounded"), `${name} was wounded on day ${day}: ${wound.words}.`);
    return [`[HEALTH] ${key === YOU ? "You" : name}, ${wound.words}: ${step.reason}`];
  }
  // Healed: the wounds gone, or the one kind, and the blood back. A lost limb stays lost, its stump seen to.
  const want = step.wound ? new Set(kindsNamed(step.wound).map((kind) => kind.id)) : null;
  const store = key === YOU ? game.wounds ?? [] : game.bodies?.[key]?.wounds ?? [];
  const keep = [];
  for (const wound of store) {
    if (want && !want.has(wound.kind)) keep.push(wound);
    else if (wound.kind === "lost") keep.push({ ...wound, dressed: true, dressedAt: wound.dressedAt ?? now, infected: false });
  }
  if (key === YOU) {
    game.wounds = keep;
    if (!want) delete game.blood;
  } else if (game.bodies?.[key]) {
    game.bodies[key] = { ...game.bodies[key], wounds: keep };
    if (!want) delete game.bodies[key].blood;
  }
  // Whoever was lying down from a beating can get up now, and the register forgets the illness they had.
  if (game.down?.[key] && !game.down[key].dead) game.down[key] = { ...game.down[key], until: now };
  if (game.register?.crew?.[key]) {
    if (want) for (const id of want) delete game.register.crew[key][id];
    else delete game.register.crew[key];
  }
  note(factNameOf(key, "healed"), `${name} was healed on day ${day}${want ? ` of ${step.wound}` : ""}.`);
  return [`[HEALTH] ${key === YOU ? "You're" : `${name} is`} ${want ? `over the ${step.wound}` : "well again"}: ${step.reason}`];
}
