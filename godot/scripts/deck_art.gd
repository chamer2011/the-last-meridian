## One deck, drawn: everything that doesn't move, worked out once from what the game says is on it
## (tools/godot-decks.mjs) and gathered into two layers, the floor and what stands on it, each one mesh.
##
## This is the browser view's still picture (drawTile and drawBlock in public/iso.js) with the packs' pictures
## (public/pixel-art.js: drawPixelFloors, drawPixelWall, drawPixelLowWall, drawPixelStairs, drawPixelDoor,
## drawPixelPiece and the rest), measure for measure. Where the browser view draws something itself and not from the
## packs (the hull outside, windows, wall screens, the garden's beds), this has a plainer first version of it.
class_name DeckArt
extends RefCounted

# Where things are in the first pack's level sheet, in cells of 128 (LOOKS, FLOOR_PICKS and the corners in
# public/pixel-art.js).
const LOOKS := {
	"dark": {"floors": [0, 1, 2, 3, 4, 5, 6, 7], "floor_row": 0, "wall_row": 1},
	"light": {"floors": [0, 1, 2, 3, 4], "floor_row": 4, "wall_row": 5},
}
const FLOOR_PICKS := {
	"dark": {"plain": [0, 0, 0, 2, 2, 2, 3, 3, 0, 2, 4, 5], "passage": [6, 7], "second": [1]},
	"light": {"plain": [0, 0, 1, 1, 4, 0, 1], "passage": [2, 3], "second": [3]},
}
const CELL := Rect2(0, 0, 128, 128)
# A floor tile's top face: its top, right and left corners.
const FLOOR_CORNERS := [Vector2(64, 56), Vector2(128, 88), Vector2(0, 88)]
# A wall slab facing down and to the right: the near end's foot, the far end's foot, the near end's top.
const WALL_DOWN_RIGHT := {"cells": [0, 1, 2], "corners": [Vector2(40, 124), Vector2(104, 92), Vector2(40, 36)]}
# A wall slab facing down and to the left: the left end's foot, the right end's foot, the left end's top.
const WALL_DOWN_LEFT := {"cells": [5, 6, 7], "corners": [Vector2(24, 92), Vector2(88, 124), Vector2(24, 4)]}
# The low wall's two arms from their far corner, across two cells.
const LOW_DOWN_LEFT := {"corners": [Vector2(128, 86), Vector2(64, 118), Vector2(128, 22)], "from": 40.0, "wide": 100.0}
const LOW_DOWN_RIGHT := {"corners": [Vector2(128, 86), Vector2(192, 118), Vector2(128, 22)], "from": 116.0, "wide": 100.0}
const SILL := 0.05
# The doors sheet: which rows hold a door facing each way, and the pictures of it sliding open.
const DOOR_ROWS := {"down_left": 0, "down_right": 2}
const OPENING := [3, 4, 5, 6, 7, 8]
const HAZARD := [Color("b89a2c"), Color("1a1c18")]
const HAZARD_STEP := 0.125
const STAIR_STEEL := [Color("262e2d"), Color("161b1b"), Color("0e1212")]
const FLOOR_COLORS := {"deck": "6a6e70", "grate": "5a5c5a", "concrete": "74726a", "tile": "8a8e8c"}
const PLANT_COLORS := [Color("6a8a44"), Color("54763a"), Color("7a9650"), Color("465f30")]
const CW := Iso.CELL_WIDTH
const WH := Iso.WALL_HEIGHT

var deck: Dictionary
var scene: Dictionary
var packs: Packs
var ways: Dictionary
var flight := {"top": Vector2(33, 39), "run": 0.625, "rise": 0.72, "wide": 0.65}

var cols := 0
var lines := 0
var kinds: Array = []
var heights: Array = []
var light: Array = []
var machines: Array = []
var fitted := {}
var big := {}

## The two layers, what's written on the deck and its walls, the shadows and the worn ways, and the doors that slide.
var ground: Pen
var standing: Pen
var floor_words: Array[Dictionary] = []
var wall_words: Array[Dictionary] = []
var shadows: Array[PackedVector2Array] = []
var doors: Array[Dictionary] = []
var bounds := Rect2()
var floor_color := Color("3a4040")
## What couldn't be drawn from the packs and was drawn plain, by what it was.
var plain := {}
var _floor_order := {}


func _init(deck_data: Dictionary, the_packs: Packs, the_ways: Dictionary, numbers: Dictionary) -> void:
	deck = deck_data
	scene = deck.scene
	packs = the_packs
	ways = the_ways
	cols = int(deck.cols)
	lines = int(deck.lines)
	kinds = scene.kinds
	heights = scene.heights
	light = scene.light
	machines = scene.machines
	for key in scene.fitted:
		fitted[key] = true
	big = scene.big
	if numbers.has("flight"):
		var f: Dictionary = numbers.flight
		flight = {"top": Vector2(f.top[0], f.top[1]), "run": float(f.run), "rise": float(f.rise), "wide": float(f.wide)}
	var b: Dictionary = scene.bounds
	var pad := Iso.UNIT
	bounds = Rect2(b.minU * Iso.UNIT - pad, b.minV * Iso.UNIT - pad, (b.maxU - b.minU) * Iso.UNIT + pad * 2, (b.maxV - b.minV) * Iso.UNIT + pad * 2)
	var style: Dictionary = scene.style if scene.style != null else {}
	var floor_kind: String = scene.look.get("floor", "deck")
	floor_color = Iso.mix(Color(FLOOR_COLORS.get(floor_kind, FLOOR_COLORS.deck)), Iso.hex(scene.colors.get("floor"), "#3a4040"), 0.22)
	if style.has("floors"):
		floor_color = Iso.mix(floor_color, Color(str(style.floors[0])), float(style.floors[1]))
	ground = Pen.new(packs.white)
	standing = Pen.new(packs.white)
	_lay_ground()
	_stand_everything()
	_find_doors()


# ---- What's where ---------------------------------------------------------------------------------------------------

func kind(x: int, y: int) -> String:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return ""
	return kinds[y][x]


func height(x: int, y: int) -> float:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return 0.0
	return heights[y][x]


func lit(x: int, y: int) -> bool:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return false
	return light[y][x] == "1"


func machine(x: int, y: int) -> bool:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return false
	return machines[y][x] == "1"


static func walkable(k: String) -> bool:
	return k == "f" or k == "d"


static func see_through(k: String) -> bool:
	return k == "f" or k == "d" or k == "m" or k == "t" or k == "e"


func _quad(x0: float, y0: float, x1: float, y1: float, z := 0.0) -> PackedVector2Array:
	return PackedVector2Array([Iso.at(x0, y0, z), Iso.at(x1, y0, z), Iso.at(x1, y1, z), Iso.at(x0, y1, z)])


func _note_plain(what: String) -> void:
	plain[what] = int(plain.get(what, 0)) + 1


# ---- The floor ------------------------------------------------------------------------------------------------------

