// The Rig page, under Gear: the pocket computer in the pack that carries programs onto computers. What's loaded in its
// memory, what else it has, and every program there is, by kind, with how to get it: written at the Repair Bay's bench
// (hours, with the clock running), copied off a computer that holds it, or bought. The server decides; this draws it.

import { api, columns, el } from "./dom.js";

let app;

export function initRig(hooks) {
  app = hooks;
}

const order = (body) => app.runAction(async () => {
  const { game, message } = await api("/api/rig", body);
  app.ui.game = game;
  if (message) app.ui.menuMessage = { ok: true, text: message };
})();

const section = (title, ...children) => el("section", { class: "menu-section" }, el("h3", {}, title), children);
const blocks = (n) => `${n} ${n === 1 ? "block" : "blocks"}`;

function programCard(p, rig, busy) {
  const facts = [p.builtIn ? "built in" : blocks(p.size), p.builtIn || !p.hours ? null : `Hacking ${p.hacking} to write`, p.power ? `power ${p.power}` : null, p.noticed ? "the trace notices it" : "unnoticed", p.once ? "once a session" : null].filter(Boolean).join(" · ");
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
    section("Loaded", loaded.map(card)),
    spare.length > 0 && section("On the rig, not loaded", spare.map(card)),
    columns(...Object.entries(rig.kinds).map(([kind, title]) => {
      const list = others.filter((p) => p.kind === kind);
      return list.length ? section(title, list.map(card)) : null;
    }).filter(Boolean)));
}
