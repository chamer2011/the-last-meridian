// The world's goods and its ports, as plain text: world/goods/<tree>.txt says what goods there are, a tree to a file
// (food, fuel, medicine, parts, water and air, comforts), each good at its step of the tree; world/ports/<place>.txt
// says what a port holds, what it makes and what it uses, in real amounts. The game reads them through here
// (src/ports.js makes of them what it plays), and so does the story board, in the browser. This file imports nothing.
//
// A tree:
//     # Food
//     draft: the AI's, not yet edited by the owner
//     stands for: food, by its ration crates
//     hands need: ration crates
//
//     Basic:
//     - grain, by the load: Barley, wheat and beans off a field.
//     Refined:
//     - meal, by the sack, made from grain: Grain dried and milled.
//     Developed:
//     - ration crates [ration_crate], made from meal, kelp cake: The crates a pantry holds, two hundred sittings each.
//     - ration packs, by the case [ration_pack], made from meal: Packs and tins for one person.
//     Advanced:
//     - provisions, by the hamper, made from ration crates: Fresh bread, honey, sausage.
//
// A port:
//     # Haven Station
//     draft: the AI's, not yet edited by the owner
//     people: 6,000
//
//     Holds:
//     - ration crates: usually 1,500, from Tessen Colony or Maris Deep
//     - meal: usually 900, from Tessen Colony
//     Ground:
//     - the Long Fields: 660 grain a day
//     Makes:
//     - the kitchens: 72 ration packs a day, from 36 meal
//     Uses:
//     - its people: 60 ration crates, 3 ration packs a day
//     Stores:
//     - the granary in The Manifest Docks: usually 20 ration crates, 8 meal: A cage of crates and sacks.
//
// A port's Stores are where its goods stand in its rooms, for whoever walks them (src/port-stores.js): each holds its
// share of what the port has, and two lines at the top say who carries for them and where goods come and go.

export const STEPS = ["basic", "refined", "developed", "advanced"];
export const STEP_TITLES = { basic: "Basic", refined: "Refined", developed: "Developed", advanced: "Advanced" };
export const PORT_PARTS = ["holds", "ground", "makes", "uses", "stores"];
export const PORT_TITLES = { holds: "Holds", ground: "Ground", makes: "Makes", uses: "Uses", stores: "Stores" };

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

// Goods in a list, with commas between, or an or: "meal, kelp cake". Never an and, which some goods have in their
// own name (plasma and dressings).
export const goodsIn = (words) => String(words ?? "").split(/\s*,\s*(?:or\s+)?|\s+or\s+/i).map((one) => one.trim()).filter(Boolean);

// "ration packs, by the case [ration_pack], made from meal: Packs and tins for one person.": a good's name as it's
// counted ("3 ration packs"), what it's counted by when its name isn't a count ("3 casks of drinking water"), the
// game's own item it is, if it's one, the goods it's made from, if it's made from any, and a few words about it.
export function readGoodLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "");
  const cut = line.search(/:\s/);
  let head = (cut < 0 ? line.replace(/:$/, "") : line.slice(0, cut)).trim();
  const words = cut < 0 ? "" : line.slice(cut + 1).trim();
  const made = head.match(/,\s*(?:made\s+)?from\s+(.+)$/i);
  if (made) head = head.slice(0, made.index).trim();
  const item = head.match(/\s*\[([a-z0-9_]+)\]\s*$/i);
  if (item) head = head.slice(0, item.index).trim();
  const unit = head.match(/,\s*by the\s+(.+)$/i);
  if (unit) head = head.slice(0, unit.index).trim();
  if (!head) return { problem: "a good is its name, such as ration crates, then how it's counted if its name isn't a count (drinking water, by the cask), then the game's own item in square brackets if it's one, then made from and the goods it's made from if it's made from any, then a colon and a few words" };
  if (/[,\[\]]/.test(head)) return { problem: `"${head}" should be the good's name alone before any ", by the", any [item] and any ", made from"` };
  return { name: head, unit: unit ? unit[1].trim() : null, item: item ? item[1].toLowerCase() : null, from: made ? goodsIn(made[1]) : [], words };
}
export const writeGoodLine = (one) => `${one.name}${one.unit ? `, by the ${one.unit}` : ""}${one.item ? ` [${one.item}]` : ""}${one.from?.length ? `, made from ${one.from.join(", ")}` : ""}${one.words ? `: ${one.words}` : ""}`;