func _lay_ground() -> void:
	var pen := ground
	var style: Dictionary = scene.style if scene.style != null else {}
	var drop := -Iso.HULL_DROP
	var cells: Array = scene.ground
	# The hull's skin, a step below the deck, with a frame across it every few squares, falling away at its outer edge.
	if not style.is_empty():
		var skin := Iso.scaled(Color(str(style.hull)), 0.7)
		var rib := Iso.see(Color(str(style.rib)), 0.85)
		for c in cells:
			if c.k != "h":
				continue
			var x := int(c.x)
			var y := int(c.y)
			# Plates, a shade apart.
			var shade := 0.94 + 0.12 * Iso.tile_hash(x >> 1, y, 11)
			pen.poly(_quad(x * CW, y, (x + 1) * CW, y + 1, drop), Iso.scaled(skin, shade))
		for c in cells:
			if c.k != "h" or not c.get("rib", false):
				continue
			var x := int(c.x)
			var y := int(c.y)
			pen.poly(_quad(x * CW, y, (x + 1) * CW, y + 1, drop + 0.04), rib)
			pen.line(Iso.at(x * CW, y, drop + 0.04), Iso.at((x + 1) * CW, y, drop + 0.04), Color(1, 1, 1, 0.16))
		var deep := Iso.scaled(Color(str(style.hull)), 0.55)
		for c in cells:
			if c.k != "h" or int(c.get("ring", 0)) != Iso.HULL_REACH:
				continue
			var x := int(c.x)
			var y := int(c.y)
			var x0 := x * CW
			var x1 := x0 + CW
			if kind(x + 1, y) != "h":
				pen.poly_shaded(PackedVector2Array([Iso.at(x1, y, drop), Iso.at(x1, y + 1, drop), Iso.at(x1, y + 1, drop - 1), Iso.at(x1, y, drop - 1)]), PackedColorArray([deep, deep, Iso.BACKGROUND, Iso.BACKGROUND]))
			if kind(x, y + 1) != "h":
				pen.poly_shaded(PackedVector2Array([Iso.at(x0, y + 1, drop), Iso.at(x1, y + 1, drop), Iso.at(x1, y + 1, drop - 1), Iso.at(x0, y + 1, drop - 1)]), PackedColorArray([deep, deep, Iso.BACKGROUND, Iso.BACKGROUND]))
	for c in cells:
		if c.k == "m":
			pen.poly(_quad(int(c.x) * CW, int(c.y), (int(c.x) + 1) * CW, int(c.y) + 1), Iso.scaled(floor_color, 0.28))
	# The packs' floor tiles: every square shows its own tile's top. A room in the other look (the medbay's Light, on
	# this Dark ship) has its own stretch of floor.
	var floors: Array = []
	var main_floor: String = deck.get("mainFloor", ".")
	for c in cells:
		if c.k != "h" and c.k != "m":
			floors.append(c)
			var lot := _floor_lot(c, main_floor)
			if not _floor_order.has(lot):
				_floor_order[lot] = _floor_order.size()
	if packs.found:
		for which in ["dark", "light"]:
			_lay_floor(pen, floors, which)
	else:
		for c in floors:
			var tone := 0.62 + 0.1 * Iso.tile_hash(int(c.x) >> 1, int(c.y), 5)
			pen.poly(_quad(int(c.x) * CW, int(c.y), (int(c.x) + 1) * CW, int(c.y) + 1), Iso.scaled(floor_color, tone))
	# Hazard paint on the floor along the foot of a big machine.
	for c in floors:
		if c.has("hazard"):
			_paint_hazard(pen, c)
	# Where the floor stops at the hull or the dark, its edge shows.
	var edge := Iso.scaled(floor_color, 0.32)
	for c in floors:
		var x := int(c.x)
		var y := int(c.y)
		var x0 := x * CW
		var x1 := x0 + CW
		if _open(x + 1, y):
			var d := _edge_depth(x + 1, y)
			pen.poly(PackedVector2Array([Iso.at(x1, y), Iso.at(x1, y + 1), Iso.at(x1, y + 1, d), Iso.at(x1, y, d)]), Iso.scaled(edge, 0.7))
		if _open(x, y + 1):
			var d := _edge_depth(x, y + 1)
			pen.poly(PackedVector2Array([Iso.at(x0, y + 1), Iso.at(x1, y + 1), Iso.at(x1, y + 1, d), Iso.at(x0, y + 1, d)]), edge)
	# Hazard stripes across every doorway and way out.
	for c in floors:
		if c.k != "e" and c.k != "d":
			continue
		var x0 := int(c.x) * CW
		var y := int(c.y)
		for i in 4:
			pen.poly(_quad(x0, y + i * 0.25, x0 + CW, y + i * 0.25 + 0.25), Color("26241c") if i % 2 else Color("7c6c30"))
	# The rooms' names and whatever else is painted on the deck.
	var paint := Iso.mix(Iso.hex(scene.colors.get("writing"), "#d8d4c0"), Color("c8c4b0"), 0.5)
	for label in deck.labels:
		floor_words.append({"text": str(label.text), "at": Iso.at(float(label.x) * CW, float(label.y) + 0.5), "size": Iso.UNIT * 0.34, "color": Iso.see(paint, 0.5), "upright": false, "length": 0})
	for run in scene.runs:
		if run.get("on", "") == "ground":
			floor_words.append({"text": str(run.text), "at": Iso.at(float(run.x) * CW, float(run.y) + 0.5), "size": Iso.UNIT * 0.34, "color": Iso.see(paint, 0.5), "upright": false, "length": 0})


## Which of its floor textures the browser view would lay a square with: it lays the floor a texture at a time, in the
## order it first meets them, and that order decides which kind a tile with a square of each of two kinds is.
func _floor_lot(c: Dictionary, main_floor: String) -> String:
	var seed_of := Iso.hash_of(int(c.x) >> 1, int(c.y))
	if c.get("passage", false):
		return "passage"
	if c.k == "f" and c.has("mark") and c.mark != main_floor:
		return "second%d" % int(floor(seed_of * 2))
	return "plain%d" % int(floor(seed_of * 4))


func _open(x: int, y: int) -> bool:
	var k := kind(x, y)
	return k == "" or k == "~" or k == "v" or k == "s" or k == "h"


func _edge_depth(x: int, y: int) -> float:
	return -Iso.HULL_DROP if kind(x, y) == "h" else -Iso.FLOOR_EDGE


