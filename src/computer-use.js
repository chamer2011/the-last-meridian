// Using a computer the player is on: reading its files, mail and logs, running its programs with the
// effects a scene could cause, reaching another computer over its network, and logging off, or being
// thrown out when the watcher finds or cuts off the player (step 3 of the hacking rework: every action has its
// noise and its minutes, and on a computer that isn't theirs AuditGuard hears the noise). Programs run through the game's actions, as the scenes' effects do,
// which is why this sits apart from src/computers.js: that file is read by the rules and the walk,
// and the tools read those.

import { storyRequest } from "./request-hook.js";
import { LOCATIONS } from "./data.js";
import { placeNow, worldOf } from "./daily.js";
import { clearFact, recordFact } from "./record.js";
import { passTime } from "./rules.js";
import { newTurnLimits, runTool } from "./tools.js";
import { closest } from "./check-games/kit.js";
import { WORLD_COMPUTERS } from "./world.js";
import { applySystemsEffect, controlSystem, controlsView, powerNote, roomPowered } from "./systems.js";
import { manifestLines } from "./logistics.js";
import { untagged } from "../public/story.js";
import { copyProgram, rigNow, runRigProgram, wearHottest } from "./rig.js";
import { HEAT, rigMinutes, rigNoise, sessionHeat } from "./rig-parts.js";
import { MAX_LOG, MINUTES_PER_ACTION, contentOf, knowsPassword, levelNamed, line, memoryOf, openLogon, openSession, peopleAt, programOffered, readNoise, sameName, settleHack, slug, theirOwn, watcherOf, watchStage, writtenContent } from "./computers.js";
import { deviceCommand, plugIn, unplugRig } from "./devices.js";
import { hop } from "./network.js";
import { learnWeak } from "./weak-points.js";

// Found by the trace, or cut off: out at once. On a ship's main system or worse that leaves a mark on the record.
function thrownOut(game, session, why = "traced") {
  const watch = watcherOf(game, session);
  const words = why === "cut" ? `${watch.name} cuts the session off and locks ${session.name}.` : `The trace finds the terminal you're on, ${session.name}.`;
  settleHack(game, session, false, why);
  if (session.practice) return finish(game, session, [`[PRACTICE] ${words} In practice, that's all it costs.`]);
  // CUTOUT.EXE sends it to another terminal: out, but nothing on the record.
  if (session.cutout) return finish(game, session, [`[COMPUTER] ${words} It ends at another terminal: your cutout took it. You're out, and nothing has your name.`]);
  const notes = [`[COMPUTER] ${words} You're out.`];
  if (watch.mark) {
    const id = `traced_on_${slug(session.className)}`;
    try {
      recordFact(game, { id, text: `The trace on a ${String(session.className).toLowerCase()} has your name on it.`, from: "hacking" });
      notes.push(`[RECORD] The trace has your name: ${id.replaceAll("_", " ")}.`);
    } catch {
      // A full record keeps what it has.
    }
  }
  return finish(game, session, notes);
}

