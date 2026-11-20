## What can be clicked in the room, in Godot: the marks over things (the gold ?, a part's dot, a locker's), the window
## that opens beside a thing, a part, a door or someone looked at, with what can be done about it, the menu under the
## other mouse button, and the room's own panel down the right side (who's here, the systems, the ways out, what you
## can do). All of it is public/walk.js's, written again here from the room as the game describes it (walkView): what
## each thing is called, what it says and what can be done with it are the game's, and every choice is an order sent
## to the game by the page's own route, /api/walk.
class_name RoomWindows
extends Control

const GOLD := Color("e8c060")
const DARK := Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.5)
## What a part of a place's systems is called on its mark (PART_WORDS in public/iso.js), and how high its mark sits.
const PART_WORDS := {"junction box": "power", "air plant": "air plant", "vent": "vent", "light switch": "lights", "camera": "camera", "speaker": "alarm", "relay": "comms", "console": "console", "engines": "engines", "nav core": "nav", "docking clamps": "clamps", "door panel": "keypad", "machine": "machine"}
const PART_TOPS := {"junction box": 0.95, "air plant": 1.25, "vent": 0.42, "light switch": 0.86, "camera": 1.52, "speaker": 1.42, "relay": 1.2, "console": 1.02, "engines": 1.4, "nav core": 1.3, "docking clamps": 1.1, "door panel": 0.98, "machine": 1.0}
const USUAL := ["on", "open", "watching", "released", "lit"]
const KEPT := "user://room.cfg"

## A window in the game's console look, drawn by Page from a tree made here: a bordered box in its kind's colours, with
## what each of its buttons does kept by number.
class Console:
	extends Control

	var page := Page.new()
	var runs: Array[Callable] = []
	var asks: Array[Callable] = []
	var colours := Pal.kind("green")
	var corners := false
	var most_high := 2000.0
	var scrolled := 0.0
	## When what's drawn was built by the game (host.gd), a click or typed words are passed on by number instead.
	var relay := Callable()
	var relay_typed := Callable()
	var relay_pointed := Callable()

	func _init() -> void:
		clip_contents = true
		mouse_filter = Control.MOUSE_FILTER_STOP
		add_child(page)
		page.pressed.connect(func(id: int) -> void:
			if relay.is_valid():
				relay.call(id)
			elif id < runs.size():
				runs[id].call())
		page.typed.connect(func(id: int, value: String) -> void:
			if relay_typed.is_valid():
				relay_typed.call(id, value))
		page.pointed.connect(func(id: int, how: String, at: Vector2) -> void:
			if relay_pointed.is_valid():
				relay_pointed.call(id, how, at))
		page.asked.connect(func(id: int, at: Vector2) -> void:
			if id < asks.size() and asks[id].is_valid():
				asks[id].call(at))

	## Starts a tree afresh: what its buttons will do is added as they're made.
	func begin(kind: Dictionary) -> void:
		colours = kind
		runs.clear()
		asks.clear()

	## A button: its classes, what's in it, what it does, and anything more (d for one that can't be pressed, tip).
	func button(classes: String, kids: Array, run: Callable, more := {}, ask := Callable()) -> Dictionary:
		runs.append(run)
		asks.append(ask)
		var d := {"t": "button", "c": classes, "k": kids, "id": runs.size() - 1, "on": ["click"]}
		d.merge(more)
		return d

	func put(tree: Dictionary, wide: float) -> void:
		page.use(colours)
		page.size = Vector2(wide, 10)
		page._wide = -1.0
		page.show_tree(tree)
		page.size = Vector2(wide, page.custom_minimum_size.y)
		size = Vector2(wide, minf(most_high, page.size.y))
		scrolled = clampf(scrolled, 0.0, maxf(0.0, page.size.y - size.y))
		page.position.y = -scrolled
		queue_redraw()

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			scrolled = clampf(scrolled + (40.0 if event.button_index == MOUSE_BUTTON_WHEEL_DOWN else -40.0), 0.0, maxf(0.0, page.size.y - size.y))
			page.position.y = -scrolled
		accept_event()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(colours.bg, 0.94) if not corners else Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.84))
		if not corners:
			draw_rect(Rect2(Vector2(0.5, 0.5), size - Vector2.ONE), colours.c, false, 1.0)


static func el(tag: String, classes: String, kids: Array = [], more := {}) -> Dictionary:
	var d := {"t": tag, "c": classes, "k": kids}
	d.merge(more)
	return d


var main: Control
var here := Console.new()
var pane := Console.new()
var menu := Console.new()
var frame: Control

## The marks over the things on screen: { key, box, text, colour, background, size }.
var marks: Array[Dictionary] = []
var hover := ""
## What the window beside something is about ({} for none), and what the menu is for.
var thing := {}
var menu_of := {}
var plan_open := false
var plan_deck := ""
var folded := false
var about := false
var message := ""
var working := false
var _here_sig := ""
var _here_wanted := false
var _target := Vector2.ZERO
var _aimed := false


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	here.corners = true
	here.visible = false
	pane.visible = false
	menu.visible = false
	add_child(here)
	add_child(pane)
	add_child(menu)
	var kept := ConfigFile.new()
	if kept.load(KEPT) == OK:
		folded = bool(kept.get_value("here", "folded", false))
		about = bool(kept.get_value("here", "about", false))


func _keep() -> void:
	var kept := ConfigFile.new()
	kept.set_value("here", "folded", folded)
	kept.set_value("here", "about", about)
	kept.save(KEPT)
	_here_sig = ""


# ---- Asking the game ------------------------------------------------------------------------------------------------

func _cannot() -> bool:
	return not main._can_walk()


## An order to the room (/api/walk), and the room as it is afterwards. Gives back what the game said: { ok, error } and
## its own answer's said, check, computer, combat and opened.
func order(body: Dictionary) -> Dictionary:
	if working or main.link == null:
		return {"ok": false, "error": ""}
	working = true
	var answer: Dictionary = await main.link.ask("/api/walk", body, 40.0)
	working = false
	if not answer.ok:
		return {"ok": false, "error": str(answer.error)}
	main._took(answer.data)
	var said: Dictionary = answer.data
	said["ok"] = true
	return said


