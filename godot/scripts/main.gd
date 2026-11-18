## Step 1 of the Godot port: one deck of the Meridian in Godot, drawn with the art packs, with walking, zoom and
## changing decks, and a meter to compare its smoothness with the browser view's.
##
## What's on the decks comes from the game's own code, asked once at the start (deck_data.gd). Nothing here is
## connected to a game in play: no other people, no clock, nothing to click on but the floor and the stairs.
##
## For checking without a screen, after the two dashes:
##   --shot=out.png  --wait=1.5  --width=810  --height=860  --deck=2  --at=40,15  --zoom=1.3
##   --hold=W+D:1.2;S:0.5 (holds those keys down for so long, one lot after another)  --click=30,12 (walks to that
##   square, as a click on it would)  --press=700,430 (a real click at that point of the window)  --wheel=3 (turns the
##   wheel so many notches in, or out with a minus)
##   --plain (as if the packs weren't there)  --no-light  --report (says how it went, as a line of JSON)
##   --loading-shot=out.png (a picture of the loading screen)
##   --bare (the deck alone, with nothing of the window's over it)  --preview (looks where the Map editor's picture does)
extends Control

const VIGNETTE: Shader = preload("res://shaders/vignette.gdshader")
const KEYS := {KEY_W: "up", KEY_S: "down", KEY_A: "left", KEY_D: "right", KEY_UP: "up", KEY_DOWN: "down", KEY_LEFT: "left", KEY_RIGHT: "right"}
## Where a way out's name goes: on the far side of it, out of the way of whoever's standing beside it.
const AWAY := {"v": Vector2(-0.5, 0.5), "^": Vector2(0.5, -0.5), "<": Vector2(-0.7, -0.35), ">": Vector2(0.7, 0.35)}

var args := {}
var data := {}
var packs: Packs
## Each deck: { info, art, view, mover, pos }.
var decks: Array[Dictionary] = []
var current := -1
var playing := false

var world: Node2D
var zoom := 1.0
var unit := 64.0
var camera := Vector2.ZERO
var camera_set := false
var you := {"pos": Vector2.ZERO, "flip": false, "back": false, "walking": false, "step": 0.0}
var route: Array[Vector2] = []

var top: PanelContainer
var deck_row: HBoxContainer
var deck_buttons: Array[Button] = []
var room_label: Label
var corner: VBoxContainer
var meter: Label
var note: Label
var chips: Control
var chip_of: Array[Dictionary] = []
var fade: ColorRect
var loading: Control
var loading_title: Label
var loading_line: Label
var loading_bar: ColorRect
var vignette: ColorRect

var _thread: Thread
var _frames: Array[Vector2] = []
var _meter_at := 0.0
var _slowest_ever := 0.0
var _drawn := {}
var _report := {}
var _script_ms := 0.0
var _started := 0


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var bits := a.substr(2).split("=", true, 1)
			args[bits[0]] = bits[1] if bits.size() > 1 else ""
	if args.has("width") or args.has("height"):
		var size := Vector2i(int(args.get("width", "1400")), int(args.get("height", "860")))
		DisplayServer.window_set_size(size)
		get_window().size = size

	var bg := ColorRect.new()
	bg.color = Iso.BACKGROUND
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	world = Node2D.new()
	add_child(world)

	vignette = ColorRect.new()
	vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var edges := ShaderMaterial.new()
	edges.shader = VIGNETTE
	vignette.material = edges
	add_child(vignette)

	chips = Control.new()
	chips.set_anchors_preset(Control.PRESET_FULL_RECT)
	chips.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(chips)

	_build_top()
	_build_corner()

	fade = ColorRect.new()
	fade.color = Color(Iso.BACKGROUND, 0.0)
	fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(fade)

	_build_loading()
	if not args.has("bare"):
		add_child(Pal.scanlines(0.14))  # faint scanlines over everything, as in the game

	_say("Asking the game what's on the decks")
	_started = Time.get_ticks_msec()
	_thread = Thread.new()
	_thread.start(DeckData.read)
	if args.has("loading-shot"):
		await get_tree().create_timer(0.3).timeout
		get_viewport().get_texture().get_image().save_png(args["loading-shot"])


