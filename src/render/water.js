// Agua: se dibuja en una segunda pasada sobre la escena opaca ya renderizada.
//  · refracción con distorsión y absorción por profundidad real (búfer de profundidad)
//  · reflexiones en espacio de pantalla (SSR) de la arquitectura + paneles analíticos
//  · Fresnel, ondas procedurales y ondas concéntricas que deja el jugador
//  · vista desde abajo con ventana de Snell y reflexión interna total
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON } from './surface.js';

const VERT = /* glsl */`
attribute vec3 aLight;
varying vec3 vW; varying vec3 vV; varying vec3 vL;
void main(){
  vW = position; vL = aLight;
  vec4 mv = viewMatrix * vec4(position, 1.);
  vV = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vW; varying vec3 vV; varying vec3 vL;
uniform sampler2D tScene; uniform sampler2D tDepth;
uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform mat4 uProj;
uniform vec3 uCam; uniform float uTime; uniform vec3 uFog; uniform float uFogD;
uniform vec4 uRip[8];
${GLSL_COMMON}
float viewZ(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
float sceneZ(vec2 uv){ return viewZ(texture2D(tDepth, uv).x); }

// pendiente de la superficie (dh/dx, dh/dz)
vec2 slope(vec2 p, float t){
  vec2 s = vec2(0.);
  // oleaje suave de piscina interior
  vec2 d1 = vec2(.8, .6), d2 = vec2(-.55, .83), d3 = vec2(.25, -.97);
  s += d1 * cos(dot(p, d1)*1.9 + t*1.1) * .020;
  s += d2 * cos(dot(p, d2)*3.1 - t*1.5) * .016;
  s += d3 * cos(dot(p, d3)*5.3 + t*2.1) * .011;
  // detalle: gradiente de ruido animado
  vec2 q = p*2.6 + vec2(t*.12, -t*.09); float e = .06;
  float n0 = fbm(q), nx = fbm(q + vec2(e, 0.)), nz = fbm(q + vec2(0., e));
  s += vec2(nx - n0, nz - n0) / e * .035;
  vec2 q2 = p*7. - vec2(t*.2, t*.16);
  float m0 = vnoise(q2), mx = vnoise(q2 + vec2(e, 0.)), mz = vnoise(q2 + vec2(0., e));
  s += vec2(mx - m0, mz - m0) / e * .008;
  // ondas concéntricas del jugador
  for(int i=0;i<8;i++){
    vec4 r = uRip[i]; float age = t - r.z;
    if (age < 0. || age > 7.) continue;
    vec2 dv = p - r.xy; float d = length(dv) + 1e-4;
    float front = age * 1.25;
    float env = r.w * exp(-age*.75) * smoothstep(front + .25, front - .1, d) * smoothstep(front - 2.6, front - .4, d) / (1. + d*.6);
    s += dv / d * cos((d - front) * 11.) * env * .5;
  }
  return s;
}

vec4 ssr(vec3 ro, vec3 rd){
  float t = .12, st = .22; vec2 uv = vec2(0.); float hit = 0.; float pt = 0.;
  for(int i=0;i<26;i++){
    pt = t; t += st; st *= 1.2;
    vec3 p = ro + rd*t;
    vec4 c = uProj * vec4(p, 1.);
    if (c.w <= 0.) break;
    uv = c.xy / c.w * .5 + .5;
    if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) break;
    float dz = sceneZ(uv) - p.z;
    if (dz > .0 && dz < st*1.3 + .7) { hit = 1.; break; }
  }
  if (hit < .5) return vec4(0.);
  float a = pt, b = t;
  for(int i=0;i<5;i++){
    float mid = (a + b)*.5; vec3 p = ro + rd*mid; vec4 c = uProj * vec4(p, 1.);
    uv = c.xy / c.w * .5 + .5;
    if (sceneZ(uv) - p.z > 0.) b = mid; else a = mid;
  }
  vec2 e = smoothstep(vec2(0.), vec2(.07), uv) * smoothstep(vec2(0.), vec2(.07), 1. - uv);
  return vec4(texture2D(tScene, uv).rgb, e.x * e.y);
}

void main(){
  vec2 suv = gl_FragCoord.xy / uRes;
  float dist = length(vV);
  vec2 sl = slope(vW.xz, uTime) * (1. / (1. + dist*.012));
  vec3 N = normalize(vec3(-sl.x, 1., -sl.y));
  vec3 V = normalize(uCam - vW);
  bool below = uCam.y < vW.y;
  if (below) N = -N;
  float NdV = max(dot(N, V), 0.);
  float lum = dot(vL, vec3(.3, .5, .2));
  vec3 col;
  if (!below) {
    // --- refracción y absorción ---
    float zf = vV.z;
    float t0 = max(zf - sceneZ(suv), 0.);
    vec2 ruv = suv + sl * (.55 / (1. + dist*.35)) * smoothstep(0., .5, t0);
    float zs = sceneZ(ruv);
    if (zs > zf - .02) { ruv = suv; zs = sceneZ(suv); }
    float thick = max(zf - zs, 0.) * dist / max(-zf, 1e-3);
    vec3 refr = texture2D(tScene, ruv).rgb;
    vec3 tr = exp(-thick * vec3(.46, .09, .065));
    vec3 scat = vec3(.015, .13, .15) * (vL*.9 + .02) * (1. - exp(-thick*.3));
    refr = refr * tr + scat;
    // --- reflexión ---
    vec3 Nv = normalize((viewMatrix * vec4(N, 0.)).xyz);
    vec3 Rv = reflect(normalize(vV), Nv);
    vec4 sr = ssr(vV, Rv);
    vec3 R = reflect(-V, N);
    vec3 env = vL * .5 + panelSpec(vW, R, .012) * min(1., .3 + lum*1.5);
    vec3 refl = mix(env, sr.rgb, sr.a);
    float F = .02 + .98*pow(1. - NdV, 5.);
    col = mix(refr, refl, F);
    col += flashlight(vW, N, V, 1.) * .12;
    // brillo sutil en el contacto con los bordes
    col += vL * .05 * smoothstep(.12, 0., thick);
  } else {
    // --- desde dentro del agua ---
    vec2 ruv = clamp(suv + sl * 1.4, .002, .998);
    vec3 above = texture2D(tScene, ruv).rgb;
    float tir = smoothstep(.72, .6, NdV);
    vec3 deep = vec3(.05, .34, .4) * (.12 + lum*.9);
    col = mix(above * vec3(.8, .97, 1.) + vL*.08, deep, tir);
  }
  col = mix(col, uFog, 1. - exp(-dist * uFogD));
  gl_FragColor = vec4(col, 1.);
}`;

export function makeWaterMaterial(shared, tScene, tDepth) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: {
      tScene: { value: tScene }, tDepth: { value: tDepth },
      uRes: shared.uRes, uNear: shared.uNear, uFar: shared.uFar, uProj: shared.uProj,
      uCam: shared.uCam, uTime: shared.uTime, uFog: shared.uFog, uFogD: shared.uFogD,
      uRip: shared.uRip, uLP: shared.uLP, uLC: shared.uLC,
      uFlPos: shared.uFlPos, uFlDir: shared.uFlDir, uFlOn: shared.uFlOn,
    },
  });
}