func _lay_floor(pen: Pen, floors: Array, which: String) -> void:
	var look: Dictionary = LOOKS[which]
	var picks: Dictionary = FLOOR_PICKS[which]
	var mine: Array = []
	var tiles := {}
	var first := {}
	var main_floor: String = deck.get("mainFloor", ".")
	for c in floors:
		if (which == "light") != bool(c.get("light", false)):
			continue
		mine.append(c)
		var tx := int(floor(int(c.x) * CW))
		var key := Vector2i(tx, int(c.y))
		var second: bool = c.k == "f" and c.has("mark") and c.mark != main_floor
		var kind_of := "passage" if c.get("passage", false) else ("second" if second else "plain")
		# A tile with a square of each of two kinds of floor is the kind the browser view comes to first, which is
		# the kind met first on the deck (it lays the floor a kind at a time).
		var rank: int = _floor_order.get(_floor_lot(c, main_floor), 99)
		if not tiles.has(key) or rank < int(first[key]):
			tiles[key] = kind_of
			first[key] = rank
	if mine.is_empty():
		return
	# Under the tiles, the floor's own dark, so the joins between them don't show what's under the room.
	var dim := packs.light_dim if which == "light" else 1.0
	var under := Color("1e2322") if which == "dark" else Color(126 * dim / 255.0, 132 * dim / 255.0, 130 * dim / 255.0)
	for c in mine:
		pen.poly(_quad(int(c.x) * CW, int(c.y), (int(c.x) + 1) * CW, int(c.y) + 1), under)
	for c in mine:
		var x := int(c.x)
		var y := int(c.y)
		var tx := int(floor(x * CW))
		var kind_of: String = tiles[Vector2i(tx, y)]
		var choices: Array = picks[kind_of]
		var pick: int = choices[int(floor(Iso.tile_hash(tx, y, 1) * choices.size()))]
		var to := [Iso.at(tx, y), Iso.at(tx + 1, y), Iso.at(tx, y + 1)]
		var square := _quad(x * CW, y, (x + 1) * CW, y + 1)
		pen.cell(packs.level_cell(int(look.floors[pick]), int(look.floor_row), which), CELL, FLOOR_CORNERS, to, square)
		# A plate that isn't the one the deck was built with: a shade off the rest, bolted down at its corners.
		if kind_of == "plain" and Iso.replaced_plate(tx, y):
			var plate := _quad(tx + 0.05, y + 0.05, tx + 0.95, y + 0.95)
			var kept := Pen._inside(plate, square)
			pen.poly(kept, Color(196 / 255.0, 210 / 255.0, 214 / 255.0, 0.1) if Iso.tile_hash(tx, y, 8) < 0.5 else Color(0, 0, 0, 0.18))
			for bolt in [Vector2(0.14, 0.14), Vector2(0.86, 0.14), Vector2(0.86, 0.86), Vector2(0.14, 0.86)]:
				var wx: float = tx + bolt.x
				if wx >= x * CW and wx < (x + 1) * CW:
					var p := Iso.at(wx, y + bolt.y)
					pen.poly(PackedVector2Array([p + Vector2(-1, -0.5), p + Vector2(1, -0.5), p + Vector2(1, 0.5), p + Vector2(-1, 0.5)]), Color(8 / 255.0, 10 / 255.0, 10 / 255.0, 0.75))


## Hazard paint: yellow and black along a line on the floor, so wide to one side of it. The stripes go by where they
## are on the deck, so they meet from square to square.
func _hazard_band(pen: Pen, from: Vector2, to: Vector2, wide: float, clip := PackedVector2Array()) -> void:
	var along_x := is_equal_approx(from.y, to.y)
	var a := minf(from.x, to.x) if along_x else minf(from.y, to.y)
	var b := maxf(from.x, to.x) if along_x else maxf(from.y, to.y)
	var s := int(floor(a / HAZARD_STEP + 0.000001))
	while s * HAZARD_STEP < b - 0.000001:
		var p := maxf(a, s * HAZARD_STEP)
		var q := minf(b, (s + 1) * HAZARD_STEP)
		var shape := _quad(p, from.y, q, from.y + wide) if along_x else _quad(from.x, p, from.x + wide, q)
		if not clip.is_empty():
			shape = Pen._inside(shape, clip)
		pen.poly(shape, HAZARD[posmod(s, 2)])
		s += 1


func _paint_hazard(pen: Pen, c: Dictionary) -> void:
	var x0 := int(c.x) * CW
	var x1 := x0 + CW
	var y := float(int(c.y))
	var sides: String = c.hazard
	if sides.contains("n"):
		_hazard_band(pen, Vector2(x0, y), Vector2(x1, y), 0.07)
	if sides.contains("s"):
		_hazard_band(pen, Vector2(x0, y + 1), Vector2(x1, y + 1), -0.07)
	if sides.contains("w"):
		_hazard_band(pen, Vector2(x0, y), Vector2(x0, y + 1), 0.07)
	if sides.contains("e"):
		_hazard_band(pen, Vector2(x1, y), Vector2(x1, y + 1), -0.07)


# ---- What stands on it ----------------------------------------------------------------------------------------------

func _stand_everything() -> void:
	var list: Array[Dictionary] = []
	var order := 0
	for b in scene.blocks:
		list.append({"t": "block", "depth": float(b.get("frontDepth", b.depth)), "order": order, "b": b})
		order += 1
	for thing in deck.things:
		var c := Iso.centre(int(thing.x), int(thing.y))
		list.append({"t": "thing", "depth": c.x + c.y, "order": order, "thing": thing})
		order += 1
	for exit in deck.exits:
		var c := Iso.centre(int(exit.x), int(exit.y))
		list.append({"t": "way", "depth": c.x + c.y - 0.4, "order": order, "exit": exit})
		order += 1
	for run in scene.runs:
		if run.get("on", "") == "wall" or run.get("on", "") == "roof":
			list.append({"t": "words", "depth": (float(run.x) + float(run.length)) * CW + float(run.y) + 1.0, "order": order, "run": run})
			order += 1
	for fixture in scene.fixtures:
		var c := Iso.centre(int(fixture.x), int(fixture.y))
		list.append({"t": "fixture", "depth": c.x + c.y + 0.01, "order": order, "fixture": fixture})
		order += 1
	list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.depth < b.depth or (a.depth == b.depth and a.order < b.order))

	var paint := Iso.mix(Iso.hex(scene.colors.get("writing"), "#d8d4c0"), Color("c8c4b0"), 0.5)
	var pen := standing
	for item in list:
		match item.t:
			"block":
				var b: Dictionary = item.b
				_shadow_of(b)
				pen.begin_item(item.depth)
				_block(pen, b)
				var drawn := pen.end_item()
				# What grows in a bed is never drawn again over someone standing by it.
				if b.style == "plants" and not drawn.is_empty():
					drawn["low"] = true
			"thing":
				pen.begin_item(item.depth)
				_thing(pen, item.thing)
				pen.end_item()
			"way":
				pen.begin_item(item.depth)
				_way_out(pen, item.exit)
				pen.end_item()
			"fixture":
				pen.begin_item(item.depth)
				_fixture(pen, item.fixture)
				pen.end_item()
			"words":
				var run: Dictionary = item.run
				var h := height(int(run.x), int(run.y))
				if run.on == "wall":
					var low := h < 1.0
					wall_words.append({"text": str(run.text), "at": Iso.at(float(run.x) * CW, float(run.y) + 1.0, h if low else h * 0.52), "size": Iso.UNIT * (0.2 if low else 0.34), "color": Iso.see(paint, 0.62), "upright": true, "length": int(run.length)})
				else:
					wall_words.append({"text": str(run.text), "at": Iso.at(float(run.x) * CW, float(run.y) + 0.5, h), "size": Iso.UNIT * 0.3, "color": Iso.see(paint, 0.62), "upright": false, "length": 0})


