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
- **What it doesn't play:** with a talk, a fight, a check or a computer open, or the game over, a line in amber across the top says so and names the game's own window (`http://localhost:<port>`), and walking is off until it's finished there. With no game open, the saves there are, as buttons, and **Look again** (and since 2026-11-19 a new game, and which copy of the game this is: see "Their first try").

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

## Step 3: fights in the room (2026-11-18)

### What they see

A fight that's fought in the room is played in the Godot window, the way `public/live-fight.js` plays it in the Isometric view. When the game says there's a fight, Godot asks what it is; one that's just begun is moved into the room (the page's own `/api/combat` `live`), and it's shown **stopped**.

- **In the room:** every fighter as `drawPerson` draws them, where the fight has them, gliding there; a ring under each (blue for the player's side, red for the other, brighter for whoever's aimed at, grey for one who's out of it); whoever's down lying where they fell; whoever of the room's people is in the fight drawn once, as a fighter.
- **Over them:** a name, a health bar and a thin gold bar filling as they get ready, a blue dot for cover, names stepping up out of each other's way; the dashed line to whoever the player's going for and the ring where they're walking to; shots, swings and the numbers they take off; the odds over one of the other side under the pointer, or over all of them while an order waits to be aimed.
- **Along the bottom, "YOUR ORDERS":** the game's own actions, numbered (attack, the ways of talking, abilities, the belt, giving up, running), lit while picked or queued, off with the game's own reason as their tip; **Go on (Space) / Stop (Space)**; a box to tick, **Stop when I'm ready to act**; and a line saying what a click does now.
- **Top left:** the fight's name (a battle's own) with stopped or running, and the newest four things that happened in their colours; ten once it's over, for a battle's aftermath.
- **Down the right:** the two sides with health, the other side's rows clickable; in a battle the six nearest still standing and a line for the rest.
- **When it's over:** the box along the bottom says how (Victory, Defeat, You got away, It's over, You gave up; The battle's won, You went down), the game's summary, who of the player's side is down, and **Back to the room**. If the story is waiting on the fight it says the story picks it up in the game's own window. Lost, the player is on a cot in the medbay when they go back.
- Space and the numbers are the fight's while it's on; Esc lets go of an order waiting to be aimed. The clock's buttons say "Stopped for the fight".

**Stays in the game's own window, with the amber line:** a simulated fight, one aboard another ship (`away`), and one already under way in the fight window (not in the room, past its first round).

### How it's made

- `godot/scripts/fight.gd` is `public/live-fight.js`: `wake` (finding the fight and moving it into the room), the fight's own clock (`_process`: an ask every 0.12 s while it runs, half a second at most), `_send` and `order`, `_played` (events into notes and effects, with the battle's rule for which are worth a note), `_glide`, `your_spot`, `fighters`, `hidden`, `_odds_on`, `_draw` (`liveOverlay`), `click`, `key`, the windows (`_refresh`), and `Roster`.
- `overlay.gd`'s `place_fighters` draws them as it draws people, each in its window with what's nearer the camera over it. `main.gd` hands the player's place and the pointer to the fight while one's on, keeps the player above the orders (`covered_below`), and after it looks at the room again and puts the player where the game has them (`_fight_over`, `_after_fight`).
- The game's side: `GET /api/godot/combat` (`combatView`, and whether the story's waiting), and one line in `/api/combat`: a tick marked `view: "godot"` moves no time for a second and a half after the page's own, so **a fight has one clock too**. Orders, ticks and `live` are the page's, unchanged.

**Readings of mine:** whichever window is running a fight, the other follows; a fight finished in Godot leaves the page showing it until that page is reloaded (the page learns of an ending only from its own tick), which the README says. A fight that another window ended while Godot showed it is left at once (`none`). In a battle the list shows six of the player's side too, where the page lists them all.

### Checked (2026-11-18, stand-in art, the test copy)

