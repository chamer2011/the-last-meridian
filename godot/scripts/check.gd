## A skill check's window, in Godot: the set of consoles the game's own page shows (public/check.js), themed to the
## skill, with everything clickable and the commands numbered. The game decides everything and this draws what it
## says: the view comes from the game (/api/godot/check), each command goes to it by the page's own route
## (/api/check), and how it came out is shown with what can be done next. Nothing here is a race against the clock.
class_name CheckWindow
extends Control

const KEYS := {KEY_LEFT: "ArrowLeft", KEY_RIGHT: "ArrowRight", KEY_UP: "ArrowUp", KEY_DOWN: "ArrowDown", KEY_ENTER: "Enter", KEY_KP_ENTER: "Enter", KEY_SPACE: " "}
const LOG_LINES := 12

var main: Control
var console := RoomWindows.Console.new()
## The check as the game last gave it, or {}; how it came out, or {}; and what's wrong, if a command was refused.
var view := {}
var outcome := {}
var message := ""
var on := false
var story_waits := false
var _asking := false
var _sending := false
var _seen := -1.0


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	console.visible = false
	add_child(console)


static func el(tag: String, classes: String, kids: Array = [], more := {}) -> Dictionary:
	return RoomWindows.el(tag, classes, kids, more)


## The game says there's a check: its window is asked for, once.
func wake() -> void:
	if on or _asking or not outcome.is_empty():
		return
	_asking = true
	var answer: Dictionary = await main.link.ask("/api/godot/check", null, 30.0)
	_asking = false
	if not answer.ok or typeof(answer.data.get("check")) != TYPE_DICTIONARY:
		return
	view = answer.data.check
	story_waits = Live.truthy(answer.data.get("storyWaiting"))
	on = true
	message = ""
	main.room.put_away()
	_show()


## The game says there's none: the window goes, unless it's showing how the last one came out.
func none() -> void:
	if on and outcome.is_empty() and not _sending:
		on = false
		view = {}
		console.visible = false


func reset() -> void:
	on = false
	view = {}
	outcome = {}
	console.visible = false


func send(command: String) -> void:
	if _sending or view.is_empty() or not outcome.is_empty():
		return
	_sending = true
	message = ""
	var answer: Dictionary = await main.link.ask("/api/check", {"command": command}, 40.0)
	_sending = false
	if not answer.ok:
		message = str(answer.error)
		_show()
		return
	var said: Dictionary = answer.data
	var game: Dictionary = said.get("game", {})
	story_waits = Live.truthy(game.get("storyWaiting"))
	if Live.truthy(said.get("over")):
		view = {}
		# A hack that got in goes straight to the computer.
		if game.get("computer") != null or typeof(said.get("outcome")) != TYPE_DICTIONARY:
			reset()
		else:
			outcome = said.outcome
		main._took(said)
	elif typeof(game.get("check")) == TYPE_DICTIONARY:
		view = game.check
	_show()


func _close() -> void:
	reset()
	main._fetch_walk()


func _piece(piece: Variant) -> Variant:
	if typeof(piece) != TYPE_DICTIONARY:
		return str(piece)
	if piece.get("cmd") != null:
		var more := {"d": 1} if _sending else {}
		if piece.get("title") != null:
			more["tip"] = str(piece.title)
		return console.button("check-link tone-%s" % str(piece.get("tone", "link")), [str(piece.t)], send.bind(str(piece.cmd)), more)
	return el("span", "tone-%s" % str(piece.get("tone", "info")), [str(piece.t)])


func _panel(panel: Dictionary, log: Array) -> Dictionary:
	var lines: Array = []
	if Live.truthy(panel.get("terminal")):
		# The latest of what's been said: the console keeps the last lines in view.
		for i in range(maxi(0, log.size() - LOG_LINES), log.size()):
			var entry: Dictionary = log[i]
			if entry.has("you"):
				lines.append(el("div", "check-line", [el("span", "tone-dim", ["%s " % str(view.get("prompt", ">"))]), el("span", "tone-bright", [str(entry.you)])]))
			else:
				lines.append(el("div", "check-line tone-%s" % str(entry.get("tone", "info")), [str(entry.get("text", ""))]))
		while lines.size() < 6:
			lines.append(el("div", "check-line", []))
	else:
		for line in panel.get("lines", []):
			var pieces: Array = line if typeof(line) == TYPE_ARRAY else [line]
			lines.append(el("div", "check-line", pieces.map(_piece)))
	return el("div", "check-panel", [
		el("div", "check-panel-title", [el("span", "", [str(panel.get("title", ""))]), el("span", "check-panel-marks", ["_ [] X"])]),
		el("div", "check-panel-body%s" % (" grid" if Live.truthy(panel.get("grid")) else ""), lines)])


