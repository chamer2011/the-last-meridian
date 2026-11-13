// The player's rig: the pocket computer in their pack that carries programs onto computers (step 2 of the hacking
// rework). It's built from parts (step 4): a casing round a board, the board's sockets each holding a part, all world
// files read by src/rig-parts.js, which says what a build adds up to: its memory, power, speed, quiet and heat. The
// programs are world files too (src/programs.js); what each one does when it runs is here. At a computer's logon the
// breakers get the player in, if they and the rig are strong enough for its class (step 3); inside, the watcher hears
// each program's noise, and what the computer runs (doors, cameras, power) is switched through the systems. Writing a
// program takes hours at the Repair Bay's bench, and Hacking decides which ones the player can write; one they have,
// however they came by it, runs whatever their skill. Some can be copied off the computers that hold them. The bench
// also mends parts with the ship's parts crates, tunes the core with the player's Engineering, rebuilds broken parts
// from scrap once it has a micro lathe, takes parts apart for scrap, and makes a few from scrap and other things, some
// with a tool bought for it (step 5). Parts come from the Graveyard's wrecks (src/wrecks.js), the ports' dealers
// (src/dealers.js), and now and then the ship's own things and finds (src/ship-parts.js), all through giveRigPart.
//
// game.rig: { programs: [ids the rig has], loaded: [ids in its memory], timers: [what's been left behind, and when],
// parts: [{ uid, id, cond: new|worn|broken, tune: over|under|null, from }], build: { board: uid, casing: uid,
// fit: { socket: uid } }, nextUid, tools: [the bench's tools, by id], found: { find: true } }.
import { addClockWork } from "./room-hooks.js";
import { PROGRAM_KINDS, programById, programsNow } from "./programs.js";
import { BENCH_RULES, CONDITIONS, HEAT, PART_KINDS, REACHES, benchToolById, benchToolsNow, heatWords, partNumbers, rigPartById, rigPartsNow, rigStats, sessionHeat } from "./rig-parts.js";
import { dealCommand, dealerName, dealerView } from "./dealers.js";
import { reachWhy } from "./devices.js";
import { ITEMS } from "./data.js";
import { classKeys, gotIn, line, watchFor, watcherOf } from "./computers.js";
import { controlSystem, controlsView, damagePart, systemsOf } from "./systems.js";
import { countAboard, takeAboard } from "./logistics.js";
import { addItem, passTime, removeItem, skillRank } from "./rules.js";
import { roomHere } from "./walk.js";
import { WORLD_COMPUTERS } from "./world.js";

export const BENCH = { place: "meridian", room: "repair", name: "the Repair Bay's bench" };
export const STARTING_PROGRAMS = ["dictionary", "doorkey", "mask"];
// The plain yard build every rig starts as: what goes in each of the yard board's sockets.
export const STARTING_BUILD = { board: "yard", casing: "plain_case", fit: { core1: "stock_core", sink1: "fin_sink", memory1: "memory_2", link1: "cable_jack", cell1: "standard_cell", memory2: "memory_2" } };

// A part come by: its own id on the rig, its condition, and where it came from.
function addPart(rig, id, { cond = "new", from = null } = {}) {
  rig.nextUid = (rig.nextUid ?? 0) + 1;
  const item = { uid: `p${rig.nextUid}`, id, cond, tune: null, from: from ?? rigPartById(id)?.from ?? "" };
  rig.parts.push(item);
  return item;
}
// A part come by from a wreck, a dealer, the ship or a find: it goes with the rig's spare parts.
export function giveRigPart(game, id, { cond = "new", from = null } = {}) {
  if (!game.rig || !rigPartById(id)) return null;
  return addPart(game.rig, id, { cond, from });
}
// The bench's tools: what's been bought for it.
export const hasTool = (game, id) => (game.rig?.tools ?? []).includes(id);
export const toolName = (id) => benchToolById(id)?.name ?? String(id ?? "").replace(/_/g, " ");

// The yard build, put into a rig that has no parts yet.
export function giveStartingBuild(rig) {
  rig.parts = [];
  rig.build = { board: null, casing: null, fit: {} };
  const from = "Came with the rig.";
  rig.build.board = addPart(rig, STARTING_BUILD.board, { from }).uid;
  rig.build.casing = addPart(rig, STARTING_BUILD.casing, { from }).uid;
  for (const [socket, id] of Object.entries(STARTING_BUILD.fit)) rig.build.fit[socket] = addPart(rig, id, { from }).uid;
  return rig;
}

export function newRig() {
  const rig = giveStartingBuild({ programs: [], loaded: [], timers: [] });
  const all = programsNow().list;
  rig.programs = [...new Set([...all.filter((p) => p.everyRig || p.builtIn).map((p) => p.id), ...STARTING_PROGRAMS.filter((id) => programById(id))])];
  const memory = rigStats(rig).memory;
  let used = 0;
  for (const id of STARTING_PROGRAMS) {
    const p = programById(id);
    if (!p || p.builtIn || used + p.size > memory) continue;
    rig.loaded.push(id);
    used += p.size;
  }
  return rig;
}

