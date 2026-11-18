// The story and a talk as the Godot view (godot/) shows them: the scene being told cut into the pieces it's read in, who
// says each and whether they're in the room to say it over their head, the choices on offer with what each involves,
// and a talk's last words and what can be said next. Godot only draws: the story's text is read here by the page's own
// readers (public/story.js and public/scene.js, which nothing of the page's screen is needed for), so who's speaking,
// where a piece is cut and what a choice's tags mean are never worked out twice.
//
// It only reads.

import { creatorSetup } from "./creator.js";
import { publicState } from "./rules.js";
import { latestSceneStart, personSpeaking, sceneOf } from "../public/scene.js";
import { attributeSpeech, buildLoreIndex, buildVocab, colorForName, findLoreEntry, latestOptions, loreEntries, oddsFor, parseNarration, parseNotice } from "../public/story.js";

// As much as goes on a pane by someone's head (the page works it out from the room's size; this is its usual answer).
const LIMIT = 340;
const VOICE_LABELS = { comm: "over comms", machine: "machine voice", choir: "the song" };
const signed = (n) => (n >= 0 ? `+${n}` : String(n));

let setup = null;
const setupNow = () => (setup ??= creatorSetup());

// What a choice involves, as small labels on it (tagChip in public/story-view.js): a check with the odds on it, a
// belief it speaks for, someone who'd approve or not, a warning. Each { text, tone, tip, color }.
function chipsOf(option, state, index) {
  const { difficulty, axes, limits } = setupNow();
  const chips = [];
  for (const tag of option.tags ?? []) {
    if (tag.kind === "check") {
      const skill = state.skills.find((one) => one.id === tag.skill);
      if (!skill) continue;
      const name = skill.name.toUpperCase();
      const dc = difficulty[tag.difficulty];
      if (!dc) chips.push({ text: `${name} ${signed(skill.bonus)}`, tone: "info", tip: `A ${skill.name} check. Your bonus is ${signed(skill.bonus)}.` });
      else {
        const odds = oddsFor(skill.bonus, dc);
        chips.push({ text: `${name} ${odds}%`, tone: odds >= 65 ? "good" : odds <= 35 ? "bad" : "warn", tip: `${skill.name} check, ${tag.difficulty.replace("_", " ")} (${dc}). Your bonus is ${signed(skill.bonus)}, for about a ${odds}% chance before anything else affects it.` });
      }
    } else if (tag.kind === "belief") {
      const axis = Object.values(axes).find((one) => one.low.id === tag.pole || one.high.id === tag.pole);
      if (!axis) continue;
      const pole = axis.low.id === tag.pole ? axis.low : axis.high;
      const value = state.ideology.find((one) => one.id === axis.id)?.value ?? 0;
      const leaning = value * pole.sign;
      if (leaning <= -limits.convictionThreshold) chips.push({ text: pole.name.toUpperCase(), tone: "bad", tip: `This expresses ${pole.name}, which goes against your convictions. Choosing it will cost you stress.` });
      else chips.push({ text: pole.name.toUpperCase(), tone: "belief", tip: `This expresses ${pole.name}, and will move your beliefs toward it.${leaning >= 3 ? " It fits what you already believe, so acting on it will steady you." : ""}` });
    } else if (tag.kind === "approve" || tag.kind === "disapprove") {
      const approves = tag.kind === "approve";
      chips.push({ text: `${tag.name.split(/\s+/).at(-1).toUpperCase()} ${approves ? "+" : "-"}`, tone: approves ? "good" : "bad", tip: `${tag.name} would ${approves ? "approve" : "disapprove"}.`, color: findLoreEntry(tag.name, index)?.color ?? null });
    } else if (tag.kind === "warn") chips.push({ text: `! ${tag.text}`, tone: "warn", tip: tag.text });
    else if (tag.text) chips.push({ text: tag.text.replaceAll("_", " ").toUpperCase(), tone: "info", tip: tag.text.replaceAll("_", " ") });
  }
  return chips;
}
const withCheck = (option) => Boolean(option.tags?.some((tag) => tag.kind === "check" && tag.difficulty));
const choiceOf = (option, state, index) => ({ label: option.label, chips: chipsOf(option, state, index), ...(withCheck(option) ? { check: true } : {}) });

// One piece of the story as Godot draws it: what kind, the words (inside quotation marks or not), and for speech who
// says it, in their colour, and which of the people in the room they are, if they're here ("you" for the player).
function pieceOf(block, state, index) {
  if (block.type === "consequence") return { type: "consequence", parts: [{ kind: "beat", text: block.text }] };
  if (block.type !== "speech") return { type: "narration", parts: block.parts };
  const entry = findLoreEntry(block.speaker, index);
  const voice = block.voice ?? entry?.voiceStyle ?? null;
  const people = state.walk?.people ?? [];
  const mine = personSpeaking(block.speaker, [{ name: state.name, short: state.name }]);
  const here = voice ? null : mine ? { key: "you" } : personSpeaking(block.speaker, people);
  return { type: "speech", speaker: block.speaker, color: entry?.color ?? colorForName(block.speaker), ...(VOICE_LABELS[voice] ? { voice: VOICE_LABELS[voice] } : {}), ...(here ? { key: here.key } : {}), parts: block.parts };
}

// The game's messages as lines with their tag and tone (parseNotice).
const noticeLines = (text) => parseNotice(text).map((line) => ({ tag: line.tag, tone: line.tone, text: line.result ? `${line.reason}: ${line.result} (${line.total} vs ${line.dc}) ${line.math}` : line.text }));

