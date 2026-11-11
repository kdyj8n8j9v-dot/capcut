// Превью: кадр и цвет на WebGL. Те же шаги, порядок и числа, что в grade.py (сборщик): менять вместе.
export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
export const GRADE_DEFAULT = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temp: 0, tint: 0,
  saturation: 0, vibrance: 0, sharpness: 0, clarity: 0, vignette: 0, vig_mid: 0.5, vig_feather: 0.5,
  skin_smooth: 0, skin_tone: 0, skin_sat: 0, skin_light: 0,
};
const KEYS = Object.keys(GRADE_DEFAULT);
export const FRAME_DEFAULT = { scale: 1, x: 0, y: 0, rot: 0 };

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
// 1. кадр: точка итогового кадра → точка исходника (grade.frame_matrix), вне исходника — чёрный
const FS_FRAME = `precision highp float; varying vec2 v; uniform sampler2D tex;
uniform vec2 uOut, uSrc, uOff, uC; uniform float uS;
void main(){
  vec2 p = vec2(v.x, 1.-v.y)*uOut - 0.5*uOut - uOff;
  vec2 q = vec2(uC.x*p.x - uC.y*p.y, uC.y*p.x + uC.x*p.y)/uS;
  vec2 s = q/uSrc + 0.5;
  if (s.x<0.||s.y<0.||s.x>1.||s.y>1.) gl_FragColor = vec4(0.,0.,0.,1.);
  else gl_FragColor = vec4(texture2D(tex, s).rgb, 1.);
}`;
const FS_DOWN = `precision highp float; varying vec2 v; uniform sampler2D tex; uniform vec2 px;
void main(){ vec3 a = vec3(0.);
  for(int i=0;i<4;i++) for(int j=0;j<4;j++) a += texture2D(tex, v + (vec2(float(i),float(j))-1.5)*2.*px).rgb;
  gl_FragColor = vec4(a/16., 1.); }`;
const FS_BLUR = `precision highp float; varying vec2 v; uniform sampler2D tex; uniform vec2 dir; uniform float sigma;
void main(){ vec3 a = vec3(0.); float w = 0.;
  for(int i=-12;i<=12;i++){ float k = exp(-float(i*i)/(2.*sigma*sigma)); a += k*texture2D(tex, v + dir*float(i)).rgb; w += k; }
  gl_FragColor = vec4(a/w, 1.); }`;
const FS_GRADE = `precision highp float; varying vec2 v; uniform sampler2D tex, blur;
uniform float g[${KEYS.length}]; uniform vec3 hsl[8]; uniform float useHsl, aspect, sharpSigma; uniform vec2 px;
${KEYS.map((k, i) => `#define ${k.toUpperCase()} g[${i}]`).join("\n")}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 rgb2hsv(vec3 c){ float mx = max(c.r,max(c.g,c.b)), mn = min(c.r,min(c.g,c.b)), d = mx-mn, h = 0.;
  if (d > 1e-6) { if (mx == c.r) h = mod((c.g-c.b)/d, 6.); else if (mx == c.g) h = (c.b-c.r)/d + 2.; else h = (c.r-c.g)/d + 4.; h /= 6.; }
  return vec3(h, mx > 1e-6 ? d/mx : 0., mx); }
vec3 hsv2rgb(vec3 x){ vec3 k = mod(vec3(5.,3.,1.) + x.x*6., 6.); return x.z - x.z*x.y*clamp(min(k, 4.-k), 0., 1.); }
float skinMask(vec3 q){ float d = abs(mod(q.x*360. - 25. + 180., 360.) - 180.);
  return (1.-smoothstep(15.,40.,d)) * smoothstep(0.08,0.2,q.y) * (1.-smoothstep(0.65,0.85,q.y)) * smoothstep(0.12,0.3,q.z); }
