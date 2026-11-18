## The measures of the room seen from an angle, the same as the browser view's (public/iso.js, public/pixel-art.js),
## and the small sums both share. Everything in the world is worked out in tiles and drawn at UNIT pixels a tile:
## half the packs' own size, so their pixels are halved evenly. Zooming scales the whole world; nothing is redrawn.
class_name Iso
extends RefCounted

const UNIT := 64.0
## A square of the plan is half a tile across and a whole tile down.
const CELL_WIDTH := 0.5
const WALL_HEIGHT := 1.7
const CUT_WALL_HEIGHT := 0.24
const HULL_REACH := 3
const HULL_DROP := 0.3
const FLOOR_EDGE := 0.22
## How far the wheel zooms, as in the browser view (ZOOMS in public/iso.js).
const ZOOM_SMALLEST := 0.82
const ZOOM_LARGEST := 1.7
## The packs' walls are 1.375 tiles high and the game's 1.7; people are drawn as much smaller as the packs' furniture
## is beside the game's own (PACK_FIGURE in public/pixel-art.js).
const PACK_FIGURE := 1.375 / 1.7
const BACKGROUND := Color("030403")


## A point of the plan (in tiles, z up) on the picture, in pixels at UNIT a tile.
static func at(wx: float, wy: float, z := 0.0) -> Vector2:
	return Vector2((wx - wy) * 0.5 * UNIT, ((wx + wy) * 0.25 - z * 0.5) * UNIT)


## The middle of a square of the plan, in tiles.
static func centre(x: float, y: float) -> Vector2:
	return Vector2((x + 0.5) * CELL_WIDTH, y + 0.5)


## Which square of the plan a point of the picture falls on at floor level, and the very spot as a position (a
## position counts from a square's middle, as public/move.js has it).
static func spot_at(p: Vector2) -> Dictionary:
	var u := p.x / UNIT
	var v := p.y / UNIT
	return {
		"x": int(floor((2.0 * v + u) / CELL_WIDTH)),
		"y": int(floor(2.0 * v - u)),
		"point": Vector2((2.0 * v + u) / CELL_WIDTH - 0.5, 2.0 * v - u - 0.5),
	}


static func _imul(a: int, b: int) -> int:
	a &= 0xFFFFFFFF
	b &= 0xFFFFFFFF
	var lo := (a & 0xFFFF) * b
	var hi := (((a >> 16) * b) & 0xFFFF) << 16
	return (lo + hi) & 0xFFFFFFFF


## A number from 0 to 1 for a tile, the same every time: hash() in public/pixel-art.js, sum for sum, so the same floor
## tile, wall panel and replaced plate turn up in the same places as in the browser view.
static func tile_hash(x: int, y: int, salt := 0) -> float:
	var h := _imul(((x * 73856093) & 0xFFFFFFFF) ^ ((y * 19349663) & 0xFFFFFFFF) ^ ((salt * 83492791) & 0xFFFFFFFF), 2654435761)
	h ^= h >> 15
	return float(h & 0xFFFFFFFF) / 4294967296.0


## hashOf() in public/iso.js: the number the browser view picks a floor's texture by.
static func hash_of(x: int, y: int) -> float:
	var h := _imul(((x * 73856093) & 0xFFFFFFFF) ^ ((y * 19349663) & 0xFFFFFFFF), 2654435761)
	return float(h >> 8) / 16777216.0


## Whether a tile of plain floor is a plate put in since the ship was built: about one in sixteen.
static func replaced_plate(tx: int, ty: int) -> bool:
	return tile_hash(tx, ty, 7) < 0.0625


const WALL_RUNS := ["run:pipe", "run:cable", "run:tray"]


## What runs along a wall's face, high up, by the stretch of wall it's part of: about one stretch in three.
static func wall_run(x: int, y: int, face: String) -> String:
	var sx := floori(x / 6.0) if face == "s" else x
	var sy := y if face == "s" else floori(y / 3.0)
	var salt := 31 if face == "s" else 37
	if tile_hash(sx, sy, salt) >= 0.34:
		return ""
	return WALL_RUNS[int(floor(tile_hash(sx, sy, salt + 1) * WALL_RUNS.size()))]


## A colour between two, as the browser view mixes them.
static func mix(a: Color, b: Color, by: float) -> Color:
	return Color(a.r + (b.r - a.r) * by, a.g + (b.g - a.g) * by, a.b + (b.b - a.b) * by, 1.0)


## Lighter (more than 1) or darker (less).
static func scaled(c: Color, by: float) -> Color:
	return mix(c, Color.WHITE, by - 1.0) if by > 1.0 else mix(c, Color.BLACK, 1.0 - by)


static func see(c: Color, alpha: float) -> Color:
	return Color(c.r, c.g, c.b, alpha)


## A lamp's colour, a little stronger than it says, because most of it gets lost in the dark.
static func vivid(c: Color) -> Color:
	var grey := (c.r + c.g + c.b) / 3.0
	return Color(clampf(grey + (c.r - grey) * 1.5, 0, 1), clampf(grey + (c.g - grey) * 1.5, 0, 1), clampf(grey + (c.b - grey) * 1.5, 0, 1))


static func hex(text: Variant, fallback: String) -> Color:
	var s := str(text) if text != null else ""
	return Color(s) if s.length() == 7 and s.begins_with("#") and Color.html_is_valid(s) else Color(fallback)
