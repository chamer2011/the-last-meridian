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
var console := RoomWindows.Console.new()
var shade := ColorRect.new()
var open := false
var _of := -1
var _busy := false
var _next: Variant = null
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
	console.relay = func(id: int) -> void: ask({"op": "click", "id": id, "of": _of})
	console.relay_typed = func(id: int, value: String) -> void: ask({"op": "input", "id": id, "of": _of, "value": value})
	add_child(console)


## Opens it: more says which page of it, or whose.
func show_page(more := {}) -> void:
	var body := {"op": "open"}
	body.merge(more)
	open = true
	console.scrolled = 0.0
	ask(body)


func close() -> void:
	open = false
	console.visible = false
	shade.visible = false
	_tree = {}


## One thing is asked of the game at a time; what's clicked meanwhile is asked next.
func ask(body: Dictionary) -> void:
	if main.link == null or not open:
		return
	if _busy:
		if body.op != "look":
			_next = body
		return
	_busy = true
	body["on"] = on
	var answer: Dictionary = await main.link.ask("/api/godot/page", body, 40.0)
	_busy = false
	_look_in = 1.5
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
	if _next != null and open:
		var next: Dictionary = _next
		_next = null
		if next.has("of"):
			next.of = _of
		ask(next)


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
	console.put(_tree, wide)
	console.visible = true
	shade.visible = where == "whole"
	shade.position = Vector2.ZERO
	shade.size = room
	match where:
		"right":
			console.position = Vector2(room.x - wide - 10.0, roof)
		_:
			console.position = Vector2(round((room.x - wide) / 2.0), maxf(roof, round((room.y - console.size.y) / 2.5)))
	_wide = room.x


func _process(delta: float) -> void:
	if not open:
		return
	if console.visible and absf((main.get_size().x if where != "whole" else float(get_window().size.x)) - _wide) > 0.5:
		_put()
	# What the page works out a moment later (the mornings an ending offers) is looked for again.
	_look_in -= delta
	if _look_in <= 0.0 and not _busy:
		_look_in = 4.0
		ask({"op": "look"})
