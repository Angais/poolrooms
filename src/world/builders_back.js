// Estilos minoritarios inspirados en los Backrooms clásicos: oficinas amarillas
// (moqueta, papel pintado, fluorescentes) y sótanos de hormigón a oscuras.
import { T, M, K } from '../config.js';
import { Rng } from '../rng.js';
import { perim } from './layout.js';
import { kit } from './builders_pool.js';

export const office = {
  name: 'office', zone: 'yellow', open: 0.45, maxOut: 5, minOut: 2,
  w: () => 4,
  plan: (rng) => ({ nu: rng.int(2, 4), nv: rng.int(2, 4), nl: 1, b: 0, v: { off: rng.range(0.15, 0.5), braid: rng.range(0.35, 0.7) } }),
  slots: (r) => perim(r.nu, r.nv, 0, K.WALK),
  build(B, room) {
    const k = kit(B), { W, D, yd } = B, v = room.v, rng = new Rng(room.seed);
    const gx = room.nu * 2, gz = room.nv * 2, yc = yd + 2.75;
    B.walls(k.wall, k.trim);
    B.floor(0, 0, W, D, yd, k.deck);
    B.ceil(yc, k.ceil);
    // laberinto: árbol generador (garantiza conexión total) + aperturas extra
    const open = new Set(), seen = new Set(['0,0']), stack = [[0, 0]];
    const ek = (i, j, d) => i + ',' + j + ',' + d;       // d=0: muro entre (i,j)-(i+1,j); d=1: (i,j)-(i,j+1)
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const nb = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([a, b]) => [i + a, j + b])
        .filter(([a, b]) => a >= 0 && b >= 0 && a < gx && b < gz && !seen.has(a + ',' + b));
      if (!nb.length) { stack.pop(); continue; }
      const [a, b] = nb[0];
      open.add(a !== i ? ek(Math.min(a, i), j, 0) : ek(i, Math.min(b, j), 1));
      seen.add(a + ',' + b); stack.push([a, b]);
    }
    const wm = k.wall, h = 0.12;
    for (let i = 0; i < gx; i++) for (let j = 0; j < gz; j++) {
      if (i < gx - 1 && !open.has(ek(i, j, 0)) && !rng.chance(v.braid) && !((i + 1) % 2 === 1 && (j === 0 || j === gz - 1))) {
        const x = 3 * (i + 1);
        B.box(x - h, 0, Math.max(T, 3 * j - h), x + h, yc, Math.min(D - T, 3 * j + 3 + h), wm);
      }
      if (j < gz - 1 && !open.has(ek(i, j, 1)) && !rng.chance(v.braid) && !((j + 1) % 2 === 1 && (i === 0 || i === gx - 1))) {
        const z = 3 * (j + 1);
        B.box(Math.max(T, 3 * i - h), 0, z - h, Math.min(W - T, 3 * i + 3 + h), yc, z + h, wm);
      }
      if ((i + j) % 2 === 0) {
        const dead = rng.chance(v.off);
        B.panel(3 * i + 1.5, 3 * j + 1.5, yc, 0.3, 0.6, dead ? [0.07, 0.07, 0.05] : k.col, dead ? 0 : B.P(k.lux * 0.62, 2.75), dead ? 1 : 3.4);
      }
    }
  },
};

export const garage = {
  name: 'garage', zone: 'concrete', open: 0.42, maxOut: 5, minOut: 2,
  w: () => 3,
  plan: (rng) => ({ nu: rng.int(2, 4), nv: rng.int(2, 4), nl: rng.pick([1, 1, 2]), b: 0, v: { off: rng.range(0.45, 0.85), pud: rng.int(1, 3) } }),
  slots: (r) => perim(r.nu, r.nv, 0, K.WALK),
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, v = room.v, rng = new Rng(room.seed), yc = H - T;
    B.walls(k.wall, k.trim);
    B.floor(0, 0, W, D, yd, k.deck);
    B.ceil(yc, k.ceil);
    for (let x = 6; x < W - 1; x += 6) for (let z = 6; z < D - 1; z += 6) B.box(x - 0.35, 0, z - 0.35, x + 0.35, yc, z + 0.35, k.wall);
    for (let z = 6; z < D - 1; z += 6) B.box(T, yc - 0.5, z - 0.3, W - T, yc, z + 0.3, { ...k.ceil, nc: true });
    const pipe = B.mat(M.TRIM, M.TRIM, M.TRIM, [0.3, 0.13, 0.1], { nc: true, ns: true });
    B.box(0.9, yc - 0.95, T, 1.2, yc - 0.65, D - T, pipe); B.box(1.35, yc - 0.85, T, 1.5, yc - 0.7, D - T, pipe);
    let lit = 0;
    for (let x = 3; x < W; x += 6) for (let z = 3; z < D; z += 6) {
      const dead = rng.chance(v.off) && !(lit === 0 && x > W - 6 && z > D - 6);
      if (!dead) lit++;
      B.panel(x, z, yc, 0.12, 0.75, dead ? [0.04, 0.04, 0.045] : k.col, dead ? 0 : B.P(k.lux, yc - yd), dead ? 1 : 4);
    }
    for (let i = 0; i < v.pud; i++) {
      const x = rng.range(1, W - 5), z = rng.range(1, D - 5);
      B.water(x, z, x + rng.range(1.5, 3.5), z + rng.range(1.5, 3.5), yd + 0.012 + i * 0.002);
    }
  },
};

export const duct = {
  name: 'duct', zone: 'concrete', open: 1, maxOut: 2, minOut: 1,
  w: (c) => (c.from && c.from.arch === 'duct' ? 0.6 : 2),
  plan: (rng) => ({ nu: 1, nv: rng.int(2, 4), nl: 1, b: 0, v: { off: rng.range(0.3, 0.8) } }),
  slots: () => [{ side: 2, a: 0, r: 0, k: K.DOOR }, { side: 3, a: 0, r: 0, k: K.DOOR }],
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, rng = new Rng(room.seed), yc = yd + 2.45;
    B.walls(k.wall, k.trim);
    B.floor(0, 0, W, D, yd, k.deck);
    B.ceil(yc, k.ceil);
    B.box(T, 0, 0, 1.8, H, D, k.wall); B.box(4.2, 0, 0, W - T, H, D, k.wall);
    const pipe = B.mat(M.TRIM, M.TRIM, M.TRIM, [0.3, 0.13, 0.1], { nc: true, ns: true });
    B.box(1.8, yd + 1.95, T, 2.02, yd + 2.17, D - T, pipe); B.box(1.8, yd + 1.6, T, 1.94, yd + 1.74, D - T, pipe);
    for (let z = 3; z < D; z += 6) {
      if (rng.chance(room.v.off)) continue;
      const c = [1, 0.45, 0.2];
      B.box(4.08, yd + 2.0, z - 0.1, 4.2, yd + 2.2, z + 0.1, { t: M.EMIT, s: M.EMIT, b: M.EMIT, tint: c, ns: true, nc: true, emit: [3, 1.3, 0.6] });
      B.light(3.9, yd + 2.1, z, { type: 1, col: c, P: 2.2 });
    }
  },
};
