// Arquetipos verticales y monumentales: escalinatas, atrios con galerías,
// torres de escalera helicoidal y rotondas con cúpula escalonada.
import { T, M, K } from '../config.js';
import { Rng } from '../rng.js';
import { perim } from './layout.js';
import { kit, poolLight, panelGrid } from './builders_pool.js';

const TAU = Math.PI * 2;
const emitMat = (col, e) => ({ t: M.TRIM, s: M.TRIM, b: M.EMIT, tint: [0.8, 0.8, 0.8], emit: [col[0] * e, col[1] * e, col[2] * e] });
function sconce(B, x, y, z, col, P) {
  B.box(x - 0.12, y - 0.2, z - 0.12, x + 0.12, y + 0.2, z + 0.12, { t: M.EMIT, s: M.EMIT, b: M.EMIT, tint: col, ns: true, nc: true, emit: [col[0] * 3, col[1] * 3, col[2] * 3] });
  B.light(x, y, z, { type: 1, col, P });
}

export const stairs = {
  name: 'stairs', zone: 'any', open: 0.5, maxOut: 4, minOut: 2,
  w: (c) => (c.zone === 'pool' ? 0.95 : 0.4),
  plan: (rng) => ({ nu: rng.pick([1, 1, 2, 2, 3]), nv: rng.pick([2, 3, 3]), nl: 2, b: 0, v: {} }),
  slots(r) {
    const s = [];
    for (let a = 0; a < r.nu; a++) s.push({ side: 2, a, r: 0, k: K.WALK }, { side: 3, a, r: 1, k: K.WALK });
    if (r.nv === 3) for (const side of [0, 1]) s.push({ side, a: 0, r: 0, k: K.DOOR | K.ARCH }, { side, a: 2, r: 1, k: K.DOOR | K.ARCH });
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B;
    B.walls(k.wall, k.trim);
    const zs = room.nv === 3 ? 6.3 : 3.0, ze = zs + 5.4, y1 = yd + 4;
    B.floor(0, 0, W, D, yd, k.deck);
    B.steps(0, zs, W, ze, 2, yd, y1, k.deck);
    B.floor(0, ze, W, D, y1, k.deck);
    B.ceil(H - T, k.ceil);
    const dead = k.lux <= 0, lc = dead ? [0.05, 0.05, 0.05] : k.col;
    for (let x = 3; x < W; x += 6) {
      B.panel(x, zs / 2, H - T, 0.7, 0.7, lc, dead ? 0 : B.P(k.lux, 7.4), dead ? 1 : 3.6);
      B.panel(x, (ze + D) / 2, H - T, 0.7, 0.7, lc, dead ? 0 : B.P(k.lux * 0.8, 3.4), dead ? 1 : 3.6);
    }
    if (dead) sconce(B, T + 0.1, yd + 2.2, (zs + ze) / 2, [0.2, 0.8, 0.75], 5);
  },
};

