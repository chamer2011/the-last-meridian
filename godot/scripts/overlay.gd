## What moves on a deck, drawn over its still picture: the player, and the doors between rooms, which slide open for
## whoever comes near. Each is put in order with whatever stands nearer the camera, which is drawn again over it, the
## way the browser view does it (draw in public/iso.js).
##
## Each of them has a small window of its own on the deck, just big enough for it. Inside that window it's drawn, and
## then everything of the deck's standing layer that's nearer the camera and reaches into the window, in order, kept
## to the window: so a wall in front of a door hides the door, and nothing outside the window is touched. The windows
## themselves go on from the back of the deck to the front.
class_name Overlay
extends Node2D

var art: DeckArt
var atlas: Texture2D

var _you: Prop
var _figure: FigureDraw
var _doors: Array[Prop] = []
var _covering := PackedInt32Array()


func setup(deck_art: DeckArt, the_atlas: Texture2D) -> void:
	art = deck_art
	atlas = the_atlas
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	var drawn: Array[Dictionary] = []
	for door in art.doors:
		if door.drawn:
			drawn.append(door)
	drawn.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.depth < b.depth)
	for door in drawn:
		var prop := Prop.new()
		prop.frame(door.box)
		prop.depth = door.depth
		var leaf := DoorDraw.new()
		leaf.door = door
		leaf.art = art
		leaf.atlas = atlas
		prop.hold(leaf)
		prop.cover(art.standing, atlas, _nearer(door.depth, door.box))
		add_child(prop)
		door["leaf"] = leaf
		_doors.append(prop)
	_you = Prop.new()
	_figure = FigureDraw.new()
	_you.hold(_figure)
	add_child(_you)


## The items of the standing layer that are nearer the camera than something and reach into its window, in the order
## they're drawn.
func _nearer(depth: float, box: Rect2) -> PackedInt32Array:
	var out := PackedInt32Array()
	var items := art.standing.items
	for i in items.size():
		var item := items[i]
		if item.depth > depth and not item.has("low") and box.intersects(item.box):
			out.append(i)
	return out


## Puts the player where they are, standing as they stand: { pos, flip, back, walking, step }.
func place_you(you: Dictionary) -> void:
	var where := Iso.centre(you.pos.x, you.pos.y)
	var feet := Iso.at(where.x, where.y)
	var depth := where.x + where.y
	# Room for the figure, the ring round their feet and their shadow.
	var box := Rect2(feet + Vector2(-0.3, -0.95) * Iso.UNIT, Vector2(0.6, 1.1) * Iso.UNIT)
	_you.frame(box)
	_you.depth = depth
	_figure.feet = feet
	_figure.who = {"look": Figure.YOU, "flip": you.flip, "back": you.back, "walking": you.walking, "step": you.step, "ring": Figure.YOUR_RING}
	_figure.queue_redraw()
	var nearer := _nearer(depth, box)
	if nearer != _covering:
		_covering = nearer
		_you.cover(art.standing, atlas, nearer)
	# Among the doors, from the back of the deck to the front.
	var rank := 0
	for prop in _doors:
		if prop.depth < depth:
			rank += 1
	if _you.get_index() != rank:
		move_child(_you, rank)


## A door has slid a little: it's drawn again.
func slide(door: Dictionary) -> void:
	if door.has("leaf"):
		(door.leaf as DoorDraw).queue_redraw()


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
			Figure.draw(self, feet, Iso.UNIT * Iso.PACK_FIGURE, who)
