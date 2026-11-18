## What moves on a deck, drawn over its still picture: the player and everyone else, the doors between rooms, which
## slide open for whoever comes near, whoever's asleep in a bed, the ship's stores as the crates in them, flames, a
## hole in the hull, a camera turning on its bracket. Each is put in order with whatever stands nearer the camera,
## which is drawn again over it, the way the browser view does it (draw in public/iso.js).
##
## Each of them has a small window of its own on the deck, just big enough for it. Inside that window it's drawn, and
## then everything of the deck's standing layer that's nearer the camera and reaches into the window, in order, kept
## to the window: so a wall in front of a door hides the door, and nothing outside the window is touched. The windows
## themselves go on from the back of the deck to the front.
class_name Overlay
extends Node2D

## Which way someone sitting in a seat that faces each way is drawn: from behind or not, mirrored or not (FACING_POSE).
const FACING_POSE := {"n": [true, false], "s": [false, true], "e": [false, false], "w": [true, true]}
const BLANKETS := ["4a5a44", "3e4f66", "6a4a3a", "5a4f63", "4d5a5e"]
## What each kind of goods looks like stacked in a store (GOODS_LOOK): anything else is a plain brown crate.
const GOODS_LOOK := {
	"ration_crate": "7d6c48", "produce": "5f7d3c", "parts_crate": "5e6872", "medicine_crate": "cfcac0", "fuel_cell": "c99b3a",
	"grain": "c2a24e", "meal": "b8a67a", "kelp": "3f6a4c", "kelp_cake": "5a6f4a", "water": "4d7797", "drinking_water": "5f8fb0", "ice": "a9c6d6",
	"ore": "6a5648", "metal_stock": "7c8690", "scrap_load": "5b5550", "jump_fuel": "b8563a", "refined_fuel": "a8842e", "sour_gas": "8d8a3c",
	"beer_and_spirits": "6e4a32", "cloth": "8a84a0", "clothes": "6d6f8a", "night_flowers": "8f7aa8", "extracts": "7fa08c", "blood": "8c2f2f",
}
## The tile's width people are drawn by: as much smaller than the room's as the packs' furniture is beside the game's.
const FIGURE := Iso.UNIT * Iso.PACK_FIGURE

var art: DeckArt
var atlas: Texture2D
## Whoever the pointer's on, by their key ("you" for the player).
var hover := ""
## Where everyone drawn is on the deck's picture, for their names and for the pointer: key to { at, tall }.
var heads := {}
## Where everyone on their feet or sitting is, in tiles, for the doors.
var movers: Array[Vector2] = []

var _props: Array[Prop] = []
var _unsorted := false
var _you: Prop
var _figure: FigureDraw
var _covering := PackedInt32Array()
var _your_look := []
var _your_rest := {}
var _people := {}
var _rested := {}
var _beds := {}
var _stores := {}
var _lively: Array[Node2D] = []


func setup(deck_art: DeckArt, the_atlas: Texture2D, ways: Dictionary) -> void:
	art = deck_art
	atlas = the_atlas
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	for door in art.doors:
		if not door.drawn:
			continue
		var leaf := DoorDraw.new()
		leaf.door = door
		leaf.art = art
		leaf.atlas = atlas
		_stand(leaf, door.box, door.depth)
		door["leaf"] = leaf
	# The ship's stores, each as the crates and cells in it.
	for thing in art.stores:
		var crates := CratesDraw.new()
		crates.thing = thing
		var c := Iso.centre(int(thing.x), int(thing.y))
		_stand(crates, uv_box(int(thing.x), int(thing.y), int(thing.x) + 1, int(thing.y) + 1, 0.6), c.x + c.y + 0.001)
		_stores[str(thing.id)] = crates
	# What's burning, and a hole in the hull.
	for fire in art.scene.get("fires", []):
		var flames := FlameDraw.new()
		flames.fire = fire
		var c := Iso.centre(int(fire.x), int(fire.y))
		_stand(flames, uv_box(int(fire.x) - 1, int(fire.y), int(fire.x) + 2, int(fire.y) + 1, 1.3), c.x + c.y + 0.02)
		_lively.append(flames)
	for breach in art.scene.get("breaches", []):
		var hole := BreachDraw.new()
		hole.breach = breach
		var c := Iso.centre(int(breach.x), int(breach.y))
		_stand(hole, uv_box(int(breach.x), int(breach.y), int(breach.x) + 2, int(breach.y) + 2, 1.4), c.x + c.y + 0.4)
	# A camera that works turns on its bracket, slowly, each from its own place in the round.
	var turning: Array = ways.get("turning", []) if typeof(ways.get("turning")) == TYPE_ARRAY else []
	var frames: Array[Dictionary] = []
	for way in turning:
		frames.append(art.packs.want(way.picture) if typeof(way) == TYPE_DICTIONARY else {})
	for camera in art.cameras:
		var eye := CameraDraw.new()
		eye.camera = camera
		eye.frames = frames
		eye.atlas = atlas
		var where: Vector2 = camera.where
		_stand(eye, Rect2(where - Vector2(40, 30), Vector2(80, 60)), camera.depth)
		_lively.append(eye)
	_figure = FigureDraw.new()
	_you = _stand(_figure, Rect2(0, 0, 8, 8), 0.0, false)


