// The Ship menu: the Meridian's numbers, where she is, her purse and what a day costs her, what's aboard, the rations,
// buying and selling at the dock, waiting, what the officers decided, her log, her systems and her crew. Everything here is drawn from the game's
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

// "a third full" for 0.33, "40 percent full" for anything that isn't a plain fraction.
const shareWords = (share) => (Math.abs(share - 1 / 3) < 0.02 ? "a third full" : Math.abs(share - 0.5) < 0.01 ? "half full" : Math.abs(share - 0.25) < 0.01 ? "a quarter full" : `${Math.round(share * 100)} percent full`);

// The ship's money: what's in her purse and what comes in, what a day costs at the dock she's at and how long the
// purse would last there, what she owes on a slate, and, when she can't get herself to any port, the distress call.
function purseSection(g) {
  const s = g.ship;
  const m = s.money;
  if (!m) return null;
  const plural = (n, word) => `${number(n)} ${word}${n === 1 ? "" : "s"}`;
  const costs = m.cost === null
    ? muted("In open space nothing's bought and nothing comes: she lives on what's aboard until she docks.")
    : el("div", { class: "stack gap-small" },
      el("div", { class: `small${m.cost > m.levy ? " tone-bad" : ""}` }, `A day at ${m.dock.name} costs her about ${plural(m.cost, "credit")}${m.cost > m.levy ? (m.moneyDays > 0 ? `, more than comes in: the purse lasts about ${plural(m.moneyDays, "day")} here.` : ", more than comes in, and the purse is empty.") : ", which the levy covers."}`),
      muted(`That's the fuel cells her generator burns, the fuel she uses keeping station, ${m.dock.water ? "the water she uses, " : ""}and what goes of food, medicine and parts beyond what's made aboard, at this dock's prices today. ${m.dock.cell || m.dock.crate ? `The dock keeps the shuttle stores stocked every ${m.dock.every} hours${m.dock.cell ? `, fuel cells at ${m.dock.cell} cr` : ""}${m.dock.crate ? `${m.dock.cell ? " and" : ","} ration crates at ${m.dock.crate} cr` : ""}, out of its own stores.` : "Nothing here restocks the shuttle stores."}${m.dock.water ? ` It fills the water tank too, at ${m.dock.water} cr a tank.` : ""}`));
  const slate = (one) => el("div", { class: "stack gap-small" },
    el("div", { class: "menu-row small tone-bad" }, el("span", {}, `Owed at ${one.name}`), el("strong", {}, `${number(one.owed)} cr`)),
    muted(`On the slate since day ${one.since + 1}. Whatever's left in the purse at midnight goes to it${one.holder ? `, and your standing with the ${one.holder.replace(/^The /, "")} falls by ${m.slate.falls} a day until it's paid` : ""}.`));
  const stranded = s.stranded && el("div", { class: "stack gap-small" },
    s.stranded.words ? el("div", { class: "small tone-bad" }, `She can't get herself to any port. ${s.stranded.words}`) : null,
    s.stranded.sent
      ? small(`The distress call is out. ${s.stranded.due > 0 ? `About ${plural(s.stranded.due, "day")} until someone answers.` : "Someone should be here any hour."}`)
      : [el("div", {}, el("button", { class: "primary", disabled: cannotAct(), onclick: shipOrder({ action: "distress" }) }, "Send a distress call")),
        muted(`Answered in about ${plural(s.stranded.days, "day")}${s.stranded.from ? ` by a tanker out of ${s.stranded.from}` : ""}, with enough to reach port, at ${s.stranded.times === 2 ? "twice" : `${s.stranded.times} times`} the usual price. What the purse can't pay is owed there.`)]);
  return section("The ship's purse",
    el("div", { class: "menu-row" }, el("strong", {}, `${number(m.purse)} credits`), el("strong", {}, `+${m.levy} a day`)),
    muted("The ship's own money, apart from yours. It pays for everything bought for her, and what she sells and carries is paid into it."),
    costs,
    m.slates.map(slate),
    m.slates.length ? muted(`While she owes, the dock only keeps her going: it fills the shuttle stores ${shareWords(m.slate.share)}, not to the top.`) : null,
    stranded,
    folded("ship-purse-own", `Put in your own credits (you have ${number(g.credits)})`,
      muted("Your own money is yours. Put some into the purse and it's the ship's from then on."),
      el("div", { class: "row" }, [50, 200].map((n) => el("button", { disabled: cannotAct() || g.credits < n, onclick: shipOrder({ action: "purse", n }) }, `Put in ${n}`)))));
}

// The fuel cells the generator burns, on the Stores list beside the tank: how many are aboard and how long they last.
function cellsLine(s) {
  const c = s.money?.cells;
  if (!c) return null;
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, c.n / Math.max(1, c.of))) * 10)).padEnd(10, "-");
  const low = c.n <= 0 || (c.days <= 5 && !c.holding);
  const dock = s.money.dock;
  return el("div", { class: `ship-supply${low ? " low" : ""}` },
    el("div", { class: "ship-supply-line" },
      el("span", {}, `${"CELLS".padEnd(8)} [${bar}] ${c.n}`),
      el("strong", {}, c.n <= 0 ? "OUT" : c.holding ? "holding" : `${c.days} ${c.days === 1 ? "day" : "days"} left`)),
    muted(`Fuel cells for the generator: it burns ${c.aDay} a day, and without one nothing aboard has power. ${c.holding ? `${dock.name} sells them and the dock keeps her ${s.money.slates.length ? `going, ${shareWords(s.money.slate.share)} while she owes` : "stocked"}. Away from a dock, what's aboard lasts ${c.days} ${c.days === 1 ? "day" : "days"}.` : dock?.cell ? `${dock.name} sells them, but the purse can't keep up.` : dock ? `Nobody at ${dock.name} sells them: a port that sells fuel does.` : "In open space nothing comes."}`));
}

