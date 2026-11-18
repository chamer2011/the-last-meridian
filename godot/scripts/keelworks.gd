## The Keelworks 4.1 desktop at 640 by 480, in one of its three skins (desktop.css: .os and data-desk-skin).
## Its window can be dragged by its title bar, inside the screen, like a real desktop.
class_name Keelworks
extends Control

const SKINS := {
	"grey": {"desk": "2e6a6c", "face": "c3c3c3", "hi": "ffffff", "lo": "808080", "dark": "000000", "t1": "0b2a6b", "t2": "3a7bd5",
		"tt": "ffffff", "tx": "000000", "field": "ffffff", "dim": "5e5e5e", "sel": "0b2a6b", "icon": "ffffff"},
	"slate": {"desk": "1b262e", "face": "a9b2ba", "hi": "e9eef2", "lo": "5d6872", "dark": "161b20", "t1": "1d2b38", "t2": "4f7393",
		"tt": "ffffff", "tx": "0c1116", "field": "eef2f5", "dim": "4d5761", "sel": "2d4a63", "icon": "ffffff"},
	"phosphor": {"desk": "020b05", "face": "071a0d", "hi": "4fc46e", "lo": "1d5a2c", "dark": "000000", "t1": "134a22", "t2": "2a8c45",
		"tt": "c9ffd8", "tx": "8ff0a8", "field": "031107", "dim": "3f8f57", "sel": "2a8c45", "icon": "8ff0a8"},
}

var skin: Dictionary
var win: Control
var _drag := false
var _from := Vector2.ZERO
var _clock: Label


func build(skin_name: String) -> void:
	for c in get_children():
		c.queue_free()
	skin = {}
	for k in SKINS[skin_name]:
		skin[k] = Color(SKINS[skin_name][k])
	size = Vector2(640, 480)

	var desk := ColorRect.new()
	desk.color = skin.desk
	desk.size = size
	add_child(desk)
	if skin_name == "slate":
		var mark := _text("HALDEN YARDS", Color(1, 1, 1, 0.05), 30, true)
		mark.position = Vector2(330, 400)
		add_child(mark)

	var names := ["Charts", "Ship's log", "Mail", "Rig (D:)"]
	for i in names.size():
		var icon := _icon(names[i], i)
		icon.position = Vector2(6, 6 + i * 64)
		add_child(icon)

	win = _window("Ship's log - NAVCOM 7", Vector2(150, 52), Vector2(410, 300))
	add_child(win)

	var bar := Bevel.new().setup(skin)
	bar.position = Vector2(0, 452)
	bar.size = Vector2(640, 28)
	add_child(bar)
	var start := _button("Keel", true)
	start.position = Vector2(3, 455)
	start.size = Vector2(60, 22)
	add_child(start)
	var task := _button("Ship's log", false)
	task.position = Vector2(68, 455)
	task.size = Vector2(150, 22)
	add_child(task)
	var tray := Bevel.new().setup(skin, true)
	tray.position = Vector2(540, 455)
	tray.size = Vector2(97, 22)
	add_child(tray)
	var eye := _text("\u25c9", skin.tx, 12)
	eye.position = Vector2(548, 458)
	add_child(eye)
	_clock = _text("09:30", skin.tx, 12)
	_clock.position = Vector2(590, 458)
	add_child(_clock)


func _text(t: String, c: Color, s := 12, bold := false) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_color_override("font_color", c)
	l.add_theme_font_size_override("font_size", s)
	if bold:
		l.add_theme_font_override("font", Pal.MONO_BOLD)
	else:
		l.add_theme_font_override("font", _os_font())
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static var _font: SystemFont


## The desktop's own font, as desktop.css asks for it: Tahoma first, then the nearest the computer has.
static func _os_font() -> Font:
	if _font == null:
		_font = SystemFont.new()
		_font.font_names = PackedStringArray(["Tahoma", "Verdana", "Segoe UI", "DejaVu Sans", "Sans-Serif"])
		_font.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	return _font


func _button(t: String, bold: bool) -> Control:
	var b := Bevel.new().setup(skin)
	var l := _text(t, skin.tx, 12, bold)
	l.position = Vector2(8, 3)
	b.add_child(l)
	return b


