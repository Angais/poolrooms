// Arquetipos de los Poolrooms "horizontales": conectores, pasillos, piscinas y salas hipóstilas.
import { T, M, K, FLOOD_FLOOR, FLOOD_WATER } from '../config.js';
import { Rng } from '../rng.js';
import { perim } from './layout.js';

// Paleta/materiales/luz según zona, estilo y ambiente de la sala
export function kit(B) {
  const r = B.room, st = r.style;
  if (r.zone === 'yellow') {
    B.amb = [0.1, 0.088, 0.045];
    return {
      wall: B.mat(M.WALLPAPER, M.WALLPAPER, M.WALLPAPER, [0.84, 0.74, 0.36]), deck: B.mat(M.CARPET, M.CARPET, M.CARPET, [0.6, 0.52, 0.3]),
      ceil: B.mat(M.CEILGRID, M.CEILGRID, M.CEILGRID, [0.86, 0.84, 0.7]), trim: B.mat(M.TRIM, M.TRIM, M.TRIM, [0.45, 0.38, 0.18]),
      col: [1.0, 0.92, 0.6], lux: 0.8, pool: [0, 0, 0], night: false,
    };
  }
  if (r.zone === 'concrete') {
    B.amb = [0.016, 0.018, 0.021];
    return {
      wall: B.mat(M.CONCRETE, M.CONCRETE, M.CONCRETE, [0.6, 0.6, 0.58]), deck: B.mat(M.CONCRETE, M.CONCRETE, M.CONCRETE, [0.46, 0.46, 0.46]),
      ceil: B.mat(M.CONCRETE, M.CONCRETE, M.CONCRETE, [0.42, 0.42, 0.42]), trim: B.mat(M.TRIM, M.TRIM, M.TRIM, [0.22, 0.22, 0.22]),
      col: [0.86, 0.93, 1.0], lux: 0.3, pool: [0, 0, 0], night: false,
    };
  }
  const night = r.mood === 'night', dim = r.mood === 'dim';
  const a = night ? 0.012 : dim ? 0.06 : 0.15;
  B.amb = [a * 0.95, a, a * 1.04];
  return {
    wall: B.mat(M.TILE, M.TILE, M.TILE, st.wall),
    deck: { t: M.TILE, s: M.POOL, b: M.TILE, tint: st.pool, tt: st.floor, tb: st.wall },
    basin: B.mat(M.POOL, M.POOL, M.POOL, st.pool),
    ceil: B.mat(M.PLASTER, M.TILE, M.PLASTER, st.wall),
    trim: B.mat(M.TRIM, M.TRIM, M.TRIM, st.accent),
    col: dim ? [1.0, 0.9, 0.74] : [0.97, 0.99, 1.0], lux: night ? 0 : dim ? 0.5 : 1.05,
    pool: night ? [0.1, 0.85, 0.75] : [0.35, 0.9, 0.95], night,
  };
}

// foco sumergido: cajita emisiva en la pared + luz omnidireccional
export function poolLight(B, k, x, y, z, P) {
  const c = k.pool, e = 4;
  B.box(x - 0.14, y - 0.14, z - 0.14, x + 0.14, y + 0.14, z + 0.14, { t: M.EMIT, s: M.EMIT, b: M.EMIT, tint: c, ns: true, nc: true, emit: [c[0] * e, c[1] * e, c[2] * e] });
  B.light(x, y, z, { type: 1, col: c, P });
}
// rejilla de paneles de techo; devuelve nada. off = probabilidad de panel fundido
export function panelGrid(B, k, rng, x0, z0, x1, z1, y, step, sz, hFloor, off = 0) {
  const nx = Math.max(1, Math.round((x1 - x0) / step)), nz = Math.max(1, Math.round((z1 - z0) / step));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / nx, z = z0 + (z1 - z0) * (j + 0.5) / nz;
    const dead = k.lux <= 0 || rng.chance(off);
    B.panel(x, z, y, sz, sz, dead ? [0.06, 0.06, 0.06] : k.col, dead ? 0 : B.P(k.lux * 0.8, y - hFloor), dead ? 1 : 3.4);
  }
}
// suelo inundado estándar + descansillos secos en los portales no inundados
export function floodFloor(B, k) {
  const { W, D, yd } = B, yf = yd + FLOOD_FLOOR;
  B.floor(0, 0, W, D, yf, k.basin || k.deck);
  B.water(T, T, W - T, D - T, yd + FLOOD_WATER);
  B.waterY = yd + FLOOD_WATER;
  for (const p of B.portals) if (p.walk && !p.wet) B.stoop(p, yf, k.deck);
  return yf;
}