const usedMemory = (rig) => rig.loaded.reduce((n, id) => n + (programById(id)?.size ?? 0), 0);
const hackingOf = (game) => skillRank(game, "hacking");
const engineeringOf = (game) => skillRank(game, "engineering");
const atBench = (game) => game.location === BENCH.place && roomHere(game)?.id === BENCH.room;
// What the rig's build adds up to now.
export const rigNow = (game) => rigStats(game.rig, hackingOf(game));
const memoryOf = (game) => rigNow(game).memory;
// A build that's lost memory (a part out, worn or broken) unloads what no longer fits, the last loaded first.
function trimLoaded(game) {
  const rig = game.rig;
  const memory = memoryOf(game);
  const off = [];
  while (rig.loaded.length && usedMemory(rig) > memory) off.push(programById(rig.loaded.pop())?.name ?? "a program");
  return off.length ? ` ${off.join(" and ")} ${off.length === 1 ? "comes" : "come"} off the rig's memory: there's no room for ${off.length === 1 ? "it" : "them"} now.` : "";
}
const classNumber = (classKey) => Math.max(1, classKeys().indexOf(classKey) + 1);
const computerName = (id) => WORLD_COMPUTERS[id]?.name ?? id;

// Why the player can't write this program now, or null if they can.
function cantWrite(game, p) {
  if (game.rig.programs.includes(p.id)) return "you have it";
  if (!p.hours) return p.foundOn?.length ? `only copied, off ${p.foundOn.map(computerName).join(" or ")}` : p.soldAt ? `only bought, at ${dealerName(p.soldAt) ?? "a port"}` : "it can't be written";
  if (hackingOf(game) < p.hacking) return `needs Hacking ${p.hacking}`;
  if (!atBench(game)) return `written at ${BENCH.name}`;
  if (game.computer || game.combat || game.check) return "not now";
  return null;
}

// ---- The build -----------------------------------------------------------------------------------------------------

export const partOf = (rig, uid) => rig.parts.find((item) => item.uid === uid) ?? null;
const fittedIn = (rig, uid) => Object.entries(rig.build.fit).find(([, one]) => one === uid)?.[0] ?? null;
export const inUse = (rig, uid) => uid === rig.build.board || uid === rig.build.casing || Boolean(fittedIn(rig, uid));
export const partName = (item) => rigPartById(item?.id)?.name ?? item?.id ?? "a part";
const lower = (item) => partName(item).toLowerCase();
const hoursWords = (n) => `${n} ${n === 1 ? "hour" : "hours"}`;
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const cratesAboard = (game) => countAboard(game, BENCH.place, "parts_crate")?.n ?? 0;

// What goes into a recipe, as the bench has it: a parts crate comes from the ship's stores, anything else from the pack.
const haveFor = (game, need) => (need.id === "parts_crate" ? cratesAboard(game) : game.inventory?.[need.id] ?? 0);
const itemWords = (id, n) => {
  const name = (ITEMS[id]?.name ?? id.replace(/_/g, " ")).toLowerCase();
  if (id === "scrap") return `${n} scrap`;
  return n === 1 ? `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}` : `${n} ${name}s`;
};
export const needWords = (need) => itemWords(need.id, need.n);
const recipeWords = (made) => [made.needs.map(needWords).join(" and "), hoursWords(made.hours), made.tool && `with the ${toolName(made.tool).toLowerCase()}`].filter(Boolean).join(", ");
// Why a part can't be made now, or null.
function makeWhy(game, p) {
  const bench = benchWhy(game);
  if (bench) return bench;
  if (p.made.tool && !hasTool(game, p.made.tool)) return `needs a ${toolName(p.made.tool).toLowerCase()} on the bench`;
  if (engineeringOf(game) < p.made.engineering) return `needs Engineering ${p.made.engineering}`;
  for (const need of p.made.needs) {
    if (haveFor(game, need) < need.n) return need.id === "parts_crate" ? `needs ${needWords(need)} in the ship's stores` : `needs ${needWords(need)}`;
  }
  return null;
}

// Why a bench job can't be done now, or null: it's done standing at the Repair Bay's bench, and not in the middle of
// anything else.
function benchWhy(game) {
  if (!atBench(game)) return `at ${BENCH.name}`;
  if (game.computer || game.combat || game.check || game.talk) return "not now";
  return null;
}

// What can be done to one part, and why not: each { action, label, why }.
function partActions(game, item) {
  const rig = game.rig;
  const p = rigPartById(item.id);
  if (!p) return [];
  const out = [];
  const bench = benchWhy(game);
  const busy = game.computer ? "log off the computer first" : game.combat ? "finish the fight first" : null;
  if (p.kind === "board" && item.uid !== rig.build.board) out.push({ action: "board", label: "Use this board", why: busy ?? (item.cond === "broken" ? "it's broken" : null) });
  else if (p.kind === "casing" && item.uid !== rig.build.casing) out.push({ action: "casing", label: "Use this casing", why: busy });
  else if (fittedIn(rig, item.uid)) out.push({ action: "remove", label: "Take it out", why: busy });
  if (item.cond !== "new") {
    const crates = cratesAboard(game);
    out.push({ action: "mend", label: `Mend it: a parts crate, ${hoursWords(p.grade)}`, why: bench ?? (engineeringOf(game) < p.grade ? `needs Engineering ${p.grade}` : crates < 1 ? "there's no parts crate aboard" : null) });
  }
  if (item.cond === "broken") {
    const lathe = BENCH_RULES.lathe.tool;
    out.push({ action: "rebuild", label: `Rebuild it on the lathe: ${BENCH_RULES.lathe.scrap} scrap, ${hoursWords(BENCH_RULES.lathe.hours)}`, why: bench ?? (lathe && !hasTool(game, lathe) ? `needs a ${toolName(lathe).toLowerCase()} on the bench` : (game.inventory?.scrap ?? 0) < BENCH_RULES.lathe.scrap ? `needs ${BENCH_RULES.lathe.scrap} scrap` : null) });
  }
  if (p.kind === "core" && item.cond !== "broken") {
    for (const [how, tune] of Object.entries(BENCH_RULES.tunes)) {
      if (item.tune === how) continue;
      out.push({ action: "tune", how, label: `${how === "over" ? "Overclock" : "Undervolt"} it: ${hoursWords(tune.hours)}`, why: bench ?? (engineeringOf(game) < tune.engineering ? `needs Engineering ${tune.engineering}` : null) });
    }
    if (item.tune) out.push({ action: "tune", how: "none", label: `Put it back as it was: ${hoursWords(BENCH_RULES.untune.hours)}`, why: bench });
  }
  if (!inUse(rig, item.uid)) {
    const scrap = BENCH_RULES.apart.scrap[p.kind === "board" || p.kind === "casing" ? p.kind : "part"];
    out.push({ action: "apart", label: `Take it apart for ${scrap} scrap: ${hoursWords(BENCH_RULES.apart.hours)}`, why: bench });
  }
  return out;
}

