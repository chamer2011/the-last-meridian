# Furniture and life in the tile map

## What was asked

On 2026-11-12, after a Blender rebuild of the bridge with two free kits (see [project-tiled](project-tiled.md)), the
owner said: "Ok, so let's forget about the two 3d map. We'll keep the original. How would you add furniture and life to
the map in tiles?" The answer laid out three ways to draw furniture (by the game itself, in the style of its consoles;
small pictures drawn by them or an artist, laid out and lit by the game; or both, the game's pieces now, each
swappable for a picture later, my pick), "life" as showing what the game already knows (people using the furniture,
the ship's state on screen, wear and clutter, overheard chatter), and six steps, each tried before the next:

1. the furniture pieces, in the deck files, drawn by the game and put down in the map editor;
2. a first furnishing of the three decks, for them to change;
3. people using the furniture: sitting at consoles, eating at tables, asleep in bunks, laid up on cots;
4. the ship's state shown: screens that flicker, lamps out with the power, sparks from broken parts, fires and
   breaches drawn, doors that slide, stores' crates by their stock, the garden growing;
5. wear and clutter, more of it when the ship is hurt or morale is low;
6. chatter over people's heads, by what's happening.

They asked for an example of the furnished bridge first. It was drawn in a throwaway copy of the game (chairs at every
bank of consoles, the crew sitting in them, the captain's chair, a glowing plot table, the cracked repeater, windows
with stars, screens on the walls), and two pictures went to them. Then they said "Start the steps".

## Step 1, built on 2026-11-12, untried by them

- **The pieces** are in `public/furniture.js`, shared by the game and the page: chair, command chair, table, long
  table, desk, bunk, cot, locker, shelves, plot table, screen on a stand, kettle, barrel, potted plant, basin, and for
  walls a screen and a window. Each has a size in tiles (turned for e and w), whether it's in the way (`blocks`: not
  chairs, bunks or cots, which are somewhere to be), whether it hangs on a wall, and the light it gives (`lit`).
  `footprintOf`/`squaresOf` say which squares a piece takes; `looksOf` says what a thing is drawn as, from its `looks`
  line ("box" for the old box) or the words in its name (`BY_NAME`).
- **In the deck files:** a layer called Furniture, with a point object for each piece on its back left square, class
  Furniture, named for its kind, with a `facing` property. `src/tiled.js` reads it into `level.furniture` (sorted by
  row, then square, then kind), says plainly what's wrong (an unknown kind, left out; a facing that isn't n/e/s/w; a
  piece outside the room, on something that isn't floor, on top of another, or a wall piece where there's no wall; a
  thing to look like something that isn't floor furniture), and `roomToMap` writes it back, so the map editor's saves
  keep it. `DRAWN` has `furniture`. No real deck has any furniture yet: that's step 2.
- **In the game:** `compileLevel` in `src/walk.js` keeps `furniture` and makes the squares of a piece that's in the way
  unwalkable and solid (so `canStand`, paths, the player's floor, the map editor's reachability and the room fight's
  cover all go by it), except someone's post, a doorway and where the level starts. The room view sends `furniture`,
  and each thing that looks like furniture gets `looks` and `facing` (`thingLooks`: its own facing, or away from a wall
  behind it, or a seat toward the bow and anything else toward the camera).
- **Drawn** in `public/iso.js` (`furnish`, `drawPiece`, at the end of the file): each piece is a block of style
  `piece` with its own depth and shadow, built of shaded boxes laid back to front whichever way it's turned
  (`partRect` maps a part across and toward the front of a piece onto the floor), cylinders for the kettle, barrel and
  pot, and wall pieces drawn on the face of their wall square that the camera sees (`wallFace`), with no lamp put on that
  square. Lit pieces add a light. A thing drawn as furniture has no box; its `?` stays.
- **The map editor** (`public/mapedit.js`, `src/map-editor.js`): a Furniture section of buttons; a click puts the chosen
  piece down and keeps the tool, a seat beside a console or a table facing it (`facingFor`); Choose and move picks a
  piece by any square it covers, drags it, **Turn it** turns it a quarter round, **Take it away** removes it; tan on the
  deck is in the way, blue a seat or a bed, and the bright edge its front. A thing's panel has **Drawn in the room as**
  and **Turn it**. `together` checks the kinds and keeps furniture in the file's order; `deckProblems` names a piece
  on something that isn't floor, on top of another, a wall piece off a wall or on a wall nobody sees, and anything in the
  way on someone's post.
