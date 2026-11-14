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
