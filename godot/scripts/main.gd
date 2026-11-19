## The game's room, in Godot (steps 2 to 4 of the port): the place the player's at, drawn with the art packs, with the
## player walking it, everyone else living their days on it, the doors, the light and the dark, fires, the clock, fights
## fought in the room (fight.gd), and the story and talks over the room (story.gd).
##
## Godot draws and takes clicks; the game's rules stay in JavaScript. Everything shown here is asked of the game itself
## (link.gd), which is the same program the browser view talks to, so both can be open on the same game. What Godot
## doesn't play yet (skill checks, computers, menus) it says so about, and waits.
##
## For checking without a screen, after the two dashes:
##   --shot=out.png  --wait=1.5  --width=810  --height=860  --zoom=1.3  --report (how it went, as a line of JSON)
##   --hold=W+D:1.2;S:0.5 (holds those keys down for so long, one lot after another)  --click=30,12 (a click on
##   that square)  --press=700,430 (a real click at that point of the window)  --wheel=3 (the wheel, so many notches)
##   --press-last (the click comes after the keys, and --then=F12:5 holds on after it)
##   --point=700,430 (the pointer rests there)  --port=3292 (where the game is)  --no-start (never start the game itself)  --load=test (with no game open, open
##   that save)  --new (with no game open, start a new one; --press-first=300,300 clicks on that screen instead)  --speed=Faster  --pause
##   --plain (as if the packs weren't there)  --no-light  --bare (the deck alone)  --loading-shot=out.png
##   --empty (the ship with no game behind her, as step 1 had her: --deck=2 --at=40,15 --preview)
extends Control

const VIGNETTE: Shader = preload("res://shaders/vignette.gdshader")
const KEYS := {KEY_W: "up", KEY_S: "down", KEY_A: "left", KEY_D: "right", KEY_UP: "up", KEY_DOWN: "down", KEY_LEFT: "left", KEY_RIGHT: "right"}
## Where a way out's name goes: on the far side of it, out of the way of whoever's standing beside it.
const AWAY := {"v": Vector2(-0.5, 0.5), "^": Vector2(0.5, -0.5), "<": Vector2(-0.7, -0.35), ">": Vector2(0.7, 0.35)}
## The clock's speeds, as the browser view has them (SPEEDS in public/walk.js): game minutes to a real one.
const SPEEDS := {"Normal": 10, "Fast": 60, "Faster": 300}
const SPEED_TIPS := {"Normal": "A day in the game takes about two and a half hours", "Fast": "A day in the game takes about 24 minutes", "Faster": "A day in the game takes about 5 minutes"}
## How often the game is asked how things stand, in seconds.
const TICK := 0.5
## What Godot doesn't play yet, and where it is played.
const NOT_YET := {
	"over": "This game is over. In the game's own window you can go back to a morning it kept, or start a new one.",
	"check": "A skill check is open. It isn't in this window yet: finish it in the game's own window, and this one carries on.",
	"computer": "A computer is open. It isn't in this window yet: log off in the game's own window, and this one carries on.",
}

var args := {}
var data := {}
var packs: Packs
## Each level of the place: { info, art, view, mover, pos, sig, wanted, busy }.
var decks: Array[Dictionary] = []
var current := -1
var playing := false

## The line to the game, and the game as it last said it stands. With no line, it's the ship with no game behind her.
var link: Link
var walk := {}
var state := {}
var place_key := ""
var pace := 1.0
var clock_text := ""
var speed := "Normal"
var paused := false
var shared := false
## Everyone else on the level: key to { x, y, step, flip, back, walking, look, person }.
var shown := {}

var world: Node2D
var zoom := 1.0
var unit := 64.0
var camera := Vector2.ZERO
var camera_set := false
var you := {"pos": Vector2.ZERO, "flip": false, "back": false, "walking": false, "step": 0.0}
var route: Array[Vector2] = []
var route_firm := false
var route_done := Callable()

var top: PanelContainer
var deck_row: HBoxContainer
var deck_buttons: Array[Button] = []
var clock_row: HBoxContainer
var clock_label: Label
var clock_why: Label
var speed_buttons := {}
var room_label: Label
var help_label: Label
var banner: Banner
var corner: VBoxContainer
var news: VBoxContainer
var meter: Label
var note: Label
var chips: Control
var chip_of: Array[Dictionary] = []
var tags: Tags
var fight: Fight
var story: Story
var tint: ColorRect
var fade: ColorRect
var loading: Control
var loading_title: Label
var loading_line: Label
var loading_bar: ColorRect
var loading_more: VBoxContainer
var vignette: ColorRect

var _thread: Thread
var _frames: Array[Vector2] = []
var _meter_at := 0.0
var _slowest_ever := 0.0
var _report := {}
var _script_ms := 0.0
var _script_usual := 0.0
var _started := 0
## Where the game has the player, the last it said; whether it's being told of a step now, or of a way out being
## taken; and when it was last told or heard from about walking, in thousandths of a second.
var _sent := Vector2i.ZERO
var _pending := false
var _leaving := false
var _going := false
var _retry_at := 0
var _walked_at := 0
var _tick_in := 0.0
var _ticking := false
var _ticked_at := 0
var _fetching := false
## How many times the game had been saved when this window last looked at the whole room: when it's been saved since,
## something has changed (here, or in the game's own window), and the room is looked at again.
var _saved := -1
## After a fight, the player is wherever the game has them, whatever this window thought.
var _adopt := false
var _fighter_looks := {}
## For checking without a screen: where the pointer is taken to be (--point=x,y).
var _pointer: Variant = null
var _chips_of := ""
var _lost := 0
var _said := ""
var _said_until := 0
var _built := {}
var _slots := 0
var _mutex := Mutex.new()
var _closing := false
var _chatter := {"shown": [], "next": 0.0, "said": {}, "last": {}}


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--"):
			var bits := a.substr(2).split("=", true, 1)
			args[bits[0]] = bits[1] if bits.size() > 1 else ""
	if args.has("width") or args.has("height"):
		var size := Vector2i(int(args.get("width", "1400")), int(args.get("height", "860")))
		DisplayServer.window_set_size(size)
		get_window().size = size
	get_tree().auto_accept_quit = false
	if args.has("speed") and SPEEDS.has(args.speed):
		speed = args.speed
	paused = args.has("pause")

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
	# Bad air hangs in the room, and a ringing alarm washes it red.
	tint = ColorRect.new()
	tint.set_anchors_preset(Control.PRESET_FULL_RECT)
	tint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tint.color = Color(0, 0, 0, 0)
	add_child(tint)

	tags = Tags.new()
	tags.set_anchors_preset(Control.PRESET_FULL_RECT)
	tags.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(tags)
	chips = Control.new()
	chips.set_anchors_preset(Control.PRESET_FULL_RECT)
	chips.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(chips)
	# A fight in the room: what goes over the fighters, its orders, its notes and its two sides.
	fight = Fight.new()
	fight.main = self
	fight.visible = false
	add_child(fight)
	# The story and talks: panes by people's heads, what's told across the top, the choices, the quest in the corner.
	story = Story.new()
	story.main = self
	story.visible = false
	add_child(story)

	_build_top()
	_build_banner()
	_build_corner()

	fade = ColorRect.new()
	fade.color = Color(Iso.BACKGROUND, 0.0)
	fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(fade)

	_build_loading()
	if not args.has("bare"):
		add_child(Pal.scanlines(0.14))  # faint scanlines over everything, as in the game

	_started = Time.get_ticks_msec()
	if args.has("empty"):
		_say("Asking the game what's on the decks")
		_thread = Thread.new()
		_thread.start(DeckData.read)
	else:
		_connect()
	if args.has("loading-shot"):
		await get_tree().create_timer(0.3).timeout
		get_viewport().get_texture().get_image().save_png(args["loading-shot"])


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		_close()


