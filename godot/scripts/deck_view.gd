## One deck on the screen: its floor, the shadows on it, what stands on it, whoever moves about it, and the light over
## all of it. The layers go on in the browser view's own order (draw in public/iso.js):
##
##   what flickers under the deck (an engine's heart, the stars)   the floor   the words on it
##   shadows and worn ways   everything standing   the consoles' lights   the words on the walls
##   everyone and the doors   the room's light, multiplied over everything   its haze   what shines
##   smoke, sparks, the red lamp of a locked door
##
## The light is the dim ship's: the light that's everywhere, a room with its lights out dark by itself, and a soft pool
## for each lamp, screen and lit thing the game names, made once as a small picture (as drawLightmap does) and laid
## over the deck.
class_name DeckView
extends Node2D

const BLUR: Shader = preload("res://shaders/blur.gdshader")
const SHADE: Shader = preload("res://shaders/shade.gdshader")
const FLICKER: Shader = preload("res://shaders/flicker.gdshader")
## The most pixels in a deck's lightmap: it's soft light, so it needn't be sharp.
const LIGHTMAP_PIXELS := 500000.0
const AMBIENT_BOOST := 1.6
## The shadows are made at a quarter of the deck's size.
const SHADE_SCALE := 0.25

var art: DeckArt
var overlay: Overlay
var lantern: Sprite2D
var lit := true

var _bakes: Array[SubViewport] = []
var _light_layers: Array[CanvasItem] = []
var _flames: Node2D
var _flickers: Array[ShaderMaterial] = []
var _glow: GradientTexture2D


func build(deck_art: DeckArt, atlas: Texture2D, with_light: bool, ways := {}) -> void:
	art = deck_art
	lit = with_light
	_glow = _pool_texture([0.0, 0.25, 1.0], [0.9, 0.32, 0.0])
	var scene := art.scene
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS

	# Under the deck: the burning heart of an engine, seen where the floor leaves it open, and the stars.
	var under := Pen.new(Vector2.ZERO)
	for cell in scene.glows:
		_flicker_quad(under, _square(int(cell.x), int(cell.y)), 0.0, float(cell.seed), Color.WHITE)
	var writing := Iso.hex(scene.colors.get("writing"), "#d8d4c0")
	for spark in scene.sparks:
		var c := Iso.at((float(spark.x) + float(spark.seed)) * Iso.CELL_WIDTH, float(spark.y) + 1.0 - float(spark.seed))
		var half := Iso.UNIT * (0.05 if spark.get("mark", "") == "*" else 0.028) / 2.0
		_flicker_quad(under, PackedVector2Array([c + Vector2(-half, -half), c + Vector2(half, -half), c + Vector2(half, half), c + Vector2(-half, half)]), 1.0, float(spark.seed), writing)
	_add_flicker(under, scene)

	_add_mesh(art.ground, atlas)
	_add_words(art.floor_words)
	_add_shade()
	_add_mesh(art.standing, atlas)

	# The little lights on the consoles, which are the only thing on a deck that moves by itself.
	var lamps := Pen.new(Vector2.ZERO)
	var glow := Iso.hex(scene.look.get("glow"), "#6fd0a0")
	for b in scene.blocks:
		if b.style != "machine" or float(b.seed) < 0.55 or b.get("off", false):
			continue
		var middle := Iso.at((int(b.x) + 0.5) * Iso.CELL_WIDTH, int(b.y) + 0.5, float(b.h))
		var w := Iso.UNIT * 0.02
		var h := Iso.UNIT * 0.012
		_flicker_quad(lamps, PackedVector2Array([middle + Vector2(-w, -h), middle + Vector2(w, -h), middle + Vector2(w, h), middle + Vector2(-w, h)]), 2.0, float(b.seed), Color("f0c060") if float(b.seed) > 0.8 else glow)
	_add_flicker(lamps, scene)

	_add_words(art.wall_words)

	overlay = Overlay.new()
	add_child(overlay)
	overlay.setup(art, atlas, ways)

	if lit:
		_add_light()
	_add_after_light()


func _square(x: int, y: int) -> PackedVector2Array:
	var x0 := x * Iso.CELL_WIDTH
	return PackedVector2Array([Iso.at(x0, y), Iso.at(x0 + Iso.CELL_WIDTH, y), Iso.at(x0 + Iso.CELL_WIDTH, y + 1), Iso.at(x0, y + 1)])


