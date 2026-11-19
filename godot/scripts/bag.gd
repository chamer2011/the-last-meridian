## The inventory, in Godot: the window public/bag.js draws, from the same view of what's carried (publicState's bag)
## and with the same orders (/api/bag). What's worn and in hand round a figure, the belt for a fight, the pockets and
## the pack as grids, the load, and beside the pack whatever's open: a locker, one of the ship's stores, a pile on the
## floor. Drag to move, double-click to put on, use or take, the other mouse button for more. Where a thing may go is
## the game's to say: this only offers what the page offers, and shows what the game answers.
class_name BagWindow
extends Control

const CELL := 26.0
const KINDS := {"weapon": "Weapon", "armor": "Armor", "consumable": "Supplies", "gadget": "Gadget", "goods": "Goods", "story": "Story item"}
const GEAR := ["weapon", "armor", "sidearm"]
const FIGURE := ["   .--.", "  (    )", "   `--'", " .-'  '-.", "/ |    | \\", "  |    |", "  |____|", "  /    \\", " /      \\"]
const ART := {"weapon": ["=[#]=-"], "armor": ["/\\_/\\", "|[ ]|"], "consumable": ["[+]"], "gadget": ["[*]"], "goods": ["[=]"], "story": ["<*>"]}
const GOLD := Color("f5d76e")
const HINT := "Drag to move   double-click to put on, use or take   the other mouse button for more   I or Esc closes"

var main: Control
var p := Pal.kind("green")
var bag := {}
var who := ""
var credits := 0
var body := {}
var on := false
var message := ""
var reading := {}
var menu := RoomWindows.Console.new()
var words := Label.new()

## What's drawn, for the pointer: items as { item, where, box, fitted }, slots and grids as { to, box, grid }, and
## buttons as { box, run }.
var _items: Array[Dictionary] = []
var _slots: Array[Dictionary] = []
var _grids: Array[Dictionary] = []
var _buttons: Array[Dictionary] = []
var _drag := {}
var _last := {"key": "", "at": 0}
var _sending := false
var _hover := -1


func _init() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	words.add_theme_font_override("font", Pal.MONO)
	words.add_theme_font_size_override("font_size", 12)
	words.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(words)
	menu.visible = false
	add_child(menu)


func toggle() -> void:
	if on:
		close()
	else:
		open()


func open() -> void:
	if main.link == null or main._blocked() != "" or main.fight.on or main.story.talking():
		main._message("Your inventory can't be opened just now.")
		return
	var answer: Dictionary = await main.link.ask("/api/godot/bag", null, 30.0)
	if not answer.ok or typeof(answer.data.get("bag")) != TYPE_DICTIONARY:
		main._message(str(answer.get("error", "Your inventory couldn't be opened.")))
		return
	_take(answer.data)
	on = true
	visible = true
	message = ""
	reading = {}
	main.room.put_away()
	main.story.put_away()
	_lay()


func close() -> void:
	if not on:
		return
	on = false
	visible = false
	menu.visible = false
	_drag = {}
	# Whatever was open beside the pack is shut again.
	if typeof(bag.get("open")) == TYPE_DICTIONARY:
		await main.link.ask("/api/bag", {"action": "close"}, 20.0)


func _take(said: Dictionary) -> void:
	var from: Dictionary = said.get("game", said)
	if typeof(from.get("bag")) == TYPE_DICTIONARY:
		bag = from.bag
	who = str(from.get("name", who))
	credits = int(from.get("credits", credits))
	if typeof(from.get("body")) == TYPE_DICTIONARY:
		body = from.body


func send(order: Dictionary, quiet := false) -> bool:
	if _sending:
		return false
	_sending = true
	menu.visible = false
	if not quiet:
		reading = {}
	var answer: Dictionary = await main.link.ask("/api/bag", order, 30.0)
	_sending = false
	if not answer.ok:
		message = str(answer.error)
		_lay()
		return false
	_take(answer.data)
	var said := str(answer.data.get("said", "")) if answer.data.get("said") != null else ""
	if said.begins_with("[") and said.contains("]"):
		said = said.substr(said.find("]") + 1).strip_edges()
	message = said
	main._took(answer.data)
	_lay()
	return true


# ---- Where everything is ---------------------------------------------------------------------------------------------

