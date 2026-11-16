// The Ship menu: the Meridian's numbers, where she is, what's aboard, the rations, buying and selling at the dock,
// waiting, what the officers decided, her log, her systems and her crew. Everything here is drawn from the game's
// state, and every button runs on this computer. Someone who isn't her captain sees how she stands.

import { api, el, folded, meter, signed, twoColumns } from "./dom.js";
import { shipOrder } from "./map.js";

// What this screen needs from the main screen. Set once, when the page loads.
let app;

export function initShip(hooks) {
  app = hooks;
}

const inFight = () => Boolean(app.ui.game.combat || app.ui.game.check || app.ui.game.talk);
const cannotAct = () => app.ui.streaming || inFight();

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const small = (text) => el("div", { class: "small" }, text);
const number = (n) => n.toLocaleString("en-US");

// ---- How she stands -----------------------------------------------------

function statusSection(g) {
  const s = g.ship;
  return section(s.name,
    el("div", { class: "menu-row" }, el("strong", {}, `${number(s.aboard)} aboard`), el("strong", {}, s.atText)),
    muted(`${g.clock.label}. Built for three hundred, carrying ${number(s.aboard)}.`),
    el("div", { class: "stack gap-small small" },
      meter("HULL  ", s.hull, s.maxHull),
      meter("FUEL  ", s.fuel, s.maxFuel),
      muted("Each jump uses 1 to 3 fuel, depending on how far it is, and she burns about one every two days keeping station. If it runs out, she can't jump anywhere."),
      meter("MORALE", s.morale, 100),
      muted(`Settling at ${s.moraleTarget}, with these rations.`),
      meter("HEALTH", s.health, 100),
      muted(`Settling at ${s.healthTarget}.`)));
}

function supplyLine(s) {
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, s.stock / s.max)) * 10)).padEnd(10, "-");
  const left = s.out ? "OUT" : s.days === null ? "holding" : `${s.days} ${s.days === 1 ? "day" : "days"} left`;
  return el("div", { class: `ship-supply${s.out || s.low ? " low" : ""}` },
    el("div", { class: "ship-supply-line" },
      // To a tenth: a few tins or a medkit handed in count for their share of a crate, and anything smaller isn't shown.
      el("span", {}, `${s.name.toUpperCase().padEnd(8)} [${bar}] ${Math.round(s.stock * 10) / 10}${s.unit ? ` ${s.unit}` : ""}`),
      el("strong", {}, left)),
    muted(`Makes ${s.made}, uses ${s.used}, so ${signed(s.net)} a day.`));
}

const suppliesSection = (s) => section("Stores", s.supplies.map(supplyLine), muted("Food, medicine and parts are what's in the rooms' stores below, counted together, and fuel is the tank. Anything else that's food in the pantry, medicine in the cabinet or a spare in the lockers counts for its share of a crate. The ship's daily needs and the engineers take a crate when they've used one up, at midnight, the medbay opens one from its cabinet when its doses run out, and the kettle feeds everyone through the day. With parts aboard the engineers mend the hull a little each day; without them, she wears."));

