## The two bought pixel-art packs, read from the game's licensed/ folder each time the view starts and laid out on one
## big picture in memory (an atlas), so that a whole deck is drawn in a couple of strokes.
##
## The packs' licence forbids giving the files away. They are never copied into this project: nothing here is a
## resource Godot imports, and nothing is written to disk. Without them the decks are drawn in plain shapes.
##
## What each picture is of, and which is drawn where, is the game's own answer (tools/godot-decks.mjs); this only
## loads them, measures them the way public/pixel-art.js does (the box a picture's solid pixels fill, which way a flat
## fitting leans), draws wood and orange in steel where the game says so, and tones the Light look down for a Dark ship.
class_name Packs
extends RefCounted

const ATLAS_WIDE := 4096
const ATLAS_HIGH := 4096
const PAD := 2
const LEVEL := "isospace/IsoSpace_Level.png"
const ASSETS := "isospace/IsoSpace_Assets.png"
const DOORS := "isospace/IsoSpace_Doors.png"

## Where the packs are on this computer, and whether the first pack's three sheets were there.
var dir := ""
var found := false
## How much the Light look is toned down in a room of the Dark ship (world/looks.json, "pixelLight").
var light_dim := 1.0
## The colour of the top of a wall in each look, read from the pack itself.
var tops := {"dark": Color("2a2f2e"), "light": Color("2a2f2e")}
var texture: ImageTexture
## A white spot on the atlas, for shapes of plain colour drawn in the same stroke as the pictures.
var white := Vector2.ZERO
var missing: PackedStringArray = []

var _atlas: Image
var _sheet_at := {}
var _dim_level_at := Vector2i.ZERO
var _files := {}
var _entries := {}
var _shelf := Vector2i.ZERO
var _shelf_high := 0


func _init(licensed_dir: String, dim: float) -> void:
	dir = licensed_dir.replace("\\", "/")
	light_dim = clampf(dim, 0.35, 1.0)
	_atlas = Image.create(ATLAS_WIDE, ATLAS_HIGH, false, Image.FORMAT_RGBA8)
	var x := 0
	found = true
	for sheet in [LEVEL, ASSETS, DOORS]:
		var image := _file(sheet)
		if image == null or image.get_width() < 1024 or image.get_height() < 1024:
			found = false
			break
		_atlas.blit_rect(image, Rect2i(0, 0, 1024, 1024), Vector2i(x, 0))
		_sheet_at[sheet] = Vector2i(x, 0)
		x += 1024
	if found:
		var level: Image = _files[LEVEL]
		tops.dark = level.get_pixel(96, 128 + 3)
		tops.light = level.get_pixel(96, 5 * 128 + 3)
		# The Light look's floors, walls, low walls and stairs (rows 4 to 7 of the level sheet), toned down.
		var light := level.get_region(Rect2i(0, 4 * 128, 1024, 4 * 128))
		_tone_down(light)
		_dim_level_at = Vector2i(x, 0)
		_atlas.blit_rect(light, Rect2i(0, 0, 1024, 512), _dim_level_at)
	# The white spot, with room round it so no neighbour bleeds into it.
	var spot := Vector2i(3072, 520)
	_atlas.fill_rect(Rect2i(spot, Vector2i(16, 16)), Color.WHITE)
	white = Vector2(spot) + Vector2(8, 8)
	_shelf = Vector2i(0, 1024 + PAD)


func _file(src: String) -> Image:
	if _files.has(src):
		return _files[src]
	var path := dir.path_join(src)
	var image: Image = null
	if FileAccess.file_exists(path):
		image = Image.load_from_file(path)
		if image != null and image.get_format() != Image.FORMAT_RGBA8:
			image.convert(Image.FORMAT_RGBA8)
	if image == null:
		missing.append(src)
	_files[src] = image
	return image


func _tone_down(image: Image) -> void:
	if light_dim < 0.995:
		# As the browser view does it: brightness(dim) saturate(0.45 + dim * 0.55).
		image.adjust_bcs(light_dim, 1.0, 0.45 + light_dim * 0.55)


