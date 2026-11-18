## Words painted along a deck: on the floor (the rooms' names), along a wall, or on top of something. Each is
## { text, at, size, color, upright, length }, as paintWords in public/iso.js takes them.
class_name Words
extends Node2D

var items: Array[Dictionary] = []


func _draw() -> void:
	var font := Pal.MONO_BOLD
	for item in items:
		var size := maxi(6, int(round(item.size)))
		var text: String = item.text
		var across := 1.0
		# Words on a wall are fitted to the squares they're written on, and never stretched far.
		if int(item.length) > 0:
			var wide := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
			across = minf(item.length * Iso.CELL_WIDTH * Iso.UNIT * 0.5 * 0.92 / maxf(1.0, wide), 1.1)
		var down := Vector2(0, 1) if item.upright else Vector2(-0.72, 0.36)
		draw_set_transform_matrix(Transform2D(Vector2(across, across * 0.5), down, item.at))
		draw_string(font, Vector2(0, (font.get_ascent(size) - font.get_descent(size)) / 2.0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, item.color)
	draw_set_transform_matrix(Transform2D.IDENTITY)
