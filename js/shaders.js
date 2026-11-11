// Fragment shaders for every Still Channel scene. All original, written for this app.
// Each body defines `vec3 scene(vec2 s, float t)` where s is screen uv with y pointing down.

const HEAD = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform sampler2D uTex;
uniform float uFocus;

float rnd(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float rnd1(float p) { return fract(sin(p * 91.3458) * 47453.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rnd(i), rnd(i + vec2(1.0, 0.0)), f.x),
             mix(rnd(i + vec2(0.0, 1.0)), rnd(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float box(vec2 p, vec2 a, vec2 b, float e) {
  vec2 m = smoothstep(a - e, a + e, p) * (1.0 - smoothstep(b - e, b + e, p));
  return m.x * m.y;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 centered(vec2 s) { return vec2((s.x - 0.5) * uRes.x / uRes.y, 0.5 - s.y); }

// Cover-fit mapping into a 16:9 painting with a slow drift so stills never sit dead.
vec2 imageUV(vec2 s, float t) {
  float A = 16.0 / 9.0;
  float a = uRes.x / uRes.y;
  vec2 span = (a > A ? vec2(1.0, A / a) : vec2(a / A, 1.0)) * 0.955;
  vec2 room = 0.5 * (1.0 - span);
  vec2 c = vec2(uFocus, 0.5) + vec2(sin(t * 0.045) * min(room.x, 0.09), sin(t * 0.031 + 1.0) * room.y);
  c = clamp(c, span * 0.5, 1.0 - span * 0.5);
  return c + (s - 0.5) * span;
}

// Wet glass: sliding drops with trails plus beads that slowly evaporate.
// Returns xy = refraction offset, z = how clear the glass is at this point.
vec3 rainGlass(vec2 p, float t, float scale) {
  vec2 g = p * scale * 2.6;
  vec2 gi = floor(g);
  vec2 gf = fract(g) - 0.5;
  float r1 = rnd(gi), r2 = rnd(gi + 7.31);
  float life = fract(t * 0.035 * (0.5 + r1) + r2);
  float rad = (0.06 + 0.2 * r1 * r1) * smoothstep(0.0, 0.08, life) * (1.0 - life);
  vec2 bd = gf - (vec2(r2, rnd(gi + 3.7)) - 0.5) * 0.55;
  float bead = smoothstep(rad, rad * 0.45, length(bd)) * step(0.3, r2);
  vec3 acc = vec3(bd * bead * 1.6, bead);

  vec2 asp = vec2(1.0, 0.3);
  vec2 st = p * scale * asp;
  float col = floor(st.x);
  st.y -= t * (0.1 + 0.13 * rnd(vec2(col, 3.0)));
  st.y += rnd(vec2(col, 1.0)) * 17.0;
  vec2 id = vec2(col, floor(st.y));
  vec2 f = fract(st) - 0.5;
  float n = rnd(id);
  float ph = t * 0.55 + n * 6.2831;
  float x = (n - 0.5) * 0.5 + sin(p.y * scale * 5.0 + n * 6.2831) * 0.06;
  float y = 0.3 * sin(ph + sin(ph) * 0.8);
  vec2 d = (f - vec2(x, y)) / asp;
  float live = step(0.45, n);
  float drop = smoothstep(0.17, 0.07, length(d * vec2(1.0, 0.8))) * live;
  float trail = smoothstep(0.075, 0.02, abs(d.x)) * smoothstep(0.02, -0.1, d.y) * smoothstep(-1.5, -0.2, d.y) * live;
  float beads = smoothstep(0.4, 0.15, abs(fract(p.y * scale * 3.3) - 0.5));
  acc.xy += d * drop * 1.2 + vec2(d.x * 3.0, 0.0) * trail * beads * 0.4;
  acc.z = max(acc.z, max(drop, trail * (0.45 + 0.4 * beads)));
  return acc;
}

// Drifting glow specks: dust, fireflies, embers. Returns intensity.
float specks(vec2 p, float t, float density, float size, float wander) {
  vec2 g = p * density;
  vec2 gi = floor(g);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = gi + vec2(float(i), float(j));
      float a = rnd(c), b = rnd(c + 19.19);
      vec2 o = vec2(a, b) + wander * vec2(sin(t * (0.3 + a) + b * 40.0), cos(t * (0.25 + b) + a * 40.0));
      float dd = length(g - c - o);
      float blink = 0.5 + 0.5 * sin(t * (0.6 + 1.7 * b) + a * 60.0);
      acc += exp(-dd * dd / (size * size)) * blink * blink * step(0.4, a);
    }
  }
  return acc;
}

vec3 finish(vec3 c, vec2 s) {
  vec2 q = s - 0.5;
  c *= 1.0 - dot(q, q) * 0.5;
  c += (rnd(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.024;
  return clamp(c, 0.0, 1.0);
}
`;

const TAIL = `
void main() {
  vec2 s = gl_FragCoord.xy / uRes;
  s.y = 1.0 - s.y;
  gl_FragColor = vec4(finish(scene(s, uTime), s), 1.0);
}
`;

const BODIES = {
  "lofi-desk": `
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  float W = box(uv, vec2(0.004, 0.092), vec2(0.406, 0.65), 0.005);
  vec3 d = rainGlass(ap, t, 11.0);
  vec3 c = texture2D(uTex, uv - d.xy * 0.016 * W, W * (1.0 - d.z) * 2.2).rgb;
  float warm = smoothstep(0.04, 0.3, c.r - c.b);
  float lum = luma(c);

  vec2 cell = floor(uv * vec2(192.0, 108.0));
  float tw = step(0.8, rnd(cell)) * (0.5 + 0.5 * sin(t * (0.4 + rnd(cell + 3.0) * 1.6) + rnd(cell) * 40.0));
  c += c * W * warm * tw * 1.1;
  c += W * d.z * vec3(0.07, 0.09, 0.16) * 0.5;
  c = mix(c, c * vec3(0.86, 0.9, 1.08), W * (1.0 - d.z) * 0.5);

  float fl = vnoise(vec2(t * 1.1, 2.0)) * 0.7 + vnoise(vec2(t * 4.3, 9.0)) * 0.3;
  vec2 lp = ap - vec2(0.79, 0.5) * vec2(1.7778, 1.0);
  float lamp = exp(-dot(lp, lp) * 14.0);
  c *= 1.0 + (1.0 - W) * warm * (fl - 0.5) * 0.2;
  c += vec3(1.0, 0.6, 0.24) * lamp * (0.03 + 0.07 * fl);

  float bulbs = smoothstep(0.2, 0.03, uv.y) * smoothstep(0.45, 0.85, lum) * warm;
  c += c * bulbs * 0.6 * sin(t * 1.2 + uv.x * 46.0);

  vec2 sp = ap - vec2(0.628, 0.52) * vec2(1.7778, 1.0);
  float col = exp(-sp.x * sp.x * 260.0) * smoothstep(0.06, -0.02, sp.y) * smoothstep(-0.2, -0.06, sp.y);
  float wisp = fbm(vec2(sp.x * 16.0 + sin(sp.y * 20.0 - t * 0.7) * 0.7, sp.y * 9.0 + t * 0.45));
  c += vec3(0.7, 0.76, 0.9) * col * wisp * 0.3;

  float cone = exp(-dot(lp - vec2(-0.12, 0.14), lp - vec2(-0.12, 0.14)) * 9.0);
  c += vec3(1.0, 0.75, 0.45) * specks(ap + vec2(t * 0.004, -t * 0.006), t, 26.0, 0.07, 0.3) * cone * 0.5;
  return c;
}`,

  "rain-window": `
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  float G = box(uv, vec2(0.097, 0.03), vec2(0.938, 0.826), 0.004);
  float sky = G * smoothstep(0.5, 0.2, uv.y);
  vec2 wuv = uv + sky * 0.012 * vec2(fbm3(ap * 3.0 + vec2(t * 0.03, 0.0)) - 0.5, fbm3(ap * 3.0 + vec2(7.0, t * 0.02)) - 0.5);
  vec3 d = rainGlass(ap, t, 9.0);
  vec3 c = texture2D(uTex, wuv - d.xy * 0.018 * d.z * G, G * (1.0 - d.z) * 1.15).rgb;
  float warm = smoothstep(0.05, 0.3, c.r - c.b);

  vec2 cell = floor(uv * vec2(240.0, 135.0));
  float tw = step(0.78, rnd(cell)) * (0.5 + 0.5 * sin(t * (0.3 + rnd(cell + 3.0) * 1.4) + rnd(cell) * 40.0));
  c += c * G * warm * tw * 0.9;

  float seed = floor(t / 13.0);
  float lt = fract(t / 13.0) * 13.0;
  float flash = (exp(-lt * 5.0) + 0.6 * exp(-abs(lt - 0.35) * 14.0)) * step(0.45, rnd1(seed));
  float cloud = fbm(ap * 2.2 + seed * 3.7);
  c += sky * flash * vec3(0.55, 0.62, 0.9) * smoothstep(0.35, 0.8, cloud) * 0.55;

  float glint = exp(-dot(d.xy + vec2(0.02, -0.03), d.xy + vec2(0.02, -0.03)) * 420.0) * smoothstep(0.25, 0.85, d.z);
  c += G * glint * vec3(0.85, 0.92, 1.0) * 0.9;
  float colf = floor(ap.x * 13.0);
  float sy = fract(ap.y * 0.85 - t * (0.07 + 0.05 * rnd(vec2(colf, 1.0))) + rnd(vec2(colf, 2.0)) * 6.0);
  float streak = smoothstep(0.035, 0.0, abs(fract(ap.x * 13.0) - 0.5)) * smoothstep(0.0, 0.18, sy) * smoothstep(0.92, 0.4, sy);
  streak *= step(0.55, rnd(vec2(colf, 4.0)));
  c += G * streak * vec3(0.62, 0.72, 0.86) * 0.22;

  float fl = vnoise(vec2(t * 2.3, 4.0)) * 0.65 + vnoise(vec2(t * 7.0, 1.0)) * 0.35;
  vec2 cp = ap - vec2(0.234, 0.815) * vec2(1.7778, 1.0);
  c += vec3(1.0, 0.55, 0.2) * exp(-dot(cp, cp) * 30.0) * (0.05 + 0.12 * fl) * (1.0 - G * 0.6);
  c *= 1.0 + (1.0 - G) * warm * (fl - 0.5) * 0.35;
  return c;
}`,

  "neon-rain": `
float streaks(vec2 p, float t, float cols, float len, float speed) {
  p.x += p.y * 0.07;
  float c = floor(p.x * cols);
  float fx = fract(p.x * cols) - 0.5;
  float y = p.y * len - t * speed * (0.75 + 0.5 * rnd(vec2(c, 1.0))) + rnd(vec2(c, 2.0)) * 31.0;
  float seg = fract(y);
  float on = step(0.55, rnd(vec2(c, floor(y))));
  return smoothstep(0.22, 0.0, abs(fx)) * smoothstep(0.0, 0.1, seg) * smoothstep(0.65, 0.3, seg) * on;
}
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  float street = smoothstep(0.6, 0.72, uv.y);
  float depth = (uv.y - 0.6) * 2.5;
  vec2 ruv = uv;
  ruv.x += street * (sin(uv.y * 240.0 / (0.4 + depth) + t * 2.6) * 0.0016 + (vnoise(vec2(uv.x * 30.0, uv.y * 80.0 - t * 1.4)) - 0.5) * 0.006);

  vec2 rg = vec2(ap.x * 9.0, (uv.y - 0.6) * 40.0);
  vec2 ri = floor(rg);
  vec2 rf = fract(rg) - 0.5;
  float rr = rnd(ri);
  float rt = fract(t * (0.5 + rr * 0.7) + rr * 9.0);
  vec2 rd = (rf - (vec2(rnd(ri + 5.0), rnd(ri + 9.0)) - 0.5) * 0.6) * vec2(1.0, 2.6);
  float ring = smoothstep(0.035, 0.0, abs(length(rd) - rt * 0.42)) * (1.0 - rt) * street;
  ruv += normalize(rd + 0.0001) * ring * 0.004;

  vec3 c = texture2D(uTex, ruv).rgb;
  float lum = luma(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float neon = smoothstep(0.35, 0.8, sat) * smoothstep(0.3, 0.7, lum);

  vec2 zone = floor(uv * vec2(7.0, 4.0));
  float zr = rnd(zone);
  float hum = 0.06 * sin(t * (5.0 + zr * 9.0) + zr * 30.0);
  float cut = step(0.93, rnd(vec2(floor(t * 9.0), zr * 17.0))) * step(0.72, zr);
  c *= 1.0 + neon * (1.0 - street) * (hum - cut * 0.55);
  c += c * neon * 0.12 * (0.5 + 0.5 * sin(t * 0.6 + uv.x * 5.0));
  c += ring * vec3(0.5, 0.55, 0.9) * 0.16 * (0.3 + lum * 2.0);

  vec2 s1 = ap - vec2(0.19, 0.66) * vec2(1.7778, 1.0);
  vec2 s2 = ap - vec2(0.775, 0.68) * vec2(1.7778, 1.0);
  float p1 = exp(-s1.x * s1.x * 22.0) * smoothstep(0.02, -0.12, s1.y) * smoothstep(-0.5, -0.1, s1.y);
  float p2 = exp(-s2.x * s2.x * 30.0) * smoothstep(0.02, -0.1, s2.y) * smoothstep(-0.42, -0.08, s2.y);
  float f1 = fbm(vec2(s1.x * 7.0 + sin(s1.y * 9.0 - t * 0.5) * 0.4, s1.y * 5.0 + t * 0.28));
  float f2 = fbm(vec2(s2.x * 8.0 + sin(s2.y * 9.0 - t * 0.6) * 0.4 + 5.0, s2.y * 5.0 + t * 0.33));
  c += vec3(0.75, 0.2, 0.95) * p1 * f1 * f1 * 0.7 + vec3(1.0, 0.4, 0.15) * p2 * f2 * f2 * 0.7;

  float haze = fbm3(vec2(ap.x * 2.0 - t * 0.03, uv.y * 6.0)) * smoothstep(0.75, 0.5, uv.y) * smoothstep(0.3, 0.55, uv.y);
  c += vec3(0.16, 0.12, 0.4) * haze * 0.3;

  float rain = streaks(ap, t, 46.0, 2.4, 3.6) * 0.55 + streaks(ap + 3.3, t, 90.0, 4.0, 4.6) * 0.38 + streaks(ap + 7.7, t, 150.0, 7.0, 5.4) * 0.22;
  c += rain * (vec3(0.5, 0.58, 0.85) * 0.3 + c * 0.9);
  return c;
}`,

  hearth: `
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  vec2 fc = vec2(0.573, 0.585);
  vec2 fp = (uv - fc) * vec2(1.7778, 1.0);
  float fmask = smoothstep(0.19, 0.04, length(fp * vec2(1.0, 0.8) + vec2(0.0, 0.03)));

  vec2 cat = uv - vec2(0.642, 0.83);
  float cm = exp(-dot(cat * vec2(1.0, 2.2), cat * vec2(1.0, 2.2)) * 260.0);
  vec2 wuv = uv;
  wuv.y += cm * sin(t * 1.15) * 0.0022;
  wuv.x += fmask * (vnoise(vec2(uv.x * 46.0, uv.y * 26.0 + t * 3.4)) - 0.5) * 0.011;
  wuv.y += fmask * (vnoise(vec2(uv.x * 30.0 + 9.0, uv.y * 18.0 + t * 2.6)) - 0.5) * 0.012;
  vec3 c = texture2D(uTex, wuv).rgb;

  float fl = vnoise(vec2(t * 2.1, 1.0)) * 0.55 + vnoise(vec2(t * 5.7, 6.0)) * 0.3 + vnoise(vec2(t * 13.0, 3.0)) * 0.15;
  float warm = smoothstep(0.03, 0.3, c.r - c.b);
  float reach = exp(-length(fp) * 1.6);
  c *= 1.0 + warm * (fl - 0.5) * (0.22 + 0.5 * reach);

  vec2 q = vec2(fp.x * 9.0, fp.y * 5.0 + t * 1.9);
  float tongue = fbm(q + vec2(sin(fp.y * 12.0 + t * 2.0) * 0.3, 0.0));
  float shape = smoothstep(0.1, 0.0, abs(fp.x) - 0.075 + (-fp.y) * 0.42) * smoothstep(0.035, -0.02, fp.y) * smoothstep(-0.2, -0.05, fp.y);
  float flame = smoothstep(0.42, 0.85, tongue + shape * 0.35) * shape;
  c += vec3(1.0, 0.5, 0.12) * flame * 0.55 + vec3(1.0, 0.9, 0.55) * flame * flame * 0.25;
  c += vec3(1.0, 0.42, 0.1) * exp(-dot(fp, fp) * 9.0) * (0.03 + 0.1 * fl);

  vec2 ep = vec2(fp.x * 30.0, fp.y * 12.0 + t * 1.3);
  vec2 ei = floor(ep);
  vec2 ef = fract(ep) - 0.5;
  float er = rnd(ei);
  float sway = sin(t * 2.0 + er * 30.0) * 0.25;
  float ember = exp(-dot(ef - vec2(sway, er - 0.5) * 0.6, ef - vec2(sway, er - 0.5) * 0.6) * 90.0) * step(0.8, er);
  ember *= smoothstep(0.09, 0.03, abs(fp.x)) * smoothstep(-0.26, -0.1, fp.y) * smoothstep(0.0, -0.05, fp.y);
  c += vec3(1.0, 0.6, 0.2) * ember * 1.3;

  float win = box(uv, vec2(0.066, 0.125), vec2(0.183, 0.405), 0.004);
  vec2 sn = vec2(ap.x * 60.0 + sin(uv.y * 30.0 + t) * 0.4, uv.y * 60.0 - t * 2.4);
  vec2 si = floor(sn);
  float flake = exp(-dot(fract(sn) - 0.5 - (vec2(rnd(si), rnd(si + 4.0)) - 0.5) * 0.6, fract(sn) - 0.5 - (vec2(rnd(si), rnd(si + 4.0)) - 0.5) * 0.6) * 55.0) * step(0.55, rnd(si + 8.0));
  vec2 sn2 = vec2(ap.x * 110.0 + sin(uv.y * 40.0 - t) * 0.4, uv.y * 110.0 - t * 3.4);
  float flake2 = exp(-dot(fract(sn2) - 0.5, fract(sn2) - 0.5) * 40.0) * step(0.7, rnd(floor(sn2)));
  c += win * (flake * 0.7 + flake2 * 0.35) * vec3(0.8, 0.88, 1.0);
  return c;
}`,

  forest: `
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  float canopy = smoothstep(0.45, 0.0, uv.y);
  vec2 wuv = uv + canopy * 0.0035 * vec2(vnoise(ap * 9.0 + t * 0.35) - 0.5, vnoise(ap * 9.0 + 20.0 - t * 0.3) - 0.5);
  float stream = exp(-pow((uv.x - mix(0.535, 0.47, smoothstep(0.66, 1.0, uv.y))) * 9.0, 2.0)) * smoothstep(0.66, 0.74, uv.y);
  wuv += stream * 0.006 * vec2(vnoise(vec2(uv.x * 50.0, uv.y * 30.0 - t * 1.6)) - 0.5, vnoise(vec2(uv.x * 40.0 + 7.0, uv.y * 30.0 - t * 1.3)) - 0.5);
  vec3 c = texture2D(uTex, wuv).rgb;
  float lum = luma(c);
  c += stream * vec3(0.5, 0.8, 0.9) * pow(vnoise(vec2(uv.x * 90.0, uv.y * 60.0 - t * 2.2)), 6.0) * 0.5;

  vec2 src = vec2(0.545, 0.2) * vec2(1.7778, 1.0);
  vec2 dv = ap - src;
  float ang = atan(dv.x, dv.y);
  float dist = length(dv);
  float rays = fbm(vec2(ang * 5.0 + t * 0.02, t * 0.05)) * 0.65 + fbm(vec2(ang * 13.0 - t * 0.03, 3.0)) * 0.35;
  rays = smoothstep(0.38, 0.8, rays) * smoothstep(1.3, 0.0, dist) * smoothstep(-0.1, 0.25, dv.y + 0.08) * exp(-abs(ang) * 0.9);
  c += vec3(1.0, 0.85, 0.5) * rays * 0.75 * (0.65 + 0.35 * sin(t * 0.17));
  c += vec3(1.0, 0.8, 0.5) * exp(-dist * dist * 9.0) * 0.1 * (1.0 + 0.3 * sin(t * 0.3));

  float fog = fbm(vec2(ap.x * 1.8 + t * 0.022, uv.y * 4.5 - t * 0.006));
  c = mix(c, vec3(0.55, 0.75, 0.74), smoothstep(0.42, 0.85, fog) * smoothstep(0.15, 0.45, uv.y) * smoothstep(0.9, 0.5, uv.y) * 0.32);

  float cool = smoothstep(0.08, 0.3, c.b - c.r) * smoothstep(0.45, 0.75, lum);
  float hot = smoothstep(0.15, 0.4, c.r - c.b) * smoothstep(0.5, 0.8, lum) * smoothstep(0.5, 0.6, uv.y);
  c += c * (cool * (0.35 * sin(t * 0.8 + uv.x * 20.0)) + hot * (0.3 * sin(t * 0.6 + uv.x * 14.0 + 2.0)));

  float ff = specks(ap + vec2(t * 0.005, 0.0), t * 0.7, 9.0, 0.045, 0.42) + specks(ap * 1.7 + 4.0, t * 0.5, 9.0, 0.035, 0.42) * 0.6;
  c += vec3(0.85, 1.0, 0.45) * ff * smoothstep(0.2, 0.5, uv.y) * 0.85;
  c += vec3(1.0, 0.95, 0.8) * specks(ap + vec2(0.0, t * 0.012), t, 30.0, 0.05, 0.3) * rays * 0.8;
  return c;
}`,

  cafe: `
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  vec2 ap = uv * vec2(1.7778, 1.0);
  float W = box(uv, vec2(0.0, 0.025), vec2(0.383, 0.705), 0.004);
  vec3 d = rainGlass(ap, t, 12.0);
  vec3 c = texture2D(uTex, uv - d.xy * 0.013 * W, W * (1.0 - d.z) * 1.6).rgb;
  float warm = smoothstep(0.05, 0.3, c.r - c.b);
  float lum = luma(c);
  float inside = 1.0 - W;

  c += W * d.z * vec3(0.08, 0.1, 0.16) * 0.4;
  c += c * W * warm * smoothstep(0.4, 0.8, lum) * 0.5 * sin(t * 0.9 + uv.x * 60.0 + uv.y * 40.0);

  float fl = vnoise(vec2(t * 0.9, 5.0)) * 0.7 + vnoise(vec2(t * 5.0, 2.0)) * 0.3;
  vec2 l1 = ap - vec2(0.735, 0.235) * vec2(1.7778, 1.0);
  vec2 l2 = ap - vec2(0.322, 0.285) * vec2(1.7778, 1.0);
  c += vec3(1.0, 0.62, 0.25) * (exp(-dot(l1, l1) * 10.0) * (0.04 + 0.07 * fl) + exp(-dot(l2, l2) * 30.0) * (0.03 + 0.05 * (1.0 - fl)));
  c *= 1.0 + inside * warm * (fl - 0.5) * 0.12;

  vec2 sp = ap - vec2(0.285, 0.735) * vec2(1.7778, 1.0);
  float col = exp(-sp.x * sp.x * 190.0) * smoothstep(0.0, -0.05, sp.y) * smoothstep(-0.3, -0.08, sp.y);
  float wisp = fbm(vec2(sp.x * 14.0 + sin(sp.y * 16.0 - t * 0.6) * 0.8, sp.y * 8.0 + t * 0.4));
  c += vec3(0.95, 0.85, 0.75) * col * wisp * wisp * 0.6;

  vec2 mp = ap - vec2(0.775, 0.5) * vec2(1.7778, 1.0);
  float puff = smoothstep(0.55, 1.0, sin(t * 0.21) * 0.5 + 0.5);
  float mcol = exp(-mp.x * mp.x * 60.0) * smoothstep(0.0, -0.06, mp.y) * smoothstep(-0.34, -0.1, mp.y);
  c += vec3(1.0, 0.92, 0.82) * mcol * pow(fbm(vec2(mp.x * 9.0, mp.y * 6.0 + t * 0.9)), 2.0) * puff * 0.5;

  c += vec3(1.0, 0.8, 0.55) * specks(ap + vec2(t * 0.003, t * 0.004), t, 24.0, 0.06, 0.3) * exp(-dot(l1 - vec2(0.0, 0.22), l1 - vec2(0.0, 0.22)) * 7.0) * 0.35;
  return c;
}`,

  "night-train": `