## The window closing: a game this window started itself is asked to save and stop first.
func _close(code := 0) -> void:
	if _closing:
		return
	_closing = true
	playing = false
	if link != null and link.started > 0:
		_say("Saving, and stopping the game")
		loading.visible = true
		await link.stop_game()
	get_tree().quit(code)


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
	row.add_child(Pal.label("Godot view", Pal.MUTED, 13))
	row.add_child(_gap(10))
	# With no game behind her, the ship's decks by their buttons; with one, the clock.
	deck_row = HBoxContainer.new()
	deck_row.add_theme_constant_override("separation", 6)
	deck_row.visible = false
	row.add_child(deck_row)
	clock_row = HBoxContainer.new()
	clock_row.add_theme_constant_override("separation", 6)
	clock_row.visible = false
	row.add_child(clock_row)
	clock_label = Pal.label("", Pal.BRIGHT, 13, true)
	clock_row.add_child(clock_label)
	var pause := Pal.bracket_button("Pause", Pal.TEXT, Pal.BG, 13)
	pause.tooltip_text = "Or press Space, and Space again to go on"
	pause.pressed.connect(func() -> void: _set_speed(""))
	clock_row.add_child(pause)
	speed_buttons[""] = pause
	for name in SPEEDS:
		var button := Pal.bracket_button(name, Pal.TEXT, Pal.BG, 13)
		button.tooltip_text = SPEED_TIPS[name]
		button.pressed.connect(_set_speed.bind(name))
		clock_row.add_child(button)
		speed_buttons[name] = button
	clock_why = Pal.label("", Pal.MUTED, 13)
	clock_row.add_child(clock_why)
	row.add_child(_gap(10))
	room_label = Pal.label("", Pal.TEXT, 13, true)
	row.add_child(room_label)
	row.add_child(_gap(10))
	help_label = Pal.label("W A S D or a click walks, the wheel zooms", Pal.MUTED, 13)
	row.add_child(help_label)


func _gap(wide: float) -> Control:
	var g := Control.new()
	g.custom_minimum_size = Vector2(wide, 0)
	g.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return g


## A line across the top of the room for what this window doesn't play yet, or the game not answering.
func _build_banner() -> void:
	banner = Banner.new()
	banner.visible = false
	banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(banner)


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
	# What the game has to say as it happens: a fire, the lights going out, someone falling.
	news = VBoxContainer.new()
	news.add_theme_constant_override("separation", 2)
	news.mouse_filter = Control.MOUSE_FILTER_IGNORE
	corner.add_child(news)
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
	loading_more = VBoxContainer.new()
	loading_more.add_theme_constant_override("separation", 6)
	column.add_child(loading_more)


func _say(line: String, done := 0.0) -> void:
	loading_title.text = "LOADING"
	loading_line.remove_theme_color_override("font_color")
	loading_line.text = line
	loading_bar.size.x = 420.0 * clampf(done, 0.0, 1.0)
	for old in loading_more.get_children():
		old.queue_free()


func _loading_button(words: String, run: Callable) -> Button:
	var button := Pal.bracket_button(words, Pal.TEXT, Pal.BG, 14)
	button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	button.pressed.connect(run)
	loading_more.add_child(button)
	return button


## Something went wrong before anything could be drawn: said in plain words, with a way out.
func _fail(words: String, again := false) -> void:
	playing = false
	loading.visible = true
	loading_title.text = "COULDN'T START"
	loading_line.add_theme_color_override("font_color", Color("ff8f7f"))
	loading_line.text = words
	loading_bar.size.x = 0
	for old in loading_more.get_children():
		old.queue_free()
	if again:
		_loading_button("Try again", _connect)
	_loading_button("Close", func() -> void: _close(1))
	if args.has("report") or args.has("shot"):
		print("REPORT ", JSON.stringify({"ok": false, "error": words}))
		await get_tree().create_timer(0.5).timeout
		if args.has("shot"):
			get_viewport().get_texture().get_image().save_png(args.shot)
		_close(1)


# ---- Finding the game -----------------------------------------------------------------------------------------------

## Joins the game if it's running, starts it if it isn't, and loads the place the player's at.
func _connect() -> void:
	_unload()
	loading.visible = true
	if link == null:
		link = Link.new(int(args.get("port", "0")))
		add_child(link)
	_say("Looking for the game")
	var answer: Dictionary = await link.ask("/api/godot/place", null, 30.0)
	if not answer.ok and int(answer.code) == 0:
		if args.has("no-start"):
			_fail("The game isn't running at %s." % link.address(), true)
			return
		_say("Starting the game")
		if link.started <= 0 and not link.start_game():
			_fail("The game couldn't be started. It needs Node.js, the same program start-game.bat uses: get the LTS version from https://nodejs.org and try again.")
			return
		for i in 80:
			await get_tree().create_timer(0.25).timeout
			answer = await link.ask("/api/godot/place", null, 30.0)
			if answer.ok or int(answer.code) != 0:
				break
		if not answer.ok and int(answer.code) == 0:
			_fail("The game didn't start. It needs Node.js, the same program start-game.bat uses: get the LTS version from https://nodejs.org and try again.", true)
			return
	if not answer.ok:
		if int(answer.code) == 404:
			_fail("The game that's running was started before this window existed, so it can't talk to it. Close the game (its black window, or the app), then start this again.", true)
		else:
			_fail("The game answered, but not with its decks:\n%s" % str(answer.error), true)
		return
	var said: Dictionary = answer.data
	if said.get("game") == false:
		_no_game(said)
		return
	if said.get("nowhere", false):
		_fail("There's no map of where you are in the game, so there's nothing to draw yet.", true)
		return
	_load(said)


## The game is running with no game open in it: the saves there are, to open one, and a new game to start. This is
## what a copy of the game with no saves of its own opens on (one just downloaded, say), so it says which folder it's
## playing from, and nothing on it needs typing.
func _no_game(said: Dictionary) -> void:
	var saves: Array = said.get("saves", [])
	var kept: Array = saves.filter(func(save: Dictionary) -> bool: return not save.get("empty", false))
	if args.has("load"):
		await _open_save(str(args.load))
		return
	if args.has("new"):
		args.erase("new")
		await _new_game()
		return
	var where: Dictionary = said.get("where", {})
	var unread: Array = where.get("unread", [])
	loading_title.text = "NO GAME OPEN"
	loading_line.remove_theme_color_override("font_color")
	loading_bar.size.x = 0
	for old in loading_more.get_children():
		old.queue_free()
	if not kept.is_empty():
		loading_line.text = "Pick a saved game to open, or start a new one."
		var names := {"autosave": "Where you left off", "previous": "The game before", "slot1": "Slot 1", "slot2": "Slot 2", "slot3": "Slot 3", "test": "Test save"}
		for save in kept:
			_loading_button("%s: %s, %s" % [names.get(save.slot, save.slot), str(save.get("name", "")), str(save.get("location", ""))], _open_save.bind(str(save.slot)))
	elif not unread.is_empty():
		loading_line.text = "There are saved games in this folder, but they couldn't be opened. Nothing in them has been changed. A new game can still be started."
	else:
		loading_line.text = "There's no saved game in this copy of the game yet. Start a new one here, or make your own captain in the game's own window and then press Look again."
	_loading_button("New game, with a ready-made captain", _new_game)
	_loading_button("Make your own captain (opens the game's own window)", func() -> void: OS.shell_open(link.address()))
	_loading_button("Look again", _connect)
	_loading_button("Close", func() -> void: _close(0))
	# Which copy of the game this is, in small print: each copy has its own saves and its own art.
	if where.has("folder"):
		_loading_note("This copy of the game is in: %s" % str(where.folder))
	for one in unread:
		_loading_note("Couldn't be opened: %s.json (%s)" % [str(one.get("slot", "")), str(one.get("why", ""))], Color("ffc466"))
	if where.has("art") and not where.art:
		_loading_note("The bought art packs aren't in this copy (its licensed folder), so its rooms are drawn as plain grey shapes.", Color("ffc466"))
	if kept.is_empty() and where.has("folder"):
		_loading_note("Saved games%s in another copy of the game aren't used by this one." % ("" if where.get("art", true) else " and art"))
	# For checking: a real click on this screen, after which the check goes on as for any game.
	if args.has("press-first"):
		var at := str(args["press-first"])
		args.erase("press-first")
		await get_tree().create_timer(0.5).timeout
		await _press(at)
		return
	if args.has("shot"):
		await get_tree().create_timer(0.5).timeout
		get_viewport().get_texture().get_image().save_png(args.shot)
		_close(0)


