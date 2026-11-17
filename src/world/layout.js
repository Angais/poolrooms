// Trazado del mundo: retícula 3D de ocupación + grafo de salas y huecos.
// El mundo crece de forma incremental: una sala "planificada" solo reserva celdas;
// al "finalizarla" se resuelven todos sus huecos (se abren hacia salas nuevas,
// se enlazan con vecinas aún no finalizadas o se sellan). Como cada sala reserva
// celdas exclusivas, es imposible que dos estructuras se atraviesen.
import { CS, LH, NL, K, PORTAL_DIM, START_LEVEL } from '../config.js';
import { Rng, hash3, vnoise2 } from '../rng.js';

const ckey = (i, l, k) => i + ',' + l + ',' + k;
export const skey = (side, a, r) => side * 10000 + a * 100 + r;
const OPP = [1, 0, 3, 2];

// Marco del constructor (u,v) → marco de sala (x,z) según la rotación (múltiplos de 90°)
export function fwd(room, u, v) {
  const W = room.ni * CS, D = room.nk * CS;
  switch (room.rot) {
    case 1: return [W - v, u];
    case 2: return [W - u, D - v];
    case 3: return [v, D - u];
    default: return [u, v];
  }
}
export function inv(room, x, z) {
  const W = room.ni * CS, D = room.nk * CS;
  switch (room.rot) {
    case 1: return [z, W - x];
    case 2: return [W - x, D - z];
    case 3: return [D - z, x];
    default: return [x, z];
  }
}
function sideOf(x, z, W, D) {
  if (x < 0.01) return 0; if (x > W - 0.01) return 1;
  if (z < 0.01) return 2; return 3;
}
// hueco definido en el marco del constructor → {side,a,r,k} en el marco de sala
function slotToRoom(room, s) {
  const Wb = room.nu * CS, Db = room.nv * CS, c = (s.a + 0.5) * CS;
  const pb = s.side === 0 ? [0, c] : s.side === 1 ? [Wb, c] : s.side === 2 ? [c, 0] : [c, Db];
  const [x, z] = fwd(room, pb[0], pb[1]);
  const side = sideOf(x, z, room.ni * CS, room.nk * CS);
  return { side, a: Math.floor((side < 2 ? z : x) / CS), r: s.r, k: s.k };
}
// perímetro completo de un nivel (marco del constructor)
export function perim(nu, nv, r, k, filter) {
  const out = [];
  for (let a = 0; a < nv; a++) { out.push({ side: 0, a, r, k }, { side: 1, a, r, k }); }
  for (let a = 0; a < nu; a++) { out.push({ side: 2, a, r, k }, { side: 3, a, r, k }); }
  return filter ? out.filter(filter) : out;
}

const STYLES = [
  { wall: [0.93, 0.95, 0.96], floor: [0.88, 0.92, 0.94], accent: [0.13, 0.36, 0.58], pool: [0.62, 0.86, 0.93] },
  { wall: [0.95, 0.93, 0.86], floor: [0.9, 0.88, 0.8], accent: [0.1, 0.45, 0.47], pool: [0.6, 0.88, 0.86] },
  { wall: [0.86, 0.94, 0.92], floor: [0.82, 0.9, 0.88], accent: [0.08, 0.3, 0.36], pool: [0.55, 0.85, 0.8] },
  { wall: [0.88, 0.92, 0.97], floor: [0.84, 0.88, 0.94], accent: [0.1, 0.16, 0.42], pool: [0.58, 0.78, 0.95] },
  { wall: [0.96, 0.92, 0.9], floor: [0.92, 0.88, 0.86], accent: [0.62, 0.3, 0.26], pool: [0.66, 0.88, 0.9] },
];

export class Layout {
  constructor(seed, defs) {
    this.seed = seed >>> 0;
    this.defs = defs;
    this.byName = Object.fromEntries(defs.map((d) => [d.name, d]));
    this.rooms = [];
    this.occ = new Map();
    this.portals = [];
    this.frontier = 0;      // salas planificadas sin finalizar
  }

  cellRoom(i, l, k) {
    const id = this.occ.get(ckey(i, l, k));
    return id === undefined ? null : this.rooms[id];
  }
  roomAtWorld(x, y, z) {
    return this.cellRoom(Math.floor(x / CS), Math.floor(y / LH), Math.floor(z / CS));
  }

  zoneAt(i, l, k) {
    if (Math.abs(i) + Math.abs(k) < 7) return 'pool';
    const band = Math.floor(l / 3) * 31.7;
    const n = vnoise2(i * 0.09 + band, k * 0.09 - band, this.seed);
    if (n > 0.66) return 'yellow';
    if (n < 0.31) return 'concrete';
    return 'pool';
  }

