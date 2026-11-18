## The small sums of a game being played that the browser view also does (public/iso.js), kept the same here: when a
## level's picture has to be made again, how each person is dressed, and the game's own little dice for what's always
## the same in the same place (litter, blankets).
class_name Live
extends RefCounted

const SKIN := ["d8b090", "b98a64", "8e6444", "664834", "e4c4a8"]
const HAIR := ["2a2420", "4a3424", "6e5a3c", "8a8680", "1c1c20", "5a2c20"]
const TROUSERS := ["34322c", "2c3034", "3a342a", "2a2c2a", "40362c"]
## How often what grows in a bed moves on a stage (GROW_EVERY).
const GROW_EVERY := 6.0


## The level a view of the room is of: on the ship, the deck, whichever of its rooms the player's in.
static func level_of(view: Dictionary) -> String:
	var here: Dictionary = view.get("here", {})
	if here.has("deck") and typeof(here.deck) == TYPE_DICTIONARY:
		return str(here.deck.id)
	return str(here.get("id", ""))


## The place a view is of, and how many times its rooms have been read from their files: when either changes, the
## whole place is loaded again.
static func place_key(view: Dictionary) -> String:
	var place: Dictionary = view.get("place", {}) if typeof(view.get("place")) == TYPE_DICTIONARY else {}
	return "%s|%d" % [str(place.get("id", "")), int(place.get("drawn", 0))]


## Whether something the game said is a yes: true, a number that isn't nothing, or anything else that's there at all.
static func truthy(value: Variant) -> bool:
	match typeof(value):
		TYPE_NIL:
			return false
		TYPE_BOOL:
			return value
		TYPE_INT, TYPE_FLOAT:
			return value != 0
		TYPE_STRING:
			return value != ""
	return true


static func _num(value: Variant) -> String:
	return str(snappedf(float(value), 0.001)) if value != null else "0"


## What the still picture of a level is drawn from, as one string (sceneIdOf): when it changes, the picture is made
## again. It reads the game's view of a level, and what the game hands Godot of one, alike.
static func scene_id(view: Dictionary) -> String:
	var parts := PackedStringArray()
	for thing in view.get("things", []):
		if thing.has("part"):
			var part: Dictionary = thing.part
			parts.append("%s=%s%s%s" % [str(thing.id), str(part.get("word", "")), "L" if truthy(part.get("locked")) else "", "" if truthy(part.get("works")) else "x"])
	var dark := PackedStringArray()
	var unpowered := PackedStringArray()
	var burning := PackedStringArray()
	var scorched := PackedStringArray()
	var areas: Array = view.get("areas", [])
	for area in areas:
		if truthy(area.get("dark")):
			dark.append(str(area.id))
		if area.has("power") and area.power == false:
			unpowered.append(str(area.id))
		var fire := int(area.get("fire", 0)) if area.get("fire") != null else 0
		var breach := truthy(area.get("breach"))
		if fire > 0 or breach:
			burning.append("%s:%d%s" % [str(area.id), fire, "b" if breach else ""])
		if typeof(area.get("scorched")) == TYPE_DICTIONARY:
			scorched.append("%s:%d:%s" % [str(area.id), int(area.scorched.get("size", 0)), _num(area.scorched.get("left", 0))])
	var growing := PackedStringArray()
	for one in view.get("growing", []):
		growing.append("%s:%d" % [str(one.room), int(floor(float(one.get("made", 0)) / GROW_EVERY))])
	var marks := PackedStringArray()
	for mark in view.get("marks", []):
		marks.append("%s%d,%d:%s" % [str(mark.get("kind", "?")).left(1), int(mark.x), int(mark.y), _num(mark.get("left", 1))])
	var closed := PackedStringArray()
	for exit in view.get("exits", []):
		closed.append("%s%s" % [str(exit.get("key", "")), "x" if truthy(exit.get("closed")) else ""])
	var wear := ""
	if typeof(view.get("wear")) == TYPE_DICTIONARY:
		wear = "%d%d" % [int(view.wear.get("grime", 0)), int(view.wear.get("clutter", 0))]
	var whole := "deck"
	if areas.is_empty():
		var room: Variant = view.get("room")
		whole = "dark" if typeof(room) == TYPE_DICTIONARY and truthy(room.get("dark")) else "lit"
	var here: Dictionary = view.get("here", {})
	return "|".join(PackedStringArray([level_of(view), str(int(here.get("drawn", 0))), "%dx%d" % [int(view.get("cols", 0)), int(view.get("lines", 0))], ",".join(closed), whole, ",".join(dark), ",".join(parts), ",".join(unpowered), ",".join(burning), ",".join(growing), wear, ",".join(scorched), ",".join(marks)]))


## How someone's dressed, the same every time for the same person (lookFor): their coat from their own colour, the rest
## from their name.
static func look_for(key: String, color: Variant, crowd: bool) -> Dictionary:
	var sum := 0
	for i in key.length():
		sum = (sum * 31 + key.unicode_at(i)) & 0xFFFFFFFF
	var coat := Iso.mix(Iso.hex(color, "#6a6a60"), Color("55544c"), 0.68 if crowd else 0.42)
	return {
		"coat": coat,
		"coat_dark": Iso.scaled(coat, 0.62),
		"trousers": Color(TROUSERS[sum % TROUSERS.size()]),
		"skin": Color(SKIN[(sum >> 3) % SKIN.size()]),
		"hair": Color(HAIR[(sum >> 5) % HAIR.size()]),
		"vest": (sum >> 7) % 3 == 0,
		"pack": (sum >> 9) % 4 == 0,
		"long": (sum >> 11) % 4 == 0,
		"hat": (sum >> 13) % 5 == 0,
	}


## The game's little dice (randomFrom): the same numbers every time for the same words, so the same square always has
## the same rubbish on it.
class Dice:
	extends RefCounted

	var _seed := 0

	func _init(text: String) -> void:
		for i in text.length():
			_seed = (Iso._imul(_seed, 31) + text.unicode_at(i)) & 0xFFFFFFFF

	func roll() -> float:
		_seed = (_seed + 0x6d2b79f5) & 0xFFFFFFFF
		var t := Iso._imul(_seed ^ (_seed >> 15), 1 | _seed)
		t = ((t + Iso._imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
