// Aleatoriedad determinista: hash entero, PRNG con semilla y ruido de valor 2D.

export function hash3(a, b, c, seed = 0) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 16;
  h = Math.imul(h ^ (c | 0), 0x27d4eb2f); h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1); h ^= h >>> 13;
  return h >>> 0;
}

export function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  u32() {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  f() { return this.u32() / 4294967296; }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }   // inclusivo
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  weighted(items, wf) {
    let tot = 0;
    const ws = items.map((it) => { const w = Math.max(0, wf(it)); tot += w; return w; });
    if (tot <= 0) return items[0];
    let r = this.f() * tot;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
}

const sm = (t) => t * t * (3 - 2 * t);
export function vnoise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = sm(x - xi), fy = sm(y - yi);
  const h = (i, j) => hash3(i, j, 77, seed) / 4294967296;
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