# ---- The window's own parts -----------------------------------------------------------------------------------------

func _build_top() -> void:
	top = PanelContainer.new()
	top.add_theme_stylebox_override("panel", Pal.margins(Pal.box(Color(Pal.BG, 0.86), Pal.LINE, 0), 10, 5))
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.visible = false
	add_child(top)
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 2)
	top.add_child(row)
	row.add_child(Pal.label("ALMAGEST EXPLORER'S", Pal.BRIGHT, 13, true))
	row.add_child(Pal.label("Godot test, step 1", Pal.MUTED, 13))
	row.add_child(_gap(14))
	deck_row = HBoxContainer.new()
	deck_row.add_theme_constant_override("separation", 6)
	row.add_child(deck_row)
	row.add_child(_gap(14))
	room_label = Pal.label("", Pal.TEXT, 13, true)
	row.add_child(room_label)
	row.add_child(_gap(14))
	row.add_child(Pal.label("Walk: W A S D, the arrow keys, or click the floor. Zoom: the mouse wheel.", Pal.MUTED, 13))


func _gap(wide: float) -> Control:
	var g := Control.new()
	g.custom_minimum_size = Vector2(wide, 0)
	g.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return g


func _build_corner() -> void:
	corner = VBoxContainer.new()
	corner.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	corner.grow_vertical = Control.GROW_DIRECTION_BEGIN
	corner.offset_left = 10
	corner.offset_top = -8
	corner.offset_bottom = -8
	corner.add_theme_constant_override("separation", 2)
	corner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(corner)
	note = _on_dark(Pal.label("", Color("ffc466"), 12))
	note.visible = false
	corner.add_child(note)
	meter = _on_dark(Pal.label("", Pal.TEXT, 13))
	meter.visible = false
	corner.add_child(meter)


## A line of words on a dark strip of its own, so it can be read over the room.
func _on_dark(label: Label) -> Label:
	label.add_theme_stylebox_override("normal", Pal.margins(Pal.box(Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.72)), 6, 2))
	label.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	return label


func _build_loading() -> void:
	loading = ColorRect.new()
	(loading as ColorRect).color = Pal.BG
	loading.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(loading)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	loading.add_child(centre)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	column.custom_minimum_size.x = 420
	centre.add_child(column)
	loading_title = Pal.label("LOADING", Pal.MUTED, 13, true)
	column.add_child(loading_title)
	column.add_child(Pal.label("CFS MERIDIAN", Pal.BRIGHT, 26, true))
	var track := ColorRect.new()
	track.color = Pal.LINE
	track.custom_minimum_size = Vector2(420, 6)
	column.add_child(track)
	loading_bar = ColorRect.new()
	loading_bar.color = Pal.TEXT
	loading_bar.size = Vector2(0, 6)
	track.add_child(loading_bar)
	loading_line = Pal.label("", Pal.TEXT, 13)
	loading_line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	loading_line.custom_minimum_size.x = 420
	column.add_child(loading_line)


func _say(line: String, done := 0.0) -> void:
	loading_line.text = line
	loading_bar.size.x = 420.0 * clampf(done, 0.0, 1.0)


## Something went wrong before anything could be drawn: said in plain words, with a way out.
func _fail(words: String) -> void:
	loading_title.text = "COULDN'T START"
	loading_line.add_theme_color_override("font_color", Color("ff8f7f"))
	loading_line.text = words
	loading_bar.size.x = 0
	var close := Pal.bracket_button("Close", Pal.TEXT, Pal.BG, 14)
	close.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	close.pressed.connect(func() -> void: get_tree().quit(1))
	loading_line.get_parent().add_child(close)
	if args.has("report") or args.has("shot"):
		print("REPORT ", JSON.stringify({"ok": false, "error": words}))
		await get_tree().create_timer(0.5).timeout
		if args.has("shot"):
			get_viewport().get_texture().get_image().save_png(args.shot)
		get_tree().quit(1)


