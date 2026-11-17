// Cadena de render HDR:
//   1) escena opaca → color + profundidad
//   2) composición: copia (escribiendo profundidad) + agua con refracción/SSR
//   3) bloom ligero   4) salida: efecto submarino, ACES, viñeta, grano
import * as THREE from '../../vendor/three.module.min.js';

const QV = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

const COPY = /* glsl */`
varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tDepth;
void main(){ gl_FragColor = texture2D(tScene, vUv); gl_FragDepth = texture2D(tDepth, vUv).x; }`;

const BRIGHT = /* glsl */`
varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uPx;
void main(){
  vec3 c = vec3(0.);
  for(int i=0;i<4;i++){ vec2 o = vec2(float(i/2)*2.-1., mod(float(i),2.)*2.-1.) * uPx; c += min(texture2D(tMap, vUv + o).rgb, vec3(12.)); }
  c *= .25;
  float l = dot(c, vec3(.3,.5,.2));
  gl_FragColor = vec4(c * smoothstep(.85, 2.2, l), 1.);
}`;

const BLUR = /* glsl */`
varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uDir;
void main(){
  vec3 c = texture2D(tMap, vUv).rgb * .2270;
  c += (texture2D(tMap, vUv + uDir*1.385).rgb + texture2D(tMap, vUv - uDir*1.385).rgb) * .3162;
  c += (texture2D(tMap, vUv + uDir*3.231).rgb + texture2D(tMap, vUv - uDir*3.231).rgb) * .0703;
  gl_FragColor = vec4(c, 1.);
}`;

const FINAL = /* glsl */`
precision highp float;
varying vec2 vUv; uniform sampler2D tMap; uniform sampler2D tBloom; uniform sampler2D tDepth;
uniform float uTime; uniform float uUnder; uniform float uNear; uniform float uFar; uniform vec3 uWaterCol; uniform float uExposure; uniform float uFade;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x + .03)) / (x*(2.43*x + .59) + .14), 0., 1.); }
void main(){
  vec2 uv = vUv;
  if (uUnder > .01) uv += uUnder * .0035 * vec2(sin(uv.y*24. + uTime*1.7), cos(uv.x*21. + uTime*1.4));
  vec2 cc = uv - .5;
  float ca = .0012 + .002*uUnder;
  vec3 col = vec3(texture2D(tMap, uv + cc*ca).r, texture2D(tMap, uv).g, texture2D(tMap, uv - cc*ca).b);
  vec3 bloom = texture2D(tBloom, uv).rgb;
  if (uUnder > .01) {
    float d = texture2D(tDepth, uv).x;
    float z = (uNear * uFar) / (uFar - (uFar - uNear) * d);
    float f = 1. - exp(-z * .075);
    col = mix(col * vec3(.7, .96, 1.), uWaterCol, f * uUnder);
    col *= mix(1., .82 + .18*sin(uTime*.9 + uv.x*5.), uUnder*.3);
  }
  col += bloom * .4;
  col = aces(col * uExposure);
  col = pow(col, vec3(1./2.2));
  // gradación fría en sombras, viñeta y grano
  float l = dot(col, vec3(.3,.5,.2));
  col = mix(col, col * vec3(.94, 1., 1.05), (1. - l)*.5);
  col *= 1. - dot(cc, cc) * .5;
  col += (hash(gl_FragCoord.xy + fract(uTime)*311.) - .5) * .022;
  gl_FragColor = vec4(col * uFade, 1.);
}`;

export class Pipeline {
  constructor(renderer, shared) {
    this.r = renderer; this.shared = shared;
    const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.depthTex = new THREE.DepthTexture(4, 4);
    this.depthTex.type = THREE.UnsignedIntType;
    this.depthTex.minFilter = this.depthTex.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: true, depthTexture: this.depthTex });
    this.rtComp = new THREE.WebGLRenderTarget(4, 4, { ...hf, depthBuffer: true });
    this.rtB1 = new THREE.WebGLRenderTarget(4, 4, hf);
    this.rtB2 = new THREE.WebGLRenderTarget(4, 4, hf);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad);
    const sm = (fs, uniforms, extra) => new THREE.ShaderMaterial({ vertexShader: QV, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.mCopy = sm(COPY, { tScene: { value: this.rtScene.texture }, tDepth: { value: this.depthTex } }, { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth });
    this.mBright = sm(BRIGHT, { tMap: { value: this.rtComp.texture }, uPx: { value: new THREE.Vector2() } });
    this.mBlur = sm(BLUR, { tMap: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mFinal = sm(FINAL, {
      tMap: { value: this.rtComp.texture }, tBloom: { value: this.rtB1.texture }, tDepth: { value: this.depthTex },
      uTime: shared.uTime, uUnder: shared.uUnder, uNear: shared.uNear, uFar: shared.uFar,
      uWaterCol: { value: new THREE.Color(0.07, 0.44, 0.5) }, uExposure: { value: 1.0 }, uFade: { value: 1 },
    });
  }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h); this.rtComp.setSize(w, h);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.rtB1.setSize(bw, bh); this.rtB2.setSize(bw, bh);
    this.shared.uRes.value.set(w, h);
    this.mBright.uniforms.uPx.value.set(1 / w, 1 / h);
    this.bpx = [1 / bw, 1 / bh];
  }
  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.qs, this.cam);
  }
  render(scene, camera) {
    const r = this.r;
    r.autoClear = false;
    // 1) opaco
    camera.layers.set(0);
    r.setRenderTarget(this.rtScene); r.clear();
    r.render(scene, camera);
    // 2) composición con agua
    r.setRenderTarget(this.rtComp); r.clear();
    this._pass(this.mCopy, this.rtComp);
    camera.layers.set(1);
    r.render(scene, camera);
    // 3) bloom
    this._pass(this.mBright, this.rtB1);
    this.mBlur.uniforms.tMap.value = this.rtB1.texture; this.mBlur.uniforms.uDir.value.set(this.bpx[0], 0);
    this._pass(this.mBlur, this.rtB2);
    this.mBlur.uniforms.tMap.value = this.rtB2.texture; this.mBlur.uniforms.uDir.value.set(0, this.bpx[1]);
    this._pass(this.mBlur, this.rtB1);
    // 4) salida
    this._pass(this.mFinal, null);
  }
}
