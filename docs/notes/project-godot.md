# The Godot port (2026-11-17 on)

## What was asked

The owner asked for Almagest Explorer's to be ported to Godot by "Way A": Godot replaces only what's seen and clicked. The rules in `src/` stay in JavaScript and run as a hidden Node program that Godot talks to on the same computer. Nothing in `src/` or `world/` is rewritten, and the browser version keeps working until they say otherwise. Moving the rules into Godot ("Way B") isn't planned.

Seven steps. The plan was to build only the one they name and wait for their test before the next. **On 2026-11-18, after step 1's report and before trying it, they said "Go on to porting everything"**, which was taken as the word to go on through the steps in order without waiting, each one finished, checked and committed before the next is begun. It wasn't taken as the word to retire the browser view (step 7's second half): that still waits for them to say they're happy. They have tried none of it yet, so the report after each step says again what only they can check (the real art, `start-godot.bat`, the meter).

1. One deck in Godot: a deck from `world/maps/meridian/deck*.tmj`, drawn with the art packs, with walking, zoom and changing decks. Compare smoothness with the current view.
2. Connected to the game: people's days, doors, power, fires, the clock and pause, from the Node rules over the local link.
3. Fights in the room.
4. The story and talks: speech panes, choices, the quest tracker, log pages.
5. The menus and windows, one group at a time.
6. The Map editor and the Story board (or kept as they are, opened from a button).
7. A Windows build from Godot, and retiring the browser view once they're happy.

Godot 4.3, GDScript, GL Compatibility renderer, in `godot/`.

A session on 2026-11-17 planned step 1 and built nothing (it had no GitHub permission); its handover was given to the next. Before the plan, the owner had approved a **style test** of the game's console look in Godot (a thing's window, a speech pane, the Keelworks monitor); its scripts are in `godot/scripts/` and it still runs (below).

## Their four answers for step 1 (2026-11-18)

Asked the planner's four choices again, they answered "1.b 2.a 3.a 4.a", which was taken as the word to build it:

1. **How Godot learns the deck: (b)**, Godot asks the game's own reader once at the start. This departs from the letter of their first words for the step ("read a deck from world/maps/meridian/deck*.tmj"), and they said yes to it: a second reader in GDScript could disagree with the game's, and step 2 would throw it away.
2. **The light: (a)**, a first version of the dim ship with pools at lamps and screens.
3. **Getting Godot onto their computer: (a)**, a `start-godot.bat` that fetches it the first time.
4. **Art for the checks: (a)**, grey stand-ins; only they see the real look.

## Step 1: what they see

`start-godot.bat`, beside `start-game.bat`: the first time it fetches Godot 4.3 for Windows from Godot's releases on GitHub into `godot-engine/` (git leaves it out), checks it against the SHA-256 of the file as it was on 2026-11-18 (`8f2c75b7…d410`, which matched Godot's own published SHA-512), and unpacks it with Windows' own `curl`, `certutil` and `tar`. Every time, it has Godot get the project ready (`--headless --import`) and then opens it. It needs Node, as `start-game.bat` does.

