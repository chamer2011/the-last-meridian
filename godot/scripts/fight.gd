## A fight in the room, in real time with a pause (step 3 of the port): the page's public/live-fight.js, in Godot. The
## game keeps the fight's rules (src/live-fight.js on src/combat.js); this keeps its clock, asking the game to go on
## several times a second while it runs, and draws what the page draws: the fighters in the room with their health and
## readiness over their heads, shots and numbers flying, the orders along the bottom, the notes of what happened, the two
## sides, and how it ended. It starts stopped, Space stops and starts it, and it can stop by itself each time the player
## is ready to act.
##
## A simulated fight, one aboard another ship, and one already being fought in the game's fight window stay in the
## game's own window: this says so (elsewhere) and waits.
class_name Fight
extends Control

## How often the fight is asked to go on while it runs, in seconds, and the most time one ask can cover, in thousandths.
const TICK := 0.12
const LONGEST := 500
## As src/live-fight.js: how fast people walk in a fight, in tiles a second.
const SPEED := 3.6
const CW := Iso.CELL_WIDTH
const RESULT_TITLES := {"victory": "Victory", "defeat": "Defeat", "fled": "You got away", "talked": "It's over", "surrendered": "You gave up"}
const BATTLE_TITLES := {"victory": "The battle's won", "talked": "The battle's won", "defeat": "You went down"}
const BAD_ENDS := ["defeat"]
const TONES := {"good": Color("8df5ac"), "bad": Color("ff8f7f"), "dim": Color("7d8a80"), "info": Color("8ec5ff"), "": Color("d6ffe2")}
## How many of the other side a battle's list shows by name: the nearest.
const BATTLE_ROWS := 6

## The window this is part of (main.gd), for the line to the game and where the room is on the screen.
var main: Control
## The fight as the game last described it (combatView), and whether it's being played here.
var combat := {}
var on := false
## Why a fight that's going on isn't played here, in words for the banner; empty when it is, or there's none.
var elsewhere := ""
var paused := true
var held_for := "start"
var stop_when_ready := false
## The order waiting for someone to be aimed at, as "type:id".
var picking := ""
var notes: Array[Dictionary] = []
var fx: Array[Dictionary] = []
## Where each fighter is drawn, on their way to where the fight has them: key to { x, y, step, flip, back, walking, fade }.
var shown := {}
var you := {}
var ending := {}
var message := ""
var story_waiting := false

var _id := ""
var _battle := ""
var _asking := false
var _refused := {}
var _inflight := false
var _pump := 0.0
var _ticked_at := 0
var _notes_box: VBoxContainer
var _orders: PanelContainer
var _roster: Roster
var _drawn := ""


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_notes_box = VBoxContainer.new()
	_notes_box.add_theme_constant_override("separation", 2)
	_notes_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_notes_box.position = Vector2(10, 60)
	add_child(_notes_box)
	_orders = PanelContainer.new()
	_orders.visible = false
	add_child(_orders)
	_roster = Roster.new()
	_roster.fight = self
	_roster.visible = false
	add_child(_roster)


func _link() -> Link:
	return main.link


## How big the window is: this is laid over all of it.
func _room() -> Vector2:
	return main.get_size()


func _alive() -> bool:
	return not combat.is_empty() and typeof(combat.get("live")) == TYPE_DICTIONARY


func _live() -> Dictionary:
	return combat.live


func _hp() -> float:
	return float(combat.get("you", {}).get("hp", 0))


# ---- Finding the fight ----------------------------------------------------------------------------------------------

## The game says there's a fight: it's looked at, moved into the room if it's just begun, and played here if it's one
## that's fought in the room.
func wake() -> void:
	if on or _asking:
		return
	_asking = true
	var answer: Dictionary = await _link().ask("/api/godot/combat", null, 20.0)
	if answer.ok and typeof(answer.data.get("combat")) == TYPE_DICTIONARY:
		var c: Dictionary = answer.data.combat
		story_waiting = Live.truthy(answer.data.get("storyWaiting"))
		if Live.truthy(c.get("training")):
			elsewhere = "A fight in the simulator has started. Simulated fights are played in the game's own window."
		elif c.get("away") != null:
			elsewhere = "A fight aboard another ship has started. It's played in the game's own window."
		else:
			if typeof(c.get("live")) != TYPE_DICTIONARY and int(c.get("round", 1)) <= 1 and not _refused.has(str(c.get("id", ""))):
				# A fight that's just started moves into the room.
				var moved: Dictionary = await _link().ask("/api/combat", {"action": "live"}, 20.0)
				if moved.ok:
					answer = await _link().ask("/api/godot/combat", null, 20.0)
					if answer.ok and typeof(answer.data.get("combat")) == TYPE_DICTIONARY:
						c = answer.data.combat
				else:
					_refused[str(c.get("id", ""))] = true
			if typeof(c.get("live")) == TYPE_DICTIONARY:
				_start(c)
			else:
				elsewhere = "A fight is being fought in the game's fight window. It's finished there, in the game's own window."
	_asking = false


## There's no fight as far as the game goes (the tick says so): whatever was said about one elsewhere goes, and one
## that was being shown here and was ended somewhere else (in the game's own window) is left.
func none() -> void:
	elsewhere = ""
	if on and ending.is_empty() and not _inflight and not _asking:
		leave()