float centre(int i){ return i==0?0.: i==1?30.: i==2?60.: i==3?120.: i==4?180.: i==5?220.: i==6?270.: 320.; }
vec3 color(vec3 c){
  c = clamp(c, 0., 1.);
  vec3 lin = pow(c, vec3(2.2));
  vec3 gain = vec3(1.+0.3*TEMP, 1.-0.2*TINT, 1.-0.3*TEMP); gain /= dot(gain, LUMA);
  c = pow(lin*gain*exp2(EXPOSURE), vec3(1./2.2));
  float b0 = -0.10*BLACKS, w0 = 1.-0.15*WHITES; c = (c-b0)/(w0-b0);
  float y = clamp(dot(c,LUMA), 0., 1.);
  float ws = 1.-smoothstep(0.,0.6,y), wh = smoothstep(0.4,1.,y);
  c *= 1. + SHADOWS*0.6*ws*ws + HIGHLIGHTS*0.5*wh*wh;
  c = pow(clamp(c,0.,1.), vec3(exp2(-BRIGHTNESS*0.8)));
  if (CONTRAST >= 0.) c += (c*c*(3.-2.*c) - c)*CONTRAST; else c += ((0.5+(c-0.5)*0.4) - c)*(-CONTRAST);
  float yy = dot(c,LUMA), chroma = max(c.r,max(c.g,c.b)) - min(c.r,min(c.g,c.b));
  c = clamp(yy + (c-yy)*(1.+SATURATION)*(1.+VIBRANCE*(1.-clamp(chroma*2.,0.,1.))), 0., 1.);
  if (useHsl > 0.5) {
    vec3 q = rgb2hsv(c); float cw = smoothstep(0.05,0.25,q.y); vec3 dd = vec3(0.);
    for (int i=0;i<8;i++){ float d = abs(mod(q.x*360. - centre(i) + 180., 360.) - 180.); dd += max(0., 1.-d/45.)*hsl[i]; }
    q.x = mod(q.x + dd.x*cw*(30./360.), 1.); q.y = clamp(q.y*(1.+dd.y*cw), 0., 1.); q.z = clamp(q.z*(1.+dd.z*0.5*cw), 0., 1.);
    c = hsv2rgb(q);
  }
  if (SKIN_TONE != 0. || SKIN_SAT != 0. || SKIN_LIGHT != 0.) {
    vec3 q = rgb2hsv(c); float m = skinMask(q);
    float dh = mod(25./360. - q.x + 0.5, 1.) - 0.5;
    q.x = mod(q.x + dh*SKIN_TONE*0.6*m, 1.); q.y = clamp(q.y*(1.+0.5*SKIN_SAT*m), 0., 1.); q.z = clamp(q.z*(1.+0.3*SKIN_LIGHT*m), 0., 1.);
    c = hsv2rgb(q);
  }
  return clamp(c, 0., 1.);
}
void main(){
  vec3 c = texture2D(tex, v).rgb;
  float y0 = dot(c, LUMA), add = 0.;
  if (CLARITY != 0. || SKIN_SMOOTH != 0.) {
    float yb = dot(texture2D(blur, v).rgb, LUMA);
    add += CLARITY*0.8*(y0-yb)*clamp(4.*y0*(1.-y0), 0., 1.);
    add -= SKIN_SMOOTH*0.9*(y0-yb)*skinMask(rgb2hsv(clamp(c,0.,1.)));
  }
  if (SHARPNESS != 0.) {
    float a = 0., w = 0.;
    for (int i=-2;i<=2;i++) for (int j=-2;j<=2;j++) { float k = exp(-float(i*i+j*j)/(2.*sharpSigma*sharpSigma));
      a += k*dot(texture2D(tex, v + vec2(float(i),float(j))*px).rgb, LUMA); w += k; }
    add += SHARPNESS*2.*clamp(y0 - a/w, -0.08, 0.08);
  }
  c = clamp(c + add, 0., 1.);
  if (VIGNETTE != 0.) {
    float r = length((v-0.5)*vec2(aspect,1.)) / (0.5*length(vec2(aspect,1.)));
    c *= 1. + VIGNETTE*0.85*smoothstep(VIG_MID, VIG_MID + 0.05 + 0.6*VIG_FEATHER, r);
  }
  gl_FragColor = vec4(color(c), 1.);
}`;

export function createRenderer(canvas) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const prog = (fs) => {
    const p = gl.createProgram();
    for (const [t, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    const u = {};
    return { p, u: (n) => u[n] ??= gl.getUniformLocation(p, n) };
  };
  const P = { frame: prog(FS_FRAME), down: prog(FS_DOWN), blur: prog(FS_BLUR), grade: prog(FS_GRADE) };
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = () => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    return t;
  };
  const target = () => ({ t: tex(), f: gl.createFramebuffer(), w: 0, h: 0 });
  const size = (o, w, h) => {
    if (o.w === w && o.h === h) return;
    o.w = w; o.h = h;
    gl.bindTexture(gl.TEXTURE_2D, o.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, o.t, 0);
  };
  const src = tex(), A = target(), B = target(), C = target();
  const pass = (pr, to, w, h, input, set) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.f : null); gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input); gl.uniform1i(pr.u("tex"), 0);
    set && set(pr); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return {
    // video: источник (или null — чёрный кадр); out: размер итогового кадра; fr: кадр клипа; g: цвет
    draw(video, sw, sh, out, fr, g) {
      const W = canvas.width, H = canvas.height;
      if (!video || !sw) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
      gl.bindTexture(gl.TEXTURE_2D, src);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); } catch { return; }
      fr = { ...FRAME_DEFAULT, ...fr }; g = { ...GRADE_DEFAULT, ...g };
      size(A, W, H);
      const th = -fr.rot * Math.PI / 180;
      pass(P.frame, A, W, H, src, (p) => {
        gl.uniform2f(p.u("uOut"), out.w, out.h); gl.uniform2f(p.u("uSrc"), sw, sh);
        gl.uniform2f(p.u("uOff"), fr.x * out.w, fr.y * out.h); gl.uniform2f(p.u("uC"), Math.cos(th), Math.sin(th));
        gl.uniform1f(p.u("uS"), Math.max(out.w / sw, out.h / sh) * (fr.scale || 1));
      });
      if (g.clarity || g.skin_smooth) {
        const w8 = Math.max(1, W >> 3), h8 = Math.max(1, H >> 3), sigma = Math.max(0.5, 0.012 * H / 8);
        size(B, w8, h8); size(C, w8, h8);
        pass(P.down, B, w8, h8, A.t, (p) => gl.uniform2f(p.u("px"), 1 / W, 1 / H));
        pass(P.blur, C, w8, h8, B.t, (p) => { gl.uniform2f(p.u("dir"), 1 / w8, 0); gl.uniform1f(p.u("sigma"), sigma); });
        pass(P.blur, B, w8, h8, C.t, (p) => { gl.uniform2f(p.u("dir"), 0, 1 / h8); gl.uniform1f(p.u("sigma"), sigma); });
      }
      pass(P.grade, null, W, H, A.t, (p) => {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.t); gl.uniform1i(p.u("blur"), 1);
        gl.uniform1fv(p.u("g[0]"), KEYS.map((k) => +g[k] || 0));
        const hs = HSL_BANDS.flatMap((b) => (g.hsl && g.hsl[b]) || [0, 0, 0]);
        gl.uniform3fv(p.u("hsl[0]"), hs); gl.uniform1f(p.u("useHsl"), hs.some(Boolean) ? 1 : 0);
        gl.uniform1f(p.u("aspect"), W / H); gl.uniform1f(p.u("sharpSigma"), Math.max(0.7, H / 1600)); gl.uniform2f(p.u("px"), 1 / W, 1 / H);
      });
    },
  };
}
