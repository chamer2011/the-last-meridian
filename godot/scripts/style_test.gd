## The style test: a stand-in room with a thing's console window and someone's speech pane over it,
## and the Keelworks monitor beside it, all in the game's own colours, font and scanlines.
## Buttons along the top switch the window between 1400 and 810 wide, the thing's colour, and the monitor's look.
##
## For checking without a screen: godot --path . -- --shot=out.png [--width=810] [--view=computer]
##   [--kind=teal] [--skin=phosphor] [--crt=heavy] [--wait=2.5]
extends Control

var room: Control
var thing: ThingWindow
var speech: SpeechPane
var desk: CrtDesk
var top: HFlowContainer
var leaders: Control
var view := "room"          # at narrow widths only one of the two shows: "room" or "computer"
var kind := "gold"
var skin := "grey"
var crt := "light"
var _narrow_buttons: Array[Button] = []


func _ready() -> void:
	var args := _args()
	kind = args.get("kind", kind)
	skin = args.get("skin", skin)
	crt = args.get("crt", crt)
	view = args.get("view", view)

	var bg := ColorRect.new()
	bg.color = Pal.BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	room = Control.new()
	room.mouse_filter = Control.MOUSE_FILTER_IGNORE
	room.draw.connect(_draw_room)
	add_child(room)

	leaders = Control.new()
	leaders.mouse_filter = Control.MOUSE_FILTER_IGNORE
	leaders.set_anchors_preset(Control.PRESET_FULL_RECT)
	leaders.draw.connect(_draw_leaders)
	add_child(leaders)

	speech = SpeechPane.new()
	add_child(speech)
	speech.build()
	thing = ThingWindow.new()
	add_child(thing)
	thing.build(kind)
	desk = CrtDesk.new()
	add_child(desk)
	desk.build(skin, crt)

	_build_top()
	add_child(Pal.scanlines(0.14))  # faint scanlines over everything, as in the game

	if args.has("width"):
		_set_width(int(args["width"]))
	if args.has("demo"):
		# Plays the clickable parts once, for checking without a screen.
		await get_tree().create_timer(3.0).timeout
		speech._on_choice(0)
		thing._on_action(1)
		thing.build("red")
		desk.set_skin("slate")
		desk.set_strength("off")
	if args.has("shot"):
		await get_tree().create_timer(float(args.get("wait", "2.5"))).timeout
		get_viewport().get_texture().get_image().save_png(args["shot"])
		get_tree().quit()


func _args() -> Dictionary:
	var out := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--") and "=" in a:
			var bits := a.substr(2).split("=", true, 1)
			out[bits[0]] = bits[1]
	return out


func _build_top() -> void:
	top = HFlowContainer.new()
	top.add_theme_constant_override("h_separation", 4)
	top.add_theme_constant_override("v_separation", 2)
	top.position = Vector2(10, 6)
	add_child(top)
	top.add_child(Pal.label("STYLE TEST", Pal.BRIGHT, 13, true))
	_gap()
	_choice("1400 wide", func(): _set_width(1400))
	_choice("810 wide", func(): _set_width(810))
	_gap()
	top.add_child(Pal.label("Thing:", Pal.MUTED, 13))
	for k in ["gold", "teal", "amber", "red"]:
		_choice(k, func(): kind = k; thing.build(k))
	_gap()
	top.add_child(Pal.label("Screen:", Pal.MUTED, 13))
	for s in [["grey", "Shipyard grey"], ["slate", "Slate"], ["phosphor", "Phosphor"]]:
		_choice(s[1], func(): skin = s[0]; desk.set_skin(s[0]))
	_gap()
	top.add_child(Pal.label("CRT:", Pal.MUTED, 13))
	for c in ["off", "light", "heavy"]:
		_choice(c, func(): crt = c; desk.set_strength(c))
	_gap()
	for v in [["room", "Show the room"], ["computer", "Show the computer"]]:
		var b := _choice(v[1], func(): view = v[0])
		_narrow_buttons.append(b)


