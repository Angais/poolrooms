// Constantes globales del mundo. Todo el generador trabaja sobre una retícula 3D:
// celdas de CS × LH × CS metros. Las salas ocupan cajas de celdas y nunca se solapan.
export const CS = 6;        // lado horizontal de celda (m)
export const LH = 4;        // altura de nivel (m)
export const T = 0.3;       // semiespesor de muro/forjado que aporta cada sala
export const NL = 10;       // niveles disponibles (0..NL-1)
export const START_LEVEL = 4;

// Alturas estándar relativas al suelo seco de un nivel (deck = l*LH + T)
export const FLOOD_FLOOR = -0.26;   // suelo de sala inundada (cabe dentro del forjado)
export const FLOOD_WATER = -0.06;   // superficie del agua en sala inundada
export const STEP_RISE = 0.2;

// Materiales (id que viaja por vértice al shader)
export const M = {
  TILE: 0, POOL: 1, BIGTILE: 2, PLASTER: 3, EMIT: 4,
  WALLPAPER: 5, CARPET: 6, CONCRETE: 7, TRIM: 8, CEILGRID: 9,
};

// Tipos de hueco entre salas (máscara de bits)
export const K = { DOOR: 1, ARCH: 2, OPEN: 4, WIN: 8, WALK: 7 };
export const PORTAL_DIM = {
  1: { w: 1.5, h: 2.35 },
  2: { w: 2.8, h: 2.9 },
  4: { w: 5.0, h: 3.3 },
  8: { w: 3.2, h: 1.3, sill: 1.05 },
};

// Jugador
export const PLAYER = {
  radius: 0.34, height: 1.72, eye: 1.6, stepUp: 0.36,
  walk: 3.1, wade: 2.3, swim: 2.3, gravity: 18,
  swimDepth: 1.35,          // profundidad mínima de columna de agua para nadar
};

// Streaming
export const STREAM = { depth: 4, keepDepth: 5, maxDist: 58, budgetMs: 4.5 };
