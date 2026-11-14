// What's in the containers, as plain text: world/loot/containers.txt. The file names the kinds of container (what a
// thing has to be called to be one, how many squares it holds and how many things), which rooms and places hold more
// or fewer, and what the furniture drawn on the decks opens as. This only reads and writes the words; which rooms,
// places, furniture and items they name is checked by src/loot.js, which knows the world. It runs in the browser too,
// for the Story board. world/loot/_how-to-write-loot.txt explains the format.

export const LOOT_PARTS = ["kinds", "richer and poorer", "furniture"];
export const LOOT_TITLES = { kinds: "Kinds", "richer and poorer": "Richer and poorer", furniture: "Furniture" };
export const RARITIES = ["common", "uncommon", "rare"];

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const WORD_FOR = Object.fromEntries(Object.entries(NUMBER_WORDS).map(([word, n]) => [n, word]));
const listOf = (words) => String(words ?? "").split(",").map((one) => one.trim()).filter(Boolean);
const countOf = (word) => (NUMBER_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : null));

// "dresser: called dresser, wardrobe; 6x4; 1 to 4 things"
export function readKindLine(text) {
  const head = String(text ?? "").match(/^([^:]{1,40}):\s*(.*)$/);
  if (!head) return { problem: `"${text}" is written as the kind's name, a colon, then called ...; 6x4; 1 to 4 things` };
  const name = head[1].trim();
  const pieces = head[2].split(";").map((one) => one.trim());
  if (pieces.length !== 3) return { problem: `the line for ${name} has ${pieces.length} pieces, and it needs three, separated by semicolons: called ...; 6x4; 1 to 4 things` };
  const called = pieces[0].match(/^called\s+(.+)$/i);
  if (!called) return { problem: `the line for ${name} starts with called and the words in a thing's name that make it one, like called dresser, wardrobe` };
  const words = listOf(called[1]).map((one) => one.toLowerCase());
  const size = pieces[1].match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!size) return { problem: `the line for ${name} says how many squares it holds as across by down, like 6x4, and it has "${pieces[1]}"` };
  const things = pieces[2].match(/^(\d+)(?:\s+to\s+(\d+))?\s+things?$/i);
  if (!things) return { problem: `the line for ${name} says how many things are in it, like 1 to 4 things or 2 things, and it has "${pieces[2]}"` };
  const low = Number(things[1]);
  const high = things[2] === undefined ? low : Number(things[2]);
  return { name, words, size: { cols: Number(size[1]), rows: Number(size[2]) }, things: [low, high] };
}
export const writeKindLine = (kind) => `${kind.name}: called ${kind.words.join(", ")}; ${kind.size.cols}x${kind.size.rows}; ${kind.things[0] === kind.things[1] ? `${kind.things[0]} ${kind.things[0] === 1 ? "thing" : "things"}` : `${kind.things[0]} to ${kind.things[1]} things`}`;

// "rooms called cabin, quarters: one more" or "places graveyard, frontier: one fewer"
export function readAdjustLine(text) {
  const found = String(text ?? "").match(/^(rooms called|places)\s+(.+?):\s*(\w+)\s+(more|fewer)$/i);
  if (!found) return { problem: `"${text}" is written rooms called cabin, office: one more, or places graveyard, frontier: one fewer` };
  const n = countOf(found[3].toLowerCase());
  if (!n) return { problem: `"${found[3]}" isn't a number: write one, two, three, or 1, 2, 3` };
  return { what: found[1].toLowerCase() === "places" ? "places" : "rooms", words: listOf(found[2]).map((one) => one.toLowerCase()), by: found[4].toLowerCase() === "more" ? n : -n };
}
export const writeAdjustLine = (one) => `${one.what === "places" ? "places" : "rooms called"} ${one.words.join(", ")}: ${WORD_FOR[Math.abs(one.by)] ?? Math.abs(one.by)} ${one.by > 0 ? "more" : "fewer"}`;

