// A place's chain of command as plain text: world/command/<place>.txt. The file names the place, has a few numbers
// at the top, and one part each for Posts, Jobs and Who holds what, every line of them starting with - and a space.
// This only reads and writes the words, and reads a line into its pieces; which rooms, people and skills they name is
// worked out by src/command.js, which knows the maps. It runs in the browser too, for the Story board.
// world/command/_how-to-write-command.txt explains the format.

export const COMMAND_PARTS = ["posts", "jobs", "holders", "workers"];
export const COMMAND_TITLES = { posts: "Posts", jobs: "Jobs", holders: "Who holds what", workers: "Who does which job" };
// The people the first officer can put to work where a job's short, written under Who does which job.
export const SPARE = "spare hands";

// The lines at the top of the file, kept as words for src/command.js to read.
export const COMMAND_HEADER = [
  { key: "draft", path: "draft" },
  { key: "each point of skill", path: "numbers.skill" },
  { key: "reviews every", path: "numbers.reviews" },
  { key: "a bad stretch", path: "numbers.stretch" },
  { key: "the captain's choices stand", path: "numbers.stands" },
  { key: "memories fade", path: "numbers.fade" },
  { key: "everyone else", path: "numbers.crew" },
  { key: "mutiny brews", path: "numbers.mutiny" },
  { key: "the mutiny builds", path: "numbers.builds" },
  { key: "the council's confidence", path: "numbers.confidence" },
  { key: "the brig", path: "numbers.brig" },
];

// Who chooses a post when it isn't another post: the civil council, or the civilians themselves.
export const BODIES = ["council", "civilians"];
// The captain's post, when it's "the chair": the player if they started as the captain, or whoever was given the chair.
export const THE_CHAIR = "the chair";

const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function set(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  holder[keys.at(-1)] = value;
}

export const slugOf = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
const listOf = (words) => String(words ?? "").split(/\s*,\s*|\s+and\s+/i).map((one) => one.trim()).filter(Boolean);

// ---- Reading a file ---------------------------------------------------------------------------

