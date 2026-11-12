// A battle, written as plain text in world/battles/<id>.txt: a fight fought by everyone on a deck at once, in the room,
// in real time. This reads the file into what src/battles.js plays, and writes it back the same way. It reads only the
// words: whether the place, the rooms, the enemies and the people are real is for src/battles.js to say. It runs in the
// browser too.
//
//     # The Red Cloth
//     place: meridian
//     deck: deck1
//     they make for: The Bridge
//     they give up: when 2 in 3 of them are out of it
//     crew fight as: ship_hand
//     the rest take cover in: The Quiet Room
//     when they give up: The rest of them throw their sidearms down.
//     morale falls by: 5, and 2 for each of yours who went down, and 5 more if you went down
//     the council's confidence falls by: 10, and 5 more if you went down
//
//     Against you:
//     - 6 mutineer_crew, up The Upper Forward Stair
//     - 6 mutineer_crew, up The Upper Aft Stair, 12 seconds in: More of them come up the aft stair.
//
//     With you:
//     - everyone on the deck who can fight
//     - tarrow, up The Upper Aft Stair, 60 seconds in: Lieutenant Tarrow comes up from below.
//     - the ensigns, up The Upper Forward Stair, 60 seconds in

// The lines at the top, by the words they start with, and what each is called in the battle.
export const BATTLE_HEADER = {
  draft: "draft",
  place: "place",
  deck: "deck",
  "they make for": "target",
  "they give up": "giveUp",
  "crew fight as": "crewAs",
  "the rest take cover in": "cover",
  "when they give up": "gaveUpLine",
  "morale falls by": "morale",
  "the council's confidence falls by": "confidence",
};
const HEADER_ORDER = ["draft", "place", "deck", "target", "giveUp", "crewAs", "cover", "gaveUpLine", "morale", "confidence"];
const WORDS_FOR = Object.fromEntries(Object.entries(BATTLE_HEADER).map(([words, key]) => [key, words]));
// The two lists, by their headings.
export const BATTLE_SIDES = { "against you": "against", "with you": "with" };
// The line in With you that means everyone already on the deck who can fight.
export const EVERYONE = "everyone on the deck who can fight";

const GIVE_UP = /^when\s+(\d+)\s+in\s+(\d+)\s+of\s+them\s+are\s+(?:out\s+of\s+it|down)$/i;
// What a battle costs aboard afterwards: so much, so much more for each on the player's side who went down, and so much
// more if the player went down too (src/aftermath.js).
const MORALE = /^(\d+)(?:,\s*and\s+(\d+)\s+for\s+each\s+of\s+yours\s+who\s+went\s+down)?(?:,\s*and\s+(\d+)\s+more\s+if\s+you\s+went\s+down)?$/i;
const CONFIDENCE = /^(\d+)(?:,\s*and\s+(\d+)\s+more\s+if\s+you\s+went\s+down)?$/i;
// A group's line: how many and who, or who; where they come in; when, if not at the start; and what's said as they come.
const AGAINST = /^(\d+)\s+([a-z][a-z0-9_]*)\s*,\s*(up|in)\s+([^,:]+?)\s*(?:,\s*(\d+)\s+seconds?\s+in)?\s*(?::\s*(.+))?$/i;
const WITH = /^(.+?)\s*,\s*(up|in)\s+([^,:]+?)\s*(?:,\s*(\d+)\s+seconds?\s+in)?\s*(?::\s*(.+))?$/i;

