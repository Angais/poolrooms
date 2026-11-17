// Jugador en primera persona. Mecánicas mínimas: caminar, nadar (solo en agua
// profunda) y linterna. Gestiona entrada, cámara (suavizado de peldaños, balanceo),
// pasos, ondas en el agua y el haz de la linterna.
import * as THREE from '../vendor/three.module.min.js';
import { PLAYER } from './config.js';
import { Body } from './physics.js';

export class Player {
  constructor(camera, dom, shared, audio) {
    this.camera = camera; this.dom = dom; this.shared = shared; this.audio = audio;
    this.body = new Body();
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.eyeY = 0; this.bob = 0; this.stride = 0; this.swimT = 0; this.rip = 0; this.ripT = 0;
    this.flash = false; this.flDir = new THREE.Vector3(0, 0, -1);
    this.safe = [0, 0, 0]; this.safeT = 0; this.wasSwim = false; this.wasUnder = false;
    this.inp = { fx: 0, fz: -1, rx: 1, rz: 0, mf: 0, ms: 0, up: 0, pitch: 0 };
    this.locked = false;
    addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.code === 'KeyF' && !e.repeat) this.toggleFlash();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked || !(document.pointerLockElement || (e.buttons & 1))) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0021));
    });
    dom.addEventListener('mousedown', (e) => { if (this.locked && e.button === 2) this.toggleFlash(); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggleFlash() { this.flash = !this.flash; this.audio.click(this.flash); }

  place(p, yaw = 0) {
    const b = this.body;
    b.x = p[0]; b.y = p[1] + 0.05; b.z = p[2]; b.vx = b.vy = b.vz = 0; b.onGround = false;
    this.yaw = yaw; this.eyeY = b.y + PLAYER.eye; this.safe = [b.x, b.y, b.z];
  }

  spawnRipple(amp) {
    const b = this.body, r = this.shared.uRip.value[this.rip];
    r.set(b.x, b.z, this.shared.uTime.value, amp);
    this.rip = (this.rip + 1) % 8;
  }

  update(dt, world) {
    const b = this.body, k = this.keys, inp = this.inp, P = PLAYER;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    inp.fx = -Math.sin(this.yaw); inp.fz = -Math.cos(this.yaw); inp.rx = Math.cos(this.yaw); inp.rz = -Math.sin(this.yaw);
    inp.mf = f; inp.ms = s; inp.pitch = this.pitch;
    inp.up = (k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') || k.has('ShiftLeft') ? 1 : 0);
    const px = b.x, pz = b.z;
    // subpasos fijos para una física estable con cualquier tasa de refresco
    let rest = Math.min(dt, 0.1);
    let land = 0;
    while (rest > 1e-5) { const h = Math.min(rest, 1 / 90); b.update(world.col, h, inp); rest -= h; if (b.land > land) land = b.land; }
    const moved = Math.hypot(b.x - px, b.z - pz), speed = moved / Math.max(dt, 1e-4);

    // red de seguridad: si algo saliera mal, vuelve al último punto firme
    this.safeT += dt;
    if (b.onGround && this.safeT > 1) { this.safeT = 0; this.safe = [b.x, b.y, b.z]; }
    if (!(b.y > -50) || !Number.isFinite(b.x + b.z)) this.place(this.safe, this.yaw);

    // sonido de movimiento
    const amb = world.ambience(b.x, b.y + 1, b.z);
    const surf = b.sub > 0.04 ? 'water' : amb.zone === 'yellow' ? 'carpet' : amb.zone === 'concrete' ? 'concrete' : 'tile';
    if (b.swim) {
      this.swimT += dt * (0.5 + speed * 0.5);
      if (this.swimT > 1.15 && speed > 0.4) { this.swimT = 0; this.audio.stroke(b.y + P.eye < b.ws); this.spawnRipple(1); }
    } else if (b.onGround && speed > 0.3) {
      this.stride += moved;
      if (this.stride > (b.sub > 0.12 ? 0.9 : 0.78)) { this.stride = 0; this.audio.step(surf, Math.min(1, b.sub * 2.5)); if (b.sub > 0.02) this.spawnRipple(0.55); }
    }
    if (land > 2.5) this.audio.step(surf, 1, Math.min(1, land / 8));
    if (b.splash > 0) { this.audio.splash(b.splash); this.spawnRipple(1.6); b.splash = 0; }
    if (b.swim && !this.wasSwim) this.spawnRipple(1.2);
    this.wasSwim = b.swim;
    this.ripT += dt;
    if (b.sub > 0.02 && this.ripT > 1.6) { this.ripT = 0; this.spawnRipple(0.25); }

    // cámara
    const targetEye = b.y + P.eye;
    const kf = b.swim ? 6 : b.onGround ? 14 : 30;
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, kf * dt);
    if (Math.abs(targetEye - this.eyeY) > 1.2) this.eyeY = targetEye;
    const walking = b.onGround && speed > 0.3;
    this.bob += dt * (walking ? speed * 2.3 : 0);
    const t = this.shared.uTime.value;
    const bobY = walking ? Math.sin(this.bob * 2) * 0.028 : 0, bobX = walking ? Math.cos(this.bob) * 0.018 : 0;
    const float = b.swim ? Math.sin(t * 1.6) * 0.035 : 0;
    const cam = this.camera;
    cam.position.set(b.x + inp.rx * bobX, this.eyeY + bobY + float, b.z + inp.rz * bobX);
    cam.rotation.set(this.pitch, this.yaw, (b.swim ? Math.sin(t * 0.9) * 0.012 : 0) - s * 0.006, 'YXZ');
    cam.updateMatrixWorld();

    // linterna con un ligero retardo respecto a la mirada
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.flDir.lerp(dir, Math.min(1, 9 * dt)).normalize();
    const sh = this.shared;
    sh.uFlDir.value.copy(this.flDir);
    sh.uFlPos.value.copy(cam.position).addScaledVector(dir, 0.1).add(new THREE.Vector3(inp.rx * 0.18, -0.16, inp.rz * 0.18));
    sh.uFlOn.value += ((this.flash ? 1 : 0) - sh.uFlOn.value) * Math.min(1, 18 * dt);

    // cámara bajo el agua
    const ws = world.col.waterAt(world.col.near(cam.position.x, cam.position.y - 1, cam.position.y + 1, cam.position.z, 0.5), cam.position.x, cam.position.y, cam.position.z);
    const under = ws > cam.position.y + 0.015;
    sh.uUnder.value += ((under ? 1 : 0) - sh.uUnder.value) * Math.min(1, 14 * dt);
    if (under !== this.wasUnder) { this.audio.submerge(under); this.wasUnder = under; }
    return { amb, speed, under, surf };
  }
}
