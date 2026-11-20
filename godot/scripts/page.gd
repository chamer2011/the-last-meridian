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
## The pointer on a picture the game draws and listens on: "down", "move", "up" or "leave", and where on the picture.
signal pointed(id: int, how: String, at: Vector2)

enum { COLUMN, ROW, GRID, FIT, CARDS, RUN, CHART, PRE, FIELD, BOARD, DESK, PIC, PLAN, SPLIT, CANVAS }
## A computer's desktop (Keelworks, public/desktop.css): the grey of its panels, their light and dark edges, the blue of
## a title bar and of what's picked, and the teal behind it all.
const KEEL := {"face": Color("c3c3c3"), "hi": Color("ffffff"), "lo": Color("808080"), "dark": Color("000000"), "title": Color("0b2a6b"), "desk": Color("2e6a6c"), "dim": Color("5e5e5e")}

const SIZE := 15.0
const BAD := Color("ff7b6b")
const WARN := Color("f2c14e")
const INFO := Color("8ec5ff")
const BELIEF := Color("c9a6ff")
const LORE := Color("8fd0e8")
const TINT := Color(157 / 255.0, 245 / 255.0, 180 / 255.0, 0.06)
## What a box hands down to what's inside it.
const HANDED := ["color", "size", "bold", "upper", "pre", "speaker", "open", "keep", "line", "chart", "dead", "wide_spaces", "listed", "os", "pic", "pocket", "inspect", "tool"]
const INLINE := ["span", "strong", "em", "i", "b", "a", "label", "small", "button"]
## Grids of the menus, as their columns are written in style.css: ["ch", n] so many characters wide, ["mm", least,
## most] between the two, ["fr", share] a share of what's left, ["auto"] as wide as what's in it.
const GRIDS := {
	"watch-row": [["mm", 14, 22], ["fr", 1]],
	"work-row": [["mm", 12, 22], ["mm", 22, 46], ["fr", 1]],
	"work-job": [["ch", 2.5], ["fr", 1.1], ["fr", 1.4], ["auto"]],
	"map-row": [["fr", 1.3], ["ch", 4], ["ch", 5], ["ch", 11], ["fr", 1.5], ["fr", 1], ["auto"]],
	"mapedit-paints": [["fr", 1], ["fr", 1]],
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


## A window onto part of the page (the Story board's sheet, and what's picked beside it): what's drawn in it is cut off
## at its edges, so what's in it can be bigger than it and moved about behind it.
class Pane:
	extends Control

	var page: Control
	var box: RefCounted
	var ground := Color.BLACK
	var edge := Color.WHITE

	func _init() -> void:
		clip_contents = true
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		visible = false

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), ground)
		if box != null:
			page._paint_in(self, box)
		draw_rect(Rect2(Vector2(0.5, 0.5), size - Vector2.ONE), edge, false, 1.0)


## The page's colours: the game's own green unless it's told otherwise (a console window in its kind's colours).
var ink := Pal.TEXT
var bright := Pal.BRIGHT
var dim := Pal.MUTED
var rule := Pal.LINE
var ground := Pal.BG
var board := Color(8 / 255.0, 17 / 255.0, 12 / 255.0, 0.92)
## Whether it's a console window in a kind's colours: there, "info" is the kind's own colour, not the game's blue.
var themed := false
## The colour of words on something lit up under the pointer.
var flip := Pal.BG

var tree := {}
var root: Box
var hover := -1
var _wide := -1.0
var _groups := 0
var _fields: Array[Control] = []
var _field_boxes: Array = []
var _ch := {}
## What's been typed and not yet sent: it's sent a moment after the typing stops, or before the next click.
var _typing := {}
var _typing_left := 0.0
## How tall the page is to be, when it's to fill the room it's given (the Story board); 0 for as tall as what's in it.
## Such a page has windows of its own (the Story board's sheet and what's picked from it; the Map editor's tools, deck
## and what's chosen): where each is, how far what's in it has been moved, and which of them is the sheet, which moves
## both ways and is dragged.
var room_high := 0.0
var _split: Box
var _split_high := 420.0
var _split_at := Vector2.ZERO
var _views: Array[Rect2] = []
var _pans: Array[Vector2] = [Vector2.ZERO, Vector2.ZERO, Vector2.ZERO]
var _panes: Array[Pane] = [Pane.new(), Pane.new(), Pane.new()]
var _sheet := 0
var _panning := false
## A picture the game draws a shape at a time and listens on (the Map editor's deck), and the pointer on it.
var _canvas: Box
var _drawing := false
var _rest_at := Vector2.ZERO
var _rest_left := -1.0
var _rested := false
var _moved_seen := -1
var _tones := {}
## What's being drawn on: the page itself, or one of its windows while that draws its part.
var _pen: CanvasItem
## Where the bought packs' pictures are on this computer (the game's licensed folder), for a page that shows some of
## them, and the ones read so far: each file, and each picture cut and sized for its square.
static var packs_dir := ""
static var sheets := {}
static var shots := {}


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_PASS
	clip_contents = true
	_pen = self
	for pane in _panes:
		pane.page = self
		add_child(pane)
	set_process(false)


## A kind's colours for the whole page (Pal.kind, or Pal.person for someone's own).
func use(colours: Dictionary) -> void:
	ink = colours.c
	bright = colours.bright
	dim = colours.dim
	rule = colours.line
	ground = colours.bg
	board = colours.get("panel", board)
	flip = colours.get("turn", ground)
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
		_again()


## Drawn again: the page and its windows.
func _again() -> void:
	queue_redraw()
	for pane in _panes:
		pane.queue_redraw()