## Something done about someone or in the room that opens a window of its own or says why not (deed in walk.js).
func deed(action: String, key: Variant = null) -> void:
	message = ""
	var said: Dictionary = await order({"action": action, "key": key})
	if not said.ok:
		message = str(said.error)
	elif said.get("said") != null and str(said.said) != "":
		main._tell(str(said.said))
	_here_sig = ""


func go_to(key: String, after := Callable()) -> void:
	main._go({"action": "go", "to": key}, null, after)


# ---- The marks ------------------------------------------------------------------------------------------------------

func _things() -> Array:
	return main.walk.get("things", []) if main.playing and main.link != null else []


func find_thing(id: String) -> Dictionary:
	for one in _things():
		if str(one.id) == id:
			return one
	return {}


func find_person(key: String) -> Dictionary:
	for one in main.people:
		if str(one.key) == key:
			return one
	return {}


func find_exit(key: String) -> Dictionary:
	for one in main.walk.get("exits", []):
		if str(one.key) == key:
			return one
	return {}


func _screen(wx: float, wy: float, z: float) -> Vector2:
	return main.world.position + Iso.at(wx, wy, z) * main.world.scale.x


## Where a thing's mark goes on the screen.
func spot_of(one: Dictionary) -> Vector2:
	var x := float(one.x)
	var y := float(one.y)
	if typeof(one.get("part")) == TYPE_DICTIONARY:
		var part: Dictionary = one.part
		var high: float = PART_TOPS.get(str(part.get("kind", "")), 1.0) + 0.15
		if str(part.get("mount", "")) == "wall":
			return _screen((x + 1.0) * Iso.CELL_WIDTH, y + 0.5, high) if str(part.get("face", "")) == "side" else _screen((x + 0.5) * Iso.CELL_WIDTH, y + 1.0, high)
		return _screen((x + 0.5) * Iso.CELL_WIDTH, y + 0.5, 1.15)
	var c := Iso.centre(x, y)
	return _screen(c.x, c.y, 0.7 if Live.truthy(one.get("onPiece")) or Live.truthy(one.get("quiet")) else 0.5)


func _process(_delta: float) -> void:
	visible = main.playing and main.link != null and not main.loading.visible and not main.args.has("bare")
	if not visible:
		return
	var room := Rect2(Vector2.ZERO, main.get_size())
	var pointer := get_local_mouse_position() if main._pointer == null else (main._pointer as Vector2)
	var over := get_viewport().gui_get_hovered_control()
	var on_room: bool = over == main or main._pointer != null
	marks.clear()
	hover = ""
	var quiet: bool = main.fight.on
	var now := Time.get_ticks_msec()
	var you: Vector2 = main.you.pos
	for one in ([] if quiet else _things()):
		var at := spot_of(one)
		if at.x < -8.0 or at.y < -8.0 or at.x > room.size.x + 8.0 or at.y > room.size.y + 8.0:
			continue
		var key := "thing:%s" % str(one.id)
		var near := absf(float(one.x) - you.x) * Iso.CELL_WIDTH + absf(float(one.y) - you.y) < 5.0
		var mark := {"key": key, "at": at, "near": near, "one": one}
		if typeof(one.get("part")) == TYPE_DICTIONARY:
			var part: Dictionary = one.part
			mark["tone"] = Color("ff6050") if Live.truthy(part.get("ringing")) else (Color("7fd8e0") if Live.truthy(part.get("works")) else Color("e0a050"))
			mark["full"] = "%s: %s" % [str(one.name), str(part.get("word", ""))]
			mark["close"] = str(PART_WORDS.get(str(part.get("kind", "")), "part"))
			mark["far"] = "·"
			mark["size"] = 9
		elif Live.truthy(one.get("onPiece")) or Live.truthy(one.get("quiet")):
			mark["tone"] = GOLD
			mark["full"] = str(one.name)
			var plain := str(one.name).to_lower()
			for word in ["a ", "an ", "the "]:
				if plain.begins_with(word):
					plain = plain.substr(word.length())
					break
			mark["close"] = "empty" if Live.truthy(one.get("empty")) else plain
			mark["far"] = "·"
			mark["size"] = 9
		else:
			mark["tone"] = GOLD
			mark["full"] = str(one.name)
			mark["close"] = "?"
			mark["far"] = "?"
			mark["size"] = 12
			mark.at.y += sin(now / 600.0 + float(one.x)) * main.unit * main.world.scale.x * 0.02
		marks.append(mark)
	# Which mark the pointer's on: the words it would show are what's measured, so it doesn't flicker at its edge.
	for mark in marks:
		var text: String = mark.close if mark.near else mark.far
		mark["box"] = _box(text, mark.at, int(mark.size) + (1 if mark.near and int(mark.size) < 12 else 0))
		if on_room and hover == "" and (mark.box as Rect2).grow(3.0).has_point(pointer):
			hover = mark.key
	for mark in marks:
		if mark.key == hover:
			mark["box"] = _box(mark.full, mark.at, 12 if int(mark.size) >= 12 else 10)
	# A skill check's window has the room to itself.
	here.visible = _here_wanted and not main.check.console.visible and not main.sheet.open and not main.fight_window.open and not main.computer.open
	_place()
	queue_redraw()


func _box(text: String, at: Vector2, size: int) -> Rect2:
	var wide := Pal.MONO_BOLD.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 8.0
	var room: Vector2 = main.get_size()
	return Rect2(clampf(at.x - wide / 2.0, 2.0, maxf(2.0, room.x - wide - 2.0)), clampf(at.y - size - 6.0, 2.0, maxf(2.0, room.y - size - 8.0)), wide, size + 5.0)


## The mark at a point of the window, as "thing:<id>", or "".
func mark_at(point: Vector2) -> String:
	for mark in marks:
		if mark.has("box") and (mark.box as Rect2).grow(3.0).has_point(point):
			return str(mark.key)
	return ""