A window of 1400 by 860 opens on a loading screen ("CFS MERIDIAN", a bar, what it's doing), then on the bridge of deck 1 in the Pixel art look: floors, tall and cut-down walls, doors, furniture, console banks, stairs, the engines and the boat, lamps, the words on the walls and the rooms' names on the floor, the player's own figure as the game draws it, and the light. Along the top: the game's name, **Deck 1 / Deck 2 / Deck 3**, the name of the room they're in, and a line on how to walk. In the bottom left corner, the meter: "Slowest frame in the last second: 16.7 ms (60 frames)". Over each stair's plate, its name, which can be clicked. Faint scanlines over everything, as in the game.

- Walking with W, A, S and D, the arrow keys, or a click on the floor (the shortest way round what's in the way, smoothed); sliding along walls, eased round corners.
- Doors between rooms slide open within about a tile and a half and shut behind.
- The wheel zooms between 0.82 and 1.7 of the rest size, a tenth a notch, as in `public/iso.js`.
- A stair's plate, its name, or a deck's button changes deck, with a short fade. Through a stair they come out beside the stair it leads to; a button puts them where they last stood on that deck, or at its start.

**Not in it**, as they were told: other people, the clock, clicking on things, the game's own things in rooms (keypads, cameras, stores, containers), dark rooms, fires, wear and litter, menus, the tracker, the panel on the right, saving. It reads no save and uses no port.

## How it's made

**The game tells Godot.** `tools/godot-decks.mjs` is run once by Godot as a program of its own (`OS.execute("node", …)` on a thread, `godot/scripts/deck_data.gd`) and writes one piece of JSON, about 1.7 MB, to a file in Godot's own user folder, which Godot reads and deletes. For each deck: `compileLevel` on the game's own reading of the deck (`WORLD_MAPS` from `src/world.js`, so `src/tiled.js`), `draftLook`, and **`buildScene` from `public/iso.js` run in Node**, which is what the tests already do. So where a wall stands, how high, what's furniture, the stairs, the big machines, the lights and the worn ways are worked out by the same code the browser draws from, and nothing of it is written twice. It also sends where the player can walk (`canStand`, a row to a line), the deck's start, each way out with the deck and stair it leads to, and the rooms' rectangles.

That's a departure from the handover, which had `buildScene` rewritten in GDScript "whichever choice 1 is", because it lives under `public/`. It's a pure function that Node already runs, so it stays the game's. When the browser view is retired (step 7), `buildScene` and what it calls want moving out of `public/`, not rewriting.

**Which picture is which** is the game's answer too: `pieceWay`, `machineAt` and `thingPicture` from `public/pixel-art.js` (asked with `has` saying which files are in the folder), and `furnitureForPage` for the packs' own pieces. Each piece of furniture on a deck comes with `pic`: the file under `licensed/`, the part of it, turned round or not, how many times along it, what's stood on it, and whether it's drawn in steel or toned down as the Light look. So `PIECES`, `THING_WORDS` and the four-sides rule aren't copied into GDScript. Two tables are copied into the helper because the game doesn't export them: `STEEL_FILES` and `PIXEL_TABLE_TOP` (the browser only uses the second once it has the pictures, which Node never has, so the helper puts a small thing on one of the game's own tables at the packs' height itself).

**The helper only reads.** `GAME_DATA_DIR` is a temporary folder that's thrown away, and before the game's code is loaded every way of writing a file is shut off for anywhere else (`WRITERS`), so a mistake can't touch a save or the world's files. `test/godot-as-drawn.test.js` runs it as Godot does.

**Godot draws** (`godot/scripts/`, about 3,000 lines of new GDScript, half of them the drawing):

- `iso.gd`: the measures (`project` as `Iso.at`, 64 pixels a tile, the zooms) and the two small rules the drawing needs sums for, `hash` (as `tile_hash`), `replacedPlate` and `wallRun`. The helper sends a few of the game's own answers for those two, and Godot holds its copy up against them when it starts; a mismatch is said on screen.
- `packs.gd`: loads the pictures from `licensed/` with `Image.load_from_file` every start and lays them on one atlas in memory (4096 wide; 1,536 high with the stand-ins): the three sheets whole, the Light look's rows toned down (`adjust_bcs`, as the browser's `brightness() saturate()`), and each of the second pack's pictures as it's first asked for, measured as the browser measures it (`solidBox`, `slantOf`) and drawn in steel where the game says (`steelOf`). **Nothing is imported as a Godot resource and nothing is written to disk.**
- `pen.gd`: gathers a layer as triangles in the order it's drawn and hands it over as one mesh. `cell` is the browser's `drawCell` (three points of a cell onto three points of the room); a `clip` is the canvas's `clip`, done by cutting the shape.
- `deck_art.gd`: the port of `drawTile`, `drawBlock` and `public/pixel-art.js`'s drawing: `drawPixelFloors` (each square shows its own tile's top), `drawPixelWall`, `drawPixelLowWall`, `drawPixelStairs`, `drawPixelRail`, `drawPixelBigMachine`, `drawPixelMachine`, `drawPixelPiece`, `drawPixelFixture`, `drawPixelWallRun`, `hazardBand`, `drawPixelDoor`. A deck is two meshes, the floor and what stands on it, about 30,000 triangles and a few dozen strokes a frame.
- `deck_view.gd`: the layers in the browser's order, the shadows and worn ways (drawn small on the graphics card, blurred once, kept: `blur.gdshader`, `shade.gdshader`), and the light: `drawLightmap` as a small picture made once (the light that's everywhere times 1.6, then a pool for each of `scene.lights`), multiplied over everything, with the pools laid on again at 0.14 as a haze, the lamps' and the engines' glow after it, a soft light round the player, and the dark round the window's edges.
- `overlay.gd`: the player and the doors, each in a small window of its own on the deck, with whatever of the standing layer is nearer the camera drawn again over it, kept to that window. (The browser draws those "covering" blocks again whole, which can hide a table behind a wall that was drawn again for a door; keeping them to the window can't.)
- `mover.gd` is `public/move.js` (`SPEED` 6, `BODY` 0.13, `fits`, `stepAlong`, `walkBy`, `smoothed`) with `findPath` and `nearestFloor` from `src/walk.js` for a click. `figure.gd` is `drawPerson`, standing and walking, in `YOU_LOOK`. `words.gd` is `paintWords`.
- `main.gd`: the window, the loading and "couldn't start" screens, the camera (`aim`), the meter, the deck buttons, the stairs' names.

**The style test** is in the project too, as it was approved: `pal.gd` (which step 1 uses for its colours, labels and buttons), `floaty.gd`, `spring_scroll.gd`, `option_row.gd`, `bevel.gd`, `speech_pane.gd`, `thing_window.gd`, `keelworks.gd`, `crt_desk.gd`, the two shaders and the fonts (Cascadia Mono, OFL), with its own scene, `godot/style_test.tscn` (`scripts/style_test.gd`). So steps 4 and 5 start from it without the zip.

**Plainer first versions**, as told: the hull outside (flat plates a shade apart, the frames across it, the edge falling away; no plating texture), windows and wall screens (a pane with stars, a screen with three lines), the garden's beds (a few blades to a square, no stages). Left out: litter and grime (wear isn't in step 1), and the flight down a stair's well isn't brightened as the browser brightens it.

