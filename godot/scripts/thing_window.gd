## A thing's console window in the room, in its kind's colour, with its Actions window glued to its far side,
## sliding out from behind it the first time (style.css: .walk-thing-pane, .walk-thing-choices).
class_name ThingWindow
extends Floaty

signal acted(text: String)

const WIDTH := 300.0
const ACTIONS_WIDTH := 250.0

var p: Dictionary
var box: PanelContainer
var actions: PanelContainer
var _words: RichTextLabel
var _slide := 0.0


func build(kind_name: String) -> void:
	for c in get_children():
		c.queue_free()
	p = Pal.kind(kind_name)

	# The window itself.
	box = PanelContainer.new()
	box.add_theme_stylebox_override("panel", Pal.box(p.bg, p.c, 1, Color(p.c, 0.14), 16))
	box.custom_minimum_size.x = WIDTH
	box.mouse_filter = Control.MOUSE_FILTER_PASS
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	col.mouse_filter = Control.MOUSE_FILTER_PASS
	col.add_child(_title_bar("THE SOUP KETTLE", "THING"))
	_words = Pal.words(
		"A dented steel kettle the size of a barrel, bolted to the range. The soup in it has been on since the morning sitting: grey, thick, and still warm.\n\n[color=%s]Sittings left: 212 of 400. The next sitting is at 18:00.[/color]\n\n[color=%s]Scroll this text with the wheel: it runs on past the end and springs back, with no scroll bar.[/color]" % [Pal.hex(p.c), Pal.hex(p.dim)],
		p.bright)
	var scroll := SpringScroll.new(_words, 128)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 10 if side in ["left", "right"] else 8)
	pad.mouse_filter = Control.MOUSE_FILTER_PASS
	pad.add_child(scroll)
	col.add_child(pad)
	box.add_child(col)
	box.add_child(Pal.scanlines())

	# Its actions, glued to its right side.
	actions = PanelContainer.new()
	actions.add_theme_stylebox_override("panel", Pal.box(p.bg, p.c, 1, Color(p.c, 0.14), 16))
	actions.custom_minimum_size.x = ACTIONS_WIDTH
	actions.mouse_filter = Control.MOUSE_FILTER_PASS
	var acol := VBoxContainer.new()
	acol.add_theme_constant_override("separation", 0)
	acol.mouse_filter = Control.MOUSE_FILTER_PASS
	acol.add_child(_title_bar("ACTIONS", ""))
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 2)
	var lpad := MarginContainer.new()
	lpad.add_theme_constant_override("margin_left", 8)
	lpad.add_theme_constant_override("margin_right", 8)
	lpad.add_theme_constant_override("margin_top", 6)
	lpad.add_theme_constant_override("margin_bottom", 8)
	var rows := [["Look", ""], ["Eat a bowl", "a sitting"], ["Cook a pot", "1 h, Cooking"], ["Open", ""]]
	for i in rows.size():
		var row := OptionRow.new().setup(i, rows[i][0], rows[i][1], p)
		row.chosen.connect(_on_action)
		list.add_child(row)
	lpad.add_child(list)
	acol.add_child(lpad)
	actions.add_child(acol)
	actions.add_child(Pal.scanlines())

	add_child(actions)  # behind the window, so it slides out from under it
	add_child(box)
	_slide = 0.0
	actions.modulate.a = 0.0
	var t := create_tween()
	t.tween_interval(0.25)
	t.tween_property(self, "_slide", 1.0, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


func _title_bar(text: String, right: String) -> PanelContainer:
	var bar := PanelContainer.new()
	bar.add_theme_stylebox_override("panel", Pal.margins(Pal.box(p.c), 10, 2))
	bar.mouse_filter = Control.MOUSE_FILTER_PASS
	var row := HBoxContainer.new()
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var name_label := Pal.label(text, p.bg, 13, true)
	row.add_child(name_label)
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(gap)
	if right != "":
		row.add_child(Pal.label(right, p.bg, 12))
	bar.add_child(row)
	return bar


func _on_action(i: int) -> void:
	var said := ["You look the kettle over. Someone has scratched a tally of sittings into its side.",
		"You take a bowl. It tastes of salt and of the pot.",
		"Cooking takes an hour at the range (only a test here: nothing changes).",
		"It's soup. There's nothing in it to take."]
	_words.text = "[color=%s]%s[/color]" % [Pal.hex(p.c), said[i]]
	acted.emit(said[i])


func _process(delta: float) -> void:
	super._process(delta)
	if box == null:
		return
	box.size = Vector2(WIDTH, box.get_combined_minimum_size().y)
	actions.size = Vector2(ACTIONS_WIDTH, actions.get_combined_minimum_size().y)
	actions.position = Vector2(WIDTH - 1 - 28.0 * (1.0 - _slide), 0)
	actions.modulate.a = _slide
	size = Vector2(WIDTH + ACTIONS_WIDTH, max(box.size.y, actions.size.y))


## Where the line to the thing starts: the middle of the window's left side.
func anchor_point() -> Vector2:
	return global_position + Vector2(0, (box.size.y if box else 100.0) * 0.5)
