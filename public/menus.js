// What's inside each slide-over menu. Everything shown here comes straight from the
// game's state, so a menu can never disagree with the rules.

import { checkStyle, setCheckStyle } from "./check.js";
import { api, columns, el, folded, meter, signed, strainMeter } from "./dom.js";
import { mapMenu } from "./map.js";
import { shipMenu } from "./ship.js";
import { commandMenu } from "./command.js";
import { oddsFor } from "./story.js";

// What the menus need from the main screen. Set once, when the page loads.
let app;

export function initMenus(hooks) {
  app = hooks;
}

// ---- Shared pieces ------------------------------------------------------

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);
const small = (text) => el("div", { class: "small" }, text);
const empty = (text) => el("div", { class: "muted" }, text);

function row(label, value, hint) {
  return el("div", { class: "menu-row" },
    el("span", {}, label, hint && el("span", { class: "muted small" }, ` ${hint}`)),
    el("strong", {}, String(value)));
}


// ---- People -------------------------------------------------------------

const PEOPLE_FILTERS = {
  all: ["Everyone", () => true],
  crew: ["Crew", (p) => p.crew],
  met: ["Met", (p) => p.met],
  heard: ["Heard of", (p) => !p.met],
};

function personCard(p, focus) {
  const facts = [p.pronouns, p.species, p.age && `age ${p.age}`].filter(Boolean).join(", ");
  const where = [p.faction, p.location && `usually at ${p.location}`].filter(Boolean).join(", ");
  return el("div", {
    class: `card stack gap-small${focus === p.loreId ? " focused" : ""}`,
    "data-focus": p.loreId,
    style: `--speaker:${p.color ?? "var(--lore)"}`,
  },
  el("div", { class: "spread" },
    el("strong", { class: "person-name" }, p.name),
    el("span", { class: "row" },
      p.status !== "alive" && el("span", { class: "tag bad" }, p.status),
      p.attitude ? el("span", { class: "tag" }, p.attitude) : el("span", { class: "tag" }, "not met"))),
  !p.note.startsWith(p.role) && el("div", { class: "small" }, p.role),
  facts && muted(facts),
  where && muted(where),
  el("div", { class: "muted small" }, p.note),
  p.appearance && el("div", { class: "muted small" }, p.appearance),
  p.history && el("div", { class: "small" }, `Between you: ${p.history}`),
  el("div", { class: "small" }, [p.threat && `Threat: ${p.threat}`, `Shared beliefs: ${signed(p.sharedBeliefs)}%`].filter(Boolean).join(". ")),
  p.relationship !== 0 && el("div", { class: "effects small" }, `${signed(p.relationship)} on social checks with them`));
}

function peopleMenu() {
  const { ui, renderMenus } = app;
  const g = ui.game;
  const filter = PEOPLE_FILTERS[ui.peopleFilter] ? ui.peopleFilter : "all";
  const shown = g.people.filter(PEOPLE_FILTERS[filter][1]);
  return [
    el("div", { class: "menu-intro" },
      el("div", { class: "row" }, Object.entries(PEOPLE_FILTERS).map(([id, [label]]) => el("button", {
        class: id === filter ? "primary" : "",
        "aria-pressed": String(id === filter),
        onclick: () => { ui.peopleFilter = id; renderMenus(); },
      }, label)))),
    shown.length ? el("div", { class: "menu-cards" }, shown.map((p) => personCard(p, ui.menuFocus))) : empty("Nobody here yet."),
  ];
}

// ---- Quests -------------------------------------------------------------
// The quests are the tracker in the room's top left corner, which grows into the quest log: public/quests.js.

// ---- Leads --------------------------------------------------------------

const LEAD_KINDS = { job: "job", mystery: "mystery", crew: "crew", politics: "politics", survival: "survival", exploration: "exploration", dilemma: "dilemma", faction: "faction", main: "the Beacon" };