func _rebuild() -> void:
	_wide = size.x
	_groups = 0
	_field_boxes.clear()
	hover = -1
	_split = null
	_canvas = null
	_split_high = 420.0
	if tree.is_empty() or _wide < 40.0:
		root = null
		_place_panes()
		_place_fields()
		_again()
		return
	root = _build(tree, {"color": ink, "size": SIZE, "bold": false, "upper": false, "pre": false, "speaker": LORE, "open": true, "keep": false, "line": 1.5, "chart": 0.0, "dead": false, "wide_spaces": false, "listed": false, "os": false, "pic": 16.0, "pocket": false, "inspect": false, "tool": false})
	_layout(root, _wide)
	# A page that fills its room: its two windows take whatever height the rest of it leaves.
	if _split != null and room_high > 0.0:
		_split_high = maxf(240.0, room_high - (root.size.y - _split_high))
		_layout(root, _wide)
	custom_minimum_size.y = root.size.y
	_place_panes()
	_place_fields()
	_again()


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
			s.size = 11.0 if from.get("inspect", false) else 16.0
			s.bold = true
			s.upper = true
			s.color = dim if from.get("inspect", false) else bright
		"h3":
			s.size = 13.0
			s.bold = true
			s.upper = true
			s.color = dim
			s.prefix = "-- "
			s.suffix = " --"
			if from.tool:
				# A heading among the Map editor's tools: small and plain.
				s.size = 12.0
				s.bold = false
				s.prefix = ""
				s.suffix = ""
				s.mt = 6.0
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
			s.mt = 2.0
			s.mb = 4.0
		"svg", "style":
			s.off = not d.has("svg")
			s.kind = PIC
		"canvas":
			s.off = not d.has("cv") and not d.has("pic")
			s.kind = CANVAS
			s.faded = from.get("faded", false)
		"label":
			s.color = dim
			s.size = 12.0
		"hr":
			s.border = KEEL.lo
			s.sides = 1
			s.least_high = 3.0
		"kbd":
			s.color = dim
		"p":
			s.mb = 6.0
		"button":
			s.prefix = "[ "
			s.suffix = " ]"
			s.group = true
			s.dead = d.has("d")
			# Among the Map editor's tools, the one in hand is lit.
			if from.tool and d.has("pressed"):
				s.lit = ink
			if from.os:
				# On a desktop a button is a raised grey box, with no brackets.
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.kind = COLUMN
				s.pad = [8.0, 2.0, 8.0, 2.0]
				s.bg = KEEL.face
				s.bevel = 1
				s.shrink = true
				s.hot = KEEL.title
				if d.has("d"):
					s.color = KEEL.dim
			elif from.pocket:
				# On the rig a button is a thin green outline.
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.kind = COLUMN
				s.pad = [8.0, 3.0, 8.0, 3.0]
				s.size = 11.0
				s.border = Color("1d5a2c")
				s.color = Color("2a6a3a") if d.has("d") else Color("4fc46e")
				s.hot = Color("0d3a1a")
				s.shrink = true
				if d.has("pressed"):
					s.bg = Color("2a8c45")
					s.color = Color("031107")
	var classes := str(d.get("c", "")).split(" ", false)
	for cls in classes:
		match cls:
			"small":
				s.size = 13.0
			"muted", "tone-dim", "post-label", "post-since", "post-memory":
				s.color = dim
			"tone-bad", "watch-short", "command-deposed":
				s.color = Color("b40000") if from.os else BAD
				s.keep = true
			"tone-good":
				s.color = Color("006400") if from.os else ink
			"tone-warn" when from.os:
				s.color = Color("8a5a00")
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
				if from.get("in_kind", false):
					# An ending's name beside what the box is, on the Story board.
					s.upper = false
					s.color = dim
					s.apart_before = true
				else:
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
				s.then_space = true
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
			# The registry printout: amber type on a strip of printer paper, set in fixed columns.
			"sheet-dock", "sheet-feed":
				s.kind = COLUMN
			"sheet-slot":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(8, 0)
				s.pad = [10.0, 2.0, 4.0, 2.0]
				s.size = 11.0
				s.color = dim
				s.bg = Color("1a1206")
				s.border = Color("5a3d12")
			"sheet-paper":
				s.kind = COLUMN
				s.pad = [22.0, 8.0, 22.0, 10.0]
				s.size = 12.0
				s.line = 1.4
				s.wide_spaces = true
			"sheet-line", "sheet-attr":
				s.pre = true
			"sheet-field":
				s.kind = GRID
				s.cols = [["ch", 11], ["fr", 1]]
			"sheet-label", "sheet-hi":
				s.color = bright
				s.keep = true
			"sheet-dim":
				s.color = dim
			"sheet-red":
				s.color = BAD
			"sheet-warn":
				s.color = Color("ffd36b")
			"sheet-skills":
				s.kind = FIT
				s.least = 18.0
				s.gap = Vector2(7, 0)
				s.pad = [14.0, 0.0, 0.0, 0.0]
			"sheet-btn", "sheet-link", "sheet-skill":
				s.prefix = ""
				s.suffix = ""
				s.pre = true
				if from.get("dead", false) or d.has("d"):
					s.color = Color("6b4a1d")
				if _has(d, "on"):
					s.lit = ink
			"sheet-actions":
				s.kind = ROW
				s.gap = Vector2(8, 2)
			"sheet-pages":
				s.kind = ROW
				s.gap = Vector2(6, 2)
				s.pad = [0.0, 0.0, 0.0, 4.0]
				s.mb = 4.0
				s.border = rule
				s.sides = 4
				s.dotted = true
			"sheet-skill-row":
				s.kind = ROW
				s.gap = Vector2(7, 0)
				s.pre = true
			"sheet-group":
				s.mb = 2.0
			"sheet-note":
				s.pad = [28.0, 0.0, 0.0, 0.0]
			"sheet-mark":
				s.pad = [14.0, 0.0, 0.0, 0.0]
			# A computer: its monitor, the desktop on it (640 by 480, as the page draws it), and what's on the desktop.
			"desk", "device-row":
				s.kind = ROW
				s.gap = Vector2(10, 10)
			"monitor":
				s.kind = COLUMN
				s.pad = [18.0, 18.0, 18.0, 8.0]
				s.bg = Color("232624")
				s.gap = Vector2(0, 6)
			"fx", "float-leader", "rig-lead":
				s.off = true
			"plate":
				s.kind = ROW
				s.gap = Vector2(10, 0)
				s.color = Color("6c736d")
				s.size = 10.0
				s.pad = [0.0, 2.0, 0.0, 0.0]
			"led":
				s.dot = true
				s.color = BAD if _has(d, "bad") else (WARN if _has(d, "warn") else Color("3cff7a"))
			"os":
				s.kind = DESK
				s.bg = KEEL.desk
				s.os = true
				s.size = 11.0
				s.line = 1.35
				s.color = Color.BLACK
				s.keep = true
			"bev":
				s.bg = KEEL.face
				s.bevel = 1
			"sunk":
				s.bg = Color.WHITE
				s.bevel = -1
			"icons":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
			"icon":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
				s.pad = [2.0, 2.0, 2.0, 2.0]
				s.bg = null
				s.bevel = 0
				s.color = Color.WHITE
				s.least_wide = 76.0
				s.shrink = true
				s.pic = 32.0
				s.middle = true
			"win":
				s.kind = COLUMN
				s.pad = [3.0, 3.0, 3.0, 3.0]
				s.front = _has(d, "top")
			"wtitle":
				s.kind = ROW
				s.gap = Vector2(4, 0)
				s.pad = [4.0, 1.0, 2.0, 1.0]
				s.bg = KEEL.title if from.get("front", true) else KEEL.lo
				s.color = Color.WHITE
				s.bold = true
				s.pic = 14.0
				s.between = true
			"body":
				if from.os:
					s.kind = COLUMN
					s.gap = Vector2(0, 5)
					s.pad = [5.0, 5.0, 5.0, 5.0]
					s.grow = true
			"pane-in", "viewer-in":
				s.kind = COLUMN
				s.gap = Vector2(0, 5 if cls == "viewer-in" else 0)
				s.pad = [6.0, 5.0, 6.0, 5.0] if cls == "pane-in" else [0.0, 0.0, 0.0, 0.0]
				s.wide_spaces = true
				s.grow = cls == "pane-in"
			"status":
				s.kind = ROW
				s.gap = Vector2(2, 0)
			"rows", "items":
				s.kind = COLUMN
			"row-item":
				s.kind = GRID
				s.cols = [["ch", 2.6], ["fr", 1], ["auto"]]
				s.gap = Vector2(4, 0)
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.bg = KEEL.title if _has(d, "open") else null
				s.color = Color.WHITE if _has(d, "open") else (KEEL.dim if _has(d, "done") else Color.BLACK)
				s.bevel = 0
				s.shrink = false
			"computer-screen-title":
				s.bold = true
				s.upper = true
				s.mb = 4.0
			"computer-rows":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
			"computer-row":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.pad = [6.0, 4.0, 6.0, 4.0]
				s.border = Color("b40000") if _has(d, "down") else KEEL.lo
			"computer-row-head":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(6, 0)
			"computer-row-actions":
				s.kind = ROW
				s.gap = Vector2(4, 4)
				s.mt = 2.0
			"taskbar":
				s.kind = ROW
				s.gap = Vector2(4, 0)
				s.pad = [2.0, 2.0, 2.0, 2.0]
			"keel":
				s.bold = true
				s.kind = ROW
				s.gap = Vector2(4, 0)
			"tasks":
				s.kind = ROW
				s.gap = Vector2(3, 0)
			"tray":
				s.kind = ROW
				s.gap = Vector2(6, 0)
				s.pad = [8.0, 2.0, 8.0, 2.0]
				s.push = true
			"menu":
				if from.os:
					s.kind = COLUMN
					s.pad = [2.0, 2.0, 2.0, 2.0]
			"side":
				s.off = true
			"balloon":
				s.kind = COLUMN
				s.pad = [8.0, 6.0, 8.0, 8.0]
				s.bg = Color("ffffe1")
				s.border = Color.BLACK
			"navcom-top":
				s.kind = ROW
				s.between = true
				s.pad = [6.0, 1.0, 6.0, 1.0]
				s.bg = Color("0b2a6b")
				s.color = Color.WHITE
			"pocket":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
				s.pad = [14.0, 12.0, 14.0, 10.0]
				s.bg = Color("2f3234")
				s.border = Color("111111")
				s.pocket = true
				s.color = Color("8b9196")
				s.size = 11.0
				s.most_wide = 480.0
			"pocket-top", "pocket-bottom":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(10, 0)
				s.size = 10.0
			"pocket-lights":
				s.kind = ROW
				s.gap = Vector2(10, 0)
			"pocket-screen":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [8.0, 6.0, 8.0, 8.0]
				s.bg = Color("020a04")
				s.border = Color("0b0d0c")
				s.color = Color("8ff0a8")
				s.size = 12.0
			"pocket-tube", "pocket-list", "pocket-plug":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
			"pocket-tabs":
				s.kind = ROW
				s.gap = Vector2(4, 0)
				s.pad = [0.0, 0.0, 0.0, 4.0]
				s.border = Color("1d5a2c")
				s.sides = 4
			"pocket-where":
				s.color = Color("3f8f57")
				s.size = 10.0
				s.push = true
			"pocket-note":
				s.pad = [2.0, 8.0, 2.0, 8.0]
				s.color = Color("4fc46e")
			"pocket-row":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(10, 2)
			"pocket-log":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
			# The network map: each deck a band, each system a small box where the page's own layout puts it, wires between.
			"netmap":
				s.kind = PLAN
			"net-band":
				s.kind = COLUMN
				s.border = Color("1d5a2c", 0.55)
				s.pad = [4.0, 2.0, 0.0, 0.0]
				s.size = 9.0
				s.upper = true
				s.color = Color("4fc46e")
			"net-node":
				s.pad = [4.0, 1.0, 4.0, 1.0]
				s.size = 10.0
				s.line = 1.15
				s.gap = Vector2.ZERO
				s.bg = Color("2a8c45") if _has(d, "here") else Color("031107")
				s.color = Color("031107") if _has(d, "here") else Color("8ff0a8", 0.8 if d.has("d") else 1.0)
				s.border = Color("c9ffd8") if _has(d, "near") and not d.has("d") else (Color("8ff0a8") if _has(d, "here") else Color("1d5a2c"))
				s.dotted = _has(d, "hard") or _has(d, "sealed")
				s.most_wide = 104.0
			"rig-pocket":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
				s.pad = [6.0, 10.0, 6.0, 10.0]
				s.bg = Color("26282a")
				s.color = Color("4fc46e")
				s.prefix = ""
				s.suffix = ""
				s.group = false
				s.hot = Color("0d3a1a")
			# The fight window, for a fight that isn't in the room: the two sides, what happened, and the orders.
			"fight-window":
				s.kind = COLUMN
				s.size = 13.0
			"fight-title":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(12, 0)
				s.pad = [10.0, 2.0, 10.0, 2.0]
				s.bg = ink
				s.color = ground
				s.keep = true
				s.bold = true
				s.upper = true
			"fight-body":
				s.kind = GRID if _wide >= 700.0 else COLUMN
				s.cols = [["fr", 1.6], ["fr", 1]]
			"fight-center":
				s.kind = COLUMN
			"fight-arena":
				s.kind = ROW
				s.gap = Vector2(14, 8)
				s.pad = [10.0, 8.0, 10.0, 8.0]
			"fight-side":
				s.kind = ROW
				s.gap = Vector2(6, 6)
			"fight-clash":
				s.color = WARN
				s.bold = true
			"fight-side-title":
				s.color = dim
				s.size = 12.0
				s.upper = true
			"fight-log", "fight-result", "fight-actions":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.pad = [12.0, 6.0, 12.0, 8.0]
				s.border = rule
				s.sides = 1 if cls != "fight-actions" else 8
			"fight-round":
				s.color = dim
				s.size = 12.0
			"fight-opening":
				s.color = Color("d9d6cb")
			"fight-result-title":
				s.size = 18.0
				s.bold = true
				s.upper = true
			"fight-read":
				s.color = dim
				s.size = 12.0
				s.pad = [12.0, 4.0, 12.0, 4.0]
			"fighter", "fight-card":
				s.kind = COLUMN
				s.pad = [6.0, 4.0, 6.0, 4.0]
				s.border = rule
			# The Story board: a story as boxes and arrows on a sheet, with what's picked beside it to read and change.
			"board":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
				s.pad = [14.0, 10.0, 14.0, 10.0]
				s.size = 14.0
			"board-head":
				s.kind = ROW
				s.gap = Vector2(14, 6)
				s.pad = [0.0, 0.0, 0.0, 8.0]
				s.border = rule
				s.sides = 4
			"board-tabs":
				s.kind = ROW
				s.gap = Vector2(8, 4)
			"board-tools":
				# Making the sheet bigger and smaller, and putting moved boxes back: there's neither in this window.
				s.off = true
			"board-tab":
				s.color = dim
				if d.has("pressed"):
					s.lit = ink
			"board-status":
				s.color = BAD if _has(d, "fail") else (ink if _has(d, "ok") else dim)
				s.size = 12.0
			"board-save":
				s.lit = ink
			"board-main":
				s.kind = SPLIT
			"board-wrap", "board-scroll":
				s.kind = COLUMN
			"board-canvas":
				s.kind = PLAN
				s.scene = _has(d, "scene")
			"board-node":
				s.kind = COLUMN
				s.pad = [8.0, 6.0, 8.0, 7.0]
				s.bg = ground
				s.gap = Vector2(0, 2)
				s.tone = bright if _has(d, "lead") else (WARN if _has(d, "ending") or _has(d, "check") else (LORE if _has(d, "route") else (INFO if _has(d, "fact") else (BELIEF if _has(d, "consequence") else (BAD if _has(d, "end") else (dim if _has(d, "about") or _has(d, "truth") or _has(d, "clock") or _has(d, "stub") else (Color("d9d6cb") if _has(d, "next") or _has(d, "react") or _has(d, "link") else ink)))))))
				s.border = bright if _has(d, "selected") else (BAD if _has(d, "problem") else rule)
				s.dotted = _has(d, "stub") or _has(d, "link")
				s.soft = true
				s.most_wide = 150.0 if _has(d, "stub") else (210.0 if _has(d, "fact") or _has(d, "link") else (250.0 if _has(d, "clock") or _has(d, "next") or _has(d, "react") else 230.0))
				s.boxed = true
				s.picked = _has(d, "selected")
			# What's in a box is laid out here exactly as src/godot-pages-worker.js reckons its height (Element.sizeOf),
			# which is what the board stacks its boxes by: a change to one is a change to the other.
			"kind":
				if from.get("boxed", false):
					s.size = 10.0
					s.upper = true
					s.color = from.tone
					s.anywhere = true
					s.in_kind = true
			"name":
				if from.get("boxed", false):
					s.color = bright
					s.bold = true
					s.anywhere = true
			"when":
				s.color = dim
				s.size = 11.0
				s.line = 1.3
				s.anywhere = true
			"words":
				if from.get("boxed", false):
					s.color = Color("d9d6cb")
					s.size = 12.0
					s.line = 1.3
					s.lines = true
					s.most_lines = 40 if from.get("picked", false) else 4
			"board-label":
				s.pad = [4.0, 1.0, 4.0, 1.0]
				s.size = 11.0
				s.color = BELIEF if _has(d, "timer") else (Color("d9d6cb") if _has(d, "cond") else (ink if _has(d, "choice") else dim))
				s.bg = board
				s.border = bright if _has(d, "selected") else rule
				s.most_wide = 160.0 if from.get("scene", false) else 104.0
				s.shrink = true
			"board-text":
				s.color = Color("d9d6cb")
				s.size = 13.0
				s.pad = [14.0, 12.0, 14.0, 12.0]
			"board-inspector":
				s.kind = COLUMN
				s.gap = Vector2(0, 10)
				s.pad = [12.0, 10.0, 12.0, 10.0]
				s.inspect = true
			"hint":
				s.color = dim
				s.size = 12.0
			"quote":
				s.color = Color("d9d6cb")
			"choices", "condition", "subfacts", "problems":
				s.kind = COLUMN
				s.gap = Vector2(0, 5)
				if cls == "problems":
					s.color = BAD
					s.border = BAD.darkened(0.4)
					s.pad = [8.0, 6.0, 8.0, 6.0]
					s.size = 12.0
			"legend", "board-foot":
				s.kind = ROW
				s.gap = Vector2(14, 4)
				s.color = dim
				s.size = 11.0 if cls == "legend" else 12.0
			# The Map editor: its tools, a deck seen from straight above to redraw by clicking, and what's chosen on it.
			"mapedit":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [14.0, 10.0, 14.0, 10.0]
				s.size = 14.0
				s.tool = true
			"mapedit-head":
				s.kind = ROW
				s.gap = Vector2(14, 6)
				s.pad = [0.0, 0.0, 0.0, 8.0]
				s.border = rule
				s.sides = 4
			"mapedit-decks", "mapedit-row":
				s.kind = ROW
				s.gap = Vector2(4, 4)
			"mapedit-end":
				s.push = true
			"mapedit-save":
				s.lit = ink
			"mapedit-remove":
				s.color = BAD
			"mapedit-says":
				s.color = WARN if _has(d, "bad") else (ink if _has(d, "ok") else dim)
				s.least_high = 21.0
			"mapedit-body":
				s.kind = SPLIT
				s.split = "tools"
			"mapedit-tools", "mapedit-side":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
				s.pane = Color(0, 0, 0, 0)
				s.edged = false
				s.size = 13.0
			"mapedit-middle":
				s.kind = COLUMN
				s.pane = Color("020503")
			"mapedit-paints":
				s.gap = Vector2(3, 3)
			"mapedit-packs":
				s.kind = COLUMN
				s.gap = Vector2(0, 3)
			"mapedit-swatch":
				s.swatch = Color.from_string(st.get_slice("background:", 1).get_slice(";", 0).strip_edges(), dim)
			"mapedit-tick":
				s.kind = ROW
				s.gap = Vector2(6, 0)
			"mapedit-key":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.color = dim
				s.size = 12.0
				s.mt = 6.0
			"mapedit-field":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.color = dim
				s.size = 12.0
			"mapedit-hint":
				s.color = dim
				s.size = 13.0
			"mapedit-note":
				s.color = ink
			"mapedit-problems":
				s.kind = COLUMN
				s.gap = Vector2(0, 5)
				s.color = WARN
			"mapedit-where":
				s.color = dim
				s.pad = [0.0, 5.0, 0.0, 0.0]
				s.border = rule
				s.sides = 1
				s.least_high = 26.0
			"mapedit-pack":
				# A piece of the packs chosen lately: its picture, small, and its name.
				s.kind = ROW
				s.gap = Vector2(6, 0)
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.size = 12.0
				s.border = ink if d.has("pressed") else rule
				s.bg = Color(ink, 0.22) if d.has("pressed") else ground
				s.color = bright if d.has("pressed") else ink
				s.soft = true
				s.tone = bright
			"pieces-thumb":
				s.shot = 30.0
			# The packs' pieces: every picture of the two bought packs, to tick on the ship or off, or to choose one from.
			"pieces":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [14.0, 10.0, 14.0, 10.0]
				s.size = 14.0
				s.tool = true
			"pieces-head":
				s.kind = ROW
				s.gap = Vector2(14, 6)
				s.pad = [0.0, 0.0, 0.0, 8.0]
				s.border = rule
				s.sides = 4
			"pieces-total":
				s.color = bright
			"pieces-row", "pieces-belongs":
				s.kind = ROW
				s.gap = Vector2(4, 4)
			"pieces-end":
				s.push = true
			"pieces-says":
				s.color = WARN if _has(d, "bad") else (ink if _has(d, "ok") else dim)
				s.least_high = 21.0
			"pieces-body":
				s.kind = SPLIT
				s.split = "pieces"
			"pieces-places":
				# Down the left where there's the width, and along the top where there isn't.
				s.kind = COLUMN if _wide >= 944.0 else ROW
				s.gap = Vector2(4, 3)
				s.apart = true
				s.size = 13.0
				s.pane = Color(0, 0, 0, 0)
				s.edged = false
			"pieces-n":
				s.color = dim
				s.size = 12.0
				s.apart_before = true
			"pieces-grid":
				s.kind = COLUMN
				s.gap = Vector2(0, 16)
				s.pane = Color(0, 0, 0, 0)
				s.edged = false
			"pieces-section":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
			"pieces-section-head", "pieces-open-head":
				s.kind = ROW
				s.gap = Vector2(12, 4)
				if cls == "pieces-section-head":
					s.pad = [0.0, 0.0, 0.0, 5.0]
					s.border = rule
					s.sides = 4
			"pieces-tally", "pieces-empty", "pieces-label":
				s.color = dim
			"pieces-cards", "pieces-all":
				s.kind = ROW
				s.gap = Vector2(8, 8)
				s.top = true
			"pieces-card":
				s.kind = COLUMN
				s.least_wide = 148.0
				s.most_wide = 148.0
				s.corner = true
				s.faded = _has(d, "off")
			"pieces-pick":
				# A piece's card: its picture, whether it's on the ship, its name and what it is.
				s.pad = [4.0, 4.0, 4.0, 4.0]
				s.gap = Vector2(0, 3)
				s.size = 12.0
				s.line = 1.3
				s.faded = from.get("faded", false)
				s.border = rule if s.faded else ink
				s.dotted = s.faded
				s.bg = ground if s.faded else Color(board, 1.0)
				s.color = dim if s.faded else bright
				s.soft = true
				s.tone = bright
			"pieces-tick":
				s.then_space = true
			"pieces-count":
				s.color = dim
				s.size = 11.0
				s.new_line = true
			"pieces-none", "pieces-from":
				s.color = dim
				s.size = 12.0
			"pieces-size":
				s.color = bright
				s.size = 12.0
			"pieces-open":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [0.0, 8.0, 0.0, 0.0]
				s.border = ink
				s.sides = 1
			# What each colour of box is.
			"l-lead":
				s.color = bright
			"l-beat":
				s.color = ink
			"l-route":
				s.color = LORE
			"l-ending":
				s.color = WARN
			"l-fact":
				s.color = INFO
			"l-consequence":
				s.color = BELIEF
			"l-next":
				s.color = Color("d9d6cb")
			"fact-name":
				s.color = INFO
			"danger":
				s.color = BAD
			# The quest log.
			"qt":
				s.kind = COLUMN
				s.size = 13.0
			"qt-head":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(12, 0)
				s.pad = [10.0, 2.0, 10.0, 2.0]
				s.bg = ink
				s.color = ground
				s.keep = true
				s.bold = true
				s.upper = true
			"qt-close":
				s.color = ground
				s.upper = false
			"qt-left", "qt-right":
				s.kind = COLUMN
				s.pad = [10.0, 8.0, 10.0, 8.0]
				s.gap = Vector2(0, 8)
				if cls == "qt-right":
					s.border = rule
					s.sides = 1
			"qt-left-inner", "qt-story", "qt-steps", "qt-list":
				s.kind = COLUMN
				s.gap = Vector2(0, 2 if cls == "qt-list" else 4)
			"qt-box":
				s.color = dim
				s.then_space = true
			"qt-what":
				s.color = bright
				s.then_space = true
			"qt-where", "qt-none", "qt-item-step", "qt-key":
				s.color = dim
				s.size = 12.0
			"qt-about", "qt-entry", "qt-passage":
				s.color = Color("d9d6cb")
			"qt-said":
				s.color = bright
			"qt-ending", "qt-message":
				s.color = WARN
			"qt-chip":
				s.color = ground
				s.lit = ink
			"qt-group":
				s.color = dim
				s.size = 11.0
				s.upper = true
				s.mt = 6.0
				s.border = rule
				s.sides = 4
				s.dotted = true
			"qt-item":
				s.kind = ROW
				s.gap = Vector2(10, 0)
				s.between = true
				s.pad = [4.0, 2.0, 4.0, 2.0]
				s.prefix = ""
				s.suffix = ""
				s.group = false
				if _has(d, "picked"):
					s.bg = Color(ink, 0.14)
					s.border = bright
					s.sides = 8
			"qt-item-name":
				s.color = bright
			"qt-tag":
				s.color = dim
				s.size = 11.0
			# The making of a captain.
			"creator":
				s.kind = COLUMN
			"creator-head":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(12, 4)
				s.pad = [16.0, 6.0, 16.0, 6.0]
				s.border = rule
				s.sides = 4
			"stepbar":
				s.kind = ROW
				s.gap = Vector2(10, 0)
				s.pad = [16.0, 4.0, 16.0, 4.0]
				s.size = 13.0
				s.border = rule
				s.sides = 4
			"step":
				s.prefix = ""
				s.suffix = ""
				s.upper = true
				s.color = WARN if _has(d, "warn") else (dim if _has(d, "todo") else ink)
				if _has(d, "current"):
					s.lit = ink
			"creator-body":
				s.kind = GRID if _wide >= 900.0 else COLUMN
				s.cols = [["fr", 1], ["ch", 36]]
			"creator-main":
				s.kind = COLUMN
				s.pad = [16.0, 16.0, 16.0, 16.0]
			"creator-content", "creator-foot-inner":
				s.kind = COLUMN
				s.gap = Vector2(0, 10 if cls == "creator-content" else 4)
				s.most_wide = 760.0
			"creator-sheet":
				s.kind = COLUMN
				s.gap = Vector2(0, 4)
				s.pad = [12.0, 12.0, 12.0, 12.0]
				s.size = 13.0
				s.border = rule
				s.sides = 8
				s.bg = board
			"creator-foot":
				s.pad = [16.0, 6.0, 16.0, 8.0]
				s.border = rule
				s.sides = 1
				s.bg = board
			"step-title":
				s.size = 20.0
				s.color = bright
				s.upper = true
			"group":
				s.kind = COLUMN
				s.gap = Vector2(0, 8)
				s.mb = 8.0
			"field-label":
				s.color = bright
				s.bold = true
			"sheet-heading":
				s.color = dim
				s.upper = true
				s.size = 12.0
				s.mt = 8.0
			"attr-row", "gear-row", "skill-row":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(12, 2)
			"attr-controls", "skill-controls":
				s.kind = ROW
				s.gap = Vector2(6, 0)
			"num":
				s.color = dim
			"attr-value":
				s.color = bright
				s.bold = true
			"bio":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [14.0, 0.0, 0.0, 0.0]
			"review-grid":
				s.kind = FIT
				s.least = 34.0
				s.gap = Vector2(20, 10)
			# A page of the ship's log: the one a game ends on.
			"ship-log":
				s.kind = COLUMN
				s.size = 13.0
			"ship-log-bar":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(12, 0)
				s.pad = [10.0, 2.0, 10.0, 2.0]
				s.bg = ink
				s.color = ground
				s.keep = true
				s.size = 12.0
			"ship-log-when":
				s.bold = true
			"ship-log-head":
				s.pad = [14.0, 12.0, 14.0, 4.0]
			"ship-log-title":
				s.size = 16.0
				s.color = bright
			"ship-log-under":
				s.color = dim
				s.size = 12.0
			"ship-log-words":
				s.kind = COLUMN
				s.gap = Vector2(0, 6)
				s.pad = [14.0, 6.0, 14.0, 6.0]
				s.color = Color("d9d6cb")
				s.size = 14.0
			"ending-line":
				s.color = bright
			"ending-last":
				s.kind = COLUMN
				s.gap = Vector2(0, 2)
				s.mt = 8.0
				s.color = dim
				s.size = 12.0
			"ending-last-title":
				s.upper = true
				s.size = 11.0
			"ending-error":
				s.color = BAD
				s.pad = [14.0, 2.0, 14.0, 2.0]
			"ship-log-ask":
				s.pad = [14.0, 6.0, 14.0, 0.0]
				s.color = dim
				s.size = 12.0
			"ship-log-foot":
				s.kind = ROW
				s.between = true
				s.gap = Vector2(10, 2)
				s.pad = [12.0, 4.0, 12.0, 6.0]
				s.size = 11.0
				s.color = dim
				s.border = rule
				s.sides = 1
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
	# A choice in a list of them, as the page writes it: a button straight inside "options".
	if tag == "button" and from.get("listed", false) and not _has(d, "option"):
		s.kind = ROW
		s.gap = Vector2(8, 0)
		s.pad = [4.0, 2.0, 4.0, 2.0]
		s.size = 14.0
		s.prefix = ""
		s.suffix = ""
		s.group = false
	s.listed = _has(d, "options")
	if s.kind == GRID and not s.has("cols"):
		for cls in classes:
			if GRIDS.has(cls):
				s.cols = GRIDS[cls]
		# On a narrow page the work board's rows are one thing under another (style.css, at 900 wide and less).
		if _wide < 620.0 and (_has(d, "work-row") or _has(d, "work-job") or _has(d, "map-row")):
			s.kind = COLUMN
			s.gap = Vector2(0, 2)
	return s


