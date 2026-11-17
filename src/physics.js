// Colisiones y cuerpo del jugador. Sin dependencias del navegador para poder
// verificar el mundo también desde Node (tools/check.mjs).
// Primitivas sólidas: cajas, cilindros verticales, sectores anulares y cáscaras
// cilíndricas (se colisiona por dentro, con huecos en las puertas).
import { PLAYER } from './config.js';

const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
function inSector(s, x, z, m) {
  const dx = x - s.cx, dz = z - s.cz, d = Math.hypot(dx, dz);
  if (d < s.r0 - m || d > s.r1 + m) return false;
  if (s.full) return true;
  return Math.abs(angDiff(Math.atan2(dz, dx), (s.a0 + s.a1) / 2)) < (s.a1 - s.a0) / 2 + m / Math.max(d, 0.3);
}

export class Colliders {
  constructor() { this.rooms = new Map(); this.list = []; this._out = []; }
  add(id, bb, d) { this.rooms.set(id, { id, bb, boxes: d.boxes, cyls: d.cyls, secs: d.secs, shells: d.shells, waters: d.waters }); this.list = [...this.rooms.values()]; }
  remove(id) { if (this.rooms.delete(id)) this.list = [...this.rooms.values()]; }

  near(x, y0, y1, z, m) {
    const out = this._out; out.length = 0;
    for (const r of this.list) { const b = r.bb; if (x > b[0] - m && x < b[3] + m && z > b[2] - m && z < b[5] + m && y1 > b[1] - 0.5 && y0 < b[4] + 0.5) out.push(r); }
    return out;
  }

  // cota más alta de suelo ≤ maxY bajo un círculo de radio r
  support(rs, x, z, maxY, r) {
    let best = -1e9; const r2 = r * r;
    for (const room of rs) {
      const B = room.boxes;
      for (let o = 0; o < B.length; o += 6) {
        const top = B[o + 4]; if (top > maxY || top <= best) continue;
        const dx = x < B[o] ? B[o] - x : x > B[o + 3] ? x - B[o + 3] : 0, dz = z < B[o + 2] ? B[o + 2] - z : z > B[o + 5] ? z - B[o + 5] : 0;
        if (dx * dx + dz * dz < r2) best = top;
      }
      for (const c of room.cyls) { if (c.y1 > maxY || c.y1 <= best) continue; if (Math.hypot(x - c.cx, z - c.cz) < c.r + r) best = c.y1; }
      for (const s of room.secs) { if (s.y1 > maxY || s.y1 <= best) continue; if (inSector(s, x, z, r)) best = s.y1; }
    }
    return best;
  }

  // cota más baja de techo ≥ minY sobre el círculo
  ceiling(rs, x, z, minY, r) {
    let best = 1e9; const r2 = r * r;
    for (const room of rs) {
      const B = room.boxes;
      for (let o = 0; o < B.length; o += 6) {
        const bot = B[o + 1]; if (bot < minY || bot >= best) continue;
        const dx = x < B[o] ? B[o] - x : x > B[o + 3] ? x - B[o + 3] : 0, dz = z < B[o + 2] ? B[o + 2] - z : z > B[o + 5] ? z - B[o + 5] : 0;
        if (dx * dx + dz * dz < r2) best = bot;
      }
      for (const s of room.secs) { if (s.y0 < minY || s.y0 >= best) continue; if (inSector(s, x, z, r)) best = s.y0; }
    }
    return best;
  }

  // superficie de agua sobre el punto (o -1e9)
  waterAt(rs, x, y, z) {
    let best = -1e9;
    for (const room of rs) {
      const b = room.bb; if (y < b[1] || y > b[4] || x < b[0] || x > b[3] || z < b[2] || z > b[5]) continue;
      for (const w of room.waters) {
        if (w.y <= best) continue;
        if (w.r !== undefined ? Math.hypot(x - w.cx, z - w.cz) < w.r : (x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1)) best = w.y;
      }
    }
    return best;
  }