const fside = (f) => (f % 2 ? 3 : 2);
export const atrium = {
  name: 'atrium', zone: 'pool', open: 0.3, maxOut: 10, minOut: 4,
  w: (c) => (c.from && c.from.big ? 0.1 : 0.35 + c.tens * 0.3),
  plan(rng) {
    const nu = rng.int(3, 5), nv = rng.int(3, 5), nl = rng.int(3, 5), sc = [];
    for (let f = 0; f < nl - 2; f++) sc.push(rng.int(1, nu - 2));
    return { nu, nv, nl, b: 1, v: { sc, depth: rng.range(2.2, 3.3), ss: rng.pick([0, 1]) } };
  },
  slots(r) {
    const sc = r.v.sc, G = r.nl - 2;
    const s = perim(r.nu, r.nv, 1, K.WALK, (q) => !(q.side === 2 && q.a === sc[0]));
    for (let f = 0; f < G; f++) {
      s.push(...perim(r.nu, r.nv, 2 + f, K.WALK, (q) => !(q.side === fside(f) && q.a === sc[f]) && !(f + 1 < G && q.side === fside(f + 1) && q.a === sc[f + 1])));
    }
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, v = room.v, G = room.nl - 2, g = 3.0, dm = 4.5;
    B.amb = B.amb.map((c) => c * 1.5);
    B.walls(k.wall, k.trim);
    const yw = yd - 0.25, yf = yw - v.depth, bz = [dm, dm, W - dm, D - dm];
    B.slab(0, 0, W, D, 0, yd, [[bz[0], bz[2], bz[1], bz[3]]], k.deck);
    B.floor(bz[0], bz[1], bz[2], bz[3], yf, k.basin);
    B.water(bz[0], bz[1], bz[2], bz[3], yw); B.waterY = yw;
    if (v.ss === 0) B.steps(bz[0], bz[1], bz[0] + 2.4, bz[3], 1, yd - 1.2, yd, k.deck);
    else B.steps(bz[2] - 2.4, bz[1], bz[2], bz[3], 0, yd - 1.2, yd, k.deck);
    // tramos de escalera pegados a los muros, alternando de lado en cada planta; ocupan
    // media galería para que el anillo de cada planta siga siendo transitable
    for (let f = 0; f < G; f++) {
      const yl = (1 + f) * 4 + T, xs = v.sc[f] * 6 + 0.3, s2 = fside(f) === 2;
      B.steps(xs, s2 ? T : D - 1.8, xs + 5.4, s2 ? 1.8 : D - T, 0, yl, yl + 4, k.deck, f === 0 ? 0 : yl);
    }
    // galerías perimetrales con peto y hueco para el tramo que llega desde abajo
    const pm = { ...k.wall, tt: k.trim.tint };
    for (let f = 0; f < G; f++) {
      const yl = (2 + f) * 4 + T, xs = v.sc[f] * 6 + 0.3, s2 = fside(f) === 2;
      B.slab(0, 0, W, D, yl - 0.3, yl, [[g, W - g, g, D - g], [xs, xs + 5.4, s2 ? 0 : D - 1.8, s2 ? 1.8 : D]], { ...k.deck, s: M.TILE, tint: room.style.wall });
      B.box(g - 0.15, yl, g - 0.15, W - g + 0.15, yl + 1, g, pm); B.box(g - 0.15, yl, D - g, W - g + 0.15, yl + 1, D - g + 0.15, pm);
      B.box(g - 0.15, yl, g, g, yl + 1, D - g, pm); B.box(W - g, yl, g, W - g + 0.15, yl + 1, D - g, pm);
      for (const [x, z] of [[1.5, 1.5], [W - 1.5, 1.5], [1.5, D - 1.5], [W - 1.5, D - 1.5]]) B.panel(x, z, yl - 0.3, 0.35, 0.35, k.lux > 0 ? k.col : [0.05, 0.05, 0.05], k.lux > 0 ? B.P(k.lux * 0.5, 3.7) : 0, 2.6);
    }
    // pilares monumentales en la línea de galería
    const yc = H - T, pil = (x, z) => B.box(x - 0.3, yd, z - 0.3, x + 0.3, yc, z + 0.3, k.wall);
    for (let x = 6; x < W - 1; x += 6) { pil(x, g); pil(x, D - g); }
    for (let z = 6; z < D - 1; z += 6) { pil(g, z); pil(W - g, z); }
    pil(g, g); pil(W - g, g); pil(g, D - g); pil(W - g, D - g);
    // gran lucernario de casetones
    const bw = bz[2] - bz[0], bd = bz[3] - bz[1], nx = Math.max(1, Math.round(bw / 4.5)), nz = Math.max(1, Math.round(bd / 4.5)), holes = [];
    const dead = k.lux <= 0, lc = dead ? [0.04, 0.05, 0.06] : k.col, hh = yc - yd;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = bz[0] + bw * (i + 0.5) / nx, z = bz[1] + bd * (j + 0.5) / nz, hs = Math.min(1.7, bw / nx / 2 - 0.4, bd / nz / 2 - 0.4);
      holes.push([x - hs, x + hs, z - hs, z + hs]);
      B.panel(x, z, yc, hs, hs, lc, dead ? 0 : B.P(k.lux * 1.25, hh) / (nx * nz) + 5, dead ? 1 : 5);
    }
    B.slab(0, 0, W, D, yc - 1.1, H, holes, k.ceil);
    B.ceil(yc, k.ceil);
    for (let z = bz[1] + 2; z < bz[3] - 1; z += 5) { poolLight(B, k, bz[0] + 0.1, yw - 1, z, k.night ? 12 : 3); poolLight(B, k, bz[2] - 0.1, yw - 1, z, k.night ? 12 : 3); }
    B.glow = k.pool.map((c) => c * 0.14);
  },
};

