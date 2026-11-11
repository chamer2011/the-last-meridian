// What the quest tracker in the top left corner and the quest log show: each quest with what it needs next and how that
// stands, and which one the tracker follows. A quest whose written scene is waiting on someone says who and where they
// are; one the player walked away from in the middle of is on hold; one whose person has died has failed. The player
// picks which one to follow, and the main quest is followed until they do. Reading this changes nothing in the save.

import { findCharacter, fullName } from "./campaign.js";
import { LOCATIONS } from "./data.js";
import { personWhere } from "./walk.js";

const THEY = { "she/her": "She's", "he/him": "He's", "they/them": "They're" };
const theyAre = (person) => THEY[String(person?.pronouns ?? "").toLowerCase()] ?? "They're";
const at = (where) => (where?.place ? `at ${where.placeName}` : where?.room ? `at ${where.room.replace(/^The /, "the ")}` : "somewhere you could find them");

// The scene under way for each quest: the one being played, or one waiting its turn.
function scenesByQuest(game) {
  const found = {};
  for (const scene of [game.scene, ...Object.values(game.parked ?? {})].filter(Boolean)) {
    const quest = scene.quest ?? (String(scene.id).startsWith("thread_") ? scene.id.slice("thread_".length) : game.quests?.find((one) => one.main)?.id);
    if (quest && !found[quest]) found[quest] = scene;
  }
  return found;
}

// What a quest needs next, in a few words, and how that stands: here, go (somewhere else), hold (walked away in the
// middle, or someone it needs is missing), failed or done. person is who a scene is waiting on, for the page to know
// that talking to them goes on with the story, and told whether their part has been played yet.
function stepOf(game, quest, scene) {
  if (quest.status === "completed") return { state: "done", text: quest.objective ?? "Done" };
  if (quest.status === "failed") return { state: "failed", text: quest.objective ?? "Failed" };
  // Something someone asked: what's been brought so far, and who asked and by when (src/requests.js).
  if (quest.request) return { state: "go", text: quest.objective ?? "", where: [quest.askedBy ? `${quest.askedBy} asked.` : null, quest.due ? `By day ${Math.floor(quest.due / 24) + 1}.` : null].filter(Boolean).join(" ") };
  if (scene?.with) {
    const person = findCharacter(game.campaign, scene.with);
    const name = person ? fullName(person) : scene.with;
    const where = personWhere(game, scene.with);
    const base = { text: `Talk to ${name}`, person: scene.with, told: scene.told !== false };
    if (where?.gone === "dead") return { ...base, state: "failed", where: `${name} is dead.` };
    if (where?.gone) return { ...base, state: "hold", where: `${name} is ${where.gone}.` };
    if (where?.here) return { ...base, state: "here", where: `${theyAre(person)} here.` };
    if (!where) return { ...base, state: "here", where: "" };
    if (base.told) return { ...base, state: "hold", where: `You walked away. ${theyAre(person)} ${at(where)}.` };
    return { ...base, state: "go", where: `${theyAre(person)} ${at(where)}.` };
  }
  if (scene?.at && LOCATIONS[scene.at] && game.location !== scene.at) return { state: "go", text: quest.objective ?? "", where: `Go to ${LOCATIONS[scene.at].name}.` };
  return { state: "go", text: quest.objective ?? "", where: "" };
}

// The quest the tracker follows: the one the player picked, while it's still going, then the main quest, then the first
// one still going.
export function followed(game) {
  const quests = game.quests ?? [];
  const going = (id) => quests.some((quest) => quest.id === id && quest.status === "active");
  if (going(game.following)) return game.following;
  return quests.find((quest) => quest.main && quest.status === "active")?.id ?? quests.find((quest) => quest.status === "active")?.id ?? null;
}

export function questsView(game) {
  const byQuest = scenesByQuest(game);
  return {
    following: followed(game),
    quests: (game.quests ?? []).map((quest) => ({
      id: quest.id,
      title: quest.title,
      main: Boolean(quest.main),
      // Asked by someone aboard, not from a story: the log lists these under Requests.
      request: Boolean(quest.request),
      status: quest.status,
      desc: quest.desc ?? "",
      objective: quest.objective ?? "",
      done: quest.done ?? [],
      step: stepOf(game, quest, byQuest[quest.id]),
    })),
  };
}

// Whether a scene is held up: its part waits for someone the player hasn't gone over to yet, or the player has walked
// away from them in the middle of it. Someone who can't be found anywhere doesn't hold anything up.
export function heldUp(game, scene = game.scene) {
  if (!scene?.with) return false;
  if (scene.told === false) return true;
  const where = personWhere(game, scene.with);
  return Boolean(where && !where.here);
}

// The player picks the quest the tracker follows.
export function followQuest(game, id) {
  const quest = (game.quests ?? []).find((one) => one.id === id);
  if (!quest) throw new Error("There's no quest like that.");
  if (quest.status !== "active") throw new Error(`${quest.title} is over, so there's nothing in it to follow.`);
  game.following = id;
}