## Checking it without the packs

`tools/godot-stand-in-pack.mjs <a folder>` makes a copy of the two packs in plain grey shapes from what the repository says of them: the first pack's measurements in `public/pixel-art.js`, and each piece's line in `world/furniture.txt`. It refuses to write inside the game's folder. Point the game and Godot at it with `GAME_LICENSED_DIR`. What's wood in the real pack is drawn brown in it, so the recolouring to steel shows.

In a cloud session: Godot 4.3 for Linux from its GitHub releases, then

```
godot --headless --path godot --import
GAME_LICENSED_DIR=<stand-ins> xvfb-run -a godot --path godot --rendering-driver opengl3 -- --shot=out.png --report
```

`main.gd`'s first lines list what can follow the two dashes: `--deck`, `--at`, `--zoom`, `--width`, `--hold=W+D:1.2` (real key presses), `--press=x,y` (a real click), `--wheel`, `--click=x,y`, `--plain`, `--no-light`, `--bare`, `--preview`, `--loading-shot`. `--report` prints a line of JSON: where the player ended up, the deck, the room, doors open, what was drawn plain, the slowest frame.

**Holding it up against the browser view.** Playwright and Chromium are in the session (`/opt/pw-browsers`, `/opt/npm-tools/node_modules/playwright`). A test copy of the game (its own `GAME_DATA_DIR`, `PORT` 3291, `GAME_LICENSED_DIR`, `GAME_PIECES_FILE` and `GAME_FURNITURE_FILE`) and a scratch script had the page's own `drawPreview` draw a deck from `/api/maplook`, which was laid over Godot's picture of the same spot (`--bare --preview`).

**The tests in a session.** With Node 22, `npm test` as written (`node --test test/`) stops at once, taking the folder for a file; `GAME_DATA_DIR=<a temporary folder> node --import ./test/kept-ship.mjs --test "test/*.test.js"` runs the same files.

**The public copy.** `godot/` and the two tools aren't on `tools/publish.mjs`'s list, so the Godot view stays private until the owner says otherwise; `test/` does go across, so `test/godot-as-drawn.test.js` steps aside where the Godot view isn't in the folder. Comments in the code don't name these notes, as elsewhere.

## Checked (2026-11-18, with the stand-ins)