float trees(vec2 p, float t, float speed, float freq, float base, float amp) {
  float x = p.x * freq + t * speed;
  float h = base - amp * (0.35 * vnoise(vec2(x * 0.35, 1.0)) + 0.65 * pow(vnoise(vec2(x * 2.2, 4.0)), 1.6));
  return smoothstep(h - 0.004, h + 0.004, p.y);
}
vec3 scene(vec2 s, float t) {
  vec2 uv = imageUV(s, t);
  float bump = vnoise(vec2(t * 5.0, 0.0)) - 0.5;
  uv.y += sin(t * 9.4) * 0.0007 + bump * 0.0014;
  uv.x += sin(t * 0.8) * 0.0012;
  vec2 ap = uv * vec2(1.7778, 1.0);
  vec3 c = texture2D(uTex, uv).rgb;

  float W = box(uv, vec2(0.292, 0.212), vec2(0.672, 0.588), 0.006);
  float curtainL = smoothstep(0.286 + (uv.y - 0.2) * -0.05, 0.296 + (uv.y - 0.2) * -0.05, uv.x);
  W *= curtainL;
  W *= 1.0 - box(uv, vec2(0.392, 0.49), vec2(0.438, 0.7), 0.003);
  float blue = smoothstep(-0.02, 0.06, c.b - c.r);
  W *= blue;

  float star = smoothstep(0.34, 0.62, luma(c)) * smoothstep(0.42, 0.36, uv.y);
  c += W * c * star * 1.3 * sin(t * (1.2 + rnd(floor(uv * 300.0)) * 2.4) + rnd(floor(uv * 300.0)) * 50.0);

  float cl = fbm(vec2(ap.x * 2.6 + t * 0.05, uv.y * 9.0));
  c = mix(c, vec3(0.13, 0.17, 0.3), W * smoothstep(0.5, 0.85, cl) * smoothstep(0.5, 0.36, uv.y) * 0.5);

  float far = trees(uv, t, 0.22, 7.0, 0.565, 0.05);
  c = mix(c, vec3(0.02, 0.035, 0.07), W * far * 0.92);
  float near = trees(uv, t, 2.6, 10.0, 0.6, 0.075);
  c = mix(c, vec3(0.008, 0.012, 0.03), W * near);

  float lx = fract(uv.x * 1.3 + t * 0.085);
  float town = exp(-pow((lx - 0.5) * 14.0, 2.0));
  vec2 lg = vec2(uv.x * 90.0 + t * 6.0, uv.y * 160.0);
  float lights = step(0.86, rnd(floor(lg))) * exp(-dot(fract(lg) - 0.5, fract(lg) - 0.5) * 18.0);
  c += W * (1.0 - near) * lights * town * smoothstep(0.52, 0.56, uv.y) * vec3(1.0, 0.72, 0.4) * 1.3;

  float pole = fract(t * 0.42);
  float px = 0.72 - pole * 1.9;
  c = mix(c, vec3(0.0, 0.005, 0.015), W * smoothstep(0.006, 0.002, abs(uv.x - px - (uv.y - 0.4) * 0.03)) * 0.85);

  float pass = fract(t * 0.047);
  float sweep = exp(-pow((uv.x - (1.25 - pass * 9.0)) * 5.0, 2.0)) * step(pass, 0.2);
  c += (1.0 - W) * c * sweep * vec3(1.0, 0.8, 0.5) * 1.3;
  c += W * sweep * vec3(1.0, 0.8, 0.5) * 0.05;

  float fl = vnoise(vec2(t * 1.6, 8.0));
  vec2 lp = ap - vec2(0.818, 0.365) * vec2(1.7778, 1.0) - vec2(sin(t * 0.8) * 0.003, 0.0);
  c += vec3(1.0, 0.62, 0.25) * exp(-dot(lp, lp) * 16.0) * (0.04 + 0.05 * fl);
  c *= 1.0 + (1.0 - W) * smoothstep(0.05, 0.3, c.r - c.b) * (fl - 0.5) * 0.14;
  return c;
}`,

  synthwave: `
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  float hz = -0.02;
  float y = p.y - hz;
  vec3 col = mix(vec3(1.0, 0.22, 0.52), vec3(0.42, 0.05, 0.62), smoothstep(0.0, 0.3, y));
  col = mix(col, vec3(0.05, 0.01, 0.2), smoothstep(0.2, 0.62, y));
  col += vec3(1.0, 0.45, 0.2) * exp(-max(y, 0.0) * 14.0) * 0.55;

  vec2 sc = floor(p * 120.0);
  float tw = 0.5 + 0.5 * sin(t * (0.8 + rnd(sc + 1.0) * 2.5) + rnd(sc) * 30.0);
  col += step(0.988, rnd(sc)) * smoothstep(0.12, 0.45, y) * tw * exp(-dot(fract(p * 120.0) - 0.5, fract(p * 120.0) - 0.5) * 12.0) * 1.2;

  vec2 sp = p - vec2(0.0, hz + 0.19);
  float R = 0.265;
  float r = length(sp);
  float band = sp.y / R;
  float gap = mix(0.62, 0.0, smoothstep(-1.0, 0.25, band));
  float cut = step(fract(sp.y * 15.0 + t * 0.22), gap);
  float sun = smoothstep(R, R - 0.004, r) * (1.0 - cut);
  vec3 sunCol = mix(vec3(1.0, 0.1, 0.55), vec3(1.0, 0.92, 0.2), smoothstep(-0.9, 0.85, band));
  col += vec3(1.0, 0.25, 0.6) * exp(-max(r - R, 0.0) * 5.5) * 0.42;
  col = mix(col, sunCol, sun);

  float open = smoothstep(0.12, 0.75, abs(p.x));
  float m2 = hz + 0.02 + 0.3 * pow(fbm(vec2(p.x * 1.1 + 8.0, 2.0)), 1.4) * open;
  float m1 = hz + 0.01 + 0.2 * pow(fbm(vec2(p.x * 2.3 + 3.0, 1.0)), 1.3) * smoothstep(0.3, 1.0, abs(p.x));
  if (p.y < m2) {
    col = mix(vec3(0.16, 0.03, 0.34), vec3(0.42, 0.06, 0.5), smoothstep(m2 - 0.25, m2, p.y));
    col += vec3(1.0, 0.35, 0.8) * smoothstep(0.006, 0.0, m2 - p.y) * 0.9;
  }
  if (p.y < m1) {
    col = mix(vec3(0.05, 0.01, 0.16), vec3(0.14, 0.03, 0.34), smoothstep(m1 - 0.2, m1, p.y));
    float wire = smoothstep(0.06, 0.0, abs(fract(p.x * 14.0 + (m1 - p.y) * 9.0) - 0.5)) * 0.25;
    col += vec3(0.2, 0.9, 1.0) * (smoothstep(0.005, 0.0, m1 - p.y) + wire * smoothstep(m1 - 0.2, m1, p.y));
  }

  if (y < 0.0) {
    float z = 0.14 / (-y + 0.0008);
    float wx = p.x * z;
    float gx = abs(fract(wx * 5.0) - 0.5);
    float gz = abs(fract(z * 4.0 - t * 1.1) - 0.5);
    float lx = smoothstep(0.02 * z + 0.012, 0.0, gx);
    float lz = smoothstep(0.1 * z * z + 0.015, 0.0, gz);
    float fade = exp(-z * 0.2);
    vec3 floorCol = mix(vec3(0.03, 0.0, 0.1), vec3(0.3, 0.02, 0.38), fade * 0.35 + exp(y * 9.0) * 0.5);
    vec3 line = mix(vec3(0.1, 0.95, 1.0), vec3(1.0, 0.2, 0.85), smoothstep(0.3, 5.0, z));
    floorCol += line * max(lx, lz) * (0.15 + fade) * 0.9 + line * (lx + lz) * fade * 0.25;
    float mirror = exp(-abs(p.x) * (5.0 + 2.0 * sin(z * 3.0 - t * 2.0))) * exp(y * 3.0);
    floorCol += vec3(1.0, 0.5, 0.3) * mirror * 0.4;
    col = floorCol + vec3(1.0, 0.3, 0.7) * exp(y * 40.0) * 0.7;
  }
  col *= 0.94 + 0.06 * sin(gl_FragCoord.y * 1.6);
  return col;
}`,

  vaporwave: `