// Each action takes its minutes, and on a computer that isn't the player's the watcher hears its noise. MASK.EXE and
// GHOST.EXE make some actions silent; BLINDFOLD.EXE blinds the watcher for some minutes, and it notices the gap when it
// sees again; riding someone's session (SHADOW.EXE) makes everything one louder, since they might notice. Once the
// watcher has noticed the player, everything is one louder; past its trace mark a trace runs down the session's
// minutes and finds them when they're up; at its cut-off they're out at once.
function act(game, session, { noise = 0, minutes = MINUTES_PER_ACTION } = {}) {
  session.actions += 1;
  // The rig works while it's plugged in (or reached over the network) at a computer that isn't the player's own: its
  // speed divides the minutes (overheating doubles them), its quiet takes noise off, and its fan, once it's hot, is
  // heard. It warms only with the minutes it's worked.
  const rig = session.yours || !(session.plugged || session.remote) ? null : rigNow(game);
  const heatBefore = rig ? sessionHeat(rig, session.rigMinutes ?? 0) : 0;
  const base = Math.max(0, Number(minutes) || 0);
  const spent = rig ? rigMinutes(rig, base, heatBefore >= HEAT.overheating) : base;
  session.minutes = (session.minutes ?? 0) + spent;
  if (rig) session.rigMinutes = (session.rigMinutes ?? 0) + spent;
  if (session.yours) return null;
  const watch = watcherOf(game, session);
  let heard = Math.max(0, Number(noise) || 0);
  if (heard > 0 && session.free > 0) {
    session.free -= 1;
    heard = 0;
  }
  if (heard > 0 && session.blindLeft > 0) heard = 0;
  if (heard > 0 && rig) heard = rigNoise(rig, heard, heatBefore >= HEAT.fan);
  if (heard > 0 && session.shadow) heard += 1;
  if (heard > 0 && session.noticed) heard += 1;
  session.noise = (session.noise ?? 0) + heard;
  const last = session.log.at(-1);
  if (heard > 0 && last?.text) last.text = `${last.text} (+${heard} noise)`;
  // The rig warms with the minutes it's worked: its fan comes on, then it overheats, each said once.
  const heat = rig ? sessionHeat(rig, session.rigMinutes ?? 0) : 0;
  if (heat >= HEAT.fan && !session.fanOn) {
    session.fanOn = true;
    session.log.push(line("Your rig's fan comes on. Anything noisy is one louder now.", "warn"));
  }
  if (heat >= HEAT.overheating && !session.overheated) {
    session.overheated = true;
    session.log.push(line("Your rig is overheating: everything takes twice as long, and something in it will wear.", "warn"));
  }
  if (session.blindLeft > 0) {
    session.blindLeft = Math.max(0, session.blindLeft - spent);
    if (!session.blindLeft) {
      session.noise += 2;
      session.log.push(line(`${watch.name} sees again, and notices the gap in its log (+2 noise).`, "warn"));
    }
  }
  if (session.noise >= watch.cuts) return thrownOut(game, session, "cut");
  if (session.traceLeft !== null && session.traceLeft !== undefined) {
    session.traceLeft -= spent;
    if (session.traceLeft <= 0) return thrownOut(game, session, "traced");
    if (spent) session.log.push(line(`The trace finds you in ${session.traceLeft} ${session.traceLeft === 1 ? "minute" : "minutes"}.`, "bad"));
  } else if (session.noise >= watch.traces) {
    session.traceLeft = watch.finds;
    session.noticed = true;
    session.log.push(line(`${watch.name} is tracing where you are. It finds you in ${watch.finds} minutes, unless you log off first.`, "bad"));
  } else if (session.noise >= watch.notices && !session.noticed) {
    session.noticed = true;
    session.log.push(line(`${watch.name} has noticed you. Everything you do from now on is one louder.`, "warn"));
  }
  return null;
}

// What the player has read goes into What you know, once.
function learn(game, session, name, text) {
  game.lore ??= [];
  const id = `computer:${session.id}:${slug(name)}`;
  if (game.lore.some((entry) => entry.id === id || entry.name.toLowerCase() === name.toLowerCase())) return;
  game.lore.push({ id, name, kind: "concept", text: `On ${session.name}: ${String(text).slice(0, 240)}` });
}

// Something read that holds another computer's weak point: the player knows that way in now, and the log says so.
function weakFound(game, session, item) {
  const said = item?.reveals ? learnWeak(game, item.reveals, session.name) : null;
  if (said) session.log.push(line(said, "good"));
  return said;
}

function showScreen(session, screen) {
  session.screen = screen;
  session.log.push(line(`> ${screen.title}`, "bright"));
  if (session.log.length > MAX_LOG) session.log.splice(0, session.log.length - MAX_LOG);
}