## Puts something in a window of its own on the deck, so deep into it, with what's nearer the camera drawn over it.
func _stand(thing: Node2D, box: Rect2, depth: float, covered := true) -> Prop:
	var prop := Prop.new()
	prop.frame(box)
	prop.depth = depth
	prop.hold(thing)
	if covered:
		prop.cover(art.standing, atlas, art.nearer(depth, box))
	add_child(prop)
	_props.append(prop)
	_unsorted = true
	return prop


func _drop(prop: Prop) -> void:
	_props.erase(prop)
	prop.queue_free()


## The stretch of the picture a box on the floor covers, so many tiles high: squares across, rows down.
static func uv_box(x0: float, y0: float, x1: float, y1: float, z: float) -> Rect2:
	var box := Rect2(Iso.at(x0 * Iso.CELL_WIDTH, y0), Vector2.ZERO)
	for p in [Iso.at(x1 * Iso.CELL_WIDTH, y0), Iso.at(x1 * Iso.CELL_WIDTH, y1), Iso.at(x0 * Iso.CELL_WIDTH, y1), Iso.at(x0 * Iso.CELL_WIDTH, y0, z), Iso.at(x1 * Iso.CELL_WIDTH, y0, z), Iso.at(x1 * Iso.CELL_WIDTH, y1, z), Iso.at(x0 * Iso.CELL_WIDTH, y1, z)]:
		box = box.expand(p)
	return box


## A number as the game's own code would write it in words: 15, not 15.0.
static func plain(value: float) -> String:
	return str(int(value)) if is_equal_approx(value, round(value)) else str(value)


# ---- Sitting and lying ----------------------------------------------------------------------------------------------

## How someone who's stopped awake on a seat or a bed is drawn there (sittingIn): where (a chair's middle; their own
## place along a bench; the edge of a bed, on the side the camera sees) and sitting which way. over: whether the seat
## is drawn again over them (a chair seen from behind). Empty for anything else.
func _sitting_in(seat: Dictionary, where: Vector2) -> Dictionary:
	if seat.rest == "bed":
		var bed: Dictionary = seat.bed
		var head := float(bed.head)
		var places: Array = bed.places
		var top := (float(places[0].z) if not places.is_empty() else 0.3) + 0.08
		var pictured: bool = bed.pictured
		var along_y: bool = bed.run == "y"
		var wx := (float(bed.cx) + 0.3 if pictured else float(seat.x1) - 0.14) if along_y else clampf(where.x, float(bed.cx) - head, float(bed.cx) + head)
		var wy := clampf(where.y, float(bed.cy) - head, float(bed.cy) + head) if along_y else (float(bed.cy) + 0.34 if pictured else float(seat.y1) - 0.2)
		var facing: Array = FACING_POSE["e" if along_y else "s"]
		return {"at": Vector2(wx, wy), "raise": maxf(-0.25, top - 0.49), "back": facing[0], "flip": facing[1], "over": false, "bed": true}
	var facing_word: String = seat.get("facing", "s")
	var sideways := facing_word == "e" or facing_word == "w"
	var along := ""
	if seat.kind == "bench":
		along = "y" if sideways else "x"
	var pose: Array = FACING_POSE.get(facing_word, FACING_POSE.s)
	return {
		"at": Vector2(where.x if along == "x" else (float(seat.x0) + float(seat.x1)) / 2.0, where.y if along == "y" else (float(seat.y0) + float(seat.y1)) / 2.0),
		"raise": 0.07 if seat.kind == "command-chair" else 0.0,
		"back": pose[0],
		"flip": pose[1],
		"over": facing_word == "n" or facing_word == "w",
		"bed": false,
	}