vec3 vsky(vec3 rd, float t) {
  float y = rd.y;
  vec3 c = mix(vec3(1.0, 0.66, 0.84), vec3(0.42, 0.86, 0.96), smoothstep(-0.02, 0.42, y));
  c = mix(c, vec3(0.46, 0.4, 0.96), smoothstep(0.36, 0.95, y));
  vec3 sd = normalize(vec3(0.0, 0.2, 1.0));
  float d = dot(rd, sd);
  float disc = smoothstep(0.981, 0.983, d);
  float slat = step(0.5, fract((rd.y - 0.2) * 34.0)) * smoothstep(0.24, 0.1, rd.y);
  vec3 sunc = mix(vec3(1.0, 0.42, 0.72), vec3(1.0, 0.96, 0.62), smoothstep(0.05, 0.36, rd.y));
  c = mix(c, sunc, disc * (1.0 - slat * 0.85));
  c += vec3(1.0, 0.7, 0.85) * pow(max(d, 0.0), 24.0) * 0.22;
  float cl = fbm(rd.xz / (rd.y + 0.35) * 1.5 + vec2(t * 0.012, 0.0));
  c = mix(c, vec3(1.0, 0.93, 0.98), smoothstep(0.5, 0.78, cl) * smoothstep(0.02, 0.3, y) * 0.75 * (1.0 - disc));
  return c;
}
float sph(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  return h < 0.0 ? -1.0 : -b - sqrt(h);
}
vec3 vfloor(vec3 pos, float t, vec3 c1, vec3 c2, vec3 c3) {
  float ch = mod(floor(pos.x * 0.8) + floor(pos.z * 0.8 + t * 0.35), 2.0);
  float dist = length(pos.xz);
  vec3 tile = mix(vec3(1.0, 0.5, 0.78), vec3(0.99, 0.95, 1.0), mix(0.5, ch, exp(-dist * 0.045)));
  float sh = 0.0;
  sh = max(sh, smoothstep(1.5, 0.3, length(pos.xz - c1.xz) / 0.95));
  sh = max(sh, smoothstep(1.5, 0.3, length(pos.xz - c2.xz) / 1.35));
  sh = max(sh, smoothstep(1.5, 0.3, length(pos.xz - c3.xz) / 0.6));
  return tile * (1.0 - sh * 0.38);
}
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  vec3 ro = vec3(0.0, 1.25, -4.5);
  vec3 rd = normalize(vec3(p.x, p.y + 0.04, 1.35));
  vec3 c1 = vec3(-2.7, 1.45 + 0.22 * sin(t * 0.5), 2.2);
  vec3 c2 = vec3(3.3, 2.0 + 0.3 * sin(t * 0.37 + 2.0), 4.6);
  vec3 c3 = vec3(1.25, 0.82 + 0.12 * sin(t * 0.7 + 4.0), -0.4);
  vec3 col = vsky(rd, t);
  float best = 1e5;
  if (rd.y < 0.0) {
    float tp = -ro.y / rd.y;
    vec3 pos = ro + rd * tp;
    vec3 fl = vfloor(pos, t, c1, c2, c3);
    vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
    fl = mix(fl, vsky(rr, t), 0.28);
    col = mix(fl, vsky(vec3(rd.x, 0.001, rd.z), t), smoothstep(12.0, 70.0, tp));
    best = tp;
  }
  for (int i = 0; i < 3; i++) {
    vec3 c = i == 0 ? c1 : (i == 1 ? c2 : c3);
    float r = i == 0 ? 0.95 : (i == 1 ? 1.35 : 0.6);
    float ts = sph(ro, rd, c, r);
    if (ts > 0.0 && ts < best) {
      best = ts;
      vec3 pos = ro + rd * ts;
      vec3 n = (pos - c) / r;
      vec3 rr = reflect(rd, n);
      vec3 env = vsky(rr, t);
      if (rr.y < 0.0) {
        vec3 fp = pos + rr * (-pos.y / rr.y);
        env = mix(vfloor(fp, t, c1, c2, c3), env, 0.25);
      }
      float fres = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
      vec3 tint = i == 0 ? vec3(0.62, 0.95, 1.0) : (i == 1 ? vec3(1.0, 0.72, 0.92) : vec3(1.0, 0.95, 0.7));
      col = env * mix(tint, vec3(1.0), fres) * (0.82 + 0.18 * n.y);
      col += pow(max(dot(rr, normalize(vec3(0.0, 0.2, 1.0))), 0.0), 60.0) * 0.6;
    }
  }
  col = pow(col, vec3(1.08));
  return col;
}`,

  "deep-space": `