function openFile(game, session, content, id) {
  const file = content.files.find((one) => one.id === id);
  if (!file) return { over: false, said: "No such file." };
  const memory = memoryOf(game, session);
  const first = !memory.read.includes(`file:${id}`);
  if (first) memory.read.push(`file:${id}`);
  if (!session.read.includes(file.name)) session.read.push(file.name);
  learn(game, session, file.name, file.text);
  showScreen(session, { kind: "file", id, title: file.name, lines: [line(file.text, "bright")] });
  weakFound(game, session, file);
  const out = act(game, session, { noise: first ? readNoise(session) : 0 });
  return out ?? { over: false };
}

// DIGGER.EXE: every file and letter read in one go, into What you know. Returns how many were new.
function readEverything(game, session, content) {
  const memory = memoryOf(game, session);
  let count = 0;
  for (const file of content.files) {
    if (memory.read.includes(`file:${file.id}`)) continue;
    memory.read.push(`file:${file.id}`);
    if (!session.read.includes(file.name)) session.read.push(file.name);
    learn(game, session, file.name, file.text);
    weakFound(game, session, file);
    count += 1;
  }
  for (const entry of content.mail) {
    if (memory.read.includes(`mail:${entry.id}`)) continue;
    memory.read.push(`mail:${entry.id}`);
    const title = entry.to ? `From ${entry.from} to ${entry.to}` : entry.subject ?? entry.from;
    if (!session.read.includes(title)) session.read.push(title);
    learn(game, session, title, entry.text);
    weakFound(game, session, entry);
    count += 1;
  }
  for (const log of content.logs) if (log.reveals) weakFound(game, session, log);
  return count;
}

function openMail(game, session, content, id) {
  const entry = content.mail.find((one) => one.id === id);
  if (!entry) return { over: false, said: "No such letter." };
  const memory = memoryOf(game, session);
  const first = !memory.read.includes(`mail:${id}`);
  if (first) memory.read.push(`mail:${id}`);
  const title = entry.to ? `From ${entry.from} to ${entry.to}` : entry.subject ?? entry.from;
  if (!session.read.includes(title)) session.read.push(title);
  learn(game, session, title, entry.text);
  showScreen(session, { kind: "mail", id, title, lines: [line(entry.to ? `From: ${entry.from}\nTo: ${entry.to}` : `Subject: ${entry.subject}`, "dim"), line(entry.text, "bright")] });
  weakFound(game, session, entry);
  const out = act(game, session, { noise: first ? readNoise(session) : 0 });
  return out ?? { over: false };
}