function leadsMenu() {
  const { ui, followLead } = app;
  const g = ui.game;
  const { here, rumors, active, done, moved } = g.story;
  const busy = ui.streaming || Boolean(g.combat) || Boolean(g.check);
  const card = (lead, action) => el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, lead.title), el("span", { class: "row" },
      lead.moved && el("span", { class: "tag" }, "it's moved on"),
      el("span", { class: lead.kind === "main" ? "tag on" : "tag" }, LEAD_KINDS[lead.kind] ?? lead.kind))),
    el("div", { class: "small" }, lead.lead),
    action);
  return [
    columns(
      section(`Leads here, at ${g.location.name}`,
        here.length
          ? here.map((lead) => card(lead, el("div", { class: "row" }, !lead.written
            ? el("span", { class: "muted small", title: "This story hasn't been written out yet. It plays out by itself for now, and the news says how it's going." }, "Not written yet")
            : el("button", { disabled: busy, onclick: () => followLead(lead) }, "Look into this"))))
          : empty("Nothing new here at the moment. Try somewhere else, or come back later.")),
      section("What people are saying",
        rumors.length
          ? rumors.map((rumor) => el("div", { class: "menu-entry" }, el("div", { class: "small" }, `"${rumor}"`)))
          : muted("Nobody's saying much here.")),
      section(`Following (${active.length})`,
        active.length ? active.map((lead) => card(lead)) : muted("Stories you take up will be listed here, along with your Quests.")),
      done.length > 0 && folded("leads-finished", `Finished (${done.length})`, done.map((lead) => el("div", { class: "menu-entry small" }, lead.title))),
      moved?.length > 0 && folded("leads-moved", `Moved on without you (${moved.length})`, moved.map((entry) => el("div", { class: "menu-entry small" },
        el("div", {}, el("strong", {}, entry.title), el("span", { class: "muted" }, ` Day ${entry.day}`)),
        el("div", {}, entry.text)))),
    ),
  ];
}

// ---- Codex --------------------------------------------------------------

const CODEX_GROUPS = { faction: "Factions", place: "Places", ship: "Ships", people: "Peoples", concept: "Concepts", person: "People" };

function codexMenu() {
  const { ui, loreCatalog } = app;
  const g = ui.game;
  const inCodex = (e) => e.id.startsWith("custom:") || (e.kind !== "person" && g.seenLore.includes(e.id));
  const found = loreCatalog().filter(inCodex);
  const total = ui.setup.lore.filter((e) => e.kind !== "person").length + g.lore.length;
  const results = el("div", { class: "menu-cards" });
  const draw = () => {
    const search = (ui.codexSearch ?? "").trim().toLowerCase();
    const shown = search ? found.filter((e) => `${e.name} ${e.text}`.toLowerCase().includes(search)) : found;
    results.replaceChildren(...Object.entries(CODEX_GROUPS).flatMap(([kind, label]) => {
      const entries = shown.filter((e) => e.kind === kind);
      return entries.length ? [section(label, entries.map((e) => el("div", {
        class: `card${ui.menuFocus === e.id ? " focused" : ""}`,
        "data-focus": e.id,
        ...(e.color ? { style: `--speaker:${e.color}` } : {}),
      },
      el("strong", { class: `codex-name lore-${e.kind}` }, e.name),
      muted(e.text),
      e.status && el("div", { class: "effects small" }, e.status))))] : [];
    }));
    if (!shown.length) results.replaceChildren(empty("Nothing matches that."));
  };
  draw();
  return [
    el("div", { class: "menu-intro" },
      el("div", { class: "small" }, `${found.length} of ${total} entries found.`),
      el("input", {
        type: "text",
        placeholder: "Search the codex",
        "aria-label": "Search the codex",
        autocomplete: "off",
        value: ui.codexSearch ?? "",
        oninput: (e) => { ui.codexSearch = e.target.value; draw(); },
      })),
    results,
  ];
}

// ---- Ship: in ship.js, and the star map in map.js ---------------------------

// ---- Market -------------------------------------------------------------

// Why the prices here are what they are today.
function marketNote(g) {
  const goods = g.world.here?.goods ?? [];
  const short = goods.filter((good) => good.low).map((good) => good.id);
  const plenty = goods.filter((good) => good.high).map((good) => good.id);
  const list = (names) => names.join(" and ");
  return [
    short.length > 0 && small(`There's not much ${list(short)} here today, so what's made from it costs more.`),
    plenty.length > 0 && small(`There's plenty of ${list(plenty)} here today, so what's made from it costs less.`),
  ];
}

