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
  if (rule === "can go bad") return { goesBad: true };
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
  if ((found = rule.match(/^in a fight: attack ([+-]?\d+)$/))) return { fightAttack: Number(found[1]) };
  return { problem: `I don't know the rule "${String(text).trim()}"` };
}
export const RULE_WORDS = "in a fight: attack -2; serious; bleeds 4 an hour; heals in 4 days, 2 once dressed; heals in 8 days once dressed; never heals; out cold for 1 to 4 hours; checks one step harder; the hand's no use; can't stand on it; limps; hidden; artificial; never at random; comes after 2 days undressed; worse every day; likelier in: dock, engine; only for: synthetic; not for: synthetic";

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
const DEFAULT_LIGHT = "20% of their health";
const DEFAULT_HARD = "40% of their health, or a hard hit";

// "20% of their health", and for a hard wound ", or a hard hit" after it: how much of someone's health one hit has to
// take to leave a wound, and whether a hard hit (a critical) always leaves a hard one.
export function readShare(text, hard = false) {
  const found = lower(text).match(/^(\d+(?:\.\d+)?)% of their health(, or a hard hit)?$/);
  if (!found || (found[2] && !hard)) return { problem: hard ? "is written like: 40% of their health, or a hard hit" : "is written like: 20% of their health" };
  return { share: Number(found[1]) / 100, critical: Boolean(found[2]) };
}

// "blade: knife, sword, claw" or "blunt: anything else": which kind of hit a weapon makes, by the words in its name.
export function readWeaponLine(text) {
  const found = String(text).trim().match(/^([A-Za-z]+):\s*(.+)$/);
  if (!found) return { problem: "each one is written: a kind of hit, a colon and words in a weapon's name, like blade: knife, sword" };
  const kind = lower(found[1]);
  if (lower(found[2]) === "anything else") return { kind, rest: true };
  return { kind, words: listOf(found[2]).map(lower) };
}

// "blunt: bruise; hard: broken bone on a limb, concussion on the head; down: knock on the head", or "anything for
// synthetic: dent; hard: cracked casing": the wound a kind of hit leaves, on whom, when it's a hit, a hard one, or the one
// that puts them down. "anything" is any kind of hit.
export function readHitLine(text) {
  const found = String(text).trim().match(/^([A-Za-z]+)(?:\s+for\s+([^:]+))?:\s*(.+)$/);
  if (!found) return { problem: "each one is written: a kind of hit, a colon and the wound it leaves, then hard: and down: if you like, like blade: cut; hard: deep cut" };
  const [light, ...rest] = found[3].split(";").map((one) => one.trim()).filter(Boolean);
  const hit = { kind: lower(found[1]), species: found[2] ? listOf(found[2]).map(lower) : [], light: lower(light) === "nothing" ? null : lower(light), hard: [], down: [] };
  for (const piece of rest) {
    const option = piece.match(/^(hard|down):\s*(.+)$/i);
    if (!option) return { problem: `"${piece}" isn't hard: or down:` };
    for (const one of listOf(option[2])) {
      const [name, where] = one.split(/\s+on\s+/i);
      const parts = where ? readWhere(where) : { parts: PARTS };
      if (parts.problem) return { problem: `${one}: ${parts.problem}` };
      hit[lower(option[1])].push({ name: lower(name), parts: parts.parts });
    }
  }
  return hit;
}

