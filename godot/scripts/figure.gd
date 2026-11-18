## Someone as the game draws them (drawPerson in public/iso.js): thirty units tall, standing, walking, sitting, or lying
## down, facing away from the camera or towards it, a mirror image doing for the other direction. The owner chose "As
## drawn" for people on 2026-11-16, so this is the game's own figure, line for line, and not a picture from a pack.
class_name Figure
extends RefCounted

## The player's own look (YOU_LOOK).
const YOU := {"coat": Color("7c9484"), "coat_dark": Color("54665a"), "trousers": Color("2c3430"), "skin": Color("d8b090"), "hair": Color("2a2420"), "vest": true, "pack": true, "long": false, "hat": false}
const YOUR_RING := Color(180 / 255.0, 240 / 255.0, 190 / 255.0, 0.8)
const HOVER_RING := Color(1.0, 250 / 255.0, 220 / 255.0, 0.9)


static func _limb(on: CanvasItem, a: Vector2, b: Vector2, wide: float, color: Color) -> void:
	on.draw_line(a, b, color, wide, true)
	on.draw_circle(a, wide / 2.0, color)
	on.draw_circle(b, wide / 2.0, color)


static func _rect(on: CanvasItem, x: float, y: float, w: float, h: float, color: Color) -> void:
	on.draw_rect(Rect2(x, y, w, h), color)


## Part of a circle, from one angle round to another the way a clock's hands go, closed straight across.
static func _slice(on: CanvasItem, centre: Vector2, radius: float, from: float, to: float, color: Color) -> void:
	if to < from:
		to += TAU
	var points := PackedVector2Array()
	var steps := maxi(4, int(ceil((to - from) / 0.3)))
	for i in steps + 1:
		var angle := from + (to - from) * i / steps
		points.append(centre + Vector2(cos(angle), sin(angle)) * radius)
	if points.size() >= 3:
		on.draw_colored_polygon(points, color)


## The red cross over someone lying where they fell, for anyone to see from across the room.
static func cross(on: CanvasItem, middle: Vector2, s: float) -> void:
	for pass_of in [[3.6, Color(20 / 255.0, 6 / 255.0, 4 / 255.0, 0.85)], [2.0, Color("ff6b5b")]]:
		var wide: float = pass_of[0] * s
		_limb(on, middle + Vector2(0, -4) * s, middle + Vector2(0, 4) * s, wide, pass_of[1])
		_limb(on, middle + Vector2(-4, 0) * s, middle + Vector2(4, 0) * s, wide, pass_of[1])


