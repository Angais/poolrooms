// RoomBuilder: API con la que los arquetipos describen una sala a base de sólidos
// (cajas alineadas a ejes, cilindros, sectores anulares y cáscaras cilíndricas),
// luces y láminas de agua. Los constructores trabajan en un marco local (u,y,v)
// que luego se rota (múltiplos de 90°) al marco de la sala.
import { CS, LH, T, M, K, FLOOD_FLOOR, FLOOD_WATER, STEP_RISE } from '../config.js';
import { fwd, inv } from './layout.js';

// resta de rectángulos: devuelve trozos [u0,u1,v0,v1] de la zona no cubierta
export function rectMinus(u0, u1, v0, v1, holes) {
  const us = [u0, u1], vs = [v0, v1];
  for (const h of holes) {
    if (h[0] > u0 && h[0] < u1) us.push(h[0]); if (h[1] > u0 && h[1] < u1) us.push(h[1]);
    if (h[2] > v0 && h[2] < v1) vs.push(h[2]); if (h[3] > v0 && h[3] < v1) vs.push(h[3]);
  }
  const uniq = (a) => a.sort((x, y) => x - y).filter((x, i) => i === 0 || x - a[i - 1] > 1e-4);
  const U = uniq(us), V = uniq(vs), out = [];
  for (let i = 0; i < U.length - 1; i++) {
    const uc = (U[i] + U[i + 1]) / 2;
    let run = null;
    for (let j = 0; j < V.length - 1; j++) {
      const vc = (V[j] + V[j + 1]) / 2;
      const cov = holes.some((h) => uc > h[0] && uc < h[1] && vc > h[2] && vc < h[3]);
      if (cov) { if (run) out.push(run); run = null; }
      else if (run) run[3] = V[j + 1];
      else run = [U[i], U[i + 1], V[j], V[j + 1]];
    }
    if (run) out.push(run);
  }
  return out;
}

const SIDE_ANGLE = [Math.PI, 0, -Math.PI / 2, Math.PI / 2];

export class RoomBuilder {
  constructor(room) {
    this.room = room;
    this.W = room.nu * CS; this.D = room.nv * CS; this.H = room.nl * LH;
    this.yd = room.b * LH + T;                 // cota del suelo seco principal
    this.st = room.style;
    this.boxes = []; this.cyls = []; this.secs = []; this.shells = [];
    this.lights = []; this.waters = [];
    this.waterY = -1e4;                        // cota de agua para cáusticas (local)
    this.amb = [0.1, 0.1, 0.1];
    this.glow = null;                          // rebote de luz del agua
    this.spawn = null;
    this.sub = room.ni * room.nk * room.nl > 40 ? 1.5 : 1.0;   // subdivisión de horneado
    this.portals = room.portals.map((pp) => this._portal(pp));
  }

  _portal(pp) {
    const room = this.room, p = pp.p, c0 = (pp.a + 0.5) * CS;
    const RW = room.ni * CS, RD = room.nk * CS;
    const rp = pp.side === 0 ? [0, c0] : pp.side === 1 ? [RW, c0] : pp.side === 2 ? [c0, 0] : [c0, RD];
    const [u, v] = inv(room, rp[0], rp[1]);
    const side = u < 0.01 ? 0 : u > this.W - 0.01 ? 1 : v < 0.01 ? 2 : 3;
    const c = side < 2 ? v : u;
    const lvl = pp.r * LH + T;
    const y0 = lvl + (p.wet ? FLOOD_FLOOR : 0) + p.sill;
    return {
      side, c, r: pp.r, kind: p.kind, wet: p.wet, walk: p.kind !== K.WIN, w: p.w, lvl,
      u0: c - p.w / 2, u1: c + p.w / 2, y0, y1: lvl + p.sill + p.h, id: p.id, other: pp.other,
    };
  }

  mat(t, s, b, tint, extra) { return { t, s: s ?? t, b: b ?? s ?? t, tint: tint || [1, 1, 1], ...extra }; }