export const tower = {
  name: 'tower', zone: 'any', open: 0.6, maxOut: 9, minOut: 3,
  w: (c) => (c.zone === 'pool' ? 0.85 : 0.3),
  plan(rng, c) {
    const big = rng.chance(c.zone === 'pool' ? 0.6 : 0.12), n = big ? 3 : 1;
    return { nu: n, nv: n, nl: rng.int(3, big ? 6 : 5), b: 1, v: { big } };
  },
  slots(r) {
    const s = [];
    for (let l = 1; l < r.nl; l++) {
      if (r.v.big) for (let side = 0; side < 4; side++) s.push({ side, a: 1, r: l, k: K.WALK });
      else s.push({ side: [1, 2, 0, 3][(l - 1) % 4], a: 0, r: l, k: K.DOOR | K.ARCH });
    }
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, big = room.v.big, c = W / 2, R = c - T - 0.04;
    const pz = room.zone === 'pool', basin = k.basin || k.deck;
    B.walls(k.wall, k.trim);
    const yf = T + 0.6, yw = yd - 0.25;
    B.floor(0, 0, W, D, yf, basin);
    B.shell(c, c, R, 0, H, k.wall);
    B.ceil(H - T, k.ceil);
    const rc = big ? 1.5 : 0.45, rin = big ? 6.2 : R + 0.3, per = big ? 24 : 18, da = TAU / 24, rise = 4 / per;
    B.cyl(c, c, rc, 0, H, k.wall, false);
    const sm = { t: k.deck.t, s: k.trim.s, b: k.wall.t, tint: k.trim.tint, tt: k.deck.tt || k.deck.tint };
    const nTop = per * (room.nl - 2), nBot = -Math.floor((yd - yf) / rise);
    for (let n = nBot; n <= nTop; n++) {
      const top = yd + n * rise;
      B.sector(c, c, rc - 0.05, rin, n * da - da / 2, n * da + da / 2, top - 0.24, top, sm, big ? 1 | 2 | 8 | 16 : 1 | 2 | 16);
    }
    if (big) for (let l = 1; l < room.nl; l++) {
      const yl = l * 4 + T;
      B.sector(c, c, rin, R + 0.3, 0, TAU, l === 1 ? 0 : yl - 0.3, yl, { t: k.deck.t, s: k.wall.t, b: k.wall.t, tint: room.style.wall, tt: k.deck.tt || k.deck.tint }, 1 | 2 | 4);
    }
    B.waterDisc(c, c, rin, yw);
    if (pz) { B.waterY = yw; B.glow = k.pool.map((x) => x * 0.12); }
    const lit = k.lux > 0, lc = lit ? k.col : [0.05, 0.06, 0.07];
    if (big) {
      B.sector(c, c, 2.4, 5.4, 0, TAU, H - T - 0.06, H - T, emitMat(lc, lit ? 4.5 : 1), 2);
      if (lit) for (let i = 0; i < 4; i++) B.light(c + Math.cos(i * 1.571) * 3.9, H - T - 0.15, c + Math.sin(i * 1.571) * 3.9, { sx: 1.4, sz: 1.4, col: lc, P: (9 + room.nl * 6) * k.lux });
    } else {
      B.sector(c, c, 0.9, 2.0, 0, TAU, H - T - 0.06, H - T, emitMat(lc, lit ? 4 : 1), 2);
      if (lit) for (let i = 0; i < 2; i++) B.light(c + (i ? 1.45 : -1.45), H - T - 0.15, c, { sx: 0.5, sz: 0.5, col: lc, P: (9 + room.nl * 4) * k.lux });
    }
    // apliques en cada planta para que el fuste no quede a oscuras
    for (let l = 1; l < room.nl; l++) {
      const a = l * 1.7 + 0.8, rr = R - 0.18;
      sconce(B, c + Math.cos(a) * rr, l * 4 + T + 2.7, c + Math.sin(a) * rr, pz ? [1, 0.86, 0.66] : k.col, (big ? 5 : 2.2) * (lit ? 1 : 0.6));
    }
    if (pz) { const rr = big ? rin - 0.5 : R - 0.5; B.light(c + rr * 0.7, yf + 0.7, c + rr * 0.7, { type: 1, col: k.pool, P: big ? 14 : 5 }); }
  },
};

