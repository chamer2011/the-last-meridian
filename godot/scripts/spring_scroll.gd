## Scrolling with no scroll bar, that runs on a little past the top or the bottom and springs back
## (public/spring.js in the game).
class_name SpringScroll
extends Control

const OVERRUN := 40.0

var content: Control
var pos := 0.0
var vel := 0.0


func _init(child: Control, height: float) -> void:
	content = child
	clip_contents = true
	custom_minimum_size = Vector2(0, height)
	mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(child)


func _content_height() -> float:
	if content is RichTextLabel:
		return (content as RichTextLabel).get_content_height()
	return content.get_combined_minimum_size().y


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			vel += 700.0
			accept_event()
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			vel -= 700.0
			accept_event()


func _process(delta: float) -> void:
	content.size.x = size.x
	var h := _content_height()
	content.size.y = h
	var most: float = max(0.0, h - size.y)
	pos += vel * delta
	vel *= exp(-9.0 * delta)
	var pull := 1.0 - exp(-14.0 * delta)
	if pos < 0.0:
		pos += -pos * pull
		pos = max(pos, -OVERRUN)
	elif pos > most:
		pos += (most - pos) * pull
		pos = min(pos, most + OVERRUN)
	content.position.y = -pos
