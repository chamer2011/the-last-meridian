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

## Step 3, built on 2026-11-12, at their "Yes, step 3", untried by them

- **Seats and beds** are marked in `public/furniture.js` (`seat` on the chair, the bench and the command chair; `bed` on
  the bunk and the cot). `compileLevel` keeps their squares as `level.seats`.
- **Drawn** in `public/iso.js`: in `draw()`, someone standing still on a seat (`restingOn`, the scene's seat or bed under
  a point) is moved to where `sittingIn` says (a chair's middle; their own place along a bench; on a bed's edge, the
  long side the camera sees, facing out) and drawn with `drawPerson`'s `seated` pose (thighs along the seat, shins down,
  hands forward, the body lowered; `raise` for a seat higher than a chair's, lower for a bunk's mattress), turned by the
  seat's facing (`FACING_POSE`). They're ordered just after the seat, which isn't drawn again over them; a chair facing
  n or w has its back drawn again in front of them (`drawPiece`'s `only: "back"`, its back parts tagged), and someone
  sitting on a lower bunk has the upper bed and the front posts over them (`only: "over"`). Someone asleep or down on a
  bunk or a cot, not walking or carried, is drawn by the bed itself (`drawPiece`'s `sleepers`): head on the pillow,
  shoulders in their coat, the blanket raised over the rest, two to a bunk (lower, then upper, by key; a third goes on
  the floor as before), with the red cross over someone down where they fell and the hover ring round the head; the
  bed's hit box is where the head was drawn. A bunk's parts now go on in a fixed order by `rank` (posts behind, the
  lower bed and whoever's in it, the upper and whoever's in it, posts in front), which also stops a lower blanket being
  drawn over the upper bed's frame. The player sits too.
- **One square for a seat or a bed** in the life engine: `squaresOf` in `src/life.js` gives someone stopping on one only
  that square, instead of the squares their name would take along the floor (from the text views), which had pushed
  the officers at the mess tables off their chairs.
- **The decks and the life file lined up** (scratch scripts `align.mjs` and `racks.mjs`, through the map editor's own
  save for the decks and spots): Pell's post onto the helm's middle chair (24,8), Sorel's onto a comms chair (33,12),
  the night helm and comms spots onto chairs, the ready room spot onto its desk chair (Voss's paperwork), the six
  cabin spots onto their bunks, the six officers' mess seats that weren't at a table moved to the nearest free place at
  one, 13 chairs added in the Long Mess under the seats and the benches squares beside a table (not those along the
  wall, where people still stand), the curtained cot turned to face e like the rest (so patient-2 is in it), and the
  four Hot Bunks sleeping places beside the bunks moved into them. Lira's post in the sensor pit, the plot table's,
  Voss's by the plot table and the chair captains' stay standing, and so do the mess spots along the wall.
- **Tests:** `test/seats.test.js` (5): the flags and `level.seats`; every post and spot that's for sitting or sleeping
  on a seat or bed; at lunch Voss, Tarrow and Halm on their own chairs and at night the officers, the Hot Bunks and the
  night watch in theirs; `sittingIn` for each kind and facing; in the picture, Pell in her chair and the laid up in the
  medbay's cots. Screens on a test copy on port 3297 at 1400 wide (the helm, the mess at lunch, the Hot Bunks and the
  cabins at night, the medbay with Vik and Hana, the player on a cot's edge) and the mess at 810.
- **Not done:** people don't walk to a seat's front before sitting (they glide onto it and sit when they stop); nobody
  eats or works with anything in their hands; "lying awake" is drawn sitting up on the bed's edge; the mess's standing
  places along the wall and the queue's squares stay as they were. In the classic plan view, where names are written on
  the floor, names at a crowded table or along a row of bunks can now run into each other; `test/life.test.js`'s two
  name tests count a seat or a bed as one square for that reason. The cabin spots are on the bunks' back row, because
  the cabins' names are painted on the deck under the front row and nobody stops on a painted name.

## Step 4, built on 2026-11-12 and 13, at their "Yes, step 4", untried by them

- **What the room view sends** (`walkView` in `src/walk.js`): each room on a deck gets `power: false` when it has no
  power (`roomPowered`), and whatever `areaExtras` adds (a new hook in `src/room-hooks.js`, `addAreaState`), which
  `src/emergencies.js` uses for `fire` (its size) and `breach`; the view gets `power` (`powerView` in
  `src/systems.js`: `{ off }` with no supply, `{ short, dropped }` when the loads are more than it) and `growing`
  (`growingAt` in `src/logistics.js`: each growing machine's room and how many times it has given what it grows, its
  `made`); a part thing gets `sparks` when its damage is cut, broken or crippled (`SPARKING` in `src/systems.js`,
  whatever caused it); one of the ship's stores gets `stock` (`storeStock`: its share full, and of what).
- **The still picture** (`buildScene` in `public/iso.js`, drawn afresh when the scene's id changes, which now
  includes the rooms without power, the fires and holes, and the garden's stage): in a room without power, consoles
  (`machine` blocks, `off`, a dark top `consoleOff`) and furniture with a screen or light (`off`, dark glass, no lines,
  no chart glow, a cold stove, no light; windows aren't powered) are dark; a fire burns on 1 + 2 × its size of the room's
  floor squares, the same ones each time (`scene.fires`, each also a glow with light of its own); a hole in the hull is
  on one of the room's walls that faces into it, with space beyond if there is (`scene.breaches`); the garden's beds
  (`"` marks in a room with a growing machine) each get a stage (`growthStage`: five stages, one each `GROW_EVERY` = 6
  produce, each bed starting where its place puts it), drawn by `drawPlants` from turned earth to fruit; the doorways
  between rooms are listed (`scene.doorways`), not where a way out is.
- **Every frame** (`draw`): the doorways' panels (`drawDoorPanels`, open while anyone is within reach, `doorOpenFor`,
  easing in about a quarter of a second, `iso.doors`), the stores drawn as what they hold (`drawStoreCrates`, slots by
  `crateSlots`, the box they used to be left out), and the flames (`drawFlames`) and the hole (`drawBreachHole`) are
  props in the same order as the people, with whatever stands in front of them drawn again over them (`cover`). After
  the light (`drawAfterLight`): smoke over a fire, the air streaming into a hole and its amber lamp, sparks off a broken
  part (a burst every second or two), steam off the kettle while there's soup, and a red lamp blinking over a door the
  systems have locked. When power is short, console lights and screens stutter (`flickering`; `drawLights`,
  `drawShining`). The room redraws thirty times a second, not eight, while a door is moving or anything is burning,
  holed or sparking (`iso.lively`).
- **Two old faults fixed on the way:** a lamp in a room with its lights out still drew its glow (`drawShining` now
  skips an `off` fixture); and a door's frame stood at right angles to its wall wherever the wall was cut low in front of
  a room, which is most of them, because which way it ran was read from the walls' heights; it's read from where the
  walls are now (`doorAlong`), so frames and panels stand across their doorways.
- **Tests:** `test/ship-state.test.js` (6): the rooms without power, on fire, holed, the sparking part; power short and
  none; the stores' stock; the garden's `made` and stages; the picture's dark consoles, fires, hole, beds and doorways;
  `doorOpenFor` and `crateSlots`. Screens on a test copy on port 3297, from saves staged by a scratch script
  (`stage4.mjs`): the galley on fire with its power cut at 1400 and 810 wide, the holed airlock, the garden's beds, the
  shuttle stores' crates and cells, a cut speaker sparking on the bridge, a door open beside the player and shut away
  from them. The stutter of screens when power is short is drawn but wasn't looked at moving, since the browser pane
  was hidden and only drew when a picture was taken.
- **Not done:** a brawl isn't drawn; the stores' stock reaches the page with the rest of the room every couple of game
  hours or when something happens, not as each crate goes; a door doesn't open for someone the page hasn't been told
  is walking; lockers and the medicine cabinet don't show their stock.

## Step 5, built on 2026-11-13, at their "Yes, step 5", untried by them

- **How worn and cluttered** (`src/wear.js`, `wearOf`): aboard the ship only, 0 to 3 each: grime by the hull as a share
  of its most (85 or more 0, 60 or more 1, 35 or more 2, else 3), clutter by morale (75 or more 0, 50 or more 1, 30 or
  more 2, else 3). As she starts (hull 70 of 100, morale 55) that's 1 and 1, which is how the floors always looked. The
  room view sends it as `wear`.
- **Marks** (`addMark`, `marksOn`, `MARK_DAYS`): kept in `game.marks[place]` (the newest 60, nothing past its days;
  no save version, since an older save just has none): `scorch` for a room, as big as the fire got (`fire.most`, kept as
  it grows in `src/emergencies.js`), left when it goes out (`fireOut`), 12 days; and `fallen` for a square, left by
  `fallDown` in `src/medbay.js` for anyone who falls (not the player, who never lies there), 4 days. How much of a
  mark is left goes down in quarters, so a fading mark draws the level afresh only a few times. A burnt room says so in
  its own entry in the room view's areas (`scorched: { size, left }`, through `addAreaState`); the squares' marks come as
  `marks` for the level the player's on.
- **The picture** (`public/iso.js`): the floor's rubbish is on more squares as clutter rises (`CLUTTER_ABOVE`: 6%, 16%,
  26%, 38%; a place with no wear said keeps the old 16%), and at 2 and above some of it is a cup, a tray, a rag or a
  wrapper (`drawRubbish`); grime is on more squares as the hull falls (`GRIME_ABOVE`: none, 10%, 20%, 32%; `drawGrime`:
  oil and rust, and a puddle's sheen at 3); the tall walls get a dirty foot and rust streaks from the pipes
  (`drawWallDetail`); soot lies on the squares the fire burned on, the same ones its flames were on (`burntSquares`,
  `drawMark`), and a dark stain where someone fell. All of it is flat on the floor, in the still picture, so nothing
  moves and nothing needs putting in order with the people; the scene's id has the wear and the marks, so a change
  draws the level afresh.
- **Tests:** `test/wear.test.js` (4): the levels by hull and morale and nowhere else; soot as big as the fire got,
  fading and gone; a stain where someone fell, on that level, gone, and only the newest 60 kept; the picture's soot on
  the fire's squares (flames instead while it burns), the stain, and the wear. Screens on a test copy on port 3297 from
  saves staged by a scratch script (`stage5.mjs`): the Long Mess battered and unhappy (hull 30, morale 20, three
  stains) against the same at hull 96 and morale 88, the galley's soot after a fire, at 1400 wide, and the galley at
  810 wide.
- **Not done:** a fight leaves no casings or scorch of its own beyond the stains; walls cut low in front of a room
  don't show rust (only tall ones do); nothing is cleaned faster for good morale or by anyone in particular.

## Step 6, built on 2026-11-13, at their "Yes, step 6", untried by them

- **The lines** are `world/chatter.txt` (my draft, marked so at its top): parts by moment, each its name and a colon,
  then lines starting "- ", 60 letters at most (`LONGEST`), with the moments and when each is true listed in its
  header. Twenty moments (`MOMENTS` in `src/chatter.js`), the most particular first: Fire here, The alarm, Hull
  breached, Fire aboard, No power, In the dark, Someone died (three days), After the mutiny (five days after
  `game.battles.mutiny`), Grumbling (`mutinyHolds`), Hungry (the kettle ran dry for a tenth of the sittings, today or
  yesterday), Short of food, Short of medicine (`game.ship.out`), Hurt, Under way, Low morale (under 35), High morale
  (70 or more), Eating and At work (by what their day says they're doing), At night (22:00 to 06:00), Anywhere.
- **Who says what** (`src/chatter.js`): `placeMoments` works out what's true for the place once, `momentsFor` adds
  their room's (fire, power, lights), what they're doing and their wounds, and `linesFor` gives a line from each of the
  first two moments true for them that have lines, the same for half an hour of the clock; nobody asleep, laid up or
  in a talk with the player says anything. `withChatter` gives them to the people within 10 squares of the player (a
  square across counting half) in the room view (`src/walk.js`), and in the twice-a-second tick only when it crosses a
  half hour of the clock (`chatterSlot`, marked `chatter: true`), since `test/life.test.js` holds the tick under 5,000
  characters; the page keeps what each person had in between (`applyTick` in `public/walk.js`). The file is read
  again when it changes, and `npm run check-story` names a moment it doesn't know, a line before any moment, one too
  long, or one that's neither.
- **Saying it** (`public/iso.js`): `chatterNext` has someone on the screen with lines, who hasn't spoken in twenty
  seconds, say one (not the one they said last) every three to ten seconds, for 4.6 seconds, two at most at once;
  `drawChatter` draws it in quotes over their head on a dark chip with a little tail, fading in and out, and none in a
  fight, while a story's being read or while a window's open. Nothing about the game changes.
- **Tests:** `test/chatter.test.js` (6): the file reads clean and every moment has lines, and a bad one's problems; the
  moments true for someone (eating, night, the ship's troubles, their room and wounds); the most particular first, the
  same for the half hour, nothing from anyone asleep, laid up or in a talk; only those near the player have lines; the
  picture's pacing; the tick carrying lines only across a half hour. Screens on a test copy on port 3297, lunch in the Long Mess at 1400 and 810 wide.
- **Not done:** nobody answers anybody; lines don't name anyone (no stand-ins); a crowd's people say the same kinds of
  thing as the officers.

All six steps are built.