// What one part does, in a line of words.
function factsOf(item) {
  const p = rigPartById(item.id);
  if (!p) return "";
  if (p.kind === "board") return [`${p.sockets.length} sockets`, p.power && `power ${sign(p.power)}`, p.quiet && `quiet ${sign(p.quiet)}`, p.heat && `heat ${p.heat}`].filter(Boolean).join(" · ");
  if (p.kind === "casing") return [`cooling ${p.cooling}`, p.quiet && `quiet ${sign(p.quiet)}`, p.speed && `speed ${sign(p.speed)}`].filter(Boolean).join(" · ");
  const n = partNumbers(item);
  if (!n.works) return "broken: it does nothing";
  return [p.reaches && `reaches a computer ${REACHES[p.reaches]}`, n.fx.memory && `${n.fx.memory} ${n.fx.memory === 1 ? "block" : "blocks"}`, n.fx.power && `power ${sign(n.fx.power)}`, n.fx.speed && `speed ${sign(n.fx.speed)}`, n.fx.quiet && `quiet ${sign(n.fx.quiet)}`, n.fx.echo && `CLEANER ${sign(n.fx.echo)}`, n.cools && `cools ${n.cools} beside it`, `heat ${n.heat}`].filter(Boolean).join(" · ");
}

const partView = (game, item) => {
  const p = rigPartById(item.id);
  return { uid: item.uid, id: item.id, name: partName(item), kind: p?.kind ?? null, kindName: PART_KINDS[p?.kind] ?? "Part", cond: item.cond, tune: item.tune ? BENCH_RULES.tunes[item.tune]?.name ?? null : null, grade: p?.grade ?? 1, weight: p?.weight ?? 0, facts: factsOf(item), what: p?.what ?? "", from: item.from || p?.from || "", socket: fittedIn(game.rig, item.uid), actions: partActions(game, item) };
};

// The build for the Rig page: the board's sockets with what's in them, the casing, the spare parts, the totals, what
// the bench can make, and every part there is.
function buildView(game) {
  const rig = game.rig;
  const stats = rigNow(game);
  const byUid = Object.fromEntries(rig.parts.map((item) => [item.uid, item]));
  const bench = benchWhy(game);
  const scrap = game.inventory?.scrap ?? 0;
  return {
    board: byUid[rig.build.board] ? partView(game, byUid[rig.build.board]) : null,
    casing: byUid[rig.build.casing] ? partView(game, byUid[rig.build.casing]) : null,
    sockets: stats.sockets.map((s) => ({ ...s, kindName: PART_KINDS[s.kind], part: s.uid ? partView(game, byUid[s.uid]) : null })),
    stats: { memory: stats.memory, power: stats.power, speed: stats.speed, quiet: stats.quiet, heat: stats.heat, heatWords: heatWords(stats.heat), weight: stats.weight, dead: stats.dead, fanAfter: Math.max(0, (HEAT.fan - stats.heat) * HEAT.minutesAPoint), hotAfter: Math.max(0, (HEAT.overheating - stats.heat) * HEAT.minutesAPoint) },
    box: rig.parts.filter((item) => !inUse(rig, item.uid)).map((item) => partView(game, item)),
    scrap,
    crates: cratesAboard(game),
    engineering: engineeringOf(game),
    makes: rigPartsNow().list.filter((p) => p.made).map((p) => ({ id: p.id, name: p.name, kindName: PART_KINDS[p.kind], what: p.what, label: `Make ${/^[aeiou]/i.test(p.name) ? "an" : "a"} ${p.name.toLowerCase()}: ${recipeWords(p.made)}`, why: makeWhy(game, p) })),
    // The bench's tools, bought or not, and what each is for.
    tools: benchToolsNow().list.map((tool) => ({ id: tool.id, name: tool.name, what: tool.what, owned: hasTool(game, tool.id) })),
    every: rigPartsNow().list.map((p) => ({ id: p.id, name: p.name, kind: p.kind, kindName: PART_KINDS[p.kind], grade: p.grade, from: p.from, what: p.what, facts: factsOf({ id: p.id, cond: "new" }) })),
    kinds: PART_KINDS,
  };
}

