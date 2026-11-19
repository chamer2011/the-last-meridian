## The story and talks over the room (step 4 of the port): the page's public/popups.js and public/talk.js, in Godot.
## A scene comes up a piece at a time: what someone in the room says on a pane by their head, anything else across
## the top of the room. A click goes on to the next piece. Once it's all been read, what the player can say hangs
## under the pane of whoever the story is waiting on. A talk comes up the same way, by the head of whoever it's with.
##
## The story's text is read by the game (src/godot-story.js, with the page's own readers): this draws the pieces it's
## handed, and tells the game what was chosen with the page's own /api/chat and /api/talk.
class_name Story
extends Control

const LETTERS_A_SECOND := 70.0
const PANE_WIDE := 340.0
## How long the last of what happens stays over the room once it's been read, when there's nothing to answer.
const CAPTION_STAYS := 7.0
const TONES := {"good": "8df5ac", "bad": "ff8f7f", "warn": "ffc466", "info": "8ec5ff", "belief": "c9a8ff", "dim": "7d8a80"}

var main: Control
## What the game last said of the story (godotStory), and how far the reader has got in the scene being told.
var data := {}
var at := 0
var open := false
var sending := false
var message := ""

var _start := ""
var _begun := false
## How much of the story there was when the player last did something here: what's shown is what's been told since.
var _from := -1
var _written := 0.0
var _posted := 0
var _asking := false
var _again := false
var _read_at := 0.0
var _faded := false
var _pane: Control
var _words: RichTextLabel
var _hint: Label
var _choices: PanelContainer
var _caption: PanelContainer
var _tracker: PanelContainer
var _waiting: Button
var _anchor := ""
var _drawn := ""
var _picks: Array = []


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tracker = PanelContainer.new()
	_tracker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tracker.visible = false
	add_child(_tracker)
	_waiting = Pal.bracket_button("The story is waiting for you", Color("ffc466"), Pal.BG, 13)
	_waiting.tooltip_text = "Click to bring it back"
	_waiting.visible = false
	_waiting.pressed.connect(func() -> void:
		open = true
		_drawn = "")
	add_child(_waiting)


func _room() -> Vector2:
	# The room's own panel is down the right side: the story keeps to the left of it.
	return main.get_size() - Vector2(main.room.cover(), 0)


func _talk() -> Dictionary:
	return data.talk if typeof(data.get("talk")) == TYPE_DICTIONARY else {}


func _beats() -> Array:
	return data.get("beats", [])


func _beat() -> Dictionary:
	var beats := _beats()
	return beats[at] if at >= 0 and at < beats.size() else {}


## Whether a talk is open here: it has the room, and walking waits.
func talking() -> bool:
	return not _talk().is_empty()


# ---- Keeping up with the game ---------------------------------------------------------------------------------------

## Asks the game how the story stands. One ask at a time; one asked for meanwhile follows it.
func refresh() -> void:
	if _asking:
		_again = true
		return
	_asking = true
	while true:
		_again = false
		var answer: Dictionary = await main.link.ask("/api/godot/story" + ("?from=%d" % _from if _from >= 0 else ""), null, 30.0)
		if answer.ok:
			_take(answer.data)
		if not _again:
			break
	_asking = false


func _take(said: Dictionary) -> void:
	var first := data.is_empty()
	data = said
	var start := "%s|%s" % [str(said.get("id", "")).get_slice("|", 0), str(said.get("id", "")).get_slice("|", 1)]
	var beats := _beats()
	if start != _start or first or _begun:
		_start = start
		if _begun:
			# Something the player did here began it: it's read from its first piece.
			at = 0
			_written = 0.0
			_posted = 0
		else:
			# Something already told (a game just opened, or the story moved on in the game's own window): its last piece.
			at = maxi(0, beats.size() - 1)
			_written = INF
			_posted = (said.get("notes", []) as Array).size()
		open = not beats.is_empty()
		_faded = false
		_read_at = 0.0
	_begun = false
	at = clampi(at, 0, maxi(0, beats.size() - 1))
	if not _talk().is_empty() and str(_talk().get("id", "")) + str(_talk().get("lines", 0)) != _anchor:
		# Something new said in a talk is written out (what was said before this window opened is there already).
		_anchor = str(_talk().get("id", "")) + str(_talk().get("lines", 0))
		_written = INF if first else 0.0
	_post_notes()
	_drawn = ""
	# A game whose story hasn't begun starts it by itself.
	if Live.truthy(said.get("untold")) and not sending:
		_send("/api/chat", {"event": "start"})


