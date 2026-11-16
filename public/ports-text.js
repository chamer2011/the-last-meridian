// The world's goods and its ports, as plain text: world/goods/<tree>.txt says what goods there are, a tree to a file
// (food, fuel, medicine, parts, water and air, comforts), each good at its step of the tree; world/ports/<place>.txt
// says what a port holds, what it makes and what it uses, in real amounts. The game reads them through here
// (src/ports.js makes of them what it plays), and so does the story board, in the browser. This file imports nothing.
//
// A tree:
//     # Food
//     draft: the AI's, not yet edited by the owner
//     stands for: food, by its ration crates
//
//     Developed:
//     - ration crates [ration_crate]: The crates a pantry holds, two hundred sittings each.
//     - ration packs, by the case [ration_pack]: Packs and tins for one person.
//     Advanced:
//     - provisions, by the hamper: Fresh bread, honey, sausage.
//
// A port:
//     # Haven Station
//     draft: the AI's, not yet edited by the owner
//     people: 6,000
//
//     Holds:
//     - ration crates: usually 1,500, from Tessen Colony or Maris Deep
//     Makes:
//     - the kitchens: 3 ration packs a day
//     Uses:
//     - its people: 60 ration crates, 3 ration packs a day

export const STEPS = ["basic", "refined", "developed", "advanced"];
export const STEP_TITLES = { basic: "Basic", refined: "Refined", developed: "Developed", advanced: "Advanced" };
export const PORT_PARTS = ["holds", "makes", "uses"];
export const PORT_TITLES = { holds: "Holds", makes: "Makes", uses: "Uses" };

// "1,500", "0.3", "12": a number as these files write it, and back.
const NUMBER = "\\d[\\d,]*(?:\\.\\d+)?";
export const toNumber = (text) => Number(String(text).replaceAll(",", ""));
export function numberWords(n) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [whole, part] = String(rounded).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${part ? `.${part}` : ""}`;
}
// A good's or a place's name made into the word the game knows it by: "ration crates" is ration_crates.
export const slugOf = (words) => String(words ?? "").trim().toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// ---- A tree of goods --------------------------------------------------------------------------------------

// "ration packs, by the case [ration_pack]: Packs and tins for one person.": a good's name as it's counted ("3
// ration packs"), what it's counted by when its name isn't a count ("3 casks of drinking water"), the game's own item
// it is, if it's one, and a few words about it.
export function readGoodLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "");
  const cut = line.search(/:\s/);
  let head = (cut < 0 ? line.replace(/:$/, "") : line.slice(0, cut)).trim();
  const words = cut < 0 ? "" : line.slice(cut + 1).trim();
  const item = head.match(/\s*\[([a-z0-9_]+)\]\s*$/i);
  if (item) head = head.slice(0, item.index).trim();
  const unit = head.match(/,\s*by the\s+(.+)$/i);
  if (unit) head = head.slice(0, unit.index).trim();
  if (!head) return { problem: "a good is its name, such as ration crates, then how it's counted if its name isn't a count (drinking water, by the cask), then the game's own item in square brackets if it's one, then a colon and a few words" };
  if (/[,\[\]]/.test(head)) return { problem: `"${head}" should be the good's name alone before any ", by the" and any [item]` };
  return { name: head, unit: unit ? unit[1].trim() : null, item: item ? item[1].toLowerCase() : null, words };
}
export const writeGoodLine = (one) => `${one.name}${one.unit ? `, by the ${one.unit}` : ""}${one.item ? ` [${one.item}]` : ""}${one.words ? `: ${one.words}` : ""}`;

// "food, by its ration crates": which of the supplies every port already has a word for (plenty, normal, short) this
// tree's amounts stand behind, and by which of its goods.
export function readStands(words) {
  const found = String(words ?? "").trim().replace(/\.$/, "").match(/^([a-z]+)\s*,?\s*by\s+(?:its\s+|their\s+|the\s+)?(.+)$/i);
  if (!found) return { problem: `"${words}" should be a supply and one of this tree's goods, such as food, by its ration crates` };
  return { supply: found[1].toLowerCase(), good: found[2].trim() };
}
export const writeStands = (one) => `${one.supply}, by its ${one.good}`;