function marketMenu() {
  const { ui, act } = app;
  const g = ui.game;
  if (!g.market.length) {
    const elsewhere = g.locations.filter((l) => l.hasMarket).map((l) => l.name);
    return [
      section(`Credits: ${g.credits}`,
        empty(`There's no market at ${g.location.name}.`),
        elsewhere.length > 0 && small(`Known markets: ${elsewhere.join(", ")}.`)),
    ];
  }
  const sellable = g.inventory.filter((i) => !(i.type === "story" && i.price === 0));
  return columns(
    section(`Market at ${g.location.name}`,
      row("Your credits", g.credits),
      marketNote(g),
      g.market.map((i) => el("div", { class: "card stack gap-small" },
        el("div", { class: "spread" }, el("strong", {}, i.name), el("span", {}, `${i.buyPrice} cr`)),
        muted(i.desc),
        i.damage && small(`Damage ${i.damage[0]}-${i.damage[1]}`),
        i.defense > 0 && small(`Defense +${i.defense}`),
        el("div", {}, el("button", { disabled: g.credits < i.buyPrice || Boolean(g.combat), onclick: act({ action: "buy", id: i.id }) }, "Buy"))))),
    section("Sell",
      sellable.length ? sellable.map((i) => el("div", { class: "menu-row small" },
        el("span", {}, `${i.name}${i.count > 1 ? ` x${i.count}` : ""}`, i.equipped && el("span", { class: "tag on" }, " equipped")),
        el("button", { disabled: Boolean(g.combat), onclick: act({ action: "sell", id: i.id }) }, `Sell ${i.sellPrice} cr`))) : muted("Nothing to sell.")),
  );
}

// ---- Bestiary -----------------------------------------------------------

function bestiaryMenu() {
  const { ui, startSim } = app;
  const g = ui.game;
  const p = g.combatProfile;
  return [
    el("div", { class: "menu-cards" }, g.enemies.map((e) => el("div", { class: "card stack gap-small" },
      el("div", { class: "spread" }, el("strong", {}, e.name), e.threat && el("span", { class: "tag" }, e.threat)),
      muted(e.desc),
      small(`Health ${e.hp}, attack ${signed(e.attack)}, defense ${e.defense}, damage ${e.damage[0]}-${e.damage[1]}${e.weapon ? `, ${e.weapon}` : ""}.`),
      small(`You'd hit it ${oddsFor(p.attack, e.defense)}% of the time, and it would hit you ${oddsFor(e.attack, p.defense)}% of the time.`),
      small(`${e.talk.why} ${e.talk.could.length ? `You could try: ${e.talk.could.join(", ").toLowerCase()}.` : "There's no talking to it."}`),
      e.record && muted(`Fought ${e.record.fought}: won ${e.record.won}, lost ${e.record.lost}, ran ${e.record.fled}${e.record.talked ? `, talked down ${e.record.talked}` : ""}${e.record.gaveUp ? `, gave up ${e.record.gaveUp}` : ""}.`),
      el("div", { class: "row" },
        el("button", { disabled: !e.canSim, onclick: () => startSim(e.id) }, "Run in simulator"),
        el("button", { disabled: !e.canSim, onclick: () => startSim(e.id, true), title: "A crew member fights beside you and another comes running, while more of them arrive too." }, "With followers"))))),
    g.enemies.length > 0 && !g.enemies[0].canSim && !g.combat && muted("The simulator is aboard the Meridian."),
    g.enemiesUnseen > 0 && muted(`${g.enemiesUnseen} more ${g.enemiesUnseen === 1 ? "type" : "types"} of enemy you haven't faced yet.`),
  ];
}

// ---- Settings -----------------------------------------------------------

const fileEntry = (label, where) => el("div", { class: "menu-entry small" }, label, el("span", { class: "muted" }, where));