## The player's done something, so the next thing the story tells is a new scene, read from its start.
func _send(path: String, body: Dictionary) -> void:
	if sending:
		return
	sending = true
	message = ""
	_begun = path == "/api/chat"
	if _begun:
		_from = int(str(data.get("id", "")).get_slice("|", 2)) if str(data.get("id", "")).get_slice_count("|") > 2 else -1
	_drawn = ""
	var answer: Dictionary = await main.link.tell(path, body)
	sending = false
	if not answer.ok:
		message = str(answer.error)
		_begun = false
	await refresh()
	main.call("_story_moved")


## A note comes up when the reader gets to the piece it goes with, so it doesn't give anything away.
func _post_notes() -> void:
	var notes: Array = data.get("notes", [])
	while _posted < notes.size() and (int(notes[_posted].at) <= at or not open):
		for line in notes[_posted].lines:
			main.call("_tell", "[%s] %s" % [str(line.tag), str(line.text)])
		_posted += 1


# ---- Reading --------------------------------------------------------------------------------------------------------

func _total() -> int:
	return _words.get_total_character_count() if _words != null else 0


func _writing() -> bool:
	return _words != null and _written < float(_total())


## Whether there's still something of the scene to read: until it's been read, a click on the room goes on with it.
func reading() -> bool:
	return open and _talk().is_empty() and (_writing() or at < _beats().size() - 1)


## The next thing: the rest of what's being said, and then the next piece. Says whether there was one.
func next() -> bool:
	if not open and _talk().is_empty():
		return false
	if _writing():
		_written = INF
		return true
	if _talk().is_empty() and at < _beats().size() - 1:
		at += 1
		_written = 0.0
		_faded = false
		_read_at = 0.0
		_post_notes()
		_drawn = ""
		return true
	return false


func back() -> void:
	if at > 0:
		at -= 1
		_written = INF
		_faded = false
		_read_at = 0.0
		_drawn = ""


## Walking puts the story away; a line at the top brings it back while it's waiting on an answer.
func put_away() -> void:
	if open and _talk().is_empty():
		open = false
		_post_notes()
		_drawn = ""


func _at_end() -> bool:
	return not _writing() and at >= _beats().size() - 1


## What can be answered now: a talk's lines, or the scene's choices once it's all been read.
func _options() -> Array:
	if not _talk().is_empty():
		return _talk().get("choices", [])
	if open and _at_end():
		return data.get("choices", [])
	return []


## A choice by its number (1 is the first). Says whether there was one.
func pick(number: int) -> bool:
	if sending or _writing():
		return false
	var options := _picks
	if number < 1 or number > options.size():
		return false
	var option: Dictionary = options[number - 1]
	if not _talk().is_empty():
		if option.has("order"):
			_send("/api/talk", {"action": str(option.order)})
		elif Live.truthy(option.get("check")):
			_send("/api/talk", {"action": "check", "label": str(option.label)})
		else:
			_send("/api/talk", {"action": "say", "text": str(option.get("say", option.label))})
	elif option.has("event"):
		_send("/api/chat", {"event": str(option.event)})
	elif Live.truthy(option.get("check")):
		# A choice with a check on it opens the check: its window comes up here (check.gd) once the game says there's one.
		_send("/api/check/start", {"label": str(option.label)})
	else:
		_send("/api/chat", {"text": str(option.label)})
	return true