## Where and how a figure is drawn: standing where they are, or, stopped on a seat or a bed, sitting in it.
func _settle(where: Vector2, walking: bool, flip: bool, back: bool, on: Variant = null) -> Dictionary:
	var out := {"at": where, "depth": where.x + where.y, "flip": flip, "back": back, "seated": false, "raise": 0.0, "seat": -1, "over": -1}
	if walking:
		return out
	var seat: Dictionary = on if on != null else art.resting_on(where)
	if seat.is_empty():
		return out
	var sitting := _sitting_in(seat, where)
	var at: Vector2 = sitting.at
	out.at = at
	out.seated = true
	out.raise = sitting.raise
	out.flip = sitting.flip
	out.back = sitting.back
	out.seat = int(seat.get("item", -1))
	# In a chair they're drawn just after it; on a bed's edge, by where they sit, in front of it.
	out.depth = at.x + at.y if sitting.bed else float(seat.depth) + 0.01
	if sitting.over:
		out.over = out.seat
	return out


func _covers(depth: float, box: Rect2, settled: Dictionary) -> PackedInt32Array:
	var nearer := art.nearer(depth, box, int(settled.seat))
	# A chair seen from behind is one picture, so all of it goes over whoever's sitting in it.
	if int(settled.over) >= 0:
		nearer.insert(0, int(settled.over))
	return nearer


static func _window(feet: Vector2) -> Rect2:
	# Room for the figure, the ring round their feet, their shadow, and the mark over someone who's down.
	return Rect2(feet + Vector2(-0.32, -1.02) * Iso.UNIT, Vector2(0.64, 1.18) * Iso.UNIT)


# ---- The player -----------------------------------------------------------------------------------------------------

## Puts the player where they are, as they are: { pos, flip, back, walking, step }.
func place_you(you: Dictionary) -> void:
	var where := Iso.centre(you.pos.x, you.pos.y)
	# Standing still, they're where they were: on the same seat, if on one.
	if _your_rest.is_empty() or _your_rest.where != where or you.walking:
		_your_rest = {"where": where, "settled": _settle(where, you.walking, you.flip, you.back)}
	var settled: Dictionary = _your_rest.settled
	var at: Vector2 = settled.at
	movers.clear()
	movers.append(at)
	var feet := Iso.at(at.x, at.y)
	heads.clear()
	heads["you"] = {"at": feet, "tall": FIGURE}
	var now := [feet, settled.flip, settled.back, you.walking, you.step if you.walking else 0.0, settled.seated, hover == "you"]
	if now == _your_look:
		return
	_your_look = now
	var box := _window(feet)
	_you.frame(box)
	if not is_equal_approx(_you.depth, settled.depth):
		_you.depth = settled.depth
		_unsorted = true
	_figure.feet = feet
	_figure.who = {"look": Figure.YOU, "flip": settled.flip, "back": settled.back, "walking": you.walking, "step": you.step, "ring": Figure.YOUR_RING, "seated": settled.seated, "raise": settled.raise}
	_figure.queue_redraw()
	var nearer := _covers(settled.depth, box, settled)
	if nearer != _covering:
		_covering = nearer
		_you.cover(art.standing, atlas, nearer)


# ---- Everyone else --------------------------------------------------------------------------------------------------

