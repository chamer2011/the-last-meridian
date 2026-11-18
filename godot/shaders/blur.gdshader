// Softens the picture of a deck's shadows and worn ways (deck_view.gd): the browser view blurs them the same way
// before laying them on the floor. Done once for a deck, on a small picture, and kept.
shader_type canvas_item;

uniform sampler2D source : filter_linear, repeat_disable;
uniform vec2 pixel = vec2(0.001, 0.001);
// How far the blur reaches, in pixels of the small picture.
uniform float spread = 2.2;

void fragment() {
	vec3 sum = vec3(0.0);
	float total = 0.0;
	for (int y = -4; y <= 4; y++) {
		for (int x = -4; x <= 4; x++) {
			float weight = exp(-float(x * x + y * y) / (2.0 * spread * spread));
			sum += texture(source, UV + vec2(float(x), float(y)) * pixel).rgb * weight;
			total += weight;
		}
	}
	COLOR = vec4(sum / total, 1.0);
}