## Walking up to someone: whoever a quest's scene is waiting on goes on with it, and anyone else has a talk.
func meet(key: String) -> void:
	if (data.get("meet", []) as Array).has(key):
		_send("/api/chat", {"event": "meet", "person": key})
	else:
		_send("/api/talk", {"action": "open", "person": key})


# ---- Drawing --------------------------------------------------------------------------------------------------------

static func _safe(text: String) -> String:
	return text.replace("[", "[lb]")


## A piece's words as they're shown: what's said in the speaker's own bright, the rest dimmer, *emphasis* slanted.
static func _bbcode(parts: Array, said: Color, rest: Color) -> String:
	var out := ""
	for part in parts:
		var words := _safe(str(part.text))
		var slanted := RegEx.create_from_string("\\*\\*?([^*\\n]+)\\*\\*?").sub(words, "[i]$1[/i]", true)
		out += "[color=%s]%s[/color]" % [Pal.hex(said if str(part.kind) == "quote" else rest), slanted]
	return out


func _head(key: String) -> Variant:
	if main.current < 0:
		return null
	var overlay: Overlay = (main.decks[main.current].view as DeckView).overlay
	var head: Variant = overlay.heads.get(key)
	if head == null:
		return null
	var world: Node2D = main.world
	var scale := world.scale.x
	var feet: Vector2 = world.position + (head.at as Vector2) * scale
	var top := Vector2(feet.x, feet.y - float(head.tall) * scale * 0.95)
	if top.x < 0.0 or top.x > _room().x or top.y < 0.0 or top.y > _room().y:
		return null
	return top


## Who a piece is said by, if they're here to say it over their head.
func _speaker_here(beat: Dictionary) -> String:
	if beat.get("type", "") != "speech" or not beat.has("key") or not _talk().is_empty():
		return ""
	return str(beat.key) if _head(str(beat.key)) != null else ""


func _clear() -> void:
	for old in [_pane, _caption]:
		if old != null:
			remove_child(old)
			old.queue_free()
	_pane = null
	_caption = null
	_words = null
	_hint = null
	_choices = null
	_picks = []


## A pane with a tag: someone's words, with the corners in their colour.
func _build_pane(tag: String, note: String, colour: Color, words: String, hint: String, options: Array, heading: String) -> void:
	var p := Pal.person(colour)
	_pane = Control.new()
	_pane.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_pane)
	var box := PanelContainer.new()
	var skin := Pal.box(Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.88), p.line, 1, Color(0, 0, 0, 0.55), 14)
	box.add_theme_stylebox_override("panel", Pal.margins(skin, 12, 10))
	box.custom_minimum_size.x = PANE_WIDE
	box.mouse_filter = Control.MOUSE_FILTER_STOP
	box.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			next()
			box.accept_event())
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(column)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var name_tag := Pal.label(tag.to_upper(), Pal.BG, 11, true)
	name_tag.add_theme_stylebox_override("normal", Pal.margins(Pal.box(colour), 5, 0))
	head.add_child(name_tag)
	if note != "":
		head.add_child(Pal.label(note, p.dim, 11))
	column.add_child(head)
	_words = Pal.words(words, p.c, 14)
	_words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_words.custom_minimum_size.x = PANE_WIDE - 24.0
	column.add_child(_words)
	_hint = Pal.label(hint, p.dim, 11)
	_hint.visible = hint != ""
	column.add_child(_hint)
	_pane.add_child(box)
	_pane.set_meta("box", box)
	_pane.set_meta("colour", colour)
	if not options.is_empty() or message != "":
		_choices = _build_choices(options, heading)
		_pane.add_child(_choices)