float starLayer(vec2 p, float t, float scale, float thresh) {
  vec2 g = p * scale;
  vec2 gi = floor(g);
  vec2 gf = fract(g) - 0.5;
  float r = rnd(gi);
  vec2 o = (vec2(rnd(gi + 3.1), rnd(gi + 8.7)) - 0.5) * 0.7;
  float b = step(thresh, r) * (0.35 + 0.65 * rnd(gi + 1.7));
  float tw = 0.7 + 0.3 * sin(t * (0.5 + r * 2.0) + r * 80.0);
  return b * tw * exp(-dot(gf - o, gf - o) * 190.0);
}
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  float asp = uRes.x / uRes.y;
  vec2 q = p * 1.15 + vec2(t * 0.006, t * 0.0025);
  vec2 wq = q + 0.55 * vec2(fbm(q * 1.7 + 3.0 + t * 0.008), fbm(q * 1.7 + 11.0 - t * 0.006));
  float n1 = fbm(wq * 1.6);
  float n2 = fbm(wq * 2.7 + 20.0);
  float lanes = smoothstep(0.25, 0.65, fbm(wq * 3.6 + 40.0));
  vec3 col = vec3(0.012, 0.01, 0.04);
  col += vec3(0.75, 0.1, 0.62) * pow(n1, 3.0) * 2.6 * (0.35 + 0.65 * lanes);
  col += vec3(0.05, 0.5, 0.75) * pow(n2, 3.0) * 2.4;
  col += vec3(1.0, 0.55, 0.25) * pow(n1 * n2, 2.6) * 7.0;
  col += vec3(0.2, 0.12, 0.5) * n1 * 0.18;

  float st = starLayer(p + vec2(t * 0.002, 0.0), t, 34.0, 0.62) * 0.55
           + starLayer(p + vec2(t * 0.004, 5.0), t, 17.0, 0.7) * 0.9
           + starLayer(p + vec2(t * 0.007, 9.0), t, 7.0, 0.8) * 1.5;
  col += st * mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), rnd(floor(p * 17.0)));

  vec2 big = p - vec2(asp * 0.24, 0.3);
  float flare = exp(-abs(big.x) * 55.0) * exp(-abs(big.y) * 9.0) + exp(-abs(big.y) * 55.0) * exp(-abs(big.x) * 9.0);
  col += vec3(0.8, 0.9, 1.0) * (flare * 0.5 + exp(-length(big) * 30.0)) * (0.8 + 0.2 * sin(t * 1.3));

  vec2 pc = p - vec2(-asp * 0.5 + 0.05, -0.02);
  float R = 0.42;
  float pr = length(pc);
  if (pr < R) {
    vec3 n = vec3(pc / R, sqrt(max(1.0 - pr * pr / (R * R), 0.0)));
    vec3 L = normalize(vec3(0.75, 0.35, 0.35));
    float diff = smoothstep(-0.08, 0.7, dot(n, L));
    float lat = n.y * 6.0 + fbm(vec2(n.x * 2.0 + t * 0.012, n.y * 9.0)) * 1.6;
    vec3 bandc = mix(vec3(0.22, 0.12, 0.42), vec3(0.75, 0.42, 0.5), 0.5 + 0.5 * sin(lat * 2.2));
    bandc = mix(bandc, vec3(0.95, 0.75, 0.6), smoothstep(0.55, 0.9, vnoise(vec2(lat * 1.3, n.x * 2.0 + t * 0.01))) * 0.5);
    vec3 planet = bandc * diff * 0.95 + vec3(0.35, 0.3, 0.9) * pow(1.0 - n.z, 2.5) * diff * 0.9;
    col = mix(col, planet, smoothstep(R, R - 0.004, pr));
  }
  col += vec3(0.45, 0.4, 1.0) * exp(-max(pr - R, 0.0) * 26.0) * 0.32 * smoothstep(-0.2, 0.5, pc.x / R + 0.3) * step(R, pr);
  return col;
}`,

  ocean: `
