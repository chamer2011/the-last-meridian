## The old monitor with the Keelworks desktop on its glass (desktop.css: .desk .monitor, .glass, .plate, .led).
## The desktop is drawn at 640 by 480 inside a SubViewport and scaled to the glass, as in the game; the glass is a shader.
class_name CrtDesk
extends Floaty

const CRT: Shader = preload("res://shaders/crt.gdshader")
const STRENGTHS := {
	"off":   {"curve": 0.0, "scan": 0.0, "vig": 0.0, "glare": 0.0, "chroma": 0.0, "flicker": 0.0, "band": 0.0},
	"light": {"curve": 0.05, "scan": 0.1, "vig": 0.45, "glare": 0.08, "chroma": 0.0, "flicker": 0.0, "band": 0.0},
	"heavy": {"curve": 0.11, "scan": 0.38, "vig": 0.6, "glare": 0.08, "chroma": 0.0016, "flicker": 1.0, "band": 1.0},
}

var width := 600.0
var monitor: PanelContainer
var glass: Control
var holder: SubViewportContainer
var viewport: SubViewport
var desktop: Keelworks
var _mat: ShaderMaterial
var _led: Control


func build(skin_name: String, strength: String) -> void:
	monitor = PanelContainer.new()
	var s := StyleBoxFlat.new()
	s.bg_color = Color("24282a")
	s.set_corner_radius_all(18)
	s.border_color = Color("3d423e")
	s.border_width_top = 2
	s.border_width_bottom = 3
	s.shadow_color = Color(0, 0, 0, 0.65)
	s.shadow_size = 24
	s.shadow_offset = Vector2(0, 12)
	s.content_margin_left = 18
	s.content_margin_right = 18
	s.content_margin_top = 18
	s.content_margin_bottom = 30
	monitor.add_theme_stylebox_override("panel", s)
	monitor.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(monitor)

	glass = Control.new()
	glass.clip_contents = true
	glass.mouse_filter = Control.MOUSE_FILTER_PASS
	monitor.add_child(glass)

	holder = SubViewportContainer.new()
	holder.stretch = false
	holder.size = Vector2(640, 480)
	_mat = ShaderMaterial.new()
	_mat.shader = CRT
	holder.material = _mat
	glass.add_child(holder)
	viewport = SubViewport.new()
	viewport.size = Vector2i(640, 480)
	viewport.handle_input_locally = true
	viewport.gui_disable_input = false
	holder.add_child(viewport)
	desktop = Keelworks.new()
	viewport.add_child(desktop)

	var plate := HBoxContainer.new()
	plate.add_theme_constant_override("separation", 10)
	plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_led = Control.new()
	_led.custom_minimum_size = Vector2(8, 8)
	_led.draw.connect(func():
		_led.draw_circle(Vector2(4, 4), 6, Color(0.235, 1, 0.48, 0.25))
		_led.draw_circle(Vector2(4, 4), 4, Color("3cff7a")))
	var plate_label := Pal.label("K E E L W O R K S   4 . 1", Color("6c736d"), 10, true)
	plate.add_child(plate_label)
	plate.add_child(_led)
	plate.name = "Plate"
	add_child(plate)

	set_skin(skin_name)
	set_strength(strength)


func set_skin(skin_name: String) -> void:
	desktop.build(skin_name)


func set_strength(strength: String) -> void:
	for k in STRENGTHS[strength]:
		_mat.set_shader_parameter(k, STRENGTHS[strength][k])


func _process(delta: float) -> void:
	super._process(delta)
	if monitor == null:
		return
	var glass_w := width - 36.0
	var glass_h := glass_w * 0.75
	glass.custom_minimum_size = Vector2(glass_w, glass_h)
	monitor.size = Vector2(width, glass_h + 48)
	holder.scale = Vector2.ONE * (glass_w / 640.0)
	var plate: Control = get_node("Plate")
	plate.size = plate.get_combined_minimum_size()
	plate.position = Vector2((width - plate.size.x) * 0.5, monitor.size.y - 20)
	size = monitor.size