// What's kept where, room by room, from world/logistics: each store is a thing in a room you can walk to and open,
// each machine takes from one and puts into another on the clock, and the whole ship eats from the kettle.
function storesSection(s) {
  if (!s.stores?.length) return null;
  const count = (n) => n.toLocaleString("en-US");
  const line = (store) => {
    // What a store keeps is counted in its own words, "12 ration crates". Anything else that's been put in it, a tin or
    // a medkit handed in, is listed as it's named, "100 × tinned fish", since not every name takes an s.
    const kept = (one) => `${one.n}${one.of && one.n !== one.of ? ` of ${one.of}` : ""} ${one.name.toLowerCase()}${one.n === 1 || /produce$/i.test(one.name) ? "" : "s"}`;
    const what = store.count ? `${store.count.n} of ${store.count.of} ${store.count.unit}` : store.items.filter((one) => one.of || one.n > 0).map((one) => (one.of ? kept(one) : `${one.n} × ${one.name.toLowerCase()}`)).join(", ") || "empty";
    return el("div", { class: "menu-row small" },
      el("span", {}, store.name, el("span", { class: "muted" }, `, ${store.room}`)),
      el("span", { class: store.empty || store.items?.some((one) => one.of && one.n <= 0) ? "tone-bad" : "" }, what));
  };
  const machine = (m) => el("div", { class: "menu-row small" },
    el("span", {}, m.name, el("span", { class: "muted" }, `, ${m.room}: ${m.does}`)),
    el("span", { class: m.bad ? "tone-bad" : m.runs ? "" : "muted" }, m.status));
  const refill = (r) => el("div", { class: "stack gap-small" },
    el("div", { class: "small" }, r.store, el("span", { class: "muted" }, `: ${r.does}`)),
    muted(r.last ? `Last: ${r.last}` : "Nothing has come aboard yet."));
  const repairs = s.repairs && el("div", { class: "stack gap-small" },
    small(`Each takes ${s.repairs.does}.`),
    s.repairs.waiting.length ? el("div", { class: "small tone-bad" }, `Waiting for parts: ${s.repairs.waiting.join(", ")}.`) : null,
    muted(s.repairs.last ? `Last: ${s.repairs.last}` : "Nothing has been repaired yet."));
  const meals = s.meals && el("div", { class: "stack gap-small" },
    small(`${s.meals.sittings} sittings a day, ${count(s.meals.aSitting)} people at each: ${s.meals.now}.`),
    el("div", { class: `small${s.meals.today.missed ? " tone-bad" : ""}` }, `Today ${count(s.meals.today.served)} served${s.meals.today.missed ? `, ${count(s.meals.today.missed)} found the kettle empty` : ""}.${s.meals.yesterday ? ` Yesterday ${count(s.meals.yesterday.served)} served${s.meals.yesterday.missed ? `, ${count(s.meals.yesterday.missed)} went without` : ""}.` : ""}`));
  return section("In the rooms", s.stores.map(line),
    muted("Walk up to any of them and open it beside your pack. What's taken out and put back is kept, and the count here follows it."),
    s.machines?.length ? [el("h4", { class: "small" }, "Machines"), s.machines.map(machine), muted("Each runs on the clock while its room has power and someone's at it, and nothing runs while the clock is paused.")] : null,
    s.work?.length ? [el("h4", { class: "small" }, "Work"), muted(`${s.work.filter((one) => one.short).length || "No"} ${s.work.filter((one) => one.short).length === 1 ? "store is" : "stores are"} short of something ${s.work.filter((one) => one.short).length === 1 ? "it wants" : "they want"}. Who's carrying, what's stuck and what the officers have put first are on the Work page.`)] : null,
    s.refills?.length ? [el("h4", { class: "small" }, "Refills"), s.refills.map(refill), muted("The one place things still come from nowhere, until trade off the ship is built. The manifest on the clip in the lighter bay, and the ship's computers, say what came and when.")] : null,
    repairs ? [el("h4", { class: "small" }, "Repairs"), repairs, muted("When something's been damaged, an engineer fetches what the repair takes from the stores and fixes it. With none aboard, it stays broken until some comes.")] : null,
    meals ? [el("h4", { class: "small" }, "The sittings"), meals, muted("Everyone aboard eats from the kettle at the sittings. Whoever finds it empty goes without, and the ship's morale feels that at midnight.")] : null);
}

// The medbay: who's on each cot and the floor, for what, how long, and whether they're being treated; the medicine; and
// the last treatments.
function medbaySection(s) {
  const m = s.medbay;
  if (!m) return null;
  const patient = (label, p) => el("div", { class: "stack gap-small" },
    el("div", { class: "menu-row small" },
      el("span", {}, label, el("span", { class: "muted" }, p ? `: ${p.who}` : ": empty")),
      p ? el("span", { class: /^waiting/.test(p.state) ? "tone-bad" : "" }, p.state) : null),
    p ? muted(!p.since ? p.worst : `${p.worst}, ${p.since === "just brought in" ? "just brought in" : `for ${p.since}`}`) : null);
  const laid = m.cots.filter(Boolean).length + m.floor.length;
  return section(`The medbay${laid ? ` (${laid} laid up)` : ""}`,
    m.cots.map((p, i) => patient(`Cot ${i + 1}`, p)),
    m.floor.map((p) => patient("On the floor", p)),
    m.medicine ? el("div", { class: `small${m.medicine.short ? " tone-bad" : ""}` }, m.medicine.short ? `The ${m.medicine.store.toLowerCase()} is empty: nobody can be treated until a crate comes.` : `${m.medicine.doses ? `Open crate: ${m.medicine.doses} of ${m.medicine.perCrate} doses left.` : `No crate open: the next treatment opens one from the ${m.medicine.store.toLowerCase()}.`}${m.medicine.rounds ? ` The rounds carry ${m.medicine.rounds} more.` : ""}`) : null,
    m.rounds ? el("div", { class: `small${m.rounds.serious > m.rounds.dosed ? " tone-bad" : ""}` }, roundsLine(m.rounds)) : null,
    m.log.length ? folded("ship-medbay-log", `Treated lately (${m.log.length})`, m.log.map((line) => muted(line))) : null,
    m.dead?.length ? folded("ship-medbay-dead", `Died (${m.dead.length})`, m.dead.map((one) => muted(`Day ${one.day}: ${one.name}, ${one.cause}.`))) : null);
}

