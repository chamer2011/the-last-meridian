// The world's story material, kept in files: story threads, what's going on at each place, and the
// main story's clues. The player sees the leads and rumors at wherever they are in a menu.

import { LOCATIONS } from "./data.js";
import { worldRumors } from "./daily.js";
import { hasMovedOn, leadNow, movedView, ranItsCourse } from "./story-clock.js";
import { isCaptain } from "./role.js";
import { writtenThreadIds } from "./scene-files.js";
import { parseCondition } from "./scene-text.js";
import { SET_ASIDE, WORLD_ARC, WORLD_THREADS, endingsOf } from "./world.js";

const LEADS_SHOWN = 4;
const RUMORS_SHOWN = 3;
// What's going around at a place changes this often, in days.
const NEWS_CYCLE = 2;

export const emptyStory = () => ({ threads: {}, used: [], clues: [], act: 1, lastNews: null });

export function storyOf(game) {
  game.story ??= emptyStory();
  game.story.threads ??= {};
  game.story.used ??= [];
  game.story.clues ??= [];
  game.story.act ??= 1;
  return game.story;
}

const dayOf = (game) => Math.floor(game.clock.hours / 24);

function seededShuffle(list, text) {
  let seed = 0;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// What's going around at this place right now. It stays the same for a couple of days, then moves on.
const cycleSeed = (game, kind) => `${game.name}|${game.location}|${kind}|${Math.floor(dayOf(game) / NEWS_CYCLE)}`;

// A story written for "the fleet" happens aboard the Meridian now.
function fitsHere(thread, game) {
  return (thread.places ?? []).some((id) => id === "any" || id === game.location || (id === "fleet" && game.location === "meridian"));
}

function threadOpen(id, thread, game) {
  const { threads } = storyOf(game);
  if (threads[id]) return false;
  // A story set aside in world/stories/_set-aside.txt stays in its file, and out of the game.
  if (SET_ASIDE.has(id)) return false;
  // A story with nothing written for anyone else is the captain's own business, and it goes on over everyone's head.
  if (!isCaptain(game) && !thread.anyone) return false;
  if ((thread.minLevel ?? 1) > game.level) return false;
  if (thread.after && threads[thread.after] !== "done" && !ranItsCourse(game, thread.after)) return false;
  return fitsHere(thread, game);
}

// A few of the stories that could start here, with a mix of kinds. Main story threads come first, and the
// stories that have been written out come before all of those.
export function leadsHere(game) {
  const open = Object.entries(WORLD_THREADS).filter(([id, thread]) => threadOpen(id, thread, game));
  const shuffled = seededShuffle(open, cycleSeed(game, "leads"));
  shuffled.sort(([, a], [, b]) => Number(b.kind === "main") - Number(a.kind === "main"));
  const written = writtenThreadIds();
  shuffled.sort(([a], [b]) => Number(written.has(b)) - Number(written.has(a)));
  const chosen = [];
  const kinds = new Set();
  for (const entry of shuffled) {
    if (chosen.length >= LEADS_SHOWN) break;
    // One of each kind, except that a story that's written out is never left off for its kind.
    if (kinds.has(entry[1].kind) && !written.has(entry[0])) continue;
    chosen.push(entry);
    kinds.add(entry[1].kind);
  }
  for (const entry of shuffled) {
    if (chosen.length >= LEADS_SHOWN) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }
  return chosen.map(([id, thread]) => ({ id, title: thread.title, kind: thread.kind, lead: leadNow(game, id), moved: hasMovedOn(game, id), written: written.has(id) }));
}

export function rumorsHere(game) {
  return [...worldRumors(game), ...seededShuffle(LOCATIONS[game.location]?.rumors ?? [], cycleSeed(game, "rumors"))].slice(0, RUMORS_SHOWN);
}

// What one person has heard. Everyone repeats something different, and nobody gossips about themselves.
export function rumorsFrom(game, person, names = []) {
  const about = names.flatMap((name) => String(name).split(/\s+/)).filter((word) => word.length > 2).map((word) => word.toLowerCase());
  const fresh = (LOCATIONS[game.location]?.rumors ?? []).filter((rumor) => {
    const words = rumor.toLowerCase().split(/[^\p{L}\p{N}']+/u);
    return !about.some((word) => words.includes(word));
  });
  return [...worldRumors(game), ...seededShuffle(fresh, cycleSeed(game, `rumors:${person}`))].slice(0, RUMORS_SHOWN);
}

// What the Leads menu shows. Nothing here gives away a thread's notes.
export function storyView(game) {
  const { threads } = storyOf(game);
  const followed = (status) => Object.entries(threads)
    .filter(([id, value]) => value === status && WORLD_THREADS[id])
    .map(([id]) => ({ id, title: WORLD_THREADS[id].title, kind: WORLD_THREADS[id].kind, lead: leadNow(game, id) }));
  return { here: leadsHere(game), rumors: rumorsHere(game), active: followed("active"), done: followed("done"), moved: movedView(game) };
}

const list = (label, items) => (items?.length ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : null);
// What's wrong in the stories' notes, world/stories, in plain words: an ending without a name, a fact without a
// line, a reaction the game can't read, or one that waits on a fact nothing leaves. With the set of facts
// something leaves, that last check runs too.
const NOTE_NAME = /^[a-z][a-z0-9_]{1,39}$/;
export function notesProblems(known = null) {
  const problems = [];
  for (const [id, thread] of Object.entries(WORLD_THREADS)) {
    const seen = new Set();
    for (const [i, outcome] of (thread.gm?.outcomes ?? []).entries()) {
      const where = `${id}, outcome ${i + 1}`;
      if (typeof outcome === "string") problems.push(`${where} needs a name: write it as its_name: what's true if the story ends this way`);
      else if (!NOTE_NAME.test(outcome?.id ?? "")) problems.push(`${where}: an ending's name is lowercase letters, digits and underscores, like sign_with_quill`);
      else if (seen.has(outcome.id)) problems.push(`${where}: two endings are called ${outcome.id}`);
      else if (typeof outcome.text !== "string" || !outcome.text.trim()) problems.push(`${where} (${outcome.id}) has no text`);
      if (outcome?.id) seen.add(outcome.id);
    }
    for (const [name, text] of Object.entries(thread.gm?.facts ?? {})) {
      if (!NOTE_NAME.test(name)) problems.push(`${id}, facts: a fact's name is lowercase letters, digits and underscores, not ${name}`);
      if (typeof text !== "string" || !text.trim()) problems.push(`${id}, facts: ${name} needs a line of plain words`);
    }
    for (const [i, one] of (thread.gm?.reacts ?? []).entries()) {
      const where = `${id}, reacts ${i + 1}`;
      if (!one || typeof one.to !== "string" || typeof one.then !== "string" || !one.then.trim()) {
        problems.push(`${where} is written ? a condition, as in a scene -> what changes in this story`);
        continue;
      }
      const { terms, problems: wrong } = parseCondition(one.to);
      for (const problem of wrong) problems.push(`${where}: ${problem}`);
      for (const term of terms) {
        if (["seen", "chance"].includes(term.kind)) problems.push(`${where}: a story can't react to "${term.kind}", only to the record and the game`);
        if (term.kind === "flag" && known && !known.has(term.id)) problems.push(`${where}: nothing leaves the fact ${term.id}. Set it with * flag in a scene, or name it in a story's facts`);
      }
    }
    for (const [name, ending] of Object.entries(thread.gm?.factAfter ?? {})) {
      if (!(name in (thread.gm?.facts ?? {}))) problems.push(`${id}, facts: ${name} is said to come after ${ending}, but isn't one of its facts`);
      if (!endingsOf(thread).some((one) => one.id === ending)) problems.push(`${id}, facts: ${name} comes after ${ending}, and ${id} has no ending called that`);
    }
  }
  return problems;
}

export function noteThreadStarted(game, id) {
  if (!WORLD_THREADS[id]) return;
  const { threads } = storyOf(game);
  threads[id] ??= "active";
}

export function noteThreadEnded(game, id) {
  if (WORLD_THREADS[id]) storyOf(game).threads[id] = "done";
}

export function updateStory(game, { clue, act }) {
  const story = storyOf(game);
  const said = [];
  if (clue) {
    if (!(WORLD_ARC.clues ?? []).some((entry) => entry.id === clue)) throw new Error(`There's no clue called ${clue}.`);
    if (!story.clues.includes(clue)) story.clues.push(clue);
    said.push(`Clue noted: ${clue}.`);
  }
  if (act !== undefined && act !== null) {
    const total = (WORLD_ARC.acts ?? []).length;
    if (act < 1 || act > total) throw new Error(`The acts run from 1 to ${total}.`);
    story.act = act;
    if (story.clock) story.clock.act = null;
    said.push(`The main story is now in act ${act}.`);
  }
  if (!said.length) throw new Error("Give a clue or an act.");
  return said.join("\n");
}