## A line of small print under the buttons of the screen with no game open.
func _loading_note(words: String, color := Pal.MUTED) -> void:
	var line := Pal.label(words, color, 11)
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.custom_minimum_size.x = 420
	loading_more.add_child(line)


## A new game, begun here: the game makes a captain itself, as its own window's "A random person" does, and the story
## then starts by itself as it does for any game that hasn't been told yet.
func _new_game() -> void:
	_say("Making a captain")
	var made: Dictionary = await link.ask("/api/creator/random", {"anyone": false}, 30.0)
	if not made.ok or typeof(made.data.get("draft")) != TYPE_DICTIONARY:
		_fail("A captain couldn't be made:\n%s" % str(made.error), true)
		return
	_say("Starting a new game as Captain %s" % str(made.data.draft.get("name", "")), 0.1)
	var begun: Dictionary = await link.ask("/api/new", {"draft": made.data.draft}, 60.0)
	if not begun.ok:
		_fail("The new game couldn't be started:\n%s" % str(begun.error), true)
		return
	_connect()


func _open_save(slot: String) -> void:
	_say("Opening the save")
	var answer: Dictionary = await link.ask("/api/load", {"slot": slot}, 60.0)
	if not answer.ok:
		_fail("That save couldn't be opened:\n%s" % str(answer.error), true)
		return
	args.erase("load")
	_connect()


## Everything of the place that was loaded goes, before another is.
func _unload() -> void:
	playing = false
	for deck in decks:
		if deck.has("view") and deck.view != null:
			(deck.view as DeckView).queue_free()
	decks.clear()
	for c in chips.get_children():
		c.queue_free()
	chip_of.clear()
	_chips_of = ""
	for old in deck_buttons:
		old.queue_free()
	deck_buttons.clear()
	shown.clear()
	fight.reset()
	walk = {}
	current = -1
	route.clear()
	_pending = false
	_leaving = false
	_going = false
	top.visible = false
	banner.visible = false


# ---- Loading --------------------------------------------------------------------------------------------------------

func _process(delta: float) -> void:
	_measure()
	if _thread != null:
		if _thread.is_alive():
			return
		var answer: Dictionary = _thread.wait_to_finish()
		_thread = null
		if not answer.get("ok", false):
			_fail(str(answer.get("error", "The game gave no answer.")))
			return
		_load(answer)
		return
	if playing:
		var began := Time.get_ticks_usec()
		_play(minf(0.05, delta))
		var took := (Time.get_ticks_usec() - began) / 1000.0
		_script_ms = maxf(_script_ms * 0.98, took)
		_script_usual += (took - _script_usual) * 0.05
		if link != null:
			_tick_in -= delta
			if _tick_in <= 0.0 and not _ticking:
				_tick_in = TICK * (2.0 if paused else 1.0)
				_tick()


## One level drawn, on a thread of its own: all of it is sums.
func _draw_level(info: Dictionary, slot: int) -> void:
	var art := DeckArt.new(info, packs, data.get("ways", {}) if packs.found else {}, data.get("numbers", {}))
	_mutex.lock()
	_built[slot] = art
	_mutex.unlock()


## Draws some levels at once, each on a thread, and gives them back in the order they were asked for.
func _draw_levels(infos: Array) -> Array:
	var tasks := []
	var first := _slots
	_slots += infos.size()
	for i in infos.size():
		tasks.append(WorkerThreadPool.add_task(_draw_level.bind(infos[i], first + i)))
	for task in tasks:
		while not WorkerThreadPool.is_task_completed(task):
			await get_tree().process_frame
		WorkerThreadPool.wait_for_task_completion(task)
	var out := []
	_mutex.lock()
	for i in infos.size():
		out.append(_built.get(first + i))
		_built.erase(first + i)
	_mutex.unlock()
	return out


func _load(answer: Dictionary) -> void:
	var began := Time.get_ticks_msec()
	_report["asked_ms"] = began - _started
	if link != null:
		# Somewhere the story made up for a scene isn't on the place's map, and there's nothing here to draw it from.
		var level := Live.level_of(answer.get("walk", {}))
		if not (answer.decks as Array).any(func(deck: Dictionary) -> bool: return str(deck.id) == level):
			_fail("Where you are in the game right now isn't on the map of the place, so this window can't draw it yet. Carry on in the game's own window, and try again once you've moved on.", true)
			return
	data = answer
	_say("Loading the art", 0.2)
	await get_tree().process_frame
	var licensed: String = "" if args.has("plain") else str(data.get("licensed", ""))
	var dim := 1.0
	if data.decks.size() > 0:
		dim = float(data.decks[0].scene.look.get("pixelLight", 1.0))
	packs = Packs.new(licensed, dim)
	# Every picture the place could need is asked for now, so the atlas is whole before any deck is drawn.
	if packs.found:
		packs.gather(data.get("ways", {}))
		for info in data.decks:
			packs.gather(info.things)
			for b in info.scene.blocks:
				if b.has("pic"):
					packs.gather(b.pic)
	packs.finish()
	_say("Drawing the decks", 0.45)
	await get_tree().process_frame
	var arts: Array = await _draw_levels(data.decks)
	_say("Lighting the decks", 0.85)
	await get_tree().process_frame
	for i in data.decks.size():
		var info: Dictionary = data.decks[i]
		var art: DeckArt = arts[i]
		var view := DeckView.new()
		view.visible = false
		world.add_child(view)
		view.build(art, packs.texture, not args.has("no-light"), data.get("ways", {}))
		decks.append({"info": info, "art": art, "view": view, "mover": null, "pos": Vector2.ZERO, "sig": Live.scene_id(info), "wanted": "", "busy": false})
	# The shadows and the light are small pictures made on the graphics card in the first frames.
	for i in 3:
		await get_tree().process_frame
	for deck in decks:
		(deck.view as DeckView).settle()
	_report["drawn_ms"] = Time.get_ticks_msec() - began
	_check_rules()
	zoom = clampf(float(args.get("zoom", "1")), Iso.ZOOM_SMALLEST, Iso.ZOOM_LARGEST)
	var bare := args.has("bare")
	top.visible = not bare
	meter.visible = not bare
	vignette.visible = not bare
	chips.visible = not bare
	tags.visible = not bare
	news.visible = not bare
	var first := 0
	if link == null:
		# The ship with no game behind her: her decks by their buttons, and the player wherever they like.
		for deck in decks:
			deck.mover = Mover.new(deck.info)
			deck.pos = Vector2(float(deck.info.start.x), float(deck.info.start.y))
		_build_deck_buttons()
		deck_row.visible = true
		first = clampi(int(args.get("deck", "1")) - 1, 0, decks.size() - 1)
		if args.has("at"):
			var at: PackedStringArray = str(args.at).split(",")
			decks[first].pos = Vector2(float(at[0]), float(at[1]))
		loading.visible = false
		playing = true
		_show_deck(first)
	else:
		clock_row.visible = true
		help_label.text = "W A S D or a click walks, the wheel zooms, Space pauses"
		state = data.get("state", {})
		_saved = int(data.get("saved", -1))
		clock_text = str(data.get("clock", {}).get("label", ""))
		place_key = Live.place_key(data.walk)
		loading.visible = false
		playing = true
		_take_walk(data.walk)
		_show_clock()
		story.data = {}
		story._from = -1
		story.refresh()
	_say_what_was_plain()
	if args.has("hold") or args.has("click") or args.has("press") or args.has("wheel") or args.has("shot") or args.has("report"):
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
	note.text = ""
	note.visible = false
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


func _deck_by_id(id: String) -> int:
	for i in decks.size():
		if str(decks[i].info.id) == id:
			return i
	return -1


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
	if link == null:
		_build_chips(deck.info.exits)
	# A deck the player has just come onto fades up.
	fade.color.a = 1.0
	create_tween().tween_property(fade, "color:a", 0.0, 0.3)