  free(i0, l0, k0, ni, nl, nk) {
    if (l0 < 0 || l0 + nl > NL) return false;
    for (let i = i0; i < i0 + ni; i++)
      for (let l = l0; l < l0 + nl; l++)
        for (let k = k0; k < k0 + nk; k++)
          if (this.occ.has(ckey(i, l, k))) return false;
    return true;
  }

  addRoom(def, plan, rot, i0, l0, k0, zone, from) {
    const odd = rot & 1;
    const room = {
      id: this.rooms.length, def, arch: def.name, rot,
      nu: plan.nu, nv: plan.nv, nl: plan.nl, b: plan.b || 0, v: plan.v || {},
      ni: odd ? plan.nv : plan.nu, nk: odd ? plan.nu : plan.nv,
      i0, l0, k0, zone, flooded: !!plan.flooded, big: plan.nu * plan.nv * plan.nl >= 16,
      portals: [], used: new Set(), slots: new Map(), final: false, built: false,
    };
    room.seed = hash3(i0, l0, k0, this.seed ^ (room.id * 2654435761));
    const sn = vnoise2(i0 * 0.07 + 40, k0 * 0.07 + 11, this.seed + 5);
    room.style = STYLES[Math.floor(sn * 4.999 * 1.7) % STYLES.length];
    room.tens = from ? (room.big ? 0 : from.tens + 1) : 0;
    const mr = (room.seed >>> 8) % 100;
    room.mood = zone === 'pool' ? (mr < 68 ? 'day' : mr < 84 ? 'dim' : 'night') : zone === 'yellow' ? 'day' : 'dim';
    for (const s of def.slots(room)) {
      const rs = slotToRoom(room, s);
      room.slots.set(skey(rs.side, rs.a, rs.r), rs);
    }
    for (let i = i0; i < i0 + room.ni; i++)
      for (let l = l0; l < l0 + room.nl; l++)
        for (let k = k0; k < k0 + room.nk; k++) this.occ.set(ckey(i, l, k), room.id);
    this.rooms.push(room);
    this.frontier++;
    return room;
  }

  start() {
    const def = this.byName.pool;
    const rng = new Rng(this.seed ^ 0x51ab);
    const plan = def.plan(rng, { first: true });
    const room = this.addRoom(def, plan, 0, 0, START_LEVEL - (plan.b || 0), 0, 'pool', null);
    room.mood = 'day';
    return room;
  }

  // celda exterior al hueco (side,a,r) de una sala
  outerCell(room, s) {
    const l = room.l0 + s.r;
    if (s.side === 0) return [room.i0 - 1, l, room.k0 + s.a];
    if (s.side === 1) return [room.i0 + room.ni, l, room.k0 + s.a];
    if (s.side === 2) return [room.i0 + s.a, l, room.k0 - 1];
    return [room.i0 + s.a, l, room.k0 + room.nk];
  }

  // Intenta colocar una sala nueva que contenga la celda (ci,cl,ck) con un hueco
  // transitable en su cara `needSide`. El arquetipo 'link' (1 celda) siempre cabe.
  place(ci, cl, ck, needSide, kmask, from, rng) {
    const zone = this.zoneAt(ci, cl, ck);
    const ctx = { zone, from, tens: from.tens, level: cl, rng };
    const pool = this.defs.filter((d) => d.zone === zone || d.zone === 'any');
    for (let attempt = 0; attempt < 14; attempt++) {
      const def = attempt < 13 ? rng.weighted(pool, (d) => d.w(ctx)) : this.byName.link;
      const plan = def.plan(rng, ctx);
      for (const rot of rng.shuffle([0, 1, 2, 3])) {
        const odd = rot & 1;
        const tent = { ...plan, rot, ni: odd ? plan.nv : plan.nu, nk: odd ? plan.nu : plan.nv, v: plan.v || {}, b: plan.b || 0 };
        const cands = def.slots(tent).map((s) => slotToRoom(tent, s))
          .filter((s) => s.side === needSide && (s.k & kmask & K.WALK));
        rng.shuffle(cands);
        for (let c = 0; c < Math.min(cands.length, 5); c++) {
          const e = cands[c];
          const l0 = cl - e.r;
          const i0 = e.side === 0 ? ci : e.side === 1 ? ci - (tent.ni - 1) : ci - e.a;
          const k0 = e.side === 2 ? ck : e.side === 3 ? ck - (tent.nk - 1) : ck - e.a;
          if (!this.free(i0, l0, k0, tent.ni, plan.nl, tent.nk)) continue;
          const room = this.addRoom(def, plan, rot, i0, l0, k0, zone, from);
          return { room, slot: room.slots.get(skey(e.side, e.a, e.r)) };
        }
      }
    }
    return null;
  }