// Her water, on the Stores list: how much is in the tank, how long it lasts as things stand, and whether it's rationed.
function waterLine(s) {
  const w = s.water;
  if (!w) return null;
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, w.n / Math.max(1, w.of))) * 10)).padEnd(10, "-");
  const out = w.n <= 0;
  const low = out || w.rationed || Boolean(w.pumps) || (w.days !== null && w.days <= 5 && !w.holding);
  const dock = s.money?.dock;
  const left = out ? "OUT" : w.holding ? "holding" : w.days === null ? "" : `${w.days} ${w.days === 1 ? "day" : "days"} left`;
  const where = w.holding
    ? `${dock.name} sells it by the tank, ${dock.water} cr for ${w.fills} measures, and the dock keeps the tank up. Away from a dock, what's aboard lasts about ${w.days} ${w.days === 1 ? "day" : "days"}.`
    : dock?.water ? `${dock.name} sells it, but the purse can't keep up.`
      : dock ? `Nobody at ${dock.name} sells water.`
        : "In open space nothing comes.";
  return el("div", { class: `ship-supply${low ? " low" : ""}` },
    el("div", { class: "ship-supply-line" },
      el("span", {}, `${"WATER".padEnd(8)} [${bar}] ${w.n} of ${w.of}`),
      el("strong", {}, [left, w.rationed ? "rationed" : null].filter(Boolean).join(", "))),
    muted(`Measures of water in the ${w.name}, ${w.room}. Everyone aboard drinks from it, and the galley, the Garden and the air plant take theirs: about ${w.aDay} a day as things stand.${w.pumps ? ` The pumps are stopped, so nothing that's used comes back and it's going ${w.pumps} times as fast.` : ""}${w.rationed ? ` ${w.by ?? "The quartermaster"} has it on ration: everyone gets half, and so does whatever grows.` : ""}${out ? ` With none, the galley can't cook, nothing grows, and the air plant ${w.plant === false ? "has stopped" : "stops when it has used what it had"}.` : ""} ${where}`));
}

// Her reserve air, under the water: how many hours are in the tanks, and whether she's breathing them.
function airLine(s) {
  const a = s.air;
  if (!a) return null;
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, a.hours / Math.max(1, a.of))) * 10)).padEnd(10, "-");
  const hours = (n) => `${n} ${n === 1 ? "hour" : "hours"}`;
  const left = a.stopped ? (a.out ? "OUT" : `${hours(a.hours)} left`) : a.full ? "full" : "filling";
  const now = a.stopped
    ? `${a.dry ? "The air plant has no water to make air from" : "The air plant is stopped"}, ${a.out ? "and there's none left: nobody lasts more than a few hours like this." : "so she's breathing it now."}`
    : a.full ? "" : "The air plant is filling them again, from the water tank.";
  return el("div", { class: `ship-supply${a.stopped ? " low" : ""}` },
    el("div", { class: "ship-supply-line" },
      el("span", {}, `${"AIR".padEnd(8)} [${bar}] ${a.hours} of ${hours(a.of)}`),
      el("strong", {}, left)),
    muted(`Reserve air in the ${a.name}, ${a.room}: what everyone breathes while the air plant is stopped, and what fills a breached room again once it's patched.${now ? ` ${now}` : ""}${a.tank ? ` A full reserve tank from a port, fitted there by hand, adds ${hours(a.tank)}.` : ""}`));
}

