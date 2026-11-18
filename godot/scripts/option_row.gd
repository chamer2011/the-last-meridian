## One line of a list of choices: its number, what it does and what it costs, with the number and the cost dim,
## turned inside out on hover (style.css: .walk-thing-choices .options button).
class_name OptionRow
extends PanelContainer

signal chosen(index: int)

var index := 0
var _p: Dictionary
var _num := ""
var _label := ""
var _detail := ""
var _words: RichTextLabel
var _hover := false


func setup(i: int, label: String, detail: String, p: Dictionary, size := 14) -> OptionRow:
	index = i
	_p = p
	_num = "%d" % (i + 1)
	_label = label
	_detail = detail
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_words = Pal.words("", p.bright, size)
	_words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_words)
	mouse_entered.connect(func(): _hover = true; _paint())
	mouse_exited.connect(func(): _hover = false; _paint())
	_paint()
	return self


func _paint() -> void:
	var num_c: Color = _p.bg if _hover else _p.dim
	var lab_c: Color = _p.bg if _hover else _p.bright
	var t := "[color=%s]%s[/color]  [color=%s]%s[/color]" % [Pal.hex(num_c), _num, Pal.hex(lab_c), _label]
	if _detail != "":
		t += "  [color=%s]%s[/color]" % [Pal.hex(num_c), _detail]
	_words.text = t
	add_theme_stylebox_override("panel", Pal.margins(Pal.box(_p.c if _hover else Color(0, 0, 0, 0)), 4, 2))


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		chosen.emit(index)
		accept_event()
