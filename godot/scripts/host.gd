## A window whose insides the game builds itself, with the page's own code, and Godot only draws: the registry
## printout, the page a game ends on, and the making of a captain (src/godot-pages-worker.js builds each as it builds
## the menus; page.gd draws the tree). A click is sent back as the number of what was clicked.
class_name HostWindow
extends Control

## Which of the game's pages this is ("sheet", "ending", "creator"), its colours, how wide it is at most, and where it
## sits: "right" (down the right side, under the top bar), "middle", or "whole" (the whole window, over everything).
var main: Control
var on := "sheet"
var colours := Pal.kind("green")
var most_wide := 500.0
var where := "right"
## Whether its page is as tall as the window whatever is in it (the Story board, whose sheet takes up the room).
var fills := false
## What's done once it's been put away, if anything.
var after_close := Callable()
var console := RoomWindows.Console.new()
var shade := ColorRect.new()
var open := false
var _of := -1
var _busy := false
var _next: Array = []
var _look_in := 0.0
var _tree := {}
var _wide := -1.0


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.color = Color(0, 0, 0, 0.72)
	shade.visible = false
	add_child(shade)
	console.visible = false
	console.relay = func(id: int) -> void:
		# The chart program draws its chart in a way this window can't show: the Star map menu has the same chart, of
		# the same places, and sets the same course.
		if on == "computer" and console.page._said(_by_id(_tree, id)).strip_edges() == "Charts":
			main.menus.open("map")
			return
		ask({"op": "click", "id": id, "of": _of})
	console.relay_typed = func(id: int, value: String) -> void: ask({"op": "input", "id": id, "of": _of, "value": value})
	console.relay_pointed = func(id: int, how: String, at: Vector2) -> void: ask({"op": "pointer", "id": id, "of": _of, "events": [[how, roundf(at.x), roundf(at.y)]]})
	add_child(console)


## Opens it: more says which page of it, or whose.
func show_page(more := {}) -> void:
	var body := {"op": "open"}
	body.merge(more)
	if fills:
		# What's fitted to the window (a deck, in the Map editor) is fitted to this one.
		var room := Vector2(get_window().size)
		body["wide"] = int(room.x)
		body["high"] = int(room.y)
	open = true
	console.scrolled = 0.0
	ask(body)


func close() -> void:
	open = false
	console.visible = false
	shade.visible = false
	_tree = {}
	_next.clear()
	if after_close.is_valid():
		after_close.call()


## One thing is asked of the game at a time. Meanwhile, what's typed waits its turn (the last of it for each box), and
## so does the last thing clicked.
func ask(body: Dictionary) -> void:
	if main.link == null or not open:
		return
	if _busy:
		if body.op == "pointer":
			# The pointer's way across a picture is told whole, in one go, when its turn comes.
			if not _next.is_empty() and _next[-1].op == "pointer":
				(_next[-1].events as Array).append_array(body.events)
			else:
				_next.append(body)
		elif body.op != "look":
			var typed: bool = body.op == "input"
			_next = _next.filter(func(one: Dictionary) -> bool: return one.op == "pointer" or (one.op == "input") != typed or (typed and int(one.id) != int(body.id)))
			_next.append(body)
		return
	_busy = true
	body["on"] = on
	var answer: Dictionary = await main.link.ask("/api/godot/page", body, 40.0)
	_busy = false
	_look_in = 0.6 if fills else 1.5
	if not open:
		return
	if not answer.ok:
		main._message(str(answer.error))
	else:
		var said: Dictionary = answer.data
		if said.has("of"):
			_of = int(said.of)
		if Live.truthy(said.get("closed")) or (said.get("game") == false and on != "creator"):
			close()
		elif said.has("tree"):
			_tree = said.tree
			_put()
		if typeof(said.get("message")) == TYPE_DICTIONARY and not Live.truthy(said.message.get("ok")):
			main._message(str(said.message.text))
		main.menus.effects(said.get("effects", []), self)
		# What's done at a computer changes the room (a door locked, the lights cut): it's looked at again.
		if on == "computer" and body.op != "look":
			main._fetch_walk()
	if not _next.is_empty() and open:
		var next: Dictionary = _next.pop_front()
		if next.has("of"):
			next.of = _of
		ask(next)


func _by_id(d: Variant, id: int) -> Variant:
	if typeof(d) != TYPE_DICTIONARY:
		return ""
	if d.has("id") and int(d.id) == id:
		return d
	for k in d.get("k", []):
		var found: Variant = _by_id(k, id)
		if typeof(found) == TYPE_DICTIONARY:
			return found
	return ""


## A number picks that one of the page's listed choices (the ways on from an ending).
func pick(n: int) -> bool:
	var found: Array = []
	_listed(_tree, false, found)
	if n < 1 or n > found.size():
		return false
	if not found[n - 1].has("d"):
		ask({"op": "click", "id": int(found[n - 1].id), "of": _of})
	return true


func _listed(d: Variant, inside: bool, out: Array) -> void:
	if typeof(d) != TYPE_DICTIONARY:
		return
	if inside and str(d.get("t", "")) == "button" and d.has("id"):
		out.append(d)
		return
	var here := inside or (" %s " % str(d.get("c", ""))).contains(" options ")
	for k in d.get("k", []):
		_listed(k, here, out)


func _put() -> void:
	if _tree.is_empty():
		return
	var room: Vector2 = main.get_size() if where != "whole" else Vector2(get_window().size)
	var roof: float = main.top.size.y + 8.0 if where != "whole" else 0.0
	var wide := minf(room.x - 16.0, most_wide)
	console.colours = colours
	console.most_high = room.y - roof - 10.0
	console.page.room_high = console.most_high if fills else 0.0
	console.put(_tree, wide)
	console.visible = true
	shade.visible = where == "whole"
	shade.position = Vector2.ZERO
	shade.size = room
	match where:
		"right":
			console.position = Vector2(room.x - wide - 10.0, roof)
		"left":
			console.position = Vector2(10.0, roof)
		_:
			console.position = Vector2(round((room.x - wide) / 2.0), maxf(roof, round((room.y - console.size.y) / 2.5)))
	_wide = room.x


func _process(delta: float) -> void:
	if not open:
		return
	if console.visible and absf((main.get_size().x if where != "whole" else float(get_window().size.x)) - _wide) > 0.5:
		_put()
		if fills:
			ask({"op": "look", "wide": get_window().size.x, "high": get_window().size.y})
	# What the page works out a moment later (the mornings an ending offers) is looked for again.
	_look_in -= delta
	if _look_in <= 0.0 and not _busy:
		_look_in = 4.0
		ask({"op": "look"})
