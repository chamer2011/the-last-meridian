# The pixel-art test view (2026-11-15)

## What was asked

On 2026-11-15 the owner sent two itch.io packs by @pixel_Salvaje and asked how well they'd fit: Isometric Interiors ($15, 800+ pieces, a cosy home look) and Isometric Space Station ($10, dark sci-fi walls, floors, doors and a few machines). Both are hand-drawn ("No AI" badge on both pages) at the same 2:1 isometric angle as `public/iso.js`'s `project`, and neither has characters. My advice: the space station pack for walls, floors and doors, the game's own furniture kept, recoloured interiors pieces later. Offered a test view of the bridge with the space station pack once they'd bought it, they said "Yes, after I buy", then "Iv'e downloaded it, It's the last download in the download tab".

## The licence

"YOU CAN: Edit and use the asset in any commercial or non-commercial project. YOU CAN'T: Resell or distribute the asset to others." So the files are unpacked into `licensed/isospace/` (three 1024×1024 sheets: `IsoSpace_Level.png`, `IsoSpace_Assets.png`, `IsoSpace_Doors.png`), `licensed/` is in `.gitignore`, and it's in neither `tools/publish.mjs`'s `GAME` list nor `package.json`'s `build.files`, so it never reaches GitHub, the public copy or an installer for others. `test/pixel-art.test.js` checks all three. The owner's own installed app runs from `D:\Test IA`, so it finds the pack. The zip is still in their Downloads.

## What's built

- **Settings → Story view → Pixel art**, beside Isometric: `reading.view` stays `"iso"` (so nothing that asks whether the view is isometric changes), with `reading.isoArt` `"drawn"` or `"pixel"` and `reading.pixelLook` `"dark"` or `"light"` (a Pixel art look row under it), kept in `meridian-reading` with the rest, and a line when the pack isn't found.
- **`public/pixel-art.js`** loads the level sheet from `/licensed/isospace/` (`serveLicensed` in `server.js`: `.png` only, inside `licensed/`), reads each look's wall-top colour from the sheet, and draws: floors per tile (`drawPixelFloors`: every tile the stretch's floor cells are on, back to front, clipped to the cells, over a dark fill so joins don't show; plain plating and panels mostly, grilles on passages, mesh on a second kind of floor) and full-height walls (`drawPixelWall`: the game's own block with its top in the pack's colour, short of the front edge where a slab stands, and the pack's slab on each face that shows; a face along a row is half a tile, so a tile's two halves draw one whole slab when both show, else each its clipped half).
- **Geometry** (measured from the sheet, in pixels of a 128 cell): a floor tile's top face has corners (64, 56), (128, 88), (64, 120), (0, 88), 8 pixels thick under it; the slab facing down-right (cells 0–2 of the wall row) has its near foot at (40, 124), far foot (104, 92), near top (40, 36); the slab facing down-left (cells 5–7) has its left foot at (24, 92), right foot (88, 124), left top (24, 4). A wall is 88 pixels high, 1.375 tiles, and is stood up to the game's `WALL_HEIGHT` 1.7 by the three-point `mapping`, so nothing else in the room moves. Dark look: floors row 0 (8 tiles), walls row 1; light: floors row 4 (5), walls row 5.
- **Hooks in `public/iso.js`**: `pixelKey()` is the end of `sceneIdOf` and part of `wantedPicture`'s key, so turning it on or off, another look, or the sheets arriving draws the place again; `restUnitFor` returns `PIXEL_UNIT` (64, exactly half the pack's size) while it's on; `drawTile` hands its floor cells to `drawPixelFloors` and `drawBlock` a full wall to `drawPixelWall`.
- **Not used yet**: the assets sheet (16 machines and furniture, one facing each) and the doors sheet (four 16-frame animated doors). The game's doors along a row are half a tile wide and the pack's a whole tile, and the game's furniture faces four ways.

## Checked

Headless Edge on a test copy (port 3297, its own data folder, the test save on the bridge): the ship loads behind the loading screen in about 0.9 s and walking keeps frames at 16.7 ms; pictures at 1400 and 810 wide in both looks; Settings at both widths; switching back to Isometric draws the game's own look at its own size. 4 new tests in `test/pixel-art.test.js`.

## Known

- The bow's stepped walls read as a row of separate units, since every step shows its own slab.
- The low walls between the player and a room, the doors, the furniture, the hull skin outside and the people are the game's own drawing, so they don't match the pack.
- Zooming in scales the picture drawn at 64, so the pixels go a little soft past the rest size.
- The pack's walls are stretched about a quarter taller to the game's wall height.