## A window taller than what's in it: the part of it that's there to take up the room does (its body, and the pane
## inside that), and what's under that part moves down.
func _stretch(b: Box, more: float) -> void:
	if more <= 0.0 or b.kind == RUN:
		return
	b.size.y += more
	for i in b.kids.size():
		var kid: Box = b.kids[i]
		if kid.kind != RUN and not kid.off and kid.s.get("grow", false):
			_stretch(kid, more)
			for after in range(i + 1, b.kids.size()):
				b.kids[after].at.y += more
			return


## How far to the front something on a desktop is.
func _front(b: Box) -> float:
	if b.kind == RUN:
		return 0.0
	if _has(b.d, "win"):
		return _px(str(b.d.get("st", "")), "z-index", 10.0)
	return 800.0 if _has(b.d, "taskbar") else (900.0 if _has(b.d, "menu") else (850.0 if _has(b.d, "balloon") else float(b.at.y) / 1000.0))


## A length in pixels out of an element's own style ("left:250px;top:30px").
func _px(st: String, name: String, otherwise: float) -> float:
	for part in st.split(";"):
		if part.strip_edges().begins_with(name + ":"):
			return float(part.get_slice(":", 1).replace("px", ""))
	return otherwise


func _var(st: String, name: String, otherwise: float) -> float:
	if not st.contains(name + ":"):
		return otherwise
	return float(st.get_slice(name + ":", 1).get_slice(";", 0))


