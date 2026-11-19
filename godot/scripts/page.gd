## A page of the game's menus, drawn by Godot. The game hands each menu over as a tree of elements, built by the same
## code that builds it for the browser (src/godot-pages-worker.js): what an element is, its classes, its words, and a
## number for anything that can be clicked. This lays that tree out and draws it in the game's console look, the way
## public/style.css lays the same elements out in the browser, and says which number was clicked.
##
## It knows the menus' classes (a row, a card, a fold, the star chart...) and nothing of what any menu is about, so a
## menu that changes in the game changes here by itself; only a new kind of layout needs a line in _style.
class_name Page
extends Control

signal pressed(id: int)
signal typed(id: int, value: String)
## The other mouse button on something that can be clicked: its number, and where the pointer was.
signal asked(id: int, at: Vector2)

enum { COLUMN, ROW, GRID, FIT, CARDS, RUN, CHART, PRE, FIELD, BOARD }

const SIZE := 15.0
const BAD := Color("ff7b6b")
const WARN := Color("f2c14e")
const INFO := Color("8ec5ff")
const BELIEF := Color("c9a6ff")
const LORE := Color("8fd0e8")
const TINT := Color(157 / 255.0, 245 / 255.0, 180 / 255.0, 0.06)
## What a box hands down to what's inside it.
const HANDED := ["color", "size", "bold", "upper", "pre", "speaker", "open", "keep", "line", "chart", "dead", "wide_spaces"]
const INLINE := ["span", "strong", "em", "i", "b", "a", "label", "small", "button"]
## Grids of the menus, as their columns are written in style.css: ["ch", n] so many characters wide, ["mm", least,
## most] between the two, ["fr", share] a share of what's left, ["auto"] as wide as what's in it.
const GRIDS := {
	"watch-row": [["mm", 14, 22], ["fr", 1]],
	"work-row": [["mm", 12, 22], ["mm", 22, 46], ["fr", 1]],
	"work-job": [["ch", 2.5], ["fr", 1.1], ["fr", 1.4], ["auto"]],
	"map-row": [["fr", 1.3], ["ch", 4], ["ch", 5], ["ch", 11], ["fr", 1.5], ["fr", 1], ["auto"]],
}

class Box:
	var d := {}
	var kind := 0
	var s := {}
	var kids: Array = []
	## A run of words: each { t, w, sz, col, b, sp, id, dis, tip, g, nl, sq, bg }.
	var words: Array = []
	## Where each word of a run ended up: [index, x, y, line height].
	var placed: Array = []
	var lines: PackedStringArray = []
	var at := Vector2.ZERO
	var size := Vector2.ZERO
	var natural := -1.0
	var id := -1
	var off := false
	var push := false
	var tip := ""
	var field: LineEdit

## The page's colours: the game's own green unless it's told otherwise (a console window in its kind's colours).
var ink := Pal.TEXT
var bright := Pal.BRIGHT
var dim := Pal.MUTED
var rule := Pal.LINE
var ground := Pal.BG
var board := Color(8 / 255.0, 17 / 255.0, 12 / 255.0, 0.92)
## Whether it's a console window in a kind's colours: there, "info" is the kind's own colour, not the game's blue.
var themed := false

var tree := {}
var root: Box
var hover := -1
var _wide := -1.0
var _groups := 0
var _fields: Array[LineEdit] = []
var _field_boxes: Array = []
var _ch := {}


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS
	clip_contents = true


## A kind's colours for the whole page (Pal.kind, or Pal.person for someone's own).
func use(colours: Dictionary) -> void:
	ink = colours.c
	bright = colours.bright
	dim = colours.dim
	rule = colours.line
	ground = colours.bg
	board = colours.get("panel", board)
	themed = true


## The page to show: the tree as the game handed it over.
func show_tree(now: Dictionary) -> void:
	tree = now
	_rebuild()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and absf(size.x - _wide) > 0.5 and not tree.is_empty():
		_rebuild()
	elif what == NOTIFICATION_MOUSE_EXIT and hover >= 0:
		hover = -1
		queue_redraw()


func _rebuild() -> void:
	_wide = size.x
	_groups = 0
	_field_boxes.clear()
	hover = -1
	if tree.is_empty() or _wide < 40.0:
		root = null
		queue_redraw()
		return
	root = _build(tree, {"color": ink, "size": SIZE, "bold": false, "upper": false, "pre": false, "speaker": LORE, "open": true, "keep": false, "line": 1.5, "chart": 0.0, "dead": false, "wide_spaces": false})
	_layout(root, _wide)
	custom_minimum_size.y = root.size.y
	_place_fields()
	queue_redraw()


# ---- What each element is ------------------------------------------------------------------------------------------

func _has(d: Dictionary, cls: String) -> bool:
	return (" %s " % str(d.get("c", ""))).contains(" %s " % cls)