## The names of the ways out, over everything so they can always be read. A click on one walks there.
func _build_chips(exits: Array) -> void:
	# Only when they've changed: a door locked or unlocked, another level.
	var now := "%d|%s" % [current, JSON.stringify(exits.map(func(exit: Dictionary) -> Array: return [exit.get("key"), exit.get("label"), Live.truthy(exit.get("closed"))]))]
	if now == _chips_of and not chip_of.is_empty():
		return
	_chips_of = now
	for c in chips.get_children():
		c.queue_free()
	chip_of.clear()
	var writing := Iso.mix(Iso.hex(decks[current].info.scene.colors.get("writing"), "#d8d4c0"), Color("c8c4b0"), 0.5)
	var dark := Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62)
	var named := {}
	for exit in exits:
		var shut := Live.truthy(exit.get("closed"))
		# A door two squares wide has one name, over its first square.
		var beside := "%s|%d,%d" % [str(exit.label), int(exit.x) - 1, int(exit.y)]
		named["%s|%d,%d" % [str(exit.label), int(exit.x), int(exit.y)]] = true
		if named.has(beside):
			continue
		var b := Button.new()
		b.text = "%s %s" % [exit.glyph, exit.label]
		b.focus_mode = Control.FOCUS_NONE
		b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
		b.tooltip_text = "%s. It's closed." % exit.label if shut else "%s. Click to go." % exit.label
		b.add_theme_font_override("font", Pal.MONO_BOLD)
		b.add_theme_font_size_override("font_size", 11)
		b.add_theme_color_override("font_color", Color("c88a70") if shut else writing)
		b.add_theme_color_override("font_hover_color", Iso.BACKGROUND)
		b.add_theme_color_override("font_pressed_color", Iso.BACKGROUND)
		b.add_theme_stylebox_override("normal", Pal.margins(Pal.box(dark), 4, 1))
		b.add_theme_stylebox_override("hover", Pal.margins(Pal.box(writing), 4, 1))
		b.add_theme_stylebox_override("pressed", Pal.margins(Pal.box(writing), 4, 1))
		b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		if link == null:
			b.pressed.connect(_walk_to.bind(Vector2i(int(exit.x), int(exit.y)), null))
		else:
			b.pressed.connect(_go.bind({"action": "go", "to": "exit:%s" % str(exit.key)}, null))
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


## With no game behind the ship, through a way out: onto the deck it leads to, beside the way out it comes out of.
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


# ---- What the game says ---------------------------------------------------------------------------------------------

## The room as the game has it now: who's in it, where the player can walk, how the level looks. A level other than the
## one on screen is the player having gone there; a level that looks different from its picture is drawn again.
func _take_walk(view: Dictionary) -> void:
	if view.is_empty():
		return
	if Live.place_key(view) != place_key:
		# Another place altogether (the shuttle across to a dock), or the ship redrawn in the Map editor.
		_connect()
		return
	var index := _deck_by_id(Live.level_of(view))
	if index < 0:
		_connect()
		return
	walk = view
	var deck := decks[index]
	var open := []
	for exit in view.get("exits", []):
		if not Live.truthy(exit.get("closed")):
			open.append(exit)
	deck.mover = Mover.new({"floor": view.floor, "cols": view.cols, "lines": view.lines, "exits": open})
	pace = float(view.get("pace", 1.0)) if view.get("pace") != null else 1.0
	var spot := Vector2(float(view.captain.x), float(view.captain.y))
	if index != current:
		shown.clear()
		_show_deck(index, spot)
		_sent = Vector2i(spot)
	_set_people(view.get("people", []), true)
	_build_chips(view.get("exits", []))
	(deck.view as DeckView).take_stock(view.get("things", []))
	var sig := Live.scene_id(view)
	if sig != deck.sig:
		_refresh(index, sig)
	# Bad air hangs in the room, and a ringing alarm washes it red.
	var room: Variant = view.get("room")
	var wash := Color(0, 0, 0, 0)
	if typeof(room) == TYPE_DICTIONARY:
		if Live.truthy(room.get("thin")):
			wash = Color(118 / 255.0, 126 / 255.0, 88 / 255.0, minf(0.34, (100.0 - float(room.get("air", 100))) / 190.0))
		if typeof(room.get("alarm")) == TYPE_DICTIONARY:
			wash = Color(210 / 255.0, 36 / 255.0, 24 / 255.0, 0.08 if Live.truthy(room.alarm.get("here")) else 0.04)
	tint.color = wash


## Who's on the level and where they've got to. Each is walked to where the game has them, never jumped there.
func _set_people(list: Array, with_chatter: bool) -> void:
	var here := {}
	var mover: Mover = decks[current].mover
	if mover != null:
		mover.blocked.clear()
	for person in list:
		var key := str(person.key)
		here[key] = true
		if mover != null:
			mover.blocked[Vector2i(int(person.x), int(person.y))] = true
		var one: Variant = shown.get(key)
		if one == null:
			var seed_of := Iso.hash_of(int(person.x), int(person.y))
			one = {"x": float(person.x), "y": float(person.y), "step": seed_of * 6.0, "back": seed_of > 0.5, "flip": fmod(seed_of, 0.25) > 0.125, "walking": false, "look": Live.look_for(key, person.get("color"), Live.truthy(person.get("crowd")))}
			shown[key] = one
		elif not with_chatter and not person.has("chatter") and one.person.has("chatter"):
			# What they might say comes only now and then; in between, each keeps what they had.
			person["chatter"] = one.person.chatter
		one["person"] = person
	for key in shown.keys():
		if not here.has(key):
			shown.erase(key)


## A level's picture has fallen behind the game (a room gone dark, a door locked, a fire): it's asked for again, drawn
## on a thread, and swapped in when it's ready. The one on screen stays until then.
func _refresh(index: int, sig: String) -> void:
	var deck := decks[index]
	deck.wanted = sig
	if deck.busy:
		return
	deck.busy = true
	var key := place_key
	while playing and key == place_key:
		var want: String = deck.wanted
		var answer: Dictionary = await link.ask("/api/godot/level/%s" % str(deck.info.id).uri_encode(), null, 30.0)
		if not answer.ok or not playing or key != place_key or index >= decks.size() or decks[index] != deck:
			break
		var info: Dictionary = answer.data.deck
		var arts: Array = await _draw_levels([info])
		if not playing or key != place_key or index >= decks.size() or decks[index] != deck:
			break
		var art: DeckArt = arts[0]
		var view := DeckView.new()
		view.visible = false
		world.add_child(view)
		view.build(art, packs.texture, not args.has("no-light"), data.get("ways", {}))
		for i in 3:
			await get_tree().process_frame
		if not playing or key != place_key or index >= decks.size() or decks[index] != deck:
			view.queue_free()
			break
		view.settle()
		# The doors stay as far open as they were.
		var was := {}
		for door in (deck.art as DeckArt).doors:
			was[Vector2i(int(door.x), int(door.y))] = door.open
		for door in art.doors:
			door.open = float(was.get(Vector2i(int(door.x), int(door.y)), 0.0))
			view.overlay.slide(door)
		var old: DeckView = deck.view
		deck.info = info
		deck.art = art
		deck.view = view
		deck.sig = want
		view.visible = index == current
		old.queue_free()
		_report["refreshed"] = int(_report.get("refreshed", 0)) + 1
		if deck.wanted == want:
			break
	deck.busy = false