## Whether something sits in a line of words (a word, a tag, a plain button) or is a box of its own.
func _in_line(k: Variant, on_desk := false) -> bool:
	if typeof(k) != TYPE_DICTIONARY:
		return true
	var d: Dictionary = k
	if not INLINE.has(str(d.get("t", "div"))):
		return false
	if on_desk and str(d.t) == "button":
		return false
	for cls in str(d.get("c", "")).split(" ", false):
		if cls in ["row", "spread", "stack", "card", "menu-row", "post-card", "post-duty", "watch-people", "rig-socket", "rig-frame", "option", "here-row", "here-part", "here-tag", "rig-pocket", "qt-item"]:
			return false
	for child in d.get("k", []):
		if not _in_line(child, on_desk):
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
		CANVAS:
			# The one the game listens on for the pointer.
			if not b.off and (d.get("on", []) as Array).has("pointerdown"):
				_canvas = b
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
				if _in_line(k, s.os or s.pocket):
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
				if _in_line(k, s.os or s.pocket):
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
	if s.get("apart_before", false):
		state.space = true
	# What starts a line of its own (what a piece is, under its name).
	var begun := out.size()
	if s.get("new_line", false):
		state.space = false
	if s.has("swatch"):
		# A little square of a colour, before the name of what's painted in it.
		out.append({"t": "", "w": 10.0, "sz": s.size, "col": s.swatch, "b": false, "sp": state.space, "gap": 0.0, "id": mine.id, "dis": mine.dis, "tip": mine.tip, "g": mine.g, "lit": mine.lit, "sq": [10.0, 14.0, "swatch", false]})
		state.space = true
		return
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
	var in_button: bool = str(d.get("t", "")) == "button" and not s.pre
	for child in d.get("k", []):
		# The parts of a button (its number, its words, what it costs) stand apart, as the page spaces them.
		if in_button and typeof(child) == TYPE_DICTIONARY and not out.is_empty():
			state.space = true
		_words(child, s, out, mine, state)
	if after != "":
		_text(after, s, out, mine, state, true)
	if s.get("then_space", false):
		state.space = true
	if s.get("new_line", false) and out.size() > begun:
		out[begun]["nl"] = true


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
	# Words whose own line ends are kept, and wrapped like any others between them.
	if s.get("lines", false) and text.contains("\n"):
		var opening := true
		for piece in text.split("\n", false):
			if piece.strip_edges() == "":
				continue
			var first_of := out.size()
			_text(piece, s, out, on, state)
			if not opening and out.size() > first_of:
				out[first_of]["nl"] = true
			opening = false
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
		# A name made of words joined by underscores can go on to the next line after any of them.
		var bits := PackedStringArray([word])
		if s.get("anywhere", false) and word.contains("_"):
			bits = PackedStringArray()
			for bit in word.split("_"):
				bits.append(bit + "_")
			bits[-1] = bits[-1].trim_suffix("_")
			if bits[-1] == "":
				bits.remove_at(bits.size() - 1)
		for n in bits.size():
			out.append({"t": bits[n], "w": font.get_string_size(bits[n], HORIZONTAL_ALIGNMENT_LEFT, -1, int(s.size)).x, "sz": s.size, "col": color, "b": s.bold, "sp": state.space and n == 0, "id": on.id, "dis": on.dis, "tip": on.tip, "g": on.g, "lit": on.lit, "over": on.over})
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
			wide = _field_size(b.d, 320.0).x
		CANVAS:
			wide = s.get("shot", 138.0) if b.d.has("pic") else _px(str(b.d.get("st", "")), "width", 300.0)
		PIC:
			wide = s.pic
		PLAN:
			wide = _px(str(b.d.get("st", "")), "width", 440.0)
		SPLIT:
			wide = 600.0
		DESK:
			wide = 640.0
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
	if s.has("most_wide") and b.kind != RUN:
		b.natural = minf(b.natural, s.most_wide)
	return b.natural