// The logs the game writes itself, from what it knows of the place and the ship.
function logLines(game, session, content, log) {
  const place = content.place ?? game.location;
  const placeName = LOCATIONS[place]?.name ?? place;
  switch (log.kind) {
    case "berths": {
      const ship = game.ship ?? {};
      const shipHere = place === "meridian" || (ship.at && place === ship.at);
      if (!shipHere) return [line(`${ship.name ?? "CFS Meridian"} is not at the berths of ${placeName}.`, "dim")];
      const hull = ship.maxHull ? Math.round((ship.hull / ship.maxHull) * 100) : 0;
      return [line(`${(ship.name ?? "CFS Meridian").padEnd(24)} hull ${hull}%  aboard ${ship.aboard ?? "unknown"}`, "info")];
    }
    case "prices": {
      worldOf(game);
      const now = placeNow(game, place);
      if (!now?.goods?.length) return [line(`Nothing is counted at ${placeName}.`, "dim")];
      // How many of each the port has, where its amounts are real, and under a short one, why.
      return [line(`${placeName}, held by ${now.holder}.`, "dim"), ...now.goods.flatMap((good) => [
        line(`${good.name.padEnd(16)} ${good.level}${good.has ? `, ${good.has}` : ""}${good.low ? "  (short)" : good.high ? "  (plenty)" : ""}`, good.low ? "warn" : "info"),
        ...(good.why ? [line(`${"".padEnd(16)} ${good.why}.`, "dim")] : []),
      ])];
    }
    case "people": {
      const here = (game.walk?.people ?? []).filter((one) => !one.crowd).map((one) => `${one.name}${one.doing ? `, ${one.doing}` : ""}`);
      const all = peopleAt(place);
      return [line(`In the room: ${here.length ? here.join("; ") : "nobody by name"}.`, "info"), line(`On the books at ${placeName}: ${all.length ? all.join(", ") : "nobody by name"}.`, "dim")];
    }
    case "news": {
      const entries = (game.world?.news ?? []).filter((entry) => entry.place === place).slice(-8).reverse();
      return entries.length ? entries.map((entry) => line(`Day ${entry.day + 1}: ${entry.text}`, "info")) : [line(`Nothing's been heard of ${placeName} lately.`, "dim")];
    }
    case "manifest": {
      // What's come aboard lately, from the ship's logistics: the refills of the shuttle stores, newest first.
      const lines = manifestLines(game, place).slice(0, 10);
      return lines.length ? lines.map((text) => line(text, "info")) : [line("Nothing has come aboard since the manifest was started.", "dim")];
    }
    case "readouts": {
      const ship = game.ship;
      const out = [];
      if (ship) out.push(line(`${ship.name ?? "CFS Meridian"}: hull ${ship.hull}/${ship.maxHull}, ${ship.aboard ?? "unknown"} aboard.`, "info"));
      if (ship) out.push(line(`Fuel: ${ship.fuel}/${ship.maxFuel}.`, "info"));
      // The generator against the loads, from the ship's logistics, when the place has them.
      const power = powerNote(game, place);
      if (power) out.push(line(power, /let go|No power/.test(power) ? "warn" : "info"));
      out.push(line(`Day ${Math.floor((game.clock?.hours ?? 0) / 24) + 1}, air plant at 140% of design.`, "dim"));
      return out;
    }
    default:
      return [line(log.text ?? "", "info")];
  }
}

function openLog(game, session, content, id) {
  const log = content.logs.find((one) => one.id === id);
  if (!log) return { over: false, said: "No such log." };
  // The register is a table, made afresh each time it's shown (src/register.js).
  if (log.kind === "register") {
    showScreen(session, { kind: "register", id, title: log.name });
    return act(game, session) ?? { over: false };
  }
  showScreen(session, { kind: "log", id, title: log.name, lines: logLines(game, session, content, log) });
  weakFound(game, session, log);
  const out = act(game, session);
  return out ?? { over: false };
}

// Opens a door in this place: the one this computer controls, or the door to a room by its id.
function openDoor(game, content, to) {
  const target = to === "here" ? content.door : to;
  const place = content.place ?? game.location;
  if (!target || !place) return null;
  game.opened ??= {};
  game.opened[place] ??= [];
  if (!game.opened[place].includes(target)) game.opened[place].push(target);
  return levelNamed(place, target)?.name ?? target;
}

