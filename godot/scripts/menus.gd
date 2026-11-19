## The game's menus in Godot: the rail of their buttons down the right edge of the window, and the panel one slides
## out in. What's in a menu is built by the game itself, with the same code that builds it for the browser, and handed
## over as a tree for page.gd to draw (/api/godot/page); a click in one is sent back as the number of what was clicked,
## and the game does whatever that button does. So nothing here knows what any menu is about.
class_name Menus
extends Control

## The rail's width, and the window's width at and under which there's no rail: a Menu button along the top then
## opens the panel, with the menus' names across its top (style.css: --rail-width, and its rule at 860 wide).
const RAIL := 124.0
const NARROW := 860.0
const SLIDE := 0.22
## What a button of the rail opens that isn't a menu drawn here, and what to say of it until it's in this window.
const NOT_YET := {
	"board": "The Story board isn't in this window yet. It's in the game's own window.",
	"mapedit": "The Map editor isn't in this window yet. It's in the game's own window.",
	"sheet": "Your registry printout isn't in this window yet. It's in the game's own window (press C there).",
}

var main: Control
var rail: PanelContainer
var rail_list: VBoxContainer
var backdrop: ColorRect
var drawer: PanelContainer
var title: Label
var notice: Label
var tabs: HFlowContainer
var scroll: SpringScroll
var page: Page

## The menu that's open, or "" for none; the last one that was; and the rail's groups as the game last gave them.
var open_id := ""
var last_id := "leads"
var groups: Array = []
var _of := -1
var _busy := false
var _next: Variant = null
var _look_in := 0.0
var _slid := 0.0
var _rail_buttons := {}
var _tab_buttons := {}
var _had_rail := false
var _saw := -1


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	backdrop = ColorRect.new()
	backdrop.color = Color(0, 0, 0, 0.5)
	backdrop.visible = false
	backdrop.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed:
			close()
			backdrop.accept_event())
	add_child(backdrop)

	drawer = PanelContainer.new()
	var panel := Pal.box(Color("08110c"), Pal.MUTED, 0)
	panel.border_width_left = 1
	drawer.add_theme_stylebox_override("panel", panel)
	drawer.visible = false
	drawer.clip_contents = true
	add_child(drawer)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 0)
	drawer.add_child(column)
	var head := PanelContainer.new()
	var under := Pal.margins(Pal.box(Color(0, 0, 0, 0), Pal.LINE, 0), 18, 6)
	under.border_width_bottom = 1
	head.add_theme_stylebox_override("panel", under)
	column.add_child(head)
	var head_row := HBoxContainer.new()
	head_row.add_theme_constant_override("separation", 16)
	head.add_child(head_row)
	title = Pal.label("", Pal.BRIGHT, 16, true)
	head_row.add_child(title)
	notice = Pal.label("", Pal.TEXT, 13)
	notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	notice.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_row.add_child(notice)
	var shut := Pal.bracket_button("Close", Pal.TEXT, Pal.BG, 15)
	shut.tooltip_text = "Or press Esc"
	shut.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	shut.pressed.connect(close)
	head_row.add_child(shut)
	# On a narrow window the menus' names are across the top of the panel, where the rail has no room.
	var tab_strip := PanelContainer.new()
	var strip := Pal.margins(Pal.box(Color(0, 0, 0, 0), Pal.LINE, 0), 18, 4)
	strip.border_width_bottom = 1
	tab_strip.add_theme_stylebox_override("panel", strip)
	column.add_child(tab_strip)
	tabs = HFlowContainer.new()
	tabs.add_theme_constant_override("h_separation", 10)
	tabs.add_theme_constant_override("v_separation", 0)
	tab_strip.add_child(tabs)
	tabs.set_meta("strip", tab_strip)
	page = Page.new()
	page.pressed.connect(func(id: int) -> void: _ask({"op": "click", "id": id, "of": _of}))
	page.typed.connect(func(id: int, value: String) -> void: _ask({"op": "input", "id": id, "of": _of, "value": value}))
	scroll = SpringScroll.new(page, 0)
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(scroll)

	rail = PanelContainer.new()
	var side := Pal.margins(Pal.box(Color("08110c"), Pal.LINE, 0), 0, 6)
	side.border_width_left = 1
	rail.add_theme_stylebox_override("panel", side)
	rail.visible = false
	add_child(rail)
	rail_list = VBoxContainer.new()
	rail_list.add_theme_constant_override("separation", 1)
	rail.add_child(rail_list)