vec3 osky(vec2 p, float t, float asp) {
  float y = max(p.y, 0.0);
  vec3 c = mix(vec3(1.0, 0.56, 0.3), vec3(0.6, 0.3, 0.48), smoothstep(0.0, 0.2, y));
  c = mix(c, vec3(0.13, 0.15, 0.36), smoothstep(0.12, 0.5, y));
  c = mix(c, vec3(0.03, 0.05, 0.16), smoothstep(0.4, 0.9, y));
  vec2 sp = p - vec2(asp * 0.14, 0.052);
  float r = length(sp);
  c += vec3(1.0, 0.75, 0.4) * smoothstep(0.05, 0.046, r);
  c += vec3(1.0, 0.5, 0.2) * exp(-r * 7.0) * 0.6 + vec3(1.0, 0.35, 0.25) * exp(-r * 2.2) * 0.2;
  float cl = fbm(vec2(p.x * 1.3 + t * 0.008, y * 7.0 + 3.0));
  float cm = smoothstep(0.45, 0.8, cl) * smoothstep(0.02, 0.14, y) * smoothstep(0.75, 0.3, y);
  vec3 lit = mix(vec3(1.0, 0.5, 0.35), vec3(0.3, 0.22, 0.42), smoothstep(0.05, 0.4, y));
  c = mix(c, lit, cm * 0.75);
  return c;
}
float owave(vec2 p, float t) {
  float h = 0.0, a = 0.55;
  vec2 sh = vec2(t * 0.35, t * 0.5);
  for (int i = 0; i < 4; i++) {
    h += a * (1.0 - abs(2.0 * vnoise(p + sh) - 1.0));
    p = mat2(1.5, 1.1, -1.1, 1.5) * p;
    sh *= 1.25;
    a *= 0.48;
  }
  return h;
}
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  float asp = uRes.x / uRes.y;
  float hz = 0.1;
  float y = p.y - hz;
  if (y >= 0.0) {
    vec3 c = osky(vec2(p.x, y), t, asp);
    vec2 sc = floor(p * 110.0);
    c += step(0.99, rnd(sc)) * smoothstep(0.3, 0.6, y) * 0.6 * (0.6 + 0.4 * sin(t + rnd(sc) * 40.0));
    return c;
  }
  float z = 0.22 / (-y + 0.0012);
  vec2 w = vec2(p.x * z, z) * 2.4;
  float e = 0.02 + z * 0.02;
  float h0 = owave(w, t);
  float hx = owave(w + vec2(e, 0.0), t);
  float hz2 = owave(w + vec2(0.0, e), t);
  float calm = 0.4 / (1.0 + z * 0.22);
  vec2 n = vec2(hx - h0, hz2 - h0) / e * calm;
  vec2 rp = vec2(p.x + n.x * 0.09, -y * (1.0 + n.y * 0.9) + 0.004 + abs(n.y) * 0.02);
  vec3 refl = osky(rp, t, asp);
  float fres = 0.5 + 0.5 * pow(1.0 - clamp(-y * 1.5, 0.0, 1.0), 3.0);
  vec3 deep = mix(vec3(0.01, 0.05, 0.1), vec3(0.03, 0.14, 0.2), h0 * 0.6);
  vec3 c = mix(deep, refl, fres);
  float glit = pow(max(1.0 - abs(p.x - asp * 0.14 + n.x * 0.35) * 3.0, 0.0), 5.0) * smoothstep(0.55, 1.0, h0 + n.y * 0.5);
  c += vec3(1.0, 0.72, 0.4) * glit * (0.35 + 0.5 * exp(y * 3.0));
  float foam = smoothstep(0.93, 1.02, h0) * smoothstep(1.6, 0.4, z);
  c += vec3(0.75, 0.82, 0.9) * foam * 0.25;
  c = mix(c, osky(vec2(p.x, 0.0), t, asp), exp(y * 55.0) * 0.8);
  return c;
}`,

  aurora: `