function runProgram(game, session, content, id) {
  const program = content.programs.find((one) => one.id === id);
  if (!program) return { over: false, said: "No such program." };
  const memory = memoryOf(game, session);
  if (memory.ran.includes(id)) {
    showScreen(session, { kind: "program", id, title: program.name, lines: [line("It's already been run. There's nothing more it does.", "dim")] });
    return { over: false };
  }
  if (!programOffered(game, program)) {
    showScreen(session, { kind: "program", id, title: program.name, lines: [line("It won't run for you, not as things stand.", "warn")] });
    return { over: false };
  }
  const turn = newTurnLimits();
  const notes = [];
  for (const step of program.effects) {
    if (step.set) {
      recordFact(game, { id: step.set, text: step.text ?? null, from: `computer:${session.id}` });
      notes.push(`[RECORD] ${step.text ?? step.set.replaceAll("_", " ")}`);
      continue;
    }
    if (step.clear) {
      clearFact(game, step.clear);
      continue;
    }
    if (step.door) {
      const opened = openDoor(game, content, step.door);
      notes.push(opened ? `[DOOR] The way to ${opened} is open.` : "[DOOR] Nothing here answers to that.");
      continue;
    }
    if (step.password) {
      game.passwords ??= {};
      game.passwords[step.password] = step.word;
      notes.push(`[COMPUTER] You know the password to ${WORLD_COMPUTERS[step.password]?.name ?? step.password} now.`);
      continue;
    }
    if (step.computer) continue;
    if (step.request) {
      notes.push(...storyRequest(game, step));
      continue;
    }
    if (step.systems) {
      notes.push(...applySystemsEffect(game, step.systems, { by: session.yours ? "owner" : "player" }));
      continue;
    }
    const { tool, ...input } = step;
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`The program ${program.name} failed: ${outcome.result}`);
    if (outcome.notice) notes.push(outcome.notice);
    if (outcome.narration) notes.push(outcome.narration);
  }
  memory.ran.push(id);
  session.ran.push(program.name);
  if (notes.length) game.transcript?.push({ role: "notice", text: notes.join("\n") });
  showScreen(session, { kind: "program", id, title: program.name, lines: [line(program.text || "Done.", "bright"), ...notes.map((note) => line(note, "good"))] });
  const out = act(game, session, { noise: 1 });
  return out ?? { over: false };
}

// Reaching another computer over the network: the player's own, or one whose password they know, straight
// away; any other opens at its own logon, after this session is logged off.
function connectTo(game, session, content, id) {
  const entry = content.network.find((one) => one.id === id);
  const target = entry ? WORLD_COMPUTERS[id] : null;
  if (!entry || !target) return { over: false, said: "No such node on the network." };
  const next = writtenContent(id);
  const summary = finish(game, session, [`[COMPUTER] From ${session.name} you reached for ${next.name}.`]);
  if (theirOwn(game, next) || knowsPassword(game, id)) openSession(game, next, { how: "connected", at: session.at ?? null });
  else openLogon(game, next, { at: session.at ?? null });
  return { over: true, summary, computer: true };
}

// What the watcher made of a session the player logs off from.
const watcherWords = (session) => ({
  calm: "The watcher never noticed you.",
  noticed: "The watcher had noticed you: what you did is in its log.",
  tracing: "A trace was still running when you logged off: it knows it came from here, if not who.",
})[watchStage(session)];

// Logging off, or being thrown out: one line in the story, and the clock moves on. A logon the player walks away from
// tells whatever asked for the hack that it didn't happen. Practice leaves nothing: no line, and no time gone by.
function finish(game, session, notes = []) {
  if (session.locked) settleHack(game, session, false, "left");
  // A rig that overheated wears its hottest part, except in practice, where nothing counts.
  const worn = session.overheated && !session.practice ? wearHottest(game) : null;
  if (worn) notes = [...notes, worn];
  if (session.practice) {
    game.computer = null;
    return { over: true, summary: notes[0] ?? "[PRACTICE] You log off. Nothing that happened there counts." };
  }
  const read = session.read.length;
  const ran = session.ran;
  const thrown = notes.some((note) => /cuts the session off|trace finds the terminal/.test(note));
  const summary = session.locked
    ? `[COMPUTER] At ${session.name}'s logon: you didn't get in.${thrown ? "" : ` ${watcherWords(session)}`}`
    : `[COMPUTER] On ${session.name}: ${read ? `read ${read} ${read === 1 ? "thing" : "things"}` : "read nothing"}${ran.length ? `, ran ${ran.join(", ")}` : ""}.${!session.yours && !thrown ? ` ${watcherWords(session)}` : ""}`;
  game.transcript?.push({ role: "notice", text: [summary, ...notes].join("\n") });
  // Each thing done took its minutes. Where the clock has been running meanwhile, that's already gone by.
  const owed = (session.minutes ?? session.actions * MINUTES_PER_ACTION) / 60 - Math.max(0, (game.clock?.hours ?? 0) - (session.startedAt ?? game.clock?.hours ?? 0));
  if (owed > 0) passTime(game, owed);
  game.computer = null;
  return { over: true, summary };
}