func _flicker_quad(pen: Pen, points: PackedVector2Array, what: float, seed_of: float, color: Color) -> void:
	var base := pen.verts.size()
	for p in points:
		pen.verts.append(p)
		pen.uvs.append(Vector2(seed_of, what))
		pen.colors.append(color)
	for i in [0, 1, 2, 0, 2, 3]:
		pen.indices.append(base + i)


func _add_flicker(pen: Pen, scene: Dictionary) -> void:
	if pen.verts.is_empty():
		return
	var node := MeshInstance2D.new()
	node.mesh = pen.mesh()
	var material := ShaderMaterial.new()
	material.shader = FLICKER
	var fire := Iso.hex(scene.look.get("fire"), "#ff9a50")
	var low := Iso.scaled(fire, 0.55)
	var high := Iso.scaled(fire, 1.25)
	material.set_shader_parameter("fire_low", Vector3(low.r, low.g, low.b))
	material.set_shader_parameter("fire_high", Vector3(high.r, high.g, high.b))
	node.material = material
	_flickers.append(material)
	add_child(node)


func _add_mesh(pen: Pen, atlas: Texture2D) -> void:
	var node := MeshInstance2D.new()
	node.mesh = pen.mesh()
	node.texture = atlas
	add_child(node)


func _add_words(items: Array[Dictionary]) -> void:
	if items.is_empty():
		return
	var words := Words.new()
	words.items = items
	words.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	add_child(words)


func _bake(size: Vector2i) -> SubViewport:
	var view := SubViewport.new()
	view.size = Vector2i(maxi(8, size.x), maxi(8, size.y))
	view.disable_3d = true
	view.transparent_bg = true
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(view)
	_bakes.append(view)
	return view


## Soft shadows round everything that stands on the floor, which is most of what makes it look solid, and the floor a
## little paler where people walk. Drawn sharp on a small picture, the shadows in red and the ways in green, blurred
## once, and laid over the floor.
func _add_shade() -> void:
	var bounds := art.bounds
	var size := Vector2i((bounds.size * SHADE_SCALE).ceil())
	var sharp := _bake(size)
	var shapes := ShadeShapes.new()
	shapes.shadows = art.shadows
	shapes.ways = art.scene.worn
	shapes.position = -bounds.position * SHADE_SCALE
	shapes.scale = Vector2.ONE * SHADE_SCALE
	var adding := CanvasItemMaterial.new()
	adding.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	shapes.material = adding
	sharp.add_child(shapes)

	var soft := _bake(size)
	var rect := ColorRect.new()
	rect.size = Vector2(size)
	var blur := ShaderMaterial.new()
	blur.shader = BLUR
	blur.set_shader_parameter("source", sharp.get_texture())
	blur.set_shader_parameter("pixel", Vector2.ONE / Vector2(size))
	blur.set_shader_parameter("spread", Iso.UNIT * 0.14 * SHADE_SCALE)
	rect.material = blur
	soft.add_child(rect)

	var shade := Sprite2D.new()
	shade.centered = false
	shade.texture = soft.get_texture()
	shade.position = bounds.position
	shade.scale = Vector2.ONE / SHADE_SCALE
	shade.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	var laying := ShaderMaterial.new()
	laying.shader = SHADE
	shade.material = laying
	add_child(shade)