const any = () => true;

export const link = {
  name: 'link', zone: 'any', open: 0.6, maxOut: 3,
  w: (c) => (c.from && c.from.arch === 'link' ? 0.1 : 0.3),
  plan: (rng, c) => ({ nu: 1, nv: 1, nl: 1, b: 0, flooded: c.zone === 'pool' && rng.chance(0.3), v: { col: rng.chance(0.3), low: rng.chance(0.45) } }),
  slots: () => perim(1, 1, 0, K.DOOR | K.ARCH),
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, rng = new Rng(room.seed);
    B.walls(k.wall, k.trim);
    const yf = room.flooded ? floodFloor(B, k) : (B.floor(0, 0, W, D, yd, k.deck), yd);
    const yc = room.v.low ? yd + 2.75 : H - T;
    B.ceil(yc, k.ceil);
    if (room.v.col && !room.flooded) B.cyl(W / 2, D / 2, 0.3, yf, yc, k.wall, false);
    const off = room.v.col ? 1.5 : 0;
    B.panel(W / 2 + off, D / 2 + off, yc, 0.5, 0.5, k.lux > 0 ? k.col : [0.05, 0.05, 0.05], k.lux > 0 ? B.P(k.lux * 0.9, yc - yf) : 0);
    if (k.night) poolLight(B, k, W / 2, yd - 0.35, T + 0.1, 5);
    if (room.flooded) B.glow = k.pool.map((c) => c * (k.night ? 0.05 : 0.07));
  },
};

export const corridor = {
  name: 'corridor', zone: 'any', open: 0.3, maxOut: 3,
  w: (c) => (c.zone === 'pool' ? (c.from && c.from.big ? 3.2 : 1.7) : 0.9),
  plan: (rng, c) => ({ nu: 1, nv: rng.int(2, 5), nl: 1, b: 0, flooded: c.zone === 'pool' && rng.chance(0.35), v: { narrow: rng.chance(0.4), ribs: rng.chance(0.55), dark: rng.range(0, 0.6) } }),
  slots(r) {
    const s = [{ side: 2, a: 0, r: 0, k: r.v.narrow ? K.DOOR : K.WALK }, { side: 3, a: 0, r: 0, k: r.v.narrow ? K.DOOR : K.WALK }];
    if (!r.v.narrow) for (let a = 0; a < r.nv; a++) s.push({ side: 0, a, r: 0, k: K.DOOR | K.ARCH }, { side: 1, a, r: 0, k: K.DOOR | K.ARCH });
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, v = room.v, rng = new Rng(room.seed);
    B.walls(k.wall, k.trim);
    const yf = room.flooded ? floodFloor(B, k) : (B.floor(0, 0, W, D, yd, k.deck), yd);
    const yc = v.narrow ? yd + 2.6 : H - T;
    B.ceil(yc, k.ceil);
    const x0 = v.narrow ? 1.6 : T, x1 = W - x0;
    if (v.narrow) { B.box(T, 0, 0, x0, H, D, k.wall); B.box(x1, 0, 0, W - T, H, D, k.wall); }
    if (v.ribs) for (let z = 3; z < D - 1; z += 3) {
      if (!v.narrow && Math.abs((z % 6) - 3) < 0.1) continue;           // no tapar portales laterales
      B.box(x0, 0, z - 0.25, x0 + 0.28, yc, z + 0.25, k.wall); B.box(x1 - 0.28, 0, z - 0.25, x1, yc, z + 0.25, k.wall);
      B.box(x0, yc - 0.32, z - 0.25, x1, yc, z + 0.25, { ...k.wall, nc: true });
    }
    for (let z = 3; z < D; z += 6) {
      const dead = k.lux <= 0 || rng.chance(v.dark);
      B.panel(W / 2, z + (v.ribs ? 1.5 : 0), yc, v.narrow ? 0.3 : 0.6, 0.9, dead ? [0.05, 0.05, 0.05] : k.col, dead ? 0 : B.P(k.lux * 0.85, yc - yf), dead ? 1 : 3.2);
    }
    if (room.flooded) { B.glow = k.pool.map((c) => c * 0.06); if (k.night) for (let z = 3; z < D; z += 6) poolLight(B, k, x0 + 0.1, yd - 0.35, z, 4); }
  },
};

