// Material único para toda la arquitectura. La luz difusa viene horneada por vértice;
// en el fragmento se generan los materiales procedurales (azulejo, gresite, papel
// pintado, moqueta, hormigón…), cáusticas animadas bajo y sobre el agua, reflejos
// especulares analíticos de los paneles de techo, linterna y niebla.
import * as THREE from '../../vendor/three.module.min.js';

export const GLSL_COMMON = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }
// red de filamentos brillantes tipo cáustica (senos con deformación de dominio)
float caustic(vec2 p, float t){
  vec2 q = p;
  for(int i=0;i<3;i++){ float fi = float(i); q += .38*vec2(sin(q.y*1.7 + t*.9 + fi*1.3), cos(q.x*1.9 - t*.7 + fi*2.1)); }
  float v = sin(q.x*2.3 + t*.4) * sin(q.y*2.1 - t*.5);
  float w = sin((q.x+q.y)*1.6 + t*.6) * sin((q.x-q.y)*1.8 - t*.3);
  float r = 1. - abs(v + w*.7);
  float r2 = 1. - abs(sin(q.x*3.1 - t*.5) * sin(q.y*2.7 + t*.45) - w*.5);
  return pow(clamp(r,0.,1.), 6.)*.75 + pow(clamp(r*r2,0.,1.), 3.)*.55;
}
uniform vec4 uLP[8];
uniform vec4 uLC[8];
// reflejo de los paneles rectangulares de techo en la dirección R
vec3 panelSpec(vec3 P, vec3 R, float rough){
  vec3 s = vec3(0.);
  if (R.y < .02) return s;
  for(int i=0;i<8;i++){
    vec4 lp = uLP[i];
    float dy = lp.y - P.y; if (dy < .05) continue;
    float t = dy / R.y;
    vec2 q = abs(P.xz + R.xz*t - lp.xz) - vec2(lp.w, uLC[i].w);
    float blur = rough*t + .03;
    s += uLC[i].rgb * smoothstep(blur, -blur, max(q.x, q.y)) / (1. + t*t*.0015);
  }
  return s;
}
uniform vec3 uFlPos; uniform vec3 uFlDir; uniform float uFlOn;
vec3 flashlight(vec3 P, vec3 N, vec3 V, float gloss){
  if (uFlOn < .01) return vec3(0.);
  vec3 L = uFlPos - P; float d = length(L); L /= d;
  float c = dot(-L, uFlDir);
  float cone = smoothstep(.78, .92, c), hot = smoothstep(.93, .995, c);
  float ring = .96 + .04*sin(acos(clamp(c,-1.,1.))*70.);
  float att = 1. / (1. + .07*d*d);
  vec3 col = vec3(1., .95, .84) * cone * (.5 + hot) * ring * att * 6.5 * uFlOn;
  float sp = pow(max(dot(reflect(-L, N), V), 0.), 48.) * gloss;
  return col * (max(dot(N, L), 0.) + sp*1.5);
}
`;

const VERT = /* glsl */`
attribute vec3 aLight; attribute vec3 aTint; attribute vec2 aMW;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vL; varying vec3 vT; varying vec2 vMW; varying float vD;
void main(){
  vW = position; vN = normal; vUv = uv; vL = aLight; vT = aTint; vMW = aMW;
  vec4 mv = viewMatrix * vec4(position, 1.);
  vD = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vL; varying vec3 vT; varying vec2 vMW; varying float vD;
uniform vec3 uCam; uniform float uTime; uniform vec3 uFog; uniform float uFogD;
${GLSL_COMMON}
// azulejo: devuelve máscara (1 baldosa, 0 junta), id y atenuación por distancia
float tile(vec2 uv, float size, float gw, out vec2 id, out float lod, out vec2 bev){
  vec2 p = uv / size; id = floor(p); vec2 f = fract(p); vec2 fw = fwidth(p);
  vec2 e = min(f, 1. - f);
  vec2 a = smoothstep(vec2(gw) - fw, vec2(gw) + fw, e);
  lod = clamp(max(fw.x, fw.y) * 1.6, 0., 1.);
  vec2 c = f - .5;
  bev = sign(c) * smoothstep(vec2(.5 - gw*2.5), vec2(.5 - gw*.6), abs(c)) * (1. - lod);
  return mix(a.x * a.y, 1. - 3.4*gw, lod);
}
void main(){
  int m = int(vMW.x + .5);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if (m == 4) { gl_FragColor = vec4(vL * (1. + .06*sin(uTime*1.7 + vW.x + vW.z)), 1.); return; }

  vec3 alb = vT; float gloss = 0.; float rough = .5; vec3 Np = N;
  vec2 id; float lod; vec2 bev; float mk;
  // base tangente para perturbar la normal según la cara
  vec3 Tg = abs(N.y) > .5 ? vec3(1,0,0) : normalize(vec3(-N.z, 0., N.x));
  vec3 Bt = cross(N, Tg);
  if (m == 0 || m == 8) {
    mk = tile(vUv, .15, .03, id, lod, bev);
    float h = hash12(id);
    alb = mix(vT*.74, vT*(.94 + .08*h), mk);
    Np = normalize(N + (Tg*bev.x + Bt*bev.y)*.22 + (Tg*(hash12(id+7.)-.5) + Bt*(h-.5))*.028*(1.-lod));
    gloss = mix(.25, .9, mk); rough = .035;
  } else if (m == 1) {
    mk = tile(vUv, .075, .07, id, lod, bev);
    float h = hash12(id);
    vec3 c2 = vT * mix(vec3(.72,.9,1.), vec3(1.05,1.03,.96), h);
    alb = mix(vT*.78, mix(vT, c2, .55 + .45*step(.7, hash12(id+3.))), mk);
    Np = normalize(N + (Tg*bev.x + Bt*bev.y)*.3 + (Tg*(hash12(id+7.)-.5) + Bt*(h-.5))*.04*(1.-lod));
    gloss = mix(.2, .85, mk); rough = .05;
  } else if (m == 2) {
    mk = tile(vUv, .6, .012, id, lod, bev);
    alb = mix(vT*.55, vT*(.92 + .08*hash12(id)), mk) * (.94 + .06*fbm(vUv*3.));
    gloss = .45*mk; rough = .09;
  } else if (m == 3) {
    alb = vT * (.95 + .05*fbm(vUv*2.5)); gloss = .04; rough = .4;
  } else if (m == 5) {
    float st = smoothstep(.42, .5, abs(fract(vUv.x*3.2) - .5));
    float dm = abs(fract(vUv.x*6.4 + .25) - .5) + abs(fract(vUv.y*4.) - .5);
    alb = vT * (.9 + .07*st - .06*smoothstep(.2, .1, dm));
    alb *= .82 + .2*fbm(vUv*vec2(.7, .35));                              // manchas de humedad
    alb *= mix(.75, 1., smoothstep(0., .5, fbm(vec2(vUv.x*2., vUv.y*.3) + 9.)));
    gloss = .03; rough = .5;
  } else if (m == 6) {
    float sp = vnoise(vUv*90.)*.5 + vnoise(vUv*31.)*.5;
    float damp = smoothstep(.45, .7, fbm(vUv*.45 + 3.));
    alb = vT * (.78 + .3*sp) * mix(1., .62, damp);
    gloss = .02 + .25*damp; rough = .3;
  } else if (m == 7) {
    float n = fbm(vUv*1.3), n2 = fbm(vUv*7.);
    vec2 pl = abs(fract(vUv/vec2(2.4, 1.2)) - .5);
    float seam = smoothstep(.492, .5, max(pl.x, pl.y));
    alb = vT * (.72 + .32*n) * (.92 + .1*n2) * (1. - .3*seam);
    alb *= mix(1., .7, smoothstep(.55, .75, fbm(vec2(vUv.x*1.5, vUv.y*.25) + 5.)));   // chorretones
    gloss = .12; rough = .2;
  } else {
    vec2 g = abs(fract(vUv/.6) - .5); vec2 fw = fwidth(vUv/.6);
    float line = 1. - smoothstep(.5 - .02 - fw.x, .5 - .02 + fw.x, max(g.x, g.y));
    float pit = step(.86, vnoise(vUv*70.)) * (1. - clamp(fw.x*6., 0., 1.));
    alb = vT * mix(.55, 1., line) * (1. - .22*pit) * (.92 + .1*fbm(vUv*.8));
    gloss = .02; rough = .5;
  }

  vec3 E = vL;
  float wy = vMW.y;
  if (wy > -1000.) {
    float d = wy - vW.y;
    vec2 cp = vW.xz + N.xz * vW.y * .7;
    if (d > 0.) {
      float c = caustic(cp*.85, uTime*1.1);
      E *= 1. + c * 1.9 * exp(-d*.3) * (.35 + .65*max(N.y, 0.));
      gloss *= .5;
    } else {
      float c = caustic(cp*.42 + 3., uTime*.7);
      E += vL * c * .3 * exp(d*.4) * (1. - .75*max(N.y, 0.));
      gloss = min(1., gloss * (1. + .8*exp(d*2.)));
    }
    // cenefa de la línea de flotación en paramentos verticales
    if ((m == 0 || m == 1) && abs(N.y) < .5) {
      float band = smoothstep(.016, 0., abs(vW.y - (wy + .075)) - .075);
      alb = mix(alb, alb * vec3(.18, .42, .62), band * .9);
    }
  }
  vec3 fl = flashlight(vW, Np, V, gloss);
  vec3 col = alb * (E + fl);
  // especular: paneles de techo + entorno aproximado
  float NdV = max(dot(Np, V), 0.);
  float F = (.04 + .96*pow(1. - NdV, 5.)) * gloss;
  vec3 R = reflect(-V, Np);
  float lum = dot(vL, vec3(.3, .5, .2));
  col += F * (panelSpec(vW, R, rough) * min(1., .25 + lum*1.6) + vL * .35);
  col = mix(col, uFog, 1. - exp(-vD * uFogD));
  gl_FragColor = vec4(col, 1.);
}`;

export function makeSurfaceMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.FrontSide,
    uniforms: {
      uCam: shared.uCam, uTime: shared.uTime, uFog: shared.uFog, uFogD: shared.uFogD,
      uLP: shared.uLP, uLC: shared.uLC, uFlPos: shared.uFlPos, uFlDir: shared.uFlDir, uFlOn: shared.uFlOn,
    },
  });
}

// Telón de niebla para huecos cuya sala vecina aún no está construida
export function makeCurtainMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uFog; void main(){ gl_FragColor = vec4(uFog * .6, 1.); }',
    uniforms: { uFog: shared.uFog }, side: THREE.DoubleSide,
  });
}

export function makeShared() {
  const v4 = () => Array.from({ length: 8 }, () => new THREE.Vector4(0, -1e4, 0, 0));
  return {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 },
    uFog: { value: new THREE.Color(0.55, 0.62, 0.66) }, uFogD: { value: 0.006 },
    uLP: { value: v4() }, uLC: { value: v4() },
    uFlPos: { value: new THREE.Vector3() }, uFlDir: { value: new THREE.Vector3(0, 0, -1) }, uFlOn: { value: 0 },
    uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0)) },
    uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.08 }, uFar: { value: 400 },
    uProj: { value: new THREE.Matrix4() }, uUnder: { value: 0 },
  };
}
