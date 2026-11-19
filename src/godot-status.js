// The line about the player along the top of the Godot view: who they are and how they are, as the page's own status
// bar has it (statusNode in public/app.js). It's sent with every answer about the clock, so it has to be quick: these
// are the game's own numbers, read straight from it, with none of what the menus need.

import { bleedingOf, woundsNow } from "./body.js";
import { maxEnergy, maxHp, roleView } from "./rules.js";

export function godotStatus(game) {
  const role = roleView(game);
  return {
    name: game.name,
    level: game.level,
    hp: game.hp,
    maxHp: maxHp(game),
    energy: game.energy,
    maxEnergy: maxEnergy(game),
    stress: game.needs.stress,
    fatigue: game.needs.fatigue,
    // Everything wrong with them, wounds from fights included, and their blood while a wound's still open.
    hurt: game.conditions.length + woundsNow(game, "you").length,
    bleeding: bleedingOf(game, "you"),
    credits: game.credits,
    captain: Boolean(role.captain),
    role: role.short,
    fuel: game.ship?.fuel ?? null,
    // Points waiting to be spent on the registry printout.
    points: [[game.statPoints, "attribute"], [game.skillPoints, "skill"], [game.perkPoints, "perk"]].filter(([n]) => n > 0).map(([n, word]) => `${n} ${word} point${n === 1 ? "" : "s"}`).join(", "),
  };
}