## The soft shadow a block throws on the floor round it.
func _shadow_of(b: Dictionary) -> void:
	var style: String = b.style
	if style == "piece":
		if b.has("shadow"):
			var s: Array = b.shadow
			shadows.append(_quad(s[0], s[1], float(s[2]) + 0.07, float(s[3]) + 0.07))
		return
	if style == "plants" or style == "lamp" or style == "stairs" or style == "rail" or style == "tank" or style == "stood" or b.has("wx"):
		return
	var x0 := int(b.x) * CW
	var grow := minf(0.28, float(b.h) * 0.22)
	shadows.append(_quad(x0, int(b.y), x0 + CW + grow, int(b.y) + 1 + grow))


## A box of plain colour: its top, its side toward the camera and its side to the right.
func _box(pen: Pen, x0: float, y0: float, x1: float, y1: float, z0: float, z1: float, top: Color, front: Color, side: Color) -> void:
	pen.poly(PackedVector2Array([Iso.at(x1, y0, z1), Iso.at(x1, y1, z1), Iso.at(x1, y1, z0), Iso.at(x1, y0, z0)]), side)
	pen.poly(PackedVector2Array([Iso.at(x0, y1, z1), Iso.at(x1, y1, z1), Iso.at(x1, y1, z0), Iso.at(x0, y1, z0)]), front)
	pen.poly(_quad(x0, y0, x1, y1, z1), top)


func _box_of(pen: Pen, x0: float, y0: float, x1: float, y1: float, z0: float, z1: float, color: Color) -> void:
	_box(pen, x0, y0, x1, y1, z0, z1, Iso.scaled(color, 1.12), color, Iso.scaled(color, 0.68))


## One picture of a piece, stood with its middle on a point of the floor (in tiles) or so far above it.
func _picture(pen: Pen, picture: Variant, cx: float, cy: float, flip := false, lift := 0.0, middle := false, clip := PackedVector2Array(), tint := Color.WHITE) -> bool:
	var entry := packs.want(picture)
	if entry.is_empty():
		return false
	var anchor: Vector2
	if middle:
		anchor = Vector2((entry.x0 + entry.x1 + 1) / 2.0, (entry.y0 + entry.y1 + 1) / 2.0)
	else:
		# Halfway across, and up from its lowest pixel by a quarter of its width: the middle of the diamond it stands on.
		var wide: float = entry.x1 - entry.x0 + 1
		anchor = Vector2(entry.x0 + wide / 2.0, entry.y1 + 1 - wide / 4.0)
	pen.picture(entry, anchor, Iso.at(cx, cy, lift), flip, tint, clip)
	return true


## A way of drawing something the game gave ({ picture, flip, times, on, lift }), stood on a point.
func _way(pen: Pen, way: Variant, cx: float, cy: float, lift := 0.0, flip_too := false) -> bool:
	if typeof(way) != TYPE_DICTIONARY:
		return false
	var flip: bool = way.get("flip", false) != flip_too
	if not _picture(pen, way.picture, cx, cy, flip, lift):
		return false
	if way.has("on"):
		_picture(pen, way.on, cx, cy, false, float(way.get("lift", 0.0)))
	return true


func _block(pen: Pen, b: Dictionary) -> void:
	var x := int(b.x)
	var y := int(b.y)
	var h := float(b.h)
	var x0 := x * CW
	var x1 := x0 + CW
	match b.style:
		"piece":
			_piece(pen, b)
		"plants":
			_plants(pen, b)
		"wall":
			if packs.found and is_equal_approx(h, WH):
				var same_right := _full_wall(x + 1, y) and lit(x + 1, y + 1) == lit(x, y + 1)
				var same_left := _full_wall(x - 1, y) and lit(x - 1, y + 1) == lit(x, y + 1)
				_wall(pen, b, same_right, same_left, "light" if lit(x, y + 1) else "dark", "light" if lit(x + 1, y) else "dark")
				_wall_runs(pen, x, y)
			elif packs.found and is_equal_approx(h, Iso.CUT_WALL_HEIGHT):
				_low_wall(pen, x, y, "light" if (lit(x, y - 1) or lit(x - 1, y)) else "dark")
			else:
				_note_plain("a wall")
				_box(pen, x0, y, x1, y + 1, 0, h, Color("1c2126"), Color("46505c"), Color("2c343e"))
		"stairs":
			if packs.found:
				_stairs(pen, b)
		"rail":
			if packs.found:
				_rail(pen, b)
		"tank":
			if not _way(pen, ways.get("tank"), (x + 0.5) * CW, y + 0.5):
				_note_plain("a tank")
				_box_of(pen, x0 + 0.08, y + 0.2, x1 - 0.08, y + 0.8, 0, 1.0, Color("50606a"))
		"stood":
			if not _way(pen, b.get("pic"), float(b.cx), float(b.cy), float(b.get("lift", 0.0))):
				_note_plain(str(b.get("piece", "a piece")))
		"post":
			if b.get("stair", false) and packs.found:
				return
			var post: Variant = ways.get("post", {})
			if b.get("mark", "") == "|" and typeof(post) == TYPE_DICTIONARY and _way(pen, post.get("e" if b.get("turned", false) else "s"), (x + 0.5) * CW, y + 0.5):
				return
			_box(pen, x0 + 0.09, y + 0.18, x1 - 0.09, y + 0.82, 0, h, Color("55574f"), Color("3a3c38"), Color("20211f"))
		"crate":
			var crate: Variant = ways.get("crate", {})
			if typeof(crate) == TYPE_DICTIONARY and _way(pen, crate.get("light" if lit(x, y) else "dark"), (x + 0.5) * CW, y + 0.5):
				return
			_note_plain("a crate")
			_box_of(pen, x0, y + 0.1, x1, y + 0.9, 0, h, Color("5a5040"))
		"machine":
			_machine(pen, b)
		_:
			# A round thing between two pumps is a tank; a heap of scrap is the pack's drums or cases.
			if b.get("tank", false) and _way(pen, ways.get("tank"), (x + 0.5) * CW, y + 0.5):
				return
			if b.style == "scrap":
				var heaps: Variant = ways.get("scrap", [])
				if typeof(heaps) == TYPE_ARRAY and heaps.size() > 0 and _way(pen, heaps[mini(heaps.size() - 1, int(floor(float(b.get("seed", 0.0)) * heaps.size())))], (x + 0.5) * CW, y + 0.5):
					return
			# Anything else on the plan (rock, a ledge, the body of something) is a plain block of its height.
			var rock: bool = b.style == "rock" or b.style == "ice"
			var tone := Iso.mix(Color("6a6052"), Iso.hex(scene.colors.get("scenery"), "#8a8e80"), 0.2) if rock else Color("4a5058")
			_box(pen, x0, y, x1, y + 1, 0, h, Iso.scaled(tone, 0.8 if rock else 0.9), Iso.scaled(tone, 0.6), Iso.scaled(tone, 0.4))


func _full_wall(x: int, y: int) -> bool:
	return kind(x, y) == "w" and is_equal_approx(height(x, y), WH) and height(x, y + 1) < WH