vec3 curtains(vec2 p, float t) {
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = p.x + 0.3 * fbm3(vec2(p.x * 0.8 + fi * 4.0, t * 0.02 + fi));
    float base = 0.02 + 0.09 * fi + 0.1 * sin(x * 1.7 + t * 0.045 + fi * 2.1) + 0.16 * (fbm3(vec2(x * 1.1 + fi * 7.0, t * 0.022)) - 0.5);
    float up = p.y - base;
    float ray = pow(fbm(vec2(x * 16.0 + fi * 3.0, t * 0.08)), 1.8) * 2.3;
    float body = smoothstep(-0.012, 0.012, up) * exp(-max(up, 0.0) * (2.4 + 3.0 * (1.0 - ray)));
    vec3 tint = mix(vec3(0.1, 1.0, 0.5), vec3(0.6, 0.2, 1.0), smoothstep(0.02, 0.4, up));
    tint = mix(tint, vec3(0.1, 0.8, 1.0), fi * 0.22);
    glow += tint * body * (0.25 + 0.75 * ray) * (0.75 - 0.15 * fi);
  }
  return glow;
}
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  vec3 col = mix(vec3(0.03, 0.08, 0.14), vec3(0.006, 0.012, 0.045), smoothstep(-0.1, 0.5, p.y));
  vec2 sc = floor(p * 130.0);
  vec2 sf = fract(p * 130.0) - 0.5;
  col += step(0.985, rnd(sc)) * exp(-dot(sf, sf) * 14.0) * (0.55 + 0.45 * sin(t * (0.5 + rnd(sc + 2.0) * 2.0) + rnd(sc) * 50.0)) * smoothstep(-0.05, 0.2, p.y);
  vec3 glow = curtains(p, t);
  col += glow;

  float lake = -0.3;
  float m2 = lake + 0.03 + 0.5 * pow(fbm(vec2(p.x * 1.3 + 4.0, 4.0)), 2.0);
  float m1 = lake + 0.01 + 0.22 * pow(fbm(vec2(p.x * 2.6 + 9.0, 9.0)), 1.6);
  vec3 sheen = vec3(0.1, 0.55, 0.4) * (0.6 + 0.4 * sin(t * 0.1));
  if (p.y < m2) {
    float cap = smoothstep(lake + 0.1, lake + 0.2, p.y + 0.06 * fbm(vec2(p.x * 14.0, 2.0)));
    col = mix(vec3(0.02, 0.045, 0.09), vec3(0.2, 0.34, 0.42) + sheen * 0.35, cap * (0.35 + 0.65 * fbm(vec2(p.x * 22.0, p.y * 30.0))));
  }
  if (p.y < m1) col = vec3(0.01, 0.022, 0.05) + sheen * 0.05 * smoothstep(m1 - 0.1, m1, p.y);
  if (p.y < lake) {
    float dy = lake - p.y;
    vec2 rp = vec2(p.x + (vnoise(vec2(p.x * 14.0, dy * 110.0 - t * 0.5)) - 0.5) * 0.03 * (0.3 + dy * 4.0), lake + dy * 1.25 + 0.3);
    vec3 r = curtains(rp, t) * 0.55 + vec3(0.02, 0.05, 0.09);
    float ripple = 0.75 + 0.25 * vnoise(vec2(p.x * 26.0, dy * 240.0 - t * 0.8));
    col = r * ripple * smoothstep(0.0, 0.03, dy + 0.02) + vec3(0.004, 0.012, 0.03);
  }
  return col;
}`,

  drift: `
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  vec2 q = p * 0.75;
  float n1 = fbm3(q + vec2(t * 0.011, t * 0.004));
  float n2 = fbm3(q * 1.3 + vec2(5.0 - t * 0.007, t * 0.009));
  float n3 = fbm3(q * 0.6 + vec2(n1, n2) * 0.8 + 9.0);
  vec3 col = mix(vec3(0.03, 0.07, 0.15), vec3(0.05, 0.36, 0.42), smoothstep(0.3, 0.7, n1));
  col = mix(col, vec3(0.42, 0.18, 0.5), smoothstep(0.4, 0.72, n2) * 0.8);
  col = mix(col, vec3(0.95, 0.55, 0.36), smoothstep(0.45, 0.75, n3) * 0.5);
  col += vec3(0.9, 0.7, 0.5) * exp(-length(p - vec2(0.25 * sin(t * 0.02), 0.12)) * 2.4) * 0.12;
  return col;
}`,

  haze: `
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  vec3 col = mix(vec3(0.99, 0.8, 0.66), vec3(0.42, 0.5, 0.66), smoothstep(-0.1, 0.5, p.y));
  vec2 sp = p - vec2(-0.32, 0.17);
  col += vec3(1.0, 0.85, 0.62) * (smoothstep(0.075, 0.068, length(sp)) * 0.5 + exp(-length(sp) * 3.2) * 0.35);
  float hi = fbm(vec2(p.x * 0.9 + t * 0.006, p.y * 5.0 + 20.0));
  col = mix(col, vec3(1.0, 0.9, 0.84), smoothstep(0.5, 0.8, hi) * smoothstep(0.1, 0.35, p.y) * 0.4);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float k = fi / 5.0;
    float base = 0.06 - 0.085 * fi;
    float h = base + (0.34 - 0.03 * fi) * (fbm(vec2(p.x * (0.9 + 0.5 * fi) + fi * 13.7 + t * 0.003 * (fi + 1.0), fi * 3.1)) - 0.42);
    vec3 rc = mix(vec3(0.66, 0.66, 0.76), vec3(0.11, 0.15, 0.25), k);
    float mist = fbm3(vec2(p.x * 2.0 - t * 0.012 * (1.0 + k), fi * 5.0 + p.y * 3.0));
    vec3 layer = mix(rc, mix(vec3(0.96, 0.8, 0.72), rc, 0.35 + 0.45 * k), smoothstep(h, h - 0.16, p.y) * (0.45 + 0.55 * mist));
    col = mix(col, layer, smoothstep(h + 0.002, h - 0.002, p.y));
  }
  return col;
}`,

  ember: `
