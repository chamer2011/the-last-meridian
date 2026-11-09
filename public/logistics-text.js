// A place's logistics as plain text: world/logistics/<place>.txt. The file names the place, has a few numbers at
// the top, and one part each for Stores, Machines, Loads, Errands and Refills, every line of them starting with -
// and a space. This only reads and writes the words, and reads a store's line into its pieces; which rooms, things
// and items they name is worked out by src/logistics.js, which knows the maps. It runs in the browser too, for the
// Story board. world/logistics/_how-to-write-logistics.txt explains the format.

export const LOGISTICS_PARTS = ["stores", "machines", "loads", "errands", "refills"];
export const PART_TITLES = { stores: "Stores", machines: "Machines", loads: "Loads", errands: "Errands", refills: "Refills" };

// The lines at the top of the file.
export const LOGISTICS_HEADER = [
  { key: "draft", path: "draft", type: "string" },
  { key: "everyone aboard eats", path: "numbers.eats", type: "number", unit: "sittings a day" },
  { key: "a crate feeds", path: "numbers.crateFeeds", type: "number", unit: "sittings" },
  { key: "sittings at", path: "sittings", type: "sittings" },
];

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

// The file into { name, draft, numbers, stores: [{ text, line }], machines: [...], loads: [...], errands: [...],
// refills: [...] }, with every line kept as words for src/logistics.js to make sense of.
export function parseLogisticsText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { name: id, numbers: {}, stores: [], machines: [], loads: [], errands: [], refills: [] };
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
        if (!amount) problem(n, `${known.key} is a number of ${known.unit}, such as ${known.key}: ${known.key === "a crate feeds" ? "200 sittings" : "2 sittings a day"}`);
        else set(value, known.path, Number(amount[1]));
      } else if (known.type === "sittings") {
        const read = readSittings(words);
        if (read.problem) problem(n, read.problem);
        else set(value, known.path, read);
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

// "pantry in The Galley: holds 12 ration crates, 12 produce: Shelves behind a wire door." The store, the room it's
// in, what it holds (a number and the item's words each, or a count of something that isn't an item, such as
// sittings), and after the last colon how it looks.
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
  const holdsAt = holdsText.match(/^holds\s+(.+)$/i);
  if (!holdsAt) return { problem: `"${text}" needs holds after the colon, with what the store holds: holds 12 ration crates, 12 produce` };
  const holds = [];
  for (const piece of holdsAt[1].split(",").map((one) => one.trim()).filter(Boolean)) {
    const found = piece.match(/^(\d+)\s+(.+)$/);
    if (!found) return { problem: `"${piece}" should be a number and what it is, such as 12 ration crates` };
    holds.push({ n: Number(found[1]), what: found[2].trim() });
  }
  if (!holds.length) return { problem: `"${text}" holds nothing: write what it holds after holds` };
  const look = pieces.slice(2).join(":").trim() || null;
  return { name, room, holds, look };
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
      if (/^power$/i.test(need)) needs.power = true;
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
  const amount = (piece) => {
    const found = piece.match(/^(\d+)\s+(.+)$/);
    return found ? { n: Number(found[1]), what: found[2].trim() } : null;
  };
  const objects = rest.split(/\s+or\s+/i).map((one) => one.trim()).filter(Boolean).map(amount);
  if (objects.some((one) => !one)) return { problem: `"${rest}" should be a number and what it is, such as 1 ration crate, or two choices with or between them` };
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
    if (objects.length !== 1) return { problem: `"${text}" makes more than one thing: a machine makes one thing, into one store` };
    gives = objects[0];
  } else takes = objects;
  if (takes.length && !from) return { problem: `"${text}" uses ${takes.map((one) => `${one.n} ${one.what}`).join(" or ")} but doesn't say from which store: write from the pantry` };
  if (!takes.length && !gives && !power) return { problem: `"${text}" neither uses nor makes anything: write what it takes from a store, or what it puts into one` };
  return { name, room, verb, takes, from, gives, into, every, needs, power };
}

// ---- Writing a file ----------------------------------------------------------------------------
export function writeLogisticsText(value) {
  const out = [`# ${value.name ?? ""}`];
  for (const field of LOGISTICS_HEADER) {
    const one = get(value, field.path);
    if (one === undefined || one === null || one === "") continue;
    out.push(`${field.key}: ${field.type === "sittings" ? writeSittings(one) : one}${field.type === "number" ? ` ${field.unit}` : ""}`);
  }
  for (const part of LOGISTICS_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${PART_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
