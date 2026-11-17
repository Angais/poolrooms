// Catálogo de arquetipos de sala. Cada uno define: peso de aparición, plan (tamaño y
// variante), huecos candidatos en su perímetro y su constructor geométrico.
import { link, corridor, pool, flood } from './builders_pool.js';
import { stairs, atrium, tower, rotunda } from './builders_vert.js';
import { office, garage, duct } from './builders_back.js';

export const DEFS = [link, corridor, pool, flood, stairs, atrium, tower, rotunda, office, garage, duct];