## A new fight starts stopped, with what started it as the first note.
func _start(c: Dictionary) -> void:
	combat = c
	on = true
	elsewhere = ""
	_id = str(c.get("id", ""))
	paused = true
	held_for = "start"
	picking = ""
	notes.clear()
	fx.clear()
	shown.clear()
	you = {}
	ending = {}
	message = ""
	_battle = str(c.battle.get("title", "")) if typeof(c.get("battle")) == TYPE_DICTIONARY else ""
	if c.get("opening") != null and str(c.opening) != "":
		_note(str(c.opening), "bad")
	_ticked_at = Time.get_ticks_msec()
	_refresh()


func _on_with_story() -> void:
	leave()
	main.call("_continue_story")


## Another game or place is being loaded: whatever fight was on screen no longer applies.
func reset() -> void:
	on = false
	elsewhere = ""
	combat = {}
	ending = {}
	shown.clear()
	you = {}
	fx.clear()
	notes.clear()
	_refresh()


## Leaves a fight that's ended, back to the room.
func leave() -> void:
	on = false
	ending = {}
	combat = {}
	shown.clear()
	you = {}
	fx.clear()
	notes.clear()
	_refresh()
	main.call("_after_fight")


# ---- The clock ------------------------------------------------------------------------------------------------------

func set_paused(now_paused: bool, why := "you") -> void:
	if not ending.is_empty() or not _alive():
		return
	paused = now_paused
	held_for = why if now_paused else ""
	_ticked_at = Time.get_ticks_msec()
	_refresh()


func toggle_pause() -> void:
	set_paused(not paused)


func _process(delta: float) -> void:
	if not on:
		return
	for one in fx:
		one.t += delta
	fx = fx.filter(func(one: Dictionary) -> bool: return one.t < one.life)
	queue_redraw()
	_place()
	_pump -= delta
	if _pump > 0.0:
		return
	_pump = TICK
	var now := Time.get_ticks_msec()
	if not _alive() or paused or not ending.is_empty():
		_ticked_at = now
		return
	if _inflight:
		return
	var ms := mini(LONGEST, now - _ticked_at)
	_ticked_at = now
	_send({"action": "tick", "ms": ms, "stopWhenReady": stop_when_ready, "view": "godot"})


func _send(body: Dictionary) -> bool:
	_inflight = true
	var answer: Dictionary = await _link().ask("/api/combat", body, 20.0)
	_inflight = false
	if not on:
		return false
	if not answer.ok:
		message = str(answer.error)
		_refresh()
		return false
	message = ""
	var said: Dictionary = answer.data
	var outcome: Dictionary = said.get("outcome", {})
	if Live.truthy(outcome.get("over")):
		ending = outcome
		_played(outcome.get("events", []))
		paused = true
		picking = ""
		var game: Variant = said.get("game")
		story_waiting = typeof(game) == TYPE_DICTIONARY and Live.truthy(game.get("storyWaiting"))
		combat = {}
		_refresh()
		main.call("_fight_over")
		return true
	if typeof(said.get("combat")) == TYPE_DICTIONARY:
		combat = said.combat
	_played(outcome.get("events", []))
	if Live.truthy(outcome.get("ready")):
		paused = true
		held_for = "ready"
	_refresh()
	return true


## An order: it's kept while the fight's stopped, and one given while it's waiting on the player sets it going again.
func order(body: Dictionary) -> void:
	if not ending.is_empty() or not _alive():
		return
	picking = ""
	_refresh()
	var ok: bool = await _send(body)
	if ok and paused and held_for == "ready":
		set_paused(false)


# ---- What happened --------------------------------------------------------------------------------------------------

## While it's fought, the four newest. Once it's over, enough for everything its end has to say.
func _note(text: String, tone := "") -> void:
	notes.append({"text": text, "tone": tone})
	var most := 10 if not ending.is_empty() else 4
	while notes.size() > most:
		notes.pop_front()


func _is_ally(key: String) -> bool:
	for one in combat.get("allies", []):
		if str(one.key) == key:
			return true
	return false


func _ranged(key: String) -> bool:
	if not _alive():
		return true
	var reach: Variant = _live().you.get("reach") if key == "you" else _live().fighters.get(key, {}).get("reach")
	return reach != "melee"


func _spot_of(key: String) -> Variant:
	if key == "you":
		return you if not you.is_empty() else null
	return shown.get(key)


static func _face(who: Dictionary, dx: float, dy: float) -> void:
	var across := dx * CW - dy
	var along := dx * CW + dy
	if absf(across) > 0.002:
		who.flip = across < 0.0
	if absf(along) > 0.002:
		who.back = along < 0.0