export const pool = {
  name: 'pool', zone: 'pool', open: 0.42, maxOut: 5, minOut: 2,
  w: (c) => 3 + (c.tens > 2 ? 1.5 : 0),
  plan(rng, c) {
    if (c.first) return { nu: 3, nv: 3, nl: 2, b: 1, v: { m: [3, 3, 3, 3], depth: 2.4, ss: 0, island: 1, cols: true, coffer: true, first: true } };
    const nu = rng.int(2, 4), nv = rng.int(2, 4);
    const m = [0, 1, 2, 3].map(() => rng.pick([2.4, 3, 3, 3.6, 6]));
    if (rng.chance(0.4)) m[rng.int(0, 3)] = 0;                 // el agua llega hasta un muro
    if (nu === 2) { m[0] = Math.min(m[0], 3); m[1] = Math.min(m[1], 3); }
    if (nv === 2) { m[2] = Math.min(m[2], 3); m[3] = Math.min(m[3], 3); }
    return { nu, nv, nl: nu * nv >= 9 ? rng.pick([2, 3, 3]) : rng.pick([2, 2, 3]), b: 1, v: { m, depth: rng.range(1.5, 3.3), ss: rng.int(0, 3), island: rng.int(0, 3), cols: rng.chance(0.55), coffer: rng.chance(0.6) } };
  },
  slots(r) {
    const s = perim(r.nu, r.nv, 1, K.WALK, (q) => r.v.m[q.side] > 0);
    if (r.nl > 2) s.push(...perim(r.nu, r.nv, 2, K.WIN));
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, v = room.v, rng = new Rng(room.seed);
    B.walls(k.wall, k.trim);
    const bz = [v.m[0] || T, v.m[2] || T, W - (v.m[1] || T), D - (v.m[3] || T)];   // x0,z0,x1,z1
    const yw = yd - 0.25, yf = yw - v.depth;
    B.slab(0, 0, W, D, 0, yd, [[bz[0], bz[2], bz[1], bz[3]]], k.deck);
    B.floor(bz[0], bz[1], bz[2], bz[3], yf, k.basin);
    B.water(bz[0], bz[1], bz[2], bz[3], yw); B.waterY = yw;
    // escalinata de entrada al agua
    const n = Math.min(Math.round(v.depth / 0.2), 7), run = n * 0.42, ylo = yd - n * 0.2, ss = v.ss;
    if (ss === 0) B.steps(bz[0], bz[1], bz[0] + run, bz[3], 1, ylo, yd, k.deck);
    else if (ss === 1) B.steps(bz[2] - run, bz[1], bz[2], bz[3], 0, ylo, yd, k.deck);
    else if (ss === 2) B.steps(bz[0], bz[1], bz[2], bz[1] + run, 3, ylo, yd, k.deck);
    else B.steps(bz[0], bz[3] - run, bz[2], bz[3], 2, ylo, yd, k.deck);
    const cx = (bz[0] + bz[2]) / 2, cz = (bz[1] + bz[3]) / 2, bw = bz[2] - bz[0], bd = bz[3] - bz[1];
    const yc = H - T, drop = v.coffer ? 0.9 : 0;
    if (v.island && Math.min(bw, bd) > 7.5) {
      if (v.island === 1) { B.cyl(cx, cz, 1.3, yf, yd + 0.05, k.deck); B.cyl(cx, cz, 0.32, yd, yc - 0.05, k.wall, false); }
      else if (v.island === 2) B.box(cx - 1.2, 0, cz - 1.2, cx + 1.2, yd, cz + 1.2, k.deck);
      else for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.cyl(cx + dx * bw * 0.22, cz + dz * bd * 0.22, 0.45, yf, yc - 0.05, k.wall, false);
    }
    if (v.cols) {
      for (let x = 6; x < W - 1; x += 6) for (const z of [bz[1] - 0.6, bz[3] + 0.6]) if (z > 1.6 && z < D - 1.6) B.cyl(x, z, 0.28, yd, yc - drop, k.wall, false);
      for (let z = 6; z < D - 1; z += 6) for (const x of [bz[0] - 0.6, bz[2] + 0.6]) if (x > 1.6 && x < W - 1.6) B.cyl(x, z, 0.28, yd, yc - drop, k.wall, false);
    }
    // techo: casetones con lucernarios o paneles planos
    const dead = k.lux <= 0, lc = dead ? [0.04, 0.05, 0.06] : k.col;
    if (v.coffer) {
      const nx = Math.max(1, Math.round(bw / 5)), nz = Math.max(1, Math.round(bd / 5)), holes = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const x = bz[0] + bw * (i + 0.5) / nx, z = bz[1] + bd * (j + 0.5) / nz, hs = Math.min(1.5, bw / nx / 2 - 0.5, bd / nz / 2 - 0.5);
        holes.push([x - hs, x + hs, z - hs, z + hs]);
        B.panel(x, z, yc, hs, hs, lc, dead ? 0 : B.P(k.lux * 1.25, yc - yd) * (0.6 + hs * 0.3), dead ? 1 : 4.2);
      }
      B.slab(0, 0, W, D, yc - drop, H, holes, k.ceil);
      B.ceil(yc, k.ceil);
    } else {
      B.ceil(yc, k.ceil);
      panelGrid(B, k, rng, T, T, W - T, D - T, yc, 6, 0.7, yd, room.mood === 'dim' ? 0.3 : 0);
    }
    // focos sumergidos
    const pl = k.night ? 9 : 2.5;
    for (let z = bz[1] + 2; z < bz[3] - 1; z += 4.5) { poolLight(B, k, bz[0] + 0.1, yw - 0.9, z, pl); poolLight(B, k, bz[2] - 0.1, yw - 0.9, z, pl); }
    B.glow = k.pool.map((c) => c * (k.night ? 0.1 : 0.12));
    if (v.first) B.setSpawn(1.6, yd, 1.6);
  },
};

