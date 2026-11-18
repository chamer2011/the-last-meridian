// Lays a deck's soft shadows and its worn ways over the floor in one stroke. The picture it's given has the shadows in
// its red and the ways people walk in its green; a way is a little paler than the floor, and a shadow darkens both.
shader_type canvas_item;
render_mode blend_premul_alpha;

uniform float shadow = 0.82;
uniform float worn = 0.09;

void fragment() {
	vec4 seen = texture(TEXTURE, UV);
	float s = shadow * seen.r;
	float w = worn * seen.g;
	COLOR = vec4(vec3(w * (1.0 - s)), 1.0 - (1.0 - w) * (1.0 - s));
}
