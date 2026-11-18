## What a layer of a deck is drawn with. Everything a layer holds (plain shapes, and pictures cut from the atlas, some
## stretched onto a wall's face and some kept to a square) is gathered here as triangles in the order it's drawn, back
## to front, and handed to the graphics card as one mesh: a whole deck's floor is one stroke, and so is everything
## that stands on it.
##
## It does what the browser view's canvas does for public/pixel-art.js: a picture goes on with three of its points on
## three points of the room (cell), and can be kept inside a shape (clip).
class_name Pen
extends RefCounted

var verts := PackedVector2Array()
var uvs := PackedVector2Array()
var colors := PackedColorArray()
var indices := PackedInt32Array()
## The parts of the layer that can be drawn again on their own, over someone standing behind them: each
## { depth, box (Rect2, pixels), v0, v1, i0, i1 }.
var items: Array[Dictionary] = []

var _white := Vector2.ZERO
var _open := {}
var _finished := false


## white_spot: a white pixel of the atlas, which plain shapes are drawn from. Where things are on the atlas is kept in
## pixels until the atlas is finished and its size is known (finish).
func _init(white_spot: Vector2) -> void:
	_white = white_spot


## Everything drawn from here to end_item is one thing that stands in the room, so deep into it.
func begin_item(depth: float) -> void:
	_open = {"depth": depth, "v0": verts.size(), "i0": indices.size()}


## Ends it, and gives it back (empty if nothing was drawn).
func end_item() -> Dictionary:
	var item := _open
	_open = {}
	if item.is_empty():
		return {}
	item["v1"] = verts.size()
	item["i1"] = indices.size()
	if item.v1 <= item.v0:
		return {}
	var box := Rect2(verts[item.v0], Vector2.ZERO)
	for i in range(item.v0 + 1, item.v1):
		box = box.expand(verts[i])
	item["box"] = box
	items.append(item)
	return item


func _fan(count: int) -> void:
	var base := verts.size() - count
	for i in range(1, count - 1):
		indices.append(base)
		indices.append(base + i)
		indices.append(base + i + 1)


## A shape of one colour. Its corners go round it in order.
func poly(points: PackedVector2Array, color: Color) -> void:
	if points.size() < 3:
		return
	for p in points:
		verts.append(p)
		uvs.append(_white)
		colors.append(color)
	_fan(points.size())


## A shape whose colour changes from corner to corner.
func poly_shaded(points: PackedVector2Array, shades: PackedColorArray) -> void:
	if points.size() < 3:
		return
	for i in points.size():
		verts.append(points[i])
		uvs.append(_white)
		colors.append(shades[i])
	_fan(points.size())


## A line so many pixels wide.
func line(a: Vector2, b: Vector2, color: Color, wide := 1.0) -> void:
	var along := b - a
	if along.length_squared() < 0.0001:
		return
	var n := along.orthogonal().normalized() * wide * 0.5
	poly(PackedVector2Array([a + n, b + n, b - n, a - n]), color)


## A line through several points.
func polyline(points: PackedVector2Array, color: Color, wide := 1.0) -> void:
	for i in points.size() - 1:
		line(points[i], points[i + 1], color, wide)


## A filled oval, so wide and so high from its middle, turned by an angle.
func ellipse(middle: Vector2, rx: float, ry: float, color: Color, turned := 0.0, steps := 14) -> void:
	var points := PackedVector2Array()
	for i in steps:
		var a := TAU * i / steps
		points.append(middle + Vector2(cos(a) * rx, sin(a) * ry).rotated(turned))
	poly(points, color)


