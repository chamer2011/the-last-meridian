// The old monitor over the Keelworks desktop. In the browser this is faked with stripes and gradients
// (desktop.css: .fx.scan, .fx.vig, .fx.glare, .fx.band); here the glass itself is bent and lit.
shader_type canvas_item;

uniform float curve = 0.0;     // how much the glass bulges
uniform float scan = 0.0;      // scanline darkness
uniform float vig = 0.0;       // dark edges
uniform float glare = 0.0;     // the light on the glass, top left
uniform float chroma = 0.0;    // red and blue fringes (heavy only)
uniform float flicker = 0.0;   // a slow flicker (heavy only)
uniform float band = 0.0;      // a bright band rolling down (heavy only)

void fragment() {
	vec2 cc = UV - 0.5;
	float d = dot(cc, cc);
	vec2 uv = 0.5 + cc * (1.0 + curve * d * 2.0);

	vec3 col;
	if (chroma > 0.0) {
		col.r = texture(TEXTURE, uv + vec2(chroma, 0.0)).r;
		col.g = texture(TEXTURE, uv).g;
		col.b = texture(TEXTURE, uv - vec2(chroma, 0.0)).b;
	} else {
		col = texture(TEXTURE, uv).rgb;
	}

	// 240 lines, one for every two of the desktop's 480.
	float s = 0.5 + 0.5 * sin(uv.y * 480.0 * 3.14159);
	col *= 1.0 - scan * (1.0 - s);

	col *= 1.0 - vig * smoothstep(0.18, 0.62, length(cc * vec2(1.0, 0.92)));
	col += glare * (1.0 - smoothstep(0.0, 0.45, distance(uv, vec2(0.28, 0.18))));
	col *= 1.0 - flicker * 0.05 * (0.5 + 0.5 * sin(TIME * 21.0));
	float pos = fract(TIME / 7.0) * 1.3 - 0.15;
	col += band * 0.045 * (1.0 - smoothstep(0.0, 0.12, abs(uv.y - pos)));

	// Off the bent glass is black, with soft rounded corners.
	vec2 edge = abs(uv - 0.5) - (0.5 - 0.03);
	float corner = length(max(edge, 0.0)) - 0.03;
	float inside = 1.0 - smoothstep(-0.004, 0.0, corner);
	COLOR = vec4(col * inside, 1.0);
}