## How an element is laid out and what it looks like, from its tag and classes (public/style.css, read by hand).
func _style(d: Dictionary, from: Dictionary) -> Dictionary:
	var s := {"kind": -1, "gap": Vector2.ZERO, "pad": [0.0, 0.0, 0.0, 0.0], "mt": 0.0, "mb": 0.0, "between": false, "apart": false}
	for key in HANDED:
		s[key] = from[key]
	var tag := str(d.get("t", "div"))
	var st := str(d.get("st", ""))
	if st.contains("--speaker:"):
		s.speaker = Color.from_string(st.get_slice("--speaker:", 1).get_slice(";", 0).strip_edges(), LORE)
	match tag:
		"strong", "b":
			s.bold = true
			if not s.keep:
				s.color = bright
		"h2":
			s.size = 16.0
			s.bold = true
			s.upper = true
			s.color = bright
		"h3":
			s.size = 13.0
			s.bold = true
			s.upper = true
			s.color = dim
			s.prefix = "-- "
			s.suffix = " --"
		"h4":
			s.size = 12.0
			s.upper = true
			s.color = dim
			s.mt = 10.0
			s.mb = 2.0
		"pre":
			s.kind = PRE
		"input", "textarea", "select":
			s.kind = FIELD
		"button":
			s.prefix = "[ "
			s.suffix = " ]"
			s.group = true
			s.dead = d.has("d")
	var classes := str(d.get("c", "")).split(" ", false)
	for cls in classes:
		match cls:
			"small":
				s.size = 13.0
			"muted", "tone-dim", "post-label", "post-since", "post-memory":
				s.color = dim
			"tone-good":
				s.color = ink
			"tone-bad", "watch-short", "command-deposed":
				s.color = BAD
				s.keep = true
			"tone-warn", "effects", "command-due", "post-replace", "watch-move", "watch-moving", "map-going", "map-course", "work-part":
				s.color = WARN
			"tone-info", "map-ship":
				s.color = ink if themed else INFO
			"tone-bright", "tone-link":
				s.color = bright
			"tone-cell":
				s.color = dim
			"tone-belief":
				s.color = BELIEF
			"stack":
				s.kind = COLUMN
				s.gap = Vector2(0, 2 if _has(d, "gap-small") else 10)
			"row":
				s.kind = ROW
				s.gap = Vector2(10, 10)
			"spread":
				s.kind = ROW
				s.gap = Vector2(12, 12)
				s.between = true
			"menu-row":
				s.kind = ROW
				s.gap = Vector2(12, 4)
				s.between = true
			"ship-supply-line":
				s.kind = ROW
				s.gap = Vector2(12, 0)
				s.between = true
				s.size = 13.0
				s.pre = true
			"ship-supply":
				s.kind = COLUMN
				s.gap = Vector2(0, 1)
			"low":
				if _has(d, "ship-supply") or _has(d, "meter"):
					s.color = BAD
					s.keep = true
			"card":
				s.pad = [10.0, 8.0, 10.0, 8.0]
				s.border = ink if (_has(d, "focused") or _has(d, "selected") or _has(d, "rig-loaded") or _has(d, "full")) else rule
				if _has(d, "focused"):
					s.bg = TINT
				if tag == "button":
					s.prefix = ""
					s.suffix = ""
					s.group = false
					if s.kind < 0:
						s.kind = COLUMN
			"selectable":
				s.mark = "(*) " if _has(d, "selected") else "( ) "
			"check":
				s.mark = "[x] " if _has(d, "selected") else "[ ] "
			"action":
				s.mark = "> "
			"menu-body":
				s.kind = COLUMN
				s.gap = Vector2(0, 14)
				s.pad = [18.0, 14.0, 18.0, 14.0]
			"menu-section", "menu-intro":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
			"fold":
				s.gap = Vector2.ZERO
				s.open = _has(d, "open")
			"fold-toggle":
				s.size = 13.0
				s.upper = true
				s.color = bright if from.open else ink
			"fold-body":
				s.kind = COLUMN
				s.off = not from.open
			"fold-inner":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
				s.pad = [0.0, 8.0, 0.0, 0.0]
			"menu-col":
				s.kind = COLUMN
				s.gap = Vector2(0, 18)
			"menu-columns":
				s.kind = FIT
				s.least = 38.0
				s.gap = Vector2(28, 18)
				s.fit = true
			"menu-cards":
				s.kind = CARDS
				s.least = 38.0
				s.gap = Vector2(28, 18)
			"menu-entry":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.pad = [0.0, 0.0, 0.0, 6.0]
				s.border = rule
				s.sides = 4
				s.dotted = true
			"tag":
				s.size = 12.0
				s.upper = true
				s.color = BAD if _has(d, "bad") else (ink if _has(d, "on") else dim)
				s.prefix = "<"
				s.suffix = ">"
				s.group = true
			"meter":
				s.pre = true
			"notice-inline":
				s.size = 13.0
				s.color = BAD if _has(d, "fail") else ink
			"person-name":
				s.color = s.speaker
				s.upper = true
				s.keep = true
			"codex-name":
				s.color = s.speaker if _has(d, "lore-person") else LORE
				s.keep = true
			"post-grid":
				s.kind = FIT
				s.least = 30.0
				s.gap = Vector2(10, 10)
			"post-card":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
			"post-cell":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
			"post-title":
				s.size = 12.0
				s.color = WARN
				s.upper = true
			"post-who":
				s.color = BAD if _has(d, "lost") else bright
				s.bold = true
			"post-duty":
				s.kind = ROW
				s.gap = Vector2(8, 0)
			"post-candidates":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
				s.pad = [6.0, 4.0, 6.0, 4.0]
				s.border = rule
				s.dotted = true
			"command-reviews":
				s.kind = ROW
				s.gap = Vector2(12, 4)
				s.mb = 10.0
			"command-mood":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
				s.pad = [0.0, 0.0, 0.0, 8.0]
				s.mb = 10.0
				s.border = rule
				s.sides = 4
				s.dotted = true
			"command-meters":
				s.kind = ROW
				s.gap = Vector2(18, 2)
			"command-waiting":
				s.pad = [0.0, 6.0, 0.0, 6.0]
				s.border = rule
				s.sides = 4
				s.dotted = true
			"command-answers":
				s.kind = ROW
				s.gap = Vector2(6, 6)
				s.mt = 4.0
			"watch-row":
				s.kind = GRID
				s.gap = Vector2(14, 2)
				s.pad = [0.0, 5.0, 0.0, 5.0]
				s.border = rule
				s.sides = 4
				s.dotted = true
			"watch-people":
				s.kind = ROW
				s.gap = Vector2(12, 4)
			"watch-person":
				if _has(d, "you"):
					s.color = bright
				if _has(d, "lost"):
					s.color = BAD
				if _has(d, "moving"):
					s.lit = WARN
			"work-page":
				s.kind = COLUMN
				s.gap = Vector2(0, 14)
			"work-top":
				s.kind = ROW
				s.gap = Vector2(12, 12)
				s.between = true
				s.upper = true
				s.color = dim
			"work-orders":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
				s.pad = [10.0, 8.0, 10.0, 8.0]
				s.border = rule
			"work-row":
				s.kind = GRID
				s.gap = Vector2(14, 2)
				s.pad = [0.0, 3.0, 0.0, 3.0]
			"work-job":
				s.kind = GRID
				s.gap = Vector2(12, 2)
				s.pad = [0.0, 4.0, 0.0, 4.0]
				s.border = rule
				s.sides = 1
			"work-name", "work-what":
				s.color = bright
			"work-mark":
				s.bold = true
			"work-squares":
				s.squares = [8.0, 10.0, 2.0, 142.0]
			"rig-memory":
				s.squares = [18.0, 10.0, 3.0, 0.0]
			"rig-board":
				s.kind = BOARD
			"rig-socket":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.least_high = 70.0
				if _has(d, "shut"):
					s.dotted = true
				if _has(d, "takes"):
					s.border = ink
				if _has(d, "chosen"):
					s.bg = TINT
			"rig-frame":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.least_wide = 120.0
				if _has(d, "chosen"):
					s.bg = TINT
			"rig-socket-kind":
				s.size = 10.0
				s.upper = true
				s.color = dim
			"rig-picked":
				s.most_wide = 560.0
			"ship-system-row":
				s.kind = ROW
				s.gap = Vector2(8, 4)
			"ship-trade":
				s.gap = Vector2(12, 2)
			"map-layout":
				s.kind = GRID if _wide >= 880.0 else COLUMN
				s.gap = Vector2(12, 12)
				s.cols = [["auto"], ["fr", 1]]
			"map-chart":
				s.kind = CHART
				s.border = rule
				s.bg = ground
				s.size = 13.0 if _wide >= 880.0 else minf(13.0, floorf(_wide / (_var(st, "--map-cols", 80.0) * 0.61)))
				s.line = 1.25
				s.chart = s.size
			"map-stars":
				s.color = rule
			"map-here":
				s.color = bright
				s.bold = true
			"map-star":
				s.prefix = ""
				s.suffix = ""
				s.over = ground
				if _has(d, "selected"):
					s.lit = ink
			"map-name":
				s.prefix = ""
				s.suffix = ""
			"map-side":
				s.kind = COLUMN
				s.gap = Vector2(0, 10)
			"map-lanes":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
			"map-row":
				s.kind = GRID
				s.gap = Vector2(12, 2)
				s.pad = [0.0, 3.0, 0.0, 3.0]
				s.border = rule
				s.sides = 4
				s.dotted = true
				if _has(d, "selected"):
					s.bg = TINT
			"map-tree":
				s.upper = true
				s.mt = 6.0
			"map-work":
				s.mt = 4.0
				s.mb = 2.0
			"map-why":
				s.pad = [0.0, 0.0, 0.0, 3.0]
			# A console window over the room (a thing's, the right-click menu's) and the room's own panel.
			"con":
				s.kind = COLUMN
				s.size = 13.0
				s.line = 1.4
			"con-title":
				s.kind = ROW
				s.gap = Vector2(12, 0)
				s.between = true
				s.pad = [10.0, 2.0, 10.0, 2.0]
				s.bg = ink
				s.color = ground
				s.keep = true
				s.size = 13.0
			"con-name":
				s.bold = true
				s.upper = true
			"con-word":
				s.size = 12.0
			"con-words":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [10.0, 8.0, 10.0, 8.0]
				s.color = bright
			"con-said":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
			"con-look":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				if _has(d, "after"):
					s.color = ink
			"con-ask":
				s.pad = [10.0, 6.0, 10.0, 0.0]
				s.color = bright
			"options":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.pad = [8.0, 6.0, 8.0, 8.0]
			"option":
				s.kind = ROW
				s.gap = Vector2(8, 0)
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.size = 14.0
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.start = true
			"option-number":
				s.color = dim
			"option-label":
				s.color = dim if from.get("dead", false) else bright
			"option-detail":
				s.color = dim
				s.size = 12.0
			"here-tag":
				s.kind = ROW
				s.gap = Vector2(8, 0)
				s.pad = [8.0, 1.0, 8.0, 1.0]
				s.bg = ink
				s.color = ground
				s.keep = true
				s.size = 12.0
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.hot = bright
				s.start = true
			"here-name":
				s.bold = true
				s.upper = true
			"here-summary":
				s.pad = [12.0, 10.0, 12.0, 8.0]
				s.color = dim
				s.size = 12.0
			"here-body":
				s.kind = COLUMN
				s.gap = Vector2(0, 12)
				s.pad = [12.0, 12.0, 12.0, 12.0]
				s.size = 13.0
			"here-top":
				s.kind = ROW
				s.gap = Vector2(10, 2)
				s.between = true
			"here-desc":
				s.color = dim
				s.size = 12.0
			"here-section":
				s.kind = COLUMN
				s.gap = Vector2(0, 1)
			"here-head":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(8, 0)
				s.color = dim
				s.size = 11.0
				s.upper = true
				s.pad = [0.0, 0.0, 0.0, 3.0]
				s.mb = 4.0
				s.border = rule
				s.sides = 4
				s.dotted = true
			"here-row":
				s.kind = ROW
				s.gap = Vector2(8, 0)
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.start = true
				if _has(d, "shut"):
					s.color = dim
			"here-badge":
				s.lit = s.speaker
				s.bold = true
				s.size = 11.0
				s.keep = true
			"here-who":
				s.color = s.speaker
				s.bold = true
				s.keep = true
			"here-asks":
				s.lit = Color("ffa94d")
				s.bold = true
				s.size = 11.0
			"here-doing":
				s.color = dim
				s.push = true
			"here-crowd":
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.color = dim
				s.size = 12.0
			"here-arrow", "here-note":
				s.color = dim
			"here-chips":
				s.kind = ROW
				s.gap = Vector2(6, 6)
			"plan-decks":
				s.kind = ROW
				s.gap = Vector2(10, 4)
				s.pad = [10.0, 6.0, 10.0, 0.0]
			"here-part":
				s.kind = ROW
				s.gap = Vector2(6, 0)
				s.pad = [7.0, 1.0, 7.0, 1.0]
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.color = Color("ff8f7f") if _has(d, "ringing") else (Color("ffc466") if _has(d, "down") else Color("76ecd2"))
				s.border = (s.color as Color).darkened(0.55)
				s.hot = s.color
				s.start = true
			"here-dot":
				s.dot = true
			"here-acts":
				s.kind = COLUMN
				s.gap = Vector2(0, 0)
			"room-note":
				s.color = BAD if _has(d, "bad") else WARN
			# A skill check's window: its consoles, its commands, and how it came out.
			"check-situation":
				s.pad = [10.0, 4.0, 10.0, 4.0]
				s.border = rule
				s.sides = 4
			"check-scene":
				s.size = 12.0
			"check-desk":
				s.kind = COLUMN if _has(d, "one") or _wide < 620.0 else GRID
				s.cols = [["fr", 1], ["fr", 1]]
				s.gap = Vector2(8, 8)
				s.pad = [8.0, 8.0, 8.0, 8.0]
			"check-panel":
				s.kind = COLUMN
				s.border = rule
				s.bg = board
			"check-panel-title":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(8, 0)
				s.pad = [6.0, 1.0, 6.0, 1.0]
				s.size = 12.0
				s.color = bright
				s.bg = Color(ink, 0.18)
				s.border = rule
				s.sides = 4
			"check-panel-marks":
				s.color = dim
			"check-panel-body":
				s.kind = COLUMN
				s.pad = [6.0, 4.0, 6.0, 4.0]
				s.size = 12.0
				s.line = 1.35
				s.pre = _has(d, "grid")
				s.wide_spaces = true
			"check-line":
				s.least_high = 16.0
			"check-link":
				s.prefix = ""
				s.suffix = ""
			"check-controls":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
				s.pad = [8.0, 4.0, 8.0, 4.0]
				s.border = rule
				s.sides = 1
			"check-commands":
				s.kind = ROW
				s.gap = Vector2(10, 2)
			"check-key", "check-hint":
				s.color = dim
			"check-run":
				s.color = bright
				s.bold = true
			"check-taskbar":
				s.kind = ROW
				s.gap = Vector2(8, 2)
				s.pad = [8.0, 3.0, 8.0, 3.0]
				s.size = 12.0
				s.border = ink
				s.sides = 1
				s.bg = ground.lerp(ink, 0.1)
			"check-tab":
				s.color = dim
			"check-start":
				s.color = bright
			"check-odds":
				s.bold = true
				s.push = true
			"check-verdict":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [12.0, 10.0, 12.0, 4.0]
			"check-verdict-title":
				s.size = 18.0
				s.bold = true
				s.upper = true
			"check-verdict-line":
				s.color = bright
			"check-verdict-math":
				s.color = dim
			"primary":
				if tag == "button":
					s.color = bright
					s.bold = true
	# Where the page's own rules make an element a column of its parts, each part is on a line of its own, words too.
	s.apart = s.kind == COLUMN
	if s.kind == GRID and not s.has("cols"):
		for cls in classes:
			if GRIDS.has(cls):
				s.cols = GRIDS[cls]
		# On a narrow page the work board's rows are one thing under another (style.css, at 900 wide and less).
		if _wide < 620.0 and (_has(d, "work-row") or _has(d, "work-job") or _has(d, "map-row")):
			s.kind = COLUMN
			s.gap = Vector2(0, 2)
	return s


