## The game's colours and fonts, copied from public/style.css and public/desktop.css,
## and small helpers that build the game's console look out of Godot's own pieces.
class_name Pal
extends RefCounted

const MONO: Font = preload("res://fonts/CascadiaMono-Regular.ttf")
const MONO_BOLD: Font = preload("res://fonts/CascadiaMono-Bold.ttf")
const SCANLINES: Shader = preload("res://shaders/scanlines.gdshader")

# The page itself (:root in style.css).
const BG := Color("050a07")
const TEXT := Color("9df5b4")
const BRIGHT := Color("d6ffe2")
const MUTED := Color("5f9c75")
const LINE := Color("1f4a30")

# The console colours by kind, one set for every window that has them (style.css, data-theme).
const KINDS := {
	"gold":  ["f5d76e", "a3904b", "6c5f2e", "100d03", Color(30 / 255.0, 25 / 255.0, 7 / 255.0, 0.92), "fff7d6"],
	"teal":  ["76ecd2", "479985", "27695a", "03110e", Color(6 / 255.0, 30 / 255.0, 25 / 255.0, 0.92), "e3fff8"],
	"amber": ["ffc466", "a57f3e", "6e5426", "120c03", Color(32 / 255.0, 22 / 255.0, 6 / 255.0, 0.92), "fff0d4"],
	"red":   ["ff8f7f", "ad5a4e", "753a31", "140504", Color(36 / 255.0, 11 / 255.0, 8 / 255.0, 0.92), "ffe9e4"],
	"green": ["8df5ac", "4f9a68", "2a6a43", "03110a", Color(6 / 255.0, 30 / 255.0, 17 / 255.0, 0.92), "e6ffef"],
}


## A kind's colours: c (the main colour), dim, line, bg, panel, bright.
static func kind(name: String) -> Dictionary:
	var k: Array = KINDS[name]
	return {"c": Color(k[0]), "dim": Color(k[1]), "line": Color(k[2]), "bg": Color(k[3]), "panel": k[4], "bright": Color(k[5])}


## Someone's own colours, mixed from their colour the way style.css does it (.pop-speaker).
static func person(speaker: Color) -> Dictionary:
	var base := Color("030403")
	return {
		"c": speaker,
		"dim": speaker.lerp(Color.BLACK, 0.38),
		"line": speaker.lerp(Color.BLACK, 0.6),
		"bg": base.lerp(speaker, 0.07),
		"panel": base.lerp(speaker, 0.12),
		"bright": speaker.lerp(Color.WHITE, 0.75),
	}


static func box(bg: Color, border := Color(0, 0, 0, 0), width := 0, glow := Color(0, 0, 0, 0), glow_size := 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	if width > 0:
		s.border_color = border
		s.set_border_width_all(width)
	if glow_size > 0:
		s.shadow_color = glow
		s.shadow_size = glow_size
	return s


static func margins(s: StyleBox, h: float, v: float) -> StyleBox:
	s.content_margin_left = h
	s.content_margin_right = h
	s.content_margin_top = v
	s.content_margin_bottom = v
	return s


static func label(text: String, color: Color, size := 13, bold := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", color)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_font_override("font", MONO_BOLD if bold else MONO)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## A box of words with colours inside it, in BBCode ([color=#...]).
static func words(bbcode: String, color: Color, size := 13) -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	r.text = bbcode
	r.add_theme_color_override("default_color", color)
	r.add_theme_font_override("normal_font", MONO)
	r.add_theme_font_override("bold_font", MONO_BOLD)
	r.add_theme_font_size_override("normal_font_size", size)
	r.add_theme_font_size_override("bold_font_size", size)
	r.add_theme_constant_override("line_separation", 3)
	r.mouse_filter = Control.MOUSE_FILTER_PASS
	return r


## The game's buttons: [ LABEL ], turned inside out on hover.
static func bracket_button(text: String, fg: Color, bg: Color, size := 13) -> Button:
	var b := Button.new()
	b.text = "[ %s ]" % text
	b.flat = false
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", MONO)
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", fg)
	b.add_theme_color_override("font_hover_color", bg)
	b.add_theme_color_override("font_pressed_color", bg)
	b.add_theme_color_override("font_hover_pressed_color", bg)
	b.add_theme_stylebox_override("normal", margins(StyleBoxEmpty.new(), 2, 1))
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	b.add_theme_stylebox_override("hover", margins(box(fg), 2, 1))
	b.add_theme_stylebox_override("pressed", margins(box(fg), 2, 1))
	b.add_theme_stylebox_override("hover_pressed", margins(box(fg), 2, 1))
	return b


## The scanlines over a window. They don't catch clicks.
static func scanlines(strength := 0.16) -> ColorRect:
	var r := ColorRect.new()
	var m := ShaderMaterial.new()
	m.shader = SCANLINES
	m.set_shader_parameter("strength", strength)
	r.material = m
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.set_anchors_preset(Control.PRESET_FULL_RECT)
	return r


static func hex(c: Color) -> String:
	return "#" + c.to_html(false)