func _icon(name: String, kind: int) -> Control:
	var c := Control.new()
	c.size = Vector2(76, 60)
	var pic := Control.new()
	pic.position = Vector2(22, 0)
	pic.size = Vector2(32, 32)
	pic.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sk := skin
	pic.draw.connect(func():
		match kind:
			0:  # a chart
				pic.draw_rect(Rect2(2, 4, 28, 24), Color("0a1d3a"))
				pic.draw_rect(Rect2(2, 4, 28, 24), sk.hi, false)
				pic.draw_circle(Vector2(10, 12), 2, Color("f5d76e"))
				pic.draw_circle(Vector2(22, 20), 2, Color("76ecd2"))
				pic.draw_line(Vector2(10, 12), Vector2(22, 20), Color("8ab8ff"))
			1, 3:  # a folder
				pic.draw_rect(Rect2(2, 6, 12, 5), Color("e0b84a"))
				pic.draw_rect(Rect2(2, 9, 28, 19), Color("f5d76e"))
				pic.draw_rect(Rect2(2, 9, 28, 19), Color("7a5c12"), false)
			2:  # a letter
				pic.draw_rect(Rect2(3, 8, 26, 18), Color("f4f4f4"))
				pic.draw_rect(Rect2(3, 8, 26, 18), Color("555555"), false)
				pic.draw_line(Vector2(3, 8), Vector2(16, 18), Color("555555"))
				pic.draw_line(Vector2(29, 8), Vector2(16, 18), Color("555555"))
	)
	c.add_child(pic)
	var l := _text(name, skin.icon, 11)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.size = Vector2(76, 16)
	l.position = Vector2(0, 36)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 1))
	l.add_theme_constant_override("shadow_offset_x", 1)
	l.add_theme_constant_override("shadow_offset_y", 1)
	c.add_child(l)
	return c


func _window(title: String, at: Vector2, s: Vector2) -> Control:
	var w := Bevel.new().setup(skin)
	w.position = at
	w.size = s
	var grad := Gradient.new()
	grad.set_color(0, skin.t1)
	grad.set_color(1, skin.t2)
	var tex := GradientTexture2D.new()
	tex.gradient = grad
	tex.width = 64
	tex.height = 1
	var bar := TextureRect.new()
	bar.texture = tex
	bar.stretch_mode = TextureRect.STRETCH_SCALE
	bar.position = Vector2(3, 3)
	bar.size = Vector2(s.x - 6, 18)
	bar.mouse_default_cursor_shape = Control.CURSOR_MOVE
	bar.gui_input.connect(_on_title_input)
	w.add_child(bar)
	var t := _text(title, skin.tt, 12, true)
	t.position = Vector2(8, 4)
	w.add_child(t)
	var x := _button("x", true)
	x.position = Vector2(s.x - 22, 5)
	x.size = Vector2(16, 14)
	(x.get_child(0) as Label).position = Vector2(4, -2)
	w.add_child(x)

	var menu := _text("File    Edit    View    Help", skin.tx, 12)
	menu.position = Vector2(8, 24)
	w.add_child(menu)

	var field := Bevel.new().setup(skin, true, true)
	field.position = Vector2(6, 44)
	field.size = Vector2(s.x - 12, s.y - 72)
	w.add_child(field)
	var lines := [
		["06:00", "Watch change. Lt. Sorel relieves Lt. Pell."],
		["06:12", "Junction box JB-3 reports a fault."],
		["07:30", "Second sitting. 212 left in the kettle."],
		["08:41", "Door to The Armory opened (code)."],
		["09:02", "SENTRY: unknown session on the relay."],
		["09:17", "Alarm on deck 1."],
	]
	for i in lines.size():
		var row := _text(lines[i][0] + "   " + lines[i][1], skin.tx, 12)
		if i == 5:
			row.add_theme_color_override("font_color", Color("b40000") if skin.desk != Color("020b05") else Color("f2c14e"))
		row.position = Vector2(12, 50 + i * 20)
		w.add_child(row)

	var status := _text("6 entries      Drag this window by its title bar", skin.dim, 11)
	status.position = Vector2(8, s.y - 22)
	w.add_child(status)
	return w


func _on_title_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		_drag = event.pressed
		_from = get_local_mouse_position() - win.position
	elif event is InputEventMouseMotion and _drag:
		var to := get_local_mouse_position() - _from
		win.position = Vector2(clamp(to.x, -win.size.x + 60, 640 - 60), clamp(to.y, 0, 452 - 24))