func _var(st: String, name: String, otherwise: float) -> float:
	if not st.contains(name + ":"):
		return otherwise
	return float(st.get_slice(name + ":", 1).get_slice(";", 0))


## Whether something sits in a line of words (a word, a tag, a plain button) or is a box of its own.
func _in_line(k: Variant) -> bool:
	if typeof(k) != TYPE_DICTIONARY:
		return true
	var d: Dictionary = k
	if not INLINE.has(str(d.get("t", "div"))):
		return false
	for cls in str(d.get("c", "")).split(" ", false):
		if cls in ["row", "spread", "stack", "card", "menu-row", "post-card", "post-duty", "watch-people", "rig-socket", "rig-frame", "option", "here-row", "here-part", "here-tag"]:
			return false
	for child in d.get("k", []):
		if not _in_line(child):
			return false
	return true


func _build(d: Dictionary, from: Dictionary) -> Box:
	var b := Box.new()
	b.d = d
	b.s = _style(d, from)
	var s := b.s
	b.kind = s.kind if s.kind >= 0 else COLUMN
	b.off = s.get("off", false) or d.has("hidden")
	b.tip = str(d.get("tip", ""))
	if d.has("id") and (d.get("on", []) as Array).has("click") and not d.has("d"):
		b.id = int(d.id)
	var kids: Array = d.get("k", [])
	match b.kind:
		PRE:
			var text := ""
			for k in kids:
				if typeof(k) == TYPE_STRING:
					text += k
			b.lines = text.split("\n")
		FIELD:
			_field_boxes.append(b)
		CHART:
			for k in kids:
				if typeof(k) != TYPE_DICTIONARY:
					continue
				if str(k.get("t", "")) == "pre":
					b.kids.append(_build(k, s))
				else:
					var one := _run([k], s)
					one.d = k
					b.kids.append(one)
		ROW, GRID, FIT, CARDS, BOARD:
			for k in kids:
				if _in_line(k):
					var one := _run([k], s)
					if typeof(k) == TYPE_DICTIONARY:
						one.d = k
						one.push = _style(k, s).get("push", false)
					b.kids.append(one)
				else:
					b.kids.append(_build(k, s))
		_:
			var run: Array = []
			if s.has("prefix") and s.prefix != "" and not s.has("group"):
				run.append(s.prefix)
			for k in kids:
				if _in_line(k):
					if s.apart and not run.is_empty() and not (run.size() == 1 and s.has("prefix") and not s.has("group") and typeof(run[0]) == TYPE_STRING and run[0] == s.prefix):
						b.kids.append(_run(run, s))
						run = []
					run.append(k)
					continue
				if not run.is_empty():
					b.kids.append(_run(run, s))
					run = []
				b.kids.append(_build(k, s))
			if s.has("suffix") and s.suffix != "" and not s.has("group") and not run.is_empty():
				run.append(s.suffix)
			if not run.is_empty():
				b.kids.append(_run(run, s))
	return b


