// The bodies' plain-text files, and the one line they share with a person's Body part. world/health/wounds.txt says
// what kinds of wound there are and what old marks people carry from their lives; world/health/<place>.txt says who
// starts the game hurt or marked at a place, and will say more about its medbay later. A body line is a part, a colon
// and what's there: "left arm: two fingers gone from the left hand". This runs in the browser too, so it uses nothing
// from either. world/health/_how-to-write-health.txt explains the formats.

// Everyone has these six, seen from in front: the right arm is on the left of the picture.
export const PARTS = ["head", "chest", "right_arm", "left_arm", "right_leg", "left_leg"];
export const PART_WORDS = { head: "head", chest: "chest", right_arm: "right arm", left_arm: "left arm", right_leg: "right leg", left_leg: "left leg" };
// How often a hit lands on each part, out of the total, for a species whose file doesn't say.
export const DEFAULT_HITS = { head: 10, chest: 34, right_arm: 14, left_arm: 14, right_leg: 14, left_leg: 14 };

const ARMS = ["right_arm", "left_arm"];
const LEGS = ["right_leg", "left_leg"];
const WHERE = {
  "any part": PARTS, anywhere: PARTS,
  "the head": ["head"], head: ["head"], "the chest": ["chest"], chest: ["chest"],
  "an arm": ARMS, arm: ARMS, "a leg": LEGS, leg: LEGS, "a limb": [...ARMS, ...LEGS], limb: [...ARMS, ...LEGS],
  "the right arm": ["right_arm"], "right arm": ["right_arm"], "the left arm": ["left_arm"], "left arm": ["left_arm"],
  "the right leg": ["right_leg"], "right leg": ["right_leg"], "the left leg": ["left_leg"], "left leg": ["left_leg"],
};

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const numberOf = (word) => (/^\d+(\.\d+)?$/.test(String(word)) ? Number(word) : NUMBER_WORDS[String(word).toLowerCase()] ?? null);
const listOf = (words) => String(words).split(",").map((one) => one.trim()).filter(Boolean);
const lower = (text) => String(text ?? "").trim().toLowerCase();

// "a limb", "the chest or a limb", "head, chest": the parts it can be on.
export function readWhere(words) {
  const parts = new Set();
  for (const piece of lower(words).split(/\s*(?:,|\bor\b)\s*/).filter(Boolean)) {
    const found = WHERE[piece];
    if (!found) return { problem: `"${piece}" isn't a part: write any part, the head, the chest, an arm, a leg, a limb, or one of right arm, left arm, right leg and left leg` };
    for (const part of found) parts.add(part);
  }
  if (!parts.size) return { problem: "it doesn't say where" };
  return { parts: PARTS.filter((part) => parts.has(part)) };
}

// ---- A rule after the words ------------------------------------------------------------------

// What each rule means is up to the game, step by step; for now it only shows them. A rule it can't read is a
// problem for the checker.
export function readRule(text) {
  const rule = lower(text);
  let found;
  if (rule === "serious") return { serious: true };
  if (rule === "limps") return { limps: true };
  if (rule === "hidden") return { hidden: true };
  if (rule === "artificial") return { artificial: true };
  if (rule === "never at random") return { notRandom: true };
  if (rule === "never heals") return { never: true };
  if (rule === "worse every day") return { worsens: true };
  if (rule === "the hand's no use" || rule === "the hand’s no use") return { noHand: true };
  if (rule === "can't stand on it" || rule === "can’t stand on it") return { noStand: true };
  if ((found = rule.match(/^bleeds (\S+) an hour( until treated)?$/)) && numberOf(found[1]) !== null) return { bleeds: numberOf(found[1]) };
  if ((found = rule.match(/^heals in (\S+) days?(?:, (\S+) once (dressed|splinted))?$/)) && numberOf(found[1]) !== null && (!found[2] || numberOf(found[2]) !== null)) {
    return found[2] ? { heals: numberOf(found[1]), treated: numberOf(found[2]), treatment: found[3] } : { heals: numberOf(found[1]) };
  }
  if ((found = rule.match(/^heals in (\S+) days? once (dressed|splinted)$/)) && numberOf(found[1]) !== null) return { heals: null, treated: numberOf(found[1]), treatment: found[2] };
  if ((found = rule.match(/^out cold for (\S+) to (\S+) hours?$/)) && numberOf(found[1]) !== null && numberOf(found[2]) !== null) return { out: [numberOf(found[1]), numberOf(found[2])] };
  if ((found = rule.match(/^checks (\S+) steps? harder$/)) && numberOf(found[1]) !== null) return { harder: numberOf(found[1]) };
  if ((found = rule.match(/^comes after (\S+) days? undressed$/)) && numberOf(found[1]) !== null) return { after: numberOf(found[1]) };
  if ((found = rule.match(/^likelier in:\s*(.+)$/))) return { likelier: listOf(found[1]).map(lower) };
  if ((found = rule.match(/^only for:\s*(.+)$/))) return { only: listOf(found[1]).map(lower) };
  if ((found = rule.match(/^not for:\s*(.+)$/))) return { not: listOf(found[1]).map(lower) };
  return { problem: `I don't know the rule "${String(text).trim()}"` };
}
export const RULE_WORDS = "serious; bleeds 4 an hour; heals in 4 days, 2 once dressed; heals in 8 days once dressed; never heals; out cold for 1 to 4 hours; checks one step harder; the hand's no use; can't stand on it; limps; hidden; artificial; never at random; comes after 2 days undressed; worse every day; likelier in: dock, engine; only for: synthetic; not for: synthetic";

