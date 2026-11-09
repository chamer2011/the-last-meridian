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
];

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

// ---- Writing a file ----------------------------------------------------------------------------
export function writeLogisticsText(value) {
  const out = [`# ${value.name ?? ""}`];
  for (const field of LOGISTICS_HEADER) {
    const one = get(value, field.path);
    if (one === undefined || one === null || one === "") continue;
    out.push(`${field.key}: ${one}${field.type === "number" ? ` ${field.unit}` : ""}`);
  }
  for (const part of LOGISTICS_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${PART_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