export const flood = {
  name: 'flood', zone: 'pool', open: 0.4, maxOut: 6, minOut: 2,
  w: (c) => 1.7 + (c.tens > 3 ? 1 : 0),
  plan(rng) {
    let nu = rng.int(2, 5), nv = rng.int(2, 5);
    if (nu * nv < 6) nv = 3;
    return { nu, nv, nl: rng.pick([1, 1, 2]), b: 0, flooded: true, v: { dense: rng.chance(0.5), round: rng.chance(0.6), plat: rng.int(0, 2), off: rng.range(0, 0.5) } };
  },
  slots(r) {
    const s = perim(r.nu, r.nv, 0, K.WALK);
    if (r.nl > 1) s.push(...perim(r.nu, r.nv, 1, K.WIN));
    return s;
  },
  build(B, room) {
    const k = kit(B), { W, D, H, yd } = B, v = room.v, rng = new Rng(room.seed);
    B.walls(k.wall, k.trim);
    const yf = floodFloor(B, k), yc = H - T;
    B.ceil(yc, k.ceil);
    // plataformas secas alineadas a celdas interiores
    const plats = [];
    for (let i = 0; i < v.plat && room.nu > 2 && room.nv > 2; i++) {
      const px = rng.int(1, room.nu - 2) * 6, pz = rng.int(1, room.nv - 2) * 6;
      if (plats.some((p) => p[0] === px && p[1] === pz)) continue;
      plats.push([px, pz]);
      B.box(px + 0.9, 0, pz + 0.9, px + 5.1, yd, pz + 5.1, k.deck);
      B.steps(px, pz + 1.5, px + 0.9, pz + 4.5, 0, yf, yd, k.deck);
      B.steps(px + 5.1, pz + 1.5, px + 6, pz + 4.5, 1, yf, yd, k.deck);
    }
    const inPlat = (x, z) => plats.some((p) => x > p[0] + 0.3 && x < p[0] + 5.7 && z > p[1] + 0.3 && z < p[1] + 5.7);
    // bosque de columnas en esquinas y medianeras de celda (nunca frente a un portal)
    for (let x = 3; x < W - 1; x += 3) for (let z = 3; z < D - 1; z += 3) {
      const cx = x % 6 === 0, cz = z % 6 === 0;
      if (!(cx && cz) && !(v.dense && (cx || cz))) continue;
      if (inPlat(x, z)) continue;
      if (v.round) B.cyl(x, z, cx && cz ? 0.34 : 0.22, yf, yc, k.wall, false);
      else B.box(x - 0.3, 0, z - 0.3, x + 0.3, yc, z + 0.3, k.wall);
    }
    panelGrid(B, k, rng, 0, 0, W, D, yc, 6, 0.65, yf, v.off);
    if (k.night) for (let x = 3; x < W; x += 6) { poolLight(B, k, x, yd - 0.34, T + 0.1, 5); poolLight(B, k, x, yd - 0.34, D - T - 0.1, 5); }
    B.glow = k.pool.map((c) => c * (k.night ? 0.06 : 0.1));
  },
};