- A fight begun with the page's own Attack order on someone in the Long Mess: found by Godot, moved into the room, shown stopped at 1400 and 810; Space, order 1 and a click on the other fighter by real key presses and a real click; a click on the floor walking there; the odds under the pointer; the notes, the bars, a swing and the numbers; fought to **Victory** and left with 1; fought without an order to **Defeat**, and left onto a cot in the Medbay an hour later.
- **The mutiny's battle** (begun in a scratch save with the game's own `startBattle`): moved into the room across deck 1, eighteen fighters and three more arriving, fought to "The battle's won" in about eighty seconds with no orders given, the aftermath's ten notes, then the Names Bulkhead dark with the fallen under their crosses and the fire in the stair. About a thousandth of a second of script a frame.
- A simulated fight: the amber line, and nothing else.
- `test/godot-link.test.js` gained the fight (5 tests there now): found, moved into the room, an order, time passing for Godot, and none while the page runs it.

### Not checked

- Talking someone down, giving up, running, an ability or the belt from Godot (they're the page's own orders, sent as the page sends them; only attack and walking were pressed).
- A fight with allies who walk with the player, a fight the story is waiting on, and a fight at a port.
- Both windows running the same fight at once on a screen.

## Step 4: the story and talks (2026-11-18)

### What they see