## A run of words and of whatever sits among them, as words to be wrapped.
func _run(nodes: Array, from: Dictionary) -> Box:
	var b := Box.new()
	b.kind = RUN
	b.s = from
	var state := {"space": false, "first": true}
	for k in nodes:
		_words(k, from, b.words, {"id": -1, "dis": false, "tip": "", "g": -1, "lit": null, "over": null, "mark": ""}, state)
	return b


func _words(k: Variant, from: Dictionary, out: Array, on: Dictionary, state: Dictionary) -> void:
	if typeof(k) == TYPE_STRING:
		_text(str(k), from, out, on, state)
		return
	var d: Dictionary = k
	if d.has("hidden"):
		return
	var s := _style(d, from)
	var mine := on.duplicate()
	if d.has("tip"):
		mine.tip = str(d.tip)
	if d.has("id") and (d.get("on", []) as Array).has("click"):
		mine.id = int(d.id)
		mine.dis = d.has("d")
	elif d.has("d"):
		mine.dis = true
	if str(d.get("t", "")) == "button" and d.has("d"):
		mine.dis = true
		mine.id = -1
	if s.has("lit"):
		mine.lit = s.lit
	if s.has("over"):
		mine.over = s.over
	if s.get("group", false):
		_groups += 1
		mine.g = _groups
	if s.get("dot", false):
		out.append({"t": "", "w": 6.0, "sz": s.size, "col": s.color, "b": false, "sp": false, "gap": 0.0, "id": mine.id, "dis": mine.dis, "tip": mine.tip, "g": -1, "sq": [6.0, 6.0, "dot", false]})
		state.space = false
		return
	if s.has("squares"):
		var q: Array = s.squares
		var wide := 0.0
		for child in d.get("k", []):
			if typeof(child) != TYPE_DICTIONARY:
				continue
			var kind := "on" if _has(child, "on") else ("over" if _has(child, "over") else ("want" if _has(child, "want") else ""))
			out.append({"t": "", "w": q[0], "sz": s.size, "col": s.color, "b": false, "sp": false, "gap": 0.0 if wide == 0.0 else q[2], "id": -1, "dis": false, "tip": mine.tip, "g": -1, "sq": [q[0], q[1], kind, q[3] > 0.0]})
			wide += q[0] + q[2]
		if q[3] > wide:
			out.append({"t": "", "w": q[3] - wide, "sz": s.size, "col": s.color, "b": false, "sp": false, "gap": 0.0, "id": -1, "dis": false, "tip": "", "g": -1})
		state.space = false
		return
	var before: String = s.get("prefix", "") if s.has("group") or str(d.get("t", "")) == "button" else ""
	var after: String = s.get("suffix", "") if s.has("group") or str(d.get("t", "")) == "button" else ""
	if before != "":
		_text(before, s, out, mine, state, true)
	for child in d.get("k", []):
		_words(child, s, out, mine, state)
	if after != "":
		_text(after, s, out, mine, state, true)