## A wall standing its full height: its top in the pack's colour and a slab of the pack's wall on each face that shows.
## A face along the plan's rows is half a tile wide and the pack's wall a whole tile, so both halves of a tile's wall
## are drawn from the same slab, each kept to its own half.
func _wall(pen: Pen, b: Dictionary, same_right: bool, same_left: bool, look_left := "dark", look_right := "dark") -> void:
	var x := int(b.x)
	var y := int(b.y)
	var h := float(b.h)
	var x0 := x * CW
	var x1 := x0 + CW
	var left := float(b.get("left", 0.0))
	var right := float(b.get("right", 0.0))
	var front := y + 1 - 0.125 if left < h else y + 1.0
	pen.poly(PackedVector2Array([Iso.at(x0, y, h), Iso.at(x1, y, h), Iso.at(x1, front, h), Iso.at(x0, front, h)]), packs.tops.dark)
	if left < h:
		var tile := int(floor(x0 + 0.000001))
		var cells: Array = WALL_DOWN_LEFT.cells
		var pick: int = cells[int(floor(Iso.tile_hash(tile, y, 2) * cells.size()))]
		var to := [Iso.at(tile, y + 1, 0), Iso.at(tile + 1, y + 1, 0), Iso.at(tile, y + 1, h)]
		var first := absf(x0 - tile) < 0.000001
		var origin := packs.level_cell(pick, int(LOOKS[look_left].wall_row), look_left)
		if first and same_right:
			pen.cell(origin, CELL, WALL_DOWN_LEFT.corners, to)
		elif first or not same_left:
			pen.cell(origin, CELL, WALL_DOWN_LEFT.corners, to, PackedVector2Array([Iso.at(x0, y + 1, -0.05), Iso.at(x1, y + 1, -0.05), Iso.at(x1, y + 0.8, h + 0.3), Iso.at(x0, y + 0.8, h + 0.3)]))
	if right < h:
		var cells: Array = WALL_DOWN_RIGHT.cells
		var pick: int = cells[int(floor(Iso.tile_hash(int(round(x1 * 2)), y, 3) * cells.size()))]
		pen.cell(packs.level_cell(pick, int(LOOKS[look_right].wall_row), look_right), CELL, WALL_DOWN_RIGHT.corners, [Iso.at(x1, y + 1, 0), Iso.at(x1, y, 0), Iso.at(x1, y + 1, h)])


func _bare(x: int, y: int) -> bool:
	return kind(x, y) == "w" and is_equal_approx(height(x, y), WH) and not fitted.has("%d,%d" % [x, y])


## Pipes and cables along stretches of bare wall: a face that looks into a room, with nothing hung on it or on the wall
## either side of it, and the same wall going on both ways.
func _wall_runs(pen: Pen, x: int, y: int) -> void:
	var south := true
	var east := true
	for d in [-1, 0, 1]:
		if not (_bare(x + d, y) and see_through(kind(x + d, y + 1))):
			south = false
		if not (_bare(x, y + d) and see_through(kind(x + 1, y + d))):
			east = false
	var runs: Dictionary = ways.get("runs", {})
	if south:
		var id := Iso.wall_run(x, y, "s")
		if id != "":
			_hang(pen, runs.get(id), (x + 0.5) * CW, y + 1.04, "s", 1.22 if id == "run:pipe" else 1.34)
	if east:
		var id := Iso.wall_run(x, y, "e")
		if id != "":
			for part in [0.25, 0.75]:
				_hang(pen, runs.get(id), (x + 1) * CW + 0.04, y + part, "e", 1.22 if id == "run:pipe" else 1.34)


## Something flat hung on a wall by its middle, turned round if its picture was drawn for the other kind of wall.
func _hang(pen: Pen, way: Variant, wx: float, wy: float, face: String, lift: float) -> bool:
	if typeof(way) != TYPE_DICTIONARY:
		return false
	var entry := packs.want(way.picture)
	if entry.is_empty():
		return false
	var lean := packs.slant(entry)
	return _picture(pen, way.picture, wx, wy, lean != "" and lean != face, lift, true)


## Part of the level sheet's low-wall row drawn with three of its points on three of the room's.
func _stretch(pen: Pen, row: int, arm: Dictionary, to: Array, look: String, clip := PackedVector2Array()) -> void:
	pen.cell(packs.level_cell(0, row, look), Rect2(arm.from, 0, arm.wide, 128), arm.corners, to, clip)


## A wall cut down so the room behind it can be seen: the pack's low wall along the middle of it, on a dark sill.
func _low_wall(pen: Pen, x: int, y: int, look: String) -> void:
	var x0 := x * CW
	var x1 := x0 + CW
	if kind(x, y + 1) != "w":
		pen.poly(PackedVector2Array([Iso.at(x0, y + 1, SILL), Iso.at(x1, y + 1, SILL), Iso.at(x1, y + 1, 0), Iso.at(x0, y + 1, 0)]), Color("121514"))
	if kind(x + 1, y) != "w":
		pen.poly(PackedVector2Array([Iso.at(x1, y, SILL), Iso.at(x1, y + 1, SILL), Iso.at(x1, y + 1, 0), Iso.at(x1, y, 0)]), Color("0c0e0d"))
	pen.poly(_quad(x0, y, x1, y + 1, SILL), packs.tops.dark)
	var row := int(LOOKS[look].wall_row) + 1
	var along := kind(x - 1, y) == "w" or kind(x + 1, y) == "w"
	var down := kind(x, y - 1) == "w" or kind(x, y + 1) == "w"
	if down:
		var middle := x0 + CW / 2.0
		_stretch(pen, row, LOW_DOWN_LEFT, [Iso.at(middle, y, SILL), Iso.at(middle, y + 1, SILL), Iso.at(middle, y, SILL + 1)], look)
	if along or not down:
		var tile := int(floor(x0 + 0.000001))
		var keep := PackedVector2Array([Iso.at(x0, y + 0.95, -0.05), Iso.at(x1, y + 0.95, -0.05), Iso.at(x1, y + 0.05, 0.8), Iso.at(x0, y + 0.05, 0.8)])
		_stretch(pen, row, LOW_DOWN_RIGHT, [Iso.at(tile, y + 0.5, SILL), Iso.at(tile + 1, y + 0.5, SILL), Iso.at(tile, y + 0.5, SILL + 1)], look, keep)


## A rail along one edge of a square: a length of the pack's low wall with its post, on the line between a machine and
## the floor beside it.
func _rail(pen: Pen, b: Dictionary) -> void:
	var x := int(b.x)
	var y := int(b.y)
	var x0 := x * CW
	var x1 := x0 + CW
	var row := int(LOOKS.dark.wall_row) + 1
	var edge: String = b.edge
	if edge == "n" or edge == "s":
		var wy := float(y) if edge == "n" else y + 1.0
		var tile := int(floor(x0 + 0.000001))
		var keep := PackedVector2Array([Iso.at(x0, wy + 0.2, -0.05), Iso.at(x1, wy + 0.2, -0.05), Iso.at(x1, wy - 0.2, 0.8), Iso.at(x0, wy - 0.2, 0.8)])
		_stretch(pen, row, LOW_DOWN_RIGHT, [Iso.at(tile, wy, 0), Iso.at(tile + 1, wy, 0), Iso.at(tile, wy, 1)], "dark", keep)
	else:
		var wx := x0 if edge == "w" else x1
		_stretch(pen, row, LOW_DOWN_LEFT, [Iso.at(wx, y, 0), Iso.at(wx, y + 1, 0), Iso.at(wx, y, 1)], "dark")


