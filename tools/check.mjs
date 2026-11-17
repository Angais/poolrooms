// Verificación sin navegador:  npm run check [-- semillas salasPorSemilla]
// Genera mundos, construye todas las salas y comprueba: huecos coherentes entre salas,
// geometría sin NaN, y —con la física real del jugador— que desde cualquier punto
// alcanzable de una sala se llega a todas sus salidas y se puede volver (sin trampas).
import { Layout, roomOrigin } from '../src/world/layout.js';
import { DEFS } from '../src/world/archetypes.js';
import { buildRoomSync } from '../src/world/build.js';
import { Colliders, Body } from '../src/physics.js';
import { CS, LH, T, K, FLOOD_FLOOR } from '../src/config.js';

const SEEDS = Number(process.argv[2] || 4), ROOMS = Number(process.argv[3] || 160), WALK = Number(process.argv[4] || 40);
const bbOf = (r) => { const o = roomOrigin(r); return [o[0], o[1], o[2], o[0] + r.ni * CS, o[1] + r.nl * LH, o[2] + r.nk * CS]; };
function portalPoint(room, pp, inset) {
  const o = roomOrigin(room), c = (pp.a + 0.5) * CS, W = room.ni * CS, D = room.nk * CS;
  const y = o[1] + pp.r * LH + T + (pp.p.wet ? FLOOD_FLOOR : 0);
  if (pp.side === 0) return [o[0] + inset, y, o[2] + c];
  if (pp.side === 1) return [o[0] + W - inset, y, o[2] + c];
  if (pp.side === 2) return [o[0] + c, y, o[2] + inset];
  return [o[0] + c, y, o[2] + D - inset];
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
const keyOf = (b) => Math.round(b.x / 0.45) + ',' + Math.round(b.y / 0.3) + ',' + Math.round(b.z / 0.45);

function walkTest(room, built, layout) {
  const col = new Colliders();
  col.add(room.id, bbOf(room), built.get(room.id));
  for (const pp of room.portals) { const o = layout.rooms[pp.other]; if (built.has(o.id)) col.add(o.id, bbOf(o), built.get(o.id)); }
  const walk = room.portals.filter((pp) => pp.p.kind !== K.WIN);
  if (!walk.length) return { ok: true, n: 0 };
  const bb = bbOf(room), start = new Body(), sp = portalPoint(room, walk[0], 0.9);
  start.x = sp[0]; start.y = sp[1] + 0.02; start.z = sp[2]; start.onGround = true;
  for (let i = 0; i < 20; i++) start.update(col, 1 / 30, { fx: 1, fz: 0, rx: 0, rz: 1, mf: 0, ms: 0, up: 0, pitch: 0 });
  const nodes = [start], keys = new Map([[keyOf(start), 0]]), edges = [[]];
  const inp = { fx: 0, fz: 0, rx: 0, rz: 0, mf: 1, ms: 0, up: 0, pitch: 0 }, idle = { ...inp, mf: 0 };
  for (let h = 0; h < nodes.length && nodes.length < 9000; h++) {
    for (const d of DIRS) {
      const b = nodes[h].clone(); b.vx = b.vz = 0;
      inp.fx = d[0]; inp.fz = d[1]; inp.rx = -d[1]; inp.rz = d[0];
      let out = false;
      const outside = () => b.x < bb[0] - 0.25 || b.x > bb[3] + 0.25 || b.z < bb[2] - 0.25 || b.z > bb[5] + 0.25;
      const sx = b.x, sz = b.z;
      for (let i = 0; i < 26 && !(out = outside()) && Math.hypot(b.x - sx, b.z - sz) < 0.5; i++) b.update(col, 1 / 30, inp);
      if (out || outside()) continue;                       // cruzó a la sala vecina
      for (let i = 0; i < 80 && !b.onGround && !b.swim; i++) b.update(col, 1 / 30, idle);
      if (b.swim) for (let i = 0; i < 10; i++) b.update(col, 1 / 30, idle);
      if (!(b.y > bb[1] - 2)) return { ok: false, why: 'cae al vacío', at: [nodes[h].x, nodes[h].y, nodes[h].z] };
      const k = keyOf(b);
      let j = keys.get(k);
      if (j === undefined) { j = nodes.length; nodes.push(b); keys.set(k, j); edges.push([]); }
      edges[h].push(j);
    }
  }
  // todas las salidas alcanzadas
  for (const pp of walk) {
    const q = portalPoint(room, pp, 0.9);
    if (!nodes.some((n) => Math.hypot(n.x - q[0], n.z - q[2]) < 1.1 && Math.abs(n.y - q[1]) < 0.7)) return { ok: false, why: 'salida inalcanzable', at: q, n: nodes.length };
  }
  // sin trampas: todo nodo debe poder volver al inicio
  const rev = nodes.map(() => []);
  edges.forEach((es, i) => es.forEach((j) => rev[j].push(i)));
  const back = new Uint8Array(nodes.length); back[0] = 1;
  const st = [0];
  while (st.length) { const i = st.pop(); for (const j of rev[i]) if (!back[j]) { back[j] = 1; st.push(j); } }
  const trap = nodes.findIndex((_, i) => !back[i]);
  if (trap >= 0 && process.env.DBG) {
    const tr = nodes.filter((_, i) => !back[i]);
    const mm = (f) => [Math.min(...tr.map(f)).toFixed(2), Math.max(...tr.map(f)).toFixed(2)];
    console.log('    trampa bbox x', mm((n) => n.x), 'y', mm((n) => n.y), 'z', mm((n) => n.z), 'swim', tr.filter((n) => n.swim).length, 'origen', roomOrigin(room), 'inicio', sp.map((v) => v.toFixed(1)));
  }
  if (trap >= 0 && process.env.DBG) {
    const t = nodes[trap];
    console.log('    estado', JSON.stringify(t));
    for (const d of DIRS.slice(0, 4)) {
      const b = t.clone(); b.vx = b.vz = 0; const tr = [];
      const ii = { fx: d[0], fz: d[1], rx: -d[1], rz: d[0], mf: 1, ms: 0, up: 0, pitch: 0 };
      for (let i = 0; i < 30; i++) { b.update(col, 1 / 30, ii); if (i % 5 === 4) tr.push(`${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}${b.swim ? 's' : ''}${b.onGround ? 'g' : ''}`); }
      console.log('     ', d, tr.join('  '));
    }
  }
  if (trap >= 0) { const t = nodes[trap]; return { ok: false, why: 'trampa sin retorno', at: [t.x, t.y, t.z], n: nodes.length, bad: back.reduce((a, v) => a + (v ? 0 : 1), 0) }; }
  return { ok: true, n: nodes.length };
}

let fails = 0;
for (let s = 0; s < SEEDS; s++) {
  const seed = 1000 + s * 7919, layout = new Layout(seed, DEFS);
  const q = [layout.start()], seen = new Set([0]), fin = [];
  while (q.length && fin.length < ROOMS) {
    const r = q.shift(); layout.finalize(r); fin.push(r);
    for (const pp of r.portals) if (!seen.has(pp.other)) { seen.add(pp.other); q.push(layout.rooms[pp.other]); }
  }
  // huecos coherentes
  for (const p of layout.portals) {
    const A = layout.rooms[p.a], B = layout.rooms[p.b];
    const pa = A.portals.find((x) => x.p === p), pb = B.portals.find((x) => x.p === p);
    const a = portalPoint(A, pa, 0), b = portalPoint(B, pb, 0);
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1e-6) { fails++; console.log('  ✗ hueco desalineado', A.arch, B.arch, a, b); }
  }
  const built = new Map(), hist = {}, zones = {};
  let verts = 0, tMax = 0, tSum = 0, worst = '';
  for (const r of fin) {
    const t0 = performance.now();
    let d;
    try { d = buildRoomSync(r); } catch (e) { fails++; console.log('  ✗ excepción construyendo', r.arch, JSON.stringify(r.v), e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
    const dt = performance.now() - t0; tSum += dt; if (dt > tMax) { tMax = dt; worst = `${r.arch} ${r.ni}x${r.nl}x${r.nk}`; }
    for (const arr of [d.pos, d.light, d.uv, d.wpos, d.wlight]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { fails++; console.log('  ✗ NaN en', r.arch); break; }
    built.set(r.id, d); verts += d.pos.length / 3;
    hist[r.arch] = (hist[r.arch] || 0) + 1; zones[r.zone] = (zones[r.zone] || 0) + 1;
  }
  const levels = new Set(fin.map((r) => r.l0 + r.b));
  console.log(`semilla ${seed}: ${fin.length} salas, ${layout.portals.length} huecos, ${verts} vértices, build medio ${(tSum / fin.length).toFixed(1)} ms, máx ${tMax.toFixed(0)} ms (${worst}), plantas ${[...levels].sort((a, b) => a - b).join(' ')}`);
  console.log('  ', JSON.stringify(hist), JSON.stringify(zones));
  let tested = 0;
  const perArch = {};
  for (const r of fin) {
    if (tested >= WALK) break;
    if ((perArch[r.arch] || 0) >= Math.ceil(WALK / 8) || !built.has(r.id)) continue;
    perArch[r.arch] = (perArch[r.arch] || 0) + 1; tested++;
    const res = walkTest(r, built, layout);
    if (!res.ok) { fails++; console.log(`  ✗ ${r.arch} #${r.id} ${r.ni}x${r.nl}x${r.nk} rot${r.rot} ${r.flooded ? 'inundada ' : ''}${JSON.stringify(r.v)}: ${res.why} en ${res.at.map((v) => v.toFixed(1))} (${res.n} nodos, ${res.bad || ''})`); }
  }
  console.log(`   recorridos verificados: ${tested}`);
}
console.log(fails ? `\n${fails} FALLOS` : '\nTodo correcto ✔');
process.exit(fails ? 1 : 0);