func _text(text: String, s: Dictionary, out: Array, on: Dictionary, state: Dictionary, _glued := false) -> void:
	if s.upper:
		text = text.to_upper()
	var font: Font = Pal.MONO_BOLD if s.bold else Pal.MONO
	var color: Color = s.color
	if on.dis:
		color = Color(dim, 0.6)
	if s.pre:
		var first := true
		for line in text.split("\n"):
			out.append({"t": line, "w": font.get_string_size(line, HORIZONTAL_ALIGNMENT_LEFT, -1, int(s.size)).x, "sz": s.size, "col": color, "b": s.bold, "sp": state.space and first, "id": on.id, "dis": on.dis, "tip": on.tip, "g": on.g, "nl": not first, "lit": on.lit, "over": on.over})
			first = false
		state.space = false
		return
	if text.begins_with(" ") or text.begins_with("\n"):
		state.space = true
	# On a console more than one space in a row is kept: each one more pushes the next word a character along.
	var more := 0
	var parts := text.split(" ", not s.wide_spaces)
	for i in parts.size():
		var word := parts[i].strip_edges()
		if word == "":
			if s.wide_spaces and i > 0:
				more += 1
				state.space = true
			continue
		if more > 0:
			out.append({"t": "", "w": more * _char(s.size), "sz": s.size, "col": color, "b": false, "sp": false, "gap": 0.0, "id": -1, "dis": false, "tip": "", "g": on.g})
			more = 0
		out.append({"t": word, "w": font.get_string_size(word, HORIZONTAL_ALIGNMENT_LEFT, -1, int(s.size)).x, "sz": s.size, "col": color, "b": s.bold, "sp": state.space, "id": on.id, "dis": on.dis, "tip": on.tip, "g": on.g, "lit": on.lit, "over": on.over})
		state.space = true
	state.space = text.ends_with(" ") or text.ends_with("\n")
	if parts.is_empty() and text != "":
		state.space = true


# ---- Laying it out -------------------------------------------------------------------------------------------------

func _char(size: float) -> float:
	var key := int(size * 4)
	if not _ch.has(key):
		_ch[key] = Pal.MONO.get_string_size("0", HORIZONTAL_ALIGNMENT_LEFT, -1, int(size)).x
	return _ch[key]


func _space(w: Dictionary) -> float:
	return _char(w.sz) if w.sp else float(w.get("gap", 0.0))


## How wide a box would be with all the room in the world.
func _natural(b: Box) -> float:
	if b.natural >= 0.0:
		return b.natural
	var s := b.s
	var pad: Array = s.get("pad", [0.0, 0.0, 0.0, 0.0]) if b.kind != RUN else [0.0, 0.0, 0.0, 0.0]
	var wide := 0.0
	match b.kind:
		RUN:
			var line := 0.0
			for w in b.words:
				if w.get("nl", false):
					wide = maxf(wide, line)
					line = 0.0
				line += w.w + (_space(w) if line > 0.0 else 0.0)
			wide = maxf(wide, line)
		PRE:
			for line in b.lines:
				wide = maxf(wide, line.length() * _char(s.size))
		FIELD:
			wide = 320.0
		CHART:
			wide = _var(str(b.d.get("st", "")), "--map-cols", 80.0) * _char(s.size) + 2.0
		ROW:
			for i in b.kids.size():
				wide += _natural(b.kids[i]) + (s.gap.x if i > 0 else 0.0)
		_:
			for kid in b.kids:
				if not kid.off:
					wide = maxf(wide, _natural(kid))
	b.natural = wide + pad[0] + pad[2]
	if s.has("least_wide") and b.kind != RUN:
		b.natural = maxf(b.natural, s.least_wide)
	return b.natural