## One flight of the pack's stairs with both its rails, at the pack's own size: the middle of its top edge at xTop, yc
## on the plan, zTop up.
func _flight(pen: Pen, look: String, x_top: float, yc: float, z_top: float, clip := PackedVector2Array()) -> void:
	var row := int(LOOKS[look].wall_row) + 2
	var corner: Vector2 = Iso.at(x_top, yc, z_top) - flight.top * 0.5
	var from := [Vector2.ZERO, Vector2(128, 0), Vector2(0, 128)]
	var to := [corner, corner + Vector2(64, 0), corner + Vector2(0, 64)]
	pen.cell(packs.level_cell(0, row, look), CELL, from, to, clip)
	pen.cell(packs.level_cell(1, row, look), CELL, from, to, clip)


## A deck's stairs, where the plan has their row of posts. The way up is two of the pack's flights, one from the top of
## the other, to a landing on posts; the way down is a well in the deck with the flight going down into it, hazard
## paint along its near edges.
func _stairs(pen: Pen, b: Dictionary) -> void:
	var look := "light" if b.get("light", false) else "dark"
	var sx0 := float(b.x0)
	var sx1 := float(b.x1)
	var sy0 := float(b.y0)
	var sy1 := float(b.y1)
	var yc := (sy0 + sy1) / 2.0
	var half: float = flight.wide / 2.0
	var run: float = flight.run
	var rise: float = flight.rise
	if b.way == "up":
		var landing := minf(0.45, maxf(0.15, sx1 - sx0 - run * 2 - 0.1))
		var foot := (sx0 + sx1) / 2.0 + (run * 2 + landing) / 2.0
		var mid := foot - run
		var top := foot - run * 2
		var high := rise * 2
		var posts := [[top - landing, high], [top, high], [mid, rise]]
		for p in posts:
			_box(pen, p[0] - 0.03, yc - half - 0.03, p[0] + 0.03, yc - half + 0.03, 0, p[1], STAIR_STEEL[0], STAIR_STEEL[1], STAIR_STEEL[2])
		_box(pen, top - landing, yc - half, top, yc + half, high - 0.06, high, STAIR_STEEL[0], STAIR_STEEL[1], STAIR_STEEL[2])
		_flight(pen, look, top, yc, high)
		_flight(pen, look, mid, yc, rise)
		for p in posts:
			_box(pen, p[0] - 0.03, yc + half - 0.03, p[0] + 0.03, yc + half + 0.03, 0, p[1], STAIR_STEEL[0], STAIR_STEEL[1], STAIR_STEEL[2])
		return
	# The well: all of the stairs' place but a rim. What's below the deck is seen only through its mouth.
	var ax := sx0 + 0.06
	var ay := sy0 + 0.14
	var bx := sx1 - 0.06
	var by := sy1 - 0.14
	var mouth := PackedVector2Array([Iso.at(ax, ay), Iso.at(bx, ay), Iso.at(bx, by), Iso.at(ax, by)])
	var pit := Color("040606")
	pen.poly(mouth, pit)
	# Its far walls, going down into the dark.
	var deep := 1.6
	for wall in [[Vector2(ax, ay), Vector2(bx, ay), Color("2a3534")], [Vector2(ax, by), Vector2(ax, ay), Color("1a2221")]]:
		var a: Vector2 = wall[0]
		var c: Vector2 = wall[1]
		var whole := PackedVector2Array([Iso.at(a.x, a.y, 0), Iso.at(c.x, c.y, 0), Iso.at(c.x, c.y, -deep), Iso.at(a.x, a.y, -deep)])
		var kept := Pen._inside(whole, mouth)
		if kept.size() < 3:
			continue
		# Shaded from the wall's own colour at the deck to the dark three quarters of the way down.
		var from := whole[0]
		var axis := whole[3] - whole[0]
		var shades := PackedColorArray()
		for p in kept:
			var t := clampf((p - from).dot(axis) / axis.length_squared() / 0.75, 0.0, 1.0)
			shades.append((wall[2] as Color).lerp(pit, t))
		pen.poly_shaded(kept, shades)
	_flight(pen, look, ax + 0.1, yc, 0, mouth)
	# Darker the further down it goes.
	var start := Iso.at(ax, yc)
	var slope := Iso.at(ax + 1.5, yc + 1.2) - start
	var dark := PackedColorArray()
	for p in mouth:
		var t := clampf(((p - start).dot(slope) / slope.length_squared() - 0.3) / 0.7, 0.0, 1.0)
		dark.append(Color(2 / 255.0, 4 / 255.0, 4 / 255.0, 0.9 * t))
	pen.poly_shaded(mouth, dark)
	# A lip round the mouth, and hazard paint along the two edges nearest the camera.
	for i in 4:
		pen.line(mouth[i], mouth[(i + 1) % 4], Color("2c3534"), 1.3)
	_hazard_band(pen, Vector2(ax, by), Vector2(bx, by), 0.07)
	_hazard_band(pen, Vector2(bx, ay), Vector2(bx, by), 0.07)


## A console drawn on the plan, as the pack's; a big machine's square as the pack's pumps or a length of dark hull.
func _machine(pen: Pen, b: Dictionary) -> void:
	var x := int(b.x)
	var y := int(b.y)
	var h := float(b.h)
	var x0 := x * CW
	var x1 := x0 + CW
	if b.has("big"):
		if b.big == "engine":
			var flip: bool = b.get("heartSide", "") == "w"
			var drawn := false
			for part in [0.27, 0.73]:
				drawn = _way(pen, ways.get("pump"), (x + 0.5) * CW, y + part, 0.0, flip) or drawn
			if drawn:
				return
		elif packs.found:
			_wall(pen, b, _hull(x + 1, y, h), _hull(x - 1, y, h))
			# The middle of a stretch of hull is its well, darker than its rim.
			if b.get("inner", false):
				pen.poly(_quad(x0, y, x1, y + 1, h), Color(6 / 255.0, 10 / 255.0, 12 / 255.0, 0.62))
			return
	elif b.has("bank"):
		var bank: Dictionary = b.bank
		if bank.get("draw") == null:
			return
		var name: String = str(bank.draw).trim_prefix("plan-")
		if _way(pen, ways.get(name), (x + float(bank.get("across", 1)) / 2.0) * CW, y + 0.5, 0.0, bank.get("flip", false)):
			return
	_note_plain("a machine")
	_box(pen, x0, y, x1, y + 1, 0, h, Color("3c4854"), Color("2e3640"), Color("20262e"))


func _hull(x: int, y: int, h: float) -> bool:
	return big.get("%d,%d" % [x, y], "") == "hull" and is_equal_approx(height(x, y), h) and height(x, y + 1) < h