## How much light reaches each part of the deck: the light that's everywhere, then a soft pool for each light the game
## names. It's multiplied over everything, moving or not, and the pools go on top again, faintly, as a coloured haze.
func _add_light() -> void:
	var scene := art.scene
	var bounds := art.bounds
	var by := minf(0.25, sqrt(LIGHTMAP_PIXELS / maxf(1.0, bounds.size.x * bounds.size.y)))
	var size := Vector2i((bounds.size * by).ceil())
	var view := _bake(size)
	view.transparent_bg = false
	var base := Iso.hex(scene.look.get("ambient"), "#5c5f63")
	var ambient := Color(minf(1.0, base.r * AMBIENT_BOOST), minf(1.0, base.g * AMBIENT_BOOST), minf(1.0, base.b * AMBIENT_BOOST))
	var everywhere := ColorRect.new()
	everywhere.size = Vector2(size)
	everywhere.color = ambient
	view.add_child(everywhere)
	# Rooms drawn on a deck whose lights are out are dark on their own, the rest of the deck staying lit.
	for area in scene.get("darkAreas", []):
		var room := Polygon2D.new()
		var corners := PackedVector2Array()
		for corner in [Vector2(float(area.x), float(area.y)), Vector2(float(area.x) + float(area.w), float(area.y)), Vector2(float(area.x) + float(area.w), float(area.y) + float(area.h)), Vector2(float(area.x), float(area.y) + float(area.h))]:
			corners.append((Iso.at(corner.x * Iso.CELL_WIDTH, corner.y) - bounds.position) * by)
		room.polygon = corners
		room.color = Iso.mix(base, Color.BLACK, 0.74)
		view.add_child(room)
	# The pools alone, on black, are the haze.
	var pools := _bake(size)
	pools.transparent_bg = false
	var black := ColorRect.new()
	black.size = Vector2(size)
	black.color = Color.BLACK
	pools.add_child(black)
	var pool := _pool_texture([0.0, 0.45, 1.0], [0.95, 0.42, 0.0])
	var adding := CanvasItemMaterial.new()
	adding.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	for light in scene.lights:
		var radius := float(light.radius) * Iso.UNIT * 0.66 * by
		var colour := Iso.vivid(Iso.hex(light.color, "#e0b070"))
		for into in [view, pools]:
			var sprite := Sprite2D.new()
			sprite.texture = pool
			sprite.material = adding
			sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
			sprite.position = (Iso.at(float(light.wx), float(light.wy)) - bounds.position) * by
			sprite.scale = Vector2(1.25, 0.72) * (radius * 2.0 / pool.get_width())
			sprite.modulate = Color(colour.r, colour.g, colour.b, clampf(float(light.power), 0.0, 1.0))
			into.add_child(sprite)

	var over := Sprite2D.new()
	over.centered = false
	over.texture = view.get_texture()
	over.position = bounds.position
	over.scale = Vector2.ONE / by
	over.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	var multiplying := CanvasItemMaterial.new()
	multiplying.blend_mode = CanvasItemMaterial.BLEND_MODE_MUL
	over.material = multiplying
	add_child(over)
	_light_layers.append(over)

	var haze := Sprite2D.new()
	haze.centered = false
	haze.texture = pools.get_texture()
	haze.position = bounds.position
	haze.scale = Vector2.ONE / by
	haze.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	haze.material = adding
	haze.modulate = Color(1, 1, 1, 0.14)
	add_child(haze)
	_light_layers.append(haze)

	# What shines through the dark goes on after the light, so that it isn't dimmed by it: the lamps on the walls, and
	# whatever's burning.
	var glow := _glow
	var shining := Node2D.new()
	add_child(shining)
	_light_layers.append(shining)
	for fixture in scene.fixtures:
		if fixture.get("off", false):
			continue
		var sprite := _glow_sprite(glow, adding, art.fixture_middle(fixture), Iso.UNIT * 0.9, Iso.vivid(Iso.hex(fixture.get("color"), "#e0b070")))
		shining.add_child(sprite)
	_flames = Node2D.new()
	shining.add_child(_flames)
	var fire := Iso.vivid(Iso.hex(scene.look.get("fire"), "#ff9a50"))
	for cell in scene.glows:
		if float(cell.seed) < 0.5:
			continue
		_flames.add_child(_glow_sprite(glow, adding, Iso.at((int(cell.x) + 0.5) * Iso.CELL_WIDTH, int(cell.y) + 0.5, 0.1), Iso.UNIT * 1.1, fire))

	# The player can always see a little way around themselves.
	lantern = _glow_sprite(_pool_texture([0.0, 1.0], [0.42, 0.0]), adding, Vector2.ZERO, Iso.UNIT * 6.4, Color(1.0, 240 / 255.0, 215 / 255.0, 0.3))
	add_child(lantern)
	_light_layers.append(lantern)


func _glow_sprite(texture: Texture2D, material_of: Material, at: Vector2, size: float, colour: Color) -> Sprite2D:
	var sprite := Sprite2D.new()
	sprite.texture = texture
	sprite.material = material_of
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	sprite.position = at
	sprite.scale = Vector2.ONE * (size / texture.get_width())
	sprite.modulate = colour
	return sprite


## A soft round light, white, fading out from its middle the way the stops say.
func _pool_texture(offsets: Array, alphas: Array) -> GradientTexture2D:
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array(offsets)
	var colours := PackedColorArray()
	for alpha in alphas:
		colours.append(Color(1, 1, 1, alpha))
	gradient.colors = colours
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = 128
	texture.height = 128
	return texture