  box(x0, y0, z0, x1, y1, z1, m) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return null;
    const p = fwd(this.room, x0, z0), q = fwd(this.room, x1, z1);
    const bx = {
      a: [Math.min(p[0], q[0]), y0, Math.min(p[1], q[1])],
      b: [Math.max(p[0], q[0]), y1, Math.max(p[1], q[1])],
      t: m.t, s: m.s, bm: m.b, tint: m.tint, tt: m.tt || m.tint, tb: m.tb || m.tint,
      pri: m.pri || 0, ns: !!m.ns, nc: !!m.nc, emit: m.emit || null,
    };
    this.boxes.push(bx);
    return bx;
  }
  floor(x0, z0, x1, z1, h, m) { return this.box(x0, 0, z0, x1, h, z1, m); }
  ceil(y, m) { return this.box(0, y, 0, this.W, this.H, this.D, m); }
  // losa horizontal con huecos rectangulares [x0,x1,z0,z1]
  slab(x0, z0, x1, z1, y0, y1, holes, m) {
    for (const r of rectMinus(x0, x1, z0, z1, holes)) this.box(r[0], y0, r[2], r[1], y1, r[3], m);
  }

  // Muros perimetrales con los huecos de los portales, umbrales y agua en pasos inundados.
  walls(m, trim) {
    const { W, D, H } = this;
    for (let side = 0; side < 4; side++) {
      const L = side < 2 ? D : W;
      const ps = this.portals.filter((p) => p.side === side);
      const holes = ps.map((p) => [p.u0, p.u1, p.y0, p.y1]);
      for (const r of rectMinus(0, L, 0, H, holes)) this._wallBox(side, r[0], r[1], r[2], r[3], m);
      for (const p of ps) {
        if (!p.walk) { this._wallBox(side, p.u0, p.u1, p.y0, p.y1, { ...m, nc: false, invisible: true }, true); continue; }
        this._wallBox(side, p.u0, p.u1, Math.max(0, p.y0 - 0.05), p.y0, { ...trim, pri: 5 });   // umbral
        if (p.wet) this._wallWater(side, p.u0, p.u1, p.lvl + FLOOD_WATER);
      }
    }
  }
  _wallBox(side, u0, u1, y0, y1, m, ghost) {
    const { W, D } = this;
    const b = side === 0 ? this.box(0, y0, u0, T, y1, u1, m) : side === 1 ? this.box(W - T, y0, u0, W, y1, u1, m)
      : side === 2 ? this.box(u0, y0, 0, u1, y1, T, m) : this.box(u0, y0, D - T, u1, y1, D, m);
    if (b && ghost) b.ghost = true;       // colisión sin geometría (cristal de ventana)
  }
  _wallWater(side, u0, u1, y) {
    const { W, D } = this;
    if (side === 0) this.water(0, u0, T, u1, y); else if (side === 1) this.water(W - T, u0, W, u1, y);
    else if (side === 2) this.water(u0, 0, u1, T, y); else this.water(u0, D - T, u1, D, y);
  }

  // Rectángulo libre delante de un portal (para descansillos), profundidad d
  landing(p, d, pad = 0.5) {
    const { W, D } = this, a = p.u0 - pad, b = p.u1 + pad;
    if (p.side === 0) return [T, a, T + d, b];
    if (p.side === 1) return [W - T - d, a, W - T, b];
    if (p.side === 2) return [a, T, b, T + d];
    return [a, D - T - d, b, D - T];
  }
  // Descansillo seco + peldaños hacia un suelo más bajo `yf` delante de un portal
  stoop(p, yf, m) {
    const d = 1.3, r = this.landing(p, d), n = Math.max(1, Math.round((p.lvl - yf) / STEP_RISE));
    this.box(r[0], 0, r[1], r[2], p.lvl, r[3], m);
    const run = n * 0.32, s = p.side;
    const q = this.landing(p, d + run);
    if (s === 0) this.steps(r[2], q[1], q[2], q[3], 1, yf, p.lvl, m);
    else if (s === 1) this.steps(q[0], q[1], r[0], q[3], 0, yf, p.lvl, m);
    else if (s === 2) this.steps(q[0], r[3], q[2], q[3], 3, yf, p.lvl, m);
    else this.steps(q[0], q[1], q[2], r[1], 2, yf, p.lvl, m);
  }

  // Peldaños macizos. dir: 0 sube hacia +x, 1 hacia −x, 2 hacia +z, 3 hacia −z
  steps(x0, z0, x1, z1, dir, yLo, yHi, m, base = 0) {
    const n = Math.max(1, Math.round((yHi - yLo) / STEP_RISE)), rise = (yHi - yLo) / n;
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n, top = yLo + (i + 1) * rise - (i === n - 1 ? 0 : 0);
      const mm = { ...m, ns: i % 4 !== 3 };
      if (dir === 0) this.box(x0 + (x1 - x0) * f0, base, z0, x0 + (x1 - x0) * f1, top, z1, mm);
      else if (dir === 1) this.box(x1 - (x1 - x0) * f1, base, z0, x1 - (x1 - x0) * f0, top, z1, mm);
      else if (dir === 2) this.box(x0, base, z0 + (z1 - z0) * f0, x1, top, z0 + (z1 - z0) * f1, mm);
      else this.box(x0, base, z1 - (z1 - z0) * f1, x1, top, z1 - (z1 - z0) * f0, mm);
    }
  }

  _c(cx, cz) { return fwd(this.room, cx, cz); }
  _ang(a) { return a + this.room.rot * Math.PI / 2; }
  cyl(cx, cz, r, y0, y1, m, cap = true) {
    const c = this._c(cx, cz);
    this.cyls.push({ cx: c[0], cz: c[1], r, y0, y1, mat: m.s, mt: m.t, tint: m.tint, cap });
  }
  // sector anular macizo; faces: 1 arriba, 2 abajo, 4 interior, 8 exterior, 16 testeros
  sector(cx, cz, r0, r1, a0, a1, y0, y1, m, faces = 31) {
    const c = this._c(cx, cz), full = a1 - a0 > Math.PI * 2 - 1e-3;
    this.secs.push({
      cx: c[0], cz: c[1], r0, r1, a0: this._ang(a0), a1: this._ang(a1), y0, y1, full,
      mt: m.t, ms: m.s, mb: m.b, tint: m.tint, tt: m.tt || m.tint, faces: full ? faces & ~16 : faces, emit: m.emit || null,
    });
  }
  // cáscara cilíndrica (se ve y colisiona por dentro) con huecos en los portales
  shell(cx, cz, R, y0, y1, m) {
    const c = this._c(cx, cz);
    const gaps = this.portals.filter((p) => p.walk).map((p) => ({
      a: this._ang(SIDE_ANGLE[p.side]), half: Math.asin(Math.min(0.95, p.w / 2 / R)), y0: p.y0, y1: p.y1,
    }));
    this.shells.push({ cx: c[0], cz: c[1], R, y0, y1, gaps, mat: m.s, tint: m.tint });
  }

  light(x, y, z, o = {}) {
    const c = this._c(x, z), odd = this.room.rot & 1;
    const sx = o.sx || 0, sz = o.sz || 0;
    this.lights.push({
      x: c[0], y, z: c[1], sx: odd ? sz : sx, sz: odd ? sx : sz,
      col: o.col || [1, 1, 1], P: o.P ?? 10, type: o.type ?? 0, spec: o.type !== 1,
    });
  }
  // panel luminoso de techo: caja emisiva + luz de área
  panel(x, z, y, sx, sz, col, P, e = 3.2) {
    this.box(x - sx, y - 0.05, z - sz, x + sx, y, z + sz,
      { t: M.TRIM, s: M.TRIM, b: M.EMIT, tint: [0.8, 0.8, 0.8], ns: true, nc: true, emit: [col[0] * e, col[1] * e, col[2] * e] });
    if (P > 0) this.light(x, y - 0.1, z, { sx, sz, col, P });
  }
  // potencia para conseguir ~lux bajo un panel a `h` metros
  P(lux, h) { return lux * (h * h + 0.6); }

  water(x0, z0, x1, z1, y) {
    const p = fwd(this.room, x0, z0), q = fwd(this.room, x1, z1);
    this.waters.push({ x0: Math.min(p[0], q[0]), z0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), z1: Math.max(p[1], q[1]), y });
  }
  waterDisc(cx, cz, r, y) {
    const c = this._c(cx, cz);
    this.waters.push({ cx: c[0], cz: c[1], r, y });
  }
  setSpawn(x, y, z) { const c = this._c(x, z); this.spawn = [c[0], y, c[1]]; }
}

export { FLOOD_FLOOR, FLOOD_WATER };