## A piece of furniture: the packs' picture of it where the folder has one, stood in the middle of its place, a long
## piece's picture several times along it; a fitting on the face of its wall; or a plain shape of its size.
func _piece(pen: Pen, b: Dictionary) -> void:
	var px0 := float(b.x0)
	var px1 := float(b.x1)
	var py0 := float(b.y0)
	var py1 := float(b.y1)
	var what: String = b.get("what", "stand")
	var way: Variant = b.get("pic")
	if what == "wall":
		var face: String = b.get("face", "s")
		var wx := (px0 + px1) / 2.0 if face == "s" else px1 + 0.04
		var wy := py1 + 0.04 if face == "s" else (py0 + py1) / 2.0
		if way != null and b.get("high") != null and _hang(pen, way, wx, wy, face, float(b.high)):
			return
		_on_wall(pen, b)
		return
	if typeof(way) == TYPE_DICTIONARY:
		var cx := (px0 + px1) / 2.0
		var cy := (py0 + py1) / 2.0
		var times := int(way.get("times", 1))
		var across := px1 - px0 >= py1 - py0
		var lift := float(b.get("lift", 0.0))
		var drawn := false
		for i in times:
			var t := (i + 0.5) / times
			var sx := px0 + t * (px1 - px0) if across else cx
			var sy := cy if across else py0 + t * (py1 - py0)
			drawn = _way(pen, way, sx, sy, lift) or drawn
		if drawn:
			return
	_note_plain(str(b.kind))
	# A plain shape of its size: a seat with a back, a flat patch for what lies on the floor, a little box for a small
	# thing, a box as high as the piece for anything else.
	var edge := 0.05
	var glow: Variant = b.get("lit")
	var top := float(b.get("top", 0.5))
	if what == "rug":
		pen.poly(_quad(px0 + edge, py0 + edge, px1 - edge, py1 - edge, 0.012), Color("4d4658"))
	elif what == "small":
		var cx := (px0 + px1) / 2.0
		var cy := (py0 + py1) / 2.0
		var z := float(b.get("lift", 0.0))
		_box_of(pen, cx - 0.09, cy - 0.09, cx + 0.09, cy + 0.09, z, z + 0.16, Iso.scaled(Color(str(glow)), 0.6) if glow != null else Color("8a8f96"))
	elif what == "seat":
		_box_of(pen, px0 + edge, py0 + edge, px1 - edge, py1 - edge, 0, 0.45, Color("2c3948"))
	else:
		var tone := Color("59636f") if what == "table" else (Color("5a6a78") if what == "bed" else Color("6b737b"))
		_box_of(pen, px0 + edge, py0 + edge, px1 - edge, py1 - edge, 0, maxf(0.1, top), tone)


## What the browser view draws on a wall itself, in a plainer first version: a window with the stars outside, a screen
## with a few lines on it; and a plain panel for a fitting of the packs whose picture isn't in the folder.
func _on_wall(pen: Pen, b: Dictionary) -> void:
	var face: String = b.get("face", "s")
	var wx := int(b.wallX)
	var wy := int(b.wallY)
	var inset := 0.025 if b.kind == "window" else 0.05
	# A point of the wall's face toward the room: t along it, z up.
	var at := func(t: float, z: float) -> Vector2:
		if face == "e":
			return Iso.at((wx + 1) * CW + 0.003, wy + inset * 2 + (1 - inset * 4) * t, z)
		return Iso.at(wx * CW + inset + (CW - inset * 2) * t, wy + 1.003, z)
	var pane := func(z0: float, z1: float) -> PackedVector2Array:
		return PackedVector2Array([at.call(0.0, z1), at.call(1.0, z1), at.call(1.0, z0), at.call(0.0, z0)])
	if b.kind == "window":
		var high := WH - 0.18
		pen.poly(pane.call(0.38, high), Color("050b14"))
		pen.poly_shaded(pane.call(0.38, high), PackedColorArray([Color(30 / 255.0, 50 / 255.0, 90 / 255.0, 0.55), Color(30 / 255.0, 50 / 255.0, 90 / 255.0, 0.55), Color(5 / 255.0, 10 / 255.0, 20 / 255.0, 0), Color(5 / 255.0, 10 / 255.0, 20 / 255.0, 0)]))
		for i in 6:
			var star: Vector2 = at.call(Iso.tile_hash(wx * 7 + i, wy, 41), 0.42 + Iso.tile_hash(wx, wy * 5 + i, 43) * (high - 0.5))
			var big_one := Iso.tile_hash(wx + i, wy + i, 47) > 0.8
			var s := 0.8 if big_one else 0.5
			pen.poly(PackedVector2Array([star + Vector2(-s, -s), star + Vector2(s, -s), star + Vector2(s, s), star + Vector2(-s, s)]), Color(230 / 255.0, 240 / 255.0, 1, 0.45 + Iso.tile_hash(wx - i, wy, 53) * 0.5))
		var frame := Color(170 / 255.0, 185 / 255.0, 200 / 255.0, 0.55)
		pen.line(at.call(0.0, 0.38), at.call(0.0, high), frame, 1.2)
		pen.line(at.call(0.0, high), at.call(1.0, high), frame, 1.2)
		pen.line(at.call(0.15, 0.6), at.call(0.6, 1.25), Color(200 / 255.0, 225 / 255.0, 1, 0.12), 2.0)
	elif b.kind == "wall-screen":
		var off: bool = b.get("off", false)
		pen.poly(pane.call(0.86, 1.3), Color("05080a") if off else Color("0b2733"))
		if not off:
			for i in 3:
				pen.line(at.call(0.1, 1.22 - i * 0.1), at.call(0.3 + ((wx * 3 + i * 5) % 4) * 0.13, 1.22 - i * 0.1), Color(134 / 255.0, 220 / 255.0, 1, 0.8), 1.0)
		var lamp: Vector2 = at.call(0.85, 0.95)
		pen.poly(PackedVector2Array([lamp + Vector2(-1, -1), lamp + Vector2(1, -1), lamp + Vector2(1, 1), lamp + Vector2(-1, 1)]), Color("3a2a18") if off else Color("ffb45a"))
		var rim := Color(150 / 255.0, 170 / 255.0, 190 / 255.0, 0.4)
		pen.line(at.call(0.0, 0.86), at.call(0.0, 1.3), rim, 1.0)
		pen.line(at.call(0.0, 1.3), at.call(1.0, 1.3), rim, 1.0)
	else:
		_note_plain(str(b.kind))
		var glow: Variant = b.get("lit")
		var middle := clampf(float(b.get("high", 0.95)) if b.get("high") != null else 0.95, 0.35, WH - 0.35)
		pen.poly(pane.call(middle - 0.24, middle + 0.24), Iso.scaled(Color(str(glow)), 0.6) if glow != null else Color("56616b"))