- **The story over the room**, as `public/popups.js` has it: a scene a piece at a time. Speech by someone in the room is on a pane up and to the right of their head (their name on a tag in their colour, a line and a dot to the head); anything else (narration, a voice over comms, someone not here, a consequence) is in a box across the top. Words are written out at seventy letters a second; a click finishes them, the next goes on ("2 of 5   click to go on"), **Back** goes back. The player's own choice is shown first in a scene (`> Hold the bridge`). Once read, the choices hang under the pane of whoever the scene waits on (or the last who spoke, or "You"), numbered, with what each involves in colour before it (a check with the odds, a belief, who'd approve, a warning) and the same as a tip. A number key picks one. The last words fade after seven seconds when there's nothing to answer.
- **A talk**, as `public/talk.js` on a pane: a click on someone walks up to them and opens it (or, for whoever a quest's scene is waiting on, goes on with the story: `meet`). Their newest words, the player's line over them, what the talk changed as coloured lines, and **What do you say?** with what they offered, the rumours line and goodbye. The clock says "Stopped while you talk".
- **The quest in the corner:** the followed quest's name, its step or objective, a battle's checklist with its boxes, and how many more there are.
- **A fight's ending** offers **Continue the story** and **Look around first** when the story was waiting on it. **A new game's story starts by itself.** Walking puts the story away; **The story is waiting for you** brings it back.

### How it's made

- **The story is read in Node, by the page's own readers.** `src/godot-story.js` (`godotStory(game, { from })`, asked at `GET /api/godot/story`) takes `publicState` and runs `latestSceneStart`, `sceneOf`, `personSpeaking` (`public/scene.js`) and `parseNarration`, `attributeSpeech`, `latestOptions`, `parseNotice`, the lore index (`public/story.js`), neither of which touches the screen. It hands over the pieces (kind, words in and out of quotation marks, speaker, colour, which person in the room), the notes with the piece each comes up at, the choices as `currentOptions` in `public/app.js` decides them, whose pane they hang off (`answerFor`), a talk's last words and lines (`optionsFor`), who a click on goes on with the story for, and the followed quest. The chips' words are `tagChip`'s from `public/story-view.js`, written again there because that file is the page's screen.
- `godot/scripts/story.gd` draws them and keeps the reader's place. What the player does goes by the page's routes: `/api/chat` (`start`, `continue`, `meet`, a choice's words), `/api/talk` (`open`, `say`, `rumor`, `check`, `close`), `/api/check/start` for a choice with a check. Those answer with the whole game or with the story a line at a time; `Link.tell` only reads whether it was taken (and an `error` line's words), and the story is asked for afresh. `from` is how much of the story there was when the player last chose, so a scene after a fight shows only what's new, as the page's `beginScene` does.
- `main.gd`: a click on someone is `go to person:<key>` and then `story.meet`; a click while a scene is unread goes on with it; the numbers pick; the tick asks for the story again when the game's save count moves or a talk opens or closes elsewhere.

**Plainer than the page, and said so in the README:** the choices are under the pane, not beside it; a page of the ship's log is the same box across the top with "SHIP'S LOG" and its title over the words, with no drawing; the player's own line isn't on a pane over their own head; there's no quest log, no typing line, and the story's words can't be pointed at for what they mean.

### Checked (2026-11-18, stand-in art, the test copy)

- **A new game from its first words:** the story starting by itself, the opening's narration across the top, Voss's pane with the two choices at 1400 and 810, each choice taken with its number, the battle beginning from the first and fought, the captain going down and waking in the medbay, **Continue the story**, the tracker's "After the mutiny" list with boxes ticked.
- **A talk** with Voss from the test save: a real click on her, the walk, her greeting and six lines, a line said and her answer written out, goodbye, and walking again.
- `test/godot-link.test.js` has 7 tests: the story's pieces, speakers, choices, anchor and `from`; a talk opened, a line said, closed.

### Not checked

- A choice with a skill check (it opens the check in the game's own window), a request's ask with its yes and no, a scene held because its person is elsewhere, a talk's rumours, a talk shown as a page.
- The tracker with a quest that has a person to go to. Long scenes of many pieces. A voice over comms.

## Their first try (2026-11-19): "It doesn't work, see the attached file"

They sent a screenshot taken on 2026-11-18 at 19:05: the Godot window, about 977 by 624, on **NO GAME OPEN / CFS MERIDIAN**, "There's no saved game yet, and the title screen and the character sheet aren't in this window yet. Start a game in the game's own window (open http://localhost:3210 in a browser), then press Look again.", with **Look again** and **Close**.

**What that screen proves:** `start-godot.bat` ran on their Windows computer, fetched and opened Godot, and Godot started Node (or joined a game with this update's code) and got an answer from `/api/godot/place`. Three of step 2's "not checked" things are checked by it. What it also says is that the server it talked to had no autosave it could read and no readable save in any slot.

**The likeliest reason, not confirmed:** it was opened from a freshly downloaded copy of the branch, as their Desktop copy of 2026-11-16 was, and not from `D:\Test IA`, where their saves and the bought art are. A downloaded copy has no `data/` and no `licensed/`. The other possibility is saves that are there and can't be opened by this branch's code (the folder on their computer may be ahead of what's on GitHub). The old screen couldn't tell the two apart, and it was a dead end for someone who avoids typing: it told them to type an address into a browser.

**What changed (branch `claude/godot-step-4b-…`):**

- The screen is no longer a dead end. Under the saves there are (if any): **New game, with a ready-made captain** (`_new_game` in `main.gd`: `POST /api/creator/random` with `anyone: false`, whose answer's `draft` goes to `POST /api/new`; then `_connect()`, and the story starts by itself as for any untold game), **Make your own captain (opens the game's own window)** (`OS.shell_open` on the game's address, so nothing is typed), **Look again**, **Close**.
- It says which copy it is, in small print: `/api/godot/place`'s no-game answer has `where: { folder, saves, unread: [{ slot, why }], art }` (`whichCopy` in `server.js`: the game's folder, its saves folder, every save file that's there but can't be read with the reader's own first line of why, and whether `licensed/isospace` or `licensed/interiors` exists). The screen shows the folder, an amber line for each unreadable save, an amber line when the art isn't there, and "Saved games and art in another copy of the game aren't used by this one." **So their next screenshot of that screen answers the question by itself.**
- For checking: `--new` starts a new game from that screen, and `--press-first=x,y` clicks on it for real.

**Checked** (stand-in art or none, test copies on port 3293 with their own data folders, Godot starting the game itself each time): the screen with no saves and no art at 977 by 624 (their window's size), 1400 and 810 wide; with a save cut short (the amber line, and `autosave.json.broken` kept by the server as always); with two saves and art at 1400 and 810; a real click on **New game** at 977 wide, which made Captain Asha Tembe, opened the bridge in plain shapes with the amber "art packs weren't found" line, and began the opening scene with its two choices; the game stopped when the window closed each time. `test/godot-link.test.js` has 8 tests (the folder, an unreadable save named, and a new game begun the way Godot begins one).

**Not checked:** **Make your own captain** opening a browser (there's none to open in a session; it's one call to the system), and a long Windows path wrapping in the small print.

**Asked of them:** which folder they opened `start-godot.bat` from. If it was a download, the choices are theirs: play a new game in that copy as it is (grey shapes), or have the update brought into their usual game folder, where their saves and art are. **Not built, and not to be built unasked:** pointing a downloaded copy at another folder's saves. Their saves would then be written by a copy whose world files may differ from the folder they belong to.

## Their word after the first try (2026-11-19): "Ok, it works, you can import the rest on godot engine"

So the Godot view runs on their computer, a game opens in it, and they've seen it. They didn't say which folder it was opened from, and weren't asked again. "Import the rest" is taken as the word to go on through steps 5 and 6 in order, each part finished, checked and committed before the next, as "Go on to porting everything" was. **It is not the word to retire the browser view** (step 7's second half), which still waits until they say they're happy with the Godot one.

## Step 5: the menus and windows

Built a part at a time. What's in is below; what's left is under "What's left of step 5".

### Part 1: the menus (2026-11-19)

**What they see:** the menus' buttons down the right edge under the game's own headings (the rail, 124 wide; the room and everything over it keep to the left of it), and a menu sliding out over three quarters of the room when one is clicked, with its name, what the last button did, and **Close** (also Esc, the button again, or a click on the room). Leads, People, What you know, Enemies met, Ship, Work, Command, Star map, Rig, Market and Settings are all in, with every fold, card, bar and button the browser has, and the buttons do what they do there. At 860 wide and less there's no rail: **Menu** along the top opens the panel, which is then the whole window wide, with the menus' names across its top. Along the top of the window is now the player's own line (name, level, HP and EN bars, stress, fatigue, HURT, BLEEDING, credits, fuel), above the clock.

**How it's made, and why this way.** The eleven menus are about 3,000 lines of the page's code that only ever make elements, give them classes and words, and hang a listener on the buttons (`public/menus.js`, `ship.js`, `work.js`, `command.js`, `map.js`, `rig.js`, `freight.js`, `freighters.js`, `port-stores.js`). Other sessions change those files every week. Written again in GDScript they'd have been out of date at once, and would have had to be kept in step by hand for ever. So they aren't written again: **the page's own code builds each menu, in Node, and Godot draws what it built.**

- `src/mini-dom.js` is a stand-in for a browser's page, just enough for that code: elements with classes, attributes, a style, children, listeners, and the few lookups the menus make (`querySelector(".fold-toggle")`, `classList`, `replaceChildren`). Nothing is laid out. `describe` turns a tree of them into what Godot is sent: `{ t, c, k }` for tag, classes and children, with `id` for anything with a listener, `d` disabled, `tip`, `st` (its style as written), `v`, `ph`, `pressed`. `fire` runs an element's listeners and waits for what they started.
- `src/godot-pages-worker.js` runs on **a thread of its own** (`node:worker_threads`), because the page's code wants `document`, `window`, `localStorage` and a `fetch` that takes "/api/..." as global things, and the game's own thread must never see those (code that asks `typeof document` would change its mind). It sets them up, imports the page's files, and gives them the hooks `public/app.js` gives them (`ui`, `act`, `runAction`, `renderMenus`, `openMenu`, `closeMenu`, `followLead`...). Its `fetch` goes to the game over the loopback like the page's, so **an order from a menu in Godot goes through exactly the route it goes through from the browser.** What the page would do to itself becomes an "effect" for Godot: `close`, `chat` (a lead taken up: Godot's story sends it), `reload` (a save loaded), `window` (the inventory, the board, the editor, the printout), `fullscreen`, `browser`.
- `src/godot-pages.js` starts that thread the first time a menu is asked for and passes things along; `POST /api/godot/page` in `server.js` takes `{ op: "open", menu }`, `{ op: "click", id, of }`, `{ op: "input", id, of, value }`, `{ op: "look" }` (the open menu again, or `{ same: true }`) and `{ op: "rail" }`. Every tree has a number (`of`); a click that names an older tree is never taken for a button of the new one.
- `GET /api/godot/game` is the game as the page gets it, without the list of saves unless asked (`?saves`) and without the creator's setup unless asked (`?setup`): `/api/state` takes 200 ms because it reads every save from the disk, and `publicState` alone takes about 60 (48 of them `shipView`). The thread asks for the saves only for Settings.
- **Settings is the one menu not taken from the page:** how the browser's page reads, its size and its computers' screens mean nothing in Godot, so the thread has a Settings of its own (`settingsMenu` there): saved games, how hard enemies fight, the files, full screen and a button for the game's own window.
- In Godot, `page.gd` draws a tree. It's a small layout engine for the menus' own classes, read off `public/style.css` by hand (`_style`): columns with a gap (stack, menu-section, fold-inner...), rows that wrap and rows that push their ends apart (row, spread, menu-row), grids with the browser's own column rules (`GRIDS`, `_tracks`: fixed, least-to-most, shares of what's left, as-wide-as-what's-in-it), as many equal columns as fit (menu-columns, post-grid), cards filled column by column (menu-cards), the star chart (each star where its own style puts it, in characters and rows), the rig's board, the work board's little squares, folds, and runs of words wrapped by word with a button's or a tag's words kept together when they fit. Everything is drawn with `draw_string` and `draw_rect` in one Control; a click is found by walking the boxes. A box to type in (the codex's search) is a real LineEdit laid over its box. **A menu with a new kind of layout needs a line in `_style`; a menu whose words, numbers or buttons change needs nothing.**
- `menus.gd` is the rail, the panel, the slide, and the asking. One thing is asked at a time; the open menu is looked at again a moment after the game has saved anything, and every 15 seconds for what only the clock changes.
- `src/godot-status.js` is the player's line, read straight from the game (no `publicState`), sent with `place`, `walk` and every `tick`.

**Checked** (stand-in art, the test copy on port 3292): every menu at 1400 wide held up against the browser's own page on the same save (the browser's pictures are `/tmp/scratch/web-*.png`, Godot's `g-*.png`); Ship and Work at 810; a real click on **Wait 3 days** (the day changed, the news came up in the room's corner, the menu said what happened), on a fold, and on **Set course** for Haven from the star map (the ship jumped and Godot loaded the Manifest Docks); the player's line at 1400 and 810. `test/godot-pages.test.js` (5): the stand-in page, no menus with no game, a click doing what the button does, a fold opening in place, a stale click doing nothing, every menu building, the star map's course, Settings' save and load.

**Not checked:** a menu's buttons one by one (they're the page's own listeners, run as the page runs them, and three were clicked); the codex's search typed into from Godot; hovering (the button under the pointer turns inside out) seen in a picture; the watch bill's click-then-Move-here; a dealer's page at a port; the menus of a life that isn't the captain's.

**Known:** the fold slides open at once (the browser slides it); a person's name isn't struck through when they're lost (it's red); the star chart's "@" doesn't blink; Leads' **Look into this** is sent to the story but no lead is written, so it's untried.

### Part 2: what can be clicked in the room (2026-11-19)

**What they see:** marks over things (a gold ? that bobs, a dot for a part of the systems or a container, which says what it is from close by and its whole name under the pointer); a click on one walks up to it and opens its window beside it, on a line with a dot, in its kind's colours, with what it says and its numbered Actions; the other mouse button's menu on someone, a mark, or the floor, with Attack asking again; Look at someone; the room's panel down the right (its tag folds it, kept in `user://room.cfg`), with About this room, the Deck plan (rooms by deck as a list, click to walk), People, Systems, the room's note, Ways out and You can. Numbers pick a choice, Esc puts a window away, walking puts them away.

**How it's made:** `godot/scripts/room.gd` is `public/walk.js`'s `hereNode`, `thingChoices`, `personChoices`, `menuFor`, `lookAtPerson`, `useThing`, `workOn`, `doWith`, `deed` and `planWindow` written again, from the room as the game already describes it (`walkView`: each thing's `look`, `actions`, `does`, `holds`, `part`; each person's `acts`, `wants`, `down`; the room's `acts`, `ways`, `overview`). It was written again rather than run in Node like the menus because walk.js is tied up with the page's own picture of the room. **No rule is in it:** which choices there are is the game's lists, and each choice is an order by the page's own route (`/api/walk` with `use`, `ask`, `work`, a deed's name or a hook's id; `main._took` takes the answer's room and what it opened). The windows are trees of elements made in GDScript and drawn by `page.gd` (classes `con-*`, `option*`, `here-*`), in a `RoomWindows.Console`, which takes a kind's colours (`Page.use`). `main._go` takes what to do on arriving; by itself, arriving at a thing opens its window and at a shut door the door's.

**Checked** (stand-in art, the test save on the bridge): the marks and the panel at 1400 and 810 beside the browser's own; a click on the plot table's ? (walked, the gold window, Use and Close); the lights' tag in the panel, then key 1 (the bridge went dark, the window turned amber with what was said and **Switch the lights on**, the panel said "lights (off)" and "The lights are out in here."); the other button on Pell (the menu in her colour) and Look; the floor's menu at 810; the Deck plan at 810; a click on Voss still opens a talk.

**Not checked:** a container's **Open** (it says the inventory isn't in this window yet), **Ask to go through** at a closed door, a locked door's actions, carrying someone, Give and Sell, Come with me, a job's own acts under You can, a port's rooms, the plan of a place that isn't decks.

**Left out for now:** the plan drawn in characters (the list is there); the Actions window sliding out from behind the thing's; windows pulled aside with the mouse; the right-click menu on a way out's name over the room (it's on the panel's rows).

### Part 3: skill checks (2026-11-19)

**What they see:** a check opens over the room as the page's window does: the title bar (the window's name, the skill and training, how hard), what's being tried, the consoles side by side (the terminal with the last twelve lines said, the others with their lines, a grid kept in columns), the advisor's hints when there are any, the commands as numbered buttons, the roll's button with the odds, and along the bottom the meters and ODDS (its tooltip is the sum). Then how it came out: the verdict, its line, the sum, what it did, and **Continue the story** or **Close**. A number or a command's own key gives it; Enter rolls.

**How it's made:** `godot/scripts/check.gd` builds `public/check.js`'s `windowNode` and `resultNode` as a tree for `page.gd` (classes `check-*`); `GET /api/godot/check` hands it `publicState(game).check`; commands go by the page's own `POST /api/check`. The window's colours are the view's `theme` (`Pal.KINDS` gained violet, blue and the check's own cyan). `main` wakes it when the game says there's a check, as it wakes a fight.

**Checked:** a pickpocket's Stealth check ("Patrol Pattern") at 1400 held up against the JSON: moved with the number keys, the map and the meters changed, Enter rolled, SPOTTED with its lines, the alarm's red wash and the news in the corner. `test/godot-link.test.js` (10): the check handed over and rolled, the player's line, `/api/godot/game`.

**Not checked:** the other skills' windows (they're the same kinds of panel and command), a hack's logon (it opens a computer, which isn't in Godot), a check a story's choice starts, 810 wide.

