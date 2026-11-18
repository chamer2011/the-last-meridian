## Walking freely on a deck, the same as the browser view's (public/move.js): smoothly wherever the floor goes,
## sliding along walls and eased round corners, and a click walks the shortest way round what's in the way, smoothed
## into straight lines. Where the floor is comes from the game (tools/godot-decks.mjs), never from the pictures.
##
## A position counts from a square's middle: at (3, 4) the player is in the middle of square (3, 4), and at (3.4, 4) a
## little to its right. A square is CELL_WIDTH across and one deep.
class_name Mover
extends RefCounted

## How fast the player walks, in the room's own measure to a second.
const SPEED := 6.0
## Half the player's width, in the same measure: how close they come to a wall.
const BODY := 0.13
## How far to one side the player is eased, in squares, when they walk straight at the edge of a doorway or a corner.
const ROUND_CORNERS := 0.5
## How far from a click the nearest floor is looked for, in squares.
const SNAP_DISTANCE := 3
const STEPS := [Vector2i(0, -1), Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, 1)]
## Which way each key walks: up the screen, seen from an angle.
const ON_SCREEN := {"up": Vector2(-1, -1), "down": Vector2(1, 1), "left": Vector2(-1, 1), "right": Vector2(1, -1)}
const CW := Iso.CELL_WIDTH

var floor_rows: Array = []
var ways_out := {}
var cols := 0
var lines := 0


func _init(deck: Dictionary) -> void:
	floor_rows = deck.floor
	cols = int(deck.cols)
	lines = int(deck.lines)
	for exit in deck.exits:
		ways_out[Vector2i(int(exit.x), int(exit.y))] = exit


## What can be walked on: the deck's floor and its ways out.
func ground(x: int, y: int) -> bool:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return false
	return floor_rows[y][x] == "." or ways_out.has(Vector2i(x, y))


## Whether a square can be stood on (a way out is walked into, not stood on).
func stands(x: int, y: int) -> bool:
	if x < 0 or y < 0 or y >= lines or x >= cols:
		return false
	return floor_rows[y][x] == "."


static func square_of(pos: Vector2) -> Vector2i:
	return Vector2i(int(floor(pos.x + 0.5)), int(floor(pos.y + 0.5)))


## The squares the player's body covers at a position.
static func _covered(pos: Vector2) -> Array[Vector2i]:
	var across := BODY / CW
	var cx := pos.x + 0.5
	var cy := pos.y + 0.5
	var out: Array[Vector2i] = []
	for y in range(int(floor(cy - BODY)), int(floor(cy + BODY - 0.000000001)) + 1):
		for x in range(int(floor(cx - across)), int(floor(cx + across - 0.000000001)) + 1):
			out.append(Vector2i(x, y))
	return out


## Whether the player fits at a position: every square their body would cover can be walked on, or is one they're on
## already, so that nobody who's ended up somewhere odd is stuck there.
func fits(from: Vector2, to: Vector2) -> bool:
	var already := _covered(from)
	for square in _covered(to):
		if not already.has(square) and not ground(square.x, square.y):
			return false
	return true


## One step along one way. Walking straight at the edge of a doorway or a corner, the player is eased to the side it'd
## go on, by no more than the step itself, so that a corridor's mouth is easy to find.
func _step_along(at: Vector2, sx: float, sy: float) -> Vector2:
	var next := at + Vector2(sx, sy)
	if fits(at, next):
		return next
	var length := absf(sx) * CW + absf(sy)
	var off := 0.1
	while off <= ROUND_CORNERS + 0.000000001:
		for side in [1.0, -1.0]:
			var beside := Vector2(at.x, at.y + side * off) if sx != 0.0 else Vector2(at.x + side * off, at.y)
			if not fits(at, beside) or not fits(beside, beside + Vector2(sx, sy)):
				continue
			var ease := minf(off, length if sx != 0.0 else length / CW)
			var toward := Vector2(at.x, at.y + side * ease) if sx != 0.0 else Vector2(at.x + side * ease, at.y)
			return toward if fits(at, toward) else at
		off += 0.1
	return at


## Walks the player by a step, in squares, sliding along whatever's in the way. A long step is cut up, so nothing thin
## is stepped over.
func walk_by(pos: Vector2, dx: float, dy: float) -> Vector2:
	var at := pos
	var parts := maxi(1, int(ceil(maxf(absf(dx), absf(dy)) / 0.2)))
	for i in parts:
		if dx != 0.0:
			at = _step_along(at, dx / parts, 0.0)
		if dy != 0.0:
			at = _step_along(at, 0.0, dy / parts)
	return at


## Whether the player could walk straight from one position to another.
func _clear_line(from: Vector2, to: Vector2) -> bool:
	var steps := maxi(1, int(ceil(maxf(absf(to.x - from.x), absf(to.y - from.y)) / 0.1)))
	for i in range(1, steps + 1):
		if not fits(from, from + (to - from) * (float(i) / steps)):
			return false
	return true


## A way square by square, smoothed: from each point straight on to the furthest point after it that can be walked to
## in a straight line, so that a walk across a room is a line and not a staircase.
func smoothed(from: Vector2, points: Array[Vector2]) -> Array[Vector2]:
	var out: Array[Vector2] = []
	var at := from
	var i := 0
	while i < points.size():
		var far := i
		var j := points.size() - 1
		while j > i:
			if _clear_line(at, points[j]):
				far = j
				break
			j -= 1
		out.append(points[far])
		at = points[far]
		i = far + 1
	return out


## The way the held keys walk, as a step of one in the room's own measure, or nothing when they cancel out.
static func heading_of(directions: Array) -> Vector2:
	var sum := Vector2.ZERO
	for direction in directions:
		sum += ON_SCREEN[direction]
	return sum.normalized() if sum.length() > 0.0 else Vector2.ZERO


## The square nearest a click that can be stood on, looking a little way round it.
func nearest_floor(x: int, y: int) -> Variant:
	for distance in range(0, SNAP_DISTANCE + 1):
		for dy in range(-distance, distance + 1):
			var dx := distance - absi(dy)
			for cx in ([x - dx, x + dx] if dx != 0 else [x]):
				if stands(cx, y + dy):
					return Vector2i(cx, y + dy)
	return null


## The shortest way from one square to another, not counting the start: every square of it, or nothing if there's no
## way.
func find_path(from: Vector2i, to: Vector2i) -> Array[Vector2i]:
	var back := {from: from}
	var queue: Array[Vector2i] = [from]
	var i := 0
	while i < queue.size():
		var here := queue[i]
		i += 1
		if here == to:
			var path: Array[Vector2i] = []
			var at := here
			while at != from:
				path.push_front(at)
				at = back[at]
			return path
		# A way out is somewhere to walk to, never through.
		if ways_out.has(here) and here != from:
			continue
		for step in STEPS:
			var next: Vector2i = here + step
			if back.has(next) or not ground(next.x, next.y):
				continue
			back[next] = here
			queue.append(next)
	return []


## Where someone coming onto this deck by a way out stands: beside it, as the game puts them.
func beside(exit: Dictionary) -> Vector2i:
	for step in STEPS:
		var spot: Vector2i = Vector2i(int(exit.x), int(exit.y)) + step
		if stands(spot.x, spot.y):
			return spot
	return Vector2i(int(exit.x), int(exit.y))
