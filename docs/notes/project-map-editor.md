# The map editor

## What was asked

On 2026-11-12 the owner asked: "Could yo umake an interactive way for me to change the map and desgin it myself?"
They'd asked how to design the ship's map themselves once before (2026-11-08), and got rooms that can be drawn in
Tiled, an outside program that was never installed here and that they haven't used. This time the answer is inside the
game: **Map editor**, under **Game** in the menu. Nothing was shown to them first; it's a first version, built on my
own choices, and they haven't tried it.

## What it is

A whole-screen window, like the Story board (`public/mapedit.js`, `public/mapedit.css`), with one of the ship's three
decks drawn from straight above on a canvas: a rectangle to a square, half as wide as it's deep, as in the game's own
plan. Everything is done with the mouse; the only boxes to type in are names and words.

- **Paint** floor, wall, door, console, crate, locker, bench, plant bed, lamp or open space, with a brush, as a filled
  block, or as a room (walls all round, floor inside).
- **Rooms** are the rectangles the game knows a room by. A new one is dragged out and named; an old one is dragged, or
  pulled by its white corner, renamed, described or taken away.
- **Things** are put down, named and given what Look says and what the player does with them, or taken away.
- **People's posts, the stairs and the start flag** are dragged, never added or removed.
- **Words on a wall** and **names on the deck** are added, changed, dragged and taken away.
- **Where people stand** shows the spots people's days send them to (`world/life/meridian.json`), to drag.
- **Undo** and **Redo**, bigger and smaller, **Check**, **Save**, **Close**.

## How it works

The page only draws and gathers the change. `src/map-editor.js` does the rest, through `/api/map`,
`/api/map/<place>/<deck>` (GET: the deck taken apart) and the same with POST (a change tried, or kept).

- **Taken apart** (`deckForEditing`, `apart`): the deck is read from its file the way the game reads it
  (`roomFromMap` in `src/tiled.js`), and the letters are taken out of its plan: who stands, what sits and where the
  stairs are come beside the squares, each with its square. What's under someone is floor; under a thing or a stair
  it's whatever is beside it, as the deck's file has it.
- **Put together** (`together`): the squares and what stands on them make a plan again. Whatever the editor doesn't
  change is the file's own: the deck's name, colours and floor, a person's lines, where a stair leads, any other field a
  thing or a room has. Anything that can't be a deck is refused in plain words before anything else happens.
- **Tried** (`tryDeck`): the deck is written to a copy of all the maps and read back, and has to be the deck that was
  made (the same check `tools/to-tiled.mjs` makes). `deckProblems` says what's wrong on the deck itself, each with its
  square: floor nobody can get to, a thing or a stair nobody can reach, a room with no floor. Then the game's whole
  checker (`allStoryProblems`) is run twice in a child process, on the maps as they are and on the copy, and whatever
  is new is what the change would break elsewhere: a room the systems lock with no door, a store with nowhere to
  stand. About a second and a half in all.
- **Kept**: only if nothing's wrong, or the owner says **Save it anyway**. The file that was there goes to
  `data/map-backups/` first (and the life file, if a spot moved), then the life file, the stand-in tiles if a new piece
  was needed, and last the deck, which is what the game watches for (`roomsRedrawn` in `src/world.js`), so the room
  behind the window is the new one within a second.
- **Spots** only have to keep out of walls and out of the dark outside the hull: people sleep on bunks and sit at
  consoles, so 18 of the 77 spots aren't on floor to begin with. One that ends up in a wall is moved to the nearest
  floor, in the same room if there's any, and the save says so. Only that spot's line changes in the life file.
- **The stand-in tiles** only ever grow. A pair of marks no tile has yet gets one, with a picture, so the decks still
  open in Tiled. The picture maker moved from `tools/stand-in-art.mjs` to `src/stand-in-art.js` for that, since the
  installed app has `src/` and not `tools/`; the tools file is one line that hands it on.
- **The whole-game check runs from a script file with `ELECTRON_RUN_AS_NODE=1`**, because in the installed app the
  program running the game is the app itself, not Node. If it can't be run, the save goes by the deck's own check and
  says so. This hasn't been run inside the installed app.
- **The clock is stopped** while the editor is open (`clockHeld` in `public/walk.js`).

## What it found in the decks

- The engineering deck's floor is drawn with `:`, which is a bench everywhere else, and has `~` for its crawlways and
  two `0`s as scenery. So each deck gets its own paints (`paintsFor`): nothing is painted with a mark that's floor on
  that deck, and any mark that isn't one of the deck's own letters may be on a square.
- Trimming the open space off the end of each row made a deck one square narrower each time it was saved. Rows are
  kept at their full width.

## What it doesn't do

- Places other than the Meridian: their rooms are still in `world/maps/<place>.json`, one small room each.
- A new deck, or a deck of another size.
- Adding or removing people, stairs or spots.
- The ship's parts and stores (junction boxes, vents, cameras, the pantry, the cots): the game stands those in each
  room itself, on free squares, and moves them if something is built there. They aren't shown.
- Drawing in the isometric view. The editor is from above; the game draws its own picture from what's saved.

## What to watch for

- **The tests describe the ship as it is today.** Many of the 1,063 use the real decks: who stands where, which room
  is where, how far the stairs are. Once the owner redraws the ship, some will fail for that reason alone. That's for
  whoever works on the code next to settle (point the tests at a kept copy of today's maps with `GAME_MAPS_DIR` and
  `GAME_LIFE_DIR`, or bring them up to date), not for the owner. `npm run check-story` is what says whether the ship
  they drew is sound.
- **Their decks are in `world/maps/meridian/`,** which is in git, so a redrawn ship is uploaded the next time anything
  is pushed. Ask before publishing it to the other repository.
- Saving rewrites the deck's file the way `tools/to-tiled.mjs` writes one. Anything added in Tiled that the game
  doesn't read (another layer, a property of their own) would be lost.
- Someone dragged onto a console stands in it, and the console loses that square. Nothing stops it.

## Checked

`test/map-editor.test.js` (7 tests, on copies of the maps and the life files). On screen, on a test copy with its own
maps (port 3296), at 1400 and 814 wide: all three decks open; a console block, a walled room with a door, a new thing
with its words, a new room outline and Voss's post moved were painted, undone and redone, checked ("Nothing's wrong
with it") and saved, and the game behind had the Strongroom at once; the door walled up again was refused with
"Nobody can get to 14 squares of floor in the Strongroom" and **Save it anyway** offered. Not checked: the installed
app, a touch screen, and the owner's own hand on it.
