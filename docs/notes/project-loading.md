# project-loading

On 2026-11-13 the owner said, word for word: "Could you make sure that only one map load at a time. When youre on the ship, the ship would load first and stay loaded until you change map. The other map should be loaded when you are not on them. Add a loading screen for when the map is being loaded". Offered it as a session of its own, they chose "Do it here".

Read as: a map is a place (the ship with its three decks, a port with its rooms); only the place the player's at is loaded; the ship loads first and stays loaded while they're aboard, so moving between decks never loads anything; another place loads when they get there; and a loading screen covers the loading.

## What was found first

- **The server** read every place's file at start (386 KB of JSON, and the ship's three Tiled decks) and built a place's map the first time anything asked (`mapFor` in `src/walk.js`), keeping it for good. Asking where someone is (`whereNow` in `src/life.js`) went through every place that has people's days, so all 24 places ended up built. Building them all takes about 0.2 s (the ship 49 ms, the rest 2 to 24 ms each) and the whole heap was 29 MB, so this was never what the owner saw loading.
- **The page** (`public/iso.js`) drew only the level the player was on: the whole level once, in 256 px tiles, a few a frame, the ones in view first, with a small picture of the level under the gaps. Taking the stairs threw that picture away (`iso.rooms = []`) and drew the next deck from nothing, so every deck change and every arrival showed the deck being drawn, blurry first, over a second or more.
- **The scene id** included whether the room the player was in was dark, even on a deck, where each room's darkness is already in the id by itself: walking into a dark room redrew the whole deck for nothing.

## What was built

**The page, in the isometric view.**
- A place is loaded whole when the player arrives: a game opened or begun, the star map's **Go aboard** or **Cross over**. `loadingPlace` in `public/iso.js` notices a new place (`placeKeyOf`: the walk view's new `place`, `{ id, name, drawn }`, `drawn` changing when a deck is saved in the map editor or Tiled), lets go of everything of the place before (`beginPlace`), takes the level the player's on from the walk view itself and the rest from `GET /api/levels`, and draws every level's whole picture, 40 ms a frame (`LOAD_TIME`), the player's own level first (`drawLevels`, `wantedPicture`). Nothing of the room is drawn until it's all done.
- **The loading screen** (`public/loading.js`, `.loading-screen` in `public/style.css`): over the whole window, a console box with a LOADING tag, the place's name, a bar, "Drawing 3 decks" or "Drawing 5 rooms" (or "Getting the plans" while the levels are on their way) and the percentage. It sits at z-index 44, under the Story board and the map editor (45), and is taken down while either is open; the loading goes on behind them.
- **Kept while there:** each level's scene and pictures are kept in `iso.place.levels` (`levelEntry`), which replaced `iso.rooms`. `useScene` uses a level's kept scene when its id still matches, and `stillPicture` finds its whole picture, so the stairs show the next deck at once. A level whose state changed since (a light out, a fire) is drawn again over its kept picture, as the same level always was. In spare moments, with nothing moving, the other levels are kept whole at the size they'd be shown at (`SPARE_TIME`, 6 ms a frame), which matters after the window changes size for a port's rooms; a deck never fits the window, so it's drawn at the smallest size whatever the window.
- Each picture carries its own level's scene (`sceneOf`), and `tileOf` lends it to the drawing while a tile of another level is drawn, since one helper reads `iso.scene` (the rust down the walls). A level's materials are made once per scene (`scene.materials`).
- `sceneIdOf` leaves out the darkness of the player's room on a deck.
- **While loading:** the clock waits and says "Stopped while the map loads" (`mapLoading` in `public/walk.js`, in `clockWaits` and `clockHeld`), nobody walks (`cannotWalk`), a fight running in the room holds (`app.mapLoading` in `pump` in `public/live-fight.js`), and a story that hasn't begun waits (`startIfUntold` in `public/app.js`, which a new game now goes through instead of starting the story directly, and `mapLoaded`, called when the place is loaded). `isoLoading` is true as soon as the room on screen is of a place that isn't loaded, so nothing starts in the moment before the first frame.
- A game loaded or begun always loads its place again, even the same place (`resetIso`, from `resetWalk`).

**The server.**
- `levelLook` in `src/walk.js` describes a level for its picture; `walkView` uses it for the level the player's on, and `placeLevels` for every level of the place (`GET /api/levels` in `server.js`), each other level from the room at its start, so a level's scene id is the same whichever way it was described. All three decks come to about 170 KB.
- `keepOnly(place)` (run by `walkView` and `placeLevels`) lets go of every built place but the one in play and the ship, whose own rules go on while the player's away (her kettle, her medbay, her errands), with what was made from each map (`forgetSystems`, `forgetLogistics`, `forgetLife`, the same caches a redrawn deck clears, one place's worth). A place let go of is built again exactly the same: placement on free squares depends only on the map. The caches elsewhere (the medbay's, the law's, the workshop's, the command's) keep only names and room ids, which come out the same.
- `whereNow` looks only at the place the player's at and the places whose days file names the person (`placesFor`), so it builds no other place.
- A place something needs while the player's elsewhere (a request from a port, someone down at Anselm's) is built when it's needed and kept until the player next changes place: letting it go at every tick would build it again twice a second.

## Measured

In a headless Edge (which gets every frame; the browser pane runs hidden here and gets very few), loading the ship took 1.0 to 1.4 s at pixel ratio 1 (810 to 1400 wide) and 1.8 s at 1.5; Haven's five rooms 0.65 s; a new game showed the loading screen first and asked for its opening only after; taking the stairs to deck 2 showed it with no loading screen and every frame after about 7 ms (the slowest 7.1), at 1400 and 810 wide and at 1.5; the same four seconds after the window shrank; from Haven, **Go aboard** loaded the ship in 0.75 s. Keeping three decks' pictures costs about three times the memory one did: worked out from each level's picture as it's drawn, all three decks come to 39 MB at pixel ratio 1, 61 MB at 1.25 and 85 MB at 1.5 (one deck was 12 to 16 MB at ratio 1), and Haven's five rooms to 27 MB. Scripts (scratch, not kept): `cdp.mjs` (a small DevTools driver for headless Edge), `load-timing.mjs`, `deck-switch.mjs`, `place-switch.mjs`, `new-game.mjs`, `resize-switch.mjs`, `picture-size.mjs`.

`test/one-map.test.js` (5 tests): the player's level described the same both ways; every level of the ship and of Haven at once; only the place in play and the ship built, Haven let go of on the way back aboard; asking where someone is builds only their place; a place let go of built again the same.

## Not done

- Walk-around, Top-down and Classic draw nothing that takes time, so they have no loading screen.
- A story room that isn't on any map (`walk.room`) is drawn as before, when the player gets there.
- Nothing on the server stops reading every place's file at start; it's the building of a place that's done for one place at a time.