function settingsMenu() {
  const { ui, runAction, reading, changeReading, textSizes, toggleFullScreen, loadGame, toTitle } = app;
  // A row of buttons, with the one that's on lit up.
  const pickRow = (label, key, picks) => el("div", { class: "row small" }, label, picks.map(([value, name, title]) => el("button", {
    class: reading[key] === value ? "primary" : "",
    "aria-pressed": String(reading[key] === value),
    ...(title ? { title } : {}),
    onclick: () => changeReading({ [key]: value }),
  }, name)));
  const g = ui.game;
  return columns(
    section("Reading",
      pickRow("Story over the room:", "story", [
        ["popups", "Popups", "What people say comes up in a window over their heads"],
        ["box", "One box", "Everything comes up in the one window along the bottom"],
        ["panel", "Under the room", "The story stays in a panel under the room"],
      ]),
      pickRow("People's words:", "writing", [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"], ["instant", "All at once"]]),
      pickRow("Popup font:", "popFont", [["terminal", "Terminal"], ["book", "Book"]]),
      el("div", { class: "row small" }, "Story font:",
        el("button", { class: reading.font === "book" ? "primary" : "", "aria-pressed": String(reading.font === "book"), onclick: () => changeReading({ font: "book" }) }, "Book"),
        el("button", { class: reading.font === "terminal" ? "primary" : "", "aria-pressed": String(reading.font === "terminal"), onclick: () => changeReading({ font: "terminal" }) }, "Terminal")),
      el("div", { class: "row small" }, "Text size:",
        el("button", { "aria-label": "Smaller story text", disabled: reading.size <= textSizes.min, onclick: () => changeReading({ size: reading.size - 1 }) }, "-"),
        String(reading.size),
        el("button", { "aria-label": "Larger story text", disabled: reading.size >= textSizes.max, onclick: () => changeReading({ size: reading.size + 1 }) }, "+")),
      el("div", { class: "row small" }, "Story view:",
        el("button", { class: reading.view === "iso" ? "primary" : "", "aria-pressed": String(reading.view === "iso"), onclick: () => changeReading({ view: "iso" }) }, "Isometric"),
        el("button", { class: reading.view === "walk" ? "primary" : "", "aria-pressed": String(reading.view === "walk"), onclick: () => changeReading({ view: "walk" }) }, "Walk-around"),
        el("button", { class: reading.view === "classic" ? "primary" : "", "aria-pressed": String(reading.view === "classic"), onclick: () => changeReading({ view: "classic" }) }, "Classic")),
      folded("settings-views", "What the story views mean",
        muted("Isometric shows the room you're in, seen from an angle, wherever you are, and you can walk around and click on people and things. The story comes up over the room a piece at a time: click anywhere to go on. Walking is free. The clock runs while you explore, because everyone lives their own day, and the buttons at the top of the room pause it or speed it up. The clock stops while you talk to someone."),
        muted("Walk-around is the same thing, drawn in console art, with the story under it. Classic gives the story the whole window, and only the story moves the clock. Popup font is for the story over the room, and Story font is for the whole story, Classic and the panel under the room."))),
    folded("settings-display", "Display",
      pickRow("Interface size:", "interface", [
        ["auto", "Automatic", "Everything grows with the window, so it looks the same on any screen"],
        ["small", "Small"],
        ["normal", "Normal"],
        ["large", "Large"],
        ["largest", "Largest"],
      ]),
      el("div", { class: "row small" }, "Full screen:", el("button", { "aria-pressed": String(Boolean(document.fullscreenElement)), onclick: toggleFullScreen }, document.fullscreenElement ? "Leave full screen" : "Go full screen")),
      muted("You can also press F11 for full screen, and pull the edges of the window to make it any size. Automatic makes everything bigger in a bigger window, so it looks the same on any screen. A size can't go past what still fits in the window.")),
    folded("settings-checks", "Skill checks",
      el("div", { class: "row small" }, "Checks open as:",
        el("button", { class: checkStyle() === "play" ? "primary" : "", "aria-pressed": String(checkStyle() === "play"), onclick: () => { setCheckStyle("play"); app.renderMenus(); } }, "A game"),
        el("button", { class: checkStyle() === "roll" ? "primary" : "", "aria-pressed": String(checkStyle() === "roll"), onclick: () => { setCheckStyle("roll"); app.renderMenus(); } }, "Just a roll")),
      muted("Playing a check's window well improves your odds. If you'd rather not, a check can go straight to the roll, at your character's own odds. Either way, the Skills menu lets you practice any of them.")),
    folded("settings-fights", "Fights",
      el("div", { class: "row small" }, "How hard enemies fight:",
        [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]].map(([id, label]) => el("button", {
          class: g.difficulty === id ? "primary" : "",
          "aria-pressed": String(g.difficulty === id),
          disabled: Boolean(g.combat),
          onclick: app.act({ action: "difficulty", id }),
        }, label))),
      muted("Stronger enemies get more health, hit more often and hit harder at Normal and Hard. Your followers stay the same. On Hard, anyone who can't fight will usually lose to anything above a minor threat, unless they bring help or run. It applies from your next fight.")),
    section("Saved games",
      ["slot1", "slot2", "slot3"].map((slot) => {
        const save = ui.saves.find((x) => x.slot === slot);
        return el("div", { class: "menu-row small" },
          el("span", {}, `Slot ${slot.slice(-1)}: `, save?.empty ? el("span", { class: "muted" }, "empty") : `${save.name}, level ${save.level}`),
          el("span", { class: "row" },
            el("button", { disabled: ui.streaming, onclick: runAction(async () => {
              ui.saves = (await api("/api/save", { slot })).saves;
              ui.menuMessage = { ok: true, text: `Saved to slot ${slot.slice(-1)}.` };
            }) }, "Save"),
            !save?.empty && el("button", { disabled: ui.streaming, onclick: runAction(() => loadGame(slot)) }, "Load")));
      }),
      el("div", {}, el("button", { disabled: ui.streaming, onclick: toTitle }, "Title screen"))),
    folded("settings-files", "Your files",
      small("The world is kept in files on this computer, inside the game's folder. You can open them with any text editor. If you change one, restart the game to see the change."),
      fileEntry(`${g.files.worldCharacters} important characters`, `${g.files.world}\\characters`),
      fileEntry(`${g.enemiesTotal - g.files.campaignEnemies} enemy types`, `${g.files.world}\\enemies`),
      fileEntry("Everything said in a fight", `${g.files.world}\\combat-text.json`),
      fileEntry("The written story, which you can change while the game is running", `${g.files.world}\\scenes`),
      g.files.campaign && fileEntry(`This campaign: ${g.files.campaignCharacters} ${g.files.campaignCharacters === 1 ? "person" : "people"} and ${g.files.campaignEnemies} enemy ${g.files.campaignEnemies === 1 ? "type" : "types"} added, plus your character's sheet`, g.files.campaign)),
  );
}

// ---- The list of menus --------------------------------------------------

// about is what a menu holds, for the tooltip on its button: it isn't written on the screen.
export const MENUS = {
  people: { label: "People", command: "people", about: "Everyone you've met or heard of", view: peopleMenu },
  board: { label: "Story board", command: "board", about: "Every story as boxes and arrows, to read and change, saved to its file", board: true, view: () => el("div") },
  leads: { label: "Leads", command: "leads", about: "Stories you could start here, and what people are saying", view: leadsMenu },
  codex: { label: "What you know", command: "codex", about: "Places, factions, ships and ideas you've come across", view: codexMenu },
  inventory: { label: "Inventory", command: "inv", about: "What you're carrying and wearing, on a grid, or press I", window: "bag" },
  ship: { label: "Ship", command: "ship", about: "The Meridian: her stores, rations, orders, systems and crew. If you aren't the captain, how she stands", view: shipMenu },
  command: { label: "Command", command: "command", about: "Who holds each post aboard the Meridian, who chose them, and since when", view: commandMenu },
  map: { label: "Star map", command: "map", about: "The chart of known space, and setting course", view: mapMenu },
  market: { label: "Market", command: "market", about: "Buying and selling, where there's a market", view: marketMenu },
  bestiary: { label: "Enemies met", command: "bestiary", about: "Enemies you know of, how they fight, and the simulator", view: bestiaryMenu },
  mapedit: { label: "Map editor", command: "mapedit", about: "Redraw the ship's decks yourself: walls, floors, doors, rooms and what's in them", editor: true, view: () => el("div") },
  settings: { label: "Settings", command: "settings", about: "Reading, display, checks, fights, saved games, and your files", view: settingsMenu },
};

// The groups the menus sit in on the rail, each under its own heading.
export const MENU_GROUPS = [
  { title: "The story", ids: ["leads", "board", "people", "codex", "bestiary"] },
  { title: "The ship", ids: ["ship", "command", "map"] },
  { title: "Gear", ids: ["inventory", "market"] },
  { title: "Game", ids: ["mapedit", "settings"] },
];