# ---- Loading --------------------------------------------------------------------------------------------------------

func _process(delta: float) -> void:
	_measure()
	if _thread != null:
		if _thread.is_alive():
			return
		var answer: Dictionary = _thread.wait_to_finish()
		_thread = null
		_load(answer)
		return
	if playing:
		var began := Time.get_ticks_usec()
		_play(minf(0.05, delta))
		_script_ms = maxf(_script_ms * 0.98, (Time.get_ticks_usec() - began) / 1000.0)


func _load(answer: Dictionary) -> void:
	var began := Time.get_ticks_msec()
	_report["asked_ms"] = began - _started
	if not answer.get("ok", false):
		_fail(str(answer.get("error", "The game gave no answer.")))
		return
	data = answer
	_say("Loading the art", 0.2)
	await get_tree().process_frame
	var licensed: String = "" if args.has("plain") else str(data.get("licensed", ""))
	var dim := 1.0
	if data.decks.size() > 0:
		dim = float(data.decks[0].scene.look.get("pixelLight", 1.0))
	packs = Packs.new(licensed, dim)
	for i in data.decks.size():
		var info: Dictionary = data.decks[i]
		_say("Drawing %s" % str(info.name).get_slice(":", 0).to_lower(), 0.3 + 0.5 * i / data.decks.size())
		await get_tree().process_frame
		var art := DeckArt.new(info, packs, data.get("ways", {}) if packs.found else {}, data.get("numbers", {}))
		decks.append({"info": info, "art": art, "mover": Mover.new(info), "pos": Vector2(float(info.start.x), float(info.start.y))})
	_say("Putting the pictures together", 0.85)
	await get_tree().process_frame
	packs.finish()
	for deck in decks:
		var art: DeckArt = deck.art
		art.ground.finish(packs.size())
		art.standing.finish(packs.size())
		var view := DeckView.new()
		view.visible = false
		world.add_child(view)
		view.build(art, packs.texture, not args.has("no-light"))
		deck["view"] = view
	_say("Lighting the decks", 0.95)
	# The shadows and the light are small pictures made on the graphics card in the first frames.
	for i in 3:
		await get_tree().process_frame
	for deck in decks:
		(deck.view as DeckView).settle()
	_report["drawn_ms"] = Time.get_ticks_msec() - began
	_check_rules()
	_build_deck_buttons()
	zoom = clampf(float(args.get("zoom", "1")), Iso.ZOOM_SMALLEST, Iso.ZOOM_LARGEST)
	var first := clampi(int(args.get("deck", "1")) - 1, 0, decks.size() - 1)
	if args.has("at"):
		var at: PackedStringArray = str(args.at).split(",")
		decks[first].pos = Vector2(float(at[0]), float(at[1]))
	loading.visible = false
	top.visible = not args.has("bare")
	meter.visible = not args.has("bare")
	vignette.visible = not args.has("bare")
	chips.visible = not args.has("bare")
	playing = true
	_show_deck(first)
	_say_what_was_plain()
	if args.has("hold") or args.has("click") or args.has("shot") or args.has("report"):
		_run_check()


## Two small rules are kept here as well as in the game (which floor plates are replaced, where pipes run along a
## wall): the game sends a few of its own answers, and they're held up against this copy's.
func _check_rules() -> void:
	var checks: Dictionary = data.get("checks", {})
	var wrong := 0
	var n := 0
	for y in 12:
		for x in 12:
			if checks.has("plates") and (int(checks.plates[n]) == 1) != Iso.replaced_plate(x * 3, y * 2):
				wrong += 1
			if checks.has("runs"):
				if str(checks.runs[n * 2]) != Iso.wall_run(x * 7, y * 3, "s"):
					wrong += 1
				if str(checks.runs[n * 2 + 1]) != Iso.wall_run(x * 5, y * 4, "e"):
					wrong += 1
			n += 1
	_report["rules_wrong"] = wrong
	if wrong > 0:
		_warn("This view and the game disagree about %d of the small details it checks (floor plates, pipes on walls). Tell Claude." % wrong)