func _layout(b: Box, wide: float) -> void:
	var s := b.s
	if b.kind == RUN:
		_layout_run(b, wide)
		return
	if s.has("most_wide"):
		wide = minf(wide, s.most_wide)
	var pad: Array = s.get("pad", [0.0, 0.0, 0.0, 0.0])
	var inner := maxf(10.0, wide - pad[0] - pad[2])
	var high := 0.0
	match b.kind:
		PRE:
			high = b.lines.size() * roundf(s.size * s.line)
			inner = maxf(inner, 0.0)
		FIELD:
			high = 28.0
			wide = minf(wide, 360.0)
		CHART:
			var st := str(b.d.get("st", ""))
			var unit := _char(s.size)
			var row := roundf(s.size * 1.25 * 4.0) / 4.0
			wide = _var(st, "--map-cols", 80.0) * unit + 2.0
			high = _var(st, "--map-lines", 20.0) * row + 2.0
			for kid in b.kids:
				if kid.kind == PRE:
					_layout(kid, wide)
					kid.at = Vector2(1, 1)
					continue
				_layout_run(kid, 4000.0)
				var where := str(kid.d.get("st", ""))
				var x := float(where.get_slice("left:", 1).get_slice("ch", 0)) if where.contains("left:") else 0.0
				var y := float(where.get_slice("calc(", 1).get_slice("*", 0)) if where.contains("calc(") else 0.0
				kid.at = Vector2(1 + x * unit, 1 + y * row)
		ROW:
			high = _layout_row(b, inner)
		GRID:
			high = _layout_grid(b, inner, _tracks(b, inner))
		FIT, CARDS:
			var least: float = s.least * _char(s.size)
			var count := maxi(1, int(floorf((inner + s.gap.x) / (least + s.gap.x))))
			if s.get("fit", false) or b.kind == CARDS:
				count = mini(count, maxi(1, b.kids.size()))
			var each: float = (inner - (count - 1) * s.gap.x) / count
			if b.kind == CARDS:
				high = _layout_cards(b, each, count)
			else:
				var cols: Array = []
				for i in count:
					cols.append(each)
				high = _layout_grid(b, inner, cols)
		BOARD:
			high = _layout_board(b, inner)
		_:
			var y := 0.0
			var first := true
			for kid in b.kids:
				if kid.off:
					continue
				_layout(kid, inner)
				var above: float = kid.s.get("mt", 0.0) if kid.kind != RUN else 0.0
				if not first:
					y += s.gap.y
				y += above
				kid.at = Vector2(pad[0], pad[1] + y)
				y += kid.size.y + (kid.s.get("mb", 0.0) if kid.kind != RUN else 0.0)
				first = false
			high = y
	if b.kind in [ROW, GRID, FIT, CARDS, BOARD]:
		for kid in b.kids:
			kid.at += Vector2(pad[0], pad[1])
	b.size = Vector2(wide, maxf(high + pad[1] + pad[3], s.get("least_high", 0.0)))


func _layout_run(b: Box, wide: float) -> void:
	b.placed.clear()
	var x := 0.0
	var y := 0.0
	var line_high := 0.0
	var most := 0.0
	var start := 0
	var words := b.words
	var loose := {}
	var i := 0
	while i < words.size():
		var w: Dictionary = words[i]
		# A button's or a tag's words stay on one line when they fit on one; one too long for a line wraps like any words.
		var need: float = w.w
		var last := i
		if w.g >= 0 and not loose.has(w.g):
			while last + 1 < words.size() and words[last + 1].g == w.g and not words[last + 1].get("nl", false):
				last += 1
				need += words[last].w + _space(words[last])
			if need > wide:
				loose[w.g] = true
				need = w.w
				last = i
		var gap := _space(w) if x > 0.0 else 0.0
		if w.get("nl", false) or (x > 0.0 and x + gap + need > wide + 0.5):
			_settle_line(b, start, y, line_high)
			y += line_high
			x = 0.0
			line_high = 0.0
			gap = 0.0
			start = b.placed.size()
		for j in range(i, last + 1):
			var one: Dictionary = words[j]
			var g := gap if j == i else _space(one)
			b.placed.append([j, x + g, y, 0.0, g])
			x += g + one.w
			line_high = maxf(line_high, roundf(one.sz * float(b.s.get("line", 1.5))))
		most = maxf(most, x)
		i = last + 1
	_settle_line(b, start, y, line_high)
	b.size = Vector2(minf(most, wide) if most > 0.0 else 0.0, y + line_high)


func _settle_line(b: Box, start: int, _y: float, high: float) -> void:
	for n in range(start, b.placed.size()):
		b.placed[n][3] = high


func _layout_row(b: Box, inner: float) -> float:
	var s := b.s
	var y := 0.0
	var line: Array = []
	var x := 0.0
	var rows: Array = []
	for kid in b.kids:
		if kid.off:
			continue
		var want := minf(_natural(kid), inner)
		if not line.is_empty() and x + s.gap.x + want > inner + 0.5:
			rows.append(line)
			line = []
			x = 0.0
		x += want + (s.gap.x if not line.is_empty() else 0.0)
		line.append([kid, want])
	if not line.is_empty():
		rows.append(line)
	for r in rows.size():
		var items: Array = rows[r]
		var used := 0.0
		var high := 0.0
		for item in items:
			_layout(item[0], item[1])
			used += item[0].size.x if item[0].kind == RUN else item[1]
			high = maxf(high, item[0].size.y)
		var between: float = s.gap.x
		if s.between and items.size() > 1:
			between = maxf(s.gap.x, (inner - used) / (items.size() - 1))
		var at := 0.0
		for item in items:
			var kid: Box = item[0]
			# What's pushed to the far end of its row (what someone's doing, after their name).
			if kid.push and rows.size() == 1:
				at = maxf(at, inner - (kid.size.x if kid.kind == RUN else item[1]))
			kid.at = Vector2(at, y + (high - kid.size.y) / 2.0)
			at += (kid.size.x if kid.kind == RUN else item[1]) + between
		y += high + (s.gap.y if r < rows.size() - 1 else 0.0)
	return y


