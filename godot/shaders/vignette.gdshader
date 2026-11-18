// The dark round the edges of the view (vignetteFor in public/iso.js): nothing out to 0.45 of the window's shorter
// side from its middle, then darkening to 0.3 at 0.72 of its longer side.
shader_type canvas_item;

uniform vec2 size = vec2(1400.0, 860.0);

void fragment() {
	float far = distance(UV * size, size * 0.5);
	float from = min(size.x, size.y) * 0.45;
	float to = max(size.x, size.y) * 0.72;
	COLOR = vec4(0.0, 0.0, 0.0, 0.3 * clamp((far - from) / (to - from), 0.0, 1.0));
}