## Whether the rail is there: in a game, on a window wide enough for it.
func has_rail() -> bool:
	return main.playing and main.link != null and not main.loading.visible and get_window().size.x > NARROW


func _process(delta: float) -> void:
	var window := Vector2(get_window().size)
	var railed := has_rail()
	# The room and everything over it keep to the left of the rail.
	main.offset_right = -RAIL if railed else 0.0
	rail.visible = railed
	rail.position = Vector2(window.x - RAIL, 0)
	rail.size = Vector2(RAIL, window.y)
	if railed != _had_rail:
		_had_rail = railed
		_build_tabs()
	var room := window.x - (RAIL if railed else 0.0)
	var wide := roundf(room * 0.75) if railed else room
	_slid = move_toward(_slid, 1.0 if open_id != "" else 0.0, delta / SLIDE)
	var eased := 1.0 - pow(1.0 - _slid, 2.0)
	drawer.visible = _slid > 0.0
	backdrop.visible = _slid > 0.0
	backdrop.color.a = 0.5 * eased
	backdrop.position = Vector2.ZERO
	backdrop.size = Vector2(room, window.y)
	drawer.position = Vector2(room - wide * eased, 0)
	drawer.size = Vector2(wide, window.y)
	(tabs.get_meta("strip") as Control).visible = not railed
	# While a menu is open the game goes on: the menu is looked at again a moment after anything has been saved (here
	# or in the game's own window), and now and then for what only the clock changes; it's drawn again only if it differs.
	if open_id != "" and not _busy:
		_look_in -= delta
		if _look_in <= 0.0 or (int(main._saved) != _saw and _look_in < 14.0):
			_ask({"op": "look"})


## The rail's buttons, asked of the game when a place has loaded: which menus there are depends on who the player is.
func load_rail() -> void:
	if main.link == null:
		return
	var answer: Dictionary = await main.link.ask("/api/godot/page", {"op": "rail"}, 30.0)
	if answer.ok and answer.data.has("rail"):
		groups = answer.data.rail
		_build_rail()