// The doctor's rounds among the register: how many of everyone aboard are sick, with what, how many of the serious
// cases have had a dose, and who died this week.
function roundsLine(r) {
  const what = r.byKind.map((one) => `${one.n} with a ${one.name}`).join(", ");
  return `On the doctor's rounds: ${r.sick ? `${r.sick} of ${r.aboard.toLocaleString("en-US")} on the register sick (${what})${r.serious ? `, ${r.serious} seriously, ${r.dosed} of them dosed` : ""}` : `nobody of ${r.aboard.toLocaleString("en-US")} on the register sick`}.${r.died ? ` ${r.died} died this week.` : ""}`;
}

// The workshop: who's being mended, the limbs being built and ready, the parts crates aboard, and what was done lately.
function workshopSection(s) {
  const w = s.workshop;
  if (!w) return null;
  return section(w.room,
    w.lines.length ? w.lines.map((line) => small(`${line}.`)) : muted("Nobody's being mended, and no limb is being built."),
    el("div", { class: `small${w.short ? " tone-bad" : ""}` }, w.short ? "There aren't the parts crates for what's waiting." : `Parts crates aboard: ${w.crates}.`),
    w.log.length ? folded("ship-workshop-log", `Done lately (${w.log.length})`, w.log.map((line) => muted(line))) : null);
}

function choiceCard({ current, name, detail, desc, onclick, disabled }) {
  return el("button", { class: `card selectable${current ? " selected" : ""}`, "aria-pressed": String(Boolean(current)), disabled, onclick },
    el("strong", {}, name), muted(desc), detail);
}

function rationsSection(s) {
  return folded("ship-rations", `Rations: ${s.rations.find((r) => r.current)?.name ?? "none"}`, s.rations.map((r) => choiceCard({
    current: r.current,
    name: r.name,
    desc: r.desc,
    disabled: cannotAct(),
    detail: el("div", { class: "effects small" }, `Uses about ${r.foodUsed} crates of food a day. Morale settles at ${r.moraleTarget}, health at ${r.healthTarget}.`),
    onclick: shipOrder({ action: "rations", id: r.id }),
  })));
}

function ordersSection(g) {
  const s = g.ship;
  return section("Orders",
    muted("Waiting costs nothing but what the ship uses up, and it passes the time faster than walking around does."),
    el("div", { class: "row" },
      el("button", { disabled: cannotAct(), onclick: shipOrder({ action: "wait", days: 1 }) }, "Wait 1 day"),
      el("button", { disabled: cannotAct(), onclick: shipOrder({ action: "wait", days: 3 }) }, "Wait 3 days")),
    el("div", {}, el("button", { onclick: () => app.openMenu("map") }, "Open the star map")),
    s.trade.length > 0
      ? el("div", { class: "stack gap-small" },
        el("div", { class: "small" }, `Trade with ${s.atName}. You have ${g.credits} credits. Prices move with what's left here, and with each lot you buy or sell.`),
        s.trade.map((t) => el("div", { class: "menu-row small ship-trade" },
          el("span", {}, `${t.amount} of ${t.name.toLowerCase()}`, t.level && el("span", { class: "muted ship-trade-level" }, ` ${t.level}`)),
          el("span", { class: "row" },
            el("button", { disabled: cannotAct() || !t.spare, title: t.spare ? "" : "The ship hasn't got that much", onclick: shipOrder({ action: "sell", id: t.id }) }, `Sell ${t.sellFor} cr`),
            el("button", { disabled: cannotAct() || t.none || t.full || g.credits < t.price, title: t.none ? "Nobody here has any left to sell" : "", onclick: shipOrder({ action: "buy", id: t.id }) }, t.none ? "None left" : `Buy ${t.price} cr`)))))
      : muted(s.at ? `Nobody at ${s.atName} deals in the ship's supplies. The star map says who does.` : "In open space there's nobody to buy from. The star map says who sells what."));
}