## Each thing that happened goes in the notes, and what can be seen of it over the room: a shot, a swing, a number.
func _played(events: Array) -> void:
	var in_battle := typeof(combat.get("battle")) == TYPE_DICTIONARY or _battle != ""
	for event in events:
		var by := str(event.get("by", "")) if event.get("by") != null else ""
		var onto := str(event.get("on", "")) if event.get("on") != null else ""
		var text := str(event.get("text", "")) if event.get("text") != null else ""
		# In a battle, with twenty people fighting across a deck, the notes keep to what concerns the player.
		var worth := not in_battle or by == "you" or onto == "you" or Live.truthy(event.get("down")) or Live.truthy(event.get("battle")) or Live.truthy(event.get("note"))
		if text != "" and worth:
			var said := text
			if event.get("where") != null:
				said = "%s (%s)" % [text, str(event.where)]
			elif Live.truthy(event.get("down")) and event.get("math") != null:
				said = "%s (%s)" % [text, str(event.math)]
			var tone := str(event.get("tone", "")) if event.get("tone") != null else ""
			_note(said, tone if TONES.has(tone) else "")
		elif event.get("note") != null:
			_note(str(event.note), "dim")
		var damage := float(event.get("damage", 0)) if event.get("damage") != null else 0.0
		var missed := Live.truthy(event.get("missed"))
		if by != "" and onto != "" and by != onto and (damage > 0.0 or missed):
			if _ranged(by):
				fx.append({"kind": "shot", "from": by, "to": onto, "hit": not missed, "t": 0.0, "life": 0.26})
			else:
				fx.append({"kind": "swing", "from": by, "to": onto, "t": 0.0, "life": 0.3})
			var shooter: Variant = _spot_of(by)
			var target: Variant = _spot_of(onto)
			if shooter != null and target != null:
				_face(shooter, float(target.x) - float(shooter.x), float(target.y) - float(shooter.y))
		if onto != "" and damage > 0.0:
			fx.append({"kind": "float", "key": onto, "text": "-%d" % int(damage), "color": Color("ff8f7f") if onto == "you" or _is_ally(onto) else Color("ffe9a8"), "big": str(event.get("math", "")).contains("critical"), "t": 0.0, "life": 1.2})
		elif onto != "" and missed:
			fx.append({"kind": "float", "key": onto, "text": "cover" if Live.truthy(event.get("cover")) else "miss", "color": Color("aeb6b0"), "big": false, "t": 0.0, "life": 1.1})
		elif onto != "" and event.get("gained") != null and float(event.gained) > 1.0:
			fx.append({"kind": "float", "key": onto, "text": "+%d" % int(event.gained), "color": Color("9df5b4"), "big": false, "t": 0.0, "life": 1.1})
		elif onto != "" and Live.truthy(event.get("refused")):
			fx.append({"kind": "float", "key": onto, "text": "no", "color": Color("aeb6b0"), "big": false, "t": 0.0, "life": 1.1})


# ---- What the room draws --------------------------------------------------------------------------------------------

## Someone drawn walks towards where the fight has them, as fast as they could, and a jump is a jump.
func _glide(who: Dictionary, goal: Dictionary, dt: float) -> void:
	var dx := float(goal.x) - float(who.x)
	var dy := float(goal.y) - float(who.y)
	var far := Vector2(dx * CW, dy).length()
	if far > 3.0:
		who.x = float(goal.x)
		who.y = float(goal.y)
		who.walking = false
		return
	var step := minf(far, SPEED * 1.4 * dt)
	who.walking = step > 0.0005
	if not who.walking:
		return
	who.x += dx / far * step
	who.y += dy / far * step
	who.step += step * 10.0
	_face(who, dx, dy)


## Where the player is drawn while the fight's in the room: { pos, flip, back, walking, step }.
func your_spot(dt: float) -> Dictionary:
	if _alive():
		var there: Dictionary = _live().you
		if you.is_empty():
			you = {"x": float(there.x), "y": float(there.y), "step": 0.0, "flip": false, "back": false, "walking": false}
		_glide(you, there, dt)
	elif not you.is_empty():
		you.walking = false
	if you.is_empty():
		return {}
	return {"pos": Vector2(you.x, you.y), "flip": you.flip, "back": you.back, "walking": you.walking, "step": you.step}


## Everyone else in the fight, for the room to draw among the people and things in it, each where they've got to.
func fighters(dt: float) -> Array:
	var list := []
	if not _alive():
		return list
	var live := _live()
	var aimed := str(live.you.get("target", "")) if live.you.get("target") != null else ""
	for group in [["ally", combat.get("allies", [])], ["enemy", combat.get("enemies", [])]]:
		var side: String = group[0]
		for fighter in group[1]:
			var key := str(fighter.key)
			var place: Variant = live.fighters.get(key)
			if typeof(place) != TYPE_DICTIONARY:
				continue
			var one: Variant = shown.get(key)
			if one == null:
				one = {"x": float(place.x), "y": float(place.y), "step": 0.0, "flip": false, "back": false, "walking": false, "fade": 1.0}
				_face(one, float(live.you.x) - float(place.x), float(live.you.y) - float(place.y))
				shown[key] = one
			_glide(one, place, dt)
			var out := Live.truthy(fighter.get("out"))
			var down := float(fighter.hp) <= 0.0
			if out:
				one.fade = maxf(0.0, one.fade - dt / 1.2)
			if one.fade <= 0.0:
				continue
			var ring: Variant = null
			if not down:
				if out:
					ring = Color(170 / 255.0, 180 / 255.0, 172 / 255.0, 0.5)
				elif side == "ally":
					ring = Color(142 / 255.0, 197 / 255.0, 1.0, 0.75)
				else:
					ring = Color(1.0, 170 / 255.0, 140 / 255.0, 0.98) if aimed == key or picking != "" else Color(1.0, 125 / 255.0, 105 / 255.0, 0.6)
			list.append({"key": key, "side": side, "x": one.x, "y": one.y, "color": fighter.get("color"), "person": place.get("person"), "down": down, "fade": one.fade, "flip": one.flip, "back": one.back, "walking": one.walking, "step": one.step, "ring": ring})
	return list


## The people in the room who are in the fight, so they're drawn once, as fighters.
func hidden() -> Dictionary:
	var out := {}
	if _alive():
		for place in _live().fighters.values():
			if place.get("person") != null:
				out[str(place.person)] = true
	return out