## Puts everyone where they've got to. shown: key to { x, y, walking, flip, back, step, look, person }, person being
## what the game says of them (asleep, down, carried and the rest). Whoever's asleep or laid up on a bed lies in it;
## whoever's stopped on a seat sits in it; whoever's down lies where they fell.
func place_people(shown: Dictionary) -> void:
	var in_beds := {}
	var here := {}
	for key in shown:
		var one: Dictionary = shown[key]
		var person: Dictionary = one.person
		var where := Iso.centre(one.x, one.y)
		var lying := Live.truthy(person.get("asleep")) or Live.truthy(person.get("down"))
		var down_mark := Live.truthy(person.get("down")) and not Live.truthy(person.get("onCot")) and not Live.truthy(person.get("carried")) and not Live.truthy(person.get("dead"))
		# Whoever hasn't moved since they were last looked at is where they were: in the same bed, on the same seat.
		var rested: Variant = _rested.get(key)
		if rested == null or rested.where != where or rested.lying != lying or one.walking:
			rested = {"where": where, "lying": lying, "on": {} if one.walking else art.resting_on(where), "settled": null}
			_rested[key] = rested
		if lying and not Live.truthy(person.get("carried")) and not one.walking:
			var bed: Dictionary = rested.on
			if not bed.is_empty() and bed.rest == "bed":
				var id := int(bed.item)
				if not in_beds.has(id):
					in_beds[id] = {"bed": bed, "sleepers": []}
				var sleepers: Array = in_beds[id].sleepers
				if sleepers.size() < (bed.bed.places as Array).size():
					sleepers.append({"key": key, "look": one.look, "mark": down_mark})
					continue
		here[key] = true
		var settled: Dictionary
		if lying:
			settled = {"at": where, "depth": where.x + where.y, "flip": one.flip, "back": one.back, "seated": false, "raise": 0.0, "seat": -1, "over": -1}
		else:
			if rested.settled == null or one.walking:
				rested.settled = _settle(where, one.walking, one.flip, one.back, rested.on)
			settled = rested.settled
			movers.append(settled.at)
		_show(key, one, settled, lying, down_mark)
	for key in _people.keys():
		if not here.has(key):
			_drop(_people[key].prop)
			_people.erase(key)
	for key in _rested.keys():
		if not shown.has(key):
			_rested.erase(key)
	_fill_beds(in_beds)
	if _unsorted:
		_sort()


func _show(key: String, one: Dictionary, settled: Dictionary, lying: bool, down_mark: bool) -> void:
	var at: Vector2 = settled.at
	var feet := Iso.at(at.x, at.y)
	heads[key] = {"at": feet, "tall": FIGURE * (0.5 if lying else 1.0)}
	var now := [feet, settled.flip, settled.back, one.walking, one.step if one.walking else 0.0, settled.seated, lying, down_mark, hover == key]
	var known: Variant = _people.get(key)
	if known != null and known.now == now:
		return
	var box := _window(feet)
	if known == null:
		var fresh := FigureDraw.new()
		known = {"draw": fresh, "prop": _stand(fresh, box, settled.depth, false), "covering": PackedInt32Array(), "now": []}
		_people[key] = known
	var prop: Prop = known.prop
	var figure: FigureDraw = known.draw
	known.now = now
	prop.frame(box)
	if not is_equal_approx(prop.depth, settled.depth):
		prop.depth = settled.depth
		_unsorted = true
	figure.feet = feet
	figure.who = {"look": one.look, "flip": settled.flip, "back": settled.back, "walking": one.walking, "step": one.step, "seated": settled.seated, "raise": settled.raise, "asleep": lying, "mark": down_mark, "ring": Figure.HOVER_RING if hover == key else null}
	figure.queue_redraw()
	var nearer := _covers(settled.depth, box, settled)
	if nearer != known.covering:
		known.covering = nearer
		prop.cover(art.standing, atlas, nearer)


