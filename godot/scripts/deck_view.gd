## One deck on the screen: its floor, the shadows on it, what stands on it, whoever moves about it, and the light over
## all of it. The layers go on in the browser view's own order (draw in public/iso.js):
##
##   what flickers under the deck (an engine's heart, the stars)   the floor   the words on it
##   shadows and worn ways   everything standing   the consoles' lights   the words on the walls
##   the player and the doors   the room's light, multiplied over everything   its haze   what shines
##
## The light is a first version of the dim ship: the light that's everywhere, and a soft pool for each lamp, screen and
## lit thing the game names, made once as a small picture (as drawLightmap does) and laid over the deck.
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


func build(deck_art: DeckArt, atlas: Texture2D, with_light: bool) -> void:
	art = deck_art
	lit = with_light
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
	overlay.setup(art, atlas)

	if lit:
		_add_light()


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
	var glow := _pool_texture([0.0, 0.25, 1.0], [0.9, 0.32, 0.0])
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