func _choice(text: String, then: Callable) -> Button:
	var b := Pal.bracket_button(text, Pal.TEXT, Pal.BG, 13)
	b.pressed.connect(then)
	top.add_child(b)
	return b


func _gap() -> void:
	var g := Control.new()
	g.custom_minimum_size = Vector2(10, 0)
	top.add_child(g)


func _set_width(w: int) -> void:
	var h := 860
	DisplayServer.window_set_size(Vector2i(w, h))
	get_window().size = Vector2i(w, h)


func _process(_delta: float) -> void:
	var w := size.x
	var h := size.y
	top.size.x = w - 20
	var top_h := top.get_combined_minimum_size().y + 14
	var wide := w >= 1100
	for b in _narrow_buttons:
		b.visible = not wide
	var room_w := w - 660.0 if wide else w
	var show_room := wide or view == "room"
	var show_desk := wide or view == "computer"
	room.visible = show_room
	speech.visible = show_room
	thing.visible = show_room
	leaders.visible = show_room
	desk.visible = show_desk

	room.position = Vector2(0, top_h)
	room.size = Vector2(room_w, h - top_h)
	room.queue_redraw()
	var x0 := clampf((room_w - 640.0) * 0.5, 16.0, 120.0)
	speech.home = Vector2(x0, top_h + 40)
	thing.home = Vector2(x0 + 70, top_h + 420)
	leaders.queue_redraw()

	if wide:
		desk.width = 620.0
		desk.home = Vector2(w - 640.0, top_h + 40)
	else:
		desk.width = minf(w - 40.0, 760.0)
		desk.home = Vector2((w - desk.width) * 0.5, top_h + 30)


# Where the two people stand in the stand-in room.
func _voss_head() -> Vector2:
	return Vector2(speech.home.x + 90, speech.home.y + 300)


func _kettle() -> Vector2:
	return Vector2(thing.home.x - 30, thing.home.y + 180)


func _draw_room() -> void:
	# A plain diamond floor in the game's dark greens: only a stand-in for the room, which isn't part of this test.
	var r := room.size
	var line := Color("0f2418")
	var step := 48.0
	var i := -40
	while i < 60:
		var a := Vector2(i * step, 0)
		room.draw_line(a, a + Vector2(r.y * 2.0, r.y), line)
		room.draw_line(a + Vector2(0, r.y), a + Vector2(r.y * 2.0, 0), line)
		i += 1
	var voss := _voss_head() - room.position
	room.draw_circle(voss + Vector2(0, 26), 13, Color("1b3550"))
	room.draw_circle(voss, 8, speech.speaker.lerp(Color.BLACK, 0.3))
	room.draw_rect(Rect2(voss + Vector2(-9, 10), Vector2(18, 30)), speech.speaker.lerp(Color.BLACK, 0.45))
	var k := _kettle() - room.position
	room.draw_rect(Rect2(k + Vector2(-16, -10), Vector2(32, 24)), Color("4a4a42"))
	room.draw_rect(Rect2(k + Vector2(-16, -10), Vector2(32, 24)), Color("8a8a7a"), false)
	room.draw_string(Pal.MONO_BOLD, k + Vector2(-5, -18), "?", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, thing.p.c if thing.p else Color.YELLOW)


func _draw_leaders() -> void:
	# The thin line from a window to what it's about, with a dot at the far end.
	if speech.pane:
		var a := speech.anchor_point()
		var b := _voss_head() + Vector2(0, -12)
		leaders.draw_line(a, b, Color(speech.speaker, speech.pane.modulate.a), 1.2, true)
		leaders.draw_circle(b, 2.5, speech.speaker)
	if thing.box:
		var a2 := thing.anchor_point()
		var b2 := _kettle() + Vector2(0, -24)
		leaders.draw_line(a2, b2, thing.p.c, 1.2, true)
		leaders.draw_circle(b2, 2.5, thing.p.c)