## What the player can say or do, numbered, each with what it involves on it.
func _build_choices(options: Array, heading: String) -> PanelContainer:
	var green := Pal.kind("green")
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", Pal.margins(Pal.box(Color(3 / 255.0, 17 / 255.0, 10 / 255.0, 0.92), green.line, 1, Color(0, 0, 0, 0.55), 14), 8, 8))
	panel.custom_minimum_size.x = PANE_WIDE
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 2)
	panel.add_child(list)
	list.add_child(Pal.label(heading.to_upper(), green.dim, 11, true))
	_picks = options
	for i in options.size():
		var option: Dictionary = options[i]
		var chips := ""
		for chip in option.get("chips", []):
			chips += "[color=#%s]%s[/color]  " % [TONES.get(str(chip.get("tone", "info")), TONES.info), _safe(str(chip.text))]
		var row := OptionRow.new().setup(i, chips + _safe(str(option.label)), _safe(str(option.detail)) if option.get("detail") != null else "", green, 13)
		row.custom_minimum_size.x = PANE_WIDE - 16.0
		var tips := PackedStringArray()
		for chip in option.get("chips", []):
			tips.append(str(chip.get("tip", "")))
		row.tooltip_text = "\n".join(tips)
		row.chosen.connect(func(index: int) -> void: pick(index + 1))
		list.add_child(row)
	if message != "":
		var sorry := Pal.words(_safe(message), Color("ff8f7f"), 12)
		sorry.custom_minimum_size.x = PANE_WIDE - 16.0
		list.add_child(sorry)
	list.add_child(Pal.label("Click one, or press its number.", green.dim, 11))
	return panel


func _build_caption(words: String, hint: String) -> void:
	_caption = PanelContainer.new()
	_caption.add_theme_stylebox_override("panel", Pal.margins(Pal.box(Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.86), Pal.LINE, 1), 14, 10))
	_caption.mouse_filter = Control.MOUSE_FILTER_STOP
	_caption.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			next()
			_caption.accept_event())
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 4)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_caption.add_child(column)
	var wide := minf(720.0, _room().x - 60.0)
	_words = Pal.words(words, Pal.BRIGHT, 14)
	_words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_words.custom_minimum_size.x = wide
	column.add_child(_words)
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 12)
	_hint = Pal.label(hint, Pal.MUTED, 11)
	foot.add_child(_hint)
	if at > 0:
		var again := Pal.bracket_button("Back", Pal.MUTED, Pal.BG, 11)
		again.pressed.connect(back)
		foot.add_child(again)
	column.add_child(foot)
	add_child(_caption)


## Builds what's over the room again, when what it says has changed.
func _rebuild() -> void:
	_clear()
	var talk := _talk()
	var beats := _beats()
	_anchor_key = ""
	if not talk.is_empty():
		# A talk: their newest words on a pane by their head, the player's own line over them, and what to say next.
		var colour := Iso.hex(talk.get("color"), "#8ec5ff")
		var p := Pal.person(colour)
		var words := ""
		if talk.get("heard") != null:
			words += "[color=%s]> %s[/color]\n" % [Pal.hex(p.dim), _safe(str(talk.heard))]
		for piece in talk.get("said", []):
			if words != "":
				words += "\n"
			words += _bbcode(piece.parts, p.bright, p.c)
		for line in talk.get("notices", []):
			words += "\n[color=#%s][lb]%s[rb] %s[/color]" % [TONES.get(str(line.tone), TONES.info), str(line.tag), _safe(str(line.text))]
		_anchor_key = str(talk.key)
		_build_pane(str(talk.name), str(talk.doing) if talk.get("doing") != null else "", colour, words, "", talk.get("choices", []), "What do you say?")
		return
	if not open or beats.is_empty():
		return
	var beat := _beat()
	var count := beats.size()
	var more := at < count - 1
	var hint := "%d of %d%s" % [at + 1, count, "   click to go on" if more else ""]
	var options: Array = data.get("choices", []) if at >= count - 1 else []
	var here := _speaker_here(beat)
	if not options.is_empty():
		# Once there's something to answer, it hangs off the pane of whoever the story waits on, with their last words.
		var anchor: Dictionary = data.get("anchor", {})
		var key := str(anchor.get("key", "you"))
		var yours := key == "you" or _head(key) == null
		var colour := Pal.TEXT if yours else Iso.hex(anchor.get("color"), "#8ec5ff")
		var p := Pal.person(colour)
		var words := ""
		if not yours and typeof(anchor.get("said")) == TYPE_ARRAY:
			words = _bbcode(anchor.said, p.bright, p.c)
		elif beat.get("type", "") != "speech" or here == "":
			words = _piece_words(beat)
		_anchor_key = "you" if yours else key
		_build_pane("You" if yours else str(anchor.get("name", "")), "", colour, words, "", options, "What do you do?" if yours else "What do you say?")
		return
	if here != "":
		var colour := Iso.hex(beat.get("color"), "#8ec5ff") if here != "you" else Pal.TEXT
		var p := Pal.person(colour)
		_anchor_key = here
		_build_pane(str(beat.speaker), str(beat.voice) if beat.has("voice") else "", colour, _bbcode(beat.parts, p.bright, p.c), hint, [], "")
		return
	if _faded:
		return
	_build_caption(_piece_words(beat), hint)


