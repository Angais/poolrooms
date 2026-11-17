# Poolrooms

Exploración en primera persona de unos Poolrooms infinitos generados proceduralmente.
Sin dependencias de compilación: módulos ES servidos tal cual, con three.js incluido en `vendor/`.

## Ejecutar

```bash
npm start
```

Abre <http://localhost:5173>. Cualquier servidor estático sirve igual (hace falta servidor por los módulos ES).
`?seed=texto` fija el mundo; `?debug` muestra fps, salas cargadas y la sala actual.

## Controles

| Tecla | Acción |
| --- | --- |
| `W` `A` `S` `D` / flechas | caminar; nadar en agua profunda |
| ratón | mirar (clic para capturar el cursor, `Esc` para soltarlo) |
| `F` o clic derecho | linterna |
| `Espacio` / `C` | subir / bucear (solo nadando) |

## Cómo está hecho

```
index.html, styles.css      interfaz mínima (menú, carga, pausa)
server.mjs                  servidor estático sin dependencias
src/main.js                 arranque, bucle, resolución adaptativa, ambiente por zona
src/config.js               retícula del mundo, materiales, jugador, streaming
src/player.js               entrada, cámara, pasos, ondas, linterna
src/physics.js              colisiones (cajas, cilindros, sectores, cáscaras) y cuerpo del jugador
src/audio.js                audio procedural: reverberación por sala, agua posicional, pasos, eventos
src/world/layout.js         retícula de ocupación + grafo de salas y huecos (crecimiento incremental)
src/world/archetypes.js     catálogo de arquetipos
src/world/builders_*.js     piscinas, salas inundadas, pasillos, atrios, torres helicoidales, rotondas, Backrooms
src/world/brush.js          API de construcción con sólidos, luces y agua
src/world/mesh.js           unión CSG de cajas, primitivas curvas e iluminación horneada por vértice
src/world/stream.js         carga/descarga de salas alrededor del jugador, repartida entre fotogramas
src/render/surface.js       material procedural (azulejo, gresite, moqueta…), cáusticas, especular, linterna
src/render/water.js         agua: refracción con absorción, reflexiones SSR, Fresnel, ondas
src/render/pipeline.js      cadena HDR: opaco → agua → bloom → tonemapping
tools/check.mjs             verificación automática del generador
```

**Solidez por construcción.** El mundo es una retícula 3D de celdas de 6 × 4 × 6 m. Cada sala reserva
una caja de celdas en exclusiva, así que dos estructuras no pueden atravesarse. Los huecos entre salas se
definen una sola vez y los comparten ambos lados. La geometría de cada sala es la unión CSG exacta de sus
sólidos: solo se emiten las caras realmente visibles. Los huecos hacia salas aún no construidas se cierran
con un telón de niebla que además colisiona, de modo que nunca se ve ni se pisa el vacío.

**Verificación.** `npm run check` genera varios mundos, construye cientos de salas y recorre cada una con
la física real del jugador: comprueba que todas las salidas son alcanzables y que desde cualquier punto al
que se pueda llegar (incluido caerse a una piscina) se puede volver.

```bash
npm run check            # 4 semillas × 160 salas
npm run check -- 8 300 80
```