## Whoever's asleep in each bed, drawn into it: a bed is in the deck's picture already.
func _fill_beds(in_beds: Dictionary) -> void:
	for id in in_beds:
		var bed: Dictionary = in_beds[id].bed
		var sleepers: Array = in_beds[id].sleepers
		sleepers.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.key) < str(b.key))
		var now := []
		for s in sleepers:
			now.append([s.key, s.mark, hover == s.key])
		var known: Variant = _beds.get(id)
		if known == null:
			var fresh := BedDraw.new()
			fresh.bed = bed
			var span: Dictionary = bed.span
			var box := Rect2(float(span.minU) * Iso.UNIT, float(span.minV) * Iso.UNIT, (float(span.maxU) - float(span.minU)) * Iso.UNIT, (float(span.maxV) - float(span.minV)) * Iso.UNIT).grow(Iso.UNIT * 0.3)
			var prop := _stand(fresh, box, float(bed.depth), false)
			# A bed with someone in it is drawn with them, never again over them.
			prop.cover(art.standing, atlas, art.nearer(float(bed.depth), box, id))
			known = {"draw": fresh, "prop": prop, "now": null}
			_beds[id] = known
		if known.now != now:
			known.now = now
			var lying: BedDraw = known.draw
			lying.sleepers = sleepers
			lying.hover = hover
			lying.queue_redraw()
		# Where each head is, for names.
		var places: Array = bed.bed.places
		for i in sleepers.size():
			var place: Dictionary = places[i]
			heads[sleepers[i].key] = {"at": Iso.at(float(place.wx), float(place.wy), float(place.z)), "tall": FIGURE * 0.5}
	for id in _beds.keys():
		if not in_beds.has(id):
			_drop(_beds[id].prop)
			_beds.erase(id)


## The windows in order, from the back of the deck to the front.
func _sort() -> void:
	_unsorted = false
	_props.sort_custom(func(a: Prop, b: Prop) -> bool: return a.depth < b.depth)
	for i in _props.size():
		if get_child(i) != _props[i]:
			move_child(_props[i], i)


## A door has slid a little: it's drawn again.
func slide(door: Dictionary) -> void:
	if door.has("leaf"):
		(door.leaf as DoorDraw).queue_redraw()


## How full the ship's stores are now, from the game's view of the room: each is stacked again if it's changed.
func take_stock(things: Array) -> void:
	for thing in things:
		var crates: Variant = _stores.get(str(thing.get("id", "")))
		if crates == null or typeof(thing.get("stock")) != TYPE_DICTIONARY:
			continue
		var draw: CratesDraw = crates
		if draw.thing.get("stock") != thing.stock:
			draw.thing["stock"] = thing.stock
			draw.queue_redraw()


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	for node in _lively:
		node.call("tick")


## One of those windows: what's in it, and what's nearer the camera over it.
class Prop:
	extends Control

	var depth := 0.0
	var _inside: Node2D
	var _over: CoverDraw

	func _init() -> void:
		clip_contents = true
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_inside = Node2D.new()
		add_child(_inside)

	## Where on the deck the window is, in the deck's own pixels. What's inside is drawn in the deck's own measure too.
	func frame(box: Rect2) -> void:
		position = box.position.floor()
		size = (box.end.ceil() - position)
		_inside.position = -position

	func hold(thing: Node2D) -> void:
		_inside.add_child(thing)
		_over = CoverDraw.new()
		_inside.add_child(_over)

	func cover(pen: Pen, atlas: Texture2D, which: PackedInt32Array) -> void:
		_over.gather(pen, atlas, which)


## Parts of the standing layer drawn again, as one stroke.
class CoverDraw:
	extends Node2D

	var points := PackedVector2Array()
	var uvs := PackedVector2Array()
	var colors := PackedColorArray()
	var indices := PackedInt32Array()
	var skin: Texture2D

	func gather(pen: Pen, atlas: Texture2D, which: PackedInt32Array) -> void:
		skin = atlas
		points = PackedVector2Array()
		uvs = PackedVector2Array()
		colors = PackedColorArray()
		indices = PackedInt32Array()
		for i in which:
			var item := pen.items[i]
			var base: int = points.size() - int(item.v0)
			points.append_array(pen.verts.slice(item.v0, item.v1))
			uvs.append_array(pen.uvs.slice(item.v0, item.v1))
			colors.append_array(pen.colors.slice(item.v0, item.v1))
			for j in range(item.i0, item.i1):
				indices.append(pen.indices[j] + base)
		queue_redraw()

	func _draw() -> void:
		if indices.is_empty():
			return
		RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), indices, points, colors, uvs, PackedInt32Array(), PackedFloat32Array(), skin.get_rid() if skin != null else RID())


## A door between rooms, at whichever of its sixteen pictures shows how far open it is.
class DoorDraw:
	extends Node2D

	var door: Dictionary
	var art: DeckArt
	var atlas: Texture2D

	func _draw() -> void:
		var picture := DeckArt.door_picture(door.open)
		draw_set_transform_matrix(door.onto)
		draw_texture_rect_region(atlas, DeckArt.CELL, Rect2(art.packs.doors_cell(picture % 8, int(door.row) + picture / 8), Vector2(128, 128)))
		draw_set_transform_matrix(Transform2D.IDENTITY)