func _warn(words: String) -> void:
	note.text = (note.text + "\n" if note.text != "" else "") + words
	note.visible = true


func _say_what_was_plain() -> void:
	if not packs.found:
		_warn("The art packs weren't found in %s, so the decks are drawn in plain shapes." % (packs.dir if packs.dir != "" else "the game's licensed folder"))
		return
	var plain := {}
	for deck in decks:
		for what in (deck.art as DeckArt).plain:
			plain[what] = true
	_report["plain"] = plain.keys()
	_report["missing"] = Array(packs.missing)
	if plain.size() > 0:
		var names := PackedStringArray()
		for what in plain.keys().slice(0, 4):
			names.append(str(what).get_file())
		_warn("%d kinds of thing had no picture in the packs' folder and are drawn plain: %s%s" % [plain.size(), ", ".join(names), "..." if plain.size() > 4 else ""])


func _build_deck_buttons() -> void:
	for i in decks.size():
		var button := Pal.bracket_button(str(decks[i].info.name).get_slice(":", 0), Pal.TEXT, Pal.BG, 13)
		button.tooltip_text = str(decks[i].info.name)
		button.pressed.connect(_show_deck.bind(i))
		deck_row.add_child(button)
		deck_buttons.append(button)


# ---- Decks ----------------------------------------------------------------------------------------------------------

func _show_deck(index: int, at: Variant = null) -> void:
	if index < 0 or index >= decks.size():
		return
	if current >= 0:
		decks[current].pos = you.pos
		(decks[current].view as DeckView).visible = false
	current = index
	var deck := decks[index]
	if at != null:
		deck.pos = at
	you.pos = deck.pos
	you.walking = false
	route.clear()
	camera_set = false
	(deck.view as DeckView).visible = true
	for i in deck_buttons.size():
		var on := i == index
		deck_buttons[i].add_theme_color_override("font_color", Pal.BG if on else Pal.TEXT)
		deck_buttons[i].add_theme_stylebox_override("normal", Pal.margins(Pal.box(Pal.TEXT) if on else StyleBoxEmpty.new(), 2, 1))
	_build_chips()
	_drawn = {}
	# A deck the player has just come onto fades up.
	fade.color.a = 1.0
	create_tween().tween_property(fade, "color:a", 0.0, 0.3)


## The names of the ways out, over everything so they can always be read. A click on one walks there.
func _build_chips() -> void:
	for c in chips.get_children():
		c.queue_free()
	chip_of.clear()
	var writing := Iso.mix(Iso.hex(decks[current].info.scene.colors.get("writing"), "#d8d4c0"), Color("c8c4b0"), 0.5)
	var dark := Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62)
	for exit in decks[current].info.exits:
		var b := Button.new()
		b.text = "%s %s" % [exit.glyph, exit.label]
		b.focus_mode = Control.FOCUS_NONE
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		b.tooltip_text = "%s. Click to go." % exit.label
		b.add_theme_font_override("font", Pal.MONO_BOLD)
		b.add_theme_font_size_override("font_size", 11)
		b.add_theme_color_override("font_color", writing)
		b.add_theme_color_override("font_hover_color", Iso.BACKGROUND)
		b.add_theme_color_override("font_pressed_color", Iso.BACKGROUND)
		b.add_theme_stylebox_override("normal", Pal.margins(Pal.box(dark), 4, 1))
		b.add_theme_stylebox_override("hover", Pal.margins(Pal.box(writing), 4, 1))
		b.add_theme_stylebox_override("pressed", Pal.margins(Pal.box(writing), 4, 1))
		b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		b.pressed.connect(_walk_to.bind(Vector2i(int(exit.x), int(exit.y)), null))
		chips.add_child(b)
		chip_of.append({"exit": exit, "button": b})