float emberLayer(vec2 p, float t, float scale, float speed) {
  vec2 g = vec2(p.x * scale, p.y * scale * 0.6 - t * speed);
  vec2 gi = floor(g);
  vec2 gf = fract(g) - 0.5;
  float r = rnd(gi);
  vec2 o = vec2((rnd(gi + 2.3) - 0.5) * 0.6 + sin(t * (0.5 + r) + r * 40.0) * 0.16, (rnd(gi + 5.1) - 0.5) * 0.6);
  float fl = 0.6 + 0.4 * sin(t * (2.0 + r * 5.0) + r * 90.0);
  return exp(-dot(gf - o, gf - o) * 130.0) * step(0.62, r) * fl;
}
vec3 scene(vec2 s, float t) {
  vec2 p = centered(s);
  float breathe = 0.5 + 0.5 * sin(t * 0.23);
  vec3 col = mix(vec3(0.19, 0.055, 0.02), vec3(0.016, 0.01, 0.014), smoothstep(-0.55, 0.3, p.y));
  col += vec3(0.75, 0.2, 0.04) * exp(-(p.y + 0.5) * 5.0) * (0.3 + 0.16 * breathe) * (0.6 + 0.4 * fbm3(vec2(p.x * 2.0, t * 0.12)));
  float smoke = fbm(vec2(p.x * 1.6 + sin(p.y * 2.0 + t * 0.07) * 0.3, p.y * 1.2 - t * 0.035));
  col += vec3(0.1, 0.045, 0.03) * smoothstep(0.4, 0.85, smoke) * 0.55;
  float fade = smoothstep(0.55, -0.45, p.y);
  float e = emberLayer(p, t, 9.0, 0.24) + emberLayer(p + 3.0, t, 16.0, 0.34) * 0.7 + emberLayer(p + 7.0, t, 27.0, 0.48) * 0.45;
  col += mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.75, 0.3), fade) * e * fade * 1.5;
  return col;
}`,
};

export function fragmentSource(sceneId) {
  return HEAD + BODIES[sceneId] + TAIL;
}

export const VERTEX_SOURCE = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;