  // expulsa lateralmente al cuerpo (círculo de radio r entre lo y hi) de los sólidos
  lateral(rs, b, lo, hi, r) {
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const room of rs) {
        const B = room.boxes;
        for (let o = 0; o < B.length; o += 6) {
          if (B[o + 4] <= lo || B[o + 1] >= hi) continue;
          const x = b.x, z = b.z;
          if (x <= B[o] - r || x >= B[o + 3] + r || z <= B[o + 2] - r || z >= B[o + 5] + r) continue;
          const cx = x < B[o] ? B[o] : x > B[o + 3] ? B[o + 3] : x, cz = z < B[o + 2] ? B[o + 2] : z > B[o + 5] ? B[o + 5] : z;
          const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
          if (d2 > 1e-10) { if (d2 >= r * r) continue; const d = Math.sqrt(d2), f = (r - d) / d; b.x += dx * f; b.z += dz * f; }
          else {
            const a = x - B[o] + r, c = B[o + 3] - x + r, e = z - B[o + 2] + r, g = B[o + 5] - z + r, m = Math.min(a, c, e, g);
            if (m === a) b.x -= a; else if (m === c) b.x += c; else if (m === e) b.z -= e; else b.z += g;
          }
          moved = true;
        }
        for (const c of room.cyls) {
          if (c.y1 <= lo || c.y0 >= hi) continue;
          const dx = b.x - c.cx, dz = b.z - c.cz, d = Math.hypot(dx, dz), R = c.r + r;
          if (d >= R) continue;
          if (d < 1e-5) b.x += R; else { b.x = c.cx + dx / d * R; b.z = c.cz + dz / d * R; }
          moved = true;
        }
        for (const s of room.secs) {
          if (s.y1 <= lo || s.y0 >= hi || !inSector(s, b.x, b.z, r)) continue;
          const dx = b.x - s.cx, dz = b.z - s.cz, d = Math.hypot(dx, dz) || 1e-4;
          const outP = s.r1 + r - d, inP = s.r0 - r > 0.05 ? d - (s.r0 - r) : 1e9;
          let angP = 1e9, na = 0;
          if (!s.full) {
            const mid = (s.a0 + s.a1) / 2, half = (s.a1 - s.a0) / 2 + r / Math.max(d, 0.3), df = angDiff(Math.atan2(dz, dx), mid);
            angP = (half - Math.abs(df)) * d; na = mid + (df < 0 ? -half : half);
          }
          if (angP < outP && angP < inP) { b.x = s.cx + Math.cos(na) * d; b.z = s.cz + Math.sin(na) * d; }
          else { const nd = outP < inP ? s.r1 + r : s.r0 - r; b.x = s.cx + dx / d * nd; b.z = s.cz + dz / d * nd; }
          moved = true;
        }
        for (const s of room.shells) {
          if (hi <= s.y0 || lo >= s.y1) continue;
          const dx = b.x - s.cx, dz = b.z - s.cz, d = Math.hypot(dx, dz), lim = s.R - r;
          if (d <= lim || d > s.R + 0.7) continue;
          const a = Math.atan2(dz, dx);
          let gap = false;
          for (const g of s.gaps) {
            if (b.y < g.y0 - 0.5 || b.y > g.y1 - 1.2) continue;
            const df = angDiff(a, g.a);
            if (Math.abs(df) >= g.half) continue;
            gap = true;
            const am = Math.max(0, g.half - r / s.R);
            if (Math.abs(df) > am) { const na = g.a + (df < 0 ? -am : am); b.x = s.cx + Math.cos(na) * d; b.z = s.cz + Math.sin(na) * d; moved = true; }
            break;
          }
          if (!gap) { b.x = s.cx + dx / d * lim; b.z = s.cz + dz / d * lim; moved = true; }
        }
      }
      if (!moved) break;
    }
  }
}