const GOODS_HEADER = ["draft", "stands for"];
export function parseGoodsText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { id, name: id, steps: {} };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let titled = false;
  let section = null;
  const seen = new Set();
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (!titled) {
      titled = true;
      const title = line.match(/^#\s*(.+)$/);
      if (title) {
        value.name = title[1].trim();
        continue;
      }
      problem(n, "the first line is the tree's name, written # Food");
    }
    const heading = line.match(/^([A-Za-z][A-Za-z ]{0,30}):$/);
    if (heading) {
      const part = heading[1].trim().toLowerCase();
      if (!STEPS.includes(part)) {
        problem(n, `"${heading[1].trim()}" isn't a step of a tree: the steps are ${STEPS.map((one) => STEP_TITLES[one]).join(", ")}`);
        section = "unknown";
        continue;
      }
      if (seen.has(part)) problem(n, `"${STEP_TITLES[part]}" is written twice`);
      seen.add(part);
      section = part;
      value.steps[part] ??= [];
      continue;
    }
    if (section === null) {
      const field = line.match(/^([a-z][a-z ]{0,30}):\s*(.*)$/i);
      const key = field?.[1].trim().toLowerCase();
      if (!field || !GOODS_HEADER.includes(key)) {
        problem(n, `before the first step, each line is one of ${GOODS_HEADER.join(", ")}, then a colon and its value`);
        continue;
      }
      if (key === "draft") value.draft = field[2].trim();
      else {
        const read = readStands(field[2]);
        if (read.problem) problem(n, read.problem);
        else value.stands = { ...read, line: n };
      }
      continue;
    }
    if (section === "unknown") continue;
    if (!line.startsWith("-")) {
      problem(n, `under ${STEP_TITLES[section]}, each good is a line that starts with a dash`);
      continue;
    }
    const words = line.replace(/^-\s*/, "");
    const read = readGoodLine(words);
    if (read.problem) problem(n, read.problem);
    value.steps[section].push({ text: words, line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with the tree's name, written # Food");
  return { value, problems };
}

export function writeGoodsText(value) {
  const out = [`# ${value.name ?? ""}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  if (value.stands) out.push(`stands for: ${writeStands(value.stands)}`);
  for (const step of STEPS) {
    const lines = value.steps?.[step] ?? [];
    if (!lines.length) continue;
    out.push("", `${STEP_TITLES[step]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}

// ---- A port ---------------------------------------------------------------------------------------------------

// Names in a list: "Tessen Colony or Maris Deep", "Cinder Reach, the Deepyards and Vantor Prime".
const listOf = (words) => String(words ?? "").split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i).map((one) => one.trim()).filter(Boolean);

// "ration crates: usually 1,500, from Tessen Colony or Maris Deep": what a port holds of a good when things are as
// usual, and the ports it sends to for more. One that names nowhere makes its own, or goes without.
export function readHoldLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  const found = line.match(new RegExp(`^(.+?):\\s*usually\\s+(${NUMBER})(?:\\s*,?\\s*from\\s+(.+))?$`, "i"));
  if (!found) return { problem: `"${line}" should be a good, a colon, usually and how many, then from and the ports it comes from if it comes from elsewhere: ration crates: usually 1,500, from Tessen Colony or Maris Deep` };
  const usual = toNumber(found[2]);
  if (!(usual > 0)) return { problem: `"${line}" should usually hold more than nothing` };
  return { good: found[1].trim(), usual, from: found[3] ? listOf(found[3]) : [] };
}
export const writeHoldLine = (one) => `${one.good}: usually ${numberWords(one.usual)}${one.from?.length ? `, from ${one.from.length > 1 ? `${one.from.slice(0, -1).join(", ")} or ${one.from.at(-1)}` : one.from[0]}` : ""}`;

// "12 ration crates": so many of a good. The good's name is whatever follows the number.
function readAmount(words) {
  const found = String(words ?? "").trim().match(new RegExp(`^(${NUMBER})\\s+(.+)$`));
  return found ? { n: toNumber(found[1]), good: found[2].trim() } : null;
}

// "the kitchens: 3 ration packs a day": who makes it, how many and of what, each day.
export function readMakeLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  const found = line.match(/^(.+?):\s*(.+?)\s+(?:a|each|every|per)\s+day$/i);
  const amount = found ? readAmount(found[2]) : null;
  if (!amount) return { problem: `"${line}" should be who makes it, a colon, how many of what, and a day: the kitchens: 3 ration packs a day` };
  if (!(amount.n > 0)) return { problem: `"${line}" should make more than nothing a day` };
  return { name: found[1].trim(), n: amount.n, good: amount.good };
}
export const writeMakeLine = (one) => `${one.name}: ${numberWords(one.n)} ${one.good} a day`;

// "its people: 60 ration crates, 3 ration packs a day": who uses it up, and how many of each thing, each day.
export function readUseLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  const found = line.match(/^(.+?):\s*(.+?)\s+(?:a|each|every|per)\s+day$/i);
  if (!found) return { problem: `"${line}" should be who uses it, a colon, how many of each thing with commas between, and a day: its people: 60 ration crates, 3 ration packs a day` };
  const list = [];
  for (const piece of found[2].split(/\s*,\s*/).map((one) => one.trim()).filter(Boolean)) {
    const amount = readAmount(piece);
    if (!amount || !(amount.n > 0)) return { problem: `"${piece}" should be how many and of what, such as 60 ration crates` };
    list.push(amount);
  }
  if (!list.length) return { problem: `"${line}" doesn't say what's used` };
  return { who: found[1].trim(), list };
}
export const writeUseLine = (one) => `${one.who}: ${one.list.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")} a day`;