func _layout(b: Box, wide: float) -> void:
	var s := b.s
	if b.kind == RUN:
		_layout_run(b, wide)
		return
	if s.has("most_wide"):
		wide = minf(wide, s.most_wide)
	# A box only as wide as what's in it (a desktop's buttons).
	if s.get("shrink", false):
		wide = minf(wide, maxf(_natural(b), s.get("least_wide", 0.0)))
	var pad: Array = s.get("pad", [0.0, 0.0, 0.0, 0.0])
	var inner := maxf(10.0, wide - pad[0] - pad[2])
	var high := 0.0
	match b.kind:
		PRE:
			high = b.lines.size() * roundf(s.size * s.line)
			inner = maxf(inner, 0.0)
		FIELD:
			var field := _field_size(b.d, wide)
			wide = field.x
			high = field.y
		CANVAS:
			if b.d.has("pic"):
				# A picture out of the packs, in a square.
				wide = s.get("shot", 138.0)
				high = wide
			else:
				wide = _px(str(b.d.get("st", "")), "width", 300.0)
				high = _px(str(b.d.get("st", "")), "height", 150.0)
		SPLIT:
			# The sheet and what's picked from it: side by side where there's the width for both, else one over the
			# other. Each is laid out at its own size and shown through a window, behind which it's moved about.
			_split = b
			high = _split_high
			var beside := inner >= 900.0
			if s.get("split", "") == "pieces":
				# The packs' pieces: the places of the ship down the left, or along the top in as many rows as they
				# take (a third of the room at most), and the pieces of the one picked.
				_sheet = -1
				var along := 0.0
				if not beside and not b.kids.is_empty() and b.kids[0].kind != RUN:
					_layout(b.kids[0], inner)
					along = minf(b.kids[0].size.y, roundf(high * 0.34))
				_views.assign([Rect2(0, 0, 262, high), Rect2(274, 0, inner - 274.0, high)] if beside else [Rect2(0, 0, inner, along), Rect2(0, along + 8.0, inner, high - along - 8.0)])
			elif s.get("split", "") == "tools":
				# The Map editor: its tools down the left, the deck, and what's chosen down the right; with less room,
				# the deck over the other two.
				var upper := roundf(high * 0.5)
				var half := floorf(inner / 2.0)
				_sheet = 1
				_views.assign([Rect2(0, 0, 196, high), Rect2(206, 0, inner - 486.0, high), Rect2(inner - 270.0, 0, 270, high)] if beside else [Rect2(0, upper + 8.0, half - 5.0, high - upper - 8.0), Rect2(0, 0, inner, upper), Rect2(half + 5.0, upper + 8.0, inner - half - 5.0, high - upper - 8.0)])
			else:
				var side_wide := clampf(roundf(inner * 0.3), 280.0, 360.0) if beside else inner
				var upper := roundf(high * 0.54)
				_sheet = 0
				_views.assign([Rect2(0, 0, inner - side_wide - 10.0, high) if beside else Rect2(0, 0, inner, upper), Rect2(inner - side_wide, 0, side_wide, high) if beside else Rect2(0, upper + 8.0, inner, high - upper - 8.0)])
			for i in mini(_views.size(), b.kids.size()):
				var kid: Box = b.kids[i]
				if kid.kind == RUN:
					continue
				_layout(kid, maxf(_views[i].size.x, _natural(kid)) if i == _sheet else _views[i].size.x)
			# Where the game has moved the sheet to itself (to show where something's wrong), once each time it does.
			var moved: Variant = _moved_to(b)
			if moved != null and int(moved[2]) != _moved_seen:
				_moved_seen = int(moved[2])
				_pans[_sheet] = Vector2(float(moved[0]), float(moved[1]))
			_settle_views()
		PLAN:
			var plan := str(b.d.get("st", ""))
			wide = _px(plan, "width", 440.0)
			high = _px(plan, "height", 300.0)
			for kid in b.kids:
				if kid.off or kid.kind == RUN:
					continue
				var st := str(kid.d.get("st", ""))
				if _has(kid.d, "board-node"):
					_layout(kid, kid.s.get("most_wide", 230.0))
					kid.at = Vector2(_px(st, "left", 0.0), _px(st, "top", 0.0))
					wide = maxf(wide, kid.at.x + kid.size.x + 20.0)
					high = maxf(high, kid.at.y + kid.size.y + 20.0)
				elif kid.kind == PIC:
					kid.size = Vector2(wide, high)
					kid.at = Vector2.ZERO
				elif _has(kid.d, "net-band"):
					_layout(kid, wide)
					kid.size = Vector2(wide, _px(st, "height", 40.0))
					kid.at = Vector2(0, _px(st, "top", 0.0))
				else:
					# A system's box (or the words on an arrow), with its middle where the page's layout has it.
					_layout(kid, kid.s.get("most_wide", 104.0))
					kid.at = Vector2(_px(st, "left", 0.0) - kid.size.x / 2.0, _px(st, "top", 0.0) - kid.size.y / 2.0)
		PIC:
			wide = s.pic
			high = s.pic
		DESK:
			wide = 640.0
			high = 480.0
			var flow := 0.0
			for kid in b.kids:
				if kid.off or kid.kind == RUN:
					continue
				var st := str(kid.d.get("st", ""))
				if _has(kid.d, "win"):
					_layout(kid, _px(st, "width", 380.0))
					_stretch(kid, _px(st, "height", 0.0) - kid.size.y)
					kid.at = Vector2(_px(st, "left", 40.0), _px(st, "top", 30.0))
				elif _has(kid.d, "taskbar"):
					_layout(kid, 640.0)
					kid.size.y = maxf(kid.size.y, 28.0)
					kid.at = Vector2(0, 480.0 - kid.size.y)
				elif _has(kid.d, "menu"):
					_layout(kid, 200.0)
					kid.at = Vector2(2, 480.0 - 28.0 - kid.size.y)
				elif _has(kid.d, "balloon"):
					_layout(kid, 250.0)
					kid.at = Vector2(640.0 - 258.0, 480.0 - 34.0 - kid.size.y)
				elif _has(kid.d, "icons"):
					_layout(kid, 80.0)
					kid.at = Vector2(6, flow + 6.0)
				else:
					_layout(kid, 640.0)
					kid.at = Vector2(0, flow)
					flow += kid.size.y
			# What's in front is drawn last: the windows in their own order, then the taskbar, its menu and a balloon.
			b.kids.sort_custom(func(one: Box, other: Box) -> bool: return _front(one) < _front(other))
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
			# A card's last thing sits in its top right corner, over the rest (the [ + ] on a piece's card).
			var cornered: Box = b.kids[-1] if s.get("corner", false) and b.kids.size() > 1 else null
			for kid in b.kids:
				if kid.off:
					continue
				_layout(kid, inner)
				if kid == cornered:
					kid.at = Vector2(pad[0] + inner - kid.size.x - 6.0, pad[1] + 6.0)
					continue
				var above: float = kid.s.get("mt", 0.0) if kid.kind != RUN else 0.0
				if not first:
					y += s.gap.y
				y += above
				kid.at = Vector2(pad[0], pad[1] + y)
				y += kid.size.y + (kid.s.get("mb", 0.0) if kid.kind != RUN else 0.0)
				first = false
				if s.get("middle", false):
					kid.at.x = pad[0] + (inner - kid.size.x) / 2.0
			high = y
	if b.kind in [ROW, GRID, FIT, CARDS, BOARD]:
		for kid in b.kids:
			kid.at += Vector2(pad[0], pad[1])
	if b.kind in [PIC, DESK, PLAN, SPLIT, CANVAS]:
		b.size = Vector2(wide, high)
		return
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
	# Where each line starts, for a run that's cut off after so many of them.
	var tops: Array[float] = [0.0]
	var count := words.size()
	if count > 0 and words[count - 1].get("more", false):
		count -= 1
	while i < count:
		var w: Dictionary = words[i]
		# A button's or a tag's words stay on one line when they fit on one; one too long for a line wraps like any words.
		var need: float = w.w
		var last := i
		if w.g >= 0 and not loose.has(w.g):
			while last + 1 < count and words[last + 1].g == w.g and not words[last + 1].get("nl", false):
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
			tops.append(y)
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
	# No more than so many lines of it, with a mark that there's more.
	var most_lines := int(b.s.get("most_lines", 0))
	if most_lines > 0 and tops.size() > most_lines:
		var cut := tops[most_lines]
		b.placed = b.placed.filter(func(place: Array) -> bool: return place[2] < cut - 0.5)
		b.size.y = cut
		if not b.placed.is_empty():
			var end: Array = b.placed[-1]
			var ended: Dictionary = words[end[0]]
			if count == words.size():
				var more := ended.duplicate()
				more.merge({"t": "…", "w": _char(ended.sz), "sp": false, "nl": false, "more": true, "id": -1}, true)
				words.append(more)
			b.placed.append([words.size() - 1, minf(end[1] + ended.w + 2.0, wide - _char(ended.sz)), end[2], end[3], 0.0])


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
			if (kid.push or (kid.kind != RUN and kid.s.get("push", false))) and rows.size() == 1:
				at = maxf(at, inner - (kid.size.x if kid.kind == RUN else item[1]))
			kid.at = Vector2(at, y + (0.0 if s.get("top", false) else (high - kid.size.y) / 2.0))
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
	_pen = self
	if root != null:
		_paint(root, Vector2.ZERO, false)


