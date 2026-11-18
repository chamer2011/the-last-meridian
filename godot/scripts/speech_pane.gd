## What someone says, on a bracketed pane by their head: four corners, a tag with their name, the words typed out,
## and the choices hanging off its side once the words are all there (style.css: .pop-pane, .pop-corner, .pop-tag,
## .pop-choices; the opening animation is pop-slide-out, then pop-snap for the corners).
class_name SpeechPane
extends Floaty

const WIDTH := 340.0
const CHOICES_WIDTH := 290.0
const LETTERS_A_SECOND := 45.0

var speaker := Color("8ec5ff")
var p: Dictionary
var green: Dictionary
var pane: PanelContainer
var deco: Control
var tag: PanelContainer
var choices: PanelContainer
var _words: RichTextLabel
var _hint: Label
var _shown := 0.0
var _choices_in := 0.0
var _open := 0.0
var _snap := 0.0
var _turn := 0

const LINES := [
	"Six of them came up the forward stair, Captain. More on the aft. Sorel's holding comms, but he won't hold it long.",
	"I don't know yet. Whoever it is had the armory's code.",
	"Then do it quickly. I'll keep the door.",
	"Understood.",
]


func build() -> void:
	p = Pal.person(speaker)
	green = Pal.kind("green")

	pane = PanelContainer.new()
	var s := Pal.box(Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.84), Color(0, 0, 0, 0), 0, Color(0, 0, 0, 0.55), 18)
	s.shadow_offset = Vector2(0, 10)
	pane.add_theme_stylebox_override("panel", s)
	pane.custom_minimum_size.x = WIDTH
	pane.mouse_filter = Control.MOUSE_FILTER_PASS
	pane.gui_input.connect(_on_pane_input)
	var col := VBoxContainer.new()
	col.mouse_filter = Control.MOUSE_FILTER_PASS
	var wpad := MarginContainer.new()
	wpad.add_theme_constant_override("margin_left", 12)
	wpad.add_theme_constant_override("margin_right", 12)
	wpad.add_theme_constant_override("margin_top", 14)
	wpad.add_theme_constant_override("margin_bottom", 4)
	wpad.mouse_filter = Control.MOUSE_FILTER_PASS
	_words = Pal.words("", p.c, 14)
	wpad.add_child(_words)
	col.add_child(wpad)
	var hpad := MarginContainer.new()
	hpad.add_theme_constant_override("margin_left", 12)
	hpad.add_theme_constant_override("margin_right", 12)
	hpad.add_theme_constant_override("margin_bottom", 6)
	hpad.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hint = Pal.label("click to read on", p.dim, 12)
	hpad.add_child(_hint)
	col.add_child(hpad)
	pane.add_child(col)

	deco = Control.new()
	deco.mouse_filter = Control.MOUSE_FILTER_IGNORE
	deco.draw.connect(_draw_corners)

	tag = PanelContainer.new()
	tag.add_theme_stylebox_override("panel", Pal.margins(Pal.box(speaker), 6, 0))
	tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var trow := HBoxContainer.new()
	trow.add_theme_constant_override("separation", 10)
	trow.add_child(Pal.label("FIRST OFFICER VOSS", Pal.BG, 11, true))
	trow.add_child(Pal.label("at the helm", Pal.BG, 11))
	tag.add_child(trow)

	choices = PanelContainer.new()
	var cs := Pal.box(Color(3 / 255.0, 17 / 255.0, 10 / 255.0, 0.88), Color(0, 0, 0, 0), 0, Color(0, 0, 0, 0.55), 18)
	cs.shadow_offset = Vector2(0, 10)
	choices.add_theme_stylebox_override("panel", Pal.margins(cs, 8, 8))
	choices.custom_minimum_size.x = CHOICES_WIDTH
	choices.mouse_filter = Control.MOUSE_FILTER_PASS

	add_child(pane)
	add_child(deco)
	add_child(tag)
	add_child(choices)
	_say(LINES[0], "")
	_open = 0.0
	_snap = 0.0
	var t := create_tween()
	t.tween_interval(0.12)
	t.tween_property(self, "_open", 1.0, 0.2).set_ease(Tween.EASE_OUT)
	t.tween_property(self, "_snap", 1.0, 0.22).set_ease(Tween.EASE_OUT)


