## A window floating over the room that can be pulled aside with the mouse and slides back when let go,
## the way the game's windows do (public/pull.js, .pullable.springing in style.css: .32 s with a little overshoot).
class_name Floaty
extends Control

var home := Vector2.ZERO
var pull := Vector2.ZERO
var springs_back := true

var _dragging := false
var _from := Vector2.ZERO
var _tween: Tween


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS


func _process(_delta: float) -> void:
	position = home + pull


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		_dragging = true
		_from = get_global_mouse_position() - pull
		if _tween:
			_tween.kill()


func _input(event: InputEvent) -> void:
	if not _dragging:
		return
	if event is InputEventMouseMotion:
		pull = get_global_mouse_position() - _from
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		_dragging = false
		if springs_back:
			_tween = create_tween()
			_tween.tween_property(self, "pull", Vector2.ZERO, 0.32).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func dragging() -> bool:
	return _dragging