func _lay() -> void:
	_items.clear()
	_slots.clear()
	_grids.clear()
	_buttons.clear()
	if bag.is_empty():
		return
	var open_grid: Variant = bag.get("open")
	var has_open := typeof(open_grid) == TYPE_DICTIONARY
	var top := 26.0
	# On you: the figure, and what's worn, in hand, on the hip and on the belt.
	var figure := Vector2(11, top + 21)
	var gear: Dictionary = bag.get("gear", {})
	for slot in [["sidearm", Rect2(0, 13, 58, 30), "%d squares" % int(bag.get("sidearmSquares", 2))], ["weapon", Rect2(96, 13, 118, 30), "in hand"], ["armor", Rect2(0, 69, 70, 70), "worn"]]:
		var box := Rect2(figure + (slot[1] as Rect2).position, (slot[1] as Rect2).size)
		_slots.append({"to": {"at": slot[0]}, "box": box, "label": slot[2]})
		if typeof(gear.get(slot[0])) == TYPE_DICTIONARY:
			_items.append({"item": gear[slot[0]], "where": {"at": slot[0]}, "box": box.grow(-2), "fitted": true})
	var belt: Array = bag.get("belt", [])
	for i in belt.size():
		var box := Rect2(figure + Vector2(i * 34, 171), Vector2(30, 30))
		_slots.append({"to": {"at": "belt", "i": i}, "box": box, "label": str(i + 1)})
		if typeof(belt[i]) == TYPE_DICTIONARY:
			_items.append({"item": belt[i], "where": {"at": "belt", "i": i}, "box": box.grow(-2), "fitted": true})
	# The pockets, the pack and the load, down the middle; whatever's open, on the right.
	var x := 238.0
	var y := top
	for grid in [["pockets", "Pockets", "small things"], ["pack", "Pack", ""]]:
		var one: Dictionary = bag[grid[0]]
		y = _grid(one, str(grid[0]), str(grid[1]), str(grid[2]), Vector2(x, y)) + 6.0
	var load_at := y
	var high := load_at + 58.0
	var wide := x + 219.0 + 6.0
	if has_open:
		var end := _grid(open_grid, "open", str(open_grid.get("name", "")), "", Vector2(wide + 2.0, top))
		var take := Rect2(wide + 2.0, end + 6.0, 150, 18)
		_buttons.append({"box": take, "words": "Take everything", "run": _take_all, "off": (open_grid.get("items", []) as Array).is_empty()})
		high = maxf(high, take.end.y + 4.0)
		wide += maxf(maxf(float(open_grid.cols) * CELL + 11.0, 156.0), Pal.MONO.get_string_size(str(open_grid.get("name", "")), HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 90.0) + 8.0
	high = maxf(high, top + 16.0 + 214.0 + 6.0)
	# Things in hand with no room for them.
	var loose: Array = bag.get("loose", [])
	for i in loose.size():
		_items.append({"item": loose[i], "where": {"at": "loose", "id": loose[i].id}, "box": Rect2(12.0 + i * 60.0, high + 16.0, 54, 28), "fitted": true})
	if not loose.is_empty():
		high += 50.0
	set_meta("load_at", load_at)
	set_meta("loose_at", high - 50.0 if not loose.is_empty() else -1.0)
	_buttons.append({"box": Rect2(wide - 74.0, 2, 68, 16), "words": "Close", "run": close, "title": true})
	# What was last said, or what's being read, or how it's worked.
	words.text = ("%s\n%s" % [str(reading.name).to_upper(), str(reading.words)]) if not reading.is_empty() else (message if message != "" else HINT)
	words.add_theme_color_override("font_color", p.bright if message != "" or not reading.is_empty() else p.dim)
	words.position = Vector2(8, high + 4.0)
	words.size = Vector2(wide - 16.0, 0)
	words.size.y = words.get_minimum_size().y
	var foot := high + 4.0 + maxf(16.0, words.get_minimum_size().y) + 4.0
	if not reading.is_empty():
		_buttons.append({"box": Rect2(8, foot, 130, 18), "words": "Done reading", "run": func() -> void:
			reading = {}
			_lay()})
		foot += 22.0
	size = Vector2(wide, foot)
	var room: Vector2 = main.get_size()
	position = Vector2(clampf((room.x - size.x) / 2.0 - 60.0, 8.0, maxf(8.0, room.x - size.x - 8.0)), main.top.size.y + 26.0)
	queue_redraw()


## A grid's panel: its title, its squares and what's in them. Gives back where it ends.
func _grid(grid: Dictionary, name: String, title: String, note: String, at: Vector2) -> float:
	var cols := int(grid.cols)
	var rows := int(grid.rows)
	var used := 0
	for item in grid.get("items", []):
		used += int(item.w) * int(item.h)
	var inner := Rect2(at + Vector2(5, 21), Vector2(cols * CELL + 1.0, rows * CELL + 1.0))
	_grids.append({"name": name, "grid": grid, "box": inner, "title": title, "note": note if note != "" else "%d of %d" % [used, cols * rows], "panel": Rect2(at, Vector2(maxf(inner.size.x + 10.0, 219.0 if name != "open" else Pal.MONO.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 90.0), inner.size.y + 26.0))})
	for item in grid.get("items", []):
		_items.append({"item": item, "where": {"at": name, "x": int(item.x), "y": int(item.y)}, "box": Rect2(inner.position + Vector2(float(item.x) * CELL + 1.0, float(item.y) * CELL + 1.0), Vector2(float(item.w) * CELL - 2.0, float(item.h) * CELL - 2.0)), "fitted": false})
	return at.y + inner.size.y + 26.0


# ---- Drawing ---------------------------------------------------------------------------------------------------------

func _text(at: Vector2, text: String, colour: Color, size := 12, bold := false) -> void:
	draw_string(Pal.MONO_BOLD if bold else Pal.MONO, at + Vector2(0, size), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, colour)


func _panel(box: Rect2, title: String, note: String) -> void:
	draw_rect(box, p.panel)
	draw_rect(Rect2(box.position, Vector2(box.size.x, 16)), Color(p.c, 0.18))
	draw_rect(box.grow(-0.5), p.line, false, 1.0)
	_text(box.position + Vector2(6, 0), title, p.bright, 12)
	if note != "":
		var wide := Pal.MONO.get_string_size(note, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
		_text(Vector2(box.end.x - wide - 6.0, box.position.y), note, p.dim, 12)


func _item(entry: Dictionary, at: Rect2, alpha := 1.0) -> void:
	var item: Dictionary = entry.item
	var story := str(item.get("type", "")) == "story"
	var lit: bool = _hover >= 0 and _hover < _items.size() and _items[_hover] == entry and _drag.is_empty()
	draw_rect(at, Color(p.c, 0.18 * alpha) if lit else Color(0, 0, 0, 0.55 * alpha))
	draw_rect(at.grow(-0.5), Color(GOLD.darkened(0.5) if story else (p.dim if lit else p.line), alpha), false, 1.0)
	var art: Array = item.art if typeof(item.get("art")) == TYPE_ARRAY and not (item.art as Array).is_empty() else ART.get(str(item.get("type", "")), ["[?]"])
	var size := 8 if entry.fitted else 9
	for i in art.size():
		_text(at.position + Vector2(3, 1 + i * (size + 1)), str(art[i]), Color(GOLD if story else p.c, alpha), size)
	if not entry.fitted and int(item.w) > 1:
		_text(Vector2(at.position.x + 2, at.end.y - 11), str(item.name).left(int(at.size.x / 5.0) - 3), Color(p.dim, alpha), 8)
	if int(item.get("n", 1)) > 1:
		var count := "x%d" % int(item.n)
		_text(Vector2(at.end.x - count.length() * 5.2 - 1, at.end.y - 11), count, Color(p.bright, alpha), 8)


func _draw() -> void:
	if bag.is_empty():
		return
	draw_rect(Rect2(Vector2.ZERO, size), Color(p.bg, 0.96))
	draw_rect(Rect2(Vector2(0.5, 0.5), size - Vector2.ONE), p.c, false, 1.0)
	draw_rect(Rect2(0, 0, size.x, 20), p.c)
	_text(Vector2(10, 2), "INVENTORY", p.bg, 13, true)
	_text(Vector2(100, 3), who, p.bg, 12)
	var money := "CR %d" % credits
	_text(Vector2(size.x - 84.0 - money.length() * 7.4, 3), money, p.bg, 12, true)
	# On you.
	var status := str(body.get("status", "")) if body.get("status") != null else ""
	if body.get("blood") != null and float(body.blood) < 100.0:
		status += "%sblood %d" % [", " if status != "" else "", int(body.blood)]
	_panel(Rect2(6, 26, 224, 236), "On you", status)
	var figure := Vector2(11, 47)
	for i in FIGURE.size():
		_text(figure + Vector2(108, 54 + i * 12), FIGURE[i], p.dim, 12)
	_text(figure + Vector2(0, 0), "Sidearm", p.dim, 10)
	_text(figure + Vector2(96, 0), "Weapon", p.dim, 10)
	_text(figure + Vector2(0, 56), "Armor", p.dim, 10)
	_text(figure + Vector2(0, 158), "Belt, for a fight", p.dim, 10)
	var target: Dictionary = _drag.get("target", {})
	for slot in _slots:
		var box: Rect2 = slot.box
		var aimed: bool = not target.is_empty() and target.get("to") == slot.to
		draw_rect(box, Color(p.c, 0.22) if aimed and target.ok else (Color(1, 0.56, 0.5, 0.16) if aimed else Color(0, 0, 0, 0.3)))
		draw_rect(box.grow(-0.5), p.bright if aimed and target.ok else (Color("ff8f7f") if aimed else p.line), false, 1.0)
		var full := false
		for entry in _items:
			if entry.where == slot.to:
				full = true
		if not full:
			var label := str(slot.label)
			_text(box.position + Vector2((box.size.x - label.length() * 5.4) / 2.0, (box.size.y - 11.0) / 2.0), label, p.dim, 9)
	for grid in _grids:
		_panel(grid.panel, str(grid.title), str(grid.note))
		var box: Rect2 = grid.box
		draw_rect(box, Color(0, 0, 0, 0.3))
		for c in int(grid.grid.cols) + 1:
			draw_line(box.position + Vector2(c * CELL + 0.5, 0), box.position + Vector2(c * CELL + 0.5, box.size.y), Color(p.line, 0.6), 1.0)
		for r in int(grid.grid.rows) + 1:
			draw_line(box.position + Vector2(0, r * CELL + 0.5), box.position + Vector2(box.size.x, r * CELL + 0.5), Color(p.line, 0.6), 1.0)
		if not target.is_empty() and str(target.to.get("at", "")) == str(grid.name) and target.has("x"):
			var item: Dictionary = _drag.item
			var drop := Rect2(box.position + Vector2(float(target.x) * CELL, float(target.y) * CELL), Vector2(float(item.w) * CELL + 1.0, float(item.h) * CELL + 1.0))
			draw_rect(drop, Color(p.c, 0.22) if target.ok else Color(1, 0.56, 0.5, 0.2))
			draw_rect(drop.grow(-0.5), p.bright if target.ok else Color("ff8f7f"), false, 1.0)
	# The load.
	var load_at: float = get_meta("load_at", 0.0)
	_panel(Rect2(238, load_at, 219, 54), "Load", "%s of %s kg" % [str(bag.get("load", 0)), str(bag.get("maxLoad", 0))])
	var heavy := Live.truthy(bag.get("overloaded"))
	var filled := clampi(int(round(float(bag.get("load", 0)) / maxf(1.0, float(bag.get("maxLoad", 1))) * 16.0)), 0, 16)
	_text(Vector2(244, load_at + 20), "[%s" % "#".repeat(filled), Color("ffc466") if heavy else p.c, 12)
	_text(Vector2(244 + (filled + 1) * 7.05, load_at + 20), "%s]" % "-".repeat(16 - filled), p.line, 12)
	var times := "twice" if int(bag.get("tiring", 2)) == 2 else "%d times" % int(bag.get("tiring", 2))
	_text(Vector2(244, load_at + 36), ("Too heavy: you tire %s as fast." % times) if heavy else ("Over %s kg, you tire %s as fast." % [str(bag.get("maxLoad", 0)), times]), Color("ffc466") if heavy else p.dim, 10)
	var loose_at: float = get_meta("loose_at", -1.0)
	if loose_at >= 0.0:
		_text(Vector2(10, loose_at), "In your hands, with no room for them:", p.dim, 10)
	for entry in _items:
		_item(entry, entry.box, 0.25 if not _drag.is_empty() and _drag.get("moved", false) and _drag.entry == entry else 1.0)
	for i in _buttons.size():
		var button: Dictionary = _buttons[i]
		var box: Rect2 = button.box
		var lit: bool = _hover == -2 - i and not Live.truthy(button.get("off"))
		var on_title: bool = button.get("title", false)
		if lit:
			draw_rect(box, p.bg if on_title else p.c)
		var colour: Color = (p.c if lit else p.bg) if on_title else (p.dim if Live.truthy(button.get("off")) else (p.bg if lit else p.bright))
		_text(box.position + Vector2(2, 1), "[ %s ]" % str(button.words), colour, 12, on_title)
	draw_line(Vector2(0, words.position.y - 2.5), Vector2(size.x, words.position.y - 2.5), p.line, 1.0)
	# What's being carried across, under the pointer.
	if not _drag.is_empty() and _drag.get("moved", false):
		var item: Dictionary = _drag.item
		var at: Vector2 = _drag.at - (_drag.grab as Vector2) * CELL
		_item({"item": item, "fitted": false}, Rect2(at, Vector2(float(item.w) * CELL - 2.0, float(item.h) * CELL - 2.0)), 0.92)


# ---- The pointer and the keys ----------------------------------------------------------------------------------------

func _item_at(point: Vector2) -> int:
	for i in range(_items.size() - 1, -1, -1):
		if (_items[i].box as Rect2).has_point(point):
			return i
	return -1


func _key_of(where: Dictionary) -> String:
	return "%s:%s:%s:%s:%s" % [where.get("at"), where.get("x"), where.get("y"), where.get("i"), where.get("id")]


## Where what's being dragged would go, and whether it may (targetAt in bag.js): the game still has the last word.
func _target_at(point: Vector2) -> Dictionary:
	var item: Dictionary = _drag.item
	var where: Dictionary = _drag.where
	for slot in _slots:
		if not (slot.box as Rect2).has_point(point):
			continue
		var to: Dictionary = slot.to
		if str(to.at) == "belt":
			var there: Variant = (bag.belt as Array)[int(to.i)]
			var room := typeof(there) != TYPE_DICTIONARY or (str(there.id) == str(item.id) and int(there.n) < int(there.stack))
			return {"to": to, "ok": str(item.type) == "consumable" and room and not (str(where.at) == "belt" and int(where.get("i", -1)) == int(to.i))}
		var fits := str(item.type) == str(to.at) if str(to.at) != "sidearm" else (str(item.type) == "weapon" and int(item.w) * int(item.h) <= int(bag.get("sidearmSquares", 2)))
		return {"to": to, "ok": fits and str(where.at) != str(to.at)}
	for grid in _grids:
		var box: Rect2 = grid.box
		if not box.grow(4.0).has_point(point):
			continue
		var name := str(grid.name)
		var one: Dictionary = grid.grid
		var x := int(round((point.x - box.position.x) / CELL - (_drag.grab as Vector2).x))
		var y := int(round((point.y - box.position.y) / CELL - (_drag.grab as Vector2).y))
		var same := str(where.at) == name and int(where.get("x", -9)) == x and int(where.get("y", -9)) == y
		var onto := false
		var clear := true
		for other in one.get("items", []):
			var is_self := str(where.at) == name and int(other.x) == int(where.get("x", -9)) and int(other.y) == int(where.get("y", -9))
			if is_self:
				continue
			if int(other.x) == x and int(other.y) == y and str(other.id) == str(item.id) and int(other.n) < int(other.stack):
				onto = true
			if x < int(other.x) + int(other.w) and int(other.x) < x + int(item.w) and y < int(other.y) + int(other.h) and int(other.y) < y + int(item.h):
				clear = false
		var inside := x >= 0 and y >= 0 and x + int(item.w) <= int(one.cols) and y + int(item.h) <= int(one.rows)
		var small := name != "pockets" or int(item.w) * int(item.h) == 1
		return {"to": {"at": name, "x": x, "y": y}, "x": x, "y": y, "ok": not same and (onto or (inside and clear and small))}
	return {}


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var now := _item_at(event.position)
		for i in _buttons.size():
			if (_buttons[i].box as Rect2).has_point(event.position):
				now = -2 - i
		if not _drag.is_empty():
			if not _drag.moved and (event.position - (_drag.start as Vector2)).length() >= 4.0:
				_drag["moved"] = true
				menu.visible = false
			if _drag.moved:
				_drag["at"] = event.position
				_drag["target"] = _target_at(event.position)
		if now != _hover or not _drag.is_empty():
			_hover = now
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			if menu.visible:
				menu.visible = false
			for button in _buttons:
				if (button.box as Rect2).has_point(event.position) and not Live.truthy(button.get("off")):
					(button.run as Callable).call()
					accept_event()
					return
			var i := _item_at(event.position)
			if i >= 0 and not _sending:
				var entry := _items[i]
				var box: Rect2 = entry.box
				_drag = {"entry": entry, "item": entry.item, "where": entry.where, "start": event.position, "at": event.position, "moved": false, "target": {}, "grab": Vector2(0.5, 0.5) if entry.fitted else (event.position - box.position) / CELL}
		elif not _drag.is_empty():
			var ended := _drag
			_drag = {}
			if not ended.moved:
				_clicked(ended.item, ended.where)
			elif (ended.target as Dictionary).is_empty():
				pass
			elif not ended.target.ok:
				message = "The %s doesn't go there." % str(ended.item.name)
				_lay()
			else:
				send({"action": "move", "from": ended.where, "to": ended.target.to})
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		var i := _item_at(event.position)
		if i >= 0:
			_open_menu(_items[i].item, _items[i].where, event.position)
	accept_event()


## A double click does the usual thing with it: take it, take it off, use it, put it on, read it.
func _clicked(item: Dictionary, where: Dictionary) -> void:
	var key := _key_of(where)
	var now := Time.get_ticks_msec()
	var twice: bool = _last.key == key and now - int(_last.at) < 420
	_last = {"key": "" if twice else key, "at": now}
	if not twice:
		return
	var at := str(where.at)
	var kind := str(item.get("type", ""))
	if at == "open":
		send({"action": "take", "from": where})
	elif GEAR.has(at):
		send({"action": "stow", "from": where})
	elif kind == "consumable":
		send({"action": "use", "from": where})
	elif kind == "weapon" or kind == "armor":
		send({"action": "equip", "from": where})
	elif str(item.get("id", "")) == "rig":
		close()
		main.menus.open("rig")
	elif item.get("read") != null:
		_read(item, where)


func _read(item: Dictionary, where: Dictionary) -> void:
	if await send({"action": "read", "from": where}, true):
		reading = {"name": item.name, "words": item.read}
		_lay()


func _take_all() -> void:
	while typeof(bag.get("open")) == TYPE_DICTIONARY and not (bag.open.get("items", []) as Array).is_empty():
		var item: Dictionary = bag.open.items[0]
		if not await send({"action": "take", "from": {"at": "open", "x": int(item.x), "y": int(item.y)}}):
			break


## What can be done with a thing, under the other mouse button (choicesFor in bag.js).
func _open_menu(item: Dictionary, where: Dictionary, at: Vector2) -> void:
	var kind := str(item.get("type", ""))
	var place := str(where.at)
	var look := ["Look", "", func() -> void:
		menu.visible = false
		message = "%s: %s" % [str(item.name), str(item.get("desc", ""))]
		_lay()]
	var choices: Array = []
	if place == "open":
		choices.append(["Take", "", send.bind({"action": "take", "from": where})])
		if item.get("read") != null:
			choices.append(["Read", "", _read.bind(item, where)])
	else:
		if str(item.get("id", "")) == "rig":
			choices.append(["Open the rig", "", func() -> void:
				close()
				main.menus.open("rig")])
		if GEAR.has(place):
			choices.append(["Take off", "", send.bind({"action": "stow", "from": where})])
		elif kind == "weapon" or kind == "armor":
			choices.append(["Put on", "", send.bind({"action": "equip", "from": where})])
		if item.get("read") != null:
			choices.append(["Read", "", _read.bind(item, where)])
		if kind == "consumable":
			choices.append(["Use", "", send.bind({"action": "use", "from": where})])
			choices.append(["Off the belt", "", send.bind({"action": "stow", "from": where})] if place == "belt" else ["To the belt", "", send.bind({"action": "equip", "from": where})])
		if int(item.get("n", 1)) > 1 and (place == "pockets" or place == "pack"):
			choices.append(["Split the stack", "", send.bind({"action": "split", "from": where})])
		if not (kind == "story" and not Live.truthy(item.get("price"))):
			var into := "Put it down"
			if typeof(bag.get("open")) == TYPE_DICTIONARY:
				var name := str(bag.open.get("name", ""))
				for word in ["The ", "A ", "An "]:
					if name.begins_with(word):
						name = name.substr(0, 1).to_lower() + name.substr(1)
				into = "Put in %s" % name
			choices.append([into, "", send.bind({"action": "drop", "from": where})])
	choices.append(look)
	menu.begin(p)
	menu.put(RoomWindows.el("div", "con", [RoomWindows.el("div", "con-title", [RoomWindows.el("span", "con-name", [str(item.name)])]), main.room._options(menu, choices)]), clampf(70.0 + choices.reduce(func(most: int, choice: Array) -> int: return maxi(most, str(choice[0]).length()), 0) * 8.6, 190.0, 330.0))
	menu.position = Vector2(clampf(at.x + 4.0, 2.0, maxf(2.0, size.x - menu.size.x - 2.0)), clampf(at.y + 4.0, 2.0, maxf(2.0, size.y - menu.size.y - 2.0)))
	menu.visible = true


func _get_tooltip(at_position: Vector2) -> String:
	var i := _item_at(at_position)
	if i < 0 or not _drag.is_empty() or menu.visible:
		return ""
	var item: Dictionary = _items[i].item
	var kind := str(item.get("type", ""))
	var word := "Clothes" if kind == "armor" and not Live.truthy(item.get("defense")) else str(KINDS.get(kind, "Item"))
	var lines: Array = ["%s%s" % [str(item.name).to_upper(), " x%d" % int(item.n) if int(item.get("n", 1)) > 1 else ""], "%s, %dx%d, %s kg%s" % [word, int(item.w), int(item.h), str(item.get("weight", 0)), ", %d to a square" % int(item.stack) if int(item.get("stack", 1)) > 1 else ""]]
	if typeof(item.get("damage")) == TYPE_ARRAY:
		lines.append("Damage %d-%d%s" % [int(item.damage[0]), int(item.damage[1]), ", fits on the hip" if Live.truthy(item.get("sidearm")) else ""])
	elif Live.truthy(item.get("defense")):
		lines.append("Defense +%d" % int(item.defense))
	elif typeof(item.get("effect")) == TYPE_DICTIONARY:
		var does: Array = []
		for key in item.effect:
			var amount := int(item.effect[key])
			does.append("-%d stress" % amount if key == "stress" else (("dresses %d wounds" % amount if amount > 1 else "dresses a wound") if key == "dress" else "+%d %s" % [amount, "health" if key == "hp" else key]))
		lines.append("%s%s" % [", ".join(does), ", usable in a fight from the belt" if Live.truthy(item.get("fight")) else ""])
	elif item.get("read") != null:
		lines.append("Something's written on it: the other mouse button, then Read")
	if item.get("worth") != null:
		lines.append(str(item.worth))
	if item.get("desc") != null:
		lines.append(str(item.desc))
	return "\n".join(lines)


func _make_custom_tooltip(for_text: String) -> Object:
	return Pal.tip(for_text, p)


func _process(_delta: float) -> void:
	# A fight, a check, a talk or a computer puts it away.
	if on and (main._blocked() != "" or main.fight.on or main.story.talking()):
		close()


## I opens it and shuts it; Esc shuts it, or its menu first; a number picks from the menu.
func key(event: InputEventKey) -> bool:
	var code := event.physical_keycode
	if on and menu.visible:
		if code == KEY_ESCAPE:
			menu.visible = false
			return true
		var rows: Array = []
		main.room._gather(menu.page.tree, rows)
		var n := int(code) - KEY_0
		if n >= 1 and n <= rows.size():
			menu.runs[int(rows[n - 1].id)].call()
			return true
	if on and code == KEY_ESCAPE:
		close()
		return true
	if code == KEY_I and main.menus.open_id == "":
		toggle()
		return true
	return on