- **Tests:** `test/furniture.test.js` (6): the pieces' sizes and names, a deck's furniture read and what's wrong said, a
  table in the way and a chair not and a post never covered, the room view and the picture's blocks, light and lamps,
  the editor's problems, a kept save read back (and an emptied one losing the layer), and writing a deck out. 1,069
  tests in all. Screens checked on a test copy with its own maps on port 3297: 24 pieces put down on the bridge by
  clicking at 1400 wide, Check's warning, a save, the room drawn with all of them, and the editor and a thing's panel at
  810 wide, nothing overlapping.
- **Not done in step 1:** nobody sits or lies down (step 3); the decks have no furniture (step 2); the classic and
  walk-around views don't show furniture; a piece can't be turned in Tiled other than by its facing property.

## Step 2, built on 2026-11-12, at their "Go on with step two", untried by them

- **The three decks are furnished**, 358 pieces: 121 on deck 1, 178 on deck 2, 59 on deck 3, made by a scratch script
  (`furnish.mjs`, not in the repository) through the map editor's own save (`deckForEditing`, `tryDeck` with
  `keep`), so the files are written and checked exactly as the editor writes them (decks 1 and 3 came back byte for byte
  on an unchanged save; deck 2 only reorders one object). Backups went to a temporary folder; git has the old files.
- **What was drawn as consoles is real furniture now:** the medbay's beds (`[=]`) are cots, the Hot Bunks' racks are
  two-level bunks (where a rack stretch on one row overlaps one on the next; a thing standing in the gap made the rows
  look different), the Overflow's beds are cots, the Long Mess's and the wardroom's tables are long tables, and the
  Quiet Room's benches are benches (a new piece, `bench`, two tiles long, not in the way). 330 squares of machine marks
  became floor. Beds are somewhere to be, so their squares can be walked on now, where the marks couldn't; tables are in
  the way as the marks were.
- **Added:** chairs on the floor side of every bank of consoles on the bridge, the chart room, comms, the boat bay's
  control room and the repair bay's workbenches, one to a tile, facing them; chairs round the wardroom's and the mess's
  tables and on the mess's `seat-` spots; nine windows in the bridge's forward wall by the viewport; a cot on the
  `captain-cot` spot and one on `marrow-cot`; a bunk, a locker and a desk chair in each officer's cabin; shelves,
  lockers, desks, barrels, potted plants and wall screens through the rest (each room's list is in the script, kept in
  the session's scratch folder). Pieces in the way were kept off posts, spots, doorways and stairs; a piece that didn't
  fit was skipped (a cot on a thing, three chairs on taken squares).
- **Two engine changes:** what the game stands in a room by itself (stores, power boxes, footlockers, through
  `floorSpot` in `src/systems.js`) keeps off any square furniture is on (`level.furnished`); and a window or a wall screen
  gives way to a part of the ship's systems mounted on the same wall square. **Things' names** are read for what they
  are of (`headOf` in `public/furniture.js`): "Hot-bunk slate" is a slate, "A row of basins" basins, "Tool roll on the
  bench" a roll.
- **Tests:** `test/furnished-decks.test.js` (3) checks the real decks: furniture on every deck, nothing wrong by the
  editor's checks or the game's, the cots, bunks, tables, benches, windows and chairs in their rooms, beds walkable and
  tables not, and nothing in the way on a post or before a stair. `test/furniture.test.js` builds its decks without the
  real furniture now, and its window check allows for a part mounted on the same square. Screens of the furnished decks
  (the bridge, wardroom and chart room; the medbay, mess, Hot Bunks, Overflow, armory, brig and galley; the stores,
  repair bay, life support, lighter bay and engineering) looked at on a test copy at 1400 wide.
- **Not done:** nobody sits or lies in the furniture yet (step 3); people lie on a bed's square drawn at floor height.

Build step 3 only when they say so.