**Left out:** the box for typing a command (every command is a button), the rolling dice, the rain of characters behind the consoles, practice (it's started from the registry printout).

### Part 4: the inventory (2026-11-19)

**What they see:** I, or Inventory on the rail, opens the game's inventory window over the room in the console's green: **On you** (the figure, Sidearm, Weapon, Armor, the belt's four places), **Pockets**, **Pack**, **Load**, and beside the pack whatever's open (a locker, a shelf, one of the ship's stores, a pile) with **Take everything**; along the bottom, what was last done, or how it's worked. Drag moves a thing (the square it would take lights up, red where it can't go, and the game's own refusal is said if it's tried), a double click does the usual thing, the other button opens the thing's own menu, and resting the pointer on a thing says what it is. A container's **Open**, in its window or its menu, opens it here.

**How it's made:** `godot/scripts/bag.gd`, drawn by hand (it's a grid to drag things about on, not a page of words), is `public/bag.js` measure for measure: 26 to a square, the same panels and slots, `targetAt`'s rules for what lights up, `clicked`'s for a double click, `choicesFor`'s for the menu. `GET /api/godot/bag` hands it `publicState`'s `bag`, `name`, `credits` and `body`; every order is the page's own `POST /api/bag` (`move`, `take`, `stow`, `equip`, `use`, `read`, `split`, `drop`, `open`, `close`), whose answer is the bag as it now is. Closing it shuts whatever was open. Tooltips everywhere are now the game's own small box (`Pal.tip`).

**Checked** (the test save): the window by itself and with the bridge's storage shelf open, beside the browser's own; a double click on a ration in the shelf ("Took the Hegemony Field Ration.", the load rose); a drag of it from the pack to a pocket; a drag of an air bottle to the pockets, which the game refuses ("The Air bottle doesn't go there."); the other button on the worn vest (Take off, Put in a storage shelf, Look); the tooltip. `test/godot-link.test.js` (11) has the bag handed over and a move.

**Not checked:** Use, Read, Split, the belt and the sidearm's slot, things in hand with no room, Take everything, 810 wide (the window is 463 wide, 680 with something open), being seen taking what isn't yours (the game's own line comes back as what was last done).

**Left out:** the figure coloured by wounds, the window pulled aside, the line from the window to the player.

### Part 5: the registry printout, the ending, the title screen and the creator (2026-11-19, at their "Do the rest")

**What they see:** C or their name prints the registry printout down the right side on amber paper (RECORD, SKILLS, PERKS, BELIEFS, PAST; + on an attribute, PRACTICE, LEARN, sleep and work; TEAR OFF, C or Esc); Registry on someone prints theirs. A game that's over ends on the ship's log's red page over everything, with the mornings the game kept, New game and The title screen; a number picks. The title screen (from there, or **Title screen** in Settings) lists the saves, Continue, and two new games: the ready-made captain, or **a captain you make yourself**, which is the game's whole character creator inside the Godot window.

**How it's made:** all four are the page's own code, on the menus' thread. `src/godot-pages-worker.js` now keeps a tree for each thing it draws (`surfaces`: `menu`, `sheet`, `ending`, `creator`; `on` in what's asked; each with its own `of`), attached to the stand-in page's body so the page's own lookups find them, and tells the page's code the player wants less motion, so nothing waits on an animation. `public/sheet.js`, `ending.js` and `creator.js` get the hooks `app.js` gives them; a new game's `begin` posts `/api/new` and says `close` and `reload`; `toTitle` is the effect `title`, `newGame` the effect `creator`; practice posts `/api/check/start`. `godot/scripts/host.gd` (`HostWindow`) is one window for any of them: a `RoomWindows.Console` whose clicks are passed on by number, down the right, in the middle, or over the whole window. `page.gd` gained the printout's classes (fixed columns, kept spaces), the log page's and the creator's. `GET /api/godot/saves` is the title screen's list with a game open; `main.show_title` shows it on the screen "no game open" used.

**Checked:** the printout's record page at 1400 beside the JSON; the ending from a save made with the game's own `playerDies` (the page, its three ways on, key 3 to the title screen with every save listed); the creator's first page and, after a click on Fleet Officer, its review page with the character sheet beside it. `test/godot-pages.test.js` (7): the printout's pages and tearing it off, the menu untouched by it, and a captain made and begun with no game open.

**Not checked:** the other pages of the printout on screen, spending points, practice from there, someone else's printout, Go back to this morning, the creator's steps one by one and typing a name (the box is Godot's own, as in the codex), 810 wide for any of them.

**Left out:** the printout's paper feeding out and its body figure (the words are there); the creator's typed commands.

## What's left of step 5

- **The quest log** (public/quests.js): the corner shows the followed quest and a battle's list; the whole log, and following another quest, aren't in.
- **Computers and the rig** (`public/computer.js`, `navplot.js`, `rig-motion.js`): the biggest piece left, and next. **The plan, decided 2026-11-19 after reading its skeleton:** host it like the printout (a fifth surface, `on: "computer"`, built by `computerNode()` with `initComputer({ ui, render, openMenu })`; the thread already tells the page the player wants less motion, which makes the rig simply there or not, `rigStill()`). What `page.gd` then needs: a container whose children sit where their own style puts them (`left`/`top`/`width` in px: the desktop's windows, the network map's nodes), and the classes of `public/desktop.css` (.os, .desk, the windows, the taskbar and tray, the logon, the pocket's tabs NET, D: and LOG, a door's plate, a junction box's service menu, a camera's feed). Pictures set through innerHTML (the camera's, the icons') and the Navplot chart (SVG) won't come through: say so, and leave the chart to the Star map menu. Godot wakes it as it wakes a check, when `state.computer` is true (the amber line goes then). The style test's `keelworks.gd` and `crt_desk.gd` are the look they approved, for the frame round it.
- **The simulator's fights**, which are played in the fight window, not the room.
- Then step 6, the Map editor and the Story board.