func _place_chips() -> void:
	var size := get_size()
	var floor_y := top.size.y + 2.0
	for chip in chip_of:
		var exit: Dictionary = chip.exit
		var b: Button = chip.button
		var c := Iso.centre(int(exit.x), int(exit.y)) + (AWAY.get(exit.glyph, Vector2.ZERO) as Vector2)
		var p := world.position + Iso.at(c.x, c.y, 0.2) * world.scale.x
		var wide := b.size
		b.visible = p.x > -wide.x and p.x < size.x + wide.x and p.y > -40.0 and p.y < size.y + 40.0
		var at := Vector2(clampf(p.x - wide.x / 2.0, 2.0, maxf(2.0, size.x - wide.x - 2.0)), clampf(p.y - wide.y - 6.0, floor_y, maxf(floor_y, size.y - wide.y - 8.0)))
		# Clear of the meter in the corner.
		var kept := corner.get_global_rect().grow(6.0)
		if kept.intersects(Rect2(at, wide)):
			at.y = kept.position.y - wide.y
		b.position = at


## Through a way out: onto the deck it leads to, beside the way out it comes out of.
func _take(exit: Dictionary) -> void:
	for i in decks.size():
		if decks[i].info.id != exit.to:
			continue
		var there: Mover = decks[i].mover
		var at := Vector2(float(decks[i].info.start.x), float(decks[i].info.start.y))
		for other in decks[i].info.exits:
			if other.key == exit.get("via"):
				at = Vector2(there.beside(other))
		# Where they were is beside the stairs they took, for when they come back up them.
		you.pos = Vector2((decks[current].mover as Mover).beside(exit))
		_show_deck(i, at)
		return


# ---- Walking --------------------------------------------------------------------------------------------------------

## The mouse on the room itself (whatever of the window's is over it, a button or the bar along the top, takes its own
## clicks first): the wheel zooms, and a click on the floor walks there.
func _gui_input(event: InputEvent) -> void:
	if not playing or not (event is InputEventMouseButton and event.pressed):
		return
	if event.button_index == MOUSE_BUTTON_WHEEL_UP:
		_zoom_by(1.1)
	elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
		_zoom_by(0.9)
	elif event.button_index == MOUSE_BUTTON_LEFT:
		var spot := Iso.spot_at((event.position - world.position) / world.scale.x)
		_walk_to(Vector2i(spot.x, spot.y), spot.point)
	else:
		return
	accept_event()


func _zoom_by(times: float) -> void:
	zoom = clampf(zoom * times, Iso.ZOOM_SMALLEST, Iso.ZOOM_LARGEST)


## A click on a square: the player walks the shortest way there, or to the floor nearest it.
func _walk_to(square: Vector2i, point: Variant) -> void:
	var mover: Mover = decks[current].mover
	var target: Variant = square if mover.ways_out.has(square) else mover.nearest_floor(square.x, square.y)
	if target == null:
		return
	var from := Mover.square_of(you.pos)
	var path := mover.find_path(from, target)
	if path.is_empty():
		return
	var points: Array[Vector2] = []
	for step in path:
		points.append(Vector2(step))
	# The very spot that was clicked, if it's on the square walked to and there's room to stand there.
	if point != null and target == square and Mover.square_of(point) == square and mover.fits(Vector2(square), point):
		points.append(point)
	route = mover.smoothed(you.pos, points)


func _held() -> Array:
	var held := []
	for key in KEYS:
		if Input.is_physical_key_pressed(key) and not held.has(KEYS[key]):
			held.append(KEYS[key])
	return held