func _hardness(of: Dictionary) -> String:
	var words := str(of.classLabel) if of.get("classLabel") != null else str(of.get("difficulty", "")).replace("_", " ")
	return ("PRACTICE: %s" % words.to_upper()) if Live.truthy(of.get("training")) else words.to_upper()


func _show() -> void:
	if not outcome.is_empty():
		_show_outcome()
		return
	if view.is_empty():
		console.visible = false
		return
	console.begin(Pal.kind(str(view.get("theme", "cyan"))))
	var panels: Array = view.get("panels", [])
	var log: Array = view.get("log", [])
	var kids: Array = [
		el("div", "con-title", [el("span", "con-name", [str(view.get("window", ""))]), el("span", "con-word", ["%s, %s" % [str(view.get("skillName", "")), str(view.get("tierName", ""))]]), el("span", "con-word check-odds", [_hardness(view)])]),
		el("div", "check-situation", [el("div", "tone-bright", ["> %s" % str(view.get("reason", ""))])] + ([el("div", "check-scene", [str(view.scene)])] if view.get("scene") != null else [])),
	]
	# The terminal first, as its panel is the tall one down the left.
	var desk: Array = []
	for panel in panels:
		desk.append(_panel(panel, log))
	kids.append(el("div", "check-desk%s" % (" one" if panels.size() == 1 else ""), desk))
	if typeof(view.get("hints")) == TYPE_ARRAY and not (view.hints as Array).is_empty():
		kids.append(el("div", "check-situation", [el("div", "tone-dim", ["ADVISOR: %s" % str(view.get("tierName", "")).to_upper()])] + (view.hints as Array).map(func(line: Variant) -> Dictionary: return el("div", "check-line tone-bright", [str(line)]))))
	if message != "":
		kids.append(el("div", "notice-inline fail", [message]))
	var commands: Array = []
	var numbered := not Live.truthy(view.get("typedNumbers"))
	var list: Array = view.get("commands", [])
	for i in list.size():
		var entry: Dictionary = list[i]
		var words: Array = []
		if numbered:
			words.append(el("span", "check-key", ["%d" % (i + 1)]))
		words.append(" %s" % str(entry.label))
		if entry.get("hint") != null and str(entry.hint) != "":
			words.append(el("span", "check-hint", [" %s" % str(entry.hint)]))
		var more := {"tip": str(entry.hint) if entry.get("hint") != null else str(entry.label)}
		if Live.truthy(entry.get("disabled")) or _sending:
			more["d"] = 1
		commands.append(console.button("check-command", words, send.bind(str(entry.command)), more))
	var controls: Array = [el("div", "check-commands", commands)]
	# A decided game has no roll to make, so there's nothing to press.
	if not Live.truthy(view.get("decided")):
		controls.append(el("div", "", [console.button("check-run primary", ["%s: %d%%" % [str(view.get("runLabel", "Roll")), int(view.get("odds", 0))]], send.bind("run"), {"tip": "Make the final roll, at the odds showing now. Or press Enter."})]))
	kids.append(el("div", "check-controls", controls))
	var bar: Array = []
	for meter in view.get("meters", []):
		bar.append(el("span", "check-meter tone-%s" % str(meter.get("tone", "info")), ["%s %s" % [str(meter.label), str(meter.text) if meter.get("text") != null else "%d/%d" % [int(meter.value), int(meter.max)]]]))
	if not Live.truthy(view.get("decided")):
		var odds := int(view.get("odds", 0))
		var base := int(view.get("baseOdds", odds))
		var parts: Array = []
		for part in view.get("parts", []):
			parts.append("%s %s%d" % [str(part.label), "+" if int(part.value) >= 0 else "", int(part.value)])
		parts.append("your work %s%d" % ["+" if int(view.get("edge", 0)) >= 0 else "", int(view.get("edge", 0))])
		parts.append("against %d" % int(view.get("dc", 0)))
		var filled := int(round(odds / 10.0))
		bar.append(el("span", "check-odds tone-%s" % ("good" if odds >= 65 else ("bad" if odds <= 35 else "warn")), ["ODDS %s%d%% [%s%s]" % ["%d%% -> " % base if base != odds else "", odds, "#".repeat(filled), "-".repeat(10 - filled)]], {"tip": ", ".join(parts)}))
	kids.append(el("div", "check-taskbar", bar))
	_put(kids)