var _anchor_key := ""


## A piece that isn't on a pane by someone's head, as it's written across the top of the room.
func _piece_words(beat: Dictionary) -> String:
	var words := ""
	if typeof(beat.get("page")) == TYPE_DICTIONARY:
		var page: Dictionary = beat.page
		words += "[color=%s][b]SHIP'S LOG  ·  %s[/b]%s[/color]\n\n" % [Pal.hex(Pal.TEXT), _safe(str(page.get("title", "")).to_upper()), "  " + _safe(str(page.under)) if page.get("under") != null else ""]
	if data.get("said") != null and at == 0:
		words += "[color=%s]> %s[/color]\n" % [Pal.hex(Pal.MUTED), _safe(str(data.said))]
	match str(beat.get("type", "")):
		"speech":
			var colour := Iso.hex(beat.get("color"), "#8ec5ff")
			var p := Pal.person(colour)
			words += "[color=%s][b]%s[/b]%s[/color]  %s" % [Pal.hex(colour), _safe(str(beat.speaker)), " (%s)" % str(beat.voice) if beat.has("voice") else "", _bbcode(beat.parts, p.bright, p.c)]
		"consequence":
			words += "[color=#ffc466][b]CONSEQUENCE[/b]  %s[/color]" % _bbcode(beat.parts, Color("ffc466"), Color("ffc466"))
		_:
			words += _bbcode(beat.get("parts", []), Pal.BRIGHT, Pal.TEXT)
	return words


func _process(delta: float) -> void:
	if main == null or not main.playing or main.link == null:
		visible = false
		return
	visible = not main.args.has("bare")
	size = _room()
	var fighting: bool = main.fight.on
	var said := JSON.stringify([data.get("id"), at, open, _faded, sending, message, _talk().get("id"), _talk().get("lines"), _room().x, fighting, _options().size(), _speaker_here(_beat())])
	if said != _drawn:
		_drawn = said
		if fighting:
			_clear()
		else:
			_rebuild()
		_show_tracker(fighting)
	# The words are written out as they're read.
	if _words != null:
		var total := float(_total())
		if _written < total:
			_written = minf(total, _written + LETTERS_A_SECOND * delta)
			_words.visible_characters = int(_written)
			if _written >= total:
				_drawn = ""
		else:
			_words.visible_characters = -1
	# The last of what happens goes a little after it's been read, when there's nothing to answer.
	if open and _talk().is_empty() and _at_end() and _options().is_empty() and not _faded:
		_read_at += delta
		if _read_at > CAPTION_STAYS:
			_faded = true
			_drawn = ""
	_place()
	queue_redraw()