class FigureDraw:
	extends Node2D

	var feet := Vector2.ZERO
	var who := {}

	func _draw() -> void:
		if not who.is_empty():
			Figure.draw(self, feet, Overlay.FIGURE, who)


## A plain box drawn straight onto a window: its side to the right, its side toward the camera, its top.
static func box_on(on: CanvasItem, x0: float, y0: float, x1: float, y1: float, z0: float, z1: float, top: Color, front: Color, side: Color) -> void:
	on.draw_colored_polygon(PackedVector2Array([Iso.at(x1, y0, z1), Iso.at(x1, y1, z1), Iso.at(x1, y1, z0), Iso.at(x1, y0, z0)]), side)
	on.draw_colored_polygon(PackedVector2Array([Iso.at(x0, y1, z1), Iso.at(x1, y1, z1), Iso.at(x1, y1, z0), Iso.at(x0, y1, z0)]), front)
	on.draw_colored_polygon(PackedVector2Array([Iso.at(x0, y0, z1), Iso.at(x1, y0, z1), Iso.at(x1, y1, z1), Iso.at(x0, y1, z1)]), top)


## Whoever's asleep in a bed (drawPackSleepers): each a head on the pillow and the rest of them under the bedding, or
## under a blanket of their own; under a pod's lid they're seen through it.
class BedDraw:
	extends Node2D

	var bed: Dictionary
	var sleepers: Array = []
	var hover := ""

	func _draw() -> void:
		var plan: Dictionary = bed.bed
		var u := Iso.UNIT
		var dice := Live.Dice.new("piece%s,%s" % [Overlay.plain(float(bed.x0)), Overlay.plain(float(bed.y0))])
		var pictured: bool = plan.pictured
		var r := u * (0.062 if pictured else 0.078)
		var wide := 0.1 if pictured else 0.14
		var along_y: bool = plan.run == "y"
		var long := float(plan.long)
		var places: Array = plan.places
		for i in places.size():
			# A colour for every place, so whoever's in the upper bed keeps theirs when the lower one's empty.
			var colour := Iso.scaled(Color(str(Overlay.BLANKETS[int(floor(dice.roll() * Overlay.BLANKETS.size()))])), 1.15)
			if i >= sleepers.size():
				continue
			var one: Dictionary = sleepers[i]
			var wx := float(places[i].wx)
			var wy := float(places[i].wy)
			var z := float(places[i].z)
			var x0 := wx - wide if along_y else wx + 0.1
			var y0 := wy + 0.1 if along_y else wy - wide
			var x1 := wx + wide if along_y else wx + long
			var y1 := wy + long if along_y else wy + wide
			var see := 0.5 if plan.under else 1.0
			if plan.blankets:
				Overlay.box_on(self, x0, y0, x1, y1, z, z + 0.07, Iso.see(Iso.scaled(colour, 1.12), see), Iso.see(colour, see), Iso.see(Iso.scaled(colour, 0.68), see))
			else:
				Overlay.box_on(self, x0, y0, x1, y1, z, z + 0.07, Color(1, 1, 1, 0.16 * see), Color(0, 0, 0, 0.2 * see), Color(0, 0, 0, 0.3 * see))
			var head := Iso.at(wx, wy, z + 0.09)
			var look: Dictionary = one.look
			draw_circle(head, r, Iso.see(look.skin, see))
			Figure._slice(self, head + Vector2(0, -r * 0.1), r * 1.02, PI * 0.95, PI * 2.05, Iso.see(look.hair, see))
			if hover == one.key:
				draw_arc(head, r * 1.8, 0.0, TAU, 24, Figure.HOVER_RING, 1.5, true)
			if one.mark:
				Figure.cross(self, head + Vector2(0, -12) * (u / 34.0), u / 34.0)