// The crew's comforts, under the air: how much drink, tea and tobacco, and clothes are left in the store they're kept
// in, what they're doing to morale, the provisions for a good table, and, at a dock that sells them, a button to buy
// each for the crew out of the ship's purse.
const COMFORT_LABELS = { drink: "DRINK", leaf: "TEA", clothes: "CLOTHES" };
function comfortsLine(s) {
  const c = s.comforts;
  if (!c) return null;
  const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
  const out = c.kinds.filter((one) => one.out);
  const row = (one) => {
    const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, one.left / Math.max(1, one.of))) * 10)).padEnd(10, "-");
    return el("div", { class: `ship-supply-line${one.out ? " tone-bad" : ""}` },
      el("span", {}, `${(COMFORT_LABELS[one.id] ?? one.name.toUpperCase()).padEnd(8)} [${bar}] ${one.left}`),
      el("strong", {}, one.out ? "OUT" : one.days === null ? "" : `${days(one.days)} left`));
  };
  // "drink, tea and tobacco": a comma where a name has an and of its own.
  const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")}${names.some((name) => name.includes(" and ")) ? "," : " and"} ${names.at(-1)}` : names[0] ?? "");
  const now = c.shift > 0 ? ` Things are going wrong, and what the crew still has is steadying them: morale settles ${c.shift} higher than it would.`
    : c.shift < 0 ? ` Going without ${list(out.map((one) => one.name))} is souring the mood: morale settles ${-c.shift} lower than it would.`
      : out.length ? ` They've run out of ${list(out.map((one) => one.name))}, and what's left is making up for it.` : "";
  const table = c.table
    ? ` For a good table there ${c.table.hampers === 1 ? "is 1 hamper" : `are ${c.table.hampers || "no"} hampers`} of provisions${c.table.hampers ? `, enough for ${number(c.table.seats)}` : ""}: after a hard day, when spirits are low, whoever keeps the stores has them laid out at the evening sitting, and morale lifts by up to ${c.table.lifts} at once.${c.table.last ? ` The last was on day ${c.table.last.day}, after ${c.table.last.why}.` : ""}`
    : "";
  const purse = s.money?.purse ?? 0;
  const offer = (o) => {
    const why = !o.has ? `Nobody at ${s.atName} has any left to sell` : o.have >= o.of ? `The ${c.store} has no room for another` : purse < o.price ? "The purse can't cover it" : "";
    return el("button", { disabled: cannotAct() || Boolean(why), title: why || `${o.worth}. ${o.have} of ${o.of} in the ${c.store}.`, onclick: shipOrder({ action: "comfort-buy", id: o.id }) }, `${o.name}, ${o.price} cr`);
  };
  // Only what's run out is in red: the rows that are, and the heading that says which.
  const short = (one) => (COMFORT_LABELS[one.id] ?? one.name).toLowerCase();
  return el("div", { class: "ship-supply" },
    el("div", { class: `ship-supply-line${out.length ? " tone-bad" : ""}` }, el("span", {}, "COMFORTS"), el("strong", {}, out.length ? `out of ${list(out.map(short))}` : "")),
    c.kinds.map(row),
    muted(`The crew's comforts, in the ${c.store}, ${c.room}: everyone aboard uses them up a little every day, ${list(c.kinds.map((one) => `${one.aDay} of ${one.name}`))}. While things are going wrong, each one they still have steadies morale by ${c.steadies}; each one they've run out of sours it by ${c.sours}, slowly.${now}${table}`),
    c.offers?.length
      ? [small(`${s.atName} sells them. For the crew, out of the ship's purse, straight into the ${c.store}:`), el("div", { class: "row ship-comforts-buy" }, c.offers.map(offer))]
      : muted(s.at ? `Nobody at ${s.atName} sells them.` : "In open space nothing comes: they're bought at a dock."));
}