## What grows in a garden's bed, in a plainer first version of the browser view's: a few blades to a square.
func _plants(pen: Pen, b: Dictionary) -> void:
	var x := int(b.x)
	var y := int(b.y)
	var leaf := Iso.mix(Color("4e6e38"), Iso.hex(scene.colors.get("scenery"), "#8a8e80"), 0.3)
	for i in 7:
		var foot := Iso.at((x + 0.1 + Iso.tile_hash(x * 3 + i, y, 61) * 0.8) * CW, y + 0.1 + Iso.tile_hash(x, y * 3 + i, 67) * 0.8)
		var lean := (Iso.tile_hash(x + i, y - i, 71) - 0.5) * Iso.UNIT * 0.1
		var high := Iso.UNIT * (0.14 + Iso.tile_hash(x - i, y + i, 73) * 0.14)
		var colour: Color = Iso.mix(PLANT_COLORS[int(floor(Iso.tile_hash(x * 5 + i, y * 7, 79) * PLANT_COLORS.size()))], leaf, 0.3)
		pen.line(foot, foot + Vector2(lean * 0.3, -high * 0.6), colour, maxf(1.0, Iso.UNIT * 0.022))
		pen.line(foot + Vector2(lean * 0.3, -high * 0.6), foot + Vector2(lean, -high), colour, maxf(1.0, Iso.UNIT * 0.022))


## A thing on the floor that's none of the game's furniture, as the packs' piece for what its name says it is.
func _thing(pen: Pen, thing: Dictionary) -> void:
	if thing.has("looks") or thing.get("nothing", false):
		return
	var cx := (int(thing.x) + 0.5) * CW
	var cy := int(thing.y) + 0.5
	if _way(pen, thing.get("pic"), cx, cy):
		return
	_note_plain(str(thing.name))
	_box(pen, cx - 0.2, cy - 0.3, cx + 0.2, cy + 0.3, 0, 0.3, Color("6e5c3c"), Color("463a26"), Color("2c2418"))


## A lamp on a wall, as the pack's strip light, on the face of the wall the room sees.
func _fixture(pen: Pen, fixture: Dictionary) -> void:
	var x := int(fixture.x)
	var y := int(fixture.y)
	var left: bool = fixture.face == "left"
	var wx := (x + 0.5) * CW if left else (x + 1) * CW + 0.04
	var wy := y + 1.04 if left else y + 0.5
	if _hang(pen, ways.get("lamp"), wx, wy, "s" if left else "e", WH * 0.72):
		return
	var z := WH * 0.72
	if left:
		pen.poly(PackedVector2Array([Iso.at((x + 0.15) * CW, y + 1, z + 0.12), Iso.at((x + 0.85) * CW, y + 1, z + 0.12), Iso.at((x + 0.85) * CW, y + 1, z), Iso.at((x + 0.15) * CW, y + 1, z)]), Color("14130f"))
	else:
		pen.poly(PackedVector2Array([Iso.at((x + 1) * CW, y + 0.8, z + 0.12), Iso.at((x + 1) * CW, y + 0.2, z + 0.12), Iso.at((x + 1) * CW, y + 0.2, z), Iso.at((x + 1) * CW, y + 0.8, z)]), Color("14130f"))


## Where a lamp shines from, on the picture.
func fixture_middle(fixture: Dictionary) -> Vector2:
	var x := int(fixture.x)
	var y := int(fixture.y)
	var z := WH * 0.72 + 0.06
	return Iso.at((x + 0.5) * CW, y + 1, z) if fixture.face == "left" else Iso.at((x + 1) * CW, y + 0.5, z)


## A way out that's in a wall is the pack's door, standing open.
func _way_out(pen: Pen, exit: Dictionary) -> void:
	if not packs.found:
		return
	var x := int(exit.x)
	var y := int(exit.y)
	var tall_x := height(x - 1, y) > 1.0 or height(x + 1, y) > 1.0
	if not (tall_x or height(x, y - 1) > 1.0 or height(x, y + 1) > 1.0):
		return
	var door := _door_at(x, y, "x" if tall_x else "y")
	if door.is_empty():
		return
	var picture: int = OPENING[OPENING.size() - 1]
	pen.cell(packs.doors_cell(picture % 8, int(door.row) + picture / 8), CELL, door.corners, door.to)


# ---- The doors between rooms ----------------------------------------------------------------------------------------

## Which way a doorway runs: along the screen's width where it's in a wall with wall to its left or right, else down it.
## (The game says so with each doorway; this is for a way out in a wall.)
func _door_at(x: int, y: int, along: String) -> Dictionary:
	var x0 := x * CW
	if along == "x":
		# The second of two doorways side by side has nothing of its own: they share one door.
		if kind(x - 1, y) == "d":
			return {}
		var pair := kind(x + 1, y) == "d"
		var a := x0 if pair else x0 + CW / 2.0 - 0.5
		return {"row": DOOR_ROWS.down_left, "corners": WALL_DOWN_LEFT.corners, "to": [Iso.at(a, y + 1, 0), Iso.at(a + 1, y + 1, 0), Iso.at(a, y + 1, WH)], "depth": (x + 0.5) * CW + y + 1 - 0.02}
	var face := x0 + CW
	return {"row": DOOR_ROWS.down_right, "corners": WALL_DOWN_RIGHT.corners, "to": [Iso.at(face, y + 1, 0), Iso.at(face, y, 0), Iso.at(face, y + 1, WH)], "depth": (x + 1) * CW + y + 0.5 - 0.02}


## The doors between rooms, which slide open for whoever comes near: each in the front of its doorway, in the line of
## the walls beside it. A doorway along the plan's row is half a tile wide and the pack's door a whole tile, so a door
## on its own is centred on it, and two doorways side by side share one.
func _find_doors() -> void:
	if not packs.found:
		return
	for d in scene.doorways:
		var x := int(d.x)
		var y := int(d.y)
		var door := _door_at(x, y, str(d.along))
		var c := Iso.centre(x, y)
		var entry := {"x": x, "y": y, "centre": c, "open": 0.0, "drawn": not door.is_empty()}
		if not door.is_empty():
			var corners: Array = door.corners
			var to: Array = door.to
			var from_space := Transform2D(corners[1] - corners[0], corners[2] - corners[0], corners[0])
			var to_room := Transform2D(to[1] - to[0], to[2] - to[0], to[0])
			entry["onto"] = to_room * from_space.affine_inverse()
			entry["row"] = int(door.row)
			entry["depth"] = float(door.depth)
			# The part of its cell the slab is drawn in: a little past its face either way, for its thickness.
			var onto: Transform2D = entry.onto
			var left: float = minf(corners[0].x, corners[1].x) - 10.0
			var right: float = maxf(corners[0].x, corners[1].x) + 10.0
			var box := Rect2(onto * Vector2(left, 0), Vector2.ZERO)
			for corner in [Vector2(right, 0), Vector2(right, 128), Vector2(left, 128)]:
				box = box.expand(onto * corner)
			entry["box"] = box
		doors.append(entry)


## Which of a door's sixteen pictures it shows: shut and green when shut, then one of the six sliding open by how far
## open it is.
static func door_picture(open: float) -> int:
	if open < 0.06:
		return 1
	return OPENING[mini(OPENING.size() - 1, int(floor(open * OPENING.size())))]
