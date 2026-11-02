# project-walk-around

*The Last Meridian's walk-around view: every part of all 24 places is its own level, with closed doors that only the story opens, and invented places get drawn rooms. Built 2026-11-01, not yet run with real Claude*

Went in on 2026-11-01 (save version 10): `src/walk.js`, `public/walk.js`, `public/talk.js`, `world/maps/<place>.json`, `world/rooms.json`, `test/walk.test.js`. Backups are `backups/before-walkaround-2026-11-01`, `backups/before-levels-2026-11-01` and `backups/before-all-places-2026-11-01`. Classic was the default until 2026-11-02, when the player chose the isometric look, which draws these same levels: Isometric is now the default, and Walk-around and Classic are still in Settings (see [project-world-engine](project-world-engine.md)). Inspired by the Steam game Anywhere RPG.

How it grew: the player tried one deck plan with bare rectangles for off-plan places, then said: "You can implement this version but the level should be all different and personalized with the room it's supposed to be." So each Meridian room became its own hand-drawn level. Asked whether to extend it, they said "Yes, build the rest", so now 121 levels cover all 24 places.

Since 2026-11-02 the story in Isometric is popups over the room, not a panel under it: see [project-story-popups](project-story-popups.md). Walk-around itself still has the panel.

Decisions that aren't obvious from the code:
- A talk never moves the clock. Tools are refused at run time rather than removed from the tool list, because changing the list makes Claude reload the whole story on every line. Walking doesn't move it either, but since 2026-11-01 the clock runs by itself while exploring anywhere in Walk-around (see [project-world-engine](project-world-engine.md)). In Classic it only moves with the story.
- A talk line never brings on the periodic full state resend, and fleet news waits until the talk is over.
- Off-map places never show the nearest map. They get a drawn room by kind (15 in `world/rooms.json`), chosen by the AI through `set_scene`, or worked out from the name and codex text. Matching room names is exact on purpose.
- Invented rooms are saved in `data/campaigns/<id>/rooms/`, like people, and a file there can have its own drawing. The player's Section Fourteen was hand-drawn from their story and lives there, not in `world/`, because another campaign's Section Fourteen would be a different place. Two places can each have a room of the same name.
- `gm.districts` in the place files are game-master notes with spoilers in them, so every new level has its own `desc` for the player to read. Only the Meridian still shows its district text.
- 15 exits are `closed`: a guard, a lock, a picket line, a sponsor, an invitation. Free walking would otherwise let the player stroll past things only the story should decide, such as Oriel's salon, the Regent's palace or crossing the Cinder picket. Asking at one is a normal AI turn, and `set_scene` opens it for good (`game.opened`). I chose which ones, and the player hasn't weighed in on that.
- The state line is `Map: captain at X`, in Classic too, so `set_scene` can now cost its extra AI round at every place, not only aboard the Meridian.

**Why:** the player wants rooms to look like what they're supposed to be, with mechanical things staying local and free.

**How to apply:** Real Claude has never run this, so how well it keeps to one to three sentences, how often and how well it calls `set_scene` with `kind` and `things`, and whether it follows the Map line away from the Meridian are unknown. The per-line costs are estimates (about 1.7 cents on Opus, 0.07 on Haiku, at a 50k story). Check `data/usage.jsonl` after the player tries it. Timers run slowly when the browser pane is in the background, so walking looks slow in testing there. The drawing tools (`maps-src/`, `build-maps.mjs`) are in a session scratchpad and won't last; the JSON in `world/maps/` is the thing to edit. Related: [project-last-meridian](project-last-meridian.md), [project-fleet-layer](project-fleet-layer.md).