## One of the ship's stores as what's in it (drawStoreCrates): crates, or fuel cells standing up, on a pallet, as many
## as it's full.
class CratesDraw:
	extends Node2D

	var thing: Dictionary

	## What a store holds, slot by slot: up to twelve, two layers of six, shared among what it keeps by how much of
	## each it has, and at least one for anything there's any of (crateSlots).
	static func slots_of(stock: Variant, slots := 12) -> Array:
		var out := []
		if typeof(stock) != TYPE_DICTIONARY or typeof(stock.get("goods")) != TYPE_ARRAY:
			return out
		var of := 0.0
		for one in stock.goods:
			of += float(one.get("of", 0))
		if of <= 0.0:
			return out
		for one in stock.goods:
			var n := float(one.get("n", 0))
			var share := maxi(1, int(round(n / of * slots))) if n > 0.0 else 0
			for i in share:
				out.append(str(one.item))
		return out.slice(0, slots)

	func _draw() -> void:
		var x0 := int(thing.x) * Iso.CELL_WIDTH
		var y0 := float(int(thing.y))
		var pallet := Color("4c4030")
		Overlay.box_on(self, x0 + 0.02, y0 + 0.05, x0 + Iso.CELL_WIDTH - 0.02, y0 + 0.95, 0.0, 0.06, Iso.scaled(pallet, 1.12), pallet, Iso.scaled(pallet, 0.68))
		var slots := slots_of(thing.get("stock"))
		for i in slots.size():
			var item: String = slots[i]
			var layer := i / 6
			var row := (i % 6) / 2
			var col := i % 2
			var cx := x0 + 0.13 + col * 0.24
			var cy := y0 + 0.2 + row * 0.3
			var z := 0.06 + layer * 0.23
			var colour := Color(str(Overlay.GOODS_LOOK.get(item, "7a6a50")))
			if item == "fuel_cell":
				# A cell stands up, round.
				var foot := Iso.at(cx, cy, z)
				var head := Iso.at(cx, cy, z + 0.21)
				var rx := 0.07 * Iso.UNIT * sqrt(0.5)
				var ry := rx / 2.0
				var body := PackedVector2Array()
				var shade := PackedColorArray()
				for step in 9:
					var a := PI * step / 8.0
					body.append(foot + Vector2(cos(a) * rx, sin(a) * ry))
					shade.append(Iso.scaled(colour, 1.15).lerp(Iso.scaled(colour, 0.6), (1.0 + cos(a)) / 2.0))
				for step in 9:
					var a := PI * (8 - step) / 8.0
					body.append(head + Vector2(cos(a) * rx, sin(a) * ry))
					shade.append(Iso.scaled(colour, 1.15).lerp(Iso.scaled(colour, 0.6), (1.0 + cos(a)) / 2.0))
				draw_polygon(body, shade)
				draw_set_transform(head, 0.0, Vector2(1.0, 0.5))
				draw_circle(Vector2.ZERO, rx, Color("3a3228"))
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
				continue
			Overlay.box_on(self, cx - 0.1, cy - 0.13, cx + 0.1, cy + 0.13, z, z + 0.2, Iso.scaled(colour, 1.12), colour, Iso.scaled(colour, 0.68))
			# A strap across its top, or a red cross on a crate of medicine.
			var medicine := item == "medicine_crate"
			var mark := Color("c03a2c") if medicine else Color(0, 0, 0, 0.35)
			draw_line(Iso.at(cx - 0.1, cy, z + 0.201), Iso.at(cx + 0.1, cy, z + 0.201), mark, 1.0)
			if medicine:
				draw_line(Iso.at(cx, cy - 0.09, z + 0.201), Iso.at(cx, cy + 0.09, z + 0.201), mark, 1.0)