// What the page shows: memory, what's loaded, what the rig has, every program there is, and the build.
export function rigView(game) {
  const rig = game.rig;
  if (!rig) return null;
  const hacking = hackingOf(game);
  return {
    memory: memoryOf(game),
    used: usedMemory(rig),
    build: buildView(game),
    hacking,
    atBench: atBench(game),
    bench: BENCH.name,
    // A dealer in parts where the player is, with what they sell and what they'd pay (src/dealers.js).
    dealer: dealerView(game),
    kinds: PROGRAM_KINDS,
    loaded: rig.loaded,
    left: rig.timers.map((t) => t.words),
    programs: programsNow().list.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, hacking: p.hacking, size: p.size, power: p.power ?? null, noise: p.noise, noticed: p.noise > 0, once: Boolean(p.once), builtIn: Boolean(p.builtIn), what: p.what,
      hours: p.hours ?? null, foundOn: (p.foundOn ?? []).map(computerName), soldAt: p.soldAt ? dealerName(p.soldAt) ?? p.soldAt : null,
      owned: rig.programs.includes(p.id), loaded: p.builtIn || rig.loaded.includes(p.id), tooHard: Boolean(p.hours) && hacking < p.hacking,
      write: cantWrite(game, p),
    })),
  };
}

// Loading, unloading and writing programs, and changing the build and working on it at the bench, outside any computer
// (/api/rig). Returns { said, notes }.
export function rigCommand(game, body) {
  const rig = game.rig;
  if (!rig) throw new Error("You don't have a rig.");
  // What's loaded and fitted is decided in the room, before sitting down: at a computer the rig runs what it brought.
  if (game.computer) throw new Error("Log off the computer first: the rig's programs are loaded before you sit down.");
  if (game.combat) throw new Error("Finish the fight first.");
  // Buying and selling at a port's dealer in parts.
  if (String(body.action ?? "").startsWith("deal-")) return dealCommand(game, body);
  if (["write", "mend", "tune", "rebuild", "apart", "make"].includes(body.action) && game.talk) throw new Error("Finish the talk first.");
  if (["fit", "remove", "board", "casing", "mend", "tune", "rebuild", "apart", "make"].includes(body.action)) return buildCommand(game, body);
  const p = programById(body.id);
  if (!p) throw new Error("There's no such program.");
  const memory = memoryOf(game);
  if (body.action === "load") {
    if (p.builtIn || rig.loaded.includes(p.id)) return { said: `${p.name} is already loaded.` };
    if (!rig.programs.includes(p.id)) throw new Error(`Your rig doesn't have ${p.name}.`);
    if (usedMemory(rig) + p.size > memory) throw new Error(`${p.name} needs ${p.size} ${p.size === 1 ? "block" : "blocks"}, and your rig has ${Math.max(0, memory - usedMemory(rig))} free.`);
    rig.loaded.push(p.id);
    return { said: `${p.name} is loaded.` };
  }
  if (body.action === "unload") {
    rig.loaded = rig.loaded.filter((id) => id !== p.id);
    return { said: `${p.name} is off the rig's memory, but the rig still has it.` };
  }
  if (body.action === "write") {
    const why = cantWrite(game, p);
    if (why) throw new Error(`You can't write ${p.name}: ${why}.`);
    const notes = passTime(game, p.hours) ?? [];
    rig.programs.push(p.id);
    const fits = usedMemory(rig) + p.size <= memory;
    if (fits) rig.loaded.push(p.id);
    return { said: `${p.hours} ${p.hours === 1 ? "hour" : "hours"} at the bench, and ${p.name} is written${fits ? " and loaded" : "; there's no room to load it until something comes off"}.`, notes: Array.isArray(notes) ? notes : [] };
  }
  throw new Error("Unknown order.");
}

// Hours at the bench, with the clock running.
const atTheBench = (game, hours) => {
  const notes = passTime(game, hours) ?? [];
  return Array.isArray(notes) ? notes : [];
};

