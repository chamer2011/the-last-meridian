// A place's logistics as plain text: world/logistics/<place>.txt. The file names the place, has a few numbers at
// the top, and one part each for Stores, Machines, Loads, Refills and Urgency, every line of them starting with -
// and a space. This only reads and writes the words, and reads a store's line into its pieces; which rooms, things,
// items and people they name is worked out by src/logistics.js, which knows the maps. It runs in the browser too,
// for the Story board. world/logistics/_how-to-write-logistics.txt explains the format.

export const LOGISTICS_PARTS = ["stores", "machines", "loads", "refills", "urgency"];
export const PART_TITLES = { stores: "Stores", machines: "Machines", loads: "Loads", refills: "Refills", urgency: "Urgency" };
// The kinds of work a place's board gives out, each with the words the Urgency part uses for it, in the order they
// come in when a file doesn't say: the most urgent first.
export const WORK_KINDS = [
  ["bleeding", "carrying someone who's bleeding"],
  ["fire", "a fire"],
  ["breach", "a breach"],
  ["fallen", "carrying someone who's down"],
  ["alarm", "the alarm"],
  ["carry_urgent", "urgent carrying"],
  ["repair_critical", "a repair the ship can't do without"],
  ["treat", "treating someone"],
  ["dead", "carrying the dead"],
  ["carry", "carrying"],
  ["repair", "a repair"],
  ["workshop", "mending in the workshop"],
];
const workWords = (words) => String(words ?? "").toLowerCase().replace(/[\u2019']/g, "").replace(/^the\s+/, "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
// "a repair the ship can't do without": one line of the Urgency part, to the kind of work it names.
export function readUrgencyLine(text) {
  const found = WORK_KINDS.find(([, words]) => workWords(words) === workWords(text));
  return found ? { kind: found[0] } : { problem: `"${text}" isn't a kind of work the board gives out: the kinds are ${WORK_KINDS.map(([, words]) => words).join("; ")}` };
}
export const workKindWords = (kind) => WORK_KINDS.find(([id]) => id === kind)?.[1] ?? kind;
// A part the file had until the stores said what they want themselves: who carried what from where to where.
const OLD_PARTS = { errands: "the Errands part isn't written any more: a store says what it wants kept in it and who carries for it on its own line, such as - pantry in The Galley: holds 12 ration crates; wants 4; carried by the deckhands" };

// The lines at the top of the file.
export const LOGISTICS_HEADER = [
  { key: "draft", path: "draft", type: "string" },
  { key: "everyone aboard eats", path: "numbers.eats", type: "number", unit: "sittings a day" },
  { key: "a crate feeds", path: "numbers.crateFeeds", type: "number", unit: "sittings", sample: 200 },
  { key: "sittings at", path: "sittings", type: "sittings" },
  { key: "a repair takes", path: "repair", type: "repair" },
  { key: "salvage makes", path: "making", type: "making" },
  { key: "carried by", path: "carriers", type: "carriers" },
  { key: "a trip carries", path: "trip", type: "trip" },
  { key: "what comes first", path: "first", type: "decider" },
  { key: "what stores want", path: "levels", type: "decider" },
  { key: "left waiting", path: "waiting", type: "waiting" },
  { key: "who asks", path: "askers", type: "askers" },
  // Water and reserve air (step 11 of the logistics rework, src/water.js).
  { key: "everyone aboard drinks", path: "numbers.drinks", type: "number", unit: "measures of water a day", sample: 9 },
  { key: "a tank of water fills", path: "numbers.tankFills", type: "number", unit: "measures", sample: 100 },
  { key: "with the pumps stopped", path: "numbers.pumpsStopped", type: "number", unit: "times as much water goes", sample: 4 },
  { key: "water is rationed under", path: "numbers.rationUnder", type: "number", unit: "measures", sample: 200 },
  { key: "a reserve tank gives", path: "numbers.tankAir", type: "number", unit: "hours of air", sample: 24 },
  { key: "a day of reserve air takes", path: "numbers.airTakes", type: "number", unit: "measures of water", sample: 4 },
  { key: "a breached room takes", path: "numbers.breachAir", type: "number", unit: "hours of reserve air", sample: 6 },
  { key: "a breached room fills in", path: "numbers.breachSlow", type: "number", unit: "hours with no reserve air", sample: 3 },
];

// "30 minutes if it's urgent, 3 hours if it isn't": how long a job stands with nobody able to do it, or nothing to
// do it with, before whoever it belongs to brings it to the player as something to ask.
const spanMinutes = (n, unit) => Number(n) * (/^hour/i.test(unit) ? 60 : /^day/i.test(unit) ? 1440 : 1);
const spanWords = (minutes) => (minutes % 1440 === 0 ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}` : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`);
export function readWaiting(words) {
  const text = String(words ?? "").trim().replace(/\.$/, "");
  const urgent = text.match(/(\d+)\s*(minutes?|hours?|days?)\s+(?:if|when)\s+it[\u2019']?s\s+urgent/i);
  const other = text.match(/(\d+)\s*(minutes?|hours?|days?)\s+(?:(?:if|when)\s+it\s+isn[\u2019']?t|otherwise)/i);
  if (!urgent || !other || !Number(urgent[1]) || !Number(other[1])) return { problem: `"${words}" should say how long for urgent work and how long for the rest, such as 30 minutes if it's urgent, 3 hours if it isn't` };
  return { urgent: spanMinutes(urgent[1], urgent[2]), other: spanMinutes(other[1], other[2]) };
}
export const writeWaiting = (one) => `${spanWords(one.urgent)} if it's urgent, ${spanWords(one.other)} if it isn't`;

// "the chief medical officer for the medbay, the chief engineer for the engines and repairs, the quartermaster for
// the galley, the deck chief for the rest": which post brings a job left waiting to the player, by the part of the
// ship the job belongs to.
export const ASK_PARTS = ["medbay", "engines", "galley", "repairs", "rest"];
const askPart = (words) => {
  const plain = String(words ?? "").trim().toLowerCase().replace(/^the\s+/, "");
  return plain === "everything else" ? "rest" : plain;
};
export function readAskers(words) {
  const list = [];
  for (const piece of String(words ?? "").replace(/\.$/, "").split(/\s*[,;]\s*/).map((one) => one.trim()).filter(Boolean)) {
    const found = piece.match(/^(.+?)\s+for\s+(.+)$/i);
    if (!found) return { problem: `"${piece}" should be a post, then for, then a part of the ship, such as the quartermaster for the galley` };
    const parts = found[2].split(/\s+and\s+/i).map(askPart);
    const bad = parts.find((one) => !ASK_PARTS.includes(one));
    if (bad) return { problem: `"${bad}" isn't a part of the ship an ask can be for: they are the medbay, the engines, the galley, repairs and the rest` };
    list.push({ who: found[1].trim(), parts });
  }
  if (!list.length) return { problem: "who asks names a post for each part of the ship, such as the quartermaster for the galley, the deck chief for the rest" };
  return { list };
}
export const writeAskers = (one) => one.list.map((entry) => `${entry.who} for ${entry.parts.map((part) => (part === "rest" ? "the rest" : part === "repairs" ? "repairs" : `the ${part}`)).join(" and ")}`).join(", ");

// "the first officer, every hour": the post that decides something on the work board, and how often whoever holds
// it looks at how the ship stands (sooner or later by their skill).
export function readDecider(words) {
  let text = String(words ?? "").trim().replace(/\.$/, "");
  let every = null;
  text = text.replace(/,?\s*(?:looking\s+)?every\s+(?:(\d+)\s+)?(minutes?|hours?|days?)\b/i, (_, n, unit) => {
    every = (Number(n) || 1) * (/^min/i.test(unit) ? 1 : /^hour/i.test(unit) ? 60 : 1440);
    return "";
  }).trim().replace(/,\s*$/, "");
  const who = text.replace(/^(?:decided\s+)?by\s+/i, "").trim();
  if (!who) return { problem: "this line needs the post that decides, such as the first officer, every hour" };
  if (!every) return { problem: `"${words}" needs to say how often they look, such as the first officer, every hour` };
  return { who, every };
}
export const writeDecider = (one) => `${one.who}, every ${everyWords(one.every)}`;

// "06:00, 12:00, 18:00, 22:00, each 90 minutes": when the whole ship eats, and how long each sitting lasts.
export function readSittings(words) {
  const text = String(words ?? "").trim();
  const each = text.match(/,?\s*each\s+(\d+)\s+minutes?\s*$/i);
  const times = (each ? text.slice(0, each.index) : text).split(/\s*,\s*|\s+and\s+/).map((one) => one.trim()).filter(Boolean);
  const at = [];
  for (const time of times) {
    const found = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!found || Number(found[1]) > 23 || Number(found[2]) > 59) return { problem: `"${time}" isn't a time of day: write the sittings as 06:00, 07:30, 18:00, 19:30, each 90 minutes` };
    at.push(Number(found[1]) * 60 + Number(found[2]));
  }
  if (!at.length) return { problem: "sittings at needs at least one time of day, such as sittings at: 06:00, 07:30, 18:00, 19:30, each 90 minutes" };
  const minutes = each ? Number(each[1]) : 90;
  if (!(minutes > 0)) return { problem: "each sitting needs to last some minutes, such as each 90 minutes" };
  return { at: [...at].sort((a, b) => a - b), minutes };
}
const clockWords = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
export const writeSittings = (value) => `${(value?.at ?? []).map(clockWords).join(", ")}, each ${value?.minutes ?? 90} minutes`;

const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function set(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  holder[keys.at(-1)] = value;
}

export const slugOf = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

// ---- Reading a file ---------------------------------------------------------------------------

// The file into { name, draft, numbers, carriers, trip, stores: [{ text, line }], machines: [...], loads: [...],
// refills: [...] }, with every line kept as words for src/logistics.js to make sense of.
export function parseLogisticsText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { name: id, numbers: {}, stores: [], machines: [], loads: [], refills: [], urgency: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const header = new Map(LOGISTICS_HEADER.map((field) => [field.key, field]));
  let titled = false;
  let section = null;
  const seen = new Set();
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (!line) continue;
    if (!titled) {
      titled = true;
      const title = line.match(/^#\s*(.+)$/);
      if (title) {
        value.name = title[1].trim();
        continue;
      }
      problem(n, "the first line is the place's name, written # The Name");
    }
    const heading = line.match(/^([A-Za-z][A-Za-z ]{0,30}):$/);
    if (heading) {
      const part = heading[1].trim().toLowerCase();
      if (OLD_PARTS[part]) {
        problem(n, OLD_PARTS[part]);
        section = "unknown";
        continue;
      }
      if (!LOGISTICS_PARTS.includes(part)) {
        problem(n, `"${heading[1].trim()}" isn't a part of a place's logistics: the parts are ${LOGISTICS_PARTS.map((one) => PART_TITLES[one]).join(", ")}`);
        section = "unknown";
        continue;
      }
      if (seen.has(part)) problem(n, `"${PART_TITLES[part]}" is written twice`);
      seen.add(part);
      section = part;
      continue;
    }
    const field = line.match(/^([a-z][a-z ]{0,30}):\s*(.*)$/i);
    if (section === null) {
      const known = field && header.get(field[1].trim().toLowerCase());
      if (!known) {
        problem(n, `before the first part, each line is one of ${LOGISTICS_HEADER.map((one) => one.key).join(", ")}, then a colon and its value`);
        continue;
      }
      const words = field[2].trim();
      if (known.type === "number") {
        const amount = words.match(/^(\d+(?:\.\d+)?)\b/);
        if (!amount) problem(n, `${known.key} is a number of ${known.unit}, such as ${known.key}: ${known.sample ?? 2} ${known.unit}`);
        else {
          set(value, known.path, Number(amount[1]));
          // Where each number was written, for whoever has something to say about it (src/logistics.js).
          (value.lines ??= {})[known.path.split(".").at(-1)] = n;
        }
      } else if (known.type === "sittings") {
        const read = readSittings(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, read);
      } else if (known.type === "repair") {
        const read = readRepair(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, { ...read, line: n });
      } else if (known.type === "making") {
        const read = readMaking(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, { ...read, line: n });
      } else if (known.type === "carriers") {
        const list = readCarriers(words);
        if (!list.length) problem(n, "carried by names who carries for a store that doesn't say, first to last, such as carried by: the deckhands, the spare hands");
        else set(value, known.path, { list, line: n });
      } else if (known.type === "trip") {
        const read = readTrip(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, { ...read, line: n });
      } else if (known.type === "decider") {
        const read = readDecider(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, { ...read, line: n });
      } else if (known.type === "waiting" || known.type === "askers") {
        const read = known.type === "waiting" ? readWaiting(words) : readAskers(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, { ...read, line: n });
      } else set(value, known.path, words);
      continue;
    }
    const entry = line.match(/^-\s+(.+)$/);
    if (!entry) {
      problem(n, `under each part, each line starts with - and a space, such as - pantry in The Galley: holds 12 ration crates`);
      continue;
    }
    if (section === "unknown") continue;
    value[section].push({ text: entry[1].trim(), line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with # The Name");
  return { value, problems };
}

// ---- The words of a store's line --------------------------------------------------------------

// "the deckhands, then the cooks, then the spare hands": who carries, first to last.
export const readCarriers = (words) => String(words ?? "").split(/\s*[,;]\s*|\s+then\s+/i).map((one) => one.trim().replace(/^(?:and\s+)?(?:then\s+)?/i, "").replace(/\.$/, "").trim()).filter(Boolean);

// "2 ration crates, 2 fuel cells, 4 produce": how many of each thing one person carries in a trip. Anything the
// line doesn't name is carried one at a time.
export function readTrip(words) {
  const list = [];
  for (const piece of String(words ?? "").split(/\s*[,;]\s*|\s+and\s+/i).map((one) => one.trim()).filter(Boolean)) {
    const found = piece.match(/^(\d+)\s+(.+)$/);
    if (!found || !(Number(found[1]) > 0)) return { problem: `"${piece}" should be a number and what it is, such as a trip carries: 2 ration crates, 4 produce` };
    list.push({ n: Number(found[1]), what: found[2].trim() });
  }
  return list.length ? { list } : { problem: "a trip carries needs a number and what it is, such as a trip carries: 2 ration crates, 4 produce" };
}
export const writeTrip = (trip) => (trip?.list ?? []).map((one) => `${one.n} ${one.what}`).join(", ");

// What comes after the first colon of a store's line is cut into its clauses: "holds 12 ration crates, 12 produce;
// wants 4 of each; urgent under 2; carried by the deckhands, the cooks". A clause starts with its own words, and what
// follows a comma or a semicolon without them goes on with the clause before.
const CLAUSES = [["holds", /^holds\s+/i], ["wants", /^wants\s+/i], ["urgent", /^urgent(?:\s+when)?\s+under\s+/i], ["carriers", /^carried\s+by\s+/i]];
// "4 ration crates", or "4" and "4 of each" for everything the store holds.
function readMark(piece) {
  const found = piece.match(/^(\d+)(?:\s+(.+))?$/);
  if (!found) return null;
  const what = (found[2] ?? "").trim().replace(/^of\s+(each|them|everything)$/i, "");
  return { n: Number(found[1]), what: what || null };
}

// "pantry in The Galley: holds 12 ration crates, 12 produce; wants 4 of each; urgent under 2; carried by the
// deckhands, the cooks: Shelves behind a wire door." The store, the room it's in, what it holds (a number and the
// item's words each, or a count of something that isn't an item, such as sittings), what it wants kept in it (a job
// of carrying comes up whenever it has fewer), when that's urgent, who carries for it, first to last, and after the
// last colon how it looks. Only holds has to be there.
export function readStoreLine(text) {
  const pieces = String(text).split(":");
  const head = pieces[0].trim();
  const at = head.search(/\s+in\s+/i);
  if (at < 0) return { problem: `"${text}" needs to say where it is: the store, then in, then the room, such as pantry in The Galley` };
  const name = head.slice(0, at).trim().replace(/^(an?|the)\s+/i, "");
  const room = head.slice(at).replace(/^\s+in\s+/i, "").trim();
  if (!name) return { problem: `"${text}" needs the store's name before in` };
  if (!room) return { problem: `"${text}" needs the room after in` };
  const holdsText = (pieces[1] ?? "").trim();
  // A hold for freight keeps nothing of the ship's own: whatever she's carrying goes into it, as far as its squares go.
  if (/^holds\s+freight$/i.test(holdsText)) return { name, room, holds: [], freight: true, wants: [], urgent: [], carriers: [], look: pieces.slice(2).join(":").trim() || null };
  // The reserve tanks hold the place's reserve air, as much as its systems file gives it (src/water.js).
  if (/^holds\s+the\s+reserve\s+air$/i.test(holdsText)) return { name, room, holds: [], reserve: true, wants: [], urgent: [], carriers: [], look: pieces.slice(2).join(":").trim() || null };
  if (!/^holds\s+\S/i.test(holdsText)) return { problem: `"${text}" needs holds after the colon, with what the store holds: holds 12 ration crates, 12 produce` };
  const holds = [];
  const wants = [];
  const urgent = [];
  const carriers = [];
  let clause = null;
  for (let piece of holdsText.split(/\s*[,;]\s*/).map((one) => one.trim()).filter(Boolean)) {
    const starts = CLAUSES.find(([, words]) => words.test(piece));
    if (starts) {
      clause = starts[0];
      piece = piece.replace(starts[1], "").trim();
    }
    if (clause === "carriers") {
      carriers.push(...readCarriers(piece));
      continue;
    }
    if (clause === "holds") {
      const found = piece.match(/^(\d+)\s+(.+)$/);
      if (!found) return { problem: `"${piece}" should be a number and what it is, such as 12 ration crates` };
      holds.push({ n: Number(found[1]), what: found[2].trim() });
      continue;
    }
    const mark = readMark(piece);
    if (!mark) return { problem: `"${piece}" should be a number, and what it's a number of if the store holds more than one thing: ${clause === "urgent" ? "urgent under 2" : "wants 4 ration crates, 4 produce"}` };
    (clause === "urgent" ? urgent : wants).push(mark);
  }
  if (!holds.length) return { problem: `"${text}" holds nothing: write what it holds after holds` };
  const look = pieces.slice(2).join(":").trim() || null;
  return { name, room, holds, wants, urgent, carriers, look };
}
// A store's line from its pieces, for the Story board: the clauses with semicolons between them.
export function writeStoreLine(store) {
  const marks = (list) => list.map((one) => (one.what ? `${one.n} ${one.what}` : `${one.n}`)).join(", ");
  const clauses = [store.freight ? "holds freight" : store.reserve ? "holds the reserve air" : `holds ${(store.holds ?? []).map((one) => `${one.n} ${one.what}`).join(", ")}`];
  if (store.wants?.length) clauses.push(`wants ${marks(store.wants)}`);
  if (store.urgent?.length) clauses.push(`urgent under ${marks(store.urgent)}`);
  if (store.carriers?.length) clauses.push(`carried by ${store.carriers.join(", ")}`);
  return `${store.name} in ${store.room}: ${clauses.join("; ")}${store.look ? `: ${store.look}` : ""}`;
}

// ---- The words of a machine's line ------------------------------------------------------------

// "every 2 hours", "every hour", "every 30 minutes": how often, in minutes.
const PERIOD = /,?\s*every\s+(?:(\d+)\s+)?(minutes?|hours?|days?)\b/i;
export const everyWords = (minutes) => (minutes % 1440 === 0 ? `${minutes === 1440 ? "day" : `${minutes / 1440} days`}` : minutes % 60 === 0 ? `${minutes === 60 ? "hour" : `${minutes / 60} hours`}` : `${minutes} minutes`);

// "galley: cooks 1 produce or 1 ration crate from the pantry into 200 sittings in the soup kettle every hour, with
// power and a cook there", "garden: grows 1 produce into the garden bins every 2 hours, with power and someone tending
// it", "generator in Engineering: burns 1 fuel cell from the fuel rack every 8 hours, gives 100 power". The machine,
// its room if the line says, what it takes (one of the choices, each time) and from where, what it makes and where
// that goes, how often, and what it needs: power, and someone there.
export function readMachineLine(text) {
  const colon = String(text).indexOf(":");
  if (colon < 0) return { problem: `"${text}" needs a colon after the machine's name, then what it does` };
  const head = String(text).slice(0, colon).trim();
  let body = String(text).slice(colon + 1).trim();
  const at = head.search(/\s+in\s+/i);
  const name = (at < 0 ? head : head.slice(0, at)).trim().replace(/^(an?|the)\s+/i, "");
  const room = at < 0 ? null : head.slice(at).replace(/^\s+in\s+/i, "").trim() || null;
  if (!name) return { problem: `"${text}" needs the machine's name before the colon` };
  let power = null;
  body = body.replace(/,?\s*gives\s+(\d+)\s+power\b/i, (_, n) => { power = Number(n); return ""; }).trim();
  const needs = { power: false, worker: null };
  body = body.replace(/,?\s*\bwith\s+(.+)$/i, (_, words) => {
    for (const need of words.split(/\s*,\s*|\s+and\s+/i).map((one) => one.trim()).filter(Boolean)) {
      // "1 water": so many measures out of the place's water tank for each go.
      const water = need.match(/^(\d+)\s+(?:measures?\s+of\s+)?water$/i);
      if (/^power$/i.test(need)) needs.power = true;
      else if (water) needs.water = Number(water[1]);
      else needs.worker = needs.worker ? `${needs.worker} and ${need}` : need;
    }
    return "";
  }).trim();
  let every = null;
  body = body.replace(PERIOD, (_, n, unit) => { every = (Number(n) || 1) * (/^min/i.test(unit) ? 1 : /^hour/i.test(unit) ? 60 : 1440); return ""; }).trim().replace(/,\s*$/, "");
  if (!every) return { problem: `"${text}" needs to say how often, such as every 2 hours or every hour` };
  const verbed = body.match(/^([a-z]+)\s+(.*)$/i);
  if (!verbed) return { problem: `"${text}" needs a verb and what the machine uses or makes, such as cooks 1 produce from the pantry into 200 sittings in the soup kettle` };
  const verb = verbed[1].toLowerCase();
  let rest = verbed[2].trim();
  let from = null;
  let into = null;
  let intoWords = null;
  const intoAt = rest.search(/\s+into\s+/i);
  if (intoAt >= 0) {
    intoWords = rest.slice(intoAt).replace(/^\s+into\s+/i, "").trim();
    rest = rest.slice(0, intoAt).trim();
  }
  const fromAt = rest.search(/\s+from\s+/i);
  if (fromAt >= 0) {
    from = rest.slice(fromAt).replace(/^\s+from\s+/i, "").replace(/^the\s+/i, "").trim();
    rest = rest.slice(0, fromAt).trim();
  }
  // A choice is a number and what it is, or "any food": whatever else in the store is worth something of that kind
  // (an item's feeds line, src/worth.js), for a machine that takes what it's given.
  const amount = (piece) => {
    const any = piece.match(/^any\s+(?:other\s+)?(.+)$/i);
    if (any) return { any: any[1].trim().toLowerCase(), what: `any ${any[1].trim()}` };
    const found = piece.match(/^(\d+)\s+(.+)$/);
    return found ? { n: Number(found[1]), what: found[2].trim() } : null;
  };
  const objects = rest.split(/\s+or\s+/i).map((one) => one.trim()).filter(Boolean).map(amount);
  if (objects.some((one) => !one)) return { problem: `"${rest}" should be a number and what it is, such as 1 ration crate, or two choices with or between them, or any food` };
  let gives = null;
  if (intoWords) {
    const placed = intoWords.match(/^(\d+)\s+(.+?)\s+in\s+(?:the\s+)?(.+)$/i);
    if (placed) {
      gives = { n: Number(placed[1]), what: placed[2].trim() };
      into = placed[3].trim();
    } else into = intoWords.replace(/^the\s+/i, "").trim();
  }
  let takes = [];
  if (from) takes = objects;
  else if (into && !gives) {
    if (objects.length !== 1 || objects[0].any) return { problem: `"${text}" makes more than one thing: a machine makes one thing, into one store` };
    gives = objects[0];
  } else takes = objects;
  if (takes.length && !from) return { problem: `"${text}" uses ${takes.map((one) => (one.any ? one.what : `${one.n} ${one.what}`)).join(" or ")} but doesn't say from which store: write from the pantry` };
  if (!takes.length && !gives && !power) return { problem: `"${text}" neither uses nor makes anything: write what it takes from a store, or what it puts into one` };
  return { name, room, verb, takes, from, gives, into, every, needs, power };
}

// ---- Numbers in words --------------------------------------------------------------------------

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const numberOf = (words) => (/^\d+$/.test(words) ? Number(words) : NUMBER_WORDS[String(words).toLowerCase()] ?? null);

// ---- The words of the repair line --------------------------------------------------------------

// "1 parts crate, from the parts lockers or the shuttle stores, for what's broken, cut, crippled or forced": what the
// engineers use up each time they fix something, the stores they fetch it from, first to last (every store that keeps
// it, left out), and the kinds of damage that need it (every kind, left out). "nothing" takes nothing, as does leaving
// the line out.
const FOR_WHAT = /,?\s+for\s+what(?:'s|’s|\s+is)(?:\s+|$)/i;
export function readRepair(words) {
  const written = String(words ?? "").trim().replace(/\.$/, "");
  if (/^nothing$/i.test(written)) return { n: 0, what: "", from: [], damage: [] };
  let text = written;
  let damage = [];
  const forAt = text.search(FOR_WHAT);
  if (forAt >= 0) {
    damage = text.slice(forAt).replace(FOR_WHAT, "").split(/\s*,\s*|\s+or\s+|\s+and\s+/i).map((one) => one.trim().toLowerCase()).filter(Boolean);
    text = text.slice(0, forAt);
    if (!damage.length) return { problem: `"${written}" needs the kinds of damage after for what's, such as for what's broken, cut or forced` };
  }
  let from = [];
  const fromAt = text.search(/,?\s+from\s+/i);
  if (fromAt >= 0) {
    from = text.slice(fromAt).replace(/^,?\s+from\s+/i, "").split(/\s*,\s*|\s+or\s+/i).map((one) => one.trim().replace(/^the\s+/i, "")).filter(Boolean);
    text = text.slice(0, fromAt);
    if (!from.length) return { problem: `"${written}" needs the stores after from, such as from the parts lockers or the shuttle stores` };
  }
  const found = text.trim().match(/^(\S+)\s+(.+)$/);
  const n = found ? (/^an?$/i.test(found[1]) ? 1 : numberOf(found[1])) : null;
  if (!found || !(n > 0)) return { problem: `"${written}" needs a number and what a repair takes, such as 1 parts crate, from the parts lockers` };
  return { n, what: found[2].trim(), from, damage };
}
// ---- The words of the salvage makes line --------------------------------------------------------------

// "1 parts crate from 10 salvage, in The Repair Bay, in 2 hours, into the parts lockers": what the bench makes, from how
// much salvage (each item's salvage line says what it counts for), the room it's made in, how long it takes, and the
// stores it goes into, first to last (left out, it goes into the player's pack). "nothing" makes nothing, as does
// leaving the line out.
export function readMaking(words) {
  const written = String(words ?? "").trim().replace(/\.$/, "");
  if (/^nothing$/i.test(written)) return { n: 0, what: "", per: 0, room: null, hours: 0, into: [] };
  const [head, ...rest] = written.split(/\s*,\s*/);
  const found = head.match(/^(\S+)\s+(.+?)\s+from\s+(\S+)\s+salvage$/i);
  const n = found ? (/^an?$/i.test(found[1]) ? 1 : numberOf(found[1])) : null;
  const per = found ? numberOf(found[3]) : null;
  if (!found || !(n > 0) || !(per > 0)) return { problem: `"${written}" starts with what's made and from how much salvage, such as 1 parts crate from 10 salvage` };
  const out = { n, what: found[2].trim(), per, room: null, hours: 1, into: [] };
  for (const piece of rest) {
    let part;
    if ((part = piece.match(/^in\s+(\d+(?:\.\d+)?)\s+hours?$/i))) out.hours = Number(part[1]);
    else if ((part = piece.match(/^into\s+(.+)$/i))) out.into = part[1].split(/\s+or\s+/i).map((one) => one.trim().replace(/^the\s+/i, "")).filter(Boolean);
    else if ((part = piece.match(/^in\s+(.+)$/i))) out.room = part[1].trim();
    else return { problem: `"${piece}" isn't something a salvage makes line says: after what's made, write in the room, in so many hours, and into the store, such as 1 parts crate from 10 salvage, in The Repair Bay, in 2 hours, into the parts lockers` };
  }
  if (!out.room) return { problem: `"${written}" needs the room it's made in, such as in The Repair Bay` };
  if (!(out.hours > 0)) return { problem: `"${written}" needs to take some time, such as in 2 hours` };
  return out;
}
export const writeMaking = (m) => (!m?.n ? "nothing" : `${m.n} ${m.what} from ${m.per} salvage, in ${m.room}, in ${m.hours} hour${m.hours === 1 ? "" : "s"}${m.into?.length ? `, into the ${m.into.join(" or the ")}` : ""}`);

const listWords = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list.at(-1)}` : list[0] ?? "");
export const writeRepair =(r) => (!r?.n ? "nothing" : `${r.n} ${r.what}${r.from?.length ? `, from the ${r.from.join(" or the ")}` : ""}${r.damage?.length ? `, for what's ${listWords(r.damage)}` : ""}`);

// ---- The words of a loads line ---------------------------------------------------------------

// "air plant 20, engines 30 while under way, doors 6, comms 6, navigation 6, cameras 4, lights 1 a room, computers 2
// each": what each system draws from the generator; or "when short, drop: cameras, comms, lights, doors, navigation,
// air": the order they're let go in when the generator hasn't enough for them all.
export function readLoadsLine(text) {
  const words = String(text).trim();
  const drop = words.match(/^when\s+short,?\s*drop:\s*(.*)$/i);
  if (drop) {
    const order = drop[1].split(/\s*,\s*|\s+and\s+|\s+then\s+/i).map((one) => one.trim().replace(/^the\s+/i, "")).filter(Boolean);
    return order.length ? { drop: order } : { problem: `"${text}" names nothing to drop: write when short, drop: cameras, comms, lights` };
  }
  const loads = [];
  for (const piece of words.split(/\s*,\s*/).map((one) => one.trim()).filter(Boolean)) {
    const found = piece.match(/^(.+?)\s+(\d+)(?:\s+(a room|per room|each|apiece))?(?:\s+while\s+(.+))?$/i);
    if (!found) return { problem: `"${piece}" should be a system and a number, such as air plant 20, lights 1 a room, or engines 30 while under way` };
    loads.push({ system: found[1].trim().replace(/^the\s+/i, ""), amount: Number(found[2]), per: found[3] ? (/room/i.test(found[3]) ? "room" : "each") : null, while: found[4] ? found[4].trim().toLowerCase() : null });
  }
  return loads.length ? { loads } : { problem: `"${text}" names no load: write a system and a number, such as air plant 20` };
}

// ---- The words of a refill line -------------------------------------------------------------------

// "the shuttle stores: ration crates and fuel cells from nothing for now, every 6 hours, up to full": the store, what
// comes into it, from where (only nothing, until trade off the ship is built), how often, and how far it's filled.
export function readRefillLine(text) {
  const colon = String(text).indexOf(":");
  if (colon < 0) return { problem: `"${text}" needs a colon after the store, then what comes into it` };
  const store = String(text).slice(0, colon).trim().replace(/^the\s+/i, "");
  let body = String(text).slice(colon + 1).trim();
  if (!store) return { problem: `"${text}" needs the store's name before the colon` };
  let upTo = "full";
  body = body.replace(/,?\s*up\s+to\s+(full|\d+)\s*$/i, (_, n) => { upTo = /^\d+$/.test(n) ? Number(n) : "full"; return ""; }).trim();
  let every = null;
  body = body.replace(PERIOD, (_, n, unit) => { every = (Number(n) || 1) * (/^min/i.test(unit) ? 1 : /^hour/i.test(unit) ? 60 : 1440); return ""; }).trim().replace(/,\s*$/, "");
  if (!every) return { problem: `"${text}" needs to say how often, such as every 6 hours` };
  const fromAt = body.search(/\s+from\s+/i);
  if (fromAt < 0) return { problem: `"${text}" needs to say where it comes from: from the dock, bought at whatever port the ship is docked at, or from nothing` };
  const words = body.slice(fromAt).replace(/^\s+from\s+/i, "").replace(/\s+for\s+now\s*$/i, "").trim().toLowerCase();
  // From the dock: bought from the port the ship is docked at, out of her purse, and nothing in open space. From
  // nothing: it just comes, which is how it was before the ports held real amounts.
  const from = words === "nothing" ? "nothing" : /^(the\s+)?docks?$/.test(words) ? "dock" : null;
  if (!from) return { problem: `"${text}": a store is filled from the dock, or from nothing` };
  const what = body.slice(0, fromAt).split(/\s*,\s*|\s+and\s+/i).map((one) => one.trim()).filter(Boolean);
  if (!what.length) return { problem: `"${text}" names nothing to come in: write ration crates and fuel cells from the dock` };
  return { store, what, from, every, upTo };
}

// ---- Writing a file ----------------------------------------------------------------------------
export function writeLogisticsText(value) {
  const out = [`# ${value.name ?? ""}`];
  for (const field of LOGISTICS_HEADER) {
    const one = get(value, field.path);
    if (one === undefined || one === null || one === "") continue;
    out.push(`${field.key}: ${field.type === "sittings" ? writeSittings(one) : field.type === "repair" ? writeRepair(one) : field.type === "making" ? writeMaking(one) : field.type === "carriers" ? one.list.join(", ") : field.type === "trip" ? writeTrip(one) : field.type === "decider" ? writeDecider(one) : field.type === "waiting" ? writeWaiting(one) : field.type === "askers" ? writeAskers(one) : one}${field.type === "number" ? ` ${field.unit}` : ""}`);
  }
  for (const part of LOGISTICS_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${PART_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
