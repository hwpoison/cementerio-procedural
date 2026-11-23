# Cementerio Infinito — código fuente

Cementerio procedural infinito en primera persona (Three.js): chunks
generados al caminar, clima y hora físicos (sol y luna con una sola ley
de luz), panteones con puertas que se abren, placas con rostros y
árboles genealógicos, sonido ambiental dinámico. Todo local, sin
servidor: se abre `index.html` y se juega.

## Estructura

- `index.html` — la página: carga los módulos en orden y contiene la
  interfaz (menú, HUD, botones táctiles, panel DEBUG).
- `assets/js/` — el motor, en 18 módulos JavaScript clásicos (sin
  bundler; cada uno cuelga de los globales que declaran los anteriores,
  en el orden en que `index.html` los carga):
  - `utils.js` — RNG con semilla, hashes, rutas de assets.
  - `texdata.js` — datos de texturas procedurales de respaldo.
  - `plaques.js` — atlas de placas, base de rostros y genealogías.
  - `scene.js` — renderer, escena, cielo y parche de luz del cielo.
  - `materials.js` — materiales y sus parches de shader (luz interior,
    contraluz, humedad, mármol, cristal).
  - `geometry.js` — constructores de geometría (tumbas, panteones,
    cercas) y el sistema de buckets por material.
  - `trees.js` — ciprés real (GLB con LOD) y su carga.
  - `deco.js` — decoración descargada (ángel y cruces GLB) y su carga.
  - `world.js` — generación de chunks, haz de ventana, puertas,
    colisiones.
  - `player.js` — controles, física del jugador y el personaje (Xbot).
  - `audio.js` — paisaje sonoro dinámico y pasos por material.
  - `reading.js` — lectura de placas e interacción con puertas.
  - `climate.js` — modelo climático (temperatura, humedad, nubes,
    lluvia) del que deriva todo lo demás.
  - `wet.js` — suelo mojado y charcos según la lluvia local.
  - `weather.js` — sol, luna, luz de la escena y clima en vivo.
  - `sky.js` — cielo, halo solar/lunar y velo de cámara.
  - `debug.js` — panel DEBUG por pestañas y regeneración de chunks.
  - `main.js` — arranque: carga de texturas, arranque del bucle y UI.
- `assets/css/main.css` — toda la presentación.
- `assets/` (resto) — texturas, modelos GLB, sonidos y las librerías
  `three.min.js` (r186, con GLTFLoader y BufferGeometryUtils) y
  `cannon.min.js`.
- `dist/index.html` — la compilación: el juego entero en un solo HTML
  autocontenido, tal como lo sirve el artefacto publicado.
- `CHANGELOG.md` — registro de todas las modificaciones, por versión.
- `TODO.md` — sugerencias de Guille y su estado; se revisa antes de
  cada cambio.
- `ESQUEMA-FENOMENO-CONSECUENCIA.md` — la ley de diseño del motor:
  todo efecto visual o sonoro deriva de un fenómeno simulado, sin
  valores dibujados a mano.

## Créditos de assets

- Ángel «Cathedral angel» de Polyfork (CC BY 4.0).
- Cruces del Graveyard Kit de Kenney (CC0).
- Ciprés «Young Italian Cypress» de tevy (CC0).
- Texturas de Poly Haven y ambientCG (CC0), según cada archivo.