func _show_outcome() -> void:
	console.begin(Pal.kind(str(outcome.get("theme", "cyan"))))
	var choices: Array = [["Continue the story", "the story picks it up from here", func() -> void:
		reset()
		main.story._send("/api/chat", {"event": "continue"})], ["Close, and look around first", "", _close]] if story_waits else [["Close", "", _close]]
	var rows: Array = []
	for i in choices.size():
		var choice: Array = choices[i]
		var row: Array = [el("span", "option-number", ["%d)" % (i + 1)]), el("span", "option-label", [str(choice[0])])]
		if str(choice[1]) != "":
			row.append(el("span", "option-detail", [str(choice[1])]))
		rows.append(console.button("option", row, choice[2]))
	var verdict: Array = [el("div", "check-verdict-title tone-%s" % ("good" if Live.truthy(outcome.get("success")) else "bad"), [str(outcome.get("title", ""))])]
	if outcome.get("line") != null:
		verdict.append(el("div", "check-verdict-line", [str(outcome.line)]))
	verdict.append(el("div", "check-verdict-math", ["%s: %s" % [str(outcome.get("label", "")), str(outcome.get("math", ""))]]))
	for note in outcome.get("notes", []) if outcome.get("notes") != null else []:
		var words := str(note)
		if words.begins_with("[") and words.contains("]"):
			words = words.substr(words.find("]") + 1).strip_edges()
		verdict.append(el("div", "tone-good", [words]))
	_put([
		el("div", "con-title", [el("span", "con-name", [str(outcome.get("window", ""))]), el("span", "con-word check-odds", [_hardness(outcome)])]),
		el("div", "check-situation", [el("div", "tone-bright", ["> %s" % str(outcome.get("reason", ""))])]),
		el("div", "check-verdict", verdict),
		el("div", "options", rows),
	])


func _put(kids: Array) -> void:
	var room: Vector2 = main.get_size()
	var wide := minf(room.x - 24.0, 1030.0 if outcome.is_empty() else 620.0)
	console.most_high = room.y - main.top.size.y - 24.0
	console.put(el("div", "con", kids), wide)
	console.visible = true
	console.position = Vector2(round((room.x - wide) / 2.0), main.top.size.y + 12.0)
	_seen = room.x


func _process(_delta: float) -> void:
	visible = main.playing and main.link != null and not main.loading.visible
	# The window is as wide as the room allows, so it's laid out again when the room changes size.
	if console.visible and absf(main.get_size().x - _seen) > 0.5:
		_show()


## The keys of a check: a number or a command's own key gives that command, Enter makes the roll once it's ready;
## when it's over, a number picks what's next.
func key(event: InputEventKey) -> bool:
	if not console.visible:
		return false
	var code := event.physical_keycode
	if not outcome.is_empty():
		var n := int(code) - KEY_0
		var rows: Array = []
		main.room._gather(console.page.tree, rows)
		if n >= 1 and n <= rows.size():
			console.runs[int(rows[n - 1].id)].call()
		return true
	if view.is_empty():
		return false
	var list: Array = view.get("commands", [])
	var name := str(KEYS.get(code, OS.get_keycode_string(event.keycode).to_lower() if event.keycode < 128 else ""))
	for entry in list:
		if name != "" and str(entry.get("key", "")) == name and not Live.truthy(entry.get("disabled")) and name != "Enter":
			send(str(entry.command))
			return true
	if code >= KEY_1 and code <= KEY_9 and not Live.truthy(view.get("typedNumbers")):
		var index := int(code) - KEY_1
		if index < list.size() and not Live.truthy(list[index].get("disabled")):
			send(str(list[index].command))
		return true
	if name == "Enter":
		for entry in list:
			if str(entry.get("key", "")) == "Enter" and not Live.truthy(entry.get("disabled")):
				send(str(entry.command))
				return true
		if not Live.truthy(view.get("decided")):
			send("run")
		return true
	# The arrows are the check's while it's open, whether or not they do anything in it.
	return KEYS.has(code)