func _menu_button(words: String, tip: String, size: int, run: Callable) -> Button:
	var b := Button.new()
	b.text = words.to_upper()
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_override("font", Pal.MONO)
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", Pal.MUTED)
	for state in ["font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(state, Pal.BG)
	b.add_theme_stylebox_override("normal", Pal.margins(StyleBoxEmpty.new(), 10, 3))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	for state in ["hover", "pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(state, Pal.margins(Pal.box(Pal.TEXT), 10, 3))
	b.pressed.connect(run)
	return b


func _build_rail() -> void:
	for old in rail_list.get_children():
		old.queue_free()
	_rail_buttons.clear()
	for group in groups:
		var heading := Pal.label("-- %s --" % str(group.title).to_upper(), Pal.MUTED, 11)
		heading.add_theme_stylebox_override("normal", Pal.margins(StyleBoxEmpty.new(), 10, 0))
		var gap := Control.new()
		gap.custom_minimum_size.y = 8 if rail_list.get_child_count() > 0 else 0
		rail_list.add_child(gap)
		rail_list.add_child(heading)
		for entry in group.entries:
			var words := str(entry.label) + (" (%d)" % int(entry.alert) if entry.has("alert") else "")
			var button := _menu_button(words, str(entry.get("about", "")), 13, toggle.bind(str(entry.id)))
			rail_list.add_child(button)
			_rail_buttons[str(entry.id)] = button
	_build_tabs()
	_light()


func _build_tabs() -> void:
	for old in tabs.get_children():
		old.queue_free()
	_tab_buttons.clear()
	if has_rail():
		return
	for group in groups:
		tabs.add_child(Pal.label("-- %s --" % str(group.title).to_upper(), Pal.MUTED, 11))
		for entry in group.entries:
			var button := _menu_button(str(entry.label), str(entry.get("about", "")), 13, toggle.bind(str(entry.id)))
			button.add_theme_stylebox_override("normal", Pal.margins(StyleBoxEmpty.new(), 2, 1))
			for state in ["hover", "pressed", "hover_pressed"]:
				button.add_theme_stylebox_override(state, Pal.margins(Pal.box(Pal.TEXT), 2, 1))
			tabs.add_child(button)
			_tab_buttons[str(entry.id)] = button
	_light()


## The open menu's button is lit, on the rail and among the names across the panel's top.
func _light() -> void:
	for buttons in [_rail_buttons, _tab_buttons]:
		for id in buttons:
			var button: Button = buttons[id]
			if not is_instance_valid(button):
				continue
			var lit: bool = id == open_id
			button.add_theme_color_override("font_color", Pal.BG if lit else Pal.MUTED)
			button.add_theme_stylebox_override("normal", Pal.margins(Pal.box(Pal.TEXT) if lit else StyleBoxEmpty.new(), 10 if buttons == _rail_buttons else 2, 3 if buttons == _rail_buttons else 1))


func _kind(id: String) -> String:
	for group in groups:
		for entry in group.entries:
			if str(entry.id) == id:
				return str(entry.get("kind", "menu"))
	return "menu"


## A menu's button: it opens, or shuts if it's the one that's open.
func toggle(id: String) -> void:
	if id == "":
		id = last_id
	if open_id == id:
		close()
	else:
		open(id)


func open(id: String) -> void:
	# The inventory is a window of its own over the room.
	if id == "inventory":
		close()
		main.bag.toggle()
		return
	if _kind(id) != "menu" or NOT_YET.has(id):
		_window(id)
		return
	_ask({"op": "open", "menu": id})


func close() -> void:
	if open_id == "":
		return
	last_id = open_id
	open_id = ""
	_light()
	page.release_focus()
	for field in page._fields:
		field.release_focus()


## Esc shuts the open menu, and that's all that press of it does.
func key(event: InputEventKey) -> bool:
	if open_id == "" or event.physical_keycode != KEY_ESCAPE:
		return false
	close()
	return true


## Something a menu's button opens that's a window of its own.
func _window(id: String) -> void:
	close()
	main._message(NOT_YET.get(id, "That isn't in this window yet. It's in the game's own window."))


## One thing is asked of the game at a time; if something else is clicked meanwhile, the last of it is asked next.
func _ask(body: Dictionary) -> void:
	if main.link == null:
		return
	if _busy:
		if body.op != "look":
			_next = body
		return
	_busy = true
	_saw = int(main._saved)
	var answer: Dictionary = await main.link.ask("/api/godot/page", body, 40.0)
	_busy = false
	_look_in = 15.0
	_take(answer, body)
	if _next != null:
		var next: Dictionary = _next
		_next = null
		if next.has("of"):
			next.of = _of
		_ask(next)


func _take(answer: Dictionary, asked: Dictionary) -> void:
	if not answer.ok:
		notice.text = str(answer.error)
		notice.add_theme_color_override("font_color", Page.BAD)
		return
	var said: Dictionary = answer.data
	if said.get("game") == false:
		close()
		return
	if said.has("rail"):
		var changed := JSON.stringify(said.rail) != JSON.stringify(groups)
		groups = said.rail
		if changed:
			_build_rail()
	if said.has("of"):
		_of = int(said.of)
	if said.has("tree") and (asked.op != "look" or open_id != ""):
		var now := str(said.menu)
		if now != open_id:
			scroll.pos = 0.0
			scroll.vel = 0.0
		open_id = now
		last_id = now
		title.text = str(said.label).to_upper()
		var message: Variant = said.get("message")
		notice.text = str(message.text) if typeof(message) == TYPE_DICTIONARY else ""
		notice.add_theme_color_override("font_color", Pal.TEXT if typeof(message) != TYPE_DICTIONARY or Live.truthy(message.get("ok")) else Page.BAD)
		page.show_tree(said.tree)
		_light()
	for effect in said.get("effects", []):
		match str(effect.type):
			"close":
				close()
			"chat":
				main.story._send("/api/chat", effect.body)
			"reload":
				main._connect()
			"fullscreen":
				var window := get_window()
				window.mode = Window.MODE_WINDOWED if window.mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
			"browser":
				OS.shell_open(main.link.address())
			"window":
				open(str(effect.id))