func _draw() -> void:
	for mark in marks:
		if not mark.has("box"):
			continue
		var lit: bool = mark.key == hover
		var text: String = mark.full if lit else (mark.close if mark.near else mark.far)
		var size := (12 if int(mark.size) >= 12 else 10) if lit else (int(mark.size) + (1 if mark.near and int(mark.size) < 12 else 0))
		var box: Rect2 = mark.box
		var tone: Color = mark.tone
		draw_rect(box, tone if lit else (Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62) if int(mark.size) >= 12 else DARK))
		draw_string(Pal.MONO_BOLD, Vector2(box.position.x + 4.0, box.position.y + size + 1.0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Iso.BACKGROUND if lit else tone)
	# The line from a thing's window to the thing, with a dot at its end.
	if pane.visible and _aimed:
		var from := Vector2(pane.position.x if _target.x < pane.position.x else pane.position.x + pane.size.x, clampf(_target.y, pane.position.y + 10.0, pane.position.y + pane.size.y - 10.0))
		draw_line(from, _target, pane.colours.c, 1.0, true)
		draw_circle(_target, 2.5, pane.colours.c)
	if here.visible:
		# The panel's four corners, like the panes by people's heads.
		var box := Rect2(here.position, here.size)
		var c := Pal.TEXT
		for corner in [[box.position, Vector2(1, 1)], [Vector2(box.end.x, box.position.y), Vector2(-1, 1)], [Vector2(box.position.x, box.end.y), Vector2(1, -1)], [box.end, Vector2(-1, -1)]]:
			var p: Vector2 = corner[0]
			var way: Vector2 = corner[1]
			draw_line(p, p + Vector2(11 * way.x, 0), c, 2.0)
			draw_line(p, p + Vector2(0, 11 * way.y), c, 2.0)


# ---- The room's panel -----------------------------------------------------------------------------------------------

## Drawn again only when something it shows has changed.
func refresh() -> void:
	if not main.playing or main.link == null or main.walk.is_empty():
		here.visible = false
		return
	var view: Dictionary = main.walk
	var listed: Array = []
	for person in main.people:
		listed.append([person.key, person.get("doing"), person.get("asks"), person.get("room"), person.get("down"), person.get("asleep")])
	var parts: Array = []
	for one in view.get("things", []):
		if typeof(one.get("part")) == TYPE_DICTIONARY:
			parts.append([one.id, one.part.get("word"), one.part.get("works"), one.part.get("ringing")])
	var sig := JSON.stringify([view.get("here"), listed, parts, view.get("ways"), view.get("exits"), view.get("acts"), view.get("room"), folded, about, message, _cannot(), main.fight.on, main.get_size().x, main.you_are.get("credits")])
	if sig == _here_sig:
		return
	_here_sig = sig
	_here_wanted = not main.fight.on and main.get_size().x >= 640.0
	here.visible = _here_wanted
	if not here.visible:
		return
	here.begin(Pal.kind("green"))
	here.colours = {"c": Pal.TEXT, "bright": Pal.BRIGHT, "dim": Pal.MUTED, "line": Pal.LINE, "bg": Pal.BG}
	var where: Dictionary = view.get("here", {})
	var deck: Variant = where.get("deck")
	var on_deck := typeof(deck) == TYPE_DICTIONARY
	var in_room := func(one: Dictionary) -> bool: return not on_deck or str(one.get("room", "")) == str(where.get("id", ""))
	var people: Array = main.people.filter(in_room)
	var named: Array = people.filter(func(p: Dictionary) -> bool: return not Live.truthy(p.get("crowd")) or Live.truthy(p.get("asks")) or p.get("wants") != null)
	var others := people.size() - named.size()
	var systems: Array = view.get("things", []).filter(func(one: Dictionary) -> bool: return typeof(one.get("part")) == TYPE_DICTIONARY and in_room.call(one))
	var ways: Array = []
	for way in view.get("ways", []):
		var locked := Live.truthy(way.get("locked"))
		ways.append({"label": str(way.name), "shut": "locked" if locked else "", "to": "exit:door:%d,%d" % [int(way.x), int(way.y)] if locked else "room:%s" % str(way.to), "menu": false})
	for exit in view.get("exits", []):
		if in_room.call(exit):
			ways.append({"label": str(exit.label), "shut": "closed" if Live.truthy(exit.get("closed")) else "", "to": "exit:%s" % str(exit.key), "menu": true})
	var off := {"d": 1} if _cannot() else {}
	var walk_to := func(content: Array, to: String, classes: String, more := {}, with_menu := true) -> Dictionary:
		var extra := off.duplicate()
		extra.merge(more)
		return here.button(classes, content, go_to.bind(to), extra, (func(at: Vector2) -> void: open_menu(to, at)) if with_menu else Callable())
	var tag := here.button("here-tag", [el("span", "here-name", [str(where.get("name", ""))])] + ([el("span", "here-deck", [str(deck.name)])] if on_deck else []) + [el("span", "here-fold", ["[+]" if folded else "[-]"])], func() -> void:
		folded = not folded
		_keep(), {"tip": "Show what's here" if folded else "Fold this away"})
	var kids: Array = [tag]
	if folded:
		var counts: Array = []
		for count in [[people.size(), "person", "people"], [systems.size(), "system", "systems"], [ways.size(), "way out", "ways out"]]:
			if int(count[0]) > 0:
				counts.append("%d %s" % [count[0], count[1] if int(count[0]) == 1 else count[2]])
		kids.append(el("div", "here-summary", [" · ".join(counts) if not counts.is_empty() else "Nobody here, and no way out"]))
	else:
		var body: Array = []
		var top: Array = []
		if where.get("desc") != null and str(where.desc) != "":
			top.append(here.button("", ["%s About this room" % ("-" if about else "+")], func() -> void:
				about = not about
				_keep()))
		if typeof(view.get("overview")) == TYPE_DICTIONARY:
			top.append(here.button("", [str(view.overview.get("title", "Map"))], open_plan, off))
		if not top.is_empty():
			body.append(el("div", "here-top", top))
		if about and where.get("desc") != null:
			body.append(el("div", "here-desc", [str(where.desc)]))
		if not people.is_empty():
			var rows: Array = []
			for person in named:
				var short := str(person.get("short", person.get("name", "?")))
				var row: Array = [el("span", "here-badge", [" %s " % short.substr(0, 1).to_upper()]), el("span", "here-who", [short])]
				if Live.truthy(person.get("asks")):
					row.append(el("span", "here-asks", [" ! "]))
				if person.get("doing") != null and str(person.doing) != "":
					row.append(el("span", "here-doing", [str(person.doing)]))
				rows.append(walk_to.call(row, "person:%s" % str(person.key), "here-row", {"st": "--speaker:%s" % str(person.get("color", "#8fd0e8")), "tip": "%s%s%s" % [str(person.get("name", short)), " has something to ask you" if Live.truthy(person.get("asks")) else "", ", %s" % str(person.doing) if person.get("doing") != null else ""]}))
			if others > 0:
				var crowd := "One other person" if others == 1 and named.is_empty() else ("%d other people" % others if named.is_empty() else ("and one other" if others == 1 else "and %d others" % others))
				rows.append(el("div", "here-crowd", [crowd]))
			body.append(_section("People", people.size(), rows))
		if not systems.is_empty():
			var chips: Array = []
			for one in systems:
				var part: Dictionary = one.part
				var word := str(part.get("word", ""))
				var called := str(PART_WORDS.get(str(part.get("kind", "")), "part"))
				if str(part.get("kind", "")) == "machine":
					called = str(one.get("name", "machine")).to_lower().trim_prefix("the ")
				var state := " ringing" if Live.truthy(part.get("ringing")) else ("" if Live.truthy(part.get("works")) else " down")
				chips.append(walk_to.call([el("span", "here-dot"), "%s%s" % [called, "" if USUAL.has(word) else " (%s)" % word]], "thing:%s" % str(one.id), "here-part%s" % state, {"tip": "%s, %s" % [str(one.name), word]}))
			body.append(_section("Systems", systems.size(), [el("div", "here-chips", chips)]))
		var note := _room_note(view.get("room"))
		if not note.is_empty():
			body.append(note)
		if not ways.is_empty():
			var rows: Array = []
			for way in ways:
				var row: Array = [el("span", "here-arrow", ["→"]), str(way.label)]
				if way.shut != "":
					row.append(el("span", "here-note", [" (%s)" % way.shut]))
				rows.append(walk_to.call(row, str(way.to), "here-row here-way%s" % (" shut" if way.shut != "" else ""), {}, bool(way.menu)))
			body.append(_section("Ways out", ways.size(), rows))
		var acts: Array = []
		for act in view.get("acts", []):
			var more := {"tip": str(act.get("detail", ""))}
			if _cannot() or Live.truthy(act.get("disabled")):
				more["d"] = 1
			acts.append(el("div", "", [here.button("", [str(act.label)], deed.bind(str(act.id), act.get("key")), more)]))
		if not acts.is_empty():
			body.append(_section("You can", 0, [el("div", "here-acts", acts)]))
		if message != "":
			body.append(el("div", "notice-inline fail", [message]))
		kids.append(el("div", "here-body", body))
	var wide := clampf(main.get_size().x * 0.24, 230.0, 310.0)
	here.most_high = maxf(120.0, main.get_size().y - main.top.size.y - 60.0)
	here.put(el("div", "con", kids), wide)


func _section(title: String, count: int, rows: Array) -> Dictionary:
	return el("div", "here-section", [el("div", "here-head", [el("span", "", [title])] + ([el("span", "", [str(count)])] if count > 0 else []))] + rows)


func _room_note(room: Variant) -> Dictionary:
	if typeof(room) != TYPE_DICTIONARY:
		return {}
	var notes: Array = []
	if typeof(room.get("alarm")) == TYPE_DICTIONARY:
		notes.append("The alarm's ringing%s." % (" in %s" % str(room.alarm.room) if room.alarm.get("room") != null else ""))
	if Live.truthy(room.get("dark")):
		notes.append("The lights are out in here.")
	if Live.truthy(room.get("thin")):
		notes.append("The air in here is %s (%d%%)." % ["bad" if float(room.get("air", 100)) < 30.0 else "thin", int(room.get("air", 100))])
	if Live.truthy(room.get("watched")):
		notes.append("A camera's watching this room.")
	if notes.is_empty():
		return {}
	return el("div", "room-note%s" % (" bad" if typeof(room.get("alarm")) == TYPE_DICTIONARY or float(room.get("air", 100)) < 30.0 else ""), [" ".join(notes)])


## How much of the room's right side the panel takes, for the story's words to keep clear of.
func cover() -> float:
	if main.sheet.open and main.sheet.console.visible:
		return main.sheet.console.size.x + 24.0
	return here.size.x + 24.0 if here.visible else 0.0


# ---- A thing's window -----------------------------------------------------------------------------------------------

func is_open() -> bool:
	return pane.visible or menu.visible


## Walking anywhere puts the windows away.
func put_away() -> void:
	if not thing.is_empty() or not menu_of.is_empty() or plan_open:
		thing = {}
		menu_of = {}
		plan_open = false
		_show_pane()
		_show_menu()


func open_thing(id: String) -> void:
	var one := find_thing(id)
	thing = one.duplicate() if not one.is_empty() else {}
	plan_open = false
	_show_pane()


## A closed door says why it's closed, straight away, and asking at it goes to the story.
func open_door(key: String) -> void:
	var door := find_exit(key)
	thing = {} if door.is_empty() else {"key": key, "name": door.label, "look": door.get("look"), "door": true, "locked": Live.truthy(door.get("locked")), "actions": door.get("actions"), "x": door.x, "y": door.y}
	plan_open = false
	_show_pane()


## Someone looked at: how they look, what their body shows, and what they're doing.
func look_at(person: Dictionary) -> void:
	var doing := "Asleep." if Live.truthy(person.get("asleep")) else _sentence(str(person.get("doing", "")) if person.get("doing") != null else "")
	var lines: Array = []
	for line in [person.get("look"), person.get("downLook"), person.get("marks"), null if Live.truthy(person.get("down")) else doing]:
		if line != null and str(line) != "":
			lines.append(str(line))
	thing = {"person": true, "key": person.key, "name": person.get("short", person.get("name", "")), "color": person.get("color"), "look": "\n".join(lines) if not lines.is_empty() else str(person.get("name", "")), "confirm": false}
	plan_open = false
	_show_pane()


func _sentence(words: String) -> String:
	return "" if words == "" else "%s%s." % [words.substr(0, 1).to_upper(), words.substr(1)]


func _theme(one: Dictionary) -> Dictionary:
	if one.has("person"):
		return Pal.person(Iso.hex(one.get("color"), "#a0a090"))
	if one.has("door"):
		return Pal.kind("red" if Live.truthy(one.get("locked")) else "amber")
	if typeof(one.get("part")) == TYPE_DICTIONARY:
		return Pal.kind("red" if Live.truthy(one.part.get("ringing")) else ("teal" if Live.truthy(one.part.get("works")) else "amber"))
	return Pal.kind("gold")


## What the game says comes with a tag in front, like [SYSTEMS] or [ITEM]; a window shows the words alone.
func _plain(text: Variant) -> Array:
	var lines: Array = []
	if text == null:
		return lines
	for line in str(text).split("\n"):
		var words := line.strip_edges()
		if words.begins_with("[") and words.contains("]"):
			words = words.substr(words.find("]") + 1).strip_edges()
		if words != "":
			lines.append(el("div", "", [words]))
	return lines


func _options(console: Console, choices: Array) -> Dictionary:
	var rows: Array = []
	for i in choices.size():
		var choice: Array = choices[i]
		var kids: Array = [el("span", "option-number", ["%d)" % (i + 1)]), el("span", "option-label", [str(choice[0])])]
		if choice.size() > 1 and str(choice[1]) != "":
			kids.append(el("span", "option-detail", [str(choice[1])]))
		var dead: bool = working or (choice.size() > 3 and bool(choice[3]))
		rows.append(console.button("option", kids, choice[2], {"d": 1} if dead else {}))
	return el("div", "options", rows)


## What can be done about what the window is about: [label, detail, what it does, whether it can't be].
func _choices() -> Array:
	var one := thing
	var shut := func() -> void: put_away()
	if one.has("person"):
		return _person_choices(one)
	var more: Array = []
	for act in one.get("does", []) if one.get("does") != null else []:
		more.append([str(act.label), str(act.get("detail", "")) if act.get("detail") != null else "", _do_with.bind(str(act.id)), Live.truthy(act.get("disabled"))])
	var is_part := typeof(one.get("part")) == TYPE_DICTIONARY
	var holds := Live.truthy(one.get("holds"))
	var open := ["Open", "look through it, beside your pack", _open_store]
	var have := Live.truthy(one.get("have"))
	var use := ["Ask to go through" if one.has("door") else "Use", "you're already carrying one" if have else "", _use, have]
	if not more.is_empty() and not is_part:
		var usual: Array = [open] if holds else ([] if Live.truthy(one.get("done")) or not Live.truthy(one.get("written")) else [use])
		return more + usual + [["Close", "", shut]]
	if holds:
		return [open, ["Close", "", shut]]
	if one.get("actions") != null or is_part:
		var acts: Array = []
		for action in one.get("actions", []) if one.get("actions") != null else []:
			acts.append([str(action.label), str(action.get("detail", "")) if action.get("detail") != null else "", _work.bind(str(action.id))])
		return acts + more + [["Close", "", shut]]
	return ([] if Live.truthy(one.get("done")) else [use]) + [["Close", "", shut]]


func _person_choices(one: Dictionary) -> Array:
	var person := find_person(str(one.key))
	var shut := func() -> void: put_away()
	if person.is_empty():
		return [["Close", "", shut]]
	var key := str(person.key)
	var to := "person:%s" % key
	var short := str(person.get("short", ""))
	var then := func(action: String) -> Callable: return func() -> void: go_to(to, func(_arrived: Variant) -> void: deed(action, key))
	var acts: Array = []
	for act in person.get("acts", []) if person.get("acts") != null else []:
		acts.append([str(act.label), str(act.get("detail", "")) if act.get("detail") != null else "", then.call(str(act.id)), Live.truthy(act.get("disabled"))])
	var registry := ["Registry", "print their record", func() -> void: main.sheet.show_page({"person": key})]
	if Live.truthy(person.get("down")):
		var carrying: bool = main.walk.get("carrying") != null
		var list: Array = []
		if Live.truthy(person.get("onCot")) and Live.truthy(person.get("awake")):
			list.append(["Talk", "beside the cot", go_to.bind(to)])
		list.append_array(acts)
		if str(person.get("carried", "")) == "you":
			list.append(["Put them down", "on a cot, in the medbay", deed.bind("putdown")])
		else:
			list.append(["Carry them", "they're dead" if Live.truthy(person.get("dead")) else ("you're carrying someone" if carrying else "slowly, to the medbay"), then.call("carry"), Live.truthy(person.get("dead")) or carrying or person.get("carried") != null or Live.truthy(person.get("onCot"))])
		return list + [registry, ["Close", "", shut]]
	if Live.truthy(one.get("confirm")):
		return [["Attack %s" % short, "it starts a fight, and everyone here sees it", then.call("attack")], ["Never mind", "", func() -> void:
			thing["confirm"] = false
			_show_pane()]]
	var list: Array = [["Talk", "", go_to.bind(to)]]
	if typeof(person.get("wants")) == TYPE_DICTIONARY:
		list.append([_give_label(person.wants), "what they'll pay for" if person.wants.get("sell") != null else "what they asked you for", then.call("give")])
	list.append_array(acts)
	list.append(registry)
	list.append(["Pickpocket", "they're watching their pockets" if Live.truthy(person.get("wary")) else (str(person.pocket) if person.get("pocket") != null else ""), then.call("pickpocket"), Live.truthy(person.get("wary"))])
	list.append(["Attack", "starts a fight", func() -> void:
		thing["confirm"] = true
		_show_pane()])
	list.append(["Close", "", shut])
	return list


func _give_label(wants: Dictionary) -> String:
	var n := int(wants.get("n", 1))
	var what := "the %s" % str(wants.name).to_lower() if n == 1 else "%d %ss" % [n, str(wants.name).to_lower()]
	return "Sell %s (%d cr)" % [what, int(wants.sell) * n] if wants.get("sell") != null else "Give %s" % what


func _show_pane() -> void:
	if thing.is_empty():
		pane.visible = false
		if plan_open:
			_show_plan()
		return
	var one := thing
	pane.begin(_theme(one))
	var word := ""
	if typeof(one.get("part")) == TYPE_DICTIONARY:
		word = str(one.part.get("word", ""))
	elif one.has("door"):
		word = "locked" if Live.truthy(one.get("locked")) else "closed"
	var title: Array = [el("span", "con-name", [str(one.get("name", ""))])]
	if word != "":
		title.append(el("span", "con-word", [word]))
	var kids: Array = [el("div", "con-title", title)]
	var said := _plain(one.get("said"))
	var look := _plain(one.get("look"))
	if not said.is_empty() or not look.is_empty():
		var words: Array = []
		if not said.is_empty():
			words.append(el("div", "con-said", said))
		if not look.is_empty():
			words.append(el("div", "con-look%s" % (" after" if not said.is_empty() else ""), look))
		kids.append(el("div", "con-words", words))
	kids.append(el("div", "con-title", [el("span", "con-name", ["Actions"])]))
	kids.append(_options(pane, _choices()))
	pane.most_high = main.get_size().y - main.top.size.y - 30.0
	pane.put(el("div", "con", kids), clampf(main.get_size().x * 0.3, 250.0, 330.0))
	pane.visible = true


func _use() -> void:
	var one := thing
	var said: Dictionary = await order({"action": "ask" if one.has("door") else "use", "key": one.key if one.has("door") else one.id})
	if thing != one:
		return
	if not said.ok:
		thing = one.duplicate()
		thing["look"] = said.error
		thing["done"] = true
	elif Live.truthy(said.get("check")) or Live.truthy(said.get("computer")):
		thing = {}
	else:
		thing = one.duplicate()
		thing["look"] = said.get("said")
		thing["done"] = true
		thing["have"] = Live.truthy(one.get("have")) or str(said.get("said", "")).begins_with("[ITEM]")
	_show_pane()


## Working a part or a locked door by hand: something free happens here and now, and anything that takes a check opens
## its window.
func _work(how: String) -> void:
	var one := thing
	var said: Dictionary = await order({"action": "work", "key": one.key if one.has("door") else one.id, "how": how})
	_answered(one, said)


## One of the things a thing does besides: the order goes to the room, and what comes of it is said in its window.
func _do_with(id: String) -> void:
	var one := thing
	var said: Dictionary = await order({"action": id, "key": one.id})
	_answered(one, said)


func _answered(one: Dictionary, said: Dictionary) -> void:
	if thing != one:
		return
	if not said.ok:
		thing = one.duplicate()
		thing["said"] = said.error
	elif Live.truthy(said.get("check")) or Live.truthy(said.get("computer")) or Live.truthy(said.get("combat")) or Live.truthy(said.get("opened")):
		thing = {}
		if Live.truthy(said.get("opened")):
			main.menus.open("inventory")
	else:
		var fresh := {} if one.has("door") else find_thing(str(one.id))
		thing = (fresh if not fresh.is_empty() else one).duplicate()
		thing["said"] = said.get("said")
	_show_pane()


## Something that holds things opens in the inventory, beside what the player carries.
func _open_store() -> void:
	var one := thing
	var answer: Dictionary = await main.link.ask("/api/bag", {"action": "open", "key": one.get("store")}, 30.0)
	if not answer.ok:
		thing = one.duplicate()
		thing["said"] = answer.error
		_show_pane()
		return
	put_away()
	main.menus.open("inventory")


# ---- The menu under the other mouse button --------------------------------------------------------------------------

## What a key from the room or the panel stands for, as it is now: { kind, ... } or {}.
func _target_of(key: String) -> Dictionary:
	var kind := key.get_slice(":", 0)
	var id := key.substr(kind.length() + 1)
	match kind:
		"person":
			var person := find_person(id)
			return {} if person.is_empty() else {"kind": kind, "person": person}
		"thing":
			var one := find_thing(id)
			return {} if one.is_empty() else {"kind": kind, "thing": one}
		"exit":
			var exit := find_exit(id)
			return {} if exit.is_empty() else {"kind": kind, "exit": exit}
		"floor":
			var bits := id.split(",")
			return {"kind": kind, "x": int(bits[0]), "y": int(bits[1])} if bits.size() == 2 else {}
	return {}


func open_menu(key: String, at: Vector2) -> void:
	if _cannot() or _target_of(key).is_empty():
		return
	menu_of = {"key": key, "at": at, "confirm": null}
	_show_menu()


## The menu for each kind of target: its title, its state, its colours and its choices (menuFor in walk.js). A choice
## is { label, detail, run, disabled, ask }.
func _menu_for(target: Dictionary) -> Dictionary:
	if target.kind == "person":
		var person: Dictionary = target.person
		var key := str(person.key)
		var to := "person:%s" % key
		var then := func(action: String) -> Callable: return func() -> void: go_to(to, func(_arrived: Variant) -> void: deed(action, key))
		var acts: Array = []
		for act in person.get("acts", []) if person.get("acts") != null else []:
			acts.append({"label": str(act.label), "detail": act.get("detail"), "disabled": Live.truthy(act.get("disabled")), "ask": act.get("ask"), "run": then.call(str(act.id))})
		var look := {"label": "Look", "run": look_at.bind(person)}
		var registry := {"label": "Registry", "detail": "print their record", "run": func() -> void: main.sheet.show_page({"person": key})}
		var items: Array = []
		var word := ""
		if Live.truthy(person.get("down")):
			var carrying: bool = main.walk.get("carrying") != null
			word = "dead" if Live.truthy(person.get("dead")) else ("carried" if str(person.get("carried", "")) == "you" else ("laid up" if Live.truthy(person.get("onCot")) else "down"))
			if Live.truthy(person.get("onCot")) and Live.truthy(person.get("awake")):
				items.append({"label": "Talk", "detail": "beside the cot", "run": go_to.bind(to)})
			items.append_array(acts)
			items.append(look)
			if str(person.get("carried", "")) == "you":
				items.append({"label": "Put them down", "detail": "on a cot, in the medbay", "run": deed.bind("putdown")})
			else:
				var cared := person.get("carried") != null or Live.truthy(person.get("onCot"))
				items.append({"label": "Carry them", "detail": "they're dead" if Live.truthy(person.get("dead")) else ("you're carrying someone" if carrying else ("they're being looked after" if cared else "slowly, to the medbay")), "disabled": Live.truthy(person.get("dead")) or carrying or cared, "run": then.call("carry")})
			items.append(registry)
		else:
			word = "asleep" if Live.truthy(person.get("asleep")) else ""
			items.append({"label": "Talk", "run": go_to.bind(to)})
			if typeof(person.get("wants")) == TYPE_DICTIONARY:
				items.append({"label": _give_label(person.wants), "detail": "what they'll pay for" if person.wants.get("sell") != null else "what they asked you for", "run": then.call("give")})
			items.append_array(acts)
			items.append(look)
			items.append(registry)
			items.append({"label": "Pickpocket", "detail": "they're watching their pockets" if Live.truthy(person.get("wary")) else person.get("pocket"), "disabled": Live.truthy(person.get("wary")), "run": then.call("pickpocket")})
			items.append({"label": "Attack", "detail": "starts a fight", "ask": "Attack %s? It starts a fight, and everyone here sees it." % str(person.get("short", "")), "run": then.call("attack")})
		return {"title": str(person.get("short", "")), "word": word, "colours": Pal.person(Iso.hex(person.get("color"), "#a0a090")), "items": items}
	if target.kind == "thing":
		var one: Dictionary = target.thing
		var id := str(one.id)
		var there := func(then: Callable) -> Callable: return func() -> void: go_to("thing:%s" % id, func(_arrived: Variant) -> void:
			open_thing(id)
			then.call())
		var does: Array = []
		for act in one.get("does", []) if one.get("does") != null else []:
			does.append({"label": str(act.label), "detail": act.get("detail"), "disabled": Live.truthy(act.get("disabled")), "run": there.call(_do_with.bind(str(act.id)))})
		var look := {"label": "Look", "run": open_thing.bind(id)}
		if typeof(one.get("part")) == TYPE_DICTIONARY:
			var items: Array = [look]
			for action in one.get("actions", []) if one.get("actions") != null else []:
				items.append({"label": str(action.label), "detail": action.get("detail"), "run": there.call(_work.bind(str(action.id)))})
			return {"title": str(one.name), "word": str(one.part.get("word", "")), "colours": _theme(one), "items": items + does}
		if Live.truthy(one.get("holds")):
			return {"title": str(one.name), "word": "", "colours": Pal.kind("gold"), "items": [look, {"label": "Open", "detail": "beside your pack", "run": there.call(_open_store)}] + does}
		var items: Array = [look]
		if Live.truthy(one.get("written")) or does.is_empty():
			items.append({"label": "Use", "detail": "you're already carrying one" if Live.truthy(one.get("have")) else "", "disabled": Live.truthy(one.get("have")), "run": there.call(_use)})
		return {"title": str(one.name), "word": "", "colours": Pal.kind("gold"), "items": items + does}
	if target.kind == "exit":
		var exit: Dictionary = target.exit
		var key := str(exit.key)
		var to := "exit:%s" % key
		var there := func(then: Callable) -> Callable: return func() -> void: go_to(to, func(_arrived: Variant) -> void:
			open_door(key)
			then.call())
		var look := {"label": "Look", "run": open_door.bind(key)}
		if Live.truthy(exit.get("locked")):
			var items: Array = [look]
			for action in exit.get("actions", []) if exit.get("actions") != null else []:
				items.append({"label": str(action.label), "detail": action.get("detail"), "run": there.call(_work.bind(str(action.id)))})
			return {"title": str(exit.label), "word": "locked", "colours": Pal.kind("red"), "items": items}
		if Live.truthy(exit.get("closed")):
			return {"title": str(exit.label), "word": "closed", "colours": Pal.kind("amber"), "items": [look, {"label": "Ask to go through", "run": there.call(_use)}]}
		return {"title": str(exit.label), "word": "", "colours": Pal.kind("green"), "items": [{"label": "Go through", "run": go_to.bind(to)}]}
	var items: Array = [{"label": "Walk here", "run": func() -> void: main._go({"action": "go", "x": int(target.x), "y": int(target.y)}, null)}]
	if typeof(main.walk.get("carrying")) == TYPE_DICTIONARY:
		var carried := find_person(str(main.walk.carrying.get("key", "")))
		if not carried.is_empty():
			items.append({"label": "Put %s down" % str(carried.get("short", "them")), "detail": "where you stand, or on a cot in the medbay", "run": deed.bind("putdown")})
	return {"title": "The floor", "word": "", "colours": Pal.kind("green"), "items": items}


func _show_menu() -> void:
	var target := {} if menu_of.is_empty() else _target_of(str(menu_of.key))
	if target.is_empty():
		menu_of = {}
		menu.visible = false
		return
	var spec := _menu_for(target)
	menu.begin(spec.colours)
	var title: Array = [el("span", "con-name", [str(spec.title)])]
	if str(spec.word) != "":
		title.append(el("span", "con-word", [str(spec.word)]))
	var kids: Array = [el("div", "con-title", title)]
	var choices: Array = []
	var confirm: Variant = menu_of.get("confirm")
	if typeof(confirm) == TYPE_DICTIONARY:
		kids.append(el("div", "con-ask", [str(confirm.ask)]))
		choices.append(["Attack %s" % str(spec.title) if str(confirm.label) == "Attack" else str(confirm.label), "", func() -> void:
			menu_of = {}
			_show_menu()
			(confirm.run as Callable).call()])
		choices.append(["Never mind", "", func() -> void:
			menu_of["confirm"] = null
			_show_menu()])
	else:
		for item in spec.items:
			var entry: Dictionary = item
			choices.append([str(entry.label), str(entry.detail) if entry.get("detail") != null else "", func() -> void:
				if entry.get("ask") != null:
					menu_of["confirm"] = entry
					_show_menu()
					return
				menu_of = {}
				_show_menu()
				(entry.run as Callable).call(), Live.truthy(entry.get("disabled"))])
	kids.append(_options(menu, choices))
	var wide := 190.0
	for choice in choices:
		wide = maxf(wide, 60.0 + (str(choice[0]).length() + str(choice[1]).length()) * 8.2)
	menu.put(el("div", "con", kids), minf(wide, 320.0))
	menu.visible = true
	var room: Vector2 = main.get_size()
	var at: Vector2 = menu_of.at
	menu.position = Vector2(clampf(at.x + 2.0, 4.0, maxf(4.0, room.x - menu.size.x - 4.0)), at.y + 2.0 if at.y + menu.size.y + 6.0 < room.y else maxf(4.0, at.y - menu.size.y - 2.0))


# ---- The plan of the place: its rooms, to walk to -------------------------------------------------------------------

func open_plan() -> void:
	thing = {}
	menu_of = {}
	plan_open = true
	main.story.put_away()
	_show_menu()
	_show_plan()


func _show_plan() -> void:
	var plan: Variant = main.walk.get("overview")
	if not plan_open or typeof(plan) != TYPE_DICTIONARY:
		plan_open = false
		pane.visible = false
		return
	pane.begin(Pal.kind("green"))
	var decks: Variant = plan.get("decks")
	var shown: Dictionary = plan
	if typeof(decks) == TYPE_ARRAY and not (decks as Array).is_empty():
		shown = decks[0]
		for deck in decks:
			if Live.truthy(deck.get("here")):
				shown = deck
		for deck in decks:
			if str(deck.id) == plan_deck:
				shown = deck
	var on_decks := typeof(decks) == TYPE_ARRAY
	var kids: Array = [el("div", "con-title", [el("span", "con-name", ["%s: %s" % [str(plan.get("title", "Map")), str(shown.get("name", ""))] if on_decks else str(plan.get("title", "Map"))])])]
	kids.append(el("div", "con-ask", ["Click a room to walk there. A room on another deck is reached by the stairs." if on_decks else "Click a room to walk there."]))
	if on_decks:
		var tabs: Array = []
		for deck in decks:
			var id := str(deck.id)
			tabs.append(pane.button("primary" if id == str(shown.id) else "", ["%s (you're here)" % str(deck.name) if Live.truthy(deck.get("here")) else str(deck.name)], func() -> void:
				plan_deck = id
				_show_plan()))
		kids.append(el("div", "plan-decks", tabs))
	var rows: Array = []
	for room in shown.get("rooms", []):
		var id := str(room.id)
		var who: Array = []
		if not (room.get("people", []) as Array).is_empty():
			who.append(", ".join(room.people))
		if int(room.get("others", 0)) > 0:
			who.append("%d other%s" % [int(room.others), "" if int(room.others) == 1 else "s"])
		var closed := Live.truthy(room.get("closed"))
		var row: Array = [el("span", "option-label", [str(room.name) + (" (you're here)" if Live.truthy(room.get("here")) else "")])]
		row.append(el("span", "option-detail", ["closed: you'd have to ask at the door" if closed else " and ".join(who)]))
		rows.append(pane.button("option", row, func() -> void:
			put_away()
			main._go({"action": "go", "to": "room:%s" % id} if on_decks else {"action": "room", "to": id}, null), {"d": 1} if closed else {}))
	rows.append(pane.button("option", [el("span", "option-label", ["Close"])], func() -> void: put_away()))
	kids.append(el("div", "options", rows))
	pane.most_high = main.get_size().y - main.top.size.y - 30.0
	pane.put(el("div", "con", kids), clampf(main.get_size().x * 0.4, 280.0, 460.0))
	pane.visible = true


# ---- Where the windows go, and the keys -----------------------------------------------------------------------------

func _place() -> void:
	var room: Vector2 = main.get_size()
	var roof: float = main.top.size.y + 8.0
	if here.visible:
		here.position = Vector2(room.x - here.size.x - 12.0, roof + 6.0)
	if not pane.visible:
		_aimed = false
		return
	if plan_open:
		_aimed = false
		pane.position = Vector2(maxf(8.0, (room.x - pane.size.x) / 2.0), roof + 20.0)
		return
	# Beside what it's about, on whichever side has the room, with a line to it.
	var at := Vector2.ZERO
	if thing.has("person"):
		var one: Variant = main.shown.get(str(thing.key))
		if one == null:
			_aimed = false
			return
		var c := Iso.centre(float(one.x), float(one.y))
		at = _screen(c.x, c.y, 0.9)
	elif thing.has("door"):
		var c := Iso.centre(float(thing.x), float(thing.y))
		at = _screen(c.x, c.y, 0.8)
	else:
		at = spot_of(thing)
	_target = at
	_aimed = true
	var right := at.x + 46.0
	var left := at.x - 46.0 - pane.size.x
	var free_right := room.x - (here.size.x + 20.0 if here.visible else 8.0)
	var x := right if right + pane.size.x <= free_right else (left if left >= 8.0 else clampf(right, 8.0, maxf(8.0, room.x - pane.size.x - 8.0)))
	pane.position = Vector2(x, clampf(at.y - pane.size.y * 0.4, roof, maxf(roof, room.y - pane.size.y - 8.0)))


## A number picks that choice of the open menu or window, and Esc puts it away.
func key(event: InputEventKey) -> bool:
	var console: Console = menu if menu.visible else (pane if pane.visible else null)
	if console == null:
		return false
	if event.physical_keycode == KEY_ESCAPE:
		if menu.visible:
			menu_of = {}
			_show_menu()
		else:
			put_away()
		return true
	if plan_open and not menu.visible:
		return false
	var n := int(event.physical_keycode) - KEY_0
	if n < 1 or n > 9:
		return false
	# The choices are the last buttons made, in their order.
	var options: Array = []
	_gather(console.page.tree, options)
	if n > options.size():
		return false
	var chosen: Dictionary = options[n - 1]
	if not chosen.has("d"):
		console.runs[int(chosen.id)].call()
	return true


func _gather(d: Variant, out: Array) -> void:
	if typeof(d) != TYPE_DICTIONARY:
		return
	if str(d.get("t", "")) == "button" and str(d.get("c", "")).begins_with("option"):
		out.append(d)
		return
	for k in d.get("k", []):
		_gather(k, out)