// from: how much of the story there was when the player last did something in Godot, so that what's shown is only
// what's been told since (the page counts the same way when a choice is sent).
export function godotStory(game, { from = null } = {}) {
  const state = publicState(game);
  const { skills, axes, lore } = setupNow();
  const vocab = buildVocab(skills, axes);
  const index = buildLoreIndex(loreEntries(lore, state));
  const blocksOf = (text, options) => attributeSpeech(parseNarration(text, options), index);
  const { transcript } = state;
  const people = state.walk?.people ?? [];

  // The scene being told: from the last thing the player did, a piece at a time.
  const latest = latestSceneStart(transcript);
  const start = Number.isInteger(from) && from > latest && from <= transcript.length ? from : latest;
  const entries = transcript.slice(start);
  const scene = sceneOf(entries, { blocksOf, limit: LIMIT });
  // A big moment written as a page of the ship's log says so on its first piece.
  const pages = new Map();
  let count = 0;
  for (const entry of entries) {
    if (entry.role !== "narrator") continue;
    const pieces = sceneOf([entry], { blocksOf, limit: LIMIT }).beats.length;
    if (entry.page && pieces) pages.set(count, entry.page);
    count += pieces;
  }
  const beats = scene.beats.map((block, i) => ({ ...pieceOf(block, state, index), ...(pages.has(i) ? { page: pages.get(i) } : {}) }));

  // The choices on offer (currentOptions in public/app.js): none while something else has the screen; only carrying on
  // when the story waits for that; none while the scene waits on someone the player isn't with, or there's no scene.
  let choices = [];
  if (!(state.combat || state.check || state.talk || state.computer)) {
    if (state.storyWaiting) choices = [{ label: "Continue the story", detail: "the story picks it up from here", event: "continue" }];
    else if (state.scene && !state.scene.held) choices = latestOptions(transcript, vocab).map((option) => choiceOf(option, state, index));
  }
  // Whose pane the choices hang off (answerFor in public/popups.js): whoever the story waits on, if they're here; else
  // the last of the people here who spoke; else the player.
  let anchor = { key: "you", name: state.name, color: null, said: null };
  const lastSaidBy = (key) => beats.findLast((beat) => beat.type === "speech" && beat.key === key) ?? null;
  const waitedOn = state.scene?.with && !state.scene.held ? people.find((one) => one.key === state.scene.with) : null;
  const spoke = beats.findLast((beat) => beat.type === "speech" && beat.key && beat.key !== "you");
  const who = waitedOn ?? (spoke ? people.find((one) => one.key === spoke.key) : null);
  if (who) anchor = { key: who.key, name: who.name, color: who.color, said: lastSaidBy(who.key)?.parts ?? null };

  // A talk: the person, what they last said, and what can be said next (optionsFor in public/talk.js).
  let talk = null;
  if (state.talk) {
    const view = state.talk;
    const last = view.log.findLast((line) => line.role === "narrator");
    const heard = view.log.findLast((line) => line.role === "player");
    const offered = view.lastReply ? latestOptions([{ role: "narrator", text: view.lastReply }], vocab) : [];
    talk = {
      id: view.id,
      key: view.key,
      name: view.name,
      short: view.short,
      color: view.color,
      doing: view.doing,
      role: view.role,
      attitude: view.attitude,
      lines: view.log.length,
      said: last ? blocksOf(last.text, {}).filter((block) => block.type !== "consequence").map((block) => pieceOf(block, state, index)) : [],
      heard: heard?.text ?? null,
      notices: view.log.slice(view.log.lastIndexOf(heard) + 1).filter((line) => line.role === "notice").flatMap((line) => noticeLines(line.text)),
      page: view.page ?? null,
      choices: [
        ...offered.map((option) => ({ ...choiceOf(option, state, index), say: option.label })),
        ...(view.rumors > 0 ? [{ label: view.rumorLabel, chips: [], order: "rumor" }] : []),
        { label: view.goodbyeLabel, chips: [], order: "close" },
      ],
    };
  }

  // The quest the corner follows (public/quests.js): its name, where it stands, and a battle's list afterwards.
  const log = state.questLog ?? { following: null, quests: [] };
  const followed = log.quests.find((quest) => quest.id === log.following) ?? null;
  const tracker = followed ? {
    id: followed.id,
    title: followed.title,
    objective: followed.objective || followed.desc || "",
    step: followed.step ? { text: followed.step.text ?? followed.step.words ?? "", person: followed.step.person ?? null, state: followed.step.state ?? null } : null,
    ...(followed.checklist ? { checklist: followed.checklist.map((item) => ({ text: item.text, done: item.done, where: item.where ?? null })) } : {}),
    others: log.quests.filter((quest) => quest.status === "active").length - 1,
  } : null;

  return {
    // What tells one telling of the story from the next: Godot shows a scene afresh when this changes.
    id: `${state.name}|${start}|${transcript.length}|${transcript.at(-1)?.text.length ?? 0}`,
    untold: transcript.length === 0,
    said: scene.said,
    beats,
    notes: scene.notes.map((note) => ({ at: note.at, lines: noticeLines(note.text) })),
    choices,
    anchor,
    scene: state.scene ? { id: state.scene.id, with: state.scene.with, held: Boolean(state.scene.held), told: state.scene.told } : null,
    storyWaiting: Boolean(state.storyWaiting),
    // Who a click on goes on with the story and isn't a talk: whoever a quest's scene is waiting on, here.
    meet: log.quests.filter((quest) => quest.status === "active" && quest.step?.person && quest.step.state === "here").map((quest) => quest.step.person),
    talk,
    tracker,
  };
}
