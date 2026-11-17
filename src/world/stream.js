// Mundo en streaming: mantiene construidas las salas a pocos huecos de distancia del
// jugador, las construye repartiendo el trabajo entre fotogramas y descarga las lejanas.
// Los huecos hacia salas aún no construidas se tapan con un telón de niebla + colisión,
// de modo que nunca se ve ni se pisa el vacío.
import * as THREE from '../../vendor/three.module.min.js';
import { CS, LH, T, K, FLOOD_FLOOR, STREAM } from '../config.js';
import { Layout, roomOrigin } from './layout.js';
import { DEFS } from './archetypes.js';
import { buildRoom } from './build.js';
import { Colliders } from '../physics.js';

const bbOf = (r) => { const o = roomOrigin(r); return [o[0], o[1], o[2], o[0] + r.ni * CS, o[1] + r.nl * LH, o[2] + r.nk * CS]; };

export class World {
  constructor(scene, seed, mats) {
    this.scene = scene; this.mats = mats;
    this.layout = new Layout(seed, DEFS);
    this.col = new Colliders();
    this.built = new Map();          // id → { room, mesh, water, lights, waters, bb }
    this.curtains = new Map();       // id de hueco → malla
    this.queue = []; this.job = null; this.cur = null; this.depthOf = new Map();
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.stats = { rooms: 0, tris: 0 };
  }

  // BFS por huecos desde la sala actual; finaliza el trazado de lo cercano
  plan() {
    const L = this.layout, cur = this.cur, c = bbOf(cur);
    const cx = (c[0] + c[3]) / 2, cz = (c[2] + c[5]) / 2;
    const depth = new Map([[cur.id, 0]]), order = [cur];
    for (let h = 0; h < order.length; h++) {
      const r = order[h], d = depth.get(r.id);
      if (d <= STREAM.depth) L.finalize(r);
      if (!r.final || d >= STREAM.keepDepth) continue;
      for (const pp of r.portals) {
        if (depth.has(pp.other)) continue;
        const o = L.rooms[pp.other], b = bbOf(o);
        const dx = Math.max(b[0] - cx, 0, cx - b[3]), dz = Math.max(b[2] - cz, 0, cz - b[5]);
        if (Math.hypot(dx, dz) > STREAM.maxDist && d >= 1) continue;
        depth.set(o.id, d + 1); order.push(o);
      }
    }
    this.depthOf = depth;
    this.queue = order.filter((r) => r.final && depth.get(r.id) <= STREAM.depth && !this.built.has(r.id) && !(this.job && this.job.room === r));
    for (const [id, b] of this.built) if (!depth.has(id)) this.unload(b);
  }

