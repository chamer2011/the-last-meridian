# project-fleet-layer

*The Last Meridian's fleet command layer, built 2026-11-01, what's untested with real Claude, and what's left for later steps*

The fleet layer went in on 2026-11-01 (save version 7): `src/fleet.js`, `public/fleet.js`, `world/fleet.json`, `world/starmap.json`, `test/fleet.test.js`. Backup is `backups/before-fleet-2026-11-01`.

**Why:** first of several steps toward a real game where the player commands a fleet that can lose things.

**How to apply:** Later steps were left room for, not built: officers at posts with loyalty (add to `fleetLedger`), ship-to-ship battles (replace `answerRaid`'s responses), factions acting on their own, and the final act drawing on `fleet.record`. The player has since played two turns on it with Haiku (about 0.2 cents a turn, 1 cent for the reload). Opus hasn't run on it, and how well the AI uses the fleet in its writing is still unjudged. In-game time moves slowly in AI play (the player's save was still at Day 1, 10:00 after 15 turns), so tune around that.

The walk-around view the player asked about on 2026-11-01 now exists as a prototype: see [project-walk-around](project-walk-around.md). Related: [project-last-meridian](project-last-meridian.md).

The player's campaign named a creche ship, the Ember Day, and its codex says it isn't on the fleet's list, so it was deliberately left out of the 41.
