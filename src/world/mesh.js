// Mallado de una sala: unión CSG exacta de cajas (solo se emiten las caras realmente
// visibles, sin solapes ni caras internas), primitivas curvas e iluminación horneada
// por vértice (luces de área con sombras + oclusión ambiental + rebote del agua).
// Es un generador: cede el control periódicamente para no bloquear el fotograma.
import { CS, M } from '../config.js';

const EPS = 1e-4;

// ¿el segmento p→p+d atraviesa alguna caja? (cajas en Float32Array de 6 en 6)
function segHit(px, py, pz, dx, dy, dz, B, idx, n) {
  for (let k = 0; k < n; k++) {
    const o = (idx ? idx[k] : k) * 6;
    let t0 = 0.002, t1 = 0.998, ta, tb, iv;
    if (dx > -1e-9 && dx < 1e-9) { if (px <= B[o] || px >= B[o + 3]) continue; }
    else { iv = 1 / dx; ta = (B[o] - px) * iv; tb = (B[o + 3] - px) * iv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t1 - t0 < 1e-4) continue; }
    if (dy > -1e-9 && dy < 1e-9) { if (py <= B[o + 1] || py >= B[o + 4]) continue; }
    else { iv = 1 / dy; ta = (B[o + 1] - py) * iv; tb = (B[o + 4] - py) * iv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t1 - t0 < 1e-4) continue; }
    if (dz > -1e-9 && dz < 1e-9) { if (pz <= B[o + 2] || pz >= B[o + 5]) continue; }
    else { iv = 1 / dz; ta = (B[o + 2] - pz) * iv; tb = (B[o + 5] - pz) * iv; if (ta > tb) { const s = ta; ta = tb; tb = s; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t1 - t0 < 1e-4) continue; }
    return true;
  }
  return false;
}
function segHitCyl(px, py, pz, dx, dy, dz, cyls) {
  for (const c of cyls) {
    const ox = px - c.cx, oz = pz - c.cz;
    const a = dx * dx + dz * dz; if (a < 1e-9) continue;
    const b = ox * dx + oz * dz, cc = ox * ox + oz * oz - c.r * c.r;
    const disc = b * b - a * cc; if (disc <= 0) continue;
    const sq = Math.sqrt(disc), t0 = Math.max(0.002, (-b - sq) / a), t1 = Math.min(0.998, (-b + sq) / a);
    if (t1 - t0 < 1e-4) continue;
    const ym = py + dy * (t0 + t1) * 0.5;
    if (ym > c.y0 && ym < c.y1) return true;
  }
  return false;
}

function cutList(lo, hi, cover, ax, sub) {
  const arr = [lo, hi];
  for (const o of cover) {
    if (o.a[ax] > lo + 1e-3 && o.a[ax] < hi - 1e-3) arr.push(o.a[ax]);
    if (o.b[ax] > lo + 1e-3 && o.b[ax] < hi - 1e-3) arr.push(o.b[ax]);
  }
  for (let g = Math.ceil((lo + 0.05) / sub) * sub; g < hi - 0.05; g += sub) arr.push(g);
  arr.sort((x, y) => x - y);
  const out = [arr[0]];
  for (let i = 1; i < arr.length; i++) if (arr[i] - out[out.length - 1] > 1e-3) out.push(arr[i]);
  return out;
}