const PORT_HEADER = ["draft", "people"];
export function parsePortText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { id, name: id, holds: [], makes: [], uses: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let titled = false;
  let section = null;
  const seen = new Set();
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (!titled) {
      titled = true;
      const title = line.match(/^#\s*(.+)$/);
      if (title) {
        value.name = title[1].trim();
        continue;
      }
      problem(n, "the first line is the port's name, written # Haven Station");
    }
    const heading = line.match(/^([A-Za-z][A-Za-z ]{0,30}):$/);
    if (heading) {
      const part = heading[1].trim().toLowerCase();
      if (!PORT_PARTS.includes(part)) {
        problem(n, `"${heading[1].trim()}" isn't a part of a port's file: the parts are ${PORT_PARTS.map((one) => PORT_TITLES[one]).join(", ")}`);
        section = "unknown";
        continue;
      }
      if (seen.has(part)) problem(n, `"${PORT_TITLES[part]}" is written twice`);
      seen.add(part);
      section = part;
      continue;
    }
    if (section === null) {
      const field = line.match(/^([a-z][a-z ]{0,30}):\s*(.*)$/i);
      const key = field?.[1].trim().toLowerCase();
      if (!field || !PORT_HEADER.includes(key)) {
        problem(n, `before the first part, each line is one of ${PORT_HEADER.join(", ")}, then a colon and its value`);
        continue;
      }
      if (key === "draft") value.draft = field[2].trim();
      else if (new RegExp(`^${NUMBER}$`).test(field[2].trim())) value.people = toNumber(field[2]);
      else problem(n, "people is a number, such as people: 6,000");
      continue;
    }
    if (section === "unknown") continue;
    if (!line.startsWith("-")) {
      problem(n, `under ${PORT_TITLES[section]}, each line starts with a dash`);
      continue;
    }
    const words = line.replace(/^-\s*/, "");
    const read = section === "holds" ? readHoldLine(words) : section === "makes" ? readMakeLine(words) : readUseLine(words);
    if (read.problem) problem(n, read.problem);
    value[section].push({ text: words, line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with the port's name, written # Haven Station");
  return { value, problems };
}

export function writePortText(value) {
  const out = [`# ${value.name ?? ""}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  if (value.people !== undefined && value.people !== null && value.people !== "") out.push(`people: ${numberWords(value.people)}`);
  for (const part of PORT_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${PORT_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