## Asks the game how things stand, and lets the clock run on by as long as it's been since it was last asked.
func _tick() -> void:
	_ticking = true
	var now := Time.get_ticks_msec()
	var passed := 0 if paused or _ticked_at == 0 else mini(2000, now - _ticked_at)
	_ticked_at = now
	var answer: Dictionary = await link.ask("/api/godot/tick", {"ms": passed, "rate": SPEEDS[speed], "drawn": int(walk.get("here", {}).get("drawn", 0))}, 20.0)
	_ticking = false
	if not playing:
		return
	if not answer.ok:
		if int(answer.code) == 0:
			_lost += 1
		_show_clock()
		return
	_lost = 0
	var said: Dictionary = answer.data
	if typeof(said.get("state")) == TYPE_DICTIONARY:
		state = said.state
	shared = Live.truthy(said.get("shared"))
	# A fight is played here, in the room, if it's one that can be.
	if Live.truthy(state.get("combat")):
		fight.wake()
	else:
		fight.none()
	if typeof(said.get("clock")) == TYPE_DICTIONARY:
		clock_text = str(said.clock.get("label", clock_text))
	if said.has("notes"):
		for line in said.notes:
			_tell(str(line))
	# (A walk through a way out is shown to its end first: the room it leads to comes then.)
	var on_the_way_out := route_firm and not route.is_empty()
	var changed := said.has("saved") and int(said.saved) != _saved
	if changed or Live.truthy(state.get("talk")) != story.talking():
		story.refresh()
	if said.has("walk") and typeof(said.walk) == TYPE_DICTIONARY and not on_the_way_out:
		_saved = int(said.get("saved", _saved))
		_take_walk(said.walk)
	elif changed and not on_the_way_out and not _pending and not _going:
		_fetch_walk()
	elif said.has("people") and current >= 0 and str(said.get("here", "")) == str(decks[current].info.id):
		_set_people(said.people, Live.truthy(said.get("chatter")))
	# Where the game has the player, when it isn't where this window left them: something else has moved them (the
	# game's own window, or the story).
	if typeof(said.get("at")) == TYPE_DICTIONARY and playing and now > _walked_at and not _pending and not _going and not _leaving and route.is_empty():
		var at: Dictionary = said.at
		if current >= 0 and str(at.level) != str(decks[current].info.id):
			_fetch_walk()
		elif Vector2i(int(at.x), int(at.y)) != _sent and Time.get_ticks_msec() - _walked_at > 300 and _ticked_at > _walked_at:
			_sent = Vector2i(int(at.x), int(at.y))
			you.pos = Vector2(_sent)
	_show_clock()


func _fetch_walk() -> void:
	if _fetching:
		return
	_fetching = true
	var answer: Dictionary = await link.ask("/api/godot/walk", null, 20.0)
	_fetching = false
	if answer.ok and playing and typeof(answer.data.get("walk")) == TYPE_DICTIONARY:
		_saved = int(answer.data.get("saved", _saved))
		if typeof(answer.data.get("state")) == TYPE_DICTIONARY:
			state = answer.data.state
		# Where the game has the player, if something other than this window moved them.
		var view: Dictionary = answer.data.walk
		var spot := Vector2i(int(view.captain.x), int(view.captain.y))
		if _adopt or (not _pending and not _going and not _leaving and route.is_empty() and Time.get_ticks_msec() - _walked_at > 300 and current >= 0 and Live.level_of(view) == str(decks[current].info.id) and spot != _sent):
			_adopt = false
			route.clear()
			_sent = spot
			you.pos = Vector2(spot)
		_take_walk(view)
		_show_clock()


## A line of the game's news, in the corner for a while.
func _tell(line: String) -> void:
	for part in line.split("\n", false):
		var words := _on_dark(Pal.label(part.strip_edges(), Pal.TEXT, 12))
		words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		words.custom_minimum_size.x = minf(560.0, get_size().x - 40.0)
		news.add_child(words)
		var going := words.create_tween()
		going.tween_interval(14.0)
		going.tween_property(words, "modulate:a", 0.0, 1.5)
		going.tween_callback(words.queue_free)
	while news.get_child_count() > 5:
		var oldest := news.get_child(0)
		news.remove_child(oldest)
		oldest.queue_free()


func _set_speed(name: String) -> void:
	if name == "":
		paused = true
	else:
		speed = name
		paused = false
	_show_clock()


## What stops this window walking: something it doesn't play being open in the game (a fight that's fought in the
## room is played here, and isn't one of them).
func _blocked() -> String:
	for what in ["over", "combat", "check", "computer"]:
		if Live.truthy(state.get(what)) and not (what == "combat" and fight.on):
			return what
	return ""


## The story has moved on, or a talk has opened or closed: the room is looked at again.
func _story_moved() -> void:
	state["talk"] = story.talking()
	_fetch_walk()
	_show_clock()


## From a fight's ending: on with the story that was waiting on it.
func _continue_story() -> void:
	story._send("/api/chat", {"event": "continue"})


## A fight has just ended here: the room is looked at again, for whoever's lying where they fell.
func _fight_over() -> void:
	state["combat"] = false
	_fetch_walk()
	_show_clock()


## The player has left a fight that's over: they're wherever the game has them now (on a cot, if they lost).
func _after_fight() -> void:
	_adopt = true
	_fetch_walk()
	story.refresh()
	_show_clock()


## Which of the fighters the pointer's on, as the room knows them, or nobody.
func _fight_hover() -> String:
	if current < 0:
		return ""
	var hover: String = (decks[current].view as DeckView).overlay.hover
	return hover if hover.begins_with("fighter:") else ""


func _show_clock() -> void:
	if link == null:
		return
	clock_label.text = clock_text
	var held := _blocked()
	var why := ""
	if _lost >= 4:
		why = "The game isn't answering"
	elif fight.on:
		why = "Stopped for the fight"
	elif Live.truthy(state.get("talk")):
		why = "Stopped while you talk"
	elif held == "combat" or held == "over":
		why = "Stopped: see below" if held != "combat" or fight.elsewhere != "" else "Stopped: a fight is starting"
	elif paused:
		why = "Paused: Space goes on"
	elif shared:
		why = "The game's own window is running the clock"
	clock_why.text = why
	for name in speed_buttons:
		var on: bool = paused if name == "" else (not paused and speed == name)
		var button: Button = speed_buttons[name]
		button.add_theme_color_override("font_color", Pal.BG if on else Pal.TEXT)
		button.add_theme_stylebox_override("normal", Pal.margins(Pal.box(Pal.TEXT) if on else StyleBoxEmpty.new(), 2, 1))
	var words := ""
	if _lost >= 4:
		words = "The game has stopped answering. If you closed its window, close this one too and start again."
	elif held == "combat":
		if fight.elsewhere != "":
			words = "%s (Its own window: %s in a browser, or the game's app.)" % [fight.elsewhere, link.address()]
	elif held != "":
		words = "%s (Its own window: %s in a browser, or the game's app.)" % [NOT_YET[held], link.address()]
	if words == "" and _said != "" and Time.get_ticks_msec() < _said_until:
		words = _said
	banner.visible = words != "" and not args.has("bare")
	banner.say(words, minf(760.0, get_size().x - 60.0))
	banner.position = Vector2((get_size().x - banner.size.x) / 2.0, top.size.y + 10.0)
	news.visible = not fight.on and not args.has("bare")
	# In a narrow window the line on how to walk gives way to the clock.
	help_label.visible = get_size().x >= 1000.0


## Something the game said about the last walk, across the top for a few seconds.
func _message(words: String) -> void:
	_said = words
	_said_until = Time.get_ticks_msec() + 5000
	_show_clock()


# ---- Walking --------------------------------------------------------------------------------------------------------