function helpLines(content) {
  return [
    line("ls: what's here.  cat <file>: read a file.  mail: the letters, and read <n> opens one.", "dim"),
    line("log <name>: a log.  run <program>: a program.  net: the network, and connect <id> reaches one.  logoff: leave.", "dim"),
    line(`Files: ${content.files.map((one) => one.name).join(", ") || "none"}. Programs: ${content.programs.map((one) => one.name).join(", ") || "none"}.`, "dim"),
  ];
}

function typed(game, session, content, text) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { over: false };
  session.log.push({ you: text.trim().slice(0, 80) });
  const [verb, ...rest] = words;
  const name = rest.join(" ");
  const byName = (list) => {
    const match = closest(name, list.map((one) => one.name));
    return list.find((one) => one.name === match) ?? null;
  };
  switch (verb) {
    case "ls": case "dir": case "home":
      session.screen = { kind: "home" };
      return { over: false };
    case "help": case "?":
      session.log.push(...helpLines(content));
      return { over: false };
    case "cat": case "read": case "open": case "more": case "type": {
      const file = byName(content.files);
      if (file) return openFile(game, session, content, file.id);
      const index = Number(name);
      const letter = Number.isInteger(index) ? content.mail[index - 1] : byName(content.mail.map((one) => ({ ...one, name: one.to ? `from ${one.from} to ${one.to}` : one.subject ?? one.from })));
      if (letter) return openMail(game, session, content, letter.id);
      session.log.push(line(`${name || "which one"}: no such file. Type ls.`, "dim"));
      return { over: false };
    }
    case "mail": case "letters":
      session.screen = { kind: "mail" };
      return { over: false };
    case "log": case "logs": {
      const log = name ? byName(content.logs) : null;
      if (log) return openLog(game, session, content, log.id);
      session.screen = { kind: "logs" };
      return { over: false };
    }
    case "net": case "network":
      session.screen = { kind: "network" };
      return { over: false };
    case "connect": case "ssh": case "reach": {
      const target = content.network.find((one) => one.id === name || sameName(one.desc, name)) ?? content.network.find((one) => one.id.includes(name));
      if (target) return connectTo(game, session, content, target.id);
      session.log.push(line("No such node. Type net.", "dim"));
      return { over: false };
    }
    case "logoff": case "logout": case "exit": case "quit": case "bye":
      return finish(game, session);
    case "run": case "exec": case "start": {
      const program = byName(content.programs.filter((one) => programOffered(game, one)));
      if (program) return runProgram(game, session, content, program.id);
      session.log.push(line(`${name || "which one"}: no such program. The programs are on the left.`, "dim"));
      return { over: false };
    }
    default: {
      // A program's name, or a file's, typed on its own.
      const program = byName(content.programs.filter((one) => programOffered(game, one)).map((one) => ({ ...one, name: one.name })));
      const guess = closest(words.join(" "), content.programs.map((one) => one.name));
      if (guess) return runProgram(game, session, content, content.programs.find((one) => one.name === guess).id);
      const file = closest(words.join(" "), content.files.map((one) => one.name));
      if (file) return openFile(game, session, content, content.files.find((one) => one.name === file).id);
      void program;
      session.log.push(line(`command not found: ${verb}. Type help.`, "dim"));
      return { over: false };
    }
  }
}