## One of the page's windows drawing its part of the page, where that part has been moved to behind it.
func _paint_in(pane: Control, b: Box) -> void:
	_pen = pane
	_paint(b, _split_at - pane.position, false)
	_pen = self


func _paint(b: Box, at: Vector2, turned: bool) -> void:
	if b.off:
		return
	var s := b.s
	var here := at + b.at
	if b.kind == RUN:
		_paint_run(b, here, turned)
		return
	var box := Rect2(here, b.size)
	var soft: bool = b.id >= 0 and b.id == hover and s.get("soft", false)
	if soft:
		# A box that only lights up a little under the pointer, with what's in it as it was.
		_pen.draw_rect(box, s.bg)
		_pen.draw_rect(box, Color(s.tone, 0.1))
	elif b.id >= 0 and b.id == hover:
		turned = true
		_pen.draw_rect(box, s.get("hot", ink))
	elif s.has("bg") and s.bg != null:
		_pen.draw_rect(box, s.bg)
	if int(s.get("bevel", 0)) != 0 and not turned:
		# A raised or a sunk edge: light from the top left.
		var up: bool = int(s.bevel) > 0
		var a := box.position.floor() + Vector2(0.5, 0.5)
		var z := box.end.floor() - Vector2(0.5, 0.5)
		_pen.draw_polyline(PackedVector2Array([Vector2(a.x, z.y), a, Vector2(z.x, a.y)]), KEEL.hi if up else KEEL.lo, 1.0)
		_pen.draw_polyline(PackedVector2Array([Vector2(a.x, z.y), z, Vector2(z.x, a.y)]), KEEL.dark if up else KEEL.hi, 1.0)
	# What's in the page's two windows is drawn by them.
	if b.kind == SPLIT and _pen == self:
		return
	if b.kind == CANVAS:
		if b.d.has("pic"):
			_paint_shot(b, here)
		else:
			_paint_shapes(b.d.get("cv", []), here)
		return
	if b.kind == PIC:
		var shapes: Dictionary = b.d.get("svg", {})
		var scale := b.size.x / float(shapes.w) if float(shapes.get("w", 0)) > 0.0 else 1.0
		for r in shapes.get("rects", []):
			_pen.draw_rect(Rect2(here + Vector2(float(r[0]), float(r[1])) * scale, Vector2(float(r[2]), float(r[3])) * scale), Color.from_string(str(r[4]), Color.BLACK))
		# The Story board's arrows: plain, dashed where one has a condition, dotted for a timer, bright when lit.
		for path in shapes.get("paths", []):
			var kind := str(path[0])
			var points := PackedVector2Array()
			for n in range(1, path.size() - 1, 2):
				points.append(here + Vector2(float(path[n]), float(path[n + 1])))
			if points.size() < 2:
				continue
			var tone := bright if kind.contains("lit") else (BELIEF if kind.contains("timer") else (dim if kind.contains("cond") else rule.lightened(0.3)))
			var thick := 2.5 if kind.contains("lit") else 1.5
			if kind.contains("timer"):
				_dashes(points, tone, thick, 2.0, 4.0)
			elif kind.contains("cond"):
				_dashes(points, tone, thick, 5.0, 4.0)
			else:
				_pen.draw_polyline(points, tone, thick, true)
			var way := (points[-1] - points[-2]).normalized()
			_pen.draw_colored_polygon(PackedVector2Array([points[-1], points[-1] - way * 9.0 + way.orthogonal() * 4.0, points[-1] - way * 9.0 - way.orthogonal() * 4.0]), tone)
		# A network's wires: the data network solid, the maintenance bus dashed, the ones from here brighter.
		for l in shapes.get("lines", []):
			var kind := str(l[4])
			var near := kind.contains("net-near")
			var from := here + Vector2(float(l[0]), float(l[1])) * scale
			var to := here + Vector2(float(l[2]), float(l[3])) * scale
			if kind.contains("net-bus"):
				_pen.draw_dashed_line(from, to, Color("8ff0a8", 1.0 if near else 0.4), 2.0 if near else 1.5, 4.0)
			else:
				_pen.draw_line(from, to, Color("4fc46e", 1.0 if near else 0.45), 2.0 if near else 1.5)
		return
	if s.has("border") and not turned:
		var sides: int = s.get("sides", 15)
		var edges := [[1, box.position, Vector2(box.end.x, box.position.y)], [2, Vector2(box.end.x, box.position.y), box.end], [4, Vector2(box.position.x, box.end.y), box.end], [8, box.position, Vector2(box.position.x, box.end.y)]]
		for edge in edges:
			if sides & int(edge[0]):
				var from: Vector2 = (edge[1] as Vector2).floor() + Vector2(0.5, 0.5)
				var to: Vector2 = (edge[2] as Vector2).floor() + Vector2(0.5, 0.5)
				if s.get("dotted", false):
					_pen.draw_dashed_line(from, to, s.tone if soft else s.border, 1.0, 2.0)
				else:
					_pen.draw_line(from, to, s.tone if soft else s.border, 1.0)
	if b.kind == PRE:
		var high := roundf(s.size * s.line * 4.0) / 4.0 if s.chart > 0.0 else roundf(s.size * s.line)
		if s.chart > 0.0:
			high = roundf(s.size * 1.25 * 4.0) / 4.0
		var rise := Pal.MONO.get_ascent(int(s.size))
		var fall := Pal.MONO.get_descent(int(s.size))
		for i in b.lines.size():
			if b.lines[i].strip_edges() != "":
				_pen.draw_string(Pal.MONO, here + Vector2(0, i * high + (high + rise - fall) / 2.0), b.lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, int(s.size), flip if turned else s.color)
		return
	for kid in b.kids:
		_paint(kid, here, turned)