func _unhandled_key_input(event: InputEvent) -> void:
	# In a fight in the room the keys are the fight's: Space stops and starts it, a number gives that order.
	if event is InputEventKey and event.pressed and not event.echo and playing and fight.on and fight.key(event):
		get_viewport().set_input_as_handled()
		return
	# A number picks that choice of the story's, or that line of a talk.
	if event is InputEventKey and event.pressed and not event.echo and playing and link != null and event.physical_keycode >= KEY_1 and event.physical_keycode <= KEY_9 and story.pick(event.physical_keycode - KEY_0):
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_SPACE and playing and link != null:
		_set_speed(speed if paused else "")
		get_viewport().set_input_as_handled()


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
		if link == null:
			_walk_to(Vector2i(spot.x, spot.y), spot.point)
		elif fight.on:
			# In a fight: one of the other side to go for them, the floor to walk there.
			var over := _who_at((decks[current].view as DeckView).overlay, event.position)
			if over.begins_with("fighter:"):
				fight.click({"kind": "fighter", "key": over.trim_prefix("fighter:")})
			else:
				fight.click({"kind": "floor", "x": int(spot.x), "y": int(spot.y)})
		elif story.reading():
			# Until it's been read, a click on the room goes on with the story, and doesn't walk anywhere.
			story.next()
		elif not story.talking():
			# A click on someone walks up to them, to talk; anywhere else walks there.
			var who := _who_at((decks[current].view as DeckView).overlay, event.position)
			if who != "" and not who.begins_with("fighter:"):
				_go({"action": "go", "to": "person:%s" % who}, null)
			else:
				_go({"action": "go", "x": int(spot.x), "y": int(spot.y)}, spot.point)
	else:
		return
	accept_event()


func _zoom_by(times: float) -> void:
	zoom = clampf(zoom * times, Iso.ZOOM_SMALLEST, Iso.ZOOM_LARGEST)


func _can_walk() -> bool:
	return playing and current >= 0 and decks[current].mover != null and (link == null or (_blocked() == "" and not fight.on and not story.talking() and not story.sending and not Live.truthy(state.get("talk"))))


## With no game behind the ship, a click on a square: the player walks the shortest way there, or to the floor nearest.
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
	route_firm = false
	route_done = Callable()


## A click in a game: the game finds the way (round people, up to whoever or whatever was clicked, through a way out),
## and the player walks it. point is the very spot clicked, to end on exactly.
func _go(body: Dictionary, point: Variant) -> void:
	if not _can_walk() or _going or _leaving or _pending:
		return
	story.put_away()  # walking puts the story away, until it's wanted again
	_going = true
	var from := Mover.square_of(you.pos)
	var asked := body.duplicate()
	asked["from"] = {"x": from.x, "y": from.y}
	var answer: Dictionary = await link.ask("/api/walk", asked, 20.0)
	_going = false
	_walked_at = Time.get_ticks_msec()
	if not playing:
		return
	if not answer.ok:
		_message(str(answer.error))
		return
	var said: Dictionary = answer.data
	if typeof(said.get("walk")) != TYPE_DICTIONARY:
		return
	var view: Dictionary = said.walk
	var leaving := Live.level_of(view) != str(decks[current].info.id) or Live.place_key(view) != place_key
	_sent = Vector2i(int(view.captain.x), int(view.captain.y))
	if said.get("message") != null:
		_message(str(said.message))
	var arrived: Variant = said.get("arrived")
	if typeof(arrived) == TYPE_DICTIONARY and str(arrived.get("kind", "")) == "door":
		_message("That door is shut. Doors are asked at, forced or unlocked from the game's own window for now.")
	# Walking up to someone is to talk to them, or to go on with the story that's waiting on them.
	var met := ""
	if typeof(arrived) == TYPE_DICTIONARY and str(arrived.get("kind", "")) == "person" and body.has("to"):
		met = str(arrived.get("key", ""))
	var mover: Mover = decks[current].mover
	var points: Array[Vector2] = []
	for step in said.get("path", []):
		points.append(Vector2(float(step.x), float(step.y)))
	if not leaving:
		# On the same level, the room is as the game has it from now; only the player is still on their way.
		_take_walk(view)
		mover = decks[current].mover
		if not points.is_empty() and point != null and Mover.square_of(point) == Vector2i(points[-1]) and mover.fits(points[-1], point):
			points.append(point)
	if points.is_empty():
		if leaving:
			_take_walk(view)
		if met != "":
			story.meet(met)
		return
	# Nobody's in the player's way on a way the game has found round them.
	var kept := mover.blocked
	mover.blocked = {}
	route = mover.smoothed(you.pos, points)
	mover.blocked = kept
	route_firm = leaving
	route_done = _take_walk.bind(view) if leaving else (story.meet.bind(met) if met != "" else Callable())


## Tells the game about a new square once it's been reached, one at a time, and a way out as soon as it's walked into
## (sync in public/move.js). The game keeps the player there if it can be walked to, or says where they are instead.
func _sync() -> void:
	var now := Time.get_ticks_msec()
	if _pending or _leaving or _going or now < _retry_at or not _can_walk() or not route.is_empty():
		return
	var square := Mover.square_of(you.pos)
	if square == _sent:
		return
	var mover: Mover = decks[current].mover
	_pending = true
	if mover.ways_out.has(square):
		_leaving = true
	var answer: Dictionary = await link.ask("/api/walk", {"action": "move", "x": square.x, "y": square.y}, 20.0)
	_pending = false
	_walked_at = Time.get_ticks_msec()
	if not playing:
		return
	if not answer.ok:
		# Most likely something has just opened in the game. It's tried again in a moment.
		_leaving = false
		_retry_at = Time.get_ticks_msec() + 1000
		return
	var said: Dictionary = answer.data
	if typeof(said.get("walk")) == TYPE_DICTIONARY:
		# Through a way out, or up to a closed door: the game's room, and its square, from here.
		var view: Dictionary = said.walk
		_leaving = false
		_sent = Vector2i(int(view.captain.x), int(view.captain.y))
		if Live.level_of(view) == str(decks[current].info.id):
			you.pos = Vector2(_sent)
		_take_walk(view)
		return
	_leaving = false
	var at: Dictionary = said.get("captain", {"x": _sent.x, "y": _sent.y})
	if not Live.truthy(said.get("moved")):
		you.pos = Vector2(float(at.x), float(at.y))
	_sent = Vector2i(int(at.x), int(at.y))


func _held() -> Array:
	var held := []
	for key in KEYS:
		if Input.is_physical_key_pressed(key) and not held.has(KEYS[key]):
			held.append(KEYS[key])
	return held


static func _face_along(who: Dictionary, moved: Vector2) -> void:
	var across := moved.x * Iso.CELL_WIDTH - moved.y
	var along := moved.x * Iso.CELL_WIDTH + moved.y
	if absf(across) > 0.002:
		who.flip = across < 0.0
	if absf(along) > 0.002:
		who.back = along < 0.0