// Switching one of the place's systems from here. On a hacked computer the trace notices it, like a program, and a
// computer that's just cut its own room's power goes dark with everything else.
function runSystem(game, session, content, body) {
  const by = session.yours ? "owner" : "player";
  const notes = controlSystem(game, session.place, content.controls ?? [], String(body.row ?? ""), String(body.to ?? ""), { by, room: session.roomId });
  const system = String(body.system ?? "");
  session.screen = { kind: "system", id: system, title: session.screen?.title ?? system };
  for (const note of notes) session.log.push(line(untagged(note), /ALARM/.test(note) ? "bad" : "good"));
  if (session.log.length > MAX_LOG) session.log.splice(0, session.log.length - MAX_LOG);
  const done = notes[0] ? untagged(notes[0]).replace(/\.$/, "") : "a system";
  if (!session.ran.includes(done)) session.ran.push(done);
  if (notes.length) game.transcript?.push({ role: "notice", text: notes.join("\n") });
  const out = act(game, session, { noise: 1 });
  if (out) return out;
  return screenGoesDark(game, "you've cut its own power") ?? { over: false };
}

// The computer the player's on, if its room has just lost its power, goes dark and they're logged off. Returns null if
// it's still on.
export function screenGoesDark(game, why) {
  const session = game.computer;
  if (!session?.roomId || roomPowered(game, session.place, session.roomId)) return null;
  return finish(game, session, [`[COMPUTER] The screen goes dark: ${why}.`]);
}

export function computerCommand(game, body) {
  const session = game.computer;
  if (!session) throw new Error("You're not on a computer.");
  const content = contentOf(game, session);
  if (!content) {
    game.computer = null;
    throw new Error("That computer's file has gone.");
  }
  // At the logon there's nothing to open yet: only the rig's programs, and logging off.
  if (session.locked && !["rig", "logoff", "home", "plug", "unplug"].includes(body.action)) {
    if (body.action === "type" && /^(logoff|logout|exit|quit|bye)$/i.test(String(body.text ?? "").trim())) return finish(game, session);
    return { over: false, said: "Log on first: run something from your rig to get past the logon." };
  }
  switch (body.action) {
    case "home": session.screen = { kind: "home" }; return { over: false };
    case "file": return openFile(game, session, content, String(body.id ?? ""));
    case "mail": return body.id ? openMail(game, session, content, String(body.id)) : (session.screen = { kind: "mail" }, { over: false });
    case "log": return body.id ? openLog(game, session, content, String(body.id)) : (session.screen = { kind: "logs" }, { over: false });
    case "program": return runProgram(game, session, content, String(body.id ?? ""));
    case "network": return (session.screen = { kind: "network" }, { over: false });
    case "connect": return connectTo(game, session, content, String(body.id ?? ""));
    case "logoff": return finish(game, session);
    case "type": return typed(game, session, content, String(body.text ?? ""));
    case "show": {
      const system = controlsView(game, session.place, content.controls ?? [], { room: session.roomId }).find((one) => one.id === String(body.id ?? ""));
      if (!system) return { over: false, said: "This computer doesn't run that." };
      session.screen = { kind: "system", id: system.id, title: system.title };
      return { over: false };
    }
    case "system": return runSystem(game, session, content, body);
    case "rig": return runRigProgram(game, session, content, String(body.id ?? ""), { act, readEverything });
    case "copy": return copyProgram(game, session, content, String(body.id ?? ""), { act });
    // A door panel's, a junction box's, a camera's or NAVCOM 7's own buttons (src/devices.js).
    case "device": return deviceCommand(game, session, content, String(body.id ?? ""), { act, finish });
    // Going along the network to the next system (src/network.js).
    case "hop": return hop(game, session, String(body.id ?? ""), { act, finish, content });
    // Connecting the rig before hacking, and taking it off again (src/devices.js).
    case "plug": return plugIn(game, session, content, { act });
    case "unplug": return unplugRig(game, session);
    default: throw new Error("Unknown order.");
  }
}
