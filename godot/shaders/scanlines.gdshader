// The game's scanlines: a dark stripe two pixels high every four pixels, as in style.css
// (repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,.16) 2px 4px)).
shader_type canvas_item;

uniform float strength = 0.16;

void fragment() {
	float y = mod(FRAGCOORD.y, 4.0);
	COLOR = vec4(0.0, 0.0, 0.0, y >= 2.0 ? strength : 0.0);
}