## Where a cell of the level sheet is on the atlas, in the look asked for (the Light look toned down).
func level_cell(cx: int, cy: int, look := "dark") -> Vector2:
	if look == "light" and cy >= 4 and light_dim < 0.995:
		return Vector2(_dim_level_at) + Vector2(cx * 128, (cy - 4) * 128)
	return Vector2(_sheet_at[LEVEL]) + Vector2(cx * 128, cy * 128)


func doors_cell(cx: int, cy: int) -> Vector2:
	return Vector2(_sheet_at[DOORS]) + Vector2(cx * 128, cy * 128)


## A picture the game named ({ src, rect, steel, look }), ready to draw: where it is on the atlas ("at"), its size
## ("w", "h"), and the box its solid pixels fill ("x0", "y0", "x1", "y1"). Empty if the file isn't in the folder.
func want(picture: Variant) -> Dictionary:
	if typeof(picture) != TYPE_DICTIONARY or not picture.has("src"):
		return {}
	var src: String = picture.src
	var steel: bool = picture.get("steel", false)
	var dim: bool = picture.get("look", "") == "light" and light_dim < 0.995
	var rect := Rect2i()
	if picture.has("rect"):
		rect = Rect2i(int(picture.rect[0]), int(picture.rect[1]), int(picture.rect[2]), int(picture.rect[3]))
	var key := "%s|%s|%s|%s" % [src, rect, steel, dim]
	if _entries.has(key):
		return _entries[key]
	var entry := {}
	var image := _file(src)
	if image != null:
		if rect.size.x == 0:
			rect = Rect2i(0, 0, image.get_width(), image.get_height())
		rect = rect.intersection(Rect2i(0, 0, image.get_width(), image.get_height()))
		var own := image.get_region(rect)
		var box := _solid_box(own)
		if not box.is_empty():
			var at := Vector2i.ZERO
			if _sheet_at.has(src) and not steel and not dim:
				at = _sheet_at[src] + rect.position
			else:
				if steel:
					_in_steel(own)
				if dim:
					_tone_down(own)
				at = _place(own)
			if at.x >= 0:
				entry = box
				entry["at"] = Vector2(at)
				entry["w"] = rect.size.x
				entry["h"] = rect.size.y
				entry["image"] = own
	_entries[key] = entry
	return entry


## Which way a flat thing's picture leans: "s" if its top runs down to the right, as on a wall seen from the room below
## it on the plan, "e" if it runs down to the left, "" if it does neither (slantOf in public/pixel-art.js).
func slant(entry: Dictionary) -> String:
	if entry.has("slant"):
		return entry.slant
	var out := ""
	var image: Image = entry.image
	var wide: int = entry.x1 - entry.x0 + 1
	if wide >= 6:
		var data := image.get_data()
		var w := image.get_width()
		var third := maxi(1, wide / 3)
		var left := _top(data, w, entry, entry.x0, entry.x0 + third - 1)
		var right := _top(data, w, entry, entry.x1 - third + 1, entry.x1)
		if absi(left - right) >= 3:
			out = "s" if left < right else "e"
	entry["slant"] = out
	return out


static func _top(data: PackedByteArray, w: int, box: Dictionary, from: int, to: int) -> int:
	var best := 1 << 30
	for x in range(from, to + 1):
		var y: int = box.y0
		while y <= box.y1 and y < best:
			if data[(y * w + x) * 4 + 3] >= 250:
				best = y
			y += 1
	return best


## Puts a picture on the next free stretch of the atlas. (-1, -1) if there's no room left.
func _place(image: Image) -> Vector2i:
	var size := image.get_size()
	if _shelf.x + size.x + PAD > ATLAS_WIDE:
		_shelf = Vector2i(0, _shelf.y + _shelf_high + PAD)
		_shelf_high = 0
	if _shelf.y + size.y + PAD > ATLAS_HIGH or size.x + PAD > ATLAS_WIDE:
		missing.append("(no room left on the atlas)")
		return Vector2i(-1, -1)
	var at := _shelf
	_atlas.blit_rect(image, Rect2i(Vector2i.ZERO, size), at)
	_shelf.x += size.x + PAD
	_shelf_high = maxi(_shelf_high, size.y)
	return at


