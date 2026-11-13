// The Rig page, under Gear: the pocket computer in the pack that carries programs onto computers. Its build: the board's
// sockets on their grid with the part in each, the casing, the spare parts, what it all adds up to, and what the Repair
// Bay's bench can do to a part. What's loaded in its memory, what else it has, and every program there is, by kind,
// with how to get it: written at the bench (hours, with the clock running), copied off a computer that holds it, or
// bought. The server decides; this draws it.

import { api, columns, el, folded } from "./dom.js";

let app;
// The part the player has picked, by its id on the rig: its details show under the board, and a spare one picked lights
// the sockets it fits.
let picked = null;

export function initRig(hooks) {
  app = hooks;
}

const redraw = () => (app.renderMenus ? app.renderMenus() : app.render?.());
const pick = (uid) => {
  picked = picked === uid ? null : uid;
  redraw();
};

const order = (body) => app.runAction(async () => {
  const { game, message } = await api("/api/rig", body);
  app.ui.game = game;
  if (message) app.ui.menuMessage = { ok: true, text: message };
})();

const section = (title, ...children) => el("section", { class: "menu-section" }, el("h3", {}, title), children);
const blocks = (n) => `${n} ${n === 1 ? "block" : "blocks"}`;
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
const condNode = (part) => part.cond !== "new" && el("span", { class: `small tone-${part.cond === "broken" ? "bad" : "warn"}` }, part.cond);

// ---- The build ------------------------------------------------------------------------------------------------------

// One socket on the board: what's in it and its heat once the sinks beside it have taken theirs off. With a spare part
// picked, the sockets it goes in light up, and a click fits it.
function socketNode(socket, spare, busy) {
  const part = socket.part;
  const fits = spare && !busy && socket.open && spare.kind === socket.kind;
  return el("button", {
    class: `card rig-socket${part ? " full" : ""}${socket.open ? "" : " shut"}${part && part.uid === picked ? " chosen" : ""}${fits ? " takes" : ""}`,
    style: `grid-column:${socket.col};grid-row:${socket.row}`,
    disabled: !socket.open,
    title: !socket.open ? `Opens from Hacking ${socket.gate}` : fits ? `Fit the ${spare.name.toLowerCase()} here` : part ? part.facts : `An empty ${socket.kindName.toLowerCase()} socket`,
    onclick: () => {
      if (fits) {
        const uid = picked;
        picked = null;
        return order({ action: "fit", uid, socket: socket.key });
      }
      if (part) pick(part.uid);
    },
  },
  el("span", { class: "rig-socket-kind" }, socket.kindName.toUpperCase()),
  part ? el("strong", {}, part.name) : el("span", { class: "muted" }, socket.open ? "empty" : `Hacking ${socket.gate}`),
  part && el("span", { class: "small" }, [part.cond !== "new" ? part.cond : null, part.tune].filter(Boolean).join(", ") || " "),
  part && el("span", { class: "muted small" }, `heat ${socket.heat}${socket.cooled ? `, ${socket.cooled} cooled off` : ""}`));
}

// The part picked: what it does, where it came from, and the buttons for what can be done to it, each with why not.
function pickedNode(build) {
  const all = [build.board, build.casing, ...build.sockets.map((s) => s.part), ...build.box].filter(Boolean);
  const part = all.find((one) => one.uid === picked);
  if (!part) return null;
  return el("div", { class: "card stack gap-small rig-picked" },
    el("div", { class: "row" }, el("strong", {}, part.name), el("span", { class: "muted small" }, `${part.kindName} · grade ${part.grade} · ${part.weight} kg`), condNode(part), part.tune && el("span", { class: "small" }, part.tune)),
    el("div", { class: "small" }, part.facts),
    el("div", { class: "small" }, part.what),
    part.cond === "worn" && el("div", { class: "small tone-warn" }, "Worn: it gives half, and runs a point warmer."),
    part.cond === "broken" && el("div", { class: "small tone-bad" }, "Broken: it does nothing until it's mended or rebuilt."),
    el("div", { class: "muted small" }, part.from),
    part.actions.length > 0 && el("div", { class: "row wrap" }, part.actions.map((a) => el("button", { disabled: Boolean(a.why), title: a.why ?? a.label, onclick: () => order({ action: a.action, uid: part.uid, how: a.how }) }, a.why ? `${a.label} (${a.why})` : a.label))));
}

// Every part there is, by kind, with what it does and where it comes from.
function everyPart(build) {
  return Object.entries(build.kinds).map(([kind, title]) => {
    const list = build.every.filter((p) => p.kind === kind);
    return list.length > 0 && el("div", { class: "stack gap-small" }, el("div", { class: "small" }, title), list.map((p) => el("div", { class: "small" }, el("strong", {}, p.name), el("span", { class: "muted" }, ` · grade ${p.grade} · ${p.facts}. ${p.from}`))));
  });
}