## A filled oval whose colour changes from its middle outwards: stops is [[how far out, 0 to 1, colour], ...], the
## first at the middle.
func glow(middle: Vector2, rx: float, ry: float, stops: Array, steps := 16) -> void:
	for s in range(1, stops.size()):
		var inner: float = stops[s - 1][0]
		var outer: float = stops[s][0]
		for i in steps:
			var a := TAU * i / steps
			var b := TAU * (i + 1) / steps
			var da := Vector2(cos(a) * rx, sin(a) * ry)
			var db := Vector2(cos(b) * rx, sin(b) * ry)
			poly_shaded(PackedVector2Array([middle + da * inner, middle + db * inner, middle + db * outer, middle + da * outer]), PackedColorArray([stops[s - 1][1], stops[s - 1][1], stops[s][1], stops[s][1]]))


## Part of the atlas (source, in pixels of a space whose corner is at origin on the atlas) drawn so that three points
## of that space (from) land on three points of the room (to). clip, if given, is a shape the picture is kept inside.
func cell(origin: Vector2, source: Rect2, from: Array, to: Array, clip := PackedVector2Array(), tint := Color.WHITE) -> void:
	var from_space := Transform2D(from[1] - from[0], from[2] - from[0], from[0])
	var to_room := Transform2D(to[1] - to[0], to[2] - to[0], to[0])
	if absf(from_space.determinant()) < 0.000001:
		return
	var onto := to_room * from_space.affine_inverse()
	var quad := PackedVector2Array([onto * source.position, onto * Vector2(source.end.x, source.position.y), onto * source.end, onto * Vector2(source.position.x, source.end.y)])
	var shape := quad if clip.is_empty() else _inside(quad, clip)
	if shape.size() < 3:
		return
	var back := onto.affine_inverse()
	for p in shape:
		verts.append(p)
		uvs.append(origin + back * p)
		colors.append(tint)
	_fan(shape.size())


## A picture at its own size (half its pixels, at 64 a tile), with a point of it (anchor, in its own pixels) on a
## point of the room; turned round if flip.
func picture(entry: Dictionary, anchor: Vector2, where: Vector2, flip := false, tint := Color.WHITE, clip := PackedVector2Array()) -> void:
	var turn := -0.5 if flip else 0.5
	var w: float = entry.w
	var h: float = entry.h
	var from := [Vector2.ZERO, Vector2(w, 0), Vector2(0, h)]
	var corner := where + Vector2(-turn * anchor.x, -0.5 * anchor.y)
	var to := [corner, corner + Vector2(turn * w, 0), corner + Vector2(0, 0.5 * h)]
	cell(entry.at, Rect2(0, 0, w, h), from, to, clip, tint)


## A shape cut down to what of it is inside another (both with their corners in order, the second with no dents).
static func _inside(shape: PackedVector2Array, clip: PackedVector2Array) -> PackedVector2Array:
	var out := shape
	# Which way round the clip's corners go.
	var area := 0.0
	for i in clip.size():
		var a := clip[i]
		var b := clip[(i + 1) % clip.size()]
		area += a.x * b.y - b.x * a.y
	var side := 1.0 if area >= 0.0 else -1.0
	for i in clip.size():
		var a := clip[i]
		var b := clip[(i + 1) % clip.size()]
		var edge := b - a
		var kept := PackedVector2Array()
		for j in out.size():
			var p := out[j]
			var q := out[(j + 1) % out.size()]
			var dp := edge.cross(p - a) * side
			var dq := edge.cross(q - a) * side
			if dp >= 0.0:
				kept.append(p)
			if (dp >= 0.0) != (dq >= 0.0):
				kept.append(p + (q - p) * (dp / (dp - dq)))
		out = kept
		if out.size() < 3:
			return PackedVector2Array()
	return out


## Once the atlas is whole: where things are on it, as shares of its size, which is how the graphics card counts.
func finish(atlas_size: Vector2) -> void:
	if _finished:
		return
	_finished = true
	for i in uvs.size():
		uvs[i] = uvs[i] / atlas_size


## The whole layer as a mesh.
func mesh() -> ArrayMesh:
	var out := ArrayMesh.new()
	if verts.is_empty():
		return out
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = indices
	out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return out