func _say(line: String, player_line: String) -> void:
	var t := ""
	if player_line != "":
		t = "[color=%s]> %s[/color]\n\n" % [Pal.hex(p.bright), player_line]
	t += "\u201c%s\u201d" % line
	_words.text = t
	_words.visible_characters = player_line.length() + 4 if player_line != "" else 0
	_shown = float(_words.visible_characters)
	_choices_in = 0.0
	_fill_choices()


func _fill_choices() -> void:
	for c in choices.get_children():
		c.queue_free()
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 2)
	var rows: Array
	if _turn == 0:
		rows = [["\u201cWho's leading them?\u201d", ""], ["\u201cHold the bridge. I'm going down.\u201d", ""], ["Talk them down over the speakers", "Persuasion, hard"]]
	else:
		rows = [["Start again", ""]]
	for i in rows.size():
		var row := OptionRow.new().setup(i, rows[i][0], rows[i][1], green, 13)
		row.chosen.connect(_on_choice)
		list.add_child(row)
	choices.add_child(list)


func _on_choice(i: int) -> void:
	if _turn > 0:
		_turn = 0
		_say(LINES[0], "")
		return
	_turn = 1
	var said := ["Who's leading them?", "Hold the bridge. I'm going down.", "Let me talk to them over the speakers."]
	_say(LINES[1 + min(i, 2)] if i < 2 else LINES[3], said[i])


func _on_pane_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		_shown = float(_words.get_total_character_count())


func _process(delta: float) -> void:
	super._process(delta)
	if pane == null:
		return
	var total := _words.get_total_character_count()
	if _shown < total:
		_shown = min(float(total), _shown + LETTERS_A_SECOND * delta)
		_words.visible_characters = int(_shown)
	elif _choices_in < 1.0:
		_choices_in = min(1.0, _choices_in + delta / 0.22)
	_hint.text = "click to read on" if _shown < total else ""

	pane.size = Vector2(WIDTH, pane.get_combined_minimum_size().y)
	pane.pivot_offset = Vector2(0, pane.size.y)
	pane.scale = Vector2.ONE * lerp(0.3, 1.0, _open)
	pane.modulate.a = _open
	deco.size = pane.size
	deco.pivot_offset = pane.size * 0.5
	deco.scale = Vector2.ONE * lerp(1.8, 1.0, _snap)
	deco.modulate.a = _snap
	deco.queue_redraw()
	tag.size = tag.get_combined_minimum_size()
	tag.position = Vector2(12, -8)
	tag.modulate.a = _open
	choices.size = Vector2(CHOICES_WIDTH, choices.get_combined_minimum_size().y)
	choices.position = Vector2(WIDTH + 12 - 16.0 * (1.0 - _choices_in), 0)
	choices.modulate.a = _choices_in
	choices.mouse_filter = Control.MOUSE_FILTER_PASS if _choices_in > 0.5 else Control.MOUSE_FILTER_IGNORE
	size = Vector2(WIDTH + 12 + CHOICES_WIDTH, pane.size.y)


func _draw_corners() -> void:
	var w := deco.size.x
	var h := deco.size.y
	var c := speaker
	var k := 11.0
	var o := -1.0
	for corner in [[Vector2(o, o), Vector2(1, 0), Vector2(0, 1)], [Vector2(w - o, o), Vector2(-1, 0), Vector2(0, 1)],
			[Vector2(o, h - o), Vector2(1, 0), Vector2(0, -1)], [Vector2(w - o, h - o), Vector2(-1, 0), Vector2(0, -1)]]:
		var at: Vector2 = corner[0]
		deco.draw_line(at, at + corner[1] * k, c, 2.0)
		deco.draw_line(at, at + corner[2] * k, c, 2.0)


## Where the line to the speaker's head starts: the bottom of the pane, a little in from the left.
func anchor_point() -> Vector2:
	return global_position + Vector2(40, pane.size.y if pane else 100.0)