## The box the solid pixels of a picture fill. The second pack draws a soft shadow under its pieces, half see-through,
## which isn't part of the piece: only pixels that are all but solid count (solidBox in public/pixel-art.js).
static func _solid_box(image: Image) -> Dictionary:
	var used := image.get_used_rect()
	if used.size.x <= 0 or used.size.y <= 0:
		return {}
	var data := image.get_data()
	var w := image.get_width()
	var x0 := used.position.x
	var y0 := used.position.y
	var x1 := used.end.x - 1
	var y1 := used.end.y - 1
	while y0 <= y1 and not _solid_in_row(data, w, y0, x0, x1):
		y0 += 1
	while y1 >= y0 and not _solid_in_row(data, w, y1, x0, x1):
		y1 -= 1
	if y0 > y1:
		return {}
	while x0 <= x1 and not _solid_in_column(data, w, x0, y0, y1):
		x0 += 1
	while x1 >= x0 and not _solid_in_column(data, w, x1, y0, y1):
		x1 -= 1
	return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}


static func _solid_in_row(data: PackedByteArray, w: int, y: int, x0: int, x1: int) -> bool:
	var i := (y * w + x0) * 4 + 3
	for x in range(x0, x1 + 1):
		if data[i] >= 250:
			return true
		i += 4
	return false


static func _solid_in_column(data: PackedByteArray, w: int, x: int, y0: int, y1: int) -> bool:
	var i := (y0 * w + x) * 4 + 3
	for y in range(y0, y1 + 1):
		if data[i] >= 250:
			return true
		i += w * 4
	return false


## Wood and orange turned to worn steel (steelOf in public/pixel-art.js): a colour between red-orange and yellow-brown,
## strong enough to be one, keeps how light it is, a little darkened, and takes the ship's blue-grey.
static func _in_steel(image: Image) -> void:
	var data := image.get_data()
	var n := data.size()
	var i := 0
	while i < n:
		var r := data[i]
		var g := data[i + 1]
		var b := data[i + 2]
		# Only a colour with red the most and blue the least can be between those two.
		if data[i + 3] != 0 and r > g and g > b:
			var light := (r + b) / 510.0
			if light >= 0.1 and light <= 0.93:
				var spread := float(r - b)
				var strong := spread / 255.0 / (1.0 - absf(2.0 * light - 1.0))
				var hue := (g - b) / spread * 60.0
				if strong >= 0.25 and hue >= 8.0 and hue <= 50.0:
					var s := 0.1 + 0.12 * minf(1.0, strong)
					var l := light * 0.86
					var c := (1.0 - absf(2.0 * l - 1.0)) * s
					# The ship's blue-grey, at 208 degrees round the colours.
					var x := c * (1.0 - absf(fmod(208.0 / 60.0, 2.0) - 1.0))
					var m := l - c / 2.0
					data[i] = int(round(clampf(m, 0, 1) * 255.0))
					data[i + 1] = int(round(clampf(x + m, 0, 1) * 255.0))
					data[i + 2] = int(round(clampf(c + m, 0, 1) * 255.0))
		i += 4
	image.set_data(image.get_width(), image.get_height(), false, Image.FORMAT_RGBA8, data)


## The atlas as the picture everything is drawn from. Called once every picture has been asked for.
func finish() -> void:
	var high := 1024 + PAD
	if _shelf.y + _shelf_high + PAD > high:
		high = _shelf.y + _shelf_high + PAD
	high = mini(ATLAS_HIGH, int(ceil(high / 256.0)) * 256)
	var image := _atlas.get_region(Rect2i(0, 0, ATLAS_WIDE, high))
	_atlas = image
	# So that the edges of the pictures don't go dark where they're drawn smaller than they are.
	image.fix_alpha_edges()
	image.generate_mipmaps()
	texture = ImageTexture.create_from_image(image)


func size() -> Vector2:
	return Vector2(_atlas.get_size())