## A picture the game drew a shape at a time (src/mini-dom.js keeps the shapes): filled and outlined rectangles, words,
## shapes of a few corners and discs.
func _paint_shapes(shapes: Array, here: Vector2) -> void:
	for shape in shapes:
		match str(shape[0]):
			"r":
				_pen.draw_rect(Rect2(here.x + float(shape[1]), here.y + float(shape[2]), float(shape[3]), float(shape[4])), _tone(shape[5]))
			"o":
				var box := Rect2(here.x + float(shape[1]), here.y + float(shape[2]), float(shape[3]), float(shape[4]))
				if float(shape[7]) > 0.0:
					var corners := [box.position, Vector2(box.end.x, box.position.y), box.end, Vector2(box.position.x, box.end.y), box.position]
					for n in 4:
						_pen.draw_dashed_line(corners[n], corners[n + 1], _tone(shape[5]), float(shape[6]), float(shape[7]))
				else:
					_pen.draw_rect(box, _tone(shape[5]), false, float(shape[6]))
			"t":
				var font: Font = Pal.MONO_BOLD if int(shape[6]) == 1 else Pal.MONO
				var size := int(shape[5])
				var wide := font.get_string_size(str(shape[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
				var x := float(shape[2]) - (wide / 2.0 if str(shape[7]) == "center" else (wide if str(shape[7]) == "right" else 0.0))
				var y := float(shape[3]) + (font.get_ascent(size) if str(shape[8]) == "top" else ((font.get_ascent(size) - font.get_descent(size)) / 2.0 if str(shape[8]) == "middle" else 0.0))
				_pen.draw_string(font, here + Vector2(x, y), str(shape[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, size, _tone(shape[4]))
			"p":
				var points := PackedVector2Array()
				for n in range(2, shape.size() - 1, 2):
					points.append(here + Vector2(float(shape[n]), float(shape[n + 1])))
				_pen.draw_colored_polygon(points, _tone(shape[1]))
			"c":
				_pen.draw_circle(here + Vector2(float(shape[1]), float(shape[2])), float(shape[3]), _tone(shape[4]))


## A picture out of the bought packs in its square, on a mid grey so dark steel and white enamel both show: whole
## pixels when there's room to make it bigger (three times at most), shrunk to fit when there isn't. The pictures are
## read from the game's own folder as they're wanted, and nothing of them is kept on the disk.
func _paint_shot(b: Box, here: Vector2) -> void:
	_pen.draw_rect(Rect2(here, b.size), Color("4b545d"))
	var shot := _shot(b.d.pic, b.size)
	if shot == null:
		# Not on this computer.
		_pen.draw_rect(Rect2(here, b.size), Color("2c3035"))
		for n in range(-int(b.size.y), int(b.size.x), 12):
			_pen.draw_line(here + Vector2(maxf(n, 0.0), maxf(-n, 0.0)), here + Vector2(minf(n + b.size.y, b.size.x), minf(b.size.x - n, b.size.y)), Color("3a3f44"), 4.0)
		return
	_pen.draw_texture(shot, here + ((b.size - shot.get_size()) / 2.0).round(), Color(1, 1, 1, 0.4 if b.s.get("faded", false) else 1.0))


func _shot(pic: Array, room: Vector2) -> Texture2D:
	var key := "%s|%s" % [pic, room]
	if shots.has(key):
		return shots[key]
	var file := str(pic[0])
	if not sheets.has(file):
		var path := packs_dir.path_join(file)
		var read: Image = Image.load_from_file(path) if packs_dir != "" and FileAccess.file_exists(path) else null
		if read != null and read.get_format() != Image.FORMAT_RGBA8:
			read.convert(Image.FORMAT_RGBA8)
		sheets[file] = read
	var sheet: Image = sheets[file]
	var made: Texture2D = null
	if sheet != null:
		var cell := Rect2i(int(pic[1]), int(pic[2]), int(pic[3]), int(pic[4])) if pic.size() >= 5 else Rect2i(Vector2i.ZERO, sheet.get_size())
		var part := sheet.get_region(cell)
		# Only the part of it with anything in it: the packs leave room round what they draw.
		var used := part.get_used_rect()
		if used.size.x > 0 and used.size.y > 0:
			part = part.get_region(used)
		var fit := minf((room.x - 8.0) / part.get_width(), (room.y - 8.0) / part.get_height())
		var scale := minf(floorf(fit), 3.0) if fit >= 1.0 else fit
		part.resize(maxi(1, roundi(part.get_width() * scale)), maxi(1, roundi(part.get_height() * scale)), Image.INTERPOLATE_NEAREST if scale >= 1.0 else Image.INTERPOLATE_BILINEAR)
		made = ImageTexture.create_from_image(part)
	shots[key] = made
	return made


func _tone(written: Variant) -> Color:
	if not _tones.has(written):
		_tones[written] = Color.html(str(written))
	return _tones[written]


## A line through some points, in dashes that carry on round its corners.
func _dashes(points: PackedVector2Array, tone: Color, wide: float, dash: float, gap: float) -> void:
	var left := dash
	var inked := true
	for i in range(1, points.size()):
		var from := points[i - 1]
		var to := points[i]
		var span := from.distance_to(to)
		var done := 0.0
		while span - done > 0.01:
			var step := minf(left, span - done)
			if inked:
				_pen.draw_line(from.lerp(to, done / span), from.lerp(to, (done + step) / span), tone, wide)
			done += step
			left -= step
			if left <= 0.01:
				inked = not inked
				left = dash if inked else gap


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
			color = flip
		elif lit != null:
			_pen.draw_rect(Rect2(at.x - place[4] if _joined(b, place) else at.x, at.y, w.w + (place[4] if _joined(b, place) else 0.0), high).grow_individual(1 if not _joined(b, place) else 0, 0, 1, 0), lit)
			color = ground
		elif w.get("over") != null:
			_pen.draw_rect(Rect2(at.x, at.y, w.w + 2.0, high), w.over)
		if w.has("sq"):
			var q: Array = w.sq
			var box := Rect2(at.x, at.y + (high - q[1]) / 2.0, q[0], q[1])
			if q[2] == "swatch":
				_pen.draw_rect(box, w.col)
				_pen.draw_rect(box.grow(-0.5), Color(1, 1, 1, 0.35), false, 1.0)
			elif q[2] == "dot":
				_pen.draw_circle(box.get_center(), 3.0, color)
			elif q[3]:
				# The work board's squares: what a store has, what it has over what it wants, and what it wants and hasn't.
				match q[2]:
					"on":
						_pen.draw_rect(box, bright)
					"over":
						_pen.draw_rect(box, dim)
					"want":
						_pen.draw_rect(box.grow(-0.5), dim, false, 1.0)
			elif q[2] == "on":
				_pen.draw_rect(box, ink)
			else:
				_pen.draw_rect(box.grow(-0.5), rule, false, 1.0)
			continue
		if w.t == "":
			continue
		var font: Font = Pal.MONO_BOLD if w.b else Pal.MONO
		var size := int(w.sz)
		# A word too long for the room its run was given is cut off where the room ends.
		var room := -1.0 if not b.s.has("most_lines") and not b.s.get("anywhere", false) else maxf(1.0, b.size.x - place[1])
		_pen.draw_string(font, at + Vector2(0, (high + font.get_ascent(size) - font.get_descent(size)) / 2.0), w.t, HORIZONTAL_ALIGNMENT_LEFT, room if w.w > room and room > 0.0 else -1.0, size, color)


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
	if b.kind == SPLIT:
		# Only what shows through each window is under the pointer.
		for i in mini(_views.size(), b.kids.size()):
			if Rect2(here + _views[i].position, _views[i].size).has_point(point):
				return _under(b.kids[i], here, point)
		return [-1, ""]
	if b.kind == DESK:
		# On a desktop only what's in front at that point is under the pointer.
		for i in range(b.kids.size() - 1, -1, -1):
			var top: Box = b.kids[i]
			if not top.off and top.kind != RUN and Rect2(here + top.at, top.size).has_point(point):
				return _under(top, here, point)
		return found
	for kid in b.kids:
		var inside := _under(kid, here, point)
		if inside[0] >= 0:
			found[0] = inside[0]
		if inside[1] != "":
			found[1] = inside[1]
	return found


func _gui_input(event: InputEvent) -> void:
	if _canvas != null and _draw_on(event):
		accept_event()
		return
	if _split != null and _look_about(event):
		accept_event()
		return
	if event is InputEventMouseMotion:
		var now: int = _under(root, Vector2.ZERO, event.position)[0]
		if now != hover:
			hover = now
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hover >= 0 else Control.CURSOR_ARROW
			_again()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		var hit: int = _under(root, Vector2.ZERO, event.position)[0]
		if hit >= 0:
			accept_event()
			# What was being typed is sent first, and whatever is built next starts with nothing half typed in it.
			_send_typed()
			get_viewport().gui_release_focus()
			pressed.emit(hit)
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		var hit: int = _under(root, Vector2.ZERO, event.position)[0]
		if hit >= 0:
			accept_event()
			asked.emit(hit, get_global_mouse_position())


## The pointer on a picture the game draws and listens on (the Map editor's deck): the button going down on it, the
## pointer crossing it with the button held, and the button coming up are told to the game as they happen; with no
## button held, where the pointer has come to rest is told a moment after it stops.
func _draw_on(event: InputEvent) -> bool:
	if not (event is InputEventMouse):
		return false
	var corner := _where(root, _canvas, Vector2.ZERO)
	var over := corner.x > -9000.0 and Rect2(corner, _canvas.size).has_point(event.position) and _in_view(_canvas, event.position)
	var at: Vector2 = event.position - corner
	var id := int(_canvas.d.get("id", -1))
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed and over:
			_send_typed()
			get_viewport().gui_release_focus()
			_drawing = true
			_rest_left = -1.0
			pointed.emit(id, "down", at)
			return true
		if not event.pressed and _drawing:
			_drawing = false
			pointed.emit(id, "up", at)
			return true
		return false
	if event is InputEventMouseMotion:
		if _drawing:
			pointed.emit(id, "move", at)
			return true
		if over:
			mouse_default_cursor_shape = Control.CURSOR_CROSS
			_rest_at = at
			_rest_left = 0.12
			set_process(true)
			return not _panning
		if _rest_left > -1.0 or _rested:
			# Off the picture again.
			_rest_left = -1.0
			if _rested:
				_rested = false
				pointed.emit(id, "leave", at)
	return false


## Whether a point of the page shows through the window the box is in (true for a box that's in none).
func _in_view(b: Box, point: Vector2) -> bool:
	if _split == null:
		return true
	for i in mini(_views.size(), _split.kids.size()):
		if _split.kids[i] == b or _where(_split.kids[i], b, Vector2.ZERO).x > -9000.0:
			return Rect2(_split_at + _views[i].position, _views[i].size).has_point(point)
	return true


## Looking about in the page's windows: the wheel moves what's under the pointer up and down (and the sheet across,
## with Shift or a wheel that goes sideways), and the sheet is dragged by its dark background, or by anything with the
## middle button.
func _look_about(event: InputEvent) -> bool:
	var over := -1
	if event is InputEventMouse:
		for i in mini(_views.size(), _split.kids.size()):
			if Rect2(_split_at + _views[i].position, _views[i].size).has_point(event.position):
				over = i
	if event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT]:
		if over < 0:
			return false
		var step := -48.0 if event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_LEFT] else 48.0
		var across: bool = over == _sheet and (event.shift_pressed or event.button_index in [MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT])
		_pans[over] += Vector2(step, 0) if across else Vector2(0, step)
		_moved_views()
		return true
	if event is InputEventMouseButton and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_MIDDLE]:
		if not event.pressed:
			var was := _panning
			_panning = false
			mouse_default_cursor_shape = Control.CURSOR_ARROW
			return was and event.button_index == MOUSE_BUTTON_MIDDLE
		if over == _sheet and (event.button_index == MOUSE_BUTTON_MIDDLE or _under(root, Vector2.ZERO, event.position)[0] < 0):
			_panning = true
			mouse_default_cursor_shape = Control.CURSOR_DRAG
			return true
		return false
	if event is InputEventMouseMotion and _panning:
		_pans[_sheet] -= event.relative
		_moved_views()
		return true
	return false


func _moved_to(b: Box) -> Variant:
	if b.kind == RUN:
		return null
	if b.d.has("sc"):
		return b.d.sc
	for kid in b.kids:
		var found: Variant = _moved_to(kid)
		if found != null:
			return found
	return null


## The page's windows hold what they're moved to, within what there is to see: the sheet both ways, the others up
## and down.
func _settle_views() -> void:
	if _split == null:
		return
	for i in mini(_views.size(), _split.kids.size()):
		var kid: Box = _split.kids[i]
		_pans[i] = Vector2(clampf(_pans[i].x, 0.0, maxf(0.0, kid.size.x - _views[i].size.x)) if i == _sheet else 0.0, clampf(_pans[i].y, 0.0, maxf(0.0, kid.size.y - _views[i].size.y)))
		kid.at = _views[i].position - _pans[i]


func _moved_views() -> void:
	_settle_views()
	_place_fields()
	_again()


## Where the page's windows are, once it's laid out.
func _place_panes() -> void:
	var shown := root != null and _split != null
	if shown:
		_split_at = _where(root, _split, Vector2.ZERO)
		shown = _split_at.x > -9000.0
	for i in _panes.size():
		var pane: Pane = _panes[i]
		pane.visible = shown and i < _views.size() and _split.kids.size() > i and not _split.kids[i].off
		if not pane.visible:
			pane.box = null
			continue
		pane.box = _split.kids[i]
		pane.position = _split_at + _views[i].position
		pane.size = _views[i].size
		pane.ground = Color(board, 1.0) if not _split.kids[i].s.has("pane") else _split.kids[i].s.pane
		pane.edge = rule if _split.kids[i].s.get("edged", true) else Color(0, 0, 0, 0)


## A moment after the last of the typing, it's sent; and a moment after the pointer stops on a picture, where it is.
func _process(delta: float) -> void:
	if not _typing.is_empty():
		_typing_left -= delta
		if _typing_left <= 0.0:
			_send_typed()
	if _rest_left > 0.0:
		_rest_left -= delta
		if _rest_left <= 0.0 and _canvas != null:
			_rest_left = -1.0
			_rested = true
			pointed.emit(int(_canvas.d.get("id", -1)), "move", _rest_at)
	if _typing.is_empty() and _rest_left <= 0.0:
		set_process(false)


func _send_typed() -> void:
	set_process(false)
	var waiting := _typing
	_typing = {}
	for id in waiting:
		typed.emit(int(id), str(waiting[id]))


func _typed_soon(field: Control, value: String) -> void:
	_typing[int(field.get_meta("id"))] = value
	_typing_left = 0.35
	set_process(true)


func _get_tooltip(at_position: Vector2) -> String:
	return str(_under(root, Vector2.ZERO, at_position)[1])


## For checking: the middle of whatever can be clicked whose words include these, on the page; (-1, -1) if nothing.
func spot_of(text: String) -> Vector2:
	var id := _id_of(tree, text)
	return Vector2(-1, -1) if id < 0 or root == null else _middle_of(root, Vector2.ZERO, id)


func _said(d: Variant) -> String:
	if typeof(d) != TYPE_DICTIONARY:
		return str(d)
	var all := ""
	for k in d.get("k", []):
		all += _said(k)
	return all


func _id_of(d: Variant, text: String) -> int:
	if typeof(d) != TYPE_DICTIONARY:
		return -1
	for k in d.get("k", []):
		var inside := _id_of(k, text)
		if inside >= 0:
			return inside
	return int(d.id) if d.has("id") and not d.has("d") and _said(d).contains(text) else -1


func _middle_of(b: Box, at: Vector2, id: int) -> Vector2:
	if b.off:
		return Vector2(-1, -1)
	var here := at + b.at
	if b.kind == RUN:
		for place in b.placed:
			if int(b.words[place[0]].id) == id:
				return here + Vector2(place[1] + b.words[place[0]].w / 2.0, place[2] + place[3] / 2.0)
		return Vector2(-1, -1)
	for kid in b.kids:
		var found := _middle_of(kid, here, id)
		if found.x >= 0.0:
			return found
	return here + b.size / 2.0 if b.id == id else Vector2(-1, -1)


func _make_custom_tooltip(for_text: String) -> Object:
	return Pal.tip(for_text, {"c": ink, "bg": ground, "bright": bright})


## What kind of thing to fill in an element is: a list to pick from, a box for lines of words, a box to tick, or a
## box for a word or a number.
func _field_kind(d: Dictionary) -> String:
	match str(d.get("t", "")):
		"select":
			return "pick"
		"textarea":
			return "area"
	return "tick" if str(d.get("type", "")) == "checkbox" else "line"


## What a list to pick from shows as picked: [which of its choices, its words].
func _picked(d: Dictionary) -> Array:
	var n := 0
	var marked := [-1, ""]
	for k in d.get("k", []):
		if typeof(k) != TYPE_DICTIONARY:
			continue
		for one in (k.get("k", []) if str(k.get("t", "")) == "optgroup" else [k]):
			if typeof(one) != TYPE_DICTIONARY or str(one.get("t", "")) != "option":
				continue
			if d.has("v") and str(one.get("v", "")) == str(d.v):
				return [n, _said(one)]
			if marked[0] < 0 and (one.has("sel") or not d.has("v")):
				marked = [n, _said(one)]
			n += 1
	return marked


## How big a box to fill in is, in the room there is for it.
func _field_size(d: Dictionary, room: float) -> Vector2:
	match _field_kind(d):
		"pick":
			return Vector2(minf(room, clampf(str(_picked(d)[1]).length() * _char(13.0) + 44.0, 110.0, 300.0)), 26.0)
		"area":
			return Vector2(room, float(d.get("rows", 6)) * 19.0 + 12.0)
		"tick":
			return Vector2(30.0, 22.0)
	return Vector2(minf(room, 90.0 if str(d.get("type", "")) == "number" else 360.0), 28.0)


func _new_field(kind: String) -> Control:
	var field: Control
	match kind:
		"pick":
			var pick := OptionButton.new()
			pick.fit_to_longest_item = false
			pick.clip_text = true
			pick.alignment = HORIZONTAL_ALIGNMENT_LEFT
			# Its list, in the page's colours.
			var list := pick.get_popup()
			list.add_theme_font_override("font", Pal.MONO)
			list.add_theme_font_size_override("font_size", 13)
			list.add_theme_font_override("font_separator", Pal.MONO)
			list.add_theme_font_size_override("font_separator_size", 11)
			list.add_theme_color_override("font_color", ink)
			list.add_theme_color_override("font_hover_color", ground)
			list.add_theme_color_override("font_separator_color", dim)
			list.add_theme_color_override("font_disabled_color", dim)
			list.add_theme_stylebox_override("panel", Pal.margins(Pal.box(Color(ground, 1.0), ink, 1), 4, 4))
			list.add_theme_stylebox_override("hover", Pal.box(ink, ink, 0))
			for side in ["labeled_separator_left", "labeled_separator_right", "separator"]:
				list.add_theme_stylebox_override(side, StyleBoxEmpty.new())
			list.add_theme_constant_override("v_separation", 3)
			list.max_size = Vector2i(560, 440)
			pick.item_selected.connect(func(index: int) -> void:
				_send_typed()
				get_viewport().gui_release_focus()
				typed.emit(int(pick.get_meta("id")), str((pick.get_meta("values") as Array)[index])))
			field = pick
		"area":
			var area := TextEdit.new()
			area.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
			area.add_theme_color_override("caret_color", bright)
			area.text_changed.connect(func() -> void: _typed_soon(area, area.text))
			field = area
		"tick":
			# A box to tick, as the console writes one.
			var tick := Button.new()
			tick.toggle_mode = true
			tick.text = "[ ]"
			tick.toggled.connect(func(on: bool) -> void:
				tick.text = "[x]" if on else "[ ]"
				_send_typed()
				typed.emit(int(tick.get_meta("id")), "true" if on else ""))
			field = tick
		_:
			var line := LineEdit.new()
			line.add_theme_color_override("font_placeholder_color", dim)
			line.add_theme_color_override("caret_color", bright)
			line.text_changed.connect(func(text: String) -> void: _typed_soon(line, text))
			field = line
	field.set_meta("kind", kind)
	field.add_theme_font_override("font", Pal.MONO)
	field.add_theme_font_size_override("font_size", 13 if kind != "line" else 14)
	for tone in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		field.add_theme_color_override(tone, bright)
	if kind == "tick":
		for state in ["normal", "hover", "pressed", "focus", "hover_pressed"]:
			field.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	else:
		for state in ["normal", "hover", "pressed", "read_only"]:
			field.add_theme_stylebox_override(state, Pal.margins(Pal.box(ground, rule, 1), 6, 2))
		field.add_theme_stylebox_override("focus", Pal.margins(Pal.box(ground if kind != "pick" else Color(0, 0, 0, 0), ink, 1), 6, 2))
	# The wheel over one of them still moves what it's in (a box of lines moves its own lines).
	if kind != "area":
		field.mouse_filter = Control.MOUSE_FILTER_PASS
	return field


## A list's choices, put in when they've changed: a heading for each group of them.
func _fill_pick(pick: OptionButton, d: Dictionary) -> void:
	var kids: Array = d.get("k", [])
	var mark := hash(kids)
	if pick.has_meta("mark") and int(pick.get_meta("mark")) == mark:
		return
	pick.set_meta("mark", mark)
	pick.clear()
	var values: Array = []
	for k in kids:
		if typeof(k) != TYPE_DICTIONARY:
			continue
		var grouped := str(k.get("t", "")) == "optgroup"
		if grouped:
			pick.add_separator(str(k.get("label", "")))
			values.append("")
		for one in (k.get("k", []) if grouped else [k]):
			if typeof(one) == TYPE_DICTIONARY and str(one.get("t", "")) == "option":
				pick.add_item(_said(one))
				pick.get_popup().set_item_as_radio_checkable(pick.item_count - 1, false)
				values.append(str(one.get("v", _said(one))))
	pick.set_meta("values", values)


## Where a box is on the page, for the boxes to type in, tick or pick from, which are Godot's own.
func _place_fields() -> void:
	while _fields.size() > _field_boxes.size():
		(_fields.pop_back() as Control).queue_free()
	for i in _field_boxes.size():
		var b: Box = _field_boxes[i]
		var kind := _field_kind(b.d)
		if i < _fields.size() and str(_fields[i].get_meta("kind")) != kind:
			_fields[i].queue_free()
			_fields[i] = _new_field(kind)
			add_child(_fields[i])
		if i >= _fields.size():
			_fields.append(_new_field(kind))
			add_child(_fields[i])
		var field: Control = _fields[i]
		field.set_meta("id", int(b.d.get("id", -1)))
		var value := str(b.d.get("v", ""))
		match kind:
			"pick":
				var pick := field as OptionButton
				_fill_pick(pick, b.d)
				var at: int = _picked(b.d)[0]
				var values: Array = pick.get_meta("values")
				# The choices are counted without their headings; the list counts those too.
				var index := -1
				for n in values.size():
					if not pick.is_item_separator(n):
						at -= 1
						if at < 0:
							index = n
							break
				pick.select(index)
				pick.disabled = b.d.has("d")
			"area":
				if not field.has_focus() and (field as TextEdit).text != value:
					(field as TextEdit).text = value
			"tick":
				(field as Button).set_pressed_no_signal(b.d.has("pressed"))
				(field as Button).text = "[x]" if b.d.has("pressed") else "[ ]"
			_:
				(field as LineEdit).placeholder_text = str(b.d.get("ph", ""))
				if not field.has_focus() and (field as LineEdit).text != value:
					(field as LineEdit).text = value
		# One in a window of the page's is that window's, so it's cut off where the window ends.
		var pane: Control = self
		var spot := _where(root, b, Vector2.ZERO) if root != null else Vector2(-9999, -9999)
		if _split != null:
			for n in mini(_views.size(), _split.kids.size()):
				if _where(_split.kids[n], b, Vector2.ZERO).x > -9000.0 or _split.kids[n] == b:
					pane = _panes[n]
					spot -= pane.position
		if field.get_parent() != pane:
			field.reparent(pane, false)
		field.visible = spot.x > -9000.0
		field.position = spot
		field.size = b.size


## Where a box is on the page; far off it when it, or something it's in, isn't shown.
func _where(b: Box, wanted: Box, at: Vector2) -> Vector2:
	if b.off:
		return Vector2(-9999, -9999)
	if b == wanted:
		return at + b.at
	for kid in b.kids:
		var found := _where(kid, wanted, at + b.at)
		if found.x > -9000.0:
			return found
	return Vector2(-9999, -9999)