- Eleven spots across the three decks against the browser's own picture: the bridge, deck 1's stairs and boat bay, the medbay, the mess, the galley and garden, the hot bunks, engineering, stores, the pump room and the crawlways. Floors, walls, low walls, doors, stairs up and down, rails, the engines' pumps and tanks, the boat's hull, the galley's counters, furniture, wall fittings, lamps and words land on the same pixels; the light is within a few parts in 255. What differs is what's meant to: the stars, the player, the lamps' glow (which the Map editor's picture leaves out), litter, and the things above called plainer.
- Walking with real key presses, a real click, the wheel (three notches in is 85 pixels a tile, nine out stops at 52), the deck buttons, each stair both ways, doors opening beside the player.
- The loading screen, the "couldn't start" screen, and the deck at 1400 and 810 wide; at 810 the top bar takes two lines and nothing overlaps. Without the packs (`--plain`): plain shapes and a line saying so.
- A fresh copy of `godot/` starts after one `--import`.
- The whole suite with `GAME_DATA_DIR` set: 1,545 tests, all passing, `test/godot-as-drawn.test.js` among them (3 tests: no picture inside `godot/`; the reader's answer for the three real decks; every piece named a picture with the packs there).

## Not checked, and why

- **The real art.** Only the owner has it. The stand-ins are boxes of roughly the right size, so whether each real picture stands exactly where the browser stands it rests on the port being the same sums, which the comparison above bears out, and on the files' names, which come from the game's own catalogue.
- **`start-godot.bat`.** It can't be run in a Linux session. It's short and uses only what Windows 10 and 11 have.
- **Smoothness.** A cloud session draws in software (llvmpipe): 60 to 70 ms a frame there says nothing about a graphics card. The script's own work is about a thousandth of a second a frame while walking. The owner's meter is the answer.
- A screen with a pixel ratio other than 1, and a window dragged very small.

## Known

- The words on the walls are drawn before the player and the doors, so a wall drawn again over a door can hide words on it inside the door's window.
- A way out's name is hidden when its stair is off the screen, where the browser keeps it at the edge.
- Zoomed in, the pictures and the words are scaled up from 64 pixels a tile, a little soft, as in the browser.
- The atlas has room for 4096 by 4096; if the real packs' pictures on the decks ever outgrow it, the ones left over are drawn plain and the screen says so.
- Getting the project ready takes a few seconds at every start, because it's the only way a fresh or changed copy is sure to open.

## Step 2: connected to the game (2026-11-18)

### What they see

`start-godot.bat` now opens **the game being played**. If a game is running on port 3210 (`start-game.bat`'s window, or the app), Godot joins it; if none is, Godot starts `node server.js` itself with no window, and stops it when its own window closes. A window opens on the loading screen and then on the room the player was last in, on whichever deck, or at a port.

- **Along the top:** the game's name, "Godot view", the clock's label, **Pause / Normal / Fast / Faster** (the page's own three speeds; Space toggles Pause), why the clock's stopped when it is, the room's name and the deck's, and a line on how to walk (hidden under 1000 wide, where the bar is two lines).
- **Everyone on the level**, as `drawPerson` draws them: eased from square to square, sitting on the seat they stop on the way it faces (a chair seen from behind drawn again over them), asleep or laid up in the bed they're on (the pack's bunk takes two, a blanket each; a pod's sleeper seen through its lid), lying on the floor with the red cross when down. Names near the player or under the pointer, the amber **!** for someone with an ask, and the chatter lines over heads.
- **Doors** open for anyone near. A door the systems have locked is the pack's red shut door with a blinking red lamp, and its name over it in the closed colour.
- **The ship's state**, all of it from `buildScene`: dark rooms in the lightmap, lamps and consoles dimmed where off, fires (flames, smoke, the fire's own light), soot and stains, a breach (the hole, air streaks, the amber lamp), sparks, ringing alarms, the systems' parts on the walls as the packs' fittings with the game's marks over them, a working camera turning, stores as crates by stock, steam off a full kettle, litter and grime by `wear`, bad air and the alarm as a wash over the window.
- **The game's news** (`notes` from the clock) in the bottom left for 14 seconds, five lines at most.
- **What it doesn't play:** with a talk, a fight, a check or a computer open, or the game over, a line in amber across the top says so and names the game's own window (`http://localhost:<port>`), and walking is off until it's finished there. With no game open, the saves there are, as buttons, and **Look again**.

Not in it, as the README tells them: things to click (the ? marks, parts, stores, closed doors), every menu and panel, starting a new game, screens stuttering when power is short, and the plainer windows, wall screens, garden beds and hull from step 1.

### How it's made

**The game's side** is small and only reads, but for the clock and a stop:

- `src/godot-view.js` took over what `tools/godot-decks.mjs` did (the helper is now forty lines that call it on `draftLook`): `godotPlace(game)` is `placeLevels(game)` with each level's look run through `buildScene` and handed over as step 1 had it, plus what a game adds: each part with its state, the packs' fitting for it as it stands (`partPicture`) and how it's hung (`PART_HANG`, now exported from `public/pixel-art.js`), stores' `stock`, `onPiece` and `quiet`, exits' `closed` and `locked`, each area's dark, power, fire, breach and scorch, `scene.fires`, `breaches`, `marks`, `wear`, `darkAreas`, every seat and bed marked (`rest`), and for a bed `packBed`'s own answer for how people lie in it. `packBed` gained two options (`on`, `way`) so it can be asked from Node, where there are no pictures to look at; nothing else in `public/` changed. `ways.parts` and `ways.turning` name every part picture in every state and the camera's sixteen turns, so the atlas is whole from the start.
- `server.js` has the routes under `/api/godot/`, loading `src/godot-view.js` only when one is asked: `GET place` (everything, with `walk`, `clock`, `state`, `saved`; `game: false` and the saves when none is open), `GET level/<id>` (one level again), `GET walk`, `POST tick`, `POST stop`. The page's `/api/tick` and Godot's share one function, `clockTick`. **Walking is the page's own `/api/walk`**, unchanged: `move` for each square reached with the keys, `go` for a click, exactly as `public/move.js` and `public/walk.js` send them.
- **One clock.** The page's tick notes when it last ran (`pageTicked`); for a second and a half after it, Godot's tick passes no time (`ms: 0`) and says `shared: true`. So with both windows open the page runs the clock and Godot follows; with the page paused, hidden or closed, Godot runs it.
- **Knowing something changed.** The page that makes a change gets the whole game back; a second window doesn't. So `autosave()` counts (`saves`), every Godot tick carries the count, and when it's moved Godot asks for the room again (`GET walk`). The tick also says where the game has the player (`at`) and what's open (`state`: combat, talk, check, computer, over).
- **Stopping.** `POST /api/godot/stop` calls `finishSaving()` and exits, and only when the game was started with `ALMAGEST_STARTED_BY_GODOT=1`, which Godot sets for the process it starts and nothing else does. The app's and `start-game.bat`'s games refuse it.

**Godot's side:**

- `link.gd`: an `HTTPRequest` to a question (threaded, so an answer doesn't wait on frames), `start_game()` (`OS.create_process("node", [server.js])`, the port and the mark in its environment) and `stop_game()`.
- `live.gd`: `scene_id` (the page's `sceneIdOf`, reading the game's view of a level and Godot's package of one alike, floats snapped so the two can't disagree by rounding), `look_for` (`lookFor`), and `Dice` (`randomFrom`, for litter and blankets where the browser has them).
- `main.gd`: finds or starts the game; loads the place (the atlas is gathered and finished first, then **every level is drawn on a worker thread at once**, since `DeckArt` is all sums and `Packs` only reads once finished); ticks twice a second (once a second with `ms: 0` while paused, to keep hearing); `_take_walk` (the room as the game has it: the floor to walk on, people, exits, stock, and whether the level's picture has fallen behind); `_refresh` (asks for the level again, draws it on a thread, builds its view hidden, lets its light bake three frames, swaps it in, doors as far open as they were); `_sync` and `_go` (the page's `sync` and `go`); the clock bar, the banner, the news, the names (`Tags`, drawn in one stroke over everything).
- `overlay.gd` grew from the player and the doors to everything that moves: people, beds with sleepers, stores, flames, the breach's hole, turning cameras, each a `Prop` window as before. `DeckArt.nearer` finds what covers a window from a grid of the standing items (96 pixels a square) instead of looking at all three thousand, which is what lets thirty people be placed in about a thousandth of a second a frame.
- `deck_art.gd`: parts (`_part`: `drawPixelPart` and `drawPartMarks`, and a plain panel where the packs have nothing), litter, grime and marks (`drawLitter`, `drawRubbish`, `drawGrime`, `drawMark`, with the game's own dice so the same square has the same rubbish), locked and closed ways out, dimming for what's off. `deck_view.gd`: dark rooms in the lightmap, and two layers after the light (`Smoke`, `Shine`) for `drawAfterLight`.
- `--empty` opens the ship with no game behind her, as step 1 did (the helper, the deck buttons, `--deck`, `--at`, `--preview`), for checking the drawing.

**Departures and readings of mine:**

- With no game open, Godot offers the saves and loads one through `/api/load`, as the title screen's Load does (so it keeps the game before as "previous").
- A click on someone walks up to them and nothing more: the talk would open in the page, and opening one from Godot would leave the player stuck behind the banner.
- The red lamp of a locked door is lit for any exit that's `locked`. The page looks for `exit.inner`, which `exitView` doesn't pass on, so from reading the code the page's lamp never lights; not checked on screen, and not changed.
- A camera's red light and a ringing alarm's wash are drawn after the light, where the page draws them before it.

**The public copy.** `src/godot-view.js`, the routes in `server.js` and the two new tests go across with `src/`, `server.js` and `test/` at the next publish; `godot/` and `tools/godot-decks.mjs` still don't. The routes answer there and nothing asks them, and both tests pass without `godot/` or the packs.

### Checked (2026-11-18, stand-in art, a test copy on port 3292 with its own data folder)

- From the test save: the bridge with its eight people seated at their consoles and Voss in her chair; names, a hovered name, chatter; walking by held keys with the game keeping the square; a click across deck 1 to the stair's plate and out onto deck 2 beside the stair; keys onto a plate and up again; the clock at Normal and Faster, paused with Space's button, and people walking as it ran.
- Deck 2 by day and at 03:00 (a save made by a scratch script with the game's own `passTime`): cooks and gardeners at work, eighteen asleep two to a bunk, the night watch walking. **Held up against the game's own page** in the Pixel art view on the same save at the same moment (Playwright, the page paused): the same people in the same bunks and places.
- The Hot Bunks' lights switched off and its door locked through the page's `/api/systems` while Godot was open: the room went dark and the door red within a couple of seconds, with no walking interrupted.
- A save with a fire in the Galley, a breach at the Port Airlock, a cut junction box, a broken vent and someone down: flames, smoke and firelight, four rooms dark, the hole with its air and lamp, the news lines.
- A talk opened in the page: the banner at 1400 and 810 wide, walking off, and on again when it closed.
- A jump to Haven through the page's own order: the Manifest Docks drawn, with its people, its port store's crates and its ways out. **No other port, and no other room of Haven, was looked at.**
- Godot starting the game itself, walking, and closing: the game stopped and the autosave had the square walked to. With no saves and with only a test save: the two "no game open" screens at 1400 and 810.
- Without the packs (`--plain`), and `--empty`, at 1400 and 810.
- `test/godot-view.test.js` (5) and `test/godot-link.test.js` (4, over the real server), and the whole suite.

### Not checked, and why

- **Everything step 1 couldn't check still stands:** the real art, `start-godot.bat` on Windows, smoothness on a graphics card. To those add **Godot starting and stopping Node on Windows** (`OS.create_process` and the stop were only run on Linux).
- **The app.** Godot joining a game the installed app is running wasn't tried; it's the same server on the same port.
- A fight, a check or a computer open (only the talk's banner was seen; the four share one line of code), the game-over banner, a place made up by the story (`offPlan`), and a deck redrawn in the Map editor while Godot is open (the place's key changes and everything is loaded again; not tried).
- Two people answering "who's nearer the camera" within a hundredth of a tile of each other, and more than about thirty people on a level at once.

### Known

- If Godot is ended by force while it's running the game itself, the game is left running with no window until Godot is opened and closed again, or the computer restarted. The README says so.
- A level's picture catches up a second or two after the change (the save's count is seen on the next tick, then the level is fetched, drawn and lit).
- While a level is being drawn again, a second change to it waits for the first to finish.
- People are placed every frame whether they've moved or not (about 30 millionths of a second each).

## For step 3 (fights in the room)

- The page's side is `public/live-fight.js` (695 lines) through hooks in `public/iso.js` (`fighters`, `fightHidden`, `fightOverlay`, `fighting`); the rules are `src/live-fight.js` on `src/combat.js`, asked through `/api/combat` (`tick` with at most half a second, the orders, `live`). The fight's view is `combatView(game)`.
- Fighters are `drawPerson` again with health and readiness bars over them, so they're `Prop`s in `overlay.gd` like everyone else; whoever's in the fight is hidden from the level's own people (`fightHidden`).
- The orders bar along the bottom, the pause, the notes and the end ("The battle's won", "You went down") want the style test's panes (`pal.gd`).
- Godot's tick already hears `state.combat`; the banner goes once the fight is played here.