## The widths of a grid's columns, the way a browser settles them: the fixed ones, then those with a least and a most
## grown as far as there's room, then what's left shared among the rest.
func _tracks(b: Box, inner: float) -> Array:
	var s := b.s
	var cols: Array = s.cols
	var unit := _char(s.size)
	var wide: Array = []
	var most: Array = []
	var share := 0.0
	for c in cols.size():
		var col: Array = cols[c]
		match col[0]:
			"ch":
				wide.append(col[1] * unit)
				most.append(col[1] * unit)
			"mm":
				wide.append(col[1] * unit)
				most.append(col[2] * unit)
			"auto":
				var need := 0.0
				for i in range(c, b.kids.size(), cols.size()):
					need = maxf(need, _natural(b.kids[i]))
				wide.append(minf(need, inner))
				most.append(wide[c])
			_:
				wide.append(0.0)
				most.append(0.0)
				share += col[1]
	var free: float = inner - s.gap.x * (cols.size() - 1)
	for w in wide:
		free -= w
	for round in 4:
		var able: Array = []
		for c in cols.size():
			if wide[c] < most[c] - 0.5:
				able.append(c)
		if able.is_empty() or free <= 0.5:
			break
		var each: float = free / able.size()
		for c in able:
			var add := minf(each, most[c] - wide[c])
			wide[c] += add
			free -= add
	if share > 0.0 and free > 0.0:
		for c in cols.size():
			if cols[c][0] == "fr":
				wide[c] = free * cols[c][1] / share
	return wide


func _layout_grid(b: Box, _inner: float, cols: Array) -> float:
	var s := b.s
	var y := 0.0
	var shown: Array = []
	for kid in b.kids:
		if not kid.off:
			shown.append(kid)
	var i := 0
	while i < shown.size():
		var high := 0.0
		var x := 0.0
		for c in cols.size():
			if i + c >= shown.size():
				break
			var kid: Box = shown[i + c]
			_layout(kid, maxf(10.0, cols[c]))
			kid.at = Vector2(x, y)
			high = maxf(high, kid.size.y)
			x += cols[c] + s.gap.x
		y += high
		i += cols.size()
		if i < shown.size():
			y += s.gap.y
	return y


## Cards in columns, each column filled in turn to about the same height (the browser's own columns).
func _layout_cards(b: Box, each: float, count: int) -> float:
	var s := b.s
	var total := 0.0
	for kid in b.kids:
		_layout(kid, each)
		total += kid.size.y + s.gap.y
	var aim := total / count
	var col := 0
	var y := 0.0
	var most := 0.0
	for kid in b.kids:
		if y > 0.0 and y + kid.size.y / 2.0 > aim and col < count - 1:
			col += 1
			y = 0.0
		kid.at = Vector2(col * (each + s.gap.x), y)
		y += kid.size.y + s.gap.y
		most = maxf(most, y - s.gap.y)
	return most


## The rig's board: each socket in the column and row its own style names.
func _layout_board(b: Box, inner: float) -> float:
	var st := str(b.d.get("st", ""))
	var count := maxi(1, int(st.get_slice("repeat(", 1).get_slice(",", 0))) if st.contains("repeat(") else 3
	var wide := minf(inner, 560.0)
	var each := (wide - (count - 1) * 6.0) / count
	var rows := {}
	for kid in b.kids:
		var where := str(kid.d.get("st", ""))
		var col := int(where.get_slice("grid-column:", 1).get_slice(";", 0)) if where.contains("grid-column:") else 1
		var row := int(where.get_slice("grid-row:", 1).get_slice(";", 0)) if where.contains("grid-row:") else 1
		_layout(kid, each)
		kid.at = Vector2((col - 1) * (each + 6.0), 0)
		if not rows.has(row):
			rows[row] = []
		rows[row].append(kid)
	var y := 6.0
	var order := rows.keys()
	order.sort()
	for row in order:
		var high := 0.0
		for kid in rows[row]:
			high = maxf(high, kid.size.y)
		for kid in rows[row]:
			kid.at.y = y
			kid.size.y = high
		y += high + 6.0
	return y


# ---- Drawing it ----------------------------------------------------------------------------------------------------

func _draw() -> void:
	if root != null:
		_paint(root, Vector2.ZERO, false)


func _paint(b: Box, at: Vector2, turned: bool) -> void:
	if b.off:
		return
	var s := b.s
	var here := at + b.at
	if b.kind == RUN:
		_paint_run(b, here, turned)
		return
	var box := Rect2(here, b.size)
	if b.id >= 0 and b.id == hover:
		turned = true
		draw_rect(box, s.get("hot", ink))
	elif s.has("bg") and s.bg != null:
		draw_rect(box, s.bg)
	if s.has("border") and not turned:
		var sides: int = s.get("sides", 15)
		var edges := [[1, box.position, Vector2(box.end.x, box.position.y)], [2, Vector2(box.end.x, box.position.y), box.end], [4, Vector2(box.position.x, box.end.y), box.end], [8, box.position, Vector2(box.position.x, box.end.y)]]
		for edge in edges:
			if sides & int(edge[0]):
				var from: Vector2 = (edge[1] as Vector2).floor() + Vector2(0.5, 0.5)
				var to: Vector2 = (edge[2] as Vector2).floor() + Vector2(0.5, 0.5)
				if s.get("dotted", false):
					draw_dashed_line(from, to, s.border, 1.0, 2.0)
				else:
					draw_line(from, to, s.border, 1.0)
	if b.kind == PRE:
		var high := roundf(s.size * s.line * 4.0) / 4.0 if s.chart > 0.0 else roundf(s.size * s.line)
		if s.chart > 0.0:
			high = roundf(s.size * 1.25 * 4.0) / 4.0
		var rise := Pal.MONO.get_ascent(int(s.size))
		var fall := Pal.MONO.get_descent(int(s.size))
		for i in b.lines.size():
			if b.lines[i].strip_edges() != "":
				draw_string(Pal.MONO, here + Vector2(0, i * high + (high + rise - fall) / 2.0), b.lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, int(s.size), ground if turned else s.color)
		return
	for kid in b.kids:
		_paint(kid, here, turned)