export function parseWoundsText(text) {
  const problems = [];
  const value = { name: "Wounds and old marks", draft: null, oldMarks: DEFAULT_OLD_MARKS, light: DEFAULT_LIGHT, hard: DEFAULT_HARD, care: {}, rough: [], wounds: [], weapons: [], hits: [], accidents: [], marks: [] };
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
    const heading = line.match(/^(Wounds|Weapons|Hits|Accidents|Old marks):$/i);
    if (heading) {
      part = { wounds: "wounds", weapons: "weapons", hits: "hits", accidents: "accidents", "old marks": "marks" }[heading[1].toLowerCase()];
      continue;
    }
    if (part) {
      const entry = line.match(/^-\s+(.*)$/);
      if (!entry) {
        problems.push({ line: n, message: `under "${{ wounds: "Wounds", weapons: "Weapons", hits: "Hits", accidents: "Accidents", marks: "Old marks" }[part]}", each one starts with - and a space` });
        continue;
      }
      value[part].push({ text: entry[1].trim(), line: n });
      continue;
    }
    const field = line.match(/^([A-Za-z][A-Za-z'’ ]{0,40}):\s*(.*)$/);
    if (!field) {
      problems.push({ line: n, message: "before the first part, each line is draft, old marks, a wound from a hit, a hard wound or rough work, then a colon and its value" });
      continue;
    }
    const key = lower(field[1]);
    if (key === "draft") value.draft = field[2].trim();
    else if (key === "old marks") {
      value.oldMarks = field[2].trim();
      const read = readOldMarks(value.oldMarks);
      if (read.problem) problems.push({ line: n, message: read.problem });
    } else if (key === "rough work") value.rough = listOf(field[2]).map(lower);
    else if (key === "a wound from a hit" || key === "a hard wound") {
      const read = readShare(field[2], key === "a hard wound");
      if (read.problem) problems.push({ line: n, message: `${key} ${read.problem}` });
      value[key === "a hard wound" ? "hard" : "light"] = field[2].trim();
    } else if (CARE[key.replace(/’/g, "'")]) {
      const careKey = key.replace(/’/g, "'");
      const read = CARE[careKey].read(field[2]);
      if (read.problem) problems.push({ line: n, message: `${careKey} ${read.problem}` });
      value.care[careKey] = field[2].trim();
    } else problems.push({ line: n, message: `I don't know "${field[1]}": the lines at the top are draft, old marks, a wound from a hit, a hard wound, ${Object.keys(CARE).join(", ")} and rough work` });
  }
  if (!titled) problems.push({ line: 1, message: "the file is empty: it starts with # Wounds and old marks" });
  return { value, problems };
}

export function writeWoundsText(value) {
  const out = [`# ${value.name ?? "Wounds and old marks"}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  out.push(`old marks: ${value.oldMarks ?? DEFAULT_OLD_MARKS}`);
  out.push(`a wound from a hit: ${value.light ?? DEFAULT_LIGHT}`, `a hard wound: ${value.hard ?? DEFAULT_HARD}`);
  for (const key of Object.keys(CARE)) if (value.care?.[key] !== undefined) out.push(`${key}: ${value.care[key]}`);
  if (value.rough?.length) out.push(`rough work: ${value.rough.join(", ")}`);
  out.push("", "Wounds:", ...(value.wounds ?? []).map((one) => `- ${one.text}`));
  out.push("", "Weapons:", ...(value.weapons ?? []).map((one) => `- ${one.text}`));
  out.push("", "Hits:", ...(value.hits ?? []).map((one) => `- ${one.text}`));
  if (value.accidents?.length) out.push("", "Accidents:", ...value.accidents.map((one) => `- ${one.text}`));
  out.push("", "Old marks:", ...(value.marks ?? []).map((one) => `- ${one.text}`));
  return `${out.join("\n")}\n`;
}

// ---- Living with wounds -------------------------------------------------------------------------

const share = (text) => {
  const found = lower(text).match(/^(\d+(?:\.\d+)?)% of the pace$/);
  return found ? { pace: Number(found[1]) / 100 } : { problem: "is written like: 60% of the pace" };
};
const TIMES = { twice: 2, "three times": 3, "four times": 4, "half again": 1.5 };
// The lines at the top of the wounds file about blood, bleeding, dressing, healing, walking and pain, each with how it's
// read and what it reads to. Their defaults are the draft's.
export const CARE = {
  "blood comes back": { read: (text) => { const f = lower(text).match(/^(\S+) an hour(, once nothing bleeds)?$/); return f && numberOf(f[1]) !== null ? { perHour: numberOf(f[1]) } : { problem: "is written like: 2 an hour, once nothing bleeds" }; }, default: "2 an hour, once nothing bleeds" },
  "low on blood": { read: (text) => { const f = lower(text).match(/^under (\d+), checks (\S+) steps? harder$/); return f && numberOf(f[2]) !== null ? { under: Number(f[1]), harder: numberOf(f[2]) } : { problem: "is written like: under 60, checks one step harder" }; }, default: "under 60, checks one step harder" },
  "bleeding stops at": { read: (text) => { const f = lower(text).match(/^(\d+)(, for now)?$/); return f ? { floor: Number(f[1]) } : { problem: "is written like: 35, for now" }; }, default: "35, for now" },
  "they dress their own": { read: (text) => { const f = lower(text).match(/^wounds that aren['’]t serious, after (an|\S+) hours?$/); return f && numberOf(f[1]) !== null ? { hours: numberOf(f[1]) } : { problem: "is written like: wounds that aren't serious, after an hour" }; }, default: "wounds that aren't serious, after an hour" },
  "left alone": { read: (text) => { const f = lower(text).match(/^(twice|three times|four times|half again|\d+(?:\.\d+)? times) as long, for a wound that heals once treated$/); return f ? { factor: TIMES[f[1]] ?? Number(f[1].split(" ")[0]) } : { problem: "is written like: twice as long, for a wound that heals once treated" }; }, default: "twice as long, for a wound that heals once treated" },
  "with a limp": { read: share, default: "60% of the pace" },
  "on a leg they can't stand on": { read: share, default: "30% of the pace" },
  pain: { read: (text) => { const f = lower(text).match(/^(\S+) stress a day for a wound, (\S+) for a serious one$/); return f && numberOf(f[1]) !== null && numberOf(f[2]) !== null ? { wound: numberOf(f[1]), serious: numberOf(f[2]) } : { problem: "is written like: 2 stress a day for a wound, 5 for a serious one" }; }, default: "2 stress a day for a wound, 5 for a serious one" },
};
export const careOf = (care = {}) => Object.fromEntries(Object.entries(CARE).map(([key, one]) => {
  const read = one.read(care[key] ?? one.default);
  return [key, read.problem ? one.read(one.default) : read];
}));

// "burn: likelier in: engine, cook": the wound an accident at work leaves, and the work it's likelier in.
export function readAccidentLine(text) {
  const found = String(text).trim().match(/^([^:;]+?)(?::\s*likelier in:\s*(.+))?$/i);
  if (!found || !found[1].trim()) return { problem: "each one is written: a wound, and likelier in: and the work, like burn: likelier in: engine, cook" };
  return { name: lower(found[1]), likelier: found[2] ? listOf(found[2]).map(lower) : [] };
}

// "07:45 to 10:30, at queue": when the hurt go to the medbay, and the spot or group of spots in the place's life file.
export function readQueue(text) {
  const found = lower(text).match(/^(\d{1,2}):(\d{2}) to (\d{1,2}):(\d{2}), at (.+)$/);
  if (!found) return { problem: "is written like: 07:45 to 10:30, at queue" };
  return { from: Number(found[1]) * 60 + Number(found[2]), to: Number(found[3]) * 60 + Number(found[4]), at: found[5].trim() };
}

// "1 in 20 days in rough work, 1 in 100 for everyone else": how often someone has an accident at their work.
export function readAccidents(text) {
  const found = lower(text).match(/^1 in (\d+) days in rough work, 1 in (\d+) for everyone else$/);
  if (!found || Number(found[1]) < 1 || Number(found[2]) < 1) return { problem: "is written like: 1 in 20 days in rough work, 1 in 100 for everyone else" };
  return { rough: 1 / Number(found[1]), anyone: 1 / Number(found[2]) };
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
    const key = field ? lower(field[1]) : null;
    if (key === "draft") value.draft = field[2].trim();
    else if (key === "the morning queue" || key === "accidents at work") {
      const read = key === "the morning queue" ? readQueue(field[2]) : readAccidents(field[2]);
      if (read.problem) problems.push({ line: n, message: `${key} ${read.problem}` });
      value[key === "the morning queue" ? "queue" : "accidents"] = field[2].trim();
    } else problems.push({ line: n, message: field ? `I don't know "${field[1]}": the lines at the top are draft, the morning queue and accidents at work, and the only part is At the start` : "before At the start, each line is draft, the morning queue or accidents at work, then a colon and its value" });
  }
  if (!titled) problems.push({ line: 1, message: "the file is empty: it starts with # and the place's name" });
  return { value, problems };
}

export function writeHealthText(value) {
  const out = [`# ${value.name ?? ""}`];
  if (value.draft) out.push(`draft: ${value.draft}`);
  if (value.queue) out.push(`the morning queue: ${value.queue}`);
  if (value.accidents) out.push(`accidents at work: ${value.accidents}`);
  out.push("", "At the start:", ...(value.start ?? []).map((one) => `- ${one.text}`));
  return `${out.join("\n")}\n`;
}