// "shelf: tool shelf in Engineering, The Repair Bay; pantry in The Galley; crate anywhere else", or "barrel: crate"
export function readFurnitureLine(text) {
  const head = String(text ?? "").match(/^([a-z][a-z-]{0,30}):\s*(.+)$/i);
  if (!head) return { problem: `"${text}" is written as the piece of furniture, a colon, and the kind it opens as, like barrel: crate` };
  const rules = [];
  let otherwise = null;
  for (const piece of head[2].split(";").map((one) => one.trim()).filter(Boolean)) {
    const inRooms = piece.match(/^(.+?)\s+in\s+(.+)$/i);
    const elsewhere = piece.match(/^(.+?)\s+anywhere else$/i);
    if (elsewhere) otherwise = elsewhere[1].trim().toLowerCase();
    else if (inRooms) rules.push({ kind: inRooms[1].trim().toLowerCase(), rooms: listOf(inRooms[2]) });
    else if (!rules.length && otherwise === null) otherwise = piece.toLowerCase();
    else return { problem: `"${piece}" is written a kind in a room, like pantry in The Galley, or a kind anywhere else` };
  }
  return { piece: head[1].trim().toLowerCase(), rules, otherwise };
}
export function writeFurnitureLine(one) {
  const pieces = one.rules.map((rule) => `${rule.kind} in ${rule.rooms.join(", ")}`);
  if (one.otherwise) pieces.push(one.rules.length ? `${one.otherwise} anywhere else` : one.otherwise);
  return `${one.piece}: ${pieces.join("; ")}`;
}

// ---- Reading a file ---------------------------------------------------------------------------

// The file into { name, draft, kinds: [...], adjust: [...], furniture: [...] }, each line with its line number, and
// the problems in it, each with the line it's on.
export function parseLootText(text) {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { name: "", kinds: [], adjust: [], furniture: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let titled = false;
  let part = null;
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
      problem(n, "the first line is the file's name, written # The containers and what's in them");
    }
    const heading = line.match(/^([A-Za-z][A-Za-z ]{0,30}):$/);
    if (heading) {
      const name = heading[1].trim().toLowerCase();
      if (!LOOT_PARTS.includes(name)) {
        problem(n, `"${heading[1].trim()}" isn't a part of this file: the parts are ${LOOT_PARTS.map((one) => LOOT_TITLES[one]).join(", ")}`);
        part = "unknown";
        continue;
      }
      if (seen.has(name)) problem(n, `"${LOOT_TITLES[name]}" is written twice`);
      seen.add(name);
      part = name;
      continue;
    }
    if (part === null) {
      const draft = line.match(/^draft:\s*(.*)$/i);
      if (draft) value.draft = draft[1].trim();
      else problem(n, "before the first part, the only line is draft:, then the parts Kinds, Richer and poorer, and Furniture");
      continue;
    }
    if (part === "unknown") continue;
    const entry = line.match(/^-\s+(.*)$/);
    if (!entry) {
      problem(n, `under "${LOOT_TITLES[part]}", each line starts with - and a space`);
      continue;
    }
    const read = part === "kinds" ? readKindLine(entry[1]) : part === "furniture" ? readFurnitureLine(entry[1]) : readAdjustLine(entry[1]);
    if (read.problem) {
      problem(n, read.problem);
      continue;
    }
    const list = part === "kinds" ? value.kinds : part === "furniture" ? value.furniture : value.adjust;
    list.push({ ...read, line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with # The containers and what's in them");
  return { value, problems };
}

// ---- Writing a file ---------------------------------------------------------------------------

export function writeLootText(value) {
  const out = [`# ${value.name || "The containers and what's in them"}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  out.push("", "Kinds:", ...value.kinds.map((one) => `- ${writeKindLine(one)}`));
  out.push("", "Richer and poorer:", ...value.adjust.map((one) => `- ${writeAdjustLine(one)}`));
  out.push("", "Furniture:", ...value.furniture.map((one) => `- ${writeFurnitureLine(one)}`));
  return `${out.join("\n")}\n`;
}