export class Body {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0;           // y = pies
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = false; this.swim = false;
    this.ws = -1e9; this.sub = 0; this.land = 0; this.splash = 0;
  }
  clone() { return Object.assign(new Body(), this); }

  _moveXZ(col, rs, dx, dz, stepUp, climb, cr = 0.28) {
    const P = PLAYER, len = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 0; i < n; i++) {
      this.x += dx / n; this.z += dz / n;
      if (climb) { const g = col.support(rs, this.x, this.z, this.y + stepUp, cr); if (g > this.y) this.y = g; }
      col.lateral(rs, this, this.y + Math.min(stepUp, P.stepUp), this.y + P.height, P.radius);
    }
  }

  // inp: { fx, fz, rx, rz, mf, ms, up, pitch }
  update(col, dt, inp) {
    const P = PLAYER, rs = col.near(this.x, this.y - 1.5, this.y + P.height + 1, this.z, 1.5);
    const ws = col.waterAt(rs, this.x, this.y + 0.9, this.z);
    const floorU = ws > -1e8 ? col.support(rs, this.x, this.z, ws + 0.01, 0.2) : 0;
    const depth = ws - floorU, wasSub = this.sub;
    this.ws = ws; this.sub = ws > -1e8 ? Math.max(0, ws - this.y) : 0; this.depth = ws > -1e8 ? depth : 0;
    if (wasSub < 0.3 && this.sub >= 0.3 && this.vy < -2.5) this.splash = Math.min(1, -this.vy / 7);
    this.swim = ws > -1e8 && (this.swim ? depth > 1.15 && this.sub > 0.9 : depth >= P.swimDepth && this.sub > 1.05);
    this.land = 0;

    if (this.swim) {
      const cp = Math.cos(inp.pitch), sp = Math.sin(inp.pitch), floatY = ws - 1.42;
      let wx = inp.fx * cp * inp.mf + inp.rx * inp.ms, wy = sp * inp.mf + inp.up, wz = inp.fz * cp * inp.mf + inp.rz * inp.ms;
      const l = Math.hypot(wx, wy, wz); if (l > 1) { wx /= l; wy /= l; wz /= l; }
      wx *= P.swim; wy *= P.swim; wz *= P.swim;
      const diving = inp.up < 0 || (inp.mf > 0.1 && sp < -0.22);
      if (!diving) wy += Math.max(-0.25, Math.min(1.0, (floatY - this.y) * 1.6));
      const k = Math.min(1, 2.6 * dt);
      this.vx += (wx - this.vx) * k; this.vy += (wy - this.vy) * k; this.vz += (wz - this.vz) * k;
      const nearSurf = this.y > ws - 1.8;
      const mantle = nearSurf && (Math.abs(inp.mf) + Math.abs(inp.ms)) > 0.2 && inp.pitch > -0.7 ? ws + 0.55 - this.y : 0.25;
      this._moveXZ(col, rs, this.vx * dt, this.vz * dt, mantle, true, mantle > 0.3 ? P.radius + 0.07 : 0.28);
      this.y += this.vy * dt;
      const g = col.support(rs, this.x, this.z, this.y + 0.3, 0.28);
      if (this.y < g) { this.y = g; if (this.vy < 0) this.vy = 0; }
      if (this.y > floatY && g < floatY) { this.y = Math.max(floatY, g); if (this.vy > 0) this.vy = 0; }
      const c = col.ceiling(rs, this.x, this.z, this.y + 0.6, 0.25);
      if (this.y + P.height > c) { this.y = c - P.height; if (this.vy > 0) this.vy = 0; }
      this.onGround = false;
      return;
    }

    const sp = this.sub > 0.12 ? (this.sub > 0.5 ? P.wade * 0.8 : P.wade) : P.walk;
    let dx = inp.fx * inp.mf + inp.rx * inp.ms, dz = inp.fz * inp.mf + inp.rz * inp.ms;
    const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
    const k = Math.min(1, (this.onGround ? 11 : 2) * dt);
    this.vx += (dx * sp - this.vx) * k; this.vz += (dz * sp - this.vz) * k;
    this._moveXZ(col, rs, this.vx * dt, this.vz * dt, P.stepUp, this.onGround);
    const g = col.support(rs, this.x, this.z, this.y + P.stepUp, 0.28);
    if (this.onGround) { if (g >= this.y - 0.45) this.y = g; else this.onGround = false; }
    if (!this.onGround) {
      const inW = this.sub > 0.7;
      this.vy -= P.gravity * dt * (inW ? 0.3 : 1);
      if (inW) this.vy *= Math.max(0, 1 - 3.5 * dt);
      this.y += this.vy * dt;
      if (this.y <= g) { this.y = g; this.land = -this.vy; this.vy = 0; this.onGround = true; }
      else {
        const c = col.ceiling(rs, this.x, this.z, this.y + 0.6, 0.25);
        if (this.y + P.height > c) { this.y = c - P.height; if (this.vy > 0) this.vy = 0; }
      }
    } else this.vy = 0;
  }
}