## What goes on after the light in the room, so the dark doesn't dim it (drawAfterLight): smoke over a fire and steam
## off a kettle with soup in it; and, shining, air streaming out of a hole in the hull with a warning lamp beside it,
## sparks off what's broken, an alarm that's ringing, and the red lamp of a door the systems have locked.
func _add_after_light() -> void:
	var scene := art.scene
	var steaming: Array[Dictionary] = []
	for thing in art.kettles:
		# Where the kettle is drawn: the middle of the piece of furniture it is.
		for b in scene.blocks:
			if b.style == "piece" and b.get("kind", "") == "kettle" and int(thing.x) * Iso.CELL_WIDTH >= float(b.x0) - 0.01 and int(thing.x) * Iso.CELL_WIDTH < float(b.x1) and int(thing.y) >= float(b.y0) - 0.01 and int(thing.y) < float(b.y1):
				steaming.append({"thing": thing, "at": Vector2((float(b.x0) + float(b.x1)) / 2.0, (float(b.y0) + float(b.y1)) / 2.0)})
				break
	var fires: Array = scene.get("fires", [])
	if not fires.is_empty() or not steaming.is_empty():
		var smoke := Smoke.new()
		smoke.fires = fires
		smoke.kettles = steaming
		add_child(smoke)
	var breaches: Array = scene.get("breaches", [])
	if not breaches.is_empty() or not art.sparking.is_empty() or not art.ringing.is_empty() or not art.locked_doors.is_empty():
		var shine := Shine.new()
		shine.breaches = breaches
		shine.sparking = art.sparking
		shine.ringing = art.ringing
		shine.locked = art.locked_doors
		shine.glow = _glow
		var adding := CanvasItemMaterial.new()
		adding.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		shine.material = adding
		add_child(shine)


## How full the ship's stores are now: the crates are stacked again, and a kettle that's run dry stops steaming.
func take_stock(things: Array) -> void:
	overlay.take_stock(things)
	for thing in things:
		for kettle in art.kettles:
			if str(kettle.id) == str(thing.get("id", "")) and typeof(thing.get("stock")) == TYPE_DICTIONARY:
				kettle["stock"] = thing.stock


## The small pictures of the shadows and the light are made in the deck's first moments on the graphics card, and kept.
func settle() -> void:
	for view in _bakes:
		view.render_target_update_mode = SubViewport.UPDATE_DISABLED


func _process(_delta: float) -> void:
	if _flames != null and visible:
		_flames.modulate.a = 0.42 + 0.14 * sin(Time.get_ticks_msec() / 300.0)


## The picture of the shadows before it's blurred: every shadow in red, every way people walk in green.
class ShadeShapes:
	extends Node2D

	var shadows: Array[PackedVector2Array] = []
	var ways: Array = []

	func _draw() -> void:
		for shape in shadows:
			draw_colored_polygon(shape, Color(1, 0, 0, 1))
		var wide := Iso.UNIT * 0.3
		for way in ways:
			var line := PackedVector2Array()
			for point in way:
				line.append(Iso.at(float(point[0]), float(point[1])))
			if line.size() < 2:
				continue
			draw_polyline(line, Color(0, 1, 0, 1), wide)
			for p in line:
				draw_circle(p, wide / 2.0, Color(0, 1, 0, 1))


## Smoke, two puffs rising off each burning square, thicker as the fire grows; and steam off a kettle.
class Smoke:
	extends Node2D

	var fires: Array = []
	var kettles: Array[Dictionary] = []

	func _process(_delta: float) -> void:
		if is_visible_in_tree():
			queue_redraw()

	func _draw() -> void:
		var now := float(Time.get_ticks_msec())
		var u := Iso.UNIT
		for fire in fires:
			var c := Iso.centre(int(fire.x), int(fire.y))
			var seed_of := float(fire.get("seed", 0.0))
			for k in 2:
				var p := fposmod(now / 3200.0 + k / 2.0 + seed_of * 3.0, 1.0)
				draw_circle(Iso.at(c.x + sin(p * 4.0 + seed_of * 9.0) * 0.15, c.y, 0.6 + p * 2.4), u * (0.12 + p * 0.38), Color(24 / 255.0, 22 / 255.0, 20 / 255.0, (0.26 + float(fire.get("size", 1)) * 0.04) * (1.0 - p)))
		for kettle in kettles:
			var stock: Variant = kettle.thing.get("stock")
			var full := float(stock.get("full", 0.0)) if typeof(stock) == TYPE_DICTIONARY and stock.get("full") != null else 0.0
			if full <= 0.0:
				continue
			var at: Vector2 = kettle.at
			for k in 3:
				var p := fposmod(now / 2600.0 + k / 3.0, 1.0)
				draw_circle(Iso.at(at.x + sin(p * 5.0 + k) * 0.08, at.y, 1.06 + p * 0.9), u * (0.06 + p * 0.12), Color(232 / 255.0, 236 / 255.0, 240 / 255.0, 0.16 * (1.0 - p) * minf(1.0, full * 4.0)))


