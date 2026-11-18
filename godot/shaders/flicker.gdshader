// What flickers by itself on a deck, drawn as one mesh: the burning heart of an engine, the stars beyond the hull, and
// the little lights on the consoles. Each corner says which it is (UV.y: 0, 1 or 2) and its own seed (UV.x), so each
// keeps its own time, as in the browser view (drawGlows, drawSparks and drawLights in public/iso.js).
shader_type canvas_item;

uniform vec3 fire_low = vec3(0.5, 0.3, 0.15);
uniform vec3 fire_high = vec3(1.0, 0.7, 0.4);
uniform float still = 0.0;

varying float seed;
varying float what;
varying vec4 tone;

void vertex() {
	seed = UV.x;
	what = UV.y;
	tone = COLOR;
}

void fragment() {
	float ms = TIME * 1000.0 * (1.0 - still);
	if (what < 0.5) {
		float f = 0.5 + 0.5 * sin(ms / (240.0 + seed * 420.0) + seed * 30.0);
		COLOR = vec4(mix(fire_low, fire_high, f), 1.0);
	} else if (what < 1.5) {
		COLOR = vec4(tone.rgb, tone.a * (0.45 + 0.55 * abs(sin(ms / 1400.0 + seed * 30.0))));
	} else {
		COLOR = vec4(tone.rgb, tone.a * (0.3 + 0.7 * abs(sin(ms / (500.0 + seed * 1500.0) + seed * 20.0))));
	}
}
