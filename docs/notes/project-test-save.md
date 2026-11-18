# The test save (2026-11-13)

- Asked as "Could you make a special save to test were fuel is always full and hacking can be done without the needed
  parts". Built straight away on my reading; nothing was shown first.
- **The save:** `data/saves/test.json` in the owner's data folder, a slot of its own, `"test"` (`SAVE_SLOTS` in
  `server.js`), listed as **Test save** (`SLOT_LABELS` in `public/app.js`), so none of their slots was used. It was
  written by `node tools/test-save.mjs` while their game was running on 3210; nothing else in `data/saves/` was touched
  (their autosave and previous game were there, slots 1 to 3 empty). The running game only shows the new slot and runs
  the test switches after it's closed and reopened.
- **What's in it:** a new captain (random, Vance Okoro the first time), past the opening (`game.scene` cleared, "The
  story has begun." and a `[TEST]` notice in the transcript), on the bridge at 09:30 on day 1, with no mutiny fought,
  so no aftermath list or asks. `game.test = { fuel: true, rig: true }`.
- **The switches,** `src/test-mode.js`, read through `testing(game, what)`:
  - `fuel`: `keepFuelFull` sets `ship.fuel` to `maxFuel` (12) and `fuelBurn` to 0, as clock work (whenever the clock
    moves, so after every jump) and as day work (at the end of each day of a long wait, after the ship's own day).
    Only the jump tank: the generator's fuel cells already come back by themselves through the refills.
  - `rig`: `testRig` in `rigNow` (`src/rig.js`) keeps the build's numbers but makes it start (`dead: null`), gives it
    99 blocks of memory, power 3 (the most `rigStats` allows) and no heat of its own (a session still warms it);
    `rigLinks` (`src/devices.js`) gives every kind of link, so `reachWhy` is null for any look. Speed and quiet stay the
    build's, so the watcher hears what it would.
- **Making another:** `node tools/test-save.mjs --again`; without `--again` it stops if a test save is there.
  `GAME_DATA_DIR` points it at another folder, as it does the game.
- **Tests:** `test/test-save.test.js`: the tank stays full through six days and a jump while a plain game's runs down;
  the rig reaches all five links and works with every part taken out, and a keypad connects without an optical reader;
  the tool writes only `test.json`, past the opening, and won't write over it without `--again`.
- **Screens** on a test copy at 1400 and 810 wide, from a copy of the save: Test save on the title screen, FUEL 12 in the
  top bar, the Bridge keypad's rig page offering CONNECT BY OPTICAL READER with no warning and 99 blocks.
- **On the way:** the room panel listed the Bridge door's keypad as "part (lit)", left over from putting every device in
  its place; it says "keypad" now, and lit is its usual state (`PART_WORDS`, `partChip` in `public/walk.js`).

## Every hacking program (2026-11-18)

- Asked as "On the test save, make every hacking program available". Built on my reading, nothing shown first.
- **What it does:** a test save's rig has every program in `world/programs` (24), and each is loaded: its rig has 99
  blocks and they take 34. Nothing is written at the bench, bought or copied. It's part of the `rig` switch, so the
  owner's own test save gets it without its file being touched: the save is never edited by hand.
- **How:** `everyProgram(game, { tell })` in `src/test-mode.js` puts each program on `game.rig.programs` and, unless it's
  built in, on `game.rig.loaded`, and keeps which it has given in `game.test.programs`. Each is given once, so a
  program unloaded on the Rig page stays unloaded and stays on the rig to load again, and one written into the world
  later joins the rest. It's called when a save is opened (`migrateGame` in `src/migrate.js`, with `tell`, which puts
  one `[TEST]` line in the story the first time), as clock work (a game already being played gets them when its clock
  next moves, with the same line as a note), and by `tools/test-save.mjs` for a new test save, whose own first notice
  says it. The rule that showing the game changes nothing is kept: nothing is given from a view.
- **What the programs still need:** everything else. A breaker still wants a logon it can break, a hardened computer
  still wants its way in found, MIMIC still wants a keycard, the trace tools do nothing on the captain's own computers.
- **Found on the way, and mended:** with 23 programs loaded the rig's D: page was 764 px tall and the rig's case ran
  off the bottom of a 900 px window, since a rig never had more than a dozen loaded before. `.desk .pocket-list` in
  `public/desktop.css` is at most `min(56vh, 430px)` tall now and scrolls inside the case, with the game's own wheel
  scrolling (`public/spring.js` finds it by itself), and `pocketPrograms` in `public/computer.js` puts the list back
  where it was scrolled to when the rig is drawn again (`comp.listAt`), or running the last program would send it back
  to the first.
- **Tests:** `test/test-save.test.js` has five now: every program on the rig and loaded after the clock moves, said
  once; one unloaded stays unloaded through time and through the save being opened again; a plain game's rig is as it
  was; a test save from before gets them the moment it's opened, with one line in its story, and nothing more the
  second time; a program it was never given is given without saying it all again; and the tool's save has them from
  the start. 1,543 tests.
- **Screens** on a test copy at 1400 and 810 wide, from a test save made the old way: the story's line, the Rig page
  with 24 cards under Loaded and "34 of 99 blocks", SHADOW unloaded and still unloaded minutes later, the rig beside the
  plot table with 23 rows on D:, the list scrolled to its end and MAPPER run from there with the list staying put, and
  at 810 the same on the page that slides out of the rig's strip.