export const rotunda = {
  name: 'rotunda', zone: 'pool', open: 0.8, maxOut: 4, minOut: 2,
  w: (c) => (c.from && c.from.arch === 'rotunda' ? 0 : 0.5 + c.tens * 0.12),
  plan: (rng) => ({ nu: 3, nv: 3, nl: 3, b: 1, v: { island: rng.int(0, 2) } }),
  slots() { return [0, 1, 2, 3].map((side) => ({ side, a: 1, r: 1, k: K.WALK })); },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, c = W / 2, R = c - T - 0.04, r1 = 5.6, yw = yd - 0.25, yf = yd - 2.9;
    B.walls(k.wall, k.trim);
    B.shell(c, c, R, 0, H, k.wall);
    B.floor(0, 0, W, D, yf, k.basin);
    B.sector(c, c, r1, R + 0.3, 0, TAU, 0, yd, k.deck, 1 | 4);
    for (let j = 0; j < 7; j++) B.sector(c, c, r1 - (j + 1) * 0.45, r1 - j * 0.45, 0, TAU, 0, yd - (j + 1) * 0.2, k.deck, 1 | 4);
    B.waterDisc(c, c, r1, yw); B.waterY = yw;
    const lit = k.lux > 0, lc = lit ? k.col : [0.04, 0.05, 0.06];
    if (room.v.island === 1) B.cyl(c, c, 1.1, yf, yd + 0.06, k.deck);
    else if (room.v.island === 2) B.cyl(c, c, 0.38, yf, H - T - 0.05, k.wall, false);
    // cúpula escalonada con óculo luminoso
    const h0 = H - T - 2.6;
    for (let j = 0; j < 5; j++) {
      const ro = R + 0.3 - j * 1.45;
      B.sector(c, c, ro - 1.45, ro, 0, TAU, h0 + j * 0.52, H, { t: k.ceil.t, s: k.wall.t, b: k.ceil.b, tint: room.style.wall }, 2 | 4);
    }
    const ri = R + 0.3 - 5 * 1.45;
    B.sector(c, c, 0, ri, 0, TAU, H - T - 0.05, H - T, emitMat(lc, lit ? 5 : 1), 2);
    B.ceil(H - T, k.ceil);
    if (lit) B.light(c + (room.v.island === 2 ? 0.9 : 0), H - T - 0.2, c, { sx: 1.1, sz: 1.1, col: lc, P: 95 });
    for (let i = 0; i < 3; i++) poolLight(B, k, c + Math.cos(i * 2.094) * 2.3, yf + 0.5, c + Math.sin(i * 2.094) * 2.3, k.night ? 12 : 4);
    B.glow = k.pool.map((x) => x * (k.night ? 0.12 : 0.16));
  },
};