function supplyLine(s) {
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, s.stock / s.max)) * 10)).padEnd(10, "-");
  const left = s.out ? "OUT" : s.days === null ? "holding" : `${s.days} ${s.days === 1 ? "day" : "days"} left`;
  return el("div", { class: `ship-supply${s.out || s.low ? " low" : ""}` },
    el("div", { class: "ship-supply-line" },
      // To a tenth: a few tins or a medkit handed in count for their share of a crate, and anything smaller isn't shown.
      el("span", {}, `${s.name.toUpperCase().padEnd(8)} [${bar}] ${Math.round(s.stock * 10) / 10}${s.unit ? ` ${s.unit}` : ""}`),
      el("strong", {}, left)),
    muted(s.bought > 0 ? `Makes ${s.made}, uses ${s.used}, and the dock sends the rest, ${s.bought} a day, for the purse to pay.` : `Makes ${s.made}, uses ${s.used}, so ${signed(s.net)} a day.`));
}

const suppliesSection = (s) => section("Stores", s.supplies.map(supplyLine), cellsLine(s), waterLine(s), airLine(s), comfortsLine(s), muted("Food, medicine and parts are what's in the rooms' stores below, counted together, and fuel is the tank. Anything else that's food in the pantry, medicine in the cabinet or a spare in the lockers counts for its share of a crate. The ship's daily needs and the engineers take a crate when they've used one up, at midnight, the medbay opens one from its cabinet when its doses run out, and the kettle feeds everyone through the day. With parts aboard the engineers mend the hull a little each day; without them, she wears."));

// What's kept where, room by room, from world/logistics: each store is a thing in a room you can walk to and open,
// each machine takes from one and puts into another on the clock, and the whole ship eats from the kettle.
function storesSection(s) {
  if (!s.stores?.length) return null;
  const count = (n) => n.toLocaleString("en-US");
  const line = (store) => {
    // What a store keeps is counted in its own words, "12 ration crates". Anything else that's been put in it, a tin or
    // a medkit handed in, is listed as it's named, "100 × tinned fish", since not every name takes an s.
    // "4 kegs of beer and spirits": the s goes on the first word of a thing that's so much of something.
    const many = (name, n) => {
      const low = name.toLowerCase();
      if (n === 1 || /produce$/.test(low)) return low;
      const of = low.indexOf(" of ");
      if (of > 0) return `${low.slice(0, of)}s${low.slice(of)}`;
      return /s$/.test(low) ? low : `${low}s`;
    };
    const kept = (one) => `${one.n}${one.of && one.n !== one.of ? ` of ${one.of}` : ""} ${many(one.name, one.of || one.n)}`;
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
    s.refills?.length ? [el("h4", { class: "small" }, "Restocking"), s.refills.map(refill), muted(`${s.refills.some((r) => r.from === "dock") ? "At a dock that sells them, what's missing is bought out of the port's own stores and paid for from the ship's purse. In open space nothing comes. " : ""}${s.refills.some((r) => r.from !== "dock") ? "What's from nothing comes from nowhere, wherever she is. " : ""}The manifest on the clip in the lighter bay, and the ship's computers, say what came and when.`)] : null,
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
        el("div", { class: "small" }, `Trade with ${s.atName}, for the ship. Her purse holds ${number(s.money?.purse ?? 0)} credits. Prices move with what's left here, and with each lot you buy or sell.`),
        s.trade.map((t) => el("div", { class: "menu-row small ship-trade" },
          el("span", { title: t.why ?? "" }, `${t.amount} of ${t.name.toLowerCase()}`, t.level && el("span", { class: "muted ship-trade-level" }, ` ${t.level}${t.has ? `, ${t.has} here` : ""}`)),
          el("span", { class: "row" },
            el("button", { disabled: cannotAct() || !t.spare, title: t.spare ? "" : "The ship hasn't got that much", onclick: shipOrder({ action: "sell", id: t.id }) }, `Sell ${t.sellFor} cr`),
            el("button", {
              disabled: cannotAct() || t.none || t.full || !t.buys || !t.pays,
              title: t.none ? "Nobody here has any left to sell" : !t.buys ? "There's no room aboard for more" : !t.pays ? "The purse can't cover it, and this port won't put any more on the slate" : t.pays === "slate" ? `The purse can't cover it: ${t.slate} credits would be owed on the slate here` : "",
              onclick: shipOrder({ action: "buy", id: t.id }),
            }, t.none ? "None left" : `Buy ${t.buys && t.buys !== t.amount ? `${t.buys}, ` : ""}${t.price} cr${t.pays === "slate" ? ", on the slate" : ""}`)))))
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
    [statusSection(g), purseSection(g), suppliesSection(g.ship), storesSection(g.ship), medbaySection(g.ship), workshopSection(g.ship), systemsSection(g)],
    [ordersSection(g), rationsSection(g.ship), councilSection(g.ship), logSection(g.ship), crewSection(g)],
  );
}