## Where everything goes: a pane up and to the right of its speaker's head (or to their left where there's no room),
## always on the screen and under the bar; what's told to nobody across the top; the quest in the corner.
func _place() -> void:
	var top: float = float(main.top.size.y) + 8.0
	var room := _room()
	if _pane != null:
		var box: PanelContainer = _pane.get_meta("box")
		box.size = Vector2(PANE_WIDE, box.get_combined_minimum_size().y)
		var tall := box.size.y
		if _choices != null:
			_choices.visible = not _writing()
			_choices.size = Vector2(PANE_WIDE, _choices.get_combined_minimum_size().y)
			_choices.position = Vector2(0, box.size.y + 8.0)
			if _choices.visible:
				tall += _choices.size.y + 8.0
		var head: Variant = _head(_anchor_key) if _anchor_key != "" else null
		var at_point := Vector2((room.x - PANE_WIDE) / 2.0, maxf(top, room.y * 0.3 - tall / 2.0))
		if head != null:
			var where: Vector2 = head
			var left := where.x + 28.0
			if left + PANE_WIDE > room.x - 6.0:
				left = where.x - 28.0 - PANE_WIDE
			at_point = Vector2(left, where.y - 16.0 - box.size.y)
		_pane.position = Vector2(clampf(at_point.x, 6.0, maxf(6.0, room.x - PANE_WIDE - 6.0)), clampf(at_point.y, top, maxf(top, room.y - tall - 40.0)))
		_pane.size = Vector2(PANE_WIDE, tall)
	if _caption != null:
		_caption.size = Vector2(0, 0)
		_caption.position = Vector2((room.x - _caption.size.x) / 2.0, top + (float(_tracker.size.y) + 8.0 if _tracker.visible and room.x < 1100.0 else 0.0))
	_waiting.visible = not open and _talk().is_empty() and not sending and not (data.get("choices", []) as Array).is_empty() and not main.fight.on and main.call("_blocked") == ""
	if _waiting.visible:
		_waiting.position = Vector2((room.x - _waiting.size.x) / 2.0, top)
	if _tracker.visible:
		_tracker.size = Vector2(0, 0)
		_tracker.position = Vector2(10.0, top)


## A line from a pane to the head of whoever's speaking.
func _draw() -> void:
	if _pane == null or _anchor_key == "":
		return
	var head: Variant = _head(_anchor_key)
	if head == null:
		return
	var box: PanelContainer = _pane.get_meta("box")
	var colour: Color = _pane.get_meta("colour")
	var where: Vector2 = head
	var corner := _pane.position + Vector2(0.0 if _pane.position.x > where.x else box.size.x, box.size.y)
	draw_line(corner, where + Vector2(0, -4), Color(colour, 0.7), 1.0, true)
	draw_circle(where + Vector2(0, -4), 2.5, colour)


## The quest the corner follows: its name, where it stands, and a battle's list afterwards with its boxes.
func _show_tracker(fighting: bool) -> void:
	for old in _tracker.get_children():
		_tracker.remove_child(old)
		old.queue_free()
	var quest: Variant = data.get("tracker")
	_tracker.visible = typeof(quest) == TYPE_DICTIONARY and not fighting
	if not _tracker.visible:
		return
	_tracker.add_theme_stylebox_override("panel", Pal.margins(Pal.box(Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.8), Pal.LINE, 1), 10, 6))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 2)
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_tracker.add_child(column)
	column.add_child(Pal.label(str(quest.title).to_upper(), Pal.BRIGHT, 12, true))
	var wide := minf(300.0, _room().x - 40.0)
	var step: Variant = quest.get("step")
	var line := str(step.text) if typeof(step) == TYPE_DICTIONARY and str(step.get("text", "")) != "" else str(quest.get("objective", ""))
	if line != "":
		var words := Pal.words(_safe(line), Pal.TEXT, 12)
		words.custom_minimum_size.x = wide
		words.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.add_child(words)
	for item in quest.get("checklist", []):
		var done := Live.truthy(item.get("done"))
		var text := "[lb]%s[rb] %s%s" % ["x" if done else " ", _safe(str(item.text)), "  [color=%s]%s[/color]" % [Pal.hex(Pal.MUTED), _safe(str(item.where))] if item.get("where") != null and not done else ""]
		var row := Pal.words(text, Pal.MUTED if done else Pal.TEXT, 12)
		row.custom_minimum_size.x = wide
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		column.add_child(row)
	var others := int(quest.get("others", 0))
	if others > 0:
		column.add_child(Pal.label("and %d more in the game's own quest log" % others, Pal.MUTED, 11))