  connect(A, sa, B, sb, rng, forceWin) {
    const common = sa.k & sb.k;
    let kind = K.WIN;
    if (!forceWin && (common & K.WALK)) {
      const same = A.zone === B.zone;
      const opts = [];
      if (common & K.DOOR) opts.push([K.DOOR, same ? 2 : 5]);
      if (common & K.ARCH) opts.push([K.ARCH, same ? 3 : 1.5]);
      if (common & K.OPEN) opts.push([K.OPEN, same ? 3.5 : 0.3]);
      kind = rng.weighted(opts, (o) => o[1])[0];
    }
    const dim = PORTAL_DIM[kind];
    const p = {
      id: this.portals.length, a: A.id, b: B.id, kind, w: dim.w, h: dim.h, sill: dim.sill || 0,
      wet: kind !== K.WIN && A.flooded && B.flooded,
    };
    this.portals.push(p);
    A.portals.push({ p, side: sa.side, a: sa.a, r: sa.r, other: B.id });
    B.portals.push({ p, side: sb.side, a: sb.a, r: sb.r, other: A.id });
    A.used.add(skey(sa.side, sa.a, sa.r));
    B.used.add(skey(sb.side, sb.a, sb.r));
    return p;
  }

  // Resuelve todos los huecos de la sala. Tras esto su geometría queda congelada.
  finalize(room) {
    if (room.final) return;
    const rng = new Rng(room.seed ^ 0x7f4a7c15);
    const empty = [], linkable = [];
    for (const [key, s] of room.slots) {
      if (room.used.has(key)) continue;
      const [ci, cl, ck] = this.outerCell(room, s);
      if (cl < 0 || cl >= NL) continue;
      const other = this.cellRoom(ci, cl, ck);
      if (!other) { if (s.k & K.WALK) empty.push(s); continue; }
      if (other.final || other === room) continue;
      const os = other.slots.get(skey(OPP[s.side], this.alongIndex(other, s, ci, ck), cl - other.l0));
      if (os && !other.used.has(skey(os.side, os.a, os.r)) && (s.k & os.k)) linkable.push([s, other, os]);
    }
    rng.shuffle(empty); rng.shuffle(linkable);
    // enlaces con salas vecinas ya planificadas → bucles y ventanas
    for (const [s, other, os] of linkable) {
      const walk = s.k & os.k & K.WALK;
      if (walk && rng.chance(0.62)) this.connect(room, s, other, os, rng, false);
      else if ((s.k & os.k & K.WIN) && rng.chance(0.75)) this.connect(room, s, other, os, rng, true);
    }
    // aperturas hacia espacio libre → salas nuevas
    const d = room.def;
    const lone = this.frontier <= 3;
    let want = Math.round(empty.length * (d.open ?? 0.4) + rng.range(-0.4, 0.6));
    want = Math.max(lone ? 3 : (d.minOut ?? 1), Math.min(d.maxOut ?? 4, want));
    if (room.portals.length === 0) want = Math.max(want, 2);
    // se priorizan las plantas que aún no tienen salida (clave en salas verticales)
    const lv = new Map();
    for (const pp of room.portals) lv.set(pp.r, (lv.get(pp.r) || 0) + 1);
    let opened = 0;
    while (opened < want && empty.length) {
      let bi = 0, bc = 1e9;
      for (let i = 0; i < empty.length; i++) { const c = lv.get(empty[i].r) || 0; if (c < bc) { bc = c; bi = i; } }
      const s = empty.splice(bi, 1)[0];
      const [ci, cl, ck] = this.outerCell(room, s);
      if (this.occ.has(ckey(ci, cl, ck))) continue;     // ocupada por una sala recién colocada
      const res = this.place(ci, cl, ck, OPP[s.side], s.k, room, rng);
      if (!res) continue;
      this.connect(room, s, res.room, res.slot, rng, false);
      lv.set(s.r, bc + 1);
      opened++;
    }
    room.final = true;
    this.frontier--;
  }

  // índice "a" que corresponde en la sala vecina a la celda exterior (ci,ck)
  alongIndex(other, s, ci, ck) {
    return s.side < 2 ? ck - other.k0 : ci - other.i0;
  }
}

export function roomOrigin(room) { return [room.i0 * CS, room.l0 * LH, room.k0 * CS]; }