// The file into { name, draft, numbers, posts: [{ text, line }], jobs: [...], holders: [...] }, with every line kept
// as words for src/command.js to make sense of.
export function parseCommandText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const value = { name: id, numbers: {}, posts: [], jobs: [], holders: [], workers: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const header = new Map(COMMAND_HEADER.map((field) => [field.key, field]));
  const headings = new Map(COMMAND_PARTS.map((part) => [COMMAND_TITLES[part].toLowerCase(), part]));
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
      const part = headings.get(heading[1].trim().toLowerCase());
      if (!part) {
        problem(n, `"${heading[1].trim()}" isn't a part of a place's chain of command: the parts are ${COMMAND_PARTS.map((one) => COMMAND_TITLES[one]).join(", ")}`);
        section = "unknown";
        continue;
      }
      if (seen.has(part)) problem(n, `"${COMMAND_TITLES[part]}" is written twice`);
      seen.add(part);
      section = part;
      continue;
    }
    if (section === null) {
      const field = line.match(/^([a-z][a-z'’ ]{0,40}):\s*(.*)$/i);
      const known = field && header.get(field[1].trim().toLowerCase().replace(/’/g, "'"));
      if (!known) {
        problem(n, `before the first part, each line is one of ${COMMAND_HEADER.map((one) => one.key).join(", ")}, then a colon and its value`);
        continue;
      }
      set(value, known.path, field[2].trim());
      continue;
    }
    const entry = line.match(/^-\s+(.+)$/);
    if (!entry) {
      problem(n, "under each part, each line starts with - and a space, such as - quartermaster in The Long Mess: chosen by the captain");
      continue;
    }
    if (section === "unknown") continue;
    value[section].push({ text: entry[1].trim(), line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with # The Name");
  return { value, problems };
}

// ---- The words of a post's line ---------------------------------------------------------------

// "quartermaster in The Long Mess: chosen by the captain; heads cooks, mess hands, gardeners; skills commerce; duty:
// sittings missed, stores run dry". The post, the room it's kept in, then what's said about it, each part after a
// semicolon: who chooses whoever holds it (another post, or the council, or the civilians), whether they keep the
// watch bill, the jobs they head, who a new holder is picked from (jobs and posts), the skills that count for it,
// and what their duty is measured by.
export function readPostLine(text) {
  const written = String(text ?? "").trim();
  const colon = written.indexOf(":");
  if (colon < 0) return { problem: `"${written}" needs a colon after the post and its room, then who chooses it` };
  const head = written.slice(0, colon).trim();
  const where = head.match(/^(.+?)\s+(in|on|at)\s+(.+)$/i);
  if (!where) return { problem: `"${head}" needs the room the post is kept in, such as quartermaster in The Long Mess` };
  const post = { title: where[1].trim().toLowerCase(), prep: where[2].toLowerCase(), room: where[3].trim(), chosenBy: null, watchBill: false, brig: false, heads: [], pool: [], skills: [], duty: [] };
  for (const piece of written.slice(colon + 1).split(";").map((one) => one.trim()).filter(Boolean)) {
    let found;
    if ((found = piece.match(/^chosen\s+by\s+(?:the\s+)?(.+)$/i))) post.chosenBy = found[1].trim().toLowerCase();
    else if (/^keeps\s+the\s+watch\s+bill$/i.test(piece)) post.watchBill = true;
    else if (/^keeps\s+the\s+brig$/i.test(piece)) post.brig = true;
    else if ((found = piece.match(/^heads\s+(.+)$/i))) post.heads = listOf(found[1]).map((one) => one.toLowerCase());
    else if ((found = piece.match(/^picked\s+from\s+(.+)$/i))) post.pool = listOf(found[1]).map((one) => one.toLowerCase());
    else if ((found = piece.match(/^skills?\s+(.+)$/i))) post.skills = listOf(found[1]).map((one) => one.toLowerCase());
    else if ((found = piece.match(/^duty:?\s+(.+)$/i))) post.duty = listOf(found[1]);
    else return { problem: `"${piece}" isn't something a post's line says: it says chosen by, keeps the watch bill, keeps the brig, heads, picked from, skills or duty, each after a semicolon` };
  }
  if (!post.chosenBy) return { problem: `"${written}" needs to say who chooses whoever holds it, such as chosen by the captain` };
  return post;
}

// ---- The words of a job's line ----------------------------------------------------------------

// "cook in The Galley: 2 wanted; skills survival". The job, where it's done, how many it wants, and its skills.
export function readJobLine(text) {
  const written = String(text ?? "").trim();
  const colon = written.indexOf(":");
  if (colon < 0) return { problem: `"${written}" needs a colon after the job and its room, then how many it wants` };
  const head = written.slice(0, colon).trim();
  const where = head.match(/^(.+?)\s+(in|on|at)\s+(.+)$/i);
  if (!where) return { problem: `"${head}" needs the room the job's done in, such as cook in The Galley` };
  const job = { title: where[1].trim().toLowerCase(), prep: where[2].toLowerCase(), room: where[3].trim(), wanted: null, skills: [] };
  for (const piece of written.slice(colon + 1).split(";").map((one) => one.trim()).filter(Boolean)) {
    let found;
    if ((found = piece.match(/^(\d+)\s+wanted$/i))) job.wanted = Number(found[1]);
    else if ((found = piece.match(/^skills?\s+(.+)$/i))) job.skills = listOf(found[1]).map((one) => one.toLowerCase());
    else return { problem: `"${piece}" isn't something a job's line says: it says how many are wanted and its skills, each after a semicolon` };
  }
  if (job.wanted === null) return { problem: `"${written}" needs to say how many it wants, such as 2 wanted` };
  return job;
}

// ---- The words of who holds a post ------------------------------------------------------------

// "quartermaster: odessa", or "captain: the chair".
export function readHolderLine(text) {
  const written = String(text ?? "").trim();
  const colon = written.indexOf(":");
  if (colon < 0) return { problem: `"${written}" needs a colon after the post, then who holds it` };
  const post = written.slice(0, colon).trim().toLowerCase().replace(/^the\s+/, "");
  const holder = written.slice(colon + 1).trim();
  if (!post) return { problem: `"${written}" needs the post before the colon` };
  if (!holder) return { problem: `"${written}" needs who holds it after the colon` };
  return { post, holder };
}

// ---- The words of who does a job --------------------------------------------------------------

// "cook: Cook Imre, Cook Dessa", "spare hands: Yusuf, Salome", or "guard: nobody".
export function readWorkersLine(text) {
  const written = String(text ?? "").trim();
  const colon = written.indexOf(":");
  if (colon < 0) return { problem: `"${written}" needs a colon after the job, then who does it` };
  const job = written.slice(0, colon).trim().toLowerCase().replace(/^the\s+/, "");
  const who = written.slice(colon + 1).trim();
  if (!job) return { problem: `"${written}" needs the job before the colon` };
  if (!who) return { problem: `"${written}" needs who does it after the colon, or nobody` };
  return { job, people: /^nobody$/i.test(who) ? [] : listOf(who) };
}

// ---- Writing a line ----------------------------------------------------------------------------

// A post's line from its pieces, the way readPostLine reads them, for the Story board to rewrite one.
export function writePostLine(post) {
  const parts = [`chosen by the ${post.chosenBy}`];
  if (post.watchBill) parts.push("keeps the watch bill");
  if (post.brig) parts.push("keeps the brig");
  if (post.heads?.length) parts.push(`heads ${post.heads.join(", ")}`);
  if (post.pool?.length) parts.push(`picked from ${post.pool.join(", ")}`);
  if (post.skills?.length) parts.push(`skills ${post.skills.join(", ")}`);
  if (post.duty?.length) parts.push(`duty: ${post.duty.join(", ")}`);
  return `${post.title} ${post.prep} ${post.room}: ${parts.join("; ")}`;
}

// A job's line from its pieces, the way readJobLine reads them.
export function writeJobLine(job) {
  return `${job.title} ${job.prep} ${job.room}: ${job.wanted} wanted${job.skills?.length ? `; skills ${job.skills.join(", ")}` : ""}`;
}

// ---- Writing a file ----------------------------------------------------------------------------

export function writeCommandText(value) {
  const out = [`# ${value.name ?? ""}`];
  for (const field of COMMAND_HEADER) {
    const one = get(value, field.path);
    if (one === undefined || one === null || one === "") continue;
    out.push(`${field.key}: ${one}`);
  }
  for (const part of COMMAND_PARTS) {
    const lines = value[part] ?? [];
    if (!lines.length) continue;
    out.push("", `${COMMAND_TITLES[part]}:`, ...lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  return `${out.join("\n")}\n`;
}