func _picked() -> Dictionary:
	if picking == "":
		return {}
	for action in combat.get("actions", []):
		if _key(action) == picking:
			return action
	return {}


static func _key(action: Dictionary) -> String:
	var act: Dictionary = action.action
	return "%s:%s" % [str(act.type), str(act.get("id", "")) if act.get("id") != null else ""]


func _attack() -> Dictionary:
	for action in combat.get("actions", []):
		if str(action.action.type) == "attack":
			return action
	return {}


## The odds on hitting or talking someone from where the player stands now: through cover a little less, and nothing at
## all where there's no line of fire or they're out of reach. { text, off }, or empty.
func _odds_on(enemy: String, action: Dictionary) -> Dictionary:
	if action.is_empty() or typeof(action.get("targets")) != TYPE_DICTIONARY:
		return {}
	var sight: Variant = _live().sight.get(enemy)
	var target: Variant = action.targets.get(enemy)
	if typeof(sight) != TYPE_DICTIONARY or typeof(target) != TYPE_DICTIONARY:
		return {}
	if Live.truthy(target.get("disabled")):
		return {"text": str(target.get("why", "")), "off": true}
	if str(action.get("oddsLabel", "")) == "WORKS":
		return {"text": "WORKS %d%%" % int(target.get("odds", 0)), "off": false} if Live.truthy(sight.get("heard")) else {"text": "too far to hear you", "off": true}
	var act: Dictionary = action.action
	var reach: Dictionary = sight.shot if str(act.type) == "ability" and not ["overcharged_shot", "foresight"].has(str(act.get("id", ""))) and typeof(sight.get("shot")) == TYPE_DICTIONARY else sight
	if not Live.truthy(reach.get("ok")):
		return {"text": str(reach.get("why", "")), "off": true}
	var cover := Live.truthy(reach.get("cover"))
	return {"text": "HIT %d%%%s" % [maxi(5, int(target.get("odds", 0)) - 15) if cover else int(target.get("odds", 0)), " · cover" if cover else ""], "off": false}


func _screen(x: float, y: float, z := 0.0) -> Vector2:
	var world: Node2D = main.world
	return world.position + Iso.at((x + 0.5) * CW, y + 0.5, z) * world.scale.x