// Reads a battle's file. Each problem names its line, and the battle is read as far as it can be.
export function parseBattleText(text, id = "battle") {
  const battle = { id, title: null, notes: [], against: [], with: [] };
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  let side = null;
  String(text ?? "").split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("//")) {
      // Notes before the lists are kept, so the file reads the same when it's written back.
      if (!side) battle.notes.push(trimmed.replace(/^\/\/\s?/, ""));
      return;
    }
    if (trimmed.startsWith("#")) {
      if (battle.title) problem(line, "a battle has one # title line");
      battle.title = trimmed.replace(/^#+\s*/, "");
      return;
    }
    const heading = trimmed.match(/^([A-Za-z ]+):$/);
    if (heading && BATTLE_SIDES[heading[1].toLowerCase()]) {
      side = BATTLE_SIDES[heading[1].toLowerCase()];
      return;
    }
    if (!side) {
      const top = trimmed.match(/^([a-z' ]+?):\s*(.*)$/i);
      const key = top ? BATTLE_HEADER[top[1].toLowerCase().replace(/\s+/g, " ")] : null;
      if (!key) {
        problem(line, `before Against you: and With you:, a line is one of ${Object.keys(BATTLE_HEADER).join(", ")}, then a colon and what it is`);
        return;
      }
      if (battle[key] !== undefined) problem(line, `${top[1]}: is written twice`);
      const value = top[2].trim();
      if (!value) {
        problem(line, `${top[1]}: needs something after the colon`);
        return;
      }
      if (key === "morale") {
        const found = value.match(MORALE);
        if (!found) problem(line, 'morale falls by: is written as a number, then if you like ", and 2 for each of yours who went down" and ", and 5 more if you went down"');
        else battle.morale = { base: Number(found[1]), each: Number(found[2] ?? 0), you: Number(found[3] ?? 0) };
        return;
      }
      if (key === "confidence") {
        const found = value.match(CONFIDENCE);
        if (!found) problem(line, "the council's confidence falls by: is written as a number, then if you like: , and 5 more if you went down");
        else battle.confidence = { base: Number(found[1]), you: Number(found[2] ?? 0) };
        return;
      }
      if (key === "giveUp") {
        if (/^never$/i.test(value)) battle.giveUp = null;
        else {
          const found = value.match(GIVE_UP);
          if (!found) problem(line, 'they give up: is written "when 2 in 3 of them are out of it", or "never"');
          else {
            const [of, out] = [Number(found[1]), Number(found[2])];
            if (!(of >= 1 && out >= of)) problem(line, "they give up: the first number is how many, out of the second, and it can't be more");
            battle.giveUp = { of, in: out };
          }
        }
        return;
      }
      battle[key] = value;
      return;
    }
    if (!trimmed.startsWith("-")) {
      problem(line, `under ${side === "against" ? "Against you" : "With you"}:, each line starts with - and a space`);
      return;
    }
    const body = trimmed.replace(/^-\s*/, "");
    if (side === "against") {
      const found = body.match(AGAINST);
      if (!found) {
        problem(line, "a line under Against you: is written - 6 mutineer_crew, up The Upper Forward Stair, and then, if they come later, , 12 seconds in, and if something's said as they come, a colon and the words");
        return;
      }
      const [, count, enemy, how, room, after, words] = found;
      if (Number(count) < 1) problem(line, "a group needs at least one in it");
      battle.against.push({ line, count: Number(count), enemy, how: how.toLowerCase(), room: room.trim(), after: after === undefined ? 0 : Number(after), ...(words ? { words: words.trim() } : {}) });
      return;
    }
    if (body.toLowerCase() === EVERYONE) {
      if (battle.with.some((one) => one.everyone)) problem(line, `${EVERYONE} is written twice`);
      battle.with.push({ line, everyone: true });
      return;
    }
    const found = body.match(WITH);
    if (!found) {
      problem(line, `a line under With you: is either "${EVERYONE}", or who and where they come in, like - tarrow, up The Upper Aft Stair, 60 seconds in`);
      return;
    }
    const [, who, how, room, after, words] = found;
    battle.with.push({ line, who: who.trim(), how: how.toLowerCase(), room: room.trim(), after: after === undefined ? 0 : Number(after), ...(words ? { words: words.trim() } : {}) });
  });
  if (!battle.title) problem(1, "a battle starts with its title, on a line that starts with #");
  if (!battle.against.length) problem(1, "a battle needs at least one line under Against you:");
  return { battle, problems };
}

// A group's line, the way the file has it.
const placeWords = (one) => [`${one.how} ${one.room}`, one.after ? `${one.after} seconds in` : null].filter(Boolean).join(", ");
const said = (one) => (one.words ? `: ${one.words}` : "");

// Writes a battle back as its file.
export function writeBattleText(battle) {
  const lines = [`# ${battle.title ?? battle.id}`];
  for (const note of battle.notes ?? []) lines.push(`// ${note}`.trimEnd());
  for (const key of HEADER_ORDER) {
    if (key === "giveUp") {
      if (battle.giveUp === null) lines.push(`${WORDS_FOR.giveUp}: never`);
      else if (battle.giveUp) lines.push(`${WORDS_FOR.giveUp}: when ${battle.giveUp.of} in ${battle.giveUp.in} of them are out of it`);
      continue;
    }
    if (key === "morale") {
      const m = battle.morale;
      if (m) lines.push(`${WORDS_FOR.morale}: ${[m.base, m.each ? `and ${m.each} for each of yours who went down` : null, m.you ? `and ${m.you} more if you went down` : null].filter((one) => one !== null).join(", ")}`);
      continue;
    }
    if (key === "confidence") {
      const m = battle.confidence;
      if (m) lines.push(`${WORDS_FOR.confidence}: ${[m.base, m.you ? `and ${m.you} more if you went down` : null].filter((one) => one !== null).join(", ")}`);
      continue;
    }
    if (battle[key]) lines.push(`${WORDS_FOR[key]}: ${battle[key]}`);
  }
  lines.push("", "Against you:");
  for (const one of battle.against ?? []) lines.push(`- ${one.count} ${one.enemy}, ${placeWords(one)}${said(one)}`);
  lines.push("", "With you:");
  for (const one of battle.with ?? []) lines.push(one.everyone ? `- ${EVERYONE}` : `- ${one.who}, ${placeWords(one)}${said(one)}`);
  return `${lines.join("\n")}\n`;
}