func _play(dt: float) -> void:
	var deck := decks[current]
	var mover: Mover = deck.mover
	var view: DeckView = deck.view
	var before: Vector2 = you.pos
	var heading := Mover.heading_of(_held())
	if not route.is_empty() and heading != Vector2.ZERO:
		route.clear()  # the keys take over from a walk begun with a click
	if not route.is_empty():
		var left := Mover.SPEED * dt
		while left > 0.000001 and not route.is_empty():
			var goal := route[0]
			var way := Vector2((goal.x - you.pos.x) * Iso.CELL_WIDTH, goal.y - you.pos.y)
			var far := way.length()
			if far <= left:
				you.pos = goal
				left -= far
				route.pop_front()
			else:
				you.pos += Vector2(way.x / far * left / Iso.CELL_WIDTH, way.y / far * left)
				left = 0.0
	elif heading != Vector2.ZERO:
		you.pos = mover.walk_by(you.pos, heading.x * Mover.SPEED * dt / Iso.CELL_WIDTH, heading.y * Mover.SPEED * dt)
	# Which way they face: towards where they've just been going, and otherwise the way they last were.
	var moved: Vector2 = you.pos - before
	var went := absf(moved.x) * Iso.CELL_WIDTH + absf(moved.y)
	you.walking = went > 0.0
	if you.walking:
		you.step += went * 5.0
		var across := moved.x * Iso.CELL_WIDTH - moved.y
		var along := moved.x * Iso.CELL_WIDTH + moved.y
		if absf(across) > 0.002:
			you.flip = across < 0.0
		if absf(along) > 0.002:
			you.back = along < 0.0
	# Walking onto a way out takes it.
	var square := Mover.square_of(you.pos)
	if mover.ways_out.has(square):
		_take(mover.ways_out[square])
		return

	# The doors between rooms slide open for whoever comes near, and shut behind them.
	var where := Iso.centre(you.pos.x, you.pos.y)
	for door in view.art.doors:
		var c: Vector2 = door.centre
		var target := 1.0 if Vector2((where.x - c.x) * 1.2, where.y - c.y).length() < 1.6 else 0.0
		if door.open == target:
			continue
		var open: float = door.open + (target - door.open) * (1.0 - exp(-dt * 1000.0 / 90.0))
		door.open = target if absf(open - target) < 0.01 else open
		view.overlay.slide(door)

	_aim(dt)
	var now := {"pos": you.pos, "flip": you.flip, "back": you.back, "walking": you.walking, "step": you.step if you.walking else 0.0}
	if now != _drawn:
		_drawn = now
		view.overlay.place_you(you)
	if view.lantern != null:
		view.lantern.position = Iso.at(where.x, where.y, 0.3)
	_place_chips()
	room_label.text = _room_at(square)


## The whole deck if it fits; if not, the camera stays with the player, and never looks further past the deck's edge
## than half a tile (aim in public/iso.js).
func _aim(dt: float) -> void:
	var art: DeckArt = decks[current].art
	var b: Dictionary = art.scene.bounds
	var size := get_size()
	unit = round(Iso.UNIT * zoom)
	var where := Iso.centre(you.pos.x, you.pos.y)
	var here := Iso.at(where.x, where.y) / Iso.UNIT
	var goal := Vector2(_on_axis(here.x, b.minU, b.maxU - b.minU, size.x), _on_axis(here.y, b.minV, b.maxV - b.minV, size.y))
	if args.has("preview"):
		goal = Iso.at(where.x, where.y, 0.5) / Iso.UNIT  # where the Map editor's picture looks, for holding one up against the other
	if not camera_set:
		camera = goal
		camera_set = true
	camera += (goal - camera) * (1.0 - exp(-dt * 1000.0 / 160.0))
	world.scale = Vector2.ONE * (unit / Iso.UNIT)
	# Whole pixels, so that the floor stays crisp while the camera moves.
	world.position = Vector2(round(size.x / 2.0 - camera.x * unit), round(size.y / 2.0 - camera.y * unit))
	(vignette.material as ShaderMaterial).set_shader_parameter("size", size)


func _on_axis(at: float, low: float, span: float, room: float) -> float:
	var size := room / unit
	if span + 1.0 <= size:
		return low + span / 2.0
	return maxf(low - 0.5 + size / 2.0, minf(low + span + 0.5 - size / 2.0, at))


## The room a square is in: the smallest drawn over it, or the deck itself.
func _room_at(square: Vector2i) -> String:
	var info: Dictionary = decks[current].info
	var best := ""
	var least := INF
	for area in info.areas:
		if square.x >= int(area.x) and square.x < int(area.x) + int(area.w) and square.y >= int(area.y) and square.y < int(area.y) + int(area.h) and float(area.w) * float(area.h) < least:
			least = float(area.w) * float(area.h)
			best = str(area.name)
	return best if best != "" else str(info.name)