func _chip(text: String, at: Vector2, colour: Color, background := Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62), see := 1.0) -> Rect2:
	var size := 11
	var wide := Pal.MONO_BOLD.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + 8.0
	var box := Rect2(clampf(at.x - wide / 2.0, 2.0, maxf(2.0, _room().x - wide - 2.0)), clampf(at.y - size - 6.0, 2.0, maxf(2.0, _room().y - size - 8.0)), wide, size + 5.0)
	draw_rect(box, Color(background, background.a * see))
	draw_string(Pal.MONO_BOLD, Vector2(box.position.x + 4.0, box.position.y + (box.size.y + Pal.MONO_BOLD.get_ascent(size) - Pal.MONO_BOLD.get_descent(size)) / 2.0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(colour, colour.a * see))
	return box


## What goes over the fighters, on top of everything: health, how soon they're ready, cover, names, the odds, and the
## shots and numbers flying (liveOverlay).
func _draw() -> void:
	if not on or not _alive():
		return
	var live := _live()
	var unit: float = Iso.UNIT * (main.world as Node2D).scale.x
	var you_at: Dictionary = you if not you.is_empty() else live.you
	var spots := {"you": you_at}
	for key in shown:
		spots[key] = shown[key]
	# Where the player's walking to.
	if typeof(live.you.get("to")) == TYPE_DICTIONARY:
		var goal := _screen(float(live.you.to.x), float(live.you.to.y))
		draw_set_transform(goal, 0.0, Vector2(1.0, 0.5))
		draw_arc(Vector2.ZERO, unit * 0.2, 0.0, TAU, 32, Color(214 / 255.0, 1.0, 226 / 255.0, 0.85), 1.3, true)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# Who the player's going for.
	var aimed := str(live.you.get("target", "")) if live.you.get("target") != null else ""
	if aimed != "" and spots.has(aimed) and _hp() > 0.0:
		var a := _screen(float(you_at.x), float(you_at.y)) + Vector2(0, -unit * 0.55)
		var b := _screen(float(spots[aimed].x), float(spots[aimed].y)) + Vector2(0, -unit * 0.55)
		draw_dashed_line(a, b, Color(1.0, 150 / 255.0, 130 / 255.0, 0.5), 1.2, 4.0)
	for one in fx:
		if one.kind == "float" or not spots.has(one.from) or not spots.has(one.to):
			continue
		var from := _screen(float(spots[one.from].x), float(spots[one.from].y))
		var to := _screen(float(spots[one.to].x), float(spots[one.to].y))
		var left: float = 1.0 - one.t / one.life
		if one.kind == "shot":
			if not one.hit:
				to += (to - from).normalized() * unit
			var mine: bool = one.from == "you" or _is_ally(one.from)
			draw_line(from + Vector2(0, -unit * 0.55), to + Vector2(0, -unit * 0.55), Color(Color("e6ffe9") if mine else Color("ffc29a"), left), 1.6, true)
			draw_circle(to + Vector2(0, -unit * 0.55), 2.0 + (1.0 - left) * 5.0, Color(Color("fff2c8") if one.hit else Color("9fb0a6"), left))
		else:
			draw_arc(to + Vector2(0, -unit * 0.5), unit * 0.18 * (1.4 - left), -2.2, -0.6, 12, Color(Color("ffd8b0"), left), 2.0, true)
	var action := _picked()
	var attack := _attack()
	var hover: String = main.call("_fight_hover")
	var marks := [{"key": "you", "name": "", "hp": _hp(), "max": float(combat.you.maxHp), "ready": float(live.you.get("ready", 1.0)), "covered": Live.truthy(live.you.get("covered")), "ally": true, "down": false, "out": false, "x": float(you_at.x), "y": float(you_at.y), "fade": 1.0}]
	for fighter in combat.get("allies", []) + combat.get("enemies", []):
		var key := str(fighter.key)
		var place: Variant = live.fighters.get(key)
		var one: Variant = shown.get(key)
		if typeof(place) != TYPE_DICTIONARY or one == null or one.fade <= 0.0:
			continue
		marks.append({"key": key, "name": str(fighter.name), "hp": float(fighter.hp), "max": float(fighter.maxHp), "ready": float(place.get("ready", 1.0)), "covered": Live.truthy(place.get("covered")), "ally": str(place.get("side", "")) == "us", "down": float(fighter.hp) <= 0.0, "out": Live.truthy(fighter.get("out")), "x": float(one.x), "y": float(one.y), "fade": float(one.fade)})
	# Names that would sit on each other step up out of the way, the nearest the front first.
	marks.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.x * CW + a.y > b.x * CW + b.y)
	var placed: Array[Rect2] = []
	for mark in marks:
		var at := _screen(mark.x, mark.y)
		# Whoever's off the screen has nothing over them: their names would only pile up along its edge.
		if at.x < -20.0 or at.x > _room().x + 20.0 or at.y < 0.0 or at.y > _room().y + unit:
			continue
		var lost: bool = mark.down or mark.out
		var wanted := {}
		if not mark.ally and not lost and (picking != "" or hover == "fighter:%s" % mark.key):
			wanted = _odds_on(mark.key, action if not action.is_empty() else attack)
		var named: bool = mark.name != ""
		var words: String = "%s: down" % mark.name if mark.down else mark.name
		var tall := (17.0 if named else 0.0) + (0.0 if lost else 11.0) + (17.0 if not wanted.is_empty() else 0.0)
		var top := at.y - unit * (0.3 if mark.down else 0.96)
		var half := maxf(26.0, Pal.MONO_BOLD.get_string_size(words, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x / 2.0 + 7.0) if named else 26.0
		for i in 30:
			var box := Rect2(at.x - half, top - tall, half * 2.0, tall)
			if not placed.any(func(other: Rect2) -> bool: return other.intersects(box)):
				break
			top -= 4.0
		placed.append(Rect2(at.x - half, top - tall, half * 2.0, tall))
		var see: float = mark.fade
		var above := top
		if named:
			above = _chip(words, Vector2(at.x, top), Color("9aa59d") if mark.down else (Color("bfe1ff") if mark.ally else Color("ffb4a4")), Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.62), see).position.y
		if not lost:
			var wide := 36.0
			var bx := roundf(at.x - wide / 2.0)
			var by := above - 6.0
			draw_rect(Rect2(bx - 1.0, by - 5.0, wide + 2.0, 10.0), Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.82 * see))
			draw_rect(Rect2(bx, by, roundf(wide * maxf(0.0, mark.hp) / maxf(1.0, mark.max)), 4.0), Color(Color("8df5ac") if mark.ally else Color("ff8f7f"), see))
			# How soon they're ready to act again, filling up.
			draw_rect(Rect2(bx, by - 4.0, roundf(wide * clampf(mark.ready, 0.0, 1.0)), 2.0), Color(Color("f2c14e"), see))
			if mark.covered:
				draw_rect(Rect2(bx + wide + 1.0, by - 2.0, 8.0, 8.0), Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.82 * see))
				draw_circle(Vector2(bx + wide + 5.0, by + 2.0), 2.4, Color(Color("8ec5ff"), see))
			above = by - 6.0
		if not wanted.is_empty():
			_chip(str(wanted.text), Vector2(at.x, above), Color("aeb6b0") if wanted.off else Color("f2c14e"), Color(20 / 255.0, 14 / 255.0, 2 / 255.0, 0.9), see)
	for one in fx:
		if one.kind != "float" or not spots.has(one.key):
			continue
		var at := _screen(float(spots[one.key].x), float(spots[one.key].y))
		var rise: float = one.t / one.life * 28.0
		var see := minf(1.0, (1.0 - one.t / one.life) * 1.6)
		var size := 17 if one.big else 13
		var wide := Pal.MONO_BOLD.get_string_size(one.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		var where := Vector2(at.x - wide / 2.0, at.y - unit * 1.32 - rise + size * 0.35)
		draw_string_outline(Pal.MONO_BOLD, where, one.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, Color(3 / 255.0, 4 / 255.0, 3 / 255.0, 0.9 * see))
		draw_string(Pal.MONO_BOLD, where, one.text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(one.color, see))


# ---- Clicks and keys ------------------------------------------------------------------------------------------------

## A click in the room during the fight: on one of the other side, to go for them, or do what's being aimed; on the
## floor, to walk there. hit: { kind: "fighter", key } or { kind: "floor", x, y }.
func click(hit: Dictionary) -> void:
	if not _alive() or not ending.is_empty() or _hp() <= 0.0:
		return
	if hit.get("kind") == "fighter":
		for enemy in combat.get("enemies", []):
			if str(enemy.key) == str(hit.key) and float(enemy.hp) > 0.0 and not Live.truthy(enemy.get("out")):
				var action := _picked()
				if action.is_empty():
					order({"type": "attack", "target": str(enemy.key)})
				else:
					var body: Dictionary = (action.action as Dictionary).duplicate()
					body["target"] = str(enemy.key)
					order(body)
				return
		return
	if picking != "":
		picking = ""
		_refresh()
		return
	if hit.get("kind") == "floor":
		order({"type": "move", "x": int(hit.x), "y": int(hit.y)})


## One of the orders along the bottom, by its number or a click on it.
func _chosen(action: Dictionary) -> void:
	if Live.truthy(action.get("disabled")) or not ending.is_empty() or _hp() <= 0.0:
		return
	if typeof(action.get("targets")) != TYPE_DICTIONARY:
		order((action.action as Dictionary).duplicate())
		return
	var foes: Array = combat.get("enemies", []).filter(func(one: Dictionary) -> bool: return float(one.hp) > 0.0 and not Live.truthy(one.get("out")))
	if foes.size() == 1:
		var body: Dictionary = (action.action as Dictionary).duplicate()
		body["target"] = str(foes[0].key)
		order(body)
	else:
		picking = "" if picking == _key(action) else _key(action)
		_refresh()


func _numbered() -> Array:
	var out := []
	for group in ["attack", "talk", "other"]:
		for action in combat.get("actions", []):
			if str(action.get("group", "other") if action.get("group") != null else "other") == group:
				out.append(action)
	return out


## The keys, while the fight's in the room: Space stops and starts it, a number gives that order, Esc lets go of an
## order waiting for someone to be aimed at. Says whether the key was the fight's.
func key(event: InputEventKey) -> bool:
	if not on:
		return false
	if event.physical_keycode == KEY_SPACE:
		if ending.is_empty():
			toggle_pause()
		return true
	if event.physical_keycode == KEY_ESCAPE and picking != "":
		picking = ""
		_refresh()
		return true
	var number := -1
	if event.physical_keycode >= KEY_0 and event.physical_keycode <= KEY_9:
		number = event.physical_keycode - KEY_0
	elif event.physical_keycode >= KEY_KP_0 and event.physical_keycode <= KEY_KP_9:
		number = event.physical_keycode - KEY_KP_0
	if number >= 0:
		var index := 9 if number == 0 else number - 1
		if not ending.is_empty():
			if index == 0 and story_waiting:
				_on_with_story()
			elif index == 0 or (index == 1 and story_waiting):
				leave()
		elif _alive():
			var actions := _numbered()
			if index < actions.size():
				_chosen(actions[index])
		return true
	return false


# ---- The windows ----------------------------------------------------------------------------------------------------

func _hint() -> String:
	if _hp() <= 0.0:
		return "You're down."
	if picking != "":
		return "Now click one of them in the room, or in the list."
	if paused:
		return "You're ready. Give an order, or press Space to go on." if held_for == "ready" else "Stopped. Click the floor to walk, one of them to go for them. Space goes on."
	return "Click the floor to walk, one of them to go for them. Space stops it."


func _button(words: String, tip: String, lit: bool, off: bool, run: Callable, p: Dictionary) -> Button:
	var b := Button.new()
	b.text = words
	b.tooltip_text = tip
	b.disabled = off
	b.focus_mode = Control.FOCUS_NONE
	b.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	b.add_theme_font_override("font", Pal.MONO)
	b.add_theme_font_size_override("font_size", 13)
	b.add_theme_color_override("font_color", p.bg if lit else p.bright)
	b.add_theme_color_override("font_hover_color", p.bg)
	b.add_theme_color_override("font_pressed_color", p.bg)
	b.add_theme_color_override("font_disabled_color", p.line)
	b.add_theme_stylebox_override("normal", Pal.margins(Pal.box(p.c if lit else Color(0, 0, 0, 0), p.line, 1), 6, 2))
	b.add_theme_stylebox_override("hover", Pal.margins(Pal.box(p.c, p.c, 1), 6, 2))
	b.add_theme_stylebox_override("pressed", Pal.margins(Pal.box(p.c, p.c, 1), 6, 2))
	b.add_theme_stylebox_override("disabled", Pal.margins(Pal.box(Color(0, 0, 0, 0), p.line, 1), 6, 2))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.pressed.connect(run)
	return b


## Draws the windows again, if what they say has changed: the notes in the room's top left, the orders or how it ended
## along its bottom, and the two sides down its right.
func _refresh() -> void:
	visible = on
	if not on:
		_drawn = ""
		return
	var queued := ""
	if _alive() and typeof(_live().you.get("queued")) == TYPE_DICTIONARY:
		queued = "%s:%s" % [str(_live().you.queued.type), str(_live().you.queued.get("id", "")) if _live().you.queued.get("id") != null else ""]
	var actions := _numbered() if _alive() else []
	var said := JSON.stringify([paused, held_for, picking, queued, message, notes, ending.get("result"), ending.get("summary"), story_waiting, _hp() <= 0.0, stop_when_ready, actions.map(func(a: Dictionary) -> Array: return [a.get("label"), a.get("disabled"), a.get("detail")]), _room().x])
	_roster.visible = _alive()
	if said == _drawn:
		return
	_drawn = said

	for old in _notes_box.get_children():
		_notes_box.remove_child(old)
		old.queue_free()
	var title_of := _battle if _battle != "" else "Fight"
	var over := not ending.is_empty()
	var banner := "%s's over" % ("The battle" if _battle != "" else "The fight") if over else ("%s · stopped" % title_of if paused else "%s · running" % title_of)
	_notes_box.add_child(main.call("_on_dark", Pal.label(banner.to_upper(), Pal.BRIGHT, 12, true)))
	for i in notes.size():
		var line: Label = main.call("_on_dark", Pal.label(str(notes[i].text), TONES.get(notes[i].tone, TONES[""]), 12))
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		line.custom_minimum_size.x = minf(520.0, _room().x - 40.0)
		line.modulate.a = 1.0 if i == notes.size() - 1 else 0.72
		_notes_box.add_child(line)

	for old in _orders.get_children():
		_orders.remove_child(old)
		old.queue_free()
	var p := Pal.kind("red" if over and BAD_ENDS.has(str(ending.get("result", ""))) else "green")
	_orders.add_theme_stylebox_override("panel", Pal.margins(Pal.box(p.panel, p.line, 1), 10, 6))
	_orders.visible = over or _alive()
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 5)
	_orders.add_child(column)
	var wide := minf(900.0, _room().x - 20.0)
	if over:
		var battle := Live.truthy(ending.get("battle"))
		var title: String = BATTLE_TITLES.get(str(ending.get("result", "")), "It's over") if battle else RESULT_TITLES.get(str(ending.get("result", "")), "It's over")
		column.add_child(Pal.label(title.to_upper(), p.c, 13, true))
		var summary := str(ending.get("summary", ""))
		if ending.get("math") != null and str(ending.math) != "":
			summary += " (%s)" % str(ending.math)
		var words := Pal.words(summary.replace("[", "[lb]"), p.bright, 13)
		words.custom_minimum_size.x = wide - 24.0
		column.add_child(words)
		if not battle:
			for one in ending.get("followers", []):
				column.add_child(Pal.label("%s: %s" % [str(one.name), "knocked out" if Live.truthy(one.get("down")) else "%d/%d health" % [int(one.hp), int(one.maxHp)]], p.dim, 12))
		# A fight a written scene was waiting on goes on with the story; any other is over.
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		if story_waiting:
			row.add_child(_button("1) Continue the story", "The story picks it up from here", false, false, _on_with_story, p))
			row.add_child(_button("2) Look around first", "", false, false, leave, p))
		else:
			row.add_child(_button("1) Back to the room", "", false, false, leave, p))
		column.add_child(row)
	elif _alive():
		var head := HBoxContainer.new()
		head.add_theme_constant_override("separation", 10)
		head.add_child(Pal.label("YOUR ORDERS", p.c, 13, true))
		head.add_child(Pal.label("stopped" if paused else "running", p.dim, 13))
		column.add_child(head)
		var flow := HFlowContainer.new()
		flow.add_theme_constant_override("h_separation", 6)
		flow.add_theme_constant_override("v_separation", 4)
		flow.custom_minimum_size.x = wide - 24.0
		column.add_child(flow)
		for i in actions.size():
			var action: Dictionary = actions[i]
			var off := Live.truthy(action.get("disabled")) or _hp() <= 0.0
			var tip := str(action.get("why", "")) if Live.truthy(action.get("disabled")) else (str(action.detail) if action.get("detail") != null else "")
			flow.add_child(_button("%d) %s" % [i + 1, str(action.label)], tip, picking == _key(action) or queued == _key(action), off, _chosen.bind(action), p))
		if message != "":
			column.add_child(Pal.label(message, Color("ff8f7f"), 12))
		var controls := HFlowContainer.new()
		controls.add_theme_constant_override("h_separation", 10)
		controls.custom_minimum_size.x = wide - 24.0
		column.add_child(controls)
		controls.add_child(_button("Go on (Space)" if paused else "Stop (Space)", "", false, false, toggle_pause, p))
		# A box to tick: the fight stops by itself each time the player's ready to act.
		controls.add_child(_button("[%s] Stop when I'm ready to act" % ("x" if stop_when_ready else " "), "The fight stops by itself each time you're ready to act", false, false, func() -> void:
			stop_when_ready = not stop_when_ready
			_refresh(), p))
		controls.add_child(Pal.label(_hint(), p.dim, 12))
	_orders.size = Vector2(wide, 0.0)
	_place()