// "food, by its ration crates": which of the supplies every port already has a word for (plenty, normal, short) this
// tree's amounts stand behind, and by which of its goods.
export function readStands(words) {
  const found = String(words ?? "").trim().replace(/\.$/, "").match(/^([a-z]+)\s*,?\s*by\s+(?:its\s+|their\s+|the\s+)?(.+)$/i);
  if (!found) return { problem: `"${words}" should be a supply and one of this tree's goods, such as food, by its ration crates` };
  return { supply: found[1].toLowerCase(), good: found[2].trim() };
}
export const writeStands = (one) => `${one.supply}, by its ${one.good}`;

// What a port's makers need besides what they make things from, each a line at the top of the tree its good is in:
// "hands need: ration crates" (a port short of them has fewer hands at its makers), "the sick need: medicine crates"
// (and more of its people laid up), "power is: fuel cells" (what every maker runs on, but this tree's own).
export const NEEDS = ["hands", "sick", "power"];
export const NEED_KEYS = { hands: "hands need", sick: "the sick need", power: "power is" };

const GOODS_HEADER = ["draft", "stands for", ...NEEDS.map((one) => NEED_KEYS[one])];
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
      else if (key === "stands for") {
        const read = readStands(field[2]);
        if (read.problem) problem(n, read.problem);
        else value.stands = { ...read, line: n };
      } else {
        const good = field[2].trim().replace(/\.$/, "");
        if (!good) problem(n, `${key} is one of this tree's goods, such as ${key}: ration crates`);
        else (value.needs ??= {})[NEEDS.find((one) => NEED_KEYS[one] === key)] = { good, line: n };
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
  for (const need of NEEDS) if (value.needs?.[need]?.good) out.push(`${NEED_KEYS[need]}: ${value.needs[need].good}`);
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

// "60 ration crates, 1,200 casks": amounts in a list, with commas between (or an and before a number), split where
// the next amount starts and never inside a number.
const amountsIn = (words) => String(words ?? "").split(/(?:(?<=\D),\s*|,\s+)(?:and\s+)?(?=\d)|\s+and\s+(?=\d)/i).map((one) => one.trim()).filter(Boolean);

// "the kitchens: 72 ration packs a day, from 36 meal": who makes it, how many and of what, each day, and what goes
// into that many, with commas between: "380 fuel cells a day, from 38 refined fuel, 7.6 parts crates". A maker that
// makes less, for want of room or of anything else, takes that much less of each.
export function readMakeLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  const found = line.match(/^(.+?):\s*(.+?)\s+(?:a|each|every|per)\s+day(?:\s*,?\s*(?:made\s+)?from\s+(.+))?$/i);
  const amount = found ? readAmount(found[2]) : null;
  if (!amount) return { problem: `"${line}" should be who makes it, a colon, how many of what, and a day, then from and what goes into that many if anything does: the kitchens: 72 ration packs a day, from 36 meal` };
  if (!(amount.n > 0)) return { problem: `"${line}" should make more than nothing a day` };
  const from = [];
  for (const piece of found[3] ? amountsIn(found[3]) : []) {
    const input = readAmount(piece);
    if (!input || !(input.n > 0)) return { problem: `"${piece}" should be how many and of what goes into a day's making, such as 36 meal` };
    from.push(input);
  }
  return { name: found[1].trim(), n: amount.n, good: amount.good, from };
}
export const writeMakeLine = (one) => `${one.name}: ${numberWords(one.n)} ${one.good} a day${one.from?.length ? `, from ${one.from.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")}` : ""}`;

// "the Long Fields: 660 grain a day": what comes out of the ground at a port, where it comes out, and how many at
// the most each day. It's made from nothing: only the basic goods are, and only here.
export function readGroundLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  if (/\s+(?:a|each|every|per)\s+day\s*,?\s*(?:made\s+)?from\s+/i.test(line)) return { problem: `"${line}" comes out of the ground, so it isn't made from anything: leave the from out, or write the line under Makes` };
  const found = line.match(/^(.+?):\s*(.+?)\s+(?:a|each|every|per)\s+day$/i);
  const amount = found ? readAmount(found[2]) : null;
  if (!amount) return { problem: `"${line}" should be where it comes out of the ground, a colon, how many of what, and a day: the Long Fields: 660 grain a day` };
  if (!(amount.n > 0)) return { problem: `"${line}" should give more than nothing a day` };
  return { name: found[1].trim(), n: amount.n, good: amount.good };
}
export const writeGroundLine = (one) => `${one.name}: ${numberWords(one.n)} ${one.good} a day`;