  install(room, d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setAttribute('aLight', new THREE.BufferAttribute(d.light, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(d.tint, 3));
    g.setAttribute('aMW', new THREE.BufferAttribute(d.mw, 2));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, this.mats.surface);
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    let water = null;
    if (d.windex.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(d.wpos, 3));
      wg.setAttribute('aLight', new THREE.BufferAttribute(d.wlight, 3));
      wg.setIndex(new THREE.BufferAttribute(d.windex, 1));
      wg.computeBoundingSphere();
      water = new THREE.Mesh(wg, this.mats.water);
      water.matrixAutoUpdate = false; water.layers.set(1);
      this.scene.add(water);
    }
    const bb = bbOf(room);
    this.col.add(room.id, bb, d);
    this.built.set(room.id, { room, mesh, water, lights: d.lights, waters: d.waters, bb, spawn: d.spawn });
    room.built = true;
    this.stats.rooms = this.built.size; this.stats.tris += d.index.length / 3;
    this.refreshCurtains();
  }

  unload(b) {
    this.scene.remove(b.mesh); b.mesh.geometry.dispose();
    this.stats.tris -= b.mesh.geometry.index.count / 3;
    if (b.water) { this.scene.remove(b.water); b.water.geometry.dispose(); }
    this.col.remove(b.room.id);
    this.built.delete(b.room.id); b.room.built = false;
    this.stats.rooms = this.built.size;
    this.refreshCurtains();
  }

  portalRect(room, pp) {
    const o = roomOrigin(room), p = pp.p, c = (pp.a + 0.5) * CS;
    const y0 = o[1] + pp.r * LH + T + (p.wet ? FLOOD_FLOOR : 0) + p.sill, y1 = o[1] + pp.r * LH + T + p.sill + p.h;
    const xs = pp.side < 2, plane = pp.side === 0 ? o[0] : pp.side === 1 ? o[0] + room.ni * CS : pp.side === 2 ? o[2] : o[2] + room.nk * CS;
    return { xs, plane, c: (xs ? o[2] : o[0]) + c, y0, y1, w: p.w };
  }

  refreshCurtains() {
    const need = new Map();
    for (const b of this.built.values()) for (const pp of b.room.portals) {
      if (!this.built.has(pp.other)) need.set(pp.p.id, [b.room, pp]);
    }
    for (const [id, m] of this.curtains) if (!need.has(id)) { this.scene.remove(m); this.col.remove('p' + id); this.curtains.delete(id); }
    for (const [id, [room, pp]] of need) {
      if (this.curtains.has(id)) continue;
      const q = this.portalRect(room, pp), m = new THREE.Mesh(this.planeGeo, this.mats.curtain);
      m.scale.set(q.w + 0.1, q.y1 - q.y0 + 0.1, 1);
      m.position.set(q.xs ? q.plane : q.c, (q.y0 + q.y1) / 2, q.xs ? q.c : q.plane);
      if (q.xs) m.rotation.y = Math.PI / 2;
      this.scene.add(m); this.curtains.set(id, m);
      if (pp.p.kind !== K.WIN) {
        const h = q.w / 2, bx = q.xs ? [q.plane - 0.15, q.y0 - 1, q.c - h, q.plane + 0.15, q.y1, q.c + h] : [q.c - h, q.y0 - 1, q.plane - 0.15, q.c + h, q.y1, q.plane + 0.15];
        this.col.add('p' + id, [bx[0] - 1, bx[1], bx[2] - 1, bx[3] + 1, bx[4], bx[5] + 1], { boxes: new Float32Array(bx), cyls: [], secs: [], shells: [], waters: [] });
      }
    }
  }

  // avanza la construcción pendiente durante `budget` ms
  work(budget) {
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (!this.job) {
        const room = this.queue.shift();
        if (!room) return false;
        if (this.built.has(room.id)) continue;
        this.job = { room, gen: buildRoom(room) };
      }
      const r = this.job.gen.next();
      if (r.done) { const room = this.job.room; this.job = null; if (this.depthOf.has(room.id)) this.install(room, r.value); }
    }
    return true;
  }

  // carga inicial: generador que devuelve el progreso 0..1
  *boot() {
    this.cur = this.layout.start();
    this.plan();
    const first = this.queue.filter((r) => this.depthOf.get(r.id) <= 2), total = first.length;
    while (first.some((r) => !this.built.has(r.id))) {
      this.work(12);
      yield first.filter((r) => this.built.has(r.id)).length / total;
    }
    return this.built.get(this.cur.id).spawn;
  }

  update(x, y, z, budget = STREAM.budgetMs) {
    const r = this.layout.roomAtWorld(x, y, z);
    if (r && r !== this.cur && r.final) { this.cur = r; this.plan(); }
    this.work(budget);
  }

  // paneles de techo más cercanos a la cámara → uniformes del especular
  nearLights(cam, uLP, uLC) {
    const cand = [];
    for (const [id, b] of this.built) {
      const d = this.depthOf.get(id);
      if (d === undefined || d > 1) continue;
      for (const l of b.lights) cand.push([Math.hypot(l.x - cam.x, (l.y - cam.y) * 0.5, l.z - cam.z), l]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < 8; i++) {
      const c = cand[i];
      if (c) { const l = c[1], e = Math.min(4.5, 1.2 + l.P * 0.12); uLP[i].set(l.x, l.y, l.z, l.sx); uLC[i].set(l.col[0] * e, l.col[1] * e, l.col[2] * e, l.sz); }
      else { uLP[i].set(0, -1e4, 0, 0); uLC[i].set(0, 0, 0, 0); }
    }
  }

  // información acústica/ambiental de la sala actual
  ambience(x, y, z) {
    const r = this.cur, b = this.built.get(r.id);
    let wd = 1e9, wx = 0, wy = 0, wz = 0;
    for (const [id, o] of this.built) {
      if ((this.depthOf.get(id) ?? 9) > 1) continue;
      for (const w of o.waters) {
        const px = w.r !== undefined ? w.cx : Math.max(w.x0, Math.min(w.x1, x)), pz = w.r !== undefined ? w.cz : Math.max(w.z0, Math.min(w.z1, z));
        const d = Math.hypot(px - x, w.y - y, pz - z);
        if (d < wd) { wd = d; wx = px; wy = w.y; wz = pz; }
      }
    }
    return { zone: r.zone, vol: r.ni * r.nk * r.nl, mood: r.mood, arch: r.arch, waterDist: wd, water: [wx, wy, wz], lit: b ? b.lights.length : 0 };
  }
}
