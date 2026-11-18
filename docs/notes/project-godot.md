# The Godot port (2026-11-17 on)

## What was asked

The owner asked for Almagest Explorer's to be ported to Godot by "Way A": Godot replaces only what's seen and clicked. The rules in `src/` stay in JavaScript and run as a hidden Node program that Godot talks to on the same computer. Nothing in `src/` or `world/` is rewritten, and the browser version keeps working until they say otherwise. Moving the rules into Godot ("Way B") isn't planned.

Seven steps. **Build only the one they name, and wait for their test before the next.**

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

## For step 2

- The Node side becomes a program that stays running (the game itself, on a port of its own or over a pipe), and `levelLook`/`placeLevels` take `draftLook`'s place: the same shape with a game behind it, so `deck_art.gd` already draws most of it. What changes with the game (a room gone dark, a fire, power) changes the scene's id in the browser; in Godot it means building that deck's meshes again, which takes about half a second a deck in GDScript now: fine for a light going out, and worth making quicker (only the layer that changed) if it shows.
- People are `drawPerson` again (`figure.gd` has standing and walking; sitting and lying aren't ported), each a window in `overlay.gd` like the player's.
- The systems' parts on walls, stores and containers are in `levelLook`'s `things`, with `partPicture` and `PART_HANG` still to port (`drawPixelPart`).
- A locked door is a way out of its own in the game's view (`inner` exits), drawn shut and red.