## The windows where they go: the notes under the bar along the top, the orders along the bottom over the meter, the
## two sides down the right.
func _place() -> void:
	size = _room()
	var top: float = float(main.top.size.y)
	_notes_box.position = Vector2(10.0, top + 8.0)
	if _orders.visible:
		_orders.position = Vector2(10.0, _room().y - _orders.size.y - 34.0)
	if _roster.visible:
		_roster.place(top)


## How much of the bottom of the room the orders cover, for keeping the player in sight above them.
func covered_below() -> float:
	return _orders.size.y + 46.0 if on and _orders.visible else 0.0


## The two sides, down the right of the room: a click on one of the other side goes for them (liveRosterNode).
class Roster:
	extends Control

	const ROW := 20.0
	const WIDE := 250.0

	var fight: Fight
	var _rows: Array[Dictionary] = []

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP

	func place(top: float) -> void:
		_gather()
		size = Vector2(WIDE, maxf(ROW, _rows.size() * ROW + 12.0))
		position = Vector2(fight._room().x - WIDE - 10.0, top + 8.0)
		queue_redraw()

	func _gather() -> void:
		_rows.clear()
		var c := fight.combat
		if c.is_empty() or typeof(c.get("live")) != TYPE_DICTIONARY:
			return
		var live: Dictionary = c.live
		var allies: Array = c.get("allies", [])
		var enemies: Array = c.get("enemies", [])
		_rows.append({"head": "WITH YOU", "n": 1 + allies.filter(func(one: Dictionary) -> bool: return float(one.hp) > 0.0).size()})
		_rows.append({"name": str(c.you.name), "hp": float(c.you.hp), "max": float(c.you.maxHp), "side": "you", "lost": float(c.you.hp) <= 0.0, "sub": "energy %d/%d" % [int(c.you.get("energy", 0)), int(c.you.get("maxEnergy", 0))]})
		var battle := typeof(c.get("battle")) == TYPE_DICTIONARY
		var shown_allies: Array = allies.slice(0, Fight.BATTLE_ROWS) if battle else allies
		for one in shown_allies:
			_rows.append({"name": str(one.name), "hp": float(one.hp), "max": float(one.maxHp), "side": "ally", "lost": float(one.hp) <= 0.0 or Live.truthy(one.get("out")), "sub": "down" if float(one.hp) <= 0.0 else ""})
		if allies.size() > shown_allies.size():
			_rows.append({"rest": "%d more with you" % (allies.size() - shown_allies.size())})
		var standing: Array = enemies.filter(func(one: Dictionary) -> bool: return float(one.hp) > 0.0 and not Live.truthy(one.get("out")) and live.fighters.has(str(one.key)))
		_rows.append({"head": "AGAINST YOU", "n": standing.size()})
		var foes: Array = enemies
		if battle:
			# In a battle there are too many of them to list: the nearest still fighting, and how the rest stand.
			var far := func(one: Dictionary) -> float:
				var place: Dictionary = live.fighters[str(one.key)]
				return Vector2((float(place.x) - float(live.you.x)) * Iso.CELL_WIDTH, float(place.y) - float(live.you.y)).length()
			foes = standing.duplicate()
			foes.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return far.call(a) < far.call(b))
			foes = foes.slice(0, Fight.BATTLE_ROWS)
		var aimed := str(live.you.get("target", "")) if live.you.get("target") != null else ""
		for one in foes:
			var lost := float(one.hp) <= 0.0 or Live.truthy(one.get("out"))
			_rows.append({"name": str(one.name), "hp": float(one.hp), "max": float(one.maxHp), "side": "enemy", "key": str(one.key), "lost": lost, "aimed": aimed == str(one.key), "sub": "down" if float(one.hp) <= 0.0 else ("out of it" if Live.truthy(one.get("out")) else "")})
		if battle:
			var rest := PackedStringArray()
			if standing.size() > Fight.BATTLE_ROWS:
				rest.append("%d more further off" % (standing.size() - Fight.BATTLE_ROWS))
			var down := enemies.filter(func(one: Dictionary) -> bool: return float(one.hp) <= 0.0).size()
			if down > 0:
				rest.append("%d down" % down)
			var out := enemies.filter(func(one: Dictionary) -> bool: return float(one.hp) > 0.0 and Live.truthy(one.get("out"))).size()
			if out > 0:
				rest.append("%d out of it" % out)
			if not rest.is_empty():
				_rows.append({"rest": " · ".join(rest)})

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(4 / 255.0, 6 / 255.0, 5 / 255.0, 0.78))
		draw_rect(Rect2(Vector2.ZERO, size), Pal.LINE, false, 1.0)
		var font := Pal.MONO
		var y := 6.0
		for row in _rows:
			var base := y + 14.0
			if row.has("head"):
				draw_string(Pal.MONO_BOLD, Vector2(8, base), str(row.head), HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Pal.MUTED)
				draw_string(Pal.MONO_BOLD, Vector2(WIDE - 30, base), str(row.n), HORIZONTAL_ALIGNMENT_RIGHT, 22, 11, Pal.MUTED)
			elif row.has("rest"):
				draw_string(font, Vector2(8, base), str(row.rest), HORIZONTAL_ALIGNMENT_LEFT, WIDE - 16, 11, Pal.MUTED)
			else:
				var enemy: bool = row.side == "enemy"
				var ink := Color("7d8a80") if row.lost else (Color("ffb4a4") if enemy else (Color("b4f0be") if row.side == "you" else Color("bfe1ff")))
				if row.get("aimed", false):
					draw_rect(Rect2(2, y, WIDE - 4, ROW), Color(1.0, 125 / 255.0, 105 / 255.0, 0.16))
				draw_string(font, Vector2(8, base), str(row.name), HORIZONTAL_ALIGNMENT_LEFT, 118, 12, ink)
				var count := "%d/%d" % [int(maxf(0.0, row.hp)), int(row.max)] if str(row.sub) == "" or row.side == "you" else str(row.sub)
				draw_string(font, Vector2(130, base), count, HORIZONTAL_ALIGNMENT_LEFT, 58, 11, ink)
				draw_rect(Rect2(192, y + 7, 50, 6), Color(0, 0, 0, 0.6))
				draw_rect(Rect2(192, y + 7, roundf(50.0 * clampf(row.hp / maxf(1.0, row.max), 0.0, 1.0)), 6), Color("ff8f7f") if enemy else Color("8df5ac"))
			y += ROW

	func _gui_input(event: InputEvent) -> void:
		if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
			return
		var index := int(floor((event.position.y - 6.0) / ROW))
		if index >= 0 and index < _rows.size():
			var row := _rows[index]
			if row.get("side", "") == "enemy" and not row.lost:
				fight.click({"kind": "fighter", "key": row.key})
		accept_event()
