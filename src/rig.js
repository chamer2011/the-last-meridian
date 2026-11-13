// The player's rig: the pocket computer in their pack that carries programs onto computers (step 2 of the hacking
// rework). For now every rig is the plain yard build, four blocks of memory. The programs are world files
// (src/programs.js); what each one does when it runs is here. At a computer's logon the breakers get the player in, if
// they're strong enough for its class (step 3); inside, the watcher hears each program's noise, and what the computer
// runs (doors, cameras, power) is switched through the systems. Writing a program takes hours at the Repair Bay's
// bench, and Hacking decides which ones the player can write; one they have, however they came by it, runs whatever
// their skill. Some can be copied off the computers that hold them.
//
// game.rig: { programs: [ids the rig has], loaded: [ids in its memory], timers: [what's been left behind, and when] }.
import { addClockWork } from "./room-hooks.js";
import { PROGRAM_KINDS, programById, programsNow } from "./programs.js";
import { classKeys, gotIn, line, watchFor } from "./computers.js";
import { controlSystem, controlsView, damagePart, systemsOf } from "./systems.js";
import { passTime, skillRank } from "./rules.js";
import { roomHere } from "./walk.js";
import { WORLD_COMPUTERS } from "./world.js";

export const RIG_MEMORY = 4;
export const BENCH = { place: "meridian", room: "repair", name: "the Repair Bay's bench" };
export const STARTING_PROGRAMS = ["dictionary", "doorkey", "mask"];

export function newRig() {
  const all = programsNow().list;
  const programs = [...new Set([...all.filter((p) => p.everyRig || p.builtIn).map((p) => p.id), ...STARTING_PROGRAMS.filter((id) => programById(id))])];
  const loaded = [];
  let used = 0;
  for (const id of STARTING_PROGRAMS) {
    const p = programById(id);
    if (!p || p.builtIn || used + p.size > RIG_MEMORY) continue;
    loaded.push(id);
    used += p.size;
  }
  return { programs, loaded, timers: [] };
}

const usedMemory = (rig) => rig.loaded.reduce((n, id) => n + (programById(id)?.size ?? 0), 0);
const hackingOf = (game) => skillRank(game, "hacking");
const atBench = (game) => game.location === BENCH.place && roomHere(game)?.id === BENCH.room;
const classNumber = (classKey) => Math.max(1, classKeys().indexOf(classKey) + 1);
const computerName = (id) => WORLD_COMPUTERS[id]?.name ?? id;

// Why the player can't write this program now, or null if they can.
function cantWrite(game, p) {
  if (game.rig.programs.includes(p.id)) return "you have it";
  if (!p.hours) return p.foundOn?.length ? `only copied, off ${p.foundOn.map(computerName).join(" or ")}` : p.soldAt ? "only bought, and nobody sells it yet" : "it can't be written";
  if (hackingOf(game) < p.hacking) return `needs Hacking ${p.hacking}`;
  if (!atBench(game)) return `written at ${BENCH.name}`;
  if (game.computer || game.combat || game.check) return "not now";
  return null;
}

// What the page shows: memory, what's loaded, what the rig has, and every program there is.
export function rigView(game) {
  const rig = game.rig;
  if (!rig) return null;
  const hacking = hackingOf(game);
  return {
    memory: RIG_MEMORY,
    used: usedMemory(rig),
    hacking,
    atBench: atBench(game),
    bench: BENCH.name,
    kinds: PROGRAM_KINDS,
    loaded: rig.loaded,
    left: rig.timers.map((t) => t.words),
    programs: programsNow().list.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, hacking: p.hacking, size: p.size, power: p.power ?? null, noise: p.noise, noticed: p.noise > 0, once: Boolean(p.once), builtIn: Boolean(p.builtIn), what: p.what,
      hours: p.hours ?? null, foundOn: (p.foundOn ?? []).map(computerName), soldAt: p.soldAt ?? null,
      owned: rig.programs.includes(p.id), loaded: p.builtIn || rig.loaded.includes(p.id), tooHard: Boolean(p.hours) && hacking < p.hacking,
      write: cantWrite(game, p),
    })),
  };
}

// Loading, unloading and writing, outside any computer (/api/rig). Returns { said, notes }.
export function rigCommand(game, body) {
  const rig = game.rig;
  if (!rig) throw new Error("You don't have a rig.");
  const p = programById(body.id);
  if (!p) throw new Error("There's no such program.");
  // What's loaded is decided in the room, before sitting down: at a computer the rig runs what it brought.
  if (game.computer) throw new Error("Log off the computer first: the rig's programs are loaded before you sit down.");
  if (game.combat) throw new Error("Finish the fight first.");
  if (body.action === "write" && game.talk) throw new Error("Finish the talk first.");
  if (body.action === "load") {
    if (p.builtIn || rig.loaded.includes(p.id)) return { said: `${p.name} is already loaded.` };
    if (!rig.programs.includes(p.id)) throw new Error(`Your rig doesn't have ${p.name}.`);
    if (usedMemory(rig) + p.size > RIG_MEMORY) throw new Error(`${p.name} needs ${p.size} ${p.size === 1 ? "block" : "blocks"}, and your rig has ${RIG_MEMORY - usedMemory(rig)} free.`);
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
    const fits = usedMemory(rig) + p.size <= RIG_MEMORY;
    if (fits) rig.loaded.push(p.id);
    return { said: `${p.hours} ${p.hours === 1 ? "hour" : "hours"} at the bench, and ${p.name} is written${fits ? " and loaded" : "; there's no room to load it until something comes off"}.`, notes: Array.isArray(notes) ? notes : [] };
  }
  throw new Error("Unknown order.");
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
  if (p.once && session.rigUsed?.includes(p.id)) return "it's already run this session";
  // At the logon only the breakers and Scope run; inside, there's nothing left to break.
  if (session.locked) {
    if (p.id === "scope") return session.scanned ? "it's read the logon already" : null;
    if (p.kind !== "in") return "log on first";
  } else if (p.kind === "in") return "you're already in";
  if (p.power && p.power < classNumber(session.classKey)) return `it's too weak for a ${String(session.className).toLowerCase()}`;
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
  const copies = programsNow().list.filter((p) => (p.foundOn ?? []).includes(session.id) && !game.rig.programs.includes(p.id)).map((p) => ({ id: p.id, name: p.name, about: p.what }));
  const ways = session.locked ? mine.filter((p) => p.kind === "in" || p.id === "scope").map((p) => ({ id: p.id, name: p.name, about: p.what, kind: p.kind, power: p.power ?? null, noise: p.noise ?? 0, minutes: p.minutes ?? 1, why: cantRun(game, session, content, p) })) : [];
  return { loaded, copies, ways, memory: RIG_MEMORY, used: usedMemory(game.rig) };
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
      const lines = [line(`Scope reads the logon: Keelworks Logon 3.2 on a ${String(session.className).toLowerCase()}, with ${watchFor(game, session.classKey).name} watching. Its version has a known flaw.`, "info")];
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
      const off = { cleaner: 3, forger: 1, decoy: 2 }[p.id];
      const watch = watchFor(game, session.classKey);
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
      say(`${watchFor(game, session.classKey).name} sees nothing for five minutes. When it sees again, it'll notice the gap.`);
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
  game.rig.programs.push(p.id);
  const fits = usedMemory(game.rig) + p.size <= RIG_MEMORY;
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