## What shines after the light: a hole in the hull, sparks, alarms, locked doors.
class Shine:
	extends Node2D

	var breaches: Array = []
	var sparking: Array[Vector2] = []
	var ringing: Array[Vector2] = []
	var locked: Array[Vector2] = []
	var glow: Texture2D

	func _process(_delta: float) -> void:
		if is_visible_in_tree():
			queue_redraw()

	func _glow_at(at: Vector2, size: float, colour: Color) -> void:
		draw_texture_rect(glow, Rect2(at - Vector2(size, size) / 2.0, Vector2(size, size)), false, colour)

	func _draw() -> void:
		var now := float(Time.get_ticks_msec())
		var u := Iso.UNIT
		# Air streaming out of a hole in the hull, and an amber lamp blinking by it.
		for breach in breaches:
			var east: bool = breach.get("face", "s") == "e"
			var x := int(breach.x)
			var y := int(breach.y)
			var m := Vector3((x + 1) * Iso.CELL_WIDTH + 0.004, y + 0.5, 0.85) if east else Vector3((x + 0.5) * Iso.CELL_WIDTH, y + 1.004, 0.85)
			var across := Vector2(0, 1) if east else Vector2(1, 0)
			var into := Vector2(1, 0) if east else Vector2(0, 1)
			_glow_at(Iso.at(m.x, m.y, m.z), u * 1.1, Color(207 / 255.0, 230 / 255.0, 242 / 255.0, 0.35))
			var dice := Live.Dice.new("vent%d,%d" % [x, y])
			for k in 16:
				var side := (dice.roll() - 0.5) * 1.8
				var lift := (dice.roll() - 0.5) * 0.7
				var speed := 0.8 + dice.roll() * 0.6
				var p := fposmod(now / (900.0 / speed) + k / 10.0, 1.0)
				var far := 2.2 * (1.0 - p)
				var from := far + 0.4
				var a := Iso.at(m.x + into.x * from + across.x * side * from * 0.4, m.y + into.y * from + across.y * side * from * 0.4, m.z + lift * from * 0.3)
				var b := Iso.at(m.x + into.x * far + across.x * side * far * 0.4, m.y + into.y * far + across.y * side * far * 0.4, m.z + lift * far * 0.3)
				draw_line(a, b, Color(214 / 255.0, 230 / 255.0, 240 / 255.0, 0.18 + 0.55 * p), 1.6, true)
			_glow_at(Iso.at(m.x + across.x * 0.3, m.y + across.y * 0.3, m.z + 0.6), u * 0.9, Color(1.0, 174 / 255.0, 48 / 255.0, 0.35 + 0.65 * (0.5 + 0.5 * sin(now / 220.0))))
		# Sparks off what's broken: a burst every second or two, a few bright specks thrown out and falling.
		for at in sparking:
			var sx := int(at.x)
			var sy := int(at.y)
			var every := 1500.0 + Iso.hash_of(sx, sy) * 900.0
			var from := now + Iso.hash_of(sy, sx) * every
			var burst := int(floor(from / every))
			var t := fposmod(from, every) / 420.0
			if t > 1.0:
				continue
			if t < 0.3:
				_glow_at(at, u * 0.75 * (1.0 - t), Color(1.0, 210 / 255.0, 122 / 255.0))
			for i in 9:
				var angle := PI * (1.05 + Iso.hash_of(i * 13 + burst, sx * 7) * 0.9)
				var speed := u * (0.25 + Iso.hash_of(burst, i * 5 + sy) * 0.35)
				var speck := at + Vector2(cos(angle) * speed * t, sin(angle) * speed * t + u * 0.5 * t * t)
				draw_rect(Rect2(speck - Vector2(1.3, 1.3), Vector2(2.6, 2.6)), Color(1.0, 236 / 255.0, 170 / 255.0, 1.0 - t * 0.8))
		# An alarm that's ringing is lit red all over, beating.
		var beat := 0.5 + 0.5 * sin(now / 160.0)
		for at in ringing:
			draw_circle(at, u * 0.1, Color(1.0, 40 / 255.0, 24 / 255.0, 0.35 + beat * 0.5))
		# A door the systems have locked has its lock lit red, blinking.
		if int(floor(now / 600.0)) % 2 == 0:
			for at in locked:
				_glow_at(at, u * 0.45, Color(1.0, 58 / 255.0, 36 / 255.0))