// Words, then rules, separated by semicolons: "a bad {side} knee; limps; likelier in: dock".
function readWordsAndRules(text) {
  const [words, ...rest] = String(text).split(";").map((one) => one.trim());
  const rules = {};
  const problems = [];
  for (const piece of rest.filter(Boolean)) {
    const rule = readRule(piece);
    if (rule.problem) problems.push(rule.problem);
    else Object.assign(rules, rule);
  }
  return { words, rules, problems };
}

// ---- The kinds of wound and old mark ----------------------------------------------------------

// "deep cut, any part: a deep cut in the {part}; serious; bleeds 12 an hour".
export function readKindLine(text) {
  const found = String(text).match(/^([^,:]+),\s*([^:]+):\s*(.*)$/);
  if (!found) return { problem: "each one is written: its name, where it can be: what it looks like; and its rules, like deep cut, any part: a deep cut in the {part}; serious" };
  const name = found[1].trim();
  const where = readWhere(found[2]);
  if (where.problem) return { problem: `${name}: ${where.problem}` };
  const { words, rules, problems } = readWordsAndRules(found[3]);
  if (!words) return { problem: `${name}: say what it looks like after the colon, like a bruise on the {part}` };
  if (problems.length) return { problem: `${name}: ${problems.join("; ")}` };
  return { name, parts: where.parts, words, ...rules };
}

// "one every 20 years after 20, at most 3".
export function readOldMarks(text) {
  const found = lower(text).match(/^(?:one|a mark) every (\S+) years? after (\S+)(?:, at most (\S+))?$/);
  if (!found || numberOf(found[1]) === null || numberOf(found[2]) === null || (found[3] && numberOf(found[3]) === null)) return { problem: "old marks is written like: one every 20 years after 20, at most 3" };
  return { every: numberOf(found[1]), after: numberOf(found[2]), most: found[3] ? numberOf(found[3]) : 3 };
}

const DEFAULT_OLD_MARKS = "one every 20 years after 20, at most 3";

export function parseWoundsText(text) {
  const problems = [];
  const value = { name: "Wounds and old marks", draft: null, oldMarks: DEFAULT_OLD_MARKS, rough: [], wounds: [], marks: [] };
  let part = null;
  let titled = false;
  for (const [index, raw] of String(text ?? "").replace(/\r\n?/g, "\n").split("\n").entries()) {
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
      problems.push({ line: n, message: "the first line is the name, written # Wounds and old marks" });
    }
    const heading = line.match(/^(Wounds|Old marks):$/i);
    if (heading) {
      part = heading[1].toLowerCase() === "wounds" ? "wounds" : "marks";
      continue;
    }
    if (part) {
      const entry = line.match(/^-\s+(.*)$/);
      if (!entry) {
        problems.push({ line: n, message: `under "${part === "wounds" ? "Wounds" : "Old marks"}", each one starts with - and a space` });
        continue;
      }
      value[part].push({ text: entry[1].trim(), line: n });
      continue;
    }
    const field = line.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*(.*)$/);
    if (!field) {
      problems.push({ line: n, message: "before the first part, each line is draft, old marks or rough work, then a colon and its value" });
      continue;
    }
    const key = lower(field[1]);
    if (key === "draft") value.draft = field[2].trim();
    else if (key === "old marks") {
      value.oldMarks = field[2].trim();
      const read = readOldMarks(value.oldMarks);
      if (read.problem) problems.push({ line: n, message: read.problem });
    } else if (key === "rough work") value.rough = listOf(field[2]).map(lower);
    else problems.push({ line: n, message: `I don't know "${field[1]}": the lines at the top are draft, old marks and rough work` });
  }
  if (!titled) problems.push({ line: 1, message: "the file is empty: it starts with # Wounds and old marks" });
  return { value, problems };
}