function buildSection(rig, busy) {
  const b = rig.build;
  const s = b.stats;
  const spare = b.box.find((one) => one.uid === picked) ?? null;
  const frame = (part, label) => part && el("button", { class: `card rig-frame${part.uid === picked ? " chosen" : ""}`, title: part.facts, onclick: () => pick(part.uid) }, el("span", { class: "rig-socket-kind" }, label), el("strong", {}, part.name), condNode(part));
  const cols = Math.max(1, ...b.sockets.map((one) => one.col));
  return section("The build",
    el("div", { class: "row wrap" }, frame(b.board, "BOARD"), frame(b.casing, "CASING")),
    el("div", { class: "small" }, `Memory ${s.memory} · power ${sign(s.power)} · speed ${s.speed} · quiet ${sign(s.quiet)} · heat ${s.heat}, ${s.heatWords} · ${s.weight} kg`),
    s.dead
      ? el("div", { class: "small tone-bad" }, `It won't start: ${s.dead}.`)
      : el("div", { class: "muted small" }, `In a session: the fan is heard ${s.fanAfter ? `after ${s.fanAfter} minutes` : "from the start"}, and it overheats ${s.hotAfter ? `after ${s.hotAfter}` : "from the start"}.`),
    el("div", { class: "rig-board", style: `grid-template-columns:repeat(${cols}, minmax(0, 1fr))` }, b.sockets.map((socket) => socketNode(socket, spare, busy))),
    pickedNode(b),
    b.box.length > 0 && el("div", { class: "stack gap-small" }, el("div", { class: "small" }, "Spare parts"),
      el("div", { class: "row wrap" }, b.box.map((part) => el("button", { class: `card rig-frame${part.uid === picked ? " chosen" : ""}`, title: part.facts, onclick: () => pick(part.uid) }, el("span", { class: "rig-socket-kind" }, part.kindName.toUpperCase()), el("strong", {}, part.name), condNode(part))))),
    el("div", { class: "muted small" }, `Scrap ${b.scrap} · parts crates aboard ${b.crates} · Engineering ${b.engineering}`),
    b.makes.length > 0 && el("div", { class: "row wrap" }, b.makes.map((m) => el("button", { disabled: Boolean(m.why), title: m.what, onclick: () => order({ action: "make", id: m.id }) }, `${m.label}${m.why ? ` (${m.why})` : ""}`))),
    folded("rig-every-part", "Every part there is", everyPart(b)));
}

function programCard(p, rig, busy) {
  const facts = [p.builtIn ? "built in" : blocks(p.size), p.builtIn || !p.hours ? null : `Hacking ${p.hacking} to write`, p.power ? `power ${p.power}` : null, p.noticed ? `noise ${p.noise}` : "silent", p.once ? "once a session" : null].filter(Boolean).join(" · ");
  let action = null;
  if (p.loaded && !p.builtIn) action = el("button", { disabled: Boolean(busy), title: busy ?? "Take it off the rig's memory", onclick: () => order({ action: "unload", id: p.id }) }, "Unload");
  else if (p.owned && !p.builtIn) {
    const free = rig.memory - rig.used;
    const why = busy ?? (p.size > free ? `needs ${blocks(p.size)}, ${free} free` : null);
    action = el("button", { disabled: Boolean(why), title: why ?? "Put it in the rig's memory", onclick: () => order({ action: "load", id: p.id }) }, why && !busy ? `Load: ${why}` : "Load");
  } else if (!p.owned && !(!p.hours && (p.foundOn.length > 0 || p.soldAt))) {
    // One that's only copied or bought says so in its own line below, not again here.
    action = p.write
      ? el("span", { class: "muted small" }, p.write === `written at ${rig.bench}` ? `${p.hours} h at ${rig.bench}` : p.write)
      : el("button", { class: "primary", disabled: Boolean(busy), title: busy ?? "Hours at the bench, with the clock running", onclick: () => order({ action: "write", id: p.id }) }, `Write it: ${p.hours} ${p.hours === 1 ? "hour" : "hours"}`);
  }
  return el("div", { class: `card stack gap-small rig-card${p.loaded ? " rig-loaded" : ""}${!p.owned && p.tooHard ? " muted" : ""}` },
    el("div", { class: "row" }, el("strong", {}, p.name), el("span", { class: "muted small" }, facts)),
    el("div", { class: "small" }, p.what),
    !p.owned && p.foundOn.length > 0 && el("div", { class: "muted small" }, `Can be copied off ${p.foundOn.map((name) => name.replace(/^The /, "the ")).join(" or ")}.`),
    !p.owned && p.soldAt && el("div", { class: "muted small" }, "Sold at a port, but nobody sells programs yet."),
    action && el("div", { class: "row" }, action));
}

export function rigMenu() {
  const rig = app.ui.game?.rig;
  if (!rig) return el("div", { class: "muted small" }, "You don't have a rig.");
  const loaded = rig.programs.filter((p) => p.loaded);
  const spare = rig.programs.filter((p) => p.owned && !p.loaded);
  const others = rig.programs.filter((p) => !p.owned);
  // What's loaded is settled before sitting down at a computer, and not in a fight.
  const game = app.ui.game;
  const busy = game.computer ? "log off the computer first" : game.combat ? "finish the fight first" : null;
  const card = (p) => programCard(p, rig, busy);
  const bar = el("span", { class: "rig-memory", "aria-label": `${rig.used} of ${rig.memory} blocks` }, Array.from({ length: rig.memory }, (_, i) => el("i", { class: i < rig.used ? "on" : "" })));
  return el("div", { class: "rig-page" },
    section("Your rig",
      el("div", { class: "row small" }, "Memory", bar, `${rig.used} of ${blocks(rig.memory)}`),
      el("div", { class: "small" }, `Hacking ${rig.hacking}. ${rig.atBench ? `You're at ${rig.bench}: programs can be written here.` : `Programs are written at ${rig.bench}, on deck 3.`}`),
      busy && el("div", { class: "small tone-warn" }, game.computer ? "You're at a computer: the rig runs what it brought. Log off to change what's loaded." : "Not in the middle of a fight."),
      rig.left.length > 0 && el("div", { class: "small" }, "Left behind: ", rig.left.join("; "), ".")),
    rig.build && buildSection(rig, busy),
    section("Loaded", loaded.map(card)),
    spare.length > 0 && section("On the rig, not loaded", spare.map(card)),
    columns(...Object.entries(rig.kinds).map(([kind, title]) => {
      const list = others.filter((p) => p.kind === kind);
      return list.length ? section(title, list.map(card)) : null;
    }).filter(Boolean)));
}