## Draws them on a canvas item, the point between their feet at `at`. unit is the tile's width they're drawn by; who
## says how they are: { look, flip, back, walking, step, ring, seated, raise, asleep, mark }.
static func draw(on: CanvasItem, at: Vector2, unit: float, who: Dictionary) -> void:
	var look: Dictionary = who.get("look", YOU)
	var scale := unit * 0.86 / 30.0
	var asleep: bool = who.get("asleep", false)
	# Their shadow, and the ring round the player or whoever the pointer's on.
	on.draw_set_transform(at, 0.0, Vector2(1.0, 0.5))
	if asleep:
		on.draw_set_transform(at, 0.0, Vector2(1.0, 1.0 / 3.0))
		on.draw_circle(Vector2.ZERO, unit * 0.3, Color(0, 0, 0, 0.55))
		on.draw_set_transform(at, 0.0, Vector2(1.0, 0.5))
	else:
		on.draw_circle(Vector2.ZERO, unit * 0.15, Color(0, 0, 0, 0.55))
	if who.has("ring") and who.ring != null:
		on.draw_arc(Vector2.ZERO, unit * 0.22, 0.0, TAU, 40, who.ring, 1.5, true)
	# A seat higher than a chair's lifts whoever's in it.
	var raised: Vector2 = at + Vector2(0, -float(who.get("raise", 0.0)) * unit / 2.0)
	var across := -scale if who.get("flip", false) else scale
	var skin: Color = look.skin
	var coat: Color = look.coat
	var trousers: Color = look.trousers
	if asleep:
		on.draw_set_transform(raised, 0.0, Vector2(across, scale))
		# Lying down: the length of them under their coat, and their head.
		on.draw_rect(Rect2(-7, -4, 10, 5), coat)
		on.draw_rect(Rect2(-9, -2, 14, 1), coat)
		for corner in [Vector2(-7, -2), Vector2(3, -2), Vector2(-7, -1), Vector2(3, -1)]:
			on.draw_circle(corner, 2.0, coat)
		on.draw_circle(Vector2(7, -2), 2.4, skin)
		if who.get("mark", false):
			cross(on, Vector2(0, -12), 1.0)
		on.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		return
	var sitting: bool = who.get("seated", false)
	var walking: bool = who.get("walking", false) and not sitting
	var step: float = who.get("step", 0.0)
	var back: bool = who.get("back", false)
	on.draw_set_transform(raised, 0.0, Vector2(across, scale))
	# Someone sitting has their legs out in front along the seat and down to the floor, and the rest of them lower.
	var drop := 0.0
	if sitting:
		var far_leg := Iso.scaled(trousers, 0.8)
		_limb(on, Vector2(-1.2, -8.2), Vector2(3.2, -7.6), 2.6, far_leg)
		_limb(on, Vector2(3.2, -7.6), Vector2(3.3, -0.6), 2.3, far_leg)
		_limb(on, Vector2(3.3, -0.6), Vector2(4.6, 0), 2.3, Color("141310"))
		_limb(on, Vector2(1.6, -8.2), Vector2(5.8, -7.8), 2.6, trousers)
		_limb(on, Vector2(5.8, -7.8), Vector2(5.9, -0.6), 2.3, trousers)
		_limb(on, Vector2(5.9, -0.6), Vector2(7.2, 0), 2.3, Color("1c1a16"))
		drop = 6.0
	var swing := sin(step) * 3.2 if walking else 0.0
	var lift := absf(sin(step)) * 0.6 if walking else 0.0
	on.draw_set_transform(raised + Vector2(0, (drop - lift) * scale), 0.0, Vector2(across, scale))
	# The far leg and arm first; sitting, the arms reach forward, to a console or a table.
	if not sitting:
		_limb(on, Vector2(-1.5, -14), Vector2(-1.8 - swing, -1), 2.6, Iso.scaled(trousers, 0.8))
		_limb(on, Vector2(-1.8 - swing, -1), Vector2(-1.2 - swing, 0), 2.6, Color("141310"))
	var far_hand := Vector2(3.6, -17) if sitting else Vector2(-5 + swing * 0.7, -14)
	_limb(on, Vector2(-4.3, -23), far_hand, 2.0, look.coat_dark)
	on.draw_circle(far_hand + Vector2(0, 0.8), 1.0, skin)
	if not sitting:
		_limb(on, Vector2(1.5, -14), Vector2(1.8 + swing, -1), 2.6, trousers)
		_limb(on, Vector2(1.8 + swing, -1), Vector2(2.4 + swing, 0), 2.6, Color("1c1a16"))
	# A pack on their back goes behind them if they're facing the camera, and in front of the coat if not.
	if look.pack and not back:
		_rect(on, -3.5, -24, 7, 8, Color("2c2a20"))
	# The body, with its light side and its dark side.
	var long_coat: bool = look.long
	var bottom := -8.0 if long_coat and not sitting else -13.5
	var hem := 4.0 if long_coat else 3.2
	on.draw_colored_polygon(PackedVector2Array([Vector2(-4.4, -24), Vector2(4.4, -24), Vector2(hem, bottom), Vector2(-hem, bottom)]), coat)
	on.draw_colored_polygon(PackedVector2Array([Vector2(0.6, -24), Vector2(4.4, -24), Vector2(hem, bottom), Vector2(0.6, bottom)]), Color(0, 0, 0, 0.3))
	_rect(on, -4.2, -24, 8.2, 0.8, Color(1, 1, 1, 0.14))
	if back:
		if look.pack:
			_rect(on, -3.2, -23.4, 6.4, 7.6, Color("3a3628"))
			_rect(on, 0.4, -23.4, 2.8, 7.6, Color(0, 0, 0, 0.35))
	elif look.vest:
		_rect(on, -2.8, -23, 5.6, 6.4, Color(20 / 255.0, 18 / 255.0, 14 / 255.0, 0.55))
		_rect(on, -2.2, -19.4, 1.8, 1.8, Color(1, 1, 1, 0.1))
		_rect(on, 0.4, -19.4, 1.8, 1.8, Color(1, 1, 1, 0.1))
	_rect(on, -3.2, -15, 6.4, 0.9, Color(10 / 255.0, 10 / 255.0, 8 / 255.0, 0.6))
	# The near arm.
	var near_hand := Vector2(8, -17) if sitting else Vector2(5 - swing * 0.7, -14)
	_limb(on, Vector2(4.3, -23), near_hand, 2.1, coat)
	on.draw_circle(near_hand + Vector2(0, 0.8), 1.0, skin)
	# The head.
	_rect(on, -1, -25, 2, 2, Iso.scaled(skin, 0.8))
	var head := Vector2(0.3, -27.2)
	on.draw_circle(head, 2.7, skin)
	_slice(on, head, 2.7, PI * 1.6, PI * 0.4, Color(0, 0, 0, 0.24))
	var hair: Color = Iso.scaled(coat, 0.7) if look.hat else look.hair
	if back:
		on.draw_circle(Vector2(0.3, -27.4), 2.8, hair)
	else:
		_slice(on, Vector2(0.3, -27.6), 2.8, PI * 1.02, PI * 1.98, hair)
	if look.hat:
		_rect(on, -3.2, -28.6, 7, 0.9, hair)
	if not back:
		_rect(on, 1, -27.4, 0.9, 0.7, Color(20 / 255.0, 12 / 255.0, 8 / 255.0, 0.7))
		_rect(on, 2.3, -27.4, 0.5, 0.7, Color(20 / 255.0, 12 / 255.0, 8 / 255.0, 0.7))
	on.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