export function* meshRoom(rb, origin) {
  const [ox, oy, oz] = origin;
  const size = [rb.room.ni * CS, rb.H, rb.room.nk * CS];
  const solid = rb.boxes.filter((b) => !b.ghost);
  solid.forEach((b, i) => { b._i = i; });
  solid.sort((p, q) => (q.pri - p.pri) || (p._i - q._i));

  // --- estructuras de horneado ---
  const occl = solid.filter((b) => !b.ns);
  const OB = new Float32Array(occl.length * 6);
  occl.forEach((b, i) => OB.set(b.a, i * 6) || OB.set(b.b, i * 6 + 3));
  const near = solid.filter((b) => !b.emit);
  const NB = new Float32Array(near.length * 6);
  near.forEach((b, i) => NB.set(b.a, i * 6) || NB.set(b.b, i * 6 + 3));
  const nidx = new Int32Array(near.length);
  const samples = [];
  for (const L of rb.lights) {
    const big = L.sx > 0.7 || L.sz > 0.7;
    const pts = big ? [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] : [[0, 0]];
    for (const p of pts) samples.push({ x: L.x + p[0] * L.sx, y: L.y, z: L.z + p[1] * L.sz, type: L.type, r: L.col[0] * L.P / pts.length, g: L.col[1] * L.P / pts.length, b: L.col[2] * L.P / pts.length, P: L.P / pts.length });
  }
  // rebote difuso del suelo: una fuente virtual bajo cada luminaria (sin oclusión, barata)
  const bounces = [];
  for (const L of rb.lights) {
    if (L.type !== 0 || L.y < rb.yd + 1) continue;
    bounces.push({ x: L.x, y: rb.yd + 0.05, z: L.z, r: L.col[0] * L.P * 0.42, g: L.col[1] * L.P * 0.42, b: L.col[2] * L.P * 0.42 });
  }
  const amb = rb.amb, glow = rb.glow, wy = rb.waterY, cyls = rb.cyls;
  const out3 = [0, 0, 0];
  const AO = [[0, 0, 1.3], [0.85, 0, 0.75], [-0.85, 0, 0.75], [0, 0.85, 0.75], [0, -0.85, 0.75]];

  function bake(px, py, pz, nx, ny, nz) {
    // base tangente
    let tx, ty, tz;
    if (ny > 0.9 || ny < -0.9) { tx = 1; ty = 0; tz = 0; } else { const l = Math.hypot(nz, nx) || 1; tx = nz / l; ty = 0; tz = -nx / l; }
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    // oclusión ambiental local
    let nn = 0;
    for (let i = 0, o = 0; i < near.length; i++, o += 6) {
      if (NB[o] < px + 1.4 && NB[o + 3] > px - 1.4 && NB[o + 1] < py + 1.4 && NB[o + 4] > py - 1.4 && NB[o + 2] < pz + 1.4 && NB[o + 5] > pz - 1.4) nidx[nn++] = i;
    }
    let hits = 0;
    if (nn) for (const a of AO) {
      const dx = tx * a[0] + bx * a[1] + nx * a[2], dy = ty * a[0] + by * a[1] + ny * a[2], dz = tz * a[0] + bz * a[1] + nz * a[2];
      if (segHit(px, py, pz, dx, dy, dz, NB, nidx, nn)) hits++;
    }
    const ao = 1 - 0.11 * hits;
    const hemi = 0.9 + 0.1 * ny;
    let r = amb[0] * ao * hemi, g = amb[1] * ao * hemi, b = amb[2] * ao * hemi;
    if (glow && py > wy - 0.05) {
      const f = (0.3 + 0.7 * Math.max(0, -ny)) * Math.exp(-(py - wy) * 0.22) * ao;
      r += glow[0] * f; g += glow[1] * f; b += glow[2] * f;
    }
    for (const s of samples) {
      const lx = s.x - px, ly = s.y - py, lz = s.z - pz;
      const d2 = lx * lx + ly * ly + lz * lz;
      if (s.P < d2 * 0.004) continue;
      const d = Math.sqrt(d2);
      let cr = (nx * lx + ny * ly + nz * lz) / d;
      if (cr <= 0.001) continue;
      let ce = 1;
      if (s.type === 0) { ce = ly / d; if (ce <= 0) continue; ce = 0.22 + 0.78 * ce; }
      const w = cr * ce / (d2 + 0.6);
      if (w * s.P < 0.003) continue;
      if (segHit(px, py, pz, lx, ly, lz, OB, null, occl.length)) continue;
      if (cyls.length && segHitCyl(px, py, pz, lx, ly, lz, cyls)) continue;
      r += s.r * w; g += s.g * w; b += s.b * w;
    }
    for (const s of bounces) {
      const lx = s.x - px, ly = s.y - py, lz = s.z - pz;
      if (ly >= -0.05) continue;
      const d2 = lx * lx + ly * ly + lz * lz, d = Math.sqrt(d2), cr = (nx * lx + ny * ly + nz * lz) / d;
      if (cr <= 0) continue;
      const w = cr * (-ly / d) / (d2 + 3) * ao;
      r += s.r * w; g += s.g * w; b += s.b * w;
    }
    out3[0] = r; out3[1] = g; out3[2] = b;
    return out3;
  }

  // --- búferes de salida ---
  const P = [], N = [], UV = [], Lc = [], TI = [], MW = [], IX = [];
  const wyW = wy > -1e3 ? wy + oy : -1e4;
  let nv = 0, work = 0;
  // polígono de 3 o 4 vértices. c: [[x,y,z]…], n: normal plana o lista de normales, uv: [[u,v]…]
  function poly(c, n, uv, mat, tint, emit) {
    const k = c.length, flat = typeof n[0] === 'number';
    const e1x = c[1][0] - c[0][0], e1y = c[1][1] - c[0][1], e1z = c[1][2] - c[0][2];
    const e2x = c[k - 1][0] - c[0][0], e2y = c[k - 1][1] - c[0][1], e2z = c[k - 1][2] - c[0][2];
    const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
    const n0 = flat ? n : n[0];
    const flip = gx * n0[0] + gy * n0[1] + gz * n0[2] < 0;
    let mx = 0, my = 0, mz = 0;
    for (const p of c) { mx += p[0] / k; my += p[1] / k; mz += p[2] / k; }
    for (let i = 0; i < k; i++) {
      const p = c[i], nn = flat ? n : n[i];
      let lr, lg, lb;
      if (emit) { lr = emit[0]; lg = emit[1]; lb = emit[2]; }
      else {
        let qx = mx - p[0], qy = my - p[1], qz = mz - p[2];
        const ql = 0.07 / (Math.hypot(qx, qy, qz) || 1);
        const L = bake(p[0] + nn[0] * 0.05 + qx * ql, p[1] + nn[1] * 0.05 + qy * ql, p[2] + nn[2] * 0.05 + qz * ql, nn[0], nn[1], nn[2]);
        lr = L[0]; lg = L[1]; lb = L[2];
      }
      P.push(p[0] + ox, p[1] + oy, p[2] + oz); N.push(nn[0], nn[1], nn[2]);
      UV.push(uv[i][0], uv[i][1]); Lc.push(lr, lg, lb); TI.push(tint[0], tint[1], tint[2]); MW.push(mat, wyW);
    }
    if (flip) { IX.push(nv, nv + 2, nv + 1); if (k === 4) IX.push(nv, nv + 3, nv + 2); }
    else { IX.push(nv, nv + 1, nv + 2); if (k === 4) IX.push(nv, nv + 2, nv + 3); }
    nv += k; work += k;
  }

  // --- 1. cajas: unión CSG ---
  const cover = [];
  for (let i = 0; i < solid.length; i++) {
    const bx = solid[i], A = bx.a, B = bx.b;
    for (let ax = 0; ax < 3; ax++) for (let d = -1; d <= 1; d += 2) {
      const pc = d > 0 ? B[ax] : A[ax];
      if (d > 0 ? pc > size[ax] - 1e-3 : pc < 1e-3) continue;        // cara sobre el límite de la sala
      const U = (ax + 1) % 3, V = (ax + 2) % 3;
      const mat = ax === 1 ? (d > 0 ? bx.t : bx.bm) : bx.s;
      const tint = ax === 1 ? (d > 0 ? bx.tt : bx.tb) : bx.tint;
      const q = pc + d * 1e-3;
      cover.length = 0;
      let hidden = false;
      for (let j = 0; j < solid.length; j++) {
        if (j === i) continue;
        const o = solid[j];
        if (o.a[U] >= B[U] - EPS || o.b[U] <= A[U] + EPS || o.a[V] >= B[V] - EPS || o.b[V] <= A[V] + EPS) continue;
        if ((o.a[ax] < q && o.b[ax] > q) || (j < i && Math.abs((d > 0 ? o.b[ax] : o.a[ax]) - pc) < EPS)) {
          cover.push(o);
          if (o.a[U] <= A[U] + EPS && o.b[U] >= B[U] - EPS && o.a[V] <= A[V] + EPS && o.b[V] >= B[V] - EPS) { hidden = true; break; }
        }
      }
      if (hidden) continue;
      const us = cutList(A[U], B[U], cover, U, rb.sub), vs = cutList(A[V], B[V], cover, V, rb.sub);
      const nrm = [0, 0, 0]; nrm[ax] = d;
      const emit = mat === M.EMIT ? bx.emit : null;
      for (let a = 0; a < us.length - 1; a++) for (let b = 0; b < vs.length - 1; b++) {
        const uc = (us[a] + us[a + 1]) / 2, vc = (vs[b] + vs[b + 1]) / 2;
        let cov = false;
        for (const o of cover) if (o.a[U] < uc && o.b[U] > uc && o.a[V] < vc && o.b[V] > vc) { cov = true; break; }
        if (cov) continue;
        const cs = [], uvs = [];
        for (const [uu, vv] of [[us[a], vs[b]], [us[a + 1], vs[b]], [us[a + 1], vs[b + 1]], [us[a], vs[b + 1]]]) {
          const p = [0, 0, 0]; p[ax] = pc; p[U] = uu; p[V] = vv;
          cs.push(p);
          uvs.push(ax === 0 ? [p[2] + oz, p[1] + oy] : ax === 2 ? [p[0] + ox, p[1] + oy] : [p[0] + ox, p[2] + oz]);
        }
        poly(cs, nrm, uvs, mat, tint, emit);
        if (work > 220) { work = 0; yield; }
      }
    }
  }

  // --- 2. cilindros ---
  const pt = (cx, cz, r, a, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  for (const c of cyls) {
    const n = Math.max(8, Math.min(28, Math.round(c.r * 14))), ys = cutList(c.y0, c.y1, [], 1, 1.6);
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
      for (let j = 0; j < ys.length - 1; j++) {
        poly([pt(c.cx, c.cz, c.r, a1, ys[j]), pt(c.cx, c.cz, c.r, a0, ys[j]), pt(c.cx, c.cz, c.r, a0, ys[j + 1]), pt(c.cx, c.cz, c.r, a1, ys[j + 1])],
          [n1, n0, n0, n1], [[a1 * c.r, ys[j] + oy], [a0 * c.r, ys[j] + oy], [a0 * c.r, ys[j + 1] + oy], [a1 * c.r, ys[j + 1] + oy]], c.mat, c.tint);
      }
      if (c.cap && c.y1 < size[1] - 0.31) {
        const p0 = [c.cx, c.y1, c.cz], p1 = pt(c.cx, c.cz, c.r, a1, c.y1), p2 = pt(c.cx, c.cz, c.r, a0, c.y1);
        poly([p0, p1, p2], [0, 1, 0], [p0, p1, p2].map((p) => [p[0] + ox, p[2] + oz]), c.mt, c.tint);
      }
    }
    yield;
  }

  // --- 3. sectores anulares ---
  for (const s of rb.secs) {
    const span = s.a1 - s.a0, na = Math.max(1, Math.ceil(span / (Math.PI / 18) * Math.min(1, 0.35 + s.r1 / 8)));
    const rs = cutList(s.r0, s.r1, [], 0, 1.4), ys = cutList(s.y0, s.y1, [], 1, 1.6);
    const tuv = (p) => [p[0] + ox, p[2] + oz];
    for (let i = 0; i < na; i++) {
      const a0 = s.a0 + span * i / na, a1 = s.a0 + span * (i + 1) / na;
      for (let j = 0; j < rs.length - 1; j++) {
        const q = [pt(s.cx, s.cz, rs[j], a0, 0), pt(s.cx, s.cz, rs[j], a1, 0), pt(s.cx, s.cz, rs[j + 1], a1, 0), pt(s.cx, s.cz, rs[j + 1], a0, 0)];
        if (rs[j] < 0.01) q.splice(1, 1);
        if ((s.faces & 1) && s.y1 < size[1] - 1e-3) { const c = q.map((p) => [p[0], s.y1, p[2]]); poly(c, [0, 1, 0], c.map(tuv), s.mt, s.tt, s.mt === M.EMIT ? s.emit : null); }
        if ((s.faces & 2) && s.y0 > 1e-3) { const c = q.map((p) => [p[0], s.y0, p[2]]); poly(c, [0, -1, 0], c.map(tuv), s.mb, s.tint, s.mb === M.EMIT ? s.emit : null); }
      }
      for (let j = 0; j < ys.length - 1; j++) {
        const y0 = ys[j], y1 = ys[j + 1];
        for (const [bit, r, sg] of [[4, s.r0, -1], [8, s.r1, 1]]) {
          if (!(s.faces & bit) || r < 0.01) continue;
          const n0 = [sg * Math.cos(a0), 0, sg * Math.sin(a0)], n1 = [sg * Math.cos(a1), 0, sg * Math.sin(a1)];
          poly([pt(s.cx, s.cz, r, a0, y0), pt(s.cx, s.cz, r, a1, y0), pt(s.cx, s.cz, r, a1, y1), pt(s.cx, s.cz, r, a0, y1)],
            [n0, n1, n1, n0], [[a0 * r, y0 + oy], [a1 * r, y0 + oy], [a1 * r, y1 + oy], [a0 * r, y1 + oy]], s.ms, s.tint);
        }
      }
      if (work > 220) { work = 0; yield; }
    }
    if (s.faces & 16) for (const [a, sg] of [[s.a0, -1], [s.a1, 1]]) {
      const nn = [-Math.sin(a) * sg, 0, Math.cos(a) * sg];
      poly([pt(s.cx, s.cz, s.r0, a, s.y0), pt(s.cx, s.cz, s.r1, a, s.y0), pt(s.cx, s.cz, s.r1, a, s.y1), pt(s.cx, s.cz, s.r0, a, s.y1)],
        nn, [[s.r0, s.y0 + oy], [s.r1, s.y0 + oy], [s.r1, s.y1 + oy], [s.r0, s.y1 + oy]], s.ms, s.tint);
    }
  }

  // --- 4. cáscaras cilíndricas (vistas desde dentro) con huecos, jambas y dinteles ---
  for (const s of rb.shells) {
    const R = s.R, n = Math.max(24, Math.round(R * 7));
    let angs = [];
    for (let i = 0; i <= n; i++) angs.push(i / n * Math.PI * 2);
    const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const g of s.gaps) angs.push(norm(g.a - g.half), norm(g.a + g.half));
    angs.sort((x, y) => x - y);
    angs = angs.filter((a, i) => i === 0 || a - angs[i - 1] > 1e-4);
    for (let i = 0; i < angs.length - 1; i++) {
      const a0 = angs[i], a1 = angs[i + 1], am = (a0 + a1) / 2;
      const holes = [];
      for (const g of s.gaps) { let d = Math.abs(norm(am - g.a)); if (d > Math.PI) d = Math.PI * 2 - d; if (d < g.half) holes.push([g.y0, g.y1]); }
      const base = cutList(s.y0, s.y1, holes.map((h) => ({ a: [0, h[0]], b: [0, h[1]] })), 1, 1.6);
      const n0 = [-Math.cos(a0), 0, -Math.sin(a0)], n1 = [-Math.cos(a1), 0, -Math.sin(a1)];
      for (let j = 0; j < base.length - 1; j++) {
        const y0 = base[j], y1 = base[j + 1], ym = (y0 + y1) / 2;
        if (holes.some((h) => ym > h[0] && ym < h[1])) continue;
        poly([pt(s.cx, s.cz, R, a0, y0), pt(s.cx, s.cz, R, a1, y0), pt(s.cx, s.cz, R, a1, y1), pt(s.cx, s.cz, R, a0, y1)],
          [n0, n1, n1, n0], [[a0 * R, y0 + oy], [a1 * R, y0 + oy], [a1 * R, y1 + oy], [a0 * R, y1 + oy]], s.mat, s.tint);
      }
      if (work > 220) { work = 0; yield; }
    }
    for (const g of s.gaps) {
      const dx = Math.cos(g.a), dz = Math.sin(g.a), len = R * (1 - Math.cos(g.half)) + 0.08;
      const e = [pt(s.cx, s.cz, R, g.a - g.half, 0), pt(s.cx, s.cz, R, g.a + g.half, 0)];
      const f = e.map((p) => [p[0] + dx * len, 0, p[2] + dz * len]);
      for (let k = 0; k < 2; k++) {
        const sg = k ? -1 : 1, nn = [-dz * sg, 0, dx * sg];
        poly([[e[k][0], g.y0, e[k][2]], [f[k][0], g.y0, f[k][2]], [f[k][0], g.y1, f[k][2]], [e[k][0], g.y1, e[k][2]]],
          nn, [[0, g.y0 + oy], [len, g.y0 + oy], [len, g.y1 + oy], [0, g.y1 + oy]], s.mat, s.tint);
      }
      const c = [[e[0][0], g.y1, e[0][2]], [e[1][0], g.y1, e[1][2]], [f[1][0], g.y1, f[1][2]], [f[0][0], g.y1, f[0][2]]];
      poly(c, [0, -1, 0], c.map((p) => [p[0] + ox, p[2] + oz]), s.mat, s.tint);
    }
  }
  yield;

  // --- 5. agua ---
  const WP = [], WL = [], WI = [];
  let wn = 0;
  const wvert = (x, y, z) => { const L = bake(x, y + 0.06, z, 0, 1, 0); WP.push(x + ox, y + oy, z + oz); WL.push(L[0], L[1], L[2]); return wn++; };
  for (const w of rb.waters) {
    if (w.r !== undefined) {
      const rings = Math.max(1, Math.ceil(w.r / 2.2)), seg = 28;
      const c = wvert(w.cx, w.y, w.cz);
      let prev = null;
      for (let j = 1; j <= rings; j++) {
        const row = [];
        for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2, r = w.r * j / rings; row.push(wvert(w.cx + Math.cos(a) * r, w.y, w.cz + Math.sin(a) * r)); }
        for (let i = 0; i < seg; i++) {
          const i1 = (i + 1) % seg;
          if (!prev) WI.push(c, row[i1], row[i]); else WI.push(prev[i], row[i1], row[i], prev[i], prev[i1], row[i1]);
        }
        prev = row;
      }
    } else {
      const nx = Math.max(1, Math.ceil((w.x1 - w.x0) / 2.2)), nz = Math.max(1, Math.ceil((w.z1 - w.z0) / 2.2)), grid = [];
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) grid.push(wvert(w.x0 + (w.x1 - w.x0) * i / nx, w.y, w.z0 + (w.z1 - w.z0) * j / nz));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = grid[j * (nx + 1) + i], b = a + 1, c = a + nx + 1, d = c + 1;
        WI.push(a, c, b, b, c, d);
      }
    }
    yield;
  }

  // --- 6. colisionadores y datos de sala en coordenadas de mundo ---
  const cb = rb.boxes.filter((b) => !b.nc);
  const CB = new Float32Array(cb.length * 6);
  cb.forEach((b, i) => CB.set([b.a[0] + ox, b.a[1] + oy, b.a[2] + oz, b.b[0] + ox, b.b[1] + oy, b.b[2] + oz], i * 6));
  const mv = (o) => ({ ...o, cx: o.cx + ox, cz: o.cz + oz, y0: o.y0 + oy, y1: o.y1 + oy });
  return {
    pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(UV), light: new Float32Array(Lc),
    tint: new Float32Array(TI), mw: new Float32Array(MW), index: new Uint32Array(IX),
    wpos: new Float32Array(WP), wlight: new Float32Array(WL), windex: new Uint32Array(WI),
    boxes: CB, cyls: rb.cyls.map(mv), secs: rb.secs.map(mv),
    shells: rb.shells.map((s) => ({ ...mv(s), gaps: s.gaps.map((g) => ({ ...g, y0: g.y0 + oy, y1: g.y1 + oy })) })),
    waters: rb.waters.map((w) => (w.r !== undefined ? { cx: w.cx + ox, cz: w.cz + oz, r: w.r, y: w.y + oy } : { x0: w.x0 + ox, z0: w.z0 + oz, x1: w.x1 + ox, z1: w.z1 + oz, y: w.y + oy })),
    lights: rb.lights.filter((l) => l.spec).map((l) => ({ x: l.x + ox, y: l.y + oy, z: l.z + oz, sx: Math.max(0.15, l.sx), sz: Math.max(0.15, l.sz), col: l.col, P: l.P })),
    spawn: rb.spawn ? [rb.spawn[0] + ox, rb.spawn[1] + oy, rb.spawn[2] + oz] : null,
  };
}