function councilSection(s) {
  const { off, recent } = s.council;
  return folded("ship-council", "Officers and council",
    muted(off
      ? "You've told them to wait for your word, whatever happens."
      : "If the food's run low and stayed low, they'll change the rations themselves after a day or two, and tell you. An order of your own stands for a few days before they'd change it."),
    el("div", { class: "row" },
      el("button", { class: off ? "" : "primary", "aria-pressed": String(!off), disabled: cannotAct(), onclick: shipOrder({ action: "council", on: true }) }, "They can act"),
      el("button", { class: off ? "primary" : "", "aria-pressed": String(off), disabled: cannotAct(), onclick: shipOrder({ action: "council", on: false }) }, "Wait for my word")),
    recent.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text))));
}

function logSection(s) {
  return folded("ship-log", `Ship's log (${s.log.length})`, s.log.length
    ? s.log.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text)))
    : muted("Shortages, what the officers decided and where she went will be recorded here."));
}

// The Meridian's own systems, which the captain runs from here with no hacking: each one folded, with what isn't
// working said on its line.
function systemsSection(g) {
  const systems = g.shipSystems;
  if (!systems?.length) return null;
  const turn = (row, to) => app.runAction(async () => {
    const { game } = await api("/api/systems", { row, to });
    app.ui.game = game;
  });
  return section("Systems",
    systems.map((system) => {
      const down = system.rows.filter((row) => !row.works).length;
      return folded(`ship-systems-${system.id}`, `${system.title}${down ? ` (${down} down)` : ""}`,
        system.note ? el("div", { class: `small${/let go|No power/.test(system.note) ? " tone-bad" : " muted"}` }, system.note) : null,
        system.rows.map((row) => el("div", { class: "menu-row small ship-system-row" },
          el("span", { class: "ship-system-name" }, row.name, row.feed?.length ? el("span", { class: "muted" }, `, on camera: ${row.feed.join(", ")}`) : null),
          el("span", { class: `tag${row.works ? "" : " bad"}` }, row.word),
          row.actions.map((action) => el("button", { class: "small", onclick: turn(row.id, action.to) }, action.label)))));
    }));
}

function crewSection(g) {
  return folded("ship-crew", "Crew",
    g.people.filter((p) => p.crew).map((p) => el("div", { class: "menu-row small" },
      el("span", {}, p.name, el("span", { class: "muted" }, `, ${p.role}`)),
      el("span", { class: p.status === "alive" ? "tag" : "tag bad" }, p.status === "alive" ? p.attitude ?? "not met" : p.status))));
}

// What someone who isn't in charge can see of the ship: what's plain to anyone aboard, and what's going round.
const MOODS = [[60, "People are holding up."], [35, "People are frightened, and they've started saying so."], [15, "People have started talking about getting off at the next dock."], [0, "The ship's coming apart, and nobody's pretending otherwise."]];

function outsiderShip(g) {
  const s = g.ship;
  const { role } = g;
  const here = role.withShip;
  return twoColumns([
    section(s.name,
      el("div", { class: "menu-row" }, el("strong", {}, `about ${number(Math.round(s.aboard / 100) * 100)} aboard`), el("strong", {}, s.atText)),
      muted(`${role.chair ?? "Someone else"} has the chair.`),
      here
        ? [small(MOODS.find(([from]) => s.morale >= from)[1]),
          s.shortages.length > 0 && el("div", { class: "small tone-bad" }, `Everyone's talking about the ${s.shortages.join(" and the ")}.`)]
        : muted("That's the last anyone here heard. Whatever else is going on aboard, you'll hear about it when everyone else does.")),
    section("Waiting",
      muted("Let the time go by, and see what happens without you. The ship won't wait for you, and nor will anyone else."),
      el("div", { class: "row" },
        el("button", { disabled: cannotAct(), onclick: shipOrder({ action: "wait", days: 1 }) }, "Wait 1 day"),
        el("button", { disabled: cannotAct(), onclick: shipOrder({ action: "wait", days: 3 }) }, "Wait 3 days")),
      el("div", {}, el("button", { onclick: () => app.openMenu("map") }, "Open the star map"))),
  ], [
    here && section("What's been decided",
      s.council.recent.length
        ? s.council.recent.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text)))
        : muted("Nothing that's reached you. The rations and the jumps are decided a long way above your head.")),
    here && logSection(s),
  ]);
}

export function shipMenu() {
  const g = app.ui.game;
  if (!g.role.captain) return outsiderShip(g);
  return twoColumns(
    [statusSection(g), suppliesSection(g.ship), storesSection(g.ship), medbaySection(g.ship), workshopSection(g.ship), systemsSection(g)],
    [ordersSection(g), rationsSection(g.ship), councilSection(g.ship), logSection(g.ship), crewSection(g)],
  );
}