export function writeWoundsText(value) {
  const out = [`# ${value.name ?? "Wounds and old marks"}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  out.push(`old marks: ${value.oldMarks ?? DEFAULT_OLD_MARKS}`);
  if (value.rough?.length) out.push(`rough work: ${value.rough.join(", ")}`);
  out.push("", "Wounds:", ...(value.wounds ?? []).map((one) => `- ${one.text}`));
  out.push("", "Old marks:", ...(value.marks ?? []).map((one) => `- ${one.text}`));
  return `${out.join("\n")}\n`;
}

// ---- A body line ------------------------------------------------------------------------------

// "left arm: two fingers gone from the left hand", "a leg: bad knee; limps", or "nothing else". The part can be
// any of the where words, and then the game picks one of them for each game.
export function readBodyLine(text) {
  const line = String(text ?? "").trim();
  if (/^nothing else\.?$/i.test(line)) return { nothingElse: true };
  const found = line.match(/^([^:]+):\s*(.+)$/);
  if (!found) return { problem: `"${line}" is written: the part, a colon and what's there, like left arm: two fingers gone from the left hand` };
  const where = readWhere(found[1]);
  if (where.problem) return { problem: where.problem };
  const { words, rules, problems } = readWordsAndRules(found[2]);
  if (!words) return { problem: `say what's on the ${found[1].trim()} after the colon` };
  if (problems.length) return { problem: problems.join("; ") };
  return { parts: where.parts, words, rules };
}

// ---- A place's health -------------------------------------------------------------------------

// "Vik, right leg: broken bone": someone, then a body line.
export function readStartLine(text) {
  const found = String(text ?? "").trim().match(/^([^,:]+),\s*(.+)$/);
  if (!found) return { problem: "each one is written: who, the part: what's there, like Vik, right leg: broken bone" };
  const body = readBodyLine(found[2]);
  if (body.problem) return { problem: `${found[1].trim()}: ${body.problem}` };
  if (body.nothingElse) return { problem: `${found[1].trim()}: nothing else goes in a person's own file, not here` };
  return { who: found[1].trim(), ...body };
}

export function parseHealthText(text, id = "it") {
  const problems = [];
  const value = { name: id, draft: null, start: [] };
  let part = null;
  let titled = false;
  for (const [index, raw] of String(text ?? "").replace(/\r\n?/g, "\n").split("\n").entries()) {
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
      problems.push({ line: n, message: "the first line is the place's name, written # CFS Meridian" });
    }
    if (/^At the start:$/i.test(line)) {
      part = "start";
      continue;
    }
    if (part) {
      const entry = line.match(/^-\s+(.*)$/);
      if (!entry) problems.push({ line: n, message: 'under "At the start", each one starts with - and a space' });
      else value.start.push({ text: entry[1].trim(), line: n });
      continue;
    }
    const field = line.match(/^([A-Za-z][A-Za-z ]{0,30}):\s*(.*)$/);
    if (field && lower(field[1]) === "draft") value.draft = field[2].trim();
    else problems.push({ line: n, message: field ? `I don't know "${field[1]}": for now the only line at the top is draft, and the only part is At the start` : "before At the start, the only line is draft, then a colon and its value" });
  }
  if (!titled) problems.push({ line: 1, message: "the file is empty: it starts with # and the place's name" });
  return { value, problems };
}

export function writeHealthText(value) {
  const out = [`# ${value.name ?? ""}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  out.push("", "At the start:", ...(value.start ?? []).map((one) => `- ${one.text}`));
  return `${out.join("\n")}\n`;
}