// "its people: 60 ration crates, 3 ration packs a day": who uses it up, and how many of each thing, each day.
export function readUseLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "").replace(/\.$/, "");
  const found = line.match(/^(.+?):\s*(.+?)\s+(?:a|each|every|per)\s+day$/i);
  if (!found) return { problem: `"${line}" should be who uses it, a colon, how many of each thing with commas between, and a day: its people: 60 ration crates, 3 ration packs a day` };
  const list = [];
  for (const piece of amountsIn(found[2])) {
    const amount = readAmount(piece);
    if (!amount || !(amount.n > 0)) return { problem: `"${piece}" should be how many and of what, such as 60 ration crates` };
    list.push(amount);
  }
  if (!list.length) return { problem: `"${line}" doesn't say what's used` };
  return { who: found[1].trim(), list };
}
export const writeUseLine = (one) => `${one.who}: ${one.list.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")} a day`;

// "the granary in The Manifest Docks: usually 20 ration crates, 8 meal: A cage of crates and sacks.": one of the
// port's stores in its rooms. Its name, the room it stands in, how many of each good are in it when the port has
// what it usually holds (so it has half of that when the port has half), and a few words about it for whoever looks.
export function readPortStoreLine(text) {
  const line = String(text ?? "").trim().replace(/^-\s*/, "");
  const example = "the granary in The Manifest Docks: usually 20 ration crates, 8 meal: A cage of crates and sacks.";
  const cut = line.search(/:\s/);
  const head = cut < 0 ? line.replace(/:$/, "") : line.slice(0, cut);
  const rest = cut < 0 ? "" : line.slice(cut + 1).trim();
  // Its name can have an in of its own (the bins in the back in The Hook): the room is what follows the last one.
  const where = head.match(/^(.+)\s+in\s+(.+)$/i);
  const second = rest.search(/:\s|:$/);
  const kept = (second < 0 ? rest : rest.slice(0, second)).trim().replace(/\.$/, "");
  const look = second < 0 ? "" : rest.slice(second + 1).trim();
  const usually = kept.match(/^usually\s+(.+)$/i);
  if (!where || !usually) return { problem: `"${line}" should be the store's name, in and its room, a colon, usually and how many of each good with commas between, then a colon and a few words about it if you like: ${example}` };
  const list = [];
  for (const piece of amountsIn(usually[1])) {
    const amount = readAmount(piece);
    if (!amount || !(amount.n > 0) || !Number.isInteger(amount.n)) return { problem: `"${piece}" should be how many and of what, in whole things, such as 20 ration crates` };
    list.push(amount);
  }
  if (!list.length) return { problem: `"${line}" doesn't say what the store usually has in it: ${example}` };
  return { name: where[1].trim(), room: where[2].trim(), list, look };
}
export const writePortStoreLine = (one) => `${one.name} in ${one.room}: usually ${one.list.map((entry) => `${numberWords(entry.n)} ${entry.good}`).join(", ")}${one.look ? `: ${one.look}` : ""}`;

// "Docker Pav, Docker Renko and Docker Bo": the people who carry for a port's stores, by their names in the place's
// file in world/life, or their ids. Commas between them, and an and before the last if you like.
export const readCarriedBy = (words) => String(words ?? "").trim().replace(/\.$/, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+(?=[A-Z])/).map((one) => one.trim()).filter(Boolean);
export const writeCarriedBy = (list) => (list ?? []).join(", ");

const PORT_HEADER = ["draft", "people", "carried by", "goods come and go by"];
export function parsePortText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { id, name: id, holds: [], ground: [], makes: [], uses: [], stores: [] };
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
      else if (key === "carried by") {
        const list = readCarriedBy(field[2]);
        if (!list.length) problem(n, "carried by is who carries for the port's stores, by name, with commas between: carried by: Docker Pav, Docker Renko, Docker Bo");
        else value.carriers = { list, line: n };
      } else if (key === "goods come and go by") {
        const room = field[2].trim().replace(/\.$/, "");
        if (!room) problem(n, "goods come and go by is one of the port's rooms, such as goods come and go by: The Manifest Docks");
        else value.dock = { room, line: n };
      } else if (new RegExp(`^${NUMBER}$`).test(field[2].trim())) value.people = toNumber(field[2]);
      else problem(n, "people is a number, such as people: 6,000");
      continue;
    }
    if (section === "unknown") continue;
    if (!line.startsWith("-")) {
      problem(n, `under ${PORT_TITLES[section]}, each line starts with a dash`);
      continue;
    }
    const words = line.replace(/^-\s*/, "");
    const read = section === "holds" ? readHoldLine(words) : section === "ground" ? readGroundLine(words) : section === "makes" ? readMakeLine(words) : section === "stores" ? readPortStoreLine(words) : readUseLine(words);
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
  if (value.carriers?.list?.length) out.push(`carried by: ${writeCarriedBy(value.carriers.list)}`);
  if (value.dock?.room) out.push(`goods come and go by: ${value.dock.room}`);
  for (const part of PORT_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${PORT_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