// Fitting parts, swapping the board or the casing, and the bench's jobs.
function buildCommand(game, body) {
  const rig = game.rig;
  if (body.action === "make") {
    const p = rigPartById(body.id);
    if (!p?.made) throw new Error("That can't be made at the bench.");
    const why = makeWhy(game, p);
    if (why) throw new Error(`You can't make ${p.name.toLowerCase()}: ${why === `at ${BENCH.name}` ? `it's made at ${BENCH.name}` : why === "not now" ? "not now" : `it ${why}`}.`);
    for (const need of p.made.needs) {
      if (need.id === "parts_crate") takeAboard(game, BENCH.place, "parts_crate", need.n);
      else removeItem(game, need.id, need.n);
    }
    const notes = atTheBench(game, p.made.hours);
    const what = p.made.needs.map(needWords).join(" and ");
    addPart(rig, p.id, { from: `Made at the bench, from ${what}.` });
    return { said: `${hoursWords(p.made.hours)} at the bench${p.made.tool ? ` with the ${toolName(p.made.tool).toLowerCase()}` : ""}, and ${what} make ${p.name.toLowerCase()}. It's with your rig's spare parts.`, notes };
  }
  const item = partOf(rig, body.uid);
  if (!item) throw new Error("Your rig has no such part.");
  const p = rigPartById(item.id);
  if (!p) throw new Error("That part's file has gone.");
  const action = partActions(game, item).find((one) => one.action === body.action && (body.action !== "tune" || one.how === body.how));
  if (body.action !== "fit" && !action) throw new Error(`That can't be done to the ${lower(item)}.`);
  if (action?.why) throw new Error(`You can't do that to the ${lower(item)}: ${action.why === `at ${BENCH.name}` ? `it's done at ${BENCH.name}` : action.why}.`);
  switch (body.action) {
    case "fit": {
      const stats = rigNow(game);
      const socket = stats.sockets.find((s) => s.key === body.socket);
      if (!socket) throw new Error("The board has no such socket.");
      if (!socket.open) throw new Error(`That socket opens only from Hacking ${socket.gate}.`);
      if (socket.kind !== p.kind) throw new Error(`A ${PART_KINDS[p.kind]?.toLowerCase() ?? "part"} doesn't go in a ${PART_KINDS[socket.kind].toLowerCase()} socket.`);
      const was = fittedIn(rig, item.uid);
      if (was) delete rig.build.fit[was];
      const out = rig.build.fit[socket.key] ? partOf(rig, rig.build.fit[socket.key]) : null;
      rig.build.fit[socket.key] = item.uid;
      return { said: `The ${lower(item)} goes in.${out ? ` The ${lower(out)} comes out, to the spare parts.` : ""}${trimLoaded(game)}` };
    }
    case "remove": {
      delete rig.build.fit[fittedIn(rig, item.uid)];
      return { said: `The ${lower(item)} comes out, to the spare parts.${trimLoaded(game)}` };
    }
    case "board": {
      // The parts in the old board go into the new one's sockets of their kind, as far as they'll go.
      const fitted = Object.entries(rig.build.fit);
      rig.build.board = item.uid;
      rig.build.fit = {};
      const sockets = p.sockets.filter((s) => s.gate <= hackingOf(game));
      const left = [];
      for (const [, uid] of fitted) {
        const kind = rigPartById(partOf(rig, uid)?.id)?.kind;
        const free = sockets.find((s) => s.kind === kind && !rig.build.fit[s.key]);
        if (free) rig.build.fit[free.key] = uid;
        else left.push(lower(partOf(rig, uid)));
      }
      return { said: `Your rig is on the ${lower(item)} now.${left.length ? ` No room on it for the ${left.join(" and the ")}: ${left.length === 1 ? "it's" : "they're"} with the spare parts.` : ""}${trimLoaded(game)}` };
    }
    case "casing":
      rig.build.casing = item.uid;
      return { said: `Your rig is in the ${lower(item)} now.` };
    case "mend": {
      takeAboard(game, BENCH.place, "parts_crate", 1);
      const notes = atTheBench(game, p.grade);
      item.cond = "new";
      return { said: `${hoursWords(p.grade)} at the bench and a parts crate from the ship's stores, and the ${lower(item)} is as good as new.`, notes };
    }
    case "tune": {
      const notes = atTheBench(game, body.how === "none" ? BENCH_RULES.untune.hours : BENCH_RULES.tunes[body.how].hours);
      item.tune = body.how === "none" ? null : body.how;
      const words = { over: "overclocked: quicker, and it runs hotter", under: "undervolted: slower, and it runs cooler", none: "back as it was" }[body.how];
      return { said: `At the bench, the ${lower(item)} is ${words}.`, notes };
    }
    case "rebuild": {
      removeItem(game, "scrap", BENCH_RULES.lathe.scrap);
      const notes = atTheBench(game, BENCH_RULES.lathe.hours);
      item.cond = "worn";
      return { said: `The lathe rebuilds the ${lower(item)} from ${BENCH_RULES.lathe.scrap} scrap: worn now, but it works.${trimLoaded(game)}`, notes };
    }
    case "apart": {
      const scrap = BENCH_RULES.apart.scrap[p.kind === "board" || p.kind === "casing" ? p.kind : "part"];
      const notes = atTheBench(game, BENCH_RULES.apart.hours);
      rig.parts = rig.parts.filter((one) => one.uid !== item.uid);
      addItem(game, "scrap", scrap);
      return { said: `The ${lower(item)} comes apart into ${scrap} scrap.`, notes };
    }
    default:
      throw new Error("Unknown order.");
  }
}

// How hot the rig is in a session, for the desktop's tray: its build's heat and a point every ten of the session's
// minutes.
export function rigHeat(game, session) {
  const stats = rigNow(game);
  const heat = sessionHeat(stats, session?.minutes ?? 0);
  return { heat, words: heatWords(heat), fan: heat >= HEAT.fan, overheating: heat >= HEAT.overheating, dead: stats.dead };
}

// After a session that ran the rig too hot, the hottest part in it wears a step: new to worn, worn to broken. Returns
// the line that says so, or null.
export function wearHottest(game) {
  const rig = game.rig;
  if (!rig?.parts) return null;
  const stats = rigNow(game);
  const hottest = [...stats.sockets].filter((s) => s.uid && s.works).sort((a, b) => b.heat - a.heat || (a.kind === "core" ? -1 : 1))[0];
  if (!hottest) return null;
  const item = partOf(rig, hottest.uid);
  item.cond = CONDITIONS[Math.min(CONDITIONS.length - 1, CONDITIONS.indexOf(item.cond) + 1)];
  return `[COMPUTER] Your rig ran too hot: the ${lower(item)} is ${item.cond} now.${trimLoaded(game)}`;
}

// ---- Inside a computer -------------------------------------------------------------------------

const doorRows = (game, session, content) => (controlsView(game, session.place, content.controls ?? [], { room: session.roomId }).find((s) => s.id === "doors")?.rows ?? []);
const cameraRows = (game, session, content) => controlsView(game, session.place, content.controls ?? [], { room: session.roomId }).flatMap((s) => s.rows).filter((row) => /^Camera in /.test(row.name));
const partToBreak = (game, session, content) => controlsView(game, session.place, content.controls ?? [], { room: session.roomId }).filter((s) => s.id !== "doors" && s.id !== "alarm").flatMap((s) => s.rows).find((row) => row.works && systemsOf(session.place)?.parts?.[row.id]);
const nextAt = (game, hour) => {
  const now = game.clock?.hours ?? 0;
  let at = Math.floor(now / 24) * 24 + hour;
  if (at <= now) at += 24;
  return at;
};

// Someone's at work with a session open in the ship's working hours, for SHADOW.EXE to ride.
const onShift = (game) => {
  const hour = (((game.clock?.hours ?? 0) % 24) + 24) % 24;
  return hour >= 7 && hour < 21;
};
const TRACE_PROGRAMS = ["mask", "ghost", "cleaner", "forger", "decoy", "lullaby", "blindfold", "cutout"];

// Why this program can't run here, or null.
function cantRun(game, session, content, p) {
  if (!p) return "there's no such program";
  if (!p.builtIn && !game.rig.loaded.includes(p.id)) return "it isn't loaded";
  // A rig without a working core, cell or link runs nothing at all.
  const stats = rigNow(game);
  if (stats.dead) return `your rig won't start: ${stats.dead}`;
  // Its link has to reach this kind of computer at all (step 6), unless it was reached over the network (step 7).
  const reach = session.remote ? null : reachWhy(game, content);
  if (reach) return `your rig can't reach it: ${reach}`;
  if (p.once && session.rigUsed?.includes(p.id)) return "it's already run this session";
  // At the logon only the breakers and Scope run; inside, there's nothing left to break.
  if (session.locked) {
    if (p.id === "scope") return session.scanned ? "it's read the logon already" : null;
    if (p.kind !== "in") return "log on first";
  } else if (p.kind === "in") return "you're already in";
  // A program's power, and the rig's own from its build, against the computer's class.
  if (p.power && p.power + stats.power < classNumber(session.classKey)) return `it's too weak for a ${String(session.className).toLowerCase()}`;
  if (p.id === "mimic" && !game.inventory?.keycard) return "it needs a lifted keycard in your pockets";
  if (p.id === "skeleton" && !session.scanned) return "Scope has to read the logon first";
  if (p.id === "shadow" && !onShift(game)) return "nobody has a session open at this hour";
  if (session.practice && p.kind === "leave") return "in practice nothing's left behind";
  const needsDoors = ["doorkey", "masterkey", "sleeper"].includes(p.id);
  if (needsDoors && !doorRows(game, session, content).length) return "this computer runs no doors";
  if (p.id === "relay" && !cameraRows(game, session, content).some((row) => row.actions.some((a) => a.to === "off"))) return "this computer runs no cameras that are on";
  if (p.id === "saboteur" && !partToBreak(game, session, content)) return "this computer runs nothing to break";
  if (["sniffer", "worm", "mapper"].includes(p.id) && !(content.network ?? []).some((n) => WORLD_COMPUTERS[n.id])) return "this computer reaches nothing";
  if (TRACE_PROGRAMS.includes(p.id) && session.yours) return "nobody watches your own computers";
  if (p.id === "lullaby" && (session.traceLeft === null || session.traceLeft === undefined)) return "nothing's tracing you";
  return null;
}

// What the computer's desktop shows of the rig: the programs loaded on it, any this computer has to copy, and, at a
// logon, the ways in: the breakers loaded and Scope, each with what it costs and why it won't work, if it won't.
export function rigInComputer(game, session, content) {
  if (!game.rig) return null;
  const mine = programsNow().list.filter((p) => p.builtIn || game.rig.loaded.includes(p.id));
  const loaded = mine.map((p) => ({ id: p.id, name: p.name, about: p.what, why: cantRun(game, session, content, p), noise: p.noise ?? 0, minutes: p.minutes ?? 1 }));
  const copies = programsNow().list.filter((p) => (p.foundOn ?? []).includes(session.id) && !game.rig.programs.includes(p.id)).map((p) => ({ id: p.id, name: p.name, about: p.what, why: !session.remote && reachWhy(game, content) ? `your rig can't reach it: ${reachWhy(game, content)}` : null }));
  const ways = session.locked ? mine.filter((p) => p.kind === "in" || p.id === "scope").map((p) => ({ id: p.id, name: p.name, about: p.what, kind: p.kind, power: p.power ?? null, noise: p.noise ?? 0, minutes: p.minutes ?? 1, why: cantRun(game, session, content, p) })) : [];
  return { loaded, copies, ways, memory: memoryOf(game), used: usedMemory(game.rig) };
}

// Who a breaker gets the player in as, and what it says.
function breakIn(p, session) {
  const user = { knock: "service", skeleton: "service", mimic: "keycard" }[p.id] ?? session.user;
  const said = {
    knock: "Nobody ever changed the service account's password. You're in as service.",
    dictionary: `The word list finds ${session.user}'s password. People choose the same words.`,
    skeleton: "The logon's old flaw opens the service account without a password.",
    shadow: `You're riding ${session.user}'s session. Everything you do is in their name, and they might notice.`,
    mimic: "The lifted keycard plays back, and the logon takes it for its owner.",
  }[p.id] ?? `${p.name} gets you past the logon.`;
  return { user, said };
}

// Running one of the rig's programs. helpers: { act(game, session, { noise, minutes }), readEverything(game, session, content) }.
export function runRigProgram(game, session, content, id, helpers) {
  const p = programById(id);
  const why = cantRun(game, session, content, p);
  const show = (lines) => {
    session.screen = { kind: "program", id: `rig:${id}`, title: p?.name ?? id, lines };
  };
  if (why) {
    show([line(p?.what ?? "", "dim"), line(`It won't run: ${why}.`, "warn")]);
    return { over: false };
  }
  session.rigUsed = [...(session.rigUsed ?? []), p.id];
  const cost = { noise: p.noise ?? 0, minutes: p.minutes ?? 1 };
  // At the logon: a breaker's noise comes first, and the player is in only if the watcher hasn't cut them off for it.
  if (session.locked) {
    session.log.push(line(`> ${p.name}`, "bright"));
    if (p.id === "scope") {
      session.scanned = true;
      const logon = { door: "the panel: DoorCtl 2.1, an admin lock", service: "the box's service logon", camera: "the feed's logon", navcom: "the logon: NAVCOM 7" }[session.look] ?? "the logon: Keelworks Logon 3.2";
      const lines = [line(`Scope reads ${logon} on a ${String(session.className).toLowerCase()}, with ${watcherOf(game, session).name} watching. Its version has a known flaw.`, "info")];
      session.log.push(...lines);
      show([line(p.what, "dim"), ...lines]);
      return helpers.act(game, session, cost) ?? { over: false };
    }
    const out = helpers.act(game, session, cost);
    if (out) return out;
    const { user, said } = breakIn(p, session);
    if (p.id === "shadow") session.shadow = true;
    session.log.push(line(said, "good"));
    if (!session.ran.includes(p.name)) session.ran.push(p.name);
    gotIn(game, session, { user, via: p.id });
    session.screen = { kind: "home" };
    return { over: false };
  }
  if (!session.ran.includes(p.name)) session.ran.push(p.name);
  const said = [];
  const say = (text, tone = "good") => said.push(line(text, tone));
  const place = session.place;
  const controls = content.controls ?? [];
  const now = game.clock?.hours ?? 0;
  game.rig.timers ??= [];
  switch (p.id) {
    case "doorkey": case "masterkey": {
      const locked = doorRows(game, session, content).filter((row) => row.actions.some((a) => a.to === "unlocked"));
      if (!locked.length) say("Every door this computer runs is already open.", "dim");
      for (const row of locked) for (const note of controlSystem(game, place, controls, row.id, "unlocked", { by: "player", room: session.roomId })) say(note.replace(/^\[[A-Z]+\]\s*/, ""));
      break;
    }
    case "relay": {
      const rows = cameraRows(game, session, content).filter((row) => row.actions.some((a) => a.to === "off"));
      for (const row of rows) controlSystem(game, place, controls, row.id, "off", { by: "player", room: session.roomId });
      game.rig.timers.push({ kind: "relay", at: now + 1 / 6, place, controls, rows: rows.map((row) => row.id), words: `RELAY.EXE: cameras off on ${session.name} until ten minutes from when it ran` });
      say(`${rows.length === 1 ? "The camera goes" : `${rows.length} cameras go`} dark for ten minutes.`);
      break;
    }
    case "mask": case "ghost":
      session.free = (session.free ?? 0) + (p.id === "mask" ? 3 : 6);
      say(`${p.name} is running: the next ${p.id === "mask" ? "three" : "six"} things you do here make no noise.`);
      break;
    case "cleaner": case "forger": case "decoy": {
      // An echo buffer in the rig makes CLEANER take more off.
      const off = { cleaner: 3 + rigNow(game).echo, forger: 1, decoy: 2 }[p.id];
      const watch = watcherOf(game, session);
      const before = session.noise ?? 0;
      session.noise = Math.max(0, before - off);
      say(`${{ cleaner: "Your lines are wiped from the log", forger: "Your lines now carry someone else's name", decoy: "Another terminal makes a racket" }[p.id]}: ${before - session.noise} noise off.`);
      // Under the trace's mark again, the trace loses the player; under the notice mark, the watcher settles.
      if (session.traceLeft !== null && session.traceLeft !== undefined && session.noise < watch.traces) {
        session.traceLeft = null;
        say("The trace loses you.");
      }
      if (session.traceLeft === null && session.noise < watch.notices) session.noticed = false;
      break;
    }
    case "lullaby":
      session.traceLeft += 4;
      say(`The trace slows: it takes four more minutes to find you, ${session.traceLeft} in all.`);
      break;
    case "blindfold":
      session.blindLeft = 5;
      say(`${watcherOf(game, session).name} sees nothing for five minutes. When it sees again, it'll notice the gap.`);
      break;
    case "cutout":
      session.cutout = true;
      say("If the watcher finds you or cuts you off now, it ends at another terminal.");
      break;
    case "digger": {
      const count = helpers.readEverything(game, session, content);
      say(count ? `${count} ${count === 1 ? "thing" : "things"} read in one go: they're in What you know.` : "There was nothing here you hadn't read.");
      break;
    }
    case "mapper": case "scope": {
      if (p.id === "scope") {
        say(`${session.name}: a ${String(session.className).toLowerCase()}, signed in as ${session.user}.`, "info");
        for (const system of controlsView(game, place, controls, { room: session.roomId })) say(`It runs ${system.title.toLowerCase()}: ${system.rows.length} ${system.rows.length === 1 ? "part" : "parts"}${system.rows.some((row) => !row.works) ? `, ${system.rows.filter((row) => !row.works).length} not working` : ""}.`, "info");
      } else for (const n of content.network ?? []) if (WORLD_COMPUTERS[n.id]) say(`${computerName(n.id)}: ${String(WORLD_COMPUTERS[n.id].class ?? "").replaceAll("_", " ") || "a computer"}${WORLD_COMPUTERS[n.id].yours || game.passwords?.[n.id] ? ", open to you" : ""}.`, "info");
      break;
    }
    case "sniffer": {
      const ids = (content.network ?? []).map((n) => n.id).filter((one) => WORLD_COMPUTERS[one]);
      game.rig.timers.push({ kind: "sniffer", at: now + 24, ids, words: `SNIFFER.EXE on ${session.name}: a day to gather passwords` });
      say("The sniffer settles in. A day from now you'll know the passwords of the computers this one reaches.");
      break;
    }
    case "sleeper":
      game.rig.timers.push({ kind: "sleeper", at: nextAt(game, 2), place, controls, name: session.name, words: `SLEEPER.EXE on ${session.name}: unlocks its doors at 02:00` });
      say("The sleeper settles in. At 02:00 it unlocks the doors this computer runs.");
      break;
    case "saboteur": {
      const row = partToBreak(game, session, content);
      game.rig.timers.push({ kind: "saboteur", at: nextAt(game, 3), place, part: row.id, name: row.name, words: `SABOTEUR.EXE on ${session.name}: ${row.name.toLowerCase()} breaks at 03:00` });
      say(`The saboteur settles in. At 03:00, ${row.name.toLowerCase()} breaks.`);
      break;
    }
    case "worm": {
      const first = (content.network ?? []).find((n) => WORLD_COMPUTERS[n.id]);
      game.passwords ??= {};
      game.passwords[first.id] = true;
      say(`The worm copies itself to ${computerName(first.id)}: you know its password now.`);
      break;
    }
    case "backdoor":
      game.passwords ??= {};
      game.passwords[session.id] = true;
      say("An account of your own is left here. Next time you just log on.");
      break;
    default:
      say("It runs, and nothing here answers it. What it does isn't in the game yet.", "dim");
  }
  show([line(p.what, "dim"), ...said]);
  session.log.push(line(`> ${p.name}`, "bright"), ...said);
  // The watcher hears the program's own noise, and it takes its minutes.
  return helpers.act(game, session, cost) ?? { over: false };
}

// Copying a program off the computer that holds it onto the rig, and into its memory if there's room. The trace notices.
export function copyProgram(game, session, content, id, helpers) {
  const p = programById(id);
  if (!p || !(p.foundOn ?? []).includes(session.id)) return { over: false, said: "There's no such program here to copy." };
  if (game.rig.programs.includes(p.id)) return { over: false, said: `Your rig already has ${p.name}.` };
  // Copying goes through the rig's link, which has to reach this computer, or over the network from where it does.
  const reach = session.remote ? null : reachWhy(game, content);
  if (reach) return { over: false, said: `Your rig can't reach it to copy anything: ${reach}.` };
  game.rig.programs.push(p.id);
  const fits = usedMemory(game.rig) + p.size <= memoryOf(game);
  if (fits) game.rig.loaded.push(p.id);
  const said = line(`${p.name} is copied onto your rig${fits ? " and loaded" : "; there's no room to load it yet"}.`, "good");
  session.screen = { kind: "program", id: `copy:${id}`, title: p.name, lines: [line(p.what, "dim"), said] };
  session.log.push(line(`> copy ${p.name}`, "bright"), said);
  if (!session.ran.includes(`copied ${p.name}`)) session.ran.push(`copied ${p.name}`);
  return helpers.act(game, session, { noise: 1 }) ?? { over: false };
}

// ---- What's been left behind, on the clock --------------------------------------------------------

addClockWork((game) => {
  const timers = game.rig?.timers;
  if (!timers?.length) return [];
  const now = game.clock?.hours ?? 0;
  const due = timers.filter((t) => t.at <= now);
  if (!due.length) return [];
  game.rig.timers = timers.filter((t) => t.at > now);
  const lines = [];
  for (const t of due) {
    try {
      if (t.kind === "relay") {
        for (const row of t.rows) controlSystem(game, t.place, t.controls, row, "on", { by: "player" });
        lines.push("[COMPUTER] The cameras your relay switched off come back on.");
      } else if (t.kind === "sleeper") {
        const doors = controlsView(game, t.place, t.controls).find((s) => s.id === "doors")?.rows ?? [];
        let opened = 0;
        for (const row of doors) if (row.actions.some((a) => a.to === "unlocked")) { controlSystem(game, t.place, t.controls, row.id, "unlocked", { by: "player" }); opened += 1; }
        lines.push(`[COMPUTER] 02:00: your sleeper on ${t.name} ${opened ? `unlocks ${opened} ${opened === 1 ? "door" : "doors"}` : "finds every door already open"}.`);
      } else if (t.kind === "saboteur") {
        damagePart(game, t.place, t.part, "broken", { by: "player" });
        lines.push(`[COMPUTER] 03:00: your saboteur breaks ${t.name.toLowerCase()}.`);
      } else if (t.kind === "sniffer") {
        game.passwords ??= {};
        for (const id of t.ids) game.passwords[id] = true;
        lines.push(`[COMPUTER] Your sniffer has the passwords of ${t.ids.map(computerName).join(", ")}.`);
      }
    } catch {
      // What was left behind found things changed, and does nothing.
    }
  }
  return lines;
});