func _paint_run(b: Box, here: Vector2, turned: bool) -> void:
	for place in b.placed:
		var w: Dictionary = b.words[place[0]]
		var at := here + Vector2(place[1], place[2])
		var high: float = place[3]
		var color: Color = w.col
		var lit: Variant = w.get("lit")
		if w.id >= 0 and w.id == hover:
			lit = ink
		if turned:
			color = ground
		elif lit != null:
			draw_rect(Rect2(at.x - place[4] if _joined(b, place) else at.x, at.y, w.w + (place[4] if _joined(b, place) else 0.0), high).grow_individual(1 if not _joined(b, place) else 0, 0, 1, 0), lit)
			color = ground
		elif w.get("over") != null:
			draw_rect(Rect2(at.x, at.y, w.w + 2.0, high), w.over)
		if w.has("sq"):
			var q: Array = w.sq
			var box := Rect2(at.x, at.y + (high - q[1]) / 2.0, q[0], q[1])
			if q[2] == "dot":
				draw_circle(box.get_center(), 3.0, color)
			elif q[3]:
				# The work board's squares: what a store has, what it has over what it wants, and what it wants and hasn't.
				match q[2]:
					"on":
						draw_rect(box, bright)
					"over":
						draw_rect(box, dim)
					"want":
						draw_rect(box.grow(-0.5), dim, false, 1.0)
			elif q[2] == "on":
				draw_rect(box, ink)
			else:
				draw_rect(box.grow(-0.5), rule, false, 1.0)
			continue
		if w.t == "":
			continue
		var font: Font = Pal.MONO_BOLD if w.b else Pal.MONO
		var size := int(w.sz)
		draw_string(font, at + Vector2(0, (high + font.get_ascent(size) - font.get_descent(size)) / 2.0), w.t, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)


## Whether a word follows another of the same button on its line, so the lit strip behind them is unbroken.
func _joined(b: Box, place: Array) -> bool:
	var i: int = place[0]
	return place[1] > 0.0 and i > 0 and b.words[i - 1].id == b.words[i].id and b.words[i - 1].get("lit") == b.words[i].get("lit")


# ---- The pointer ---------------------------------------------------------------------------------------------------

## What's under a point: [the number to send if it's clicked or -1, its tooltip].
func _under(b: Box, at: Vector2, point: Vector2) -> Array:
	if b == null or b.off:
		return [-1, ""]
	var here := at + b.at
	if not Rect2(here, b.size).grow(1.0).has_point(point):
		return [-1, ""]
	if b.kind == RUN:
		for place in b.placed:
			var w: Dictionary = b.words[place[0]]
			if Rect2(here.x + place[1] - place[4], here.y + place[2], w.w + place[4], place[3]).has_point(point):
				return [-1 if w.dis else int(w.id), str(w.tip)]
		return [-1, ""]
	var found := [b.id, b.tip]
	for kid in b.kids:
		var inside := _under(kid, here, point)
		if inside[0] >= 0:
			found[0] = inside[0]
		if inside[1] != "":
			found[1] = inside[1]
	return found


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var now: int = _under(root, Vector2.ZERO, event.position)[0]
		if now != hover:
			hover = now
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hover >= 0 else Control.CURSOR_ARROW
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		var hit: int = _under(root, Vector2.ZERO, event.position)[0]
		if hit >= 0:
			accept_event()
			pressed.emit(hit)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		var hit: int = _under(root, Vector2.ZERO, event.position)[0]
		if hit >= 0:
			accept_event()
			asked.emit(hit, get_global_mouse_position())


func _get_tooltip(at_position: Vector2) -> String:
	return str(_under(root, Vector2.ZERO, at_position)[1])


func _make_custom_tooltip(for_text: String) -> Object:
	return Pal.tip(for_text, {"c": ink, "bg": ground, "bright": bright})


## Where a box is on the page, for the boxes to type in, which are Godot's own.
func _place_fields() -> void:
	while _fields.size() > _field_boxes.size():
		(_fields.pop_back() as LineEdit).queue_free()
	for i in _field_boxes.size():
		var b: Box = _field_boxes[i]
		if i >= _fields.size():
			var field := LineEdit.new()
			field.add_theme_font_override("font", Pal.MONO)
			field.add_theme_font_size_override("font_size", 14)
			field.add_theme_color_override("font_color", bright)
			field.add_theme_color_override("font_placeholder_color", dim)
			field.add_theme_color_override("caret_color", bright)
			field.add_theme_stylebox_override("normal", Pal.margins(Pal.box(ground, rule, 1), 6, 2))
			field.add_theme_stylebox_override("focus", Pal.margins(Pal.box(ground, ink, 1), 6, 2))
			field.text = str(b.d.get("v", ""))
			field.text_changed.connect(func(text: String) -> void: typed.emit(int(field.get_meta("id")), text))
			add_child(field)
			_fields.append(field)
		var field: LineEdit = _fields[i]
		field.set_meta("id", int(b.d.get("id", -1)))
		field.placeholder_text = str(b.d.get("ph", ""))
		if not field.has_focus():
			field.text = str(b.d.get("v", ""))
		field.position = _where(root, b, Vector2.ZERO)
		field.size = b.size


func _where(b: Box, wanted: Box, at: Vector2) -> Vector2:
	if b == wanted:
		return at + b.at
	for kid in b.kids:
		var found := _where(kid, wanted, at + b.at)
		if found.x > -9000.0:
			return found
	return Vector2(-9999, -9999)