## A burning square (drawFlames): three tongues of flame, taller as the fire grows, never still.
class FlameDraw:
	extends Node2D

	var fire: Dictionary

	func tick() -> void:
		queue_redraw()

	func _draw() -> void:
		var now := float(Time.get_ticks_msec())
		var u := Iso.UNIT
		var c := Iso.centre(int(fire.x), int(fire.y))
		var seed_of := float(fire.get("seed", 0.0))
		var grow := 0.6 + minf(5.0, float(fire.get("size", 1))) * 0.12
		for i in 3:
			var phase := now / (170.0 + i * 37.0) + seed_of * 40.0 + i * 2.1
			var flicker := 0.78 + 0.22 * sin(phase) * sin(phase * 1.7)
			var p := Iso.at(c.x + (i - 1) * 0.11 + sin(phase * 0.5) * 0.02, c.y + (i % 2) * 0.14 - 0.07, 0.0)
			var high := u * 0.42 * grow * flicker * (1.2 if i == 1 else 0.85)
			var wide := u * 0.085 * grow
			for tongue in [[1.0, Color("ff9a3c") if i == 1 else Color("f0682a")], [0.5, Color("ffe27a")]]:
				var part: float = tongue[0]
				var left := p + Vector2(-wide * part, 0)
				var right := p + Vector2(wide * part, 0)
				var tip := p + Vector2(0, -high * (1.0 if part == 1.0 else 0.6))
				var bend_left := p + Vector2(-wide * part * 0.9, -high * part * 0.6)
				var bend_right := p + Vector2(wide * part * 0.9, -high * part * 0.6)
				var shape := PackedVector2Array()
				for step in 7:
					var t := step / 6.0
					shape.append(left.lerp(bend_left, t).lerp(bend_left.lerp(tip, t), t))
				for step in range(1, 7):
					var t := step / 6.0
					shape.append(tip.lerp(bend_right, t).lerp(bend_right.lerp(right, t), t))
				# From the middle of its foot, every point of it can be seen.
				for step in shape.size() - 1:
					draw_colored_polygon(PackedVector2Array([p, shape[step], shape[step + 1]]), tongue[1])


## A hole torn in the hull (drawBreachHole): a ragged black mouth on the wall, rimed white round its edge.
class BreachDraw:
	extends Node2D

	var breach: Dictionary

	func _draw() -> void:
		var east: bool = breach.get("face", "s") == "e"
		var x := int(breach.x)
		var y := int(breach.y)
		var middle := Vector3((x + 1) * Iso.CELL_WIDTH + 0.004, y + 0.5, 0.85) if east else Vector3((x + 0.5) * Iso.CELL_WIDTH, y + 1.004, 0.85)
		var dice := Live.Dice.new("breach%d,%d" % [x, y])
		var points := PackedVector2Array()
		for i in 12:
			var angle := TAU * i / 12.0
			var reach := (0.12 if i % 2 == 1 else 0.24) + dice.roll() * 0.06
			var side := cos(angle) * reach * (1.5 if east else 0.75)
			points.append(Iso.at(middle.x + (0.0 if east else side), middle.y + (side if east else 0.0), middle.z + sin(angle) * reach * 1.2))
		var centre := Iso.at(middle.x, middle.y, middle.z)
		for i in 12:
			draw_colored_polygon(PackedVector2Array([centre, points[i], points[(i + 1) % 12]]), Color("010203"))
		points.append(points[0])
		draw_polyline(points, Color(225 / 255.0, 236 / 255.0, 242 / 255.0, 0.7), 1.5, true)


## The pack's camera at one of its sixteen turns, with its red light on its body.
class CameraDraw:
	extends Node2D

	var camera: Dictionary
	var frames: Array[Dictionary] = []
	var atlas: Texture2D
	var _shown := -1

	func tick() -> void:
		var now := Time.get_ticks_msec()
		var frame := int(floor(now / 420.0 + float(camera.seed))) % 16
		var blink := int(floor(now / 700.0 + float(camera.x))) % 2 == 0
		var state := frame * 2 + (1 if blink else 0)
		if state != _shown:
			_shown = state
			queue_redraw()

	func _draw() -> void:
		var frame := maxi(0, _shown / 2)
		var entry: Dictionary = frames[frame] if frame < frames.size() else {}
		if entry.is_empty() and not frames.is_empty():
			entry = frames[0]
		var where: Vector2 = camera.where
		if not entry.is_empty():
			var anchor: Vector2 = camera.anchor
			var turn := -0.5 if camera.flip else 0.5
			draw_set_transform(where + Vector2(-turn * anchor.x, -0.5 * anchor.y), 0.0, Vector2(turn, 0.5))
			draw_texture_rect_region(atlas, Rect2(0, 0, entry.w, entry.h), Rect2(entry.at, Vector2(entry.w, entry.h)))
			draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		draw_circle(camera.light, maxf(1.2, Iso.UNIT * 0.014), Color("ff3020") if _shown % 2 == 1 else Color("5a1810"))