func _play(dt: float) -> void:
	var deck := decks[current]
	var mover: Mover = deck.mover
	var view: DeckView = deck.view
	var before: Vector2 = you.pos
	var walking_speed := Mover.SPEED * pace
	var heading := Mover.heading_of(_held()) if _can_walk() and not _leaving else Vector2.ZERO
	if heading != Vector2.ZERO:
		story.put_away()  # walking puts the story away, until it's wanted again
	if not route.is_empty() and heading != Vector2.ZERO and not route_firm:
		route.clear()  # the keys take over from a walk begun with a click
		route_done = Callable()
	if not route.is_empty():
		var left := walking_speed * dt
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
		if route.is_empty() and route_done.is_valid():
			var done := route_done
			route_done = Callable()
			done.call()
			return
	elif heading != Vector2.ZERO and mover != null:
		you.pos = mover.walk_by(you.pos, heading.x * walking_speed * dt / Iso.CELL_WIDTH, heading.y * walking_speed * dt)
	# Which way they face: towards where they've just been going, and otherwise the way they last were.
	var moved: Vector2 = you.pos - before
	var went := absf(moved.x) * Iso.CELL_WIDTH + absf(moved.y)
	you.walking = went > 0.0 and went < 2.0
	if you.walking:
		you.step += went * 5.0
		_face_along(you, moved)
	var square := Mover.square_of(you.pos)
	var fighting: Array = []
	var others := shown
	if link == null:
		# Walking onto a way out takes it.
		if mover.ways_out.has(square):
			_take(mover.ways_out[square])
			return
	elif fight.on:
		# In a fight the player is where the fight has them, and whoever's in it is drawn once, as a fighter.
		var spot := fight.your_spot(dt)
		if not spot.is_empty():
			you.pos = spot.pos
			you.flip = spot.flip
			you.back = spot.back
			you.walking = spot.walking
			you.step = spot.step
			square = Mover.square_of(you.pos)
		_move_people(dt)
		fighting = fight.fighters(dt)
		var hidden := fight.hidden()
		if not hidden.is_empty():
			others = {}
			for key in shown:
				if not hidden.has(key):
					others[key] = shown[key]
		for one in fighting:
			var known: Variant = shown.get(str(one.person)) if one.person != null else null
			if not _fighter_looks.has(one.key):
				_fighter_looks[one.key] = known.look if known != null else Live.look_for(str(one.key), one.color if one.color != null else ("#b0503a" if one.side == "enemy" else "#8ec5ff"), false)
			one["look"] = _fighter_looks[one.key]
	else:
		_sync()
		_move_people(dt)

	view.overlay.hover = _under_pointer(view.overlay)
	view.overlay.place_you(you)
	view.overlay.place_people(others)
	view.overlay.place_fighters(fighting)
	if not fight.on and not _fighter_looks.is_empty():
		_fighter_looks.clear()

	# The doors between rooms slide open for whoever comes near, and shut behind them.
	var movers := view.overlay.movers
	for door in view.art.doors:
		var c: Vector2 = door.centre
		var target := 0.0
		for where in movers:
			if absf(where.y - c.y) < 1.6 and Vector2((where.x - c.x) * 1.2, where.y - c.y).length() < 1.6:
				target = 1.0
				break
		if door.open == target:
			continue
		var open: float = door.open + (target - door.open) * (1.0 - exp(-dt * 1000.0 / 90.0))
		door.open = target if absf(open - target) < 0.01 else open
		view.overlay.slide(door)

	_aim(dt)
	var where_you := Iso.centre(you.pos.x, you.pos.y)
	if view.lantern != null:
		view.lantern.position = Iso.at(where_you.x, where_you.y, 0.3)
	_place_chips()
	var deck_name := str(deck.info.name)
	var room := _room_at(square)
	room_label.text = room if room == deck_name or link == null else "%s  ·  %s" % [room, deck_name.get_slice(":", 0)]
	if link != null:
		tags.show_names(self, view.overlay, dt)
		if _said != "" and Time.get_ticks_msec() >= _said_until:
			_said = ""
			_show_clock()


## Everyone else eases to where the game has them, a square at a time, facing the way they go (moveEveryone).
func _move_people(dt: float) -> void:
	var by := 1.0 - exp(-dt * 1000.0 / 200.0)
	for key in shown:
		var one: Dictionary = shown[key]
		var person: Dictionary = one.person
		var goal := Vector2(float(person.x), float(person.y))
		var before := Vector2(one.x, one.y)
		if before == goal:
			one.walking = false
			continue
		var next := before + (goal - before) * by
		if absf(goal.x - next.x) < 0.01:
			next.x = goal.x
		if absf(goal.y - next.y) < 0.01:
			next.y = goal.y
		one.x = next.x
		one.y = next.y
		var moved := next - before
		var went := absf(moved.x) * Iso.CELL_WIDTH + absf(moved.y)
		one.step += went * 5.0
		one.walking = went > 0.0
		_face_along(one, moved)


## Whoever the pointer's on, by their key, or nobody.
func _under_pointer(overlay: Overlay) -> String:
	if link == null or args.has("bare"):
		return ""
	return _who_at(overlay, _pointer if _pointer != null else get_local_mouse_position())


## Whoever's drawn at a point of the window: in a fight, one of the fighters; otherwise one of the people in the room.
func _who_at(overlay: Overlay, at: Vector2) -> String:
	if at.y < top.size.y or not get_rect().has_point(at):
		return ""
	var scale := world.scale.x
	var best := ""
	var nearest := -INF
	for key in overlay.heads:
		if key == "you" or (fight.on and not str(key).begins_with("fighter:")):
			continue
		var head: Dictionary = overlay.heads[key]
		var feet: Vector2 = world.position + (head.at as Vector2) * scale
		var tall := float(head.tall) * scale
		var wide := Overlay.FIGURE * scale
		# Of two people one behind the other, the one in front.
		if Rect2(feet.x - wide * 0.22, feet.y - tall * 0.92, wide * 0.44, tall).has_point(at) and (best == "" or feet.y > nearest):
			best = key
			nearest = feet.y
	return best


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
	# In a fight the player is kept in what's left of the room above the orders.
	goal.y += fight.covered_below() / 2.0 / unit
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
		if link == null:
			_walk_to(Vector2i(int(at[0]), int(at[1])), null)
		else:
			await _go({"action": "go", "x": int(at[0]), "y": int(at[1])}, null)
		_report["route"] = route.size()
	if args.has("wheel"):
		for i in absi(int(args.wheel)):
			var turn := InputEventMouseButton.new()
			turn.button_index = MOUSE_BUTTON_WHEEL_UP if int(args.wheel) > 0 else MOUSE_BUTTON_WHEEL_DOWN
			turn.pressed = true
			turn.position = get_size() / 2.0
			Input.parse_input_event(turn)
			await get_tree().process_frame
	if args.has("press") and not args.has("press-last"):
		await _press(str(args.press))
	if args.has("hold"):
		await _hold(str(args.hold))
	if args.has("press") and args.has("press-last"):
		await _press(str(args.press))
		await _hold(str(args.get("then", "F12:0.1")))
	if args.has("point"):
		var at: PackedStringArray = str(args.point).split(",")
		_pointer = Vector2(float(at[0]), float(at[1]))
	await get_tree().create_timer(float(args.get("wait", "1.0"))).timeout
	_slowest_ever = 0.0
	_meter_at = 0.0
	await get_tree().create_timer(1.2).timeout
	_finish_check()


## For checking: a real click at a point of the window.
func _press(where: String) -> void:
	if true:
		var at: PackedStringArray = where.split(",")
		for down in [true, false]:
			var click := InputEventMouseButton.new()
			click.button_index = MOUSE_BUTTON_LEFT
			click.pressed = down
			click.position = Vector2(float(at[0]), float(at[1]))
			click.global_position = click.position
			Input.parse_input_event(click)
			await get_tree().process_frame
		await get_tree().create_timer(0.3).timeout
		_report["route"] = route.size()


## For checking: keys held down for so long, one lot after another ("W+D:1.2;S:0.5").
func _hold(keys: String) -> void:
	if true:
		for part in keys.split(";"):
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


func _finish_check() -> void:
	if args.has("shot"):
		get_viewport().get_texture().get_image().save_png(args.shot)
	if args.has("report") and playing and current >= 0:
		var art: DeckArt = decks[current].art
		var asleep := 0
		var walking := 0
		for key in shown:
			if Live.truthy(shown[key].person.get("asleep")):
				asleep += 1
			if shown[key].walking:
				walking += 1
		_report.merge({"ok": true, "deck": decks[current].info.id, "pos": [you.pos.x, you.pos.y], "sent": [_sent.x, _sent.y], "room": room_label.text, "unit": unit, "packs": packs.found, "slowest_ms": _slowest_ever, "atlas": [packs.size().x, packs.size().y], "items": art.standing.items.size(), "ground_verts": art.ground.verts.size(), "standing_verts": art.standing.verts.size(), "doors": art.doors.size(), "open_doors": art.doors.filter(func(d: Dictionary) -> bool: return d.open > 0.5).size(), "top_height": top.size.y, "meter": meter.text, "note": note.text, "script_ms": _script_ms, "script_usual_ms": _script_usual, "draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), "primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME), "video_mb": Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, "people": shown.size(), "asleep": asleep, "walking": walking, "clock": clock_text, "why": clock_why.text, "banner": banner.words if banner.visible else "", "state": state, "paused": paused, "shared": shared, "stores": art.stores.size(), "cameras": art.cameras.size(), "rests": art.rests.size(), "started_game": link != null and link.started > 0, "story": {"id": story.data.get("id"), "open": story.open, "at": story.at, "beats": (story.data.get("beats", []) as Array).size(), "choices": (story.data.get("choices", []) as Array).map(func(c: Dictionary) -> String: return str(c.label)), "talk": story.data.get("talk", {}).get("name") if typeof(story.data.get("talk")) == TYPE_DICTIONARY else null, "talk_choices": (story.data.talk.choices as Array).map(func(c: Dictionary) -> String: return str(c.label)) if typeof(story.data.get("talk")) == TYPE_DICTIONARY else [], "tracker": story.data.get("tracker", {}).get("title") if typeof(story.data.get("tracker")) == TYPE_DICTIONARY else null, "message": story.message, "sending": story.sending}, "fight": {"on": fight.on, "paused": fight.paused, "held": fight.held_for, "notes": fight.notes.map(func(n: Dictionary) -> String: return str(n.text)), "ending": fight.ending.get("result"), "elsewhere": fight.elsewhere, "enemies": fight.combat.get("enemies", []).map(func(e: Dictionary) -> Array: return [e.name, e.hp]), "you": fight.combat.get("you", {}).get("hp")}, "news": news.get_child_count()})
		print("REPORT ", JSON.stringify(_report))
	if args.has("shot") or args.has("report"):
		_close(0)


