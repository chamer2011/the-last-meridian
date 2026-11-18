## The raised or sunken edge of Keelworks' panels and buttons (desktop.css: .os .bev and .os .sunk):
## light on the top and left, dark on the bottom and right, or the other way round when sunken.
class_name Bevel
extends Control

var skin: Dictionary
var sunk := false
var fill_with_field := false


func setup(s: Dictionary, is_sunk := false, field := false) -> Bevel:
	skin = s
	sunk = is_sunk
	fill_with_field = field
	return self


func _draw() -> void:
	var w := size.x
	var h := size.y
	draw_rect(Rect2(0, 0, w, h), skin.field if fill_with_field else skin.face)
	var a: Color = skin.lo if sunk else skin.hi
	var b: Color = skin.hi if sunk else skin.dark
	draw_line(Vector2(0, 0.5), Vector2(w, 0.5), a)
	draw_line(Vector2(0.5, 0), Vector2(0.5, h), a)
	draw_line(Vector2(0, h - 0.5), Vector2(w, h - 0.5), b)
	draw_line(Vector2(w - 0.5, 0), Vector2(w - 0.5, h), b)
	var inner: Color = skin.dark if sunk else skin.lo
	if sunk:
		draw_line(Vector2(1, 1.5), Vector2(w - 1, 1.5), inner)
		draw_line(Vector2(1.5, 1), Vector2(1.5, h - 1), inner)
	else:
		draw_line(Vector2(1, h - 1.5), Vector2(w - 1, h - 1.5), inner)
		draw_line(Vector2(w - 1.5, 1), Vector2(w - 1.5, h - 1), inner)
