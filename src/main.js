// Arranque: renderer, menú, carga inicial, bucle principal y resolución adaptativa.
import * as THREE from '../vendor/three.module.min.js';
import { makeShared, makeSurfaceMaterial, makeCurtainMaterial } from './render/surface.js';
import { makeWaterMaterial } from './render/water.js';
import { Pipeline } from './render/pipeline.js';
import { World } from './world/stream.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { strSeed } from './rng.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2');
} catch (e) {
  $('fatal').querySelector('p').textContent = 'Este navegador no ofrece WebGL 2, necesario para el agua y la iluminación.';
  show($('fatal'), true); show($('menu'), false);
  throw e;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000, 1);

const shared = makeShared();
const pipeline = new Pipeline(renderer, shared);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, shared.uNear.value, shared.uFar.value);
const mats = {
  surface: makeSurfaceMaterial(shared),
  curtain: makeCurtainMaterial(shared),
  water: makeWaterMaterial(shared, pipeline.rtScene.texture, pipeline.depthTex),
};
const audio = new AudioEngine();
const player = new Player(camera, canvas, shared, audio);
let world = null, state = 'menu', scale = 1, slow = 0, fast = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
  const w = Math.max(2, Math.floor(innerWidth * dpr)), h = Math.max(2, Math.floor(innerHeight * dpr));
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  pipeline.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- menú ---
const seedInput = $('seed');
seedInput.value = params.get('seed') || Math.random().toString(36).slice(2, 8);
function lock() { const p = canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); }
function setState(s) {
  state = s;
  player.locked = s === 'play';
  show($('pause'), s === 'pause');
  audio.suspend(s !== 'play');
}
async function begin() {
  if (state !== 'menu') return;
  state = 'loading';
  audio.start();
  show($('menu'), false); show($('loading'), true);
  const seedText = seedInput.value.trim() || 'poolrooms';
  history.replaceState(null, '', '?seed=' + encodeURIComponent(seedText) + (DEBUG ? '&debug' : ''));
  world = new World(scene, strSeed(seedText), mats);
  const boot = world.boot();
  let spawn = null;
  for (;;) {
    const r = boot.next();
    if (r.done) { spawn = r.value; break; }
    $('progress').style.width = Math.round(r.value * 100) + '%';
    await new Promise((res) => setTimeout(res, 0));
  }
  player.place(spawn || [1.6, 20.3, 1.6], -Math.PI * 0.75);
  show($('loading'), false);
  fade = 0;
  setState('play');
  lock();
  show($('hint'), true); setTimeout(() => show($('hint'), false), 9000);
  if (DEBUG) {
    show($('dbg'), true);
    // utilidades de depuración: saltar a la primera sala de un arquetipo
    const goto = (arch, nth = 0) => {
      const L = world.layout;
      for (let guard = 0; guard < 400; guard++) {
        const hits = L.rooms.filter((r) => r.arch === arch && r.final);
        if (hits[nth]) {
          const r = hits[nth]; world.cur = r; world.plan();
          while (!world.built.has(r.id)) world.work(50);
          const pp = r.portals.find((q) => q.p.kind !== 8), q = world.portalRect(r, pp), o = [r.i0 * 6, r.k0 * 6];
          const inx = pp.side === 0 ? 1.2 : pp.side === 1 ? -1.2 : 0, inz = pp.side === 2 ? 1.2 : pp.side === 3 ? -1.2 : 0;
          player.place([(q.xs ? q.plane : q.c) + inx, q.y0, (q.xs ? q.c : q.plane) + inz], Math.atan2(-inx, -inz));
          return `${r.arch} #${r.id} ${r.ni}x${r.nl}x${r.nk} ${r.mood} ${JSON.stringify(r.v)}`;
        }
        const next = L.rooms.find((r) => !r.final); if (!next) break; L.finalize(next);
      }
      return null;
    };
    window.game = { world, player, camera, shared, audio, pipeline, tick, renderer, scene, goto };
  }
}
$('start').addEventListener('click', begin);
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') begin(); });
canvas.addEventListener('click', () => { if (state === 'play' && !document.pointerLockElement) lock(); });
$('pause').addEventListener('click', () => { setState('play'); lock(); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play' && !DEBUG) setState('pause');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !DEBUG) setState('pause'); });

// --- ambiente visual por zona ---
const FOG = {
  day: [[0.62, 0.7, 0.73], 0.004, 1.0, [0.07, 0.44, 0.5]], dim: [[0.26, 0.28, 0.27], 0.008, 1.15, [0.03, 0.22, 0.25]], night: [[0.006, 0.02, 0.024], 0.012, 1.5, [0.004, 0.07, 0.08]],
  yellow: [[0.42, 0.37, 0.18], 0.011, 1.1, [0.1, 0.16, 0.08]], concrete: [[0.012, 0.014, 0.017], 0.02, 1.15, [0.004, 0.03, 0.035]],
};
const fogT = new THREE.Color(), waterT = new THREE.Color(), fwd = new THREE.Vector3();
let last = performance.now(), fade = 0, frameN = 0, fpsT = 0, fpsN = 0, fps = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000; last = now;
  tick(raw);
}
function tick(raw) {
  if (state !== 'play' && state !== 'pause') return;
  const dt = state === 'play' ? Math.min(0.1, raw) : 0;
  shared.uTime.value += dt;
  let info = null;
  if (dt > 0) {
    info = player.update(dt, world);
    const b = player.body;
    world.update(b.x, b.y + 0.9, b.z);
    if (frameN++ % 5 === 0) world.nearLights(camera.position, shared.uLP.value, shared.uLC.value);
    const a = info.amb, f = FOG[a.zone === 'pool' ? a.mood : a.zone] || FOG.day, k = Math.min(1, dt * 0.9);
    fogT.setRGB(f[0][0], f[0][1], f[0][2]);
    shared.uFog.value.lerp(fogT, k);
    shared.uFogD.value += (f[1] - shared.uFogD.value) * k;
    const fu = pipeline.mFinal.uniforms;
    fu.uExposure.value += (f[2] - fu.uExposure.value) * Math.min(1, dt * 0.6);
    waterT.setRGB(f[3][0], f[3][1], f[3][2]); fu.uWaterCol.value.lerp(waterT, k);
    fade = Math.min(1, fade + dt * 0.5); fu.uFade.value = fade * fade;
    camera.getWorldDirection(fwd);
    audio.update(dt, camera.position, fwd, a);
  }
  shared.uCam.value.copy(camera.position);
  shared.uProj.value.copy(camera.projectionMatrix);
  pipeline.render(scene, camera);

  // resolución adaptativa para mantener la fluidez
  if (dt > 0) {
    if (raw > 0.024) { slow += raw; fast = 0; } else if (raw < 0.0125) { fast += raw; slow = Math.max(0, slow - raw); } else { fast = 0; slow = Math.max(0, slow - raw * 0.5); }
    if (DEBUG && params.has('noscale')) slow = 0;
    if (slow > 1.2 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slow = 0; resize(); }
    if (fast > 6 && scale < 1) { scale = Math.min(1, scale * 1.12); fast = 0; resize(); }
    if (DEBUG) {
      fpsT += raw; fpsN++;
      if (fpsT > 0.5) {
        fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
        const b = player.body, r = world.cur;
        $('dbg').textContent = `${fps.toFixed(0)} fps · escala ${scale.toFixed(2)} · ${world.stats.rooms} salas · ${(world.stats.tris / 1000).toFixed(0)}k tris · cola ${world.queue.length}\n` +
          `${r.arch} #${r.id} ${r.ni}×${r.nl}×${r.nk} ${r.zone}/${r.mood} · total ${world.layout.rooms.length}\n` +
          `pos ${b.x.toFixed(1)} ${b.y.toFixed(1)} ${b.z.toFixed(1)} ${b.swim ? 'nadando' : b.onGround ? 'suelo' : 'aire'} sub ${b.sub.toFixed(2)}`;
      }
    }
  }
}
requestAnimationFrame(frame);