## A few lines of words in a box across the top of the room, as wide as it's told and as high as the words need.
class Banner:
	extends Control

	const INK := Color("ffc466")
	const SIZE := 13

	var words := ""
	var _wide := 0.0

	func say(text: String, wide: float) -> void:
		if text == words and is_equal_approx(wide, _wide):
			return
		words = text
		_wide = wide
		var high := Pal.MONO.get_multiline_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, wide, SIZE).y
		size = Vector2(wide + 24.0, high + 16.0)
		queue_redraw()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.1, 0.07, 0.03, 0.92))
		draw_rect(Rect2(Vector2.ZERO, size), INK, false, 1.0)
		Pal.MONO.draw_multiline_string(get_canvas_item(), Vector2(12.0, 8.0 + Pal.MONO.get_ascent(SIZE)), words, HORIZONTAL_ALIGNMENT_CENTER, _wide, SIZE, -1, INK)


## The names over people's heads, and what they say to nobody in particular, over everything so they can be read
## (the chips and drawChatter in public/iso.js).
class Tags:
	extends Control

	const ASKS := Color("ffa94d")
	const CHATTER := {"every": 3000.0, "more": 7000.0, "lasts": 4600.0, "most": 2, "again": 20000.0}

	var _chips: Array[Dictionary] = []

	## A small box of words with its middle over a point, kept on the screen. Gives back where it went.
	func _chip(text: String, at: Vector2, colour: Color, background: Color, size: int, alpha := 1.0) -> Rect2:
		var wide := Pal.MONO_BOLD.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 8.0
		var box := Rect2(clampf(at.x - wide / 2.0, 2.0, maxf(2.0, get_size().x - wide - 2.0)), clampf(at.y - size - 6.0, 2.0, maxf(2.0, get_size().y - size - 8.0)), wide, size + 5.0)
		_chips.append({"text": text, "box": box, "colour": Color(colour, colour.a * alpha), "background": Color(background, background.a * alpha), "size": size})
		return box

	func show_names(main: Control, overlay: Overlay, _dt: float) -> void:
		_chips.clear()
		var world: Node2D = main.world
		var scale := world.scale.x
		var you: Vector2 = main.you.pos
		var seen := {}
		var spots := {}
		for key in overlay.heads:
			if key == "you" or not main.shown.has(key):
				continue
			var one: Dictionary = main.shown[key]
			var person: Dictionary = one.person
			var head: Dictionary = overlay.heads[key]
			var feet: Vector2 = world.position + (head.at as Vector2) * scale
			if feet.x < -8.0 or feet.y < -8.0 or feet.x > get_size().x + 8.0 or feet.y - 64.0 * scale > get_size().y + 8.0:
				continue
			var above := feet + Vector2(0, -float(head.tall) * scale * 0.95)
			seen[key] = true
			spots[key] = above
			var hovered: bool = overlay.hover == key
			var near := absf(one.x - you.x) * Iso.CELL_WIDTH + absf(one.y - you.y) < 5.0
			var asks := Live.truthy(person.get("asks"))
			# Someone with something to ask the player has a mark on their tag, seen from across the room.
			if not hovered and not asks and (Live.truthy(person.get("crowd")) or Live.truthy(person.get("walking")) or not near):
				continue
			var name := str(person.get("short", ""))
			if hovered:
				name = "%s%s" % [str(person.get("name", name)), ", %s" % str(person.doing) if person.get("doing") != null else ""]
				if Live.truthy(person.get("down")) and person.get("downLook") != null:
					name = "%s. %s" % [str(person.get("name", name)), str(person.downLook)]
			var text := name
			if asks:
				text = "! %s: has something to ask you" % name if hovered else ("! %s" % str(person.get("short", "")) if near else "!")
			var tag := ASKS if asks else Iso.mix(Iso.hex(person.get("color"), "#a0a090"), Color("d8d4c0"), 0.3)
			var filled := hovered or asks
			_chip(text, above, Iso.BACKGROUND if filled else tag, tag if filled else Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62), 13 if asks and not hovered and not near else 11)
		_chatter(main, seen, spots)
		queue_redraw()

	## Every three to ten seconds someone on the screen who hasn't spoken in the last twenty says one of their lines,
	## over their head, for a few seconds, two at most at once (chatterNext).
	func _chatter(main: Control, seen: Dictionary, spots: Dictionary) -> void:
		var talk: Dictionary = main._chatter
		var now := float(Time.get_ticks_msec())
		# Nobody chats in a fight, while the story's being read or a talk is open, or while something this window
		# doesn't play is open.
		if main._blocked() != "" or main.fight.on or main.story.open or main.story.talking():
			talk.shown = []
			return
		talk.shown = (talk.shown as Array).filter(func(one: Dictionary) -> bool: return one.until > now)
		if now >= float(talk.next) and (talk.shown as Array).size() < int(CHATTER.most):
			talk.next = now + CHATTER.every + randf() * CHATTER.more
			var candidates := []
			for key in seen:
				var person: Dictionary = main.shown[key].person
				var lines: Variant = person.get("chatter")
				if typeof(lines) != TYPE_ARRAY or (lines as Array).is_empty():
					continue
				if (talk.shown as Array).any(func(one: Dictionary) -> bool: return one.key == key):
					continue
				if now - float(talk.said.get(key, -INF)) <= CHATTER.again:
					continue
				candidates.append(key)
			if not candidates.is_empty():
				var key: String = candidates[randi() % candidates.size()]
				var lines: Array = main.shown[key].person.chatter
				var fresh := lines.filter(func(line: Variant) -> bool: return str(line) != str(talk.last.get(key, "")))
				var from: Array = fresh if not fresh.is_empty() else lines
				var text := str(from[randi() % from.size()])
				(talk.shown as Array).append({"key": key, "text": text, "from": now, "until": now + CHATTER.lasts})
				talk.said[key] = now
				talk.last[key] = text
		for one in talk.shown:
			if not spots.has(one.key):
				continue
			var above: Vector2 = spots[one.key]
			var see := clampf(minf((now - float(one.from)) / 250.0, (float(one.until) - now) / 600.0), 0.0, 1.0)
			var box := _chip("\u201c%s\u201d" % str(one.text), above + Vector2(0, -18), Color("d9d3ba"), Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.58), 10, see)
			_chips[-1]["tail"] = clampf(above.x, box.position.x + 4.0, box.end.x - 4.0)

	func _draw() -> void:
		var font := Pal.MONO_BOLD
		for chip in _chips:
			var box: Rect2 = chip.box
			var size: int = chip.size
			draw_rect(box, chip.background)
			draw_string(font, Vector2(box.position.x + 4.0, box.position.y + (box.size.y + font.get_ascent(size) - font.get_descent(size)) / 2.0), chip.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, chip.colour)
			if chip.has("tail"):
				var tip: float = chip.tail
				draw_colored_polygon(PackedVector2Array([Vector2(tip - 4.0, box.end.y), Vector2(tip + 4.0, box.end.y), Vector2(tip, box.end.y + 5.0)]), chip.background)