# ---- The meter ------------------------------------------------------------------------------------------------------

## The slowest frame of the last second, in thousandths of a second: walk the same way here and in the browser view,
## and compare. (At sixty frames a second a frame is 16.7.)
func _measure() -> void:
	var now := Time.get_ticks_usec() / 1000.0
	if not _frames.is_empty():
		var last := _frames[-1]
		last.y = now - last.x
		_frames[-1] = last
	_frames.append(Vector2(now, 0.0))
	while _frames.size() > 1 and now - _frames[0].x > 1000.0:
		_frames.pop_front()
	if not playing or now - _meter_at < 250.0:
		return
	_meter_at = now
	var slowest := 0.0
	for f in _frames:
		slowest = maxf(slowest, f.y)
	_slowest_ever = maxf(_slowest_ever, slowest)
	meter.text = "Slowest frame in the last second: %.1f ms  (%d frames)" % [slowest, _frames.size() - 1]


# ---- Checking without a screen --------------------------------------------------------------------------------------

func _run_check() -> void:
	await get_tree().create_timer(0.4).timeout
	if args.has("click"):
		var at: PackedStringArray = str(args.click).split(",")
		_walk_to(Vector2i(int(at[0]), int(at[1])), null)
		_report["route"] = route.size()
	if args.has("wheel"):
		for i in absi(int(args.wheel)):
			var turn := InputEventMouseButton.new()
			turn.button_index = MOUSE_BUTTON_WHEEL_UP if int(args.wheel) > 0 else MOUSE_BUTTON_WHEEL_DOWN
			turn.pressed = true
			turn.position = get_size() / 2.0
			Input.parse_input_event(turn)
			await get_tree().process_frame
	if args.has("press"):
		var at: PackedStringArray = str(args.press).split(",")
		for down in [true, false]:
			var click := InputEventMouseButton.new()
			click.button_index = MOUSE_BUTTON_LEFT
			click.pressed = down
			click.position = Vector2(float(at[0]), float(at[1]))
			click.global_position = click.position
			Input.parse_input_event(click)
			await get_tree().process_frame
		_report["route"] = route.size()
	if args.has("hold"):
		for part in str(args.hold).split(";"):
			var bits: PackedStringArray = part.split(":")
			var codes: Array = []
			for name in bits[0].split("+"):
				codes.append(OS.find_keycode_from_string(name))
			for down in [true, false]:
				for code in codes:
					var key := InputEventKey.new()
					key.physical_keycode = code
					key.keycode = code
					key.pressed = down
					Input.parse_input_event(key)
				if down:
					await get_tree().create_timer(float(bits[1]) if bits.size() > 1 else 1.0).timeout
	await get_tree().create_timer(float(args.get("wait", "1.0"))).timeout
	_slowest_ever = 0.0
	_meter_at = 0.0
	await get_tree().create_timer(1.2).timeout
	if args.has("shot"):
		get_viewport().get_texture().get_image().save_png(args.shot)
	if args.has("report"):
		var art: DeckArt = decks[current].art
		_report.merge({"ok": true, "deck": decks[current].info.id, "pos": [you.pos.x, you.pos.y], "room": room_label.text, "unit": unit, "packs": packs.found, "slowest_ms": _slowest_ever, "atlas": [packs.size().x, packs.size().y], "items": art.standing.items.size(), "ground_verts": art.ground.verts.size(), "standing_verts": art.standing.verts.size(), "doors": art.doors.size(), "open_doors": art.doors.filter(func(d: Dictionary) -> bool: return d.open > 0.5).size(), "top_height": top.size.y, "meter": meter.text, "note": note.text, "script_ms": _script_ms, "draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), "primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME), "video_mb": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0})
		print("REPORT ", JSON.stringify(_report))
	if args.has("shot") or args.has("report"):
		get_tree().quit()
