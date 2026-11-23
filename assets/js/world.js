/* world.js — Matriz virtual de chunks centrada en el jugador (generación
   invisible, pool y reutilización), mundo físico cannon.js, cuerpo del
   jugador y colisionadores por chunk. Depende de: scene, materials, geometry. */
'use strict';
    /* ================= Chunks: generación invisible tras la niebla =================
       Chunk de 30 m. Se genera a anillo 4 (borde más cercano ≥ 105 m, con la
       niebla ya al ~97 %) y además entra con fundido; se retira a anillo 5
       (≥ 135 m, niebla total) también con fundido. Nada aparece a la vista. */
    var CHUNK = 30, LOAD_R = 4, DROP_R = 5;
    var chunks = {};       // "cx,cz" -> chunk
    var buildQueue = [];   // claves pendientes, cerca primero
    var fading = [];       // chunks en fundido de entrada o salida
    var fastFadeUntil = 0; // tras un regen del menú debug, los chunks nuevos entran rápido
    /* Ajustes del menú DEBUG (se aplican en vivo, sin persistir) */
    var SETTINGS = { density: 0.1, kinds: [true, true, true, true, true], mausoleum: true, walkSpeed: 5.2, runSpeed: 7.8, noclip: false, grass: 0, trees: 0 }; // densidad de tumbas al 10 % por defecto (a pedido); vegetación en 0 por defecto: se activa desde los sliders del debug (las nubes volumétricas se eliminaron: solo queda la capa del cielo)
    var settingsVer = 0; // sube en cada regen: invalida la caché de chunks
    /* Pool de chunks: los que salen del anillo se guardan (máx. 10) y se
       reutilizan tal cual si el jugador vuelve, sin regenerar geometría. */
    var chunkCache = [];
    var MAT_KEYS = ['light', 'mid', 'dark', 'moss', 'marble', 'cement', 'plaque', 'plaqueFam', 'foliage', 'foliage2', 'wood', 'iron', 'dirt', 'door', 'doorA', 'doorB', 'grass', 'cypress', 'glassThin', 'glassThick', 'glassFrost'];
    var GLASS_KEYS = ['glassThin', 'glassThick', 'glassFrost']; // cristales de ventana (v60): quedan transparentes SIEMPRE — el fundido de chunk no los vuelve opacos
    // materiales que se mecen con el viento: césped, copas y madera de los
    // árboles (troncos y ramas desnudas) — reciben el parche de balanceo
    var SWAY_KEYS = { grass: 1, foliage: 1, foliage2: 1, wood: 1, cypress: 1 };

    function keyOf(cx, cz) { return cx + ',' + cz; }

    /* CÁSCARA DE CONTRALUZ (v69, materials.js makeRimHullMaterial):
       fusiona la geometría opaca del bucket cercano (solo posición
       y normal: es lo único que el shader de la cáscara lee) en UNA
       malla por chunk. Las geometrías del bucket ya vienen
       transformadas a coordenadas del chunk y no indexadas (o se
       desindexan aquí); los atributos se COPIAN (slice) porque el
       dispose del chunk libera cada geometría por su lado y dos
       geometrías no pueden compartir el mismo BufferAttribute. */
    function buildRimHullGeometry(bucket) {
      var parts = [];
      for (var k in bucket.map) {
        if (!RIMHULL_KEYS[k]) continue;
        for (var i = 0; i < bucket.map[k].length; i++) {
          var g = bucket.map[k][i];
          if (!g.attributes || !g.attributes.position || !g.attributes.normal) continue;
          var ng = g.index ? g.toNonIndexed() : g;
          var out = new THREE.BufferGeometry();
          out.setAttribute('position', new THREE.BufferAttribute(ng.attributes.position.array.slice(), 3));
          out.setAttribute('normal', new THREE.BufferAttribute(ng.attributes.normal.array.slice(), 3));
          parts.push(out);
        }
      }
      if (!parts.length) return null;
      var merged = THREE.BufferGeometryUtils.mergeGeometries(parts, false);
      for (var j = 0; j < parts.length; j++) parts[j].dispose();
      return merged;
    }

    function buildChunk(cx, cz, instant) {
      /* Sin materiales base no hay chunk posible: los GLB (ciprés y
         decoración) cargan en paralelo a las texturas y al quedar
         listos piden scheduleRegen; si eso llega ANTES de que
         buildMaterials llene MAT, el clonado de materiales de abajo
         reventaba con «Cannot read properties of undefined (reading
         'clone')» y el banner de error ensuciaba la pantalla de
         inicio (venía de antes de la v72; la captura de la v73 lo
         pescó en world.js:74). Se devuelve null y el chunk queda
         ausente: el streaming lo reintenta en cuanto MAT exista. */
      if (!MAT.light) return null;
      var rng = chunkRng(cx, cz);
      /* Panteón de ESTE chunk (v60/v64): buildMausoleum sortea más
         abajo su TAMAÑO (clásico o grande) y su ventana ÚNICA (pared
         y cristal) y deja la cfg aquí; los materiales interiores la
         leen al compilar (onBeforeCompile corre al primer render,
         cuando la cfg ya existe) para aplicar la ley de luz interior
         sobre la cavidad real y sumar el ángulo sólido de la ventana
         al de la puerta. La clave de caché de programa lleva la
         marca de tamaño y ventana para que cada combinación compile
         su propio shader. Sin panteón, cfg queda null y el parche
         usa la planta clásica (no hay cavidad que detectar). */
      var mausHolder = { cfg: null };
      var chunkWin = null, chunkMaus = null, chunkDoor = null; // lo que el chunk expone (haz, lectura, interacción): ventana, planta y puerta en coords del chunk
      var famTex = null, mausDoorF0 = 0; // v70: textura del atlas familiar del panteón (si lo hay) y fracción de puerta con la que nace (1 = nace abierta)
      var mats = {};
      for (var i = 0; i < MAT_KEYS.length; i++) {
        var k = MAT_KEYS[i];
        mats[k] = MAT[k].clone(); mats[k].transparent = true; mats[k].opacity = 0;
        // humedad por material (wet.js): cada clave cae en una clase
        // (piedra, placa pulida, sendero, madera, césped, hierro) con su
        // respuesta propia; la clave de caché incluye la clase porque el
        // GLSL inyectado lleva sus constantes horneadas
        (function (mat, kk) {
          var wk = WET_KIND[kk] || 'stone';
          var sway = !!SWAY_KEYS[kk];
          var isStone = (kk === 'light' || kk === 'mid' || kk === 'dark' || kk === 'moss' || kk === 'plaque'); // piedra de cemento: solo ella recibe la ganancia de sol directo calibrable (DEBUG → ILUMINACIÓN)
          var isMarble = (kk === 'marble'); // mármol pulido de los panteones: dispersión interna propia (applyMarblePatch); NO es cemento — el slider de sol del cemento no lo toca
          var isInterior = (kk === 'marble' || kk === 'cement' || kk === 'plaque' || kk === 'plaqueFam' || kk === 'door' || kk === 'doorA' || kk === 'doorB' || kk === 'iron'); // materiales que visten el INTERIOR del panteón: su difusa entra solo por las aberturas (applyInteriorPatch, materials.js)
          var isGlass = !!GLASS_TYPES[kk]; // cristal de ventana (v60): su óptica es applyGlassPatch y nada más — ni humedad, ni rebote, ni sombra de nube sobre el albedo: el paño transmite y refleja, no es una superficie opaca
          mat.onBeforeCompile = function (shader) {
            applyHeightFog(shader);
            if (isGlass) { applyGlassPatch(shader, GLASS_TYPES[kk]); return; }
            if (sway) applyWindSway(shader);
            applyCloudShadow(shader);
            if (isInterior) applyInteriorPatch(shader, mausHolder.cfg); // interior sin luz propia: la indirecta se escala por el ángulo sólido de las aberturas (puerta + la ventana si la hay) sobre la cavidad real del panteón — va ANTES del rebote para quedar DESPUÉS en el shader y escalar también su aporte (materials.js)
            applyBouncePatch(shader); // rebote del suelo GHI·ρ·(1−cos β)/2: las caras verticales reciben la luz que el piso les devuelve (materials.js)
            applyBacklightPatch(shader); // contraluz (v65): borde luminoso de silueta contra la fuente activa, con su color e intensidad de este frame
            if (isStone) applyStoneSunPatch(shader); // sol directo SOLO sobre el cemento: reflectedLight.directDiffuse × uStoneSun (materials.js)
            if (isMarble) applyMarblePatch(shader); // dispersión interna del mármol: SOLO ablandado del terminador en banda angosta (v53: sin transmisión a través de la pared — la cara opuesta al sol solo recibe luz del cielo), con la fuente activa de la tubería única
            applyWetPatch(shader, WET_CFG[wk]);
          };
          mat.customProgramCacheKey = function () { return isGlass ? 'glass60_' + kk : 'hfogwet3_' + wk + '_bl' + (sway ? '_sw' : '') + (isStone ? '_ss' : '') + (isMarble ? '_mb' : '') + (isInterior ? '_int' + (mausHolder.cfg ? '_m' + (mausHolder.cfg.big ? 'B' : 'S') + (mausHolder.cfg.winKey ? '_w' + mausHolder.cfg.winKey + (mausHolder.cfg.winX > 0 ? 'p' : 'n') : '') : '') : ''); };
        })(mats[k], k);
      }
      var bucket = new Bucket();
      var farBucket = new Bucket(); // versión lejana low-poly (LOD): siluetas sin detalle
      var group = new THREE.Group();
      var groupNear = new THREE.Group(), groupFar = new THREE.Group();
      group.add(groupNear); group.add(groupFar);
      group.position.set(cx * CHUNK, 0, cz * CHUNK);
      var tombs = [];   // {x,z (mundo), plaqueIdx, col} para lectura y colisiones
      var colliders = [];
      var surfaces = []; // rectángulos pisables con material propio (piedra/grava): el sonido de pasos los lee

      // (v58: los senderos ya no son planos — los pinta el shader del
      // suelo, materials.js bloque SENDERO, como campo de distancia a
      // la retícula con el borde erosionado por ruido: pasto y tierra
      // se funden en una sola superficie, sin costura entre chunks ni
      // corte recto. El sonido de pasos no dependía de estos planos:
      // audio.js decide 'dirt' por geometría, distancia al eje.)

      var hasMaus = SETTINGS.mausoleum && (hash2(cx, cz) % 11 === 0);
      var hasAngel = (!hasMaus && hash2(cx + 55, cz - 31) % 13 === 0);
      var decoRng = mulberry32(hash2(cx * 733 + 3, cz * 389 + 17) ^ 0xdec0); // v72: rng SOLO de la decoración descargada (deco.js) — el rng del mundo no se toca, el cementerio de siempre queda idéntico
      /* Parcelas ORDENADAS: retícula regular de columnas y filas a los
         lados de los senderos (columnas a ±7,5 y ±12,5; filas a ±5,
         ±8,75 y ±12,5 — separaciones constantes de 5 y 3,75 m), con un
         jitter mínimo (±0,35 m) para que no se vea clonado pero las
         filas se lean alineadas, como en un cementerio real. */
      var xs = [-12.5, -7.5, 7.5, 12.5], zs = [-12.5, -8.75, -5, 5, 8.75, 12.5];
      var stoneMats = ['light', 'mid', 'moss', 'light', 'mid', 'dark'];
      for (var xi = 0; xi < xs.length; xi++) {
        for (var zi = 0; zi < zs.length; zi++) {
          var lx = xs[xi] + (rng() - 0.5) * 0.7, lz = zs[zi] + (rng() - 0.5) * 0.7;
          if (hasMaus && lx > 7 && lz > 7) continue;
          if (hasAngel && lx < -8 && lz < -8) continue;
          if (rng() > 0.76 * SETTINGS.density) continue; // densidad del menú debug (1 = la de siempre)
          var kindsAvail = [];
          for (var ki = 0; ki < 5; ki++) if (SETTINGS.kinds[ki]) kindsAvail.push(ki);
          if (!kindsAvail.length) continue; // ninguna forma habilitada
          var kind = kindsAvail[Math.floor(rng() * kindsAvail.length)];
          var mk = stoneMats[Math.floor(rng() * stoneMats.length)];
          // orientación: de cara al sendero más cercano
          var faceX = Math.abs(lx) < Math.abs(lz);
          var ry = faceX ? (lx > 0 ? -Math.PI / 2 : Math.PI / 2) : (lz > 0 ? Math.PI : 0);
          ry += (rng() - 0.5) * 0.035; // casi alineada a la fila: orden visual
          /* Delimitación terrenal: la parcela completa — lápida más la
             losa de la fosa, que se extiende 2,25 m hacia el frente —
             queda fuera de la franja de los senderos. Se muestrean tres
             puntos del eje de la parcela (base, medio y punta de la
             losa): si alguno entra a menos de 2,3 m del eje de un
             camino, la tumba no se coloca. Los caminos quedan libres
             siempre; las tumbas viven dentro de sus parcelas. */
          var fdx = Math.sin(ry), fdz = Math.cos(ry), plotClear = true;
          for (var sp = 0; sp <= 2; sp++) {
            var qx = lx + fdx * sp * 1.12, qz = lz + fdz * sp * 1.12;
            if (Math.abs(qx) < 2.3 || Math.abs(qz) < 2.3) { plotClear = false; break; }
          }
          if (!plotClear) continue;
          var sub = new Bucket();
          var plaqueIdx = Math.floor(rng() * PLAQUE_N);
          var info = buildTomb(sub, kind, mk, plaqueIdx, kind !== 4);
          // rotar y trasladar las piezas de la tumba a su sitio en el chunk
          var cos = Math.cos(ry), sin = Math.sin(ry);
          for (var bk in sub.map) {
            for (var gi = 0; gi < sub.map[bk].length; gi++) {
              var g = sub.map[bk][gi];
              g.rotateY(ry); g.translate(lx, -SEAT_SINK, lz); // asentada: la base corta el suelo (geometry.js, SEAT_SINK)
              bucket.add(bk, g);
            }
          }
          addFarTomb(farBucket, kind, mk, ry, lx, lz); // su silueta low-poly para el LOD lejano
          var wx = cx * CHUNK + lx, wz = cz * CHUNK + lz;
          /* Cara de la placa: en local mira a +Z (todas las formas); al
             rotar la tumba por ry, la normal mundial es (sin ry, cos ry)
             y el centro de la placa sale de su offset local. La lectura
             (reading.js) exige estar frente a esa cara: desde atrás de
             la lápida no se lee. */
          var pox = info.plaque ? (info.plaque.x * cos + info.plaque.z * sin) : 0;
          var poz = info.plaque ? (-info.plaque.x * sin + info.plaque.z * cos) : 0;
          tombs.push({ x: wx, z: wz, plaqueIdx: plaqueIdx, fx: sin, fz: cos, px: wx + pox, pz: wz + poz });
          if (kind !== 4) surfaces.push({ x: wx + Math.sin(ry) * 0.885, z: wz + Math.cos(ry) * 0.885, hw: 0.46, hd: 1.35, ry: ry, type: 'stone' }); // la losa de la fosa se pisa como piedra (v57: la losa corre bajo la base, centro 0,885 y semilargo 1,35 — geometry.js)
          if (info.col) {
            var c = info.col;
            colliders.push({ x: wx + (c.cz ? Math.sin(ry) * c.cz : 0), z: wz + (c.cz ? Math.cos(ry) * c.cz : 0), hw: c.hw, hd: c.hd, h: c.h, ry: ry });
          }
          /* DECORACIÓN DESCARGADA (v72, deco.js): una cruz o una
             lápida con cruz del kit de Kenney (CC0) junto a algunas
             lápidas de parcela (~16 %), al costado de la cabecera y
             con la misma orientación que la tumba, en el material de
             piedra claro del chunk y con su colisionador chico. */
          if (typeof DECO !== 'undefined' && DECO.ready && decoRng() < 0.16) {
            var dsrc = (decoRng() < 0.5 && DECO.cross) ? DECO.cross : DECO.grave;
            if (dsrc) {
              var dside = decoRng() < 0.5 ? -1 : 1;
              var dsc = 0.8 + decoRng() * 0.35;
              var dox = (0.55 * dside) * cos + (-0.1) * sin, doz = -(0.55 * dside) * sin + (-0.1) * cos; // offset local (costado, apenas detrás) rotado a mundo
              var dgeo = dsrc.clone();
              dgeo.scale(dsc, dsc, dsc);
              dgeo.rotateY(ry + (decoRng() - 0.5) * 0.06);
              dgeo.translate(lx + dox, -SEAT_SINK, lz + doz);
              bucket.add('light', dgeo);
              colliders.push({ x: wx + dox, z: wz + doz, hw: 0.16, hd: 0.16, h: 1.0, ry: ry });
            }
          }
        }
      }
      // césped en mechones: cantidad regulable (SETTINGS.grass; 0,3 por
      // defecto = poco denso), fuera de los senderos y de las tumbas
      var nTufts = Math.floor(120 * SETTINGS.grass * (0.7 + rng() * 0.6));
      for (var gt = 0; gt < nTufts; gt++) {
        var gx = (rng() - 0.5) * 28, gz = (rng() - 0.5) * 28;
        if (Math.abs(gx) < 2.3 || Math.abs(gz) < 2.3) continue; // senderos limpios
        var tuft = makeGrassTuft(rng);
        var gs = 0.8 + rng() * 0.7;
        tuft.scale(gs, gs * (0.85 + rng() * 0.4), gs);
        tuft.rotateY(rng() * Math.PI * 2);
        tuft.translate(gx, -SEAT_SINK, gz); // enraizado, no apoyado sobre el plano
        bucket.add(rng() > 0.45 ? 'grass' : 'foliage2', tuft);
      }
      // árboles: cantidad regulable con SETTINGS.trees. El ciprés vivo
      // es el MODELO REAL (trees.js) cuando ya cargó: cerca entra su
      // LOD0 si el chunk nace junto al jugador y LOD1 en el resto del
      // anillo cercano; la versión lejana del chunk lleva su LOD2.
      // El árbol seco sigue procedural (silueta desnuda a mano).
      var nTrees = Math.round(rng() * 3.2 * SETTINGS.trees);
      for (var t = 0; t < nTrees; t++) {
        var tx = (rng() - 0.5) * 26, tz = (rng() - 0.5) * 26;
        if (Math.abs(tx) < 3 || Math.abs(tz) < 3) continue;
        var deadT = rng() > 0.72;
        var tc;
        if (!deadT && typeof CYPRESS !== 'undefined' && CYPRESS.ready) {
          var pdx = cx * CHUNK + tx - playerBody.position.x, pdz = cz * CHUNK + tz - playerBody.position.z;
          var lodN = (pdx * pdx + pdz * pdz) < 45 * 45 ? 0 : 1;
          var tRot = rng() * Math.PI * 2, tS = 0.8 + rng() * 0.35;
          bucket.add('wood', xform(CYPRESS.bark[lodN], tx, -SEAT_SINK, tz, tRot, 0, 0, tS, tS, tS));
          bucket.add('cypress', xform(CYPRESS.leaves[lodN], tx, -SEAT_SINK, tz, tRot, 0, 0, tS, tS, tS));
          farBucket.add('wood', xform(CYPRESS.bark[2], tx, -SEAT_SINK, tz, tRot, 0, 0, tS, tS, tS));
          farBucket.add('cypress', xform(CYPRESS.leaves[2], tx, -SEAT_SINK, tz, tRot, 0, 0, tS, tS, tS));
          tc = { hw: 0.3, hd: 0.3, h: 1.2 };
        } else {
          var sub2 = new Bucket();
          tc = buildTree(sub2, rng, deadT);
          for (var bk2 in sub2.map) for (var gj = 0; gj < sub2.map[bk2].length; gj++) { var g2 = sub2.map[bk2][gj]; g2.translate(tx, -SEAT_SINK, tz); bucket.add(bk2, g2); }
          addFarTree(farBucket, deadT, tx, tz);
        }
        colliders.push({ x: cx * CHUNK + tx, z: cz * CHUNK + tz, hw: tc.hw, hd: tc.hd, h: tc.h, ry: 0 });
      }
      // cerca de hierro ocasional
      if (rng() > 0.62) {
        var fx = -13 + rng() * 20;
        buildFence(bucket, fx, -13.5, fx + 6.5, -13.5);
      }
      // panteón accesible y ángel
      if (hasMaus) {
        var subM = new Bucket();
        /* FAMILIA DEL PANTEÓN (v70, plaques.js): árbol genealógico
           virtual con su propio rng (semilla del chunk — no toca el
           flujo del rng de construcción: la familia es la misma en
           cada visita y el resto del chunk no cambia). Su atlas se
           dibuja una vez y queda como textura del material
           plaqueFam DE ESTE chunk; buildMausoleum coloca a los
           miembros en la placa principal y los nichos. */
        var famRng = mulberry32(hash2(cx * 389 + 11, cz * 587 + 23) ^ 0x51ab);
        var family = buildFamily(famRng);
        famTex = new THREE.CanvasTexture(buildFamilyAtlas(family, famRng));
        famTex.colorSpace = THREE.SRGBColorSpace;
        famTex.anisotropy = 4;
        mats.plaqueFam.map = famTex;
        mats.plaqueFam.needsUpdate = true;
        var minfo = buildMausoleum(subM, rng, Math.floor(rng() * PLAQUE_N), family);
        // tamaño y ventana ÚNICA sorteados del panteón (v60/v64): la
        // cfg alimenta la ley de luz interior de los materiales de
        // este chunk. El giro de π invierte x y z locales, así que en
        // coords del chunk (las que usan el shader, el haz y la
        // lectura) el centro de la ventana es −zc y su pared cae al
        // lado contrario del local: winX = −side·(W/2 − T/2).
        var mHalfW = minfo.maus.W / 2, mHalfD = minfo.maus.D / 2;
        chunkMaus = { halfW: mHalfW, halfD: mHalfD, H: minfo.maus.H, big: minfo.maus.big };
        mausHolder.cfg = { halfW: mHalfW, halfD: mHalfD, H: minfo.maus.H, big: minfo.maus.big, winKey: null, winAT: 0, winX: 0, winZ: 0, doorU: { value: 0 }, beamU: { value: new THREE.Color(0, 0, 0) } }; // doorU (v65): la abertura de la puerta para la ley de luz interior — nace en 0 (puerta cerrada o sellada) y sube con el giro de la hoja · beamU (v70): el rebote del haz de la ventana que luminisce la sala, lo escribe updateWindowBeam por frame
        if (minfo.win) {
          var winXc = -minfo.win.side * (mHalfW - 0.14);
          mausHolder.cfg.winKey = minfo.win.key;
          mausHolder.cfg.winAT = minfo.win.area * minfo.win.trans;
          mausHolder.cfg.winX = winXc;
          mausHolder.cfg.winZ = -minfo.win.zc;
          chunkWin = { key: minfo.win.key, area: minfo.win.area, trans: minfo.win.trans, zc: -minfo.win.zc, x: winXc };
        }
        var mry = Math.PI; // la entrada queda mirando hacia el sendero horizontal
        for (var bk3 in subM.map) for (var gk = 0; gk < subM.map[bk3].length; gk++) { var g3 = subM.map[bk3][gk]; g3.rotateY(mry); g3.translate(11, -SEAT_SINK, 11); bucket.add(bk3, g3); } // asentado: suelo, paredes y columnas cortan el terreno
        /* ÁNGEL SOBRE EL TECHO (v72, deco.js): el ángel de catedral
           de Polyfork (CC BY 4.0) corona ~42 % de los panteones,
           apoyado sobre la losa del techo (H + 0,30) hacia el frente
           y mirando a la puerta: se coloca en el local del panteón y
           pasa por el mismo giro de π + traslado que el resto del
           casco, en el material de piedra del propio panteón. */
        if (typeof DECO !== 'undefined' && DECO.ready && DECO.angel && decoRng() < 0.42) {
          var asc = 0.95 + decoRng() * 0.25;
          var ageo = DECO.angel.clone();
          ageo.scale(asc, asc, asc);
          ageo.translate(0, minfo.maus.H + 0.30, minfo.maus.D / 2 - 0.6);
          ageo.rotateY(mry); ageo.translate(11, -SEAT_SINK, 11);
          bucket.add(minfo.maus.mk, ageo);
        }
        // silueta lejana del panteón: caja con techo y frontón a la planta de ESTE tamaño, sin interior ni nichos — con SU material (mármol o cemento, v65)
        farInto(farBucket, minfo.maus.mk, [xform(GEO.box, 0, (minfo.maus.H + 0.3) / 2, 0, 0, 0, 0, minfo.maus.W + 0.6, minfo.maus.H + 0.3, minfo.maus.D + 0.6), xform(GEO.box, 0, minfo.maus.H + 0.62, minfo.maus.D / 2 - 0.05, 0, 0, 0, minfo.maus.W - 0.2, 0.65, 0.4)], mry, 11, 11);
        /* PUERTA ABRIBLE (v65): la hoja va en un PIVOTE en la bisagra
           (borde local x = −0,575 del vano), hijo de groupNear para
           seguir el fundido y el LOD del chunk. En el espacio del
           pivote (el local del panteón, con su giro de π aplicado en
           el propio pivote) la hoja es la caja de siempre desplazada
           +0,575 desde la bisagra; abrir = girar el pivote +1,9 rad
           (la hoja entra al interior, como la puerta fija de antes).
           El registro chunkDoor lo leen la interacción (reading.js),
           el tick de animación y la ley de luz (doorU/doorF). */
        if (minfo.door && !minfo.door.sealed) {
          var piv = new THREE.Group();
          piv.position.set(11 - (-0.575), -SEAT_SINK, 11 - (mHalfD - 0.14));
          piv.rotation.y = Math.PI;
          var leaf = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.32, 0.06), mats[minfo.door.tex]);
          leaf.position.set(0.575, 1.16, 0);
          leaf.castShadow = true; leaf.receiveShadow = true;
          piv.add(leaf);
          var knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mats.iron);
          knob.position.set(1.0, 1.15, 0.08);
          piv.add(knob);
          groupNear.add(piv);
          chunkDoor = { pivot: piv, angle: 0, state: 'closed', sealed: false, cfg: mausHolder.cfg, chunk: null, x: cx * CHUNK + 11, z: cz * CHUNK + 11 - (mHalfD - 0.14) };
          /* PUERTA QUE NACE ABIERTA (v70, pedido de Guille: «que
             algunas tumbas puedan tener por defecto la puerta
             abierta»): ~25 % de las abribles nacen ya abiertas de
             par en par — la hoja girada a 1,9 rad, estado 'open'
             (refreshColliders nunca bloquea su vano y la
             interacción no la ofrece como objetivo), doorU y doorF
             a 1 desde el primer frame: la luz entra por la puerta
             como si alguien la hubiera dejado así. */
          if (rng() < 0.25) {
            chunkDoor.angle = 1.9; chunkDoor.state = 'open';
            piv.rotation.y = Math.PI + 1.9;
            mausHolder.cfg.doorU.value = 1;
            mausDoorF0 = 1;
          }
        }
        if (minfo.door && minfo.door.sealed) {
          /* v72 (pedido de Guille 20:42): la puerta SELLADA también
             se registra — sin pivote ni hoja (la tapa es parte del
             casco) — para que el botón ABRIR aparezca también frente
             a ella y el intento suene a bloqueada. state 'closed' a
             propósito: refreshColliders mantiene su vano bloqueado
             para siempre (solo salta los registros que ya no están
             'closed') y tickDoors nunca la anima; el campo sealed es
             lo que openDoor/reading.js leen para derivar el intento
             a playDoorBlocked sin abrir nada. */
          chunkDoor = { pivot: null, angle: 0, state: 'closed', sealed: true, cfg: mausHolder.cfg, chunk: null, x: cx * CHUNK + 11, z: cz * CHUNK + 11 - (mHalfD - 0.14) };
        }
        // con giro de π: el punto local (x,z) cae en (11−x, 11−z) del chunk
        for (var ci = 0; ci < minfo.colliders.length; ci++) {
          var lc = minfo.colliders[ci];
          var cc65 = { x: cx * CHUNK + 11 - lc.x, z: cz * CHUNK + 11 - lc.z, hw: lc.hw, hd: lc.hd, h: lc.h, ry: mry };
          if (lc.door && chunkDoor) cc65.doorRec = chunkDoor; // el colisionador del vano pertenece a la puerta abrible: refreshColliders lo salta cuando ya no está cerrada
          colliders.push(cc65);
        }
        for (var ti = 0; ti < minfo.tombs.length; ti++) {
          var lt = minfo.tombs[ti];
          // con el giro de π la normal de cada placa también se invierte
          tombs.push({ x: cx * CHUNK + 11 - lt.lx, z: cz * CHUNK + 11 - lt.lz, plaqueIdx: lt.plaqueIdx, person: lt.person || null, fx: -(lt.nx || 0), fz: -(lt.nz || 0), px: cx * CHUNK + 11 - lt.lx, pz: cz * CHUNK + 11 - lt.lz }); // person (v70): el miembro de la familia de esa placa, si la placa es familiar
        }
        // superficies del panteón (a su planta real, v64): suelo y escalón de piedra, explanada de grava ante la puerta (al sur, tras el giro de π: el escalón local a z D/2+0,55 cae a 11−(D/2+0,55) del chunk)
        surfaces.push({ x: cx * CHUNK + 11, z: cz * CHUNK + 11, hw: mHalfW + 0.3, hd: mHalfD + 0.5, ry: 0, type: 'stone' });
        surfaces.push({ x: cx * CHUNK + 11, z: cz * CHUNK + 11 - (mHalfD + 0.55), hw: 0.95, hd: 0.45, ry: 0, type: 'stone' });
        surfaces.push({ x: cx * CHUNK + 11, z: cz * CHUNK + 11 - (mHalfD + 0.55) - 1.9, hw: 1.7, hd: 1.15, ry: 0, type: 'gravel' });
      }
      if (hasAngel) {
        var subA = new Bucket();
        var ac = buildAngel(subA, rng);
        for (var bk4 in subA.map) for (var gl = 0; gl < subA.map[bk4].length; gl++) { var g4 = subA.map[bk4][gl]; g4.rotateY(0.6); g4.translate(-11.5, -SEAT_SINK, -11.5); bucket.add(bk4, g4); }
        farBucket.add('light', xform(GEO.box, -11.5, 1.2 - SEAT_SINK, -11.5, 0.6, 0, 0, 0.95, 2.4, 0.95)); // silueta lejana del ángel
        colliders.push({ x: cx * CHUNK - 11.5, z: cz * CHUNK - 11.5, hw: ac.hw, hd: ac.hd, h: ac.h, ry: 0 });
        surfaces.push({ x: cx * CHUNK - 11.5, z: cz * CHUNK - 11.5, hw: 0.6, hd: 0.6, ry: 0, type: 'stone' }); // pedestal del ángel
      }

      var nearMeshes = bucket.build(mats, groupNear, true);
      // el cristal NO proyecta sombra (v60): el sol entra al interior
      // por el hueco de la ventana vía mapa de sombras, como a través
      // de un vidrio real; si el paño sombreara como pared, la ventana
      // sería una abertura falsa
      for (var gk62 = 0; gk62 < GLASS_KEYS.length; gk62++) { var gm62 = nearMeshes[GLASS_KEYS[gk62]]; if (gm62) { gm62.castShadow = false; gm62.receiveShadow = false; } }
      // cáscara de contraluz (v69): la línea de luz en la arista viva
      // contra la fuente — una malla aditiva por chunk sobre el LOD
      // cercano, con el fundido del chunk en su propio uniform
      var hullMat = null;
      var hullGeo = buildRimHullGeometry(bucket);
      if (hullGeo) {
        hullMat = makeRimHullMaterial();
        hullMat.uniforms.uFade.value = instant ? 1 : 0;
        var hullMesh = new THREE.Mesh(hullGeo, hullMat);
        hullMesh.castShadow = false; hullMesh.receiveShadow = false;
        hullMesh.renderOrder = 4; // tras las mallas del chunk (orden 0) y antes de lluvia (5) y haces (9–11): el depth ya está completo y la línea queda bajo la atmósfera
        groupNear.add(hullMesh);
      }
      bucket.build(mats, groupFar, false); // la versión lejana no proyecta sombra: fuera del anillo cercano no aporta nada al mapa
      scene.add(group);
      // LOD inicial según la distancia al jugador al nacer el chunk
      var bdx = cx * CHUNK + CHUNK / 2 - playerBody.position.x, bdz = cz * CHUNK + CHUNK / 2 - playerBody.position.z;
      var startFar = (bdx * bdx + bdz * bdz) > 105 * 105;
      groupNear.visible = !startFar; groupFar.visible = startFar;
      var chunk = { cx: cx, cz: cz, group: group, groupNear: groupNear, groupFar: groupFar, nearMeshes: nearMeshes, hullMat: hullMat, lodFar: startFar, mats: mats, tombs: tombs, colliders: colliders, surfaces: surfaces, bodies: null, fade: instant ? 1 : 0, dir: 1, dead: false, fast: Date.now() < fastFadeUntil, settingsVer: settingsVer, win: chunkWin, maus: chunkMaus, mausCfg: mausHolder.cfg, famTex: famTex, door: chunkDoor, doorF: hasMaus ? mausDoorF0 : 1 }; // doorF (v65): sin panteón no hay puerta que cierre la abertura (1); con panteón nace en 0 (cerrada o sellada) y sube con el giro
      chunks[keyOf(cx, cz)] = chunk;
      if (chunkDoor) chunkDoor.chunk = chunk;
      if (instant) { for (var mk9 in mats) { mats[mk9].opacity = 1; mats[mk9].transparent = !!GLASS_TYPES[mk9]; } } // el cristal queda transparente: su alfa lo pone su shader (v60)
      else fading.push(chunk);
      return chunk;
    }

    function disposeChunk(chunk) {
      scene.remove(chunk.group);
      chunk.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      for (var k in chunk.mats) chunk.mats[k].dispose();
      if (chunk.hullMat) { chunk.hullMat.dispose(); chunk.hullMat = null; } // la geometría de la cáscara la libera el traverse de arriba (vive en groupNear)
      if (chunk.famTex) { chunk.famTex.dispose(); chunk.famTex = null; } // la textura del atlas familiar es de este chunk (el material la libera disposeChunk vía mats)
      if (chunk.bodies) removeChunkBodies(chunk);
      delete chunks[keyOf(chunk.cx, chunk.cz)];
    }

    // Descarga suave: el chunk sale de la matriz activa y queda en el pool.
    function stashChunk(chunk) {
      if (chunk.bodies) removeChunkBodies(chunk);
      chunk.group.visible = false;
      chunk.fade = 1; chunk.dir = 1;
      for (var k in chunk.mats) { chunk.mats[k].opacity = 1; chunk.mats[k].transparent = !!GLASS_TYPES[k]; }
      if (chunk.hullMat) chunk.hullMat.uniforms.uFade.value = 1; // el pool guarda el chunk a fundido completo: la cáscara vuelve con él
      delete chunks[keyOf(chunk.cx, chunk.cz)];
      chunkCache.push(chunk);
      while (chunkCache.length > 10) disposeChunk(chunkCache.shift()); // el más viejo se libera de verdad
    }
    // Reutiliza un chunk del pool si coincide la celda y la versión de ajustes.
    function restoreChunk(key) {
      for (var i = 0; i < chunkCache.length; i++) {
        var c = chunkCache[i];
        if (keyOf(c.cx, c.cz) === key && c.settingsVer === settingsVer) {
          chunkCache.splice(i, 1);
          c.group.visible = true;
          chunks[key] = c;
          colliderChunkKey = ''; // fuerza el rearmado de colisionadores
          return true;
        }
      }
      return false;
    }
    function clearChunkCache() {
      while (chunkCache.length) { var c = chunkCache.pop(); c.group.visible = true; disposeChunk(c); }
    }

    /* Matriz virtual de chunks centrada en el jugador: solo se reevalúa
       cuando el jugador cambia de celda; por frame solo avanza la cola de
       construcción (máx. 2) y los fundidos. */
    var lastCellX = 1e9, lastCellZ = 1e9;
    /* Aire claro (niebla en 0): sin niebla no hay velo que esconda la
       generación, así que la ocultación pasa a ser pura distancia — los
       chunks nacen en el anillo 7 (≥ 180 m, donde una tumba subtiende
       menos de 0,7°) y se retiran en el 8, apareciendo de golpe, sin
       fundido. Con niebla > 0 vuelven los anillos cortos tras el velo. */
    var clearAir = false;
    function applyClearAir(on) {
      if (on === clearAir) return;
      clearAir = on;
      LOAD_R = on ? 7 : 4;
      DROP_R = on ? 8 : 5;
      lastCellX = 1e9; // reevaluar la matriz con los anillos nuevos
    }
    function updateChunks(px, pz, dt) {
      var pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
      var cellChanged = (pcx !== lastCellX || pcz !== lastCellZ);
      if (cellChanged) { lastCellX = pcx; lastCellZ = pcz; }
      // encolar faltantes (cerca primero), solo al cambiar de celda
      var missing = [];
      if (cellChanged) {
      for (var dx = -LOAD_R; dx <= LOAD_R; dx++) for (var dz = -LOAD_R; dz <= LOAD_R; dz++) {
        var cx = pcx + dx, cz = pcz + dz, key = keyOf(cx, cz);
        if (!chunks[key] && buildQueue.indexOf(key) === -1) missing.push({ key: key, cx: cx, cz: cz, d: dx * dx + dz * dz });
      }
      missing.sort(function (a, b) { return a.d - b.d; });
      for (var i = 0; i < missing.length; i++) buildQueue.push(missing[i].key);
      }
      // construir como mucho 2 por frame: sin tirones; antes, intentar el pool
      var n = 0;
      while (buildQueue.length && n < 2) {
        var key2 = buildQueue.shift();
        if (chunks[key2]) continue;
        if (restoreChunk(key2)) { n++; continue; }
        var parts = key2.split(',');
        buildChunk(parseInt(parts[0], 10), parseInt(parts[1], 10), clearAir); // en aire claro: instantáneo, sin fundido
        n++;
      }
      // marcar salidas: solo más allá del anillo 5 (niebla total), al cambiar de celda
      if (cellChanged) for (var k2 in chunks) {
        var ch = chunks[k2];
        var ddx = ch.cx - pcx, ddz = ch.cz - pcz;
        if (Math.max(Math.abs(ddx), Math.abs(ddz)) > DROP_R && ch.dir !== -1) { ch.dir = -1; if (fading.indexOf(ch) === -1) fading.push(ch); }
        else if (Math.max(Math.abs(ddx), Math.abs(ddz)) <= DROP_R && ch.dir === -1 && ch.fade > 0) { ch.dir = 1; }
      }
      // fundidos
      for (var f = fading.length - 1; f >= 0; f--) {
        var c2 = fading[f];
        c2.fade += c2.dir * dt / (c2.fast ? 0.45 : 1.4);
        if (c2.dir > 0 && c2.fade >= 1) {
          c2.fade = 1; fading.splice(f, 1);
          for (var mk2 in c2.mats) { c2.mats[mk2].opacity = 1; c2.mats[mk2].transparent = !!GLASS_TYPES[mk2]; } // el cristal no se vuelve opaco al cerrar el fundido (v60)
          if (c2.hullMat) c2.hullMat.uniforms.uFade.value = 1;
          continue;
        }
        if (c2.dir < 0 && c2.fade <= 0) { fading.splice(f, 1); stashChunk(c2); continue; }
        var op = clamp(c2.fade, 0, 1);
        for (var mk3 in c2.mats) { c2.mats[mk3].transparent = true; c2.mats[mk3].opacity = op; }
        if (c2.hullMat) c2.hullMat.uniforms.uFade.value = op; // la cáscara entra y sale con el chunk
      }
      /* LOD por distancia (a pedido: renderizar solo lo que el jugador
         ve, con versiones low-poly/low-res fuera del anillo cercano).
         Cada chunk muestra su versión COMPLETA o su versión LEJANA
         (siluetas de 2–3 cajas por tumba, ciprés LOD2, sin placas ni
         cercas ni mechones) según la distancia de su centro al
         jugador, con histéresis (entra a 115 m, vuelve a 100 m) para
         no parpadear en el borde. Las placas — el detalle más fino —
         solo se dibujan a menos de 65 m aunque el chunk sea cercano.
         El frustum culling de three hace el resto por malla: lo que
         queda fuera del encuadre no se dibuja. */
      for (var lk in chunks) {
        var lc2 = chunks[lk];
        if (!lc2.groupNear) continue;
        var ldx = lc2.cx * CHUNK + CHUNK / 2 - px, ldz = lc2.cz * CHUNK + CHUNK / 2 - pz;
        var ld2 = ldx * ldx + ldz * ldz;
        if (!lc2.lodFar && ld2 > 115 * 115) { lc2.lodFar = true; lc2.groupNear.visible = false; lc2.groupFar.visible = true; }
        else if (lc2.lodFar && ld2 < 100 * 100) { lc2.lodFar = false; lc2.groupNear.visible = true; lc2.groupFar.visible = false; }
        var pm = lc2.nearMeshes && lc2.nearMeshes.plaque;
        if (pm) { var pv = ld2 < 65 * 65; if (pm.visible !== pv) pm.visible = pv; }
      }
    }

    /* ================= Físicas (cannon.js) ================= */
    var world = new CANNON.World();
    world.gravity.set(0, -9.82, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = false;
    var physGround = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    physGround.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(physGround);

    var playerBody = new CANNON.Body({
      mass: 80, shape: new CANNON.Sphere(0.35),
      position: new CANNON.Vec3(0, 0.36, 6), linearDamping: 0.02
    });
    playerBody.fixedRotation = true;
    playerBody.updateMassProperties();
    world.addBody(playerBody);

    var colliderChunkKey = '';
    function removeChunkBodies(chunk) {
      if (!chunk.bodies) return;
      for (var i = 0; i < chunk.bodies.length; i++) world.removeBody(chunk.bodies[i]);
      chunk.bodies = null;
    }
    function refreshColliders() {
      var pcx = Math.floor(playerBody.position.x / CHUNK), pcz = Math.floor(playerBody.position.z / CHUNK);
      var key = pcx + ',' + pcz;
      if (key === colliderChunkKey) return;
      colliderChunkKey = key;
      for (var k in chunks) if (chunks[k].bodies) removeChunkBodies(chunks[k]);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = chunks[keyOf(pcx + dx, pcz + dz)];
        if (!ch || ch.bodies) continue;
        ch.bodies = [];
        for (var i = 0; i < ch.colliders.length; i++) {
          var c = ch.colliders[i];
          if (c.doorRec && c.doorRec.state !== 'closed') continue; // puerta ya abierta (v65): el vano no bloquea
          var b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(c.hw, c.h / 2, c.hd)) });
          b.position.set(c.x, c.h / 2, c.z);
          if (c.ry) b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), c.ry);
          world.addBody(b);
          ch.bodies.push(b);
        }
      }
    }

    /* ============ PUERTAS ABRIBLES (v65) ============
       openDoor la llama la interacción (reading.js) cuando el jugador
       acciona sobre una puerta abrible cerrada: la hoja pasa a
       'opening', su colisionador se retira (forzar el rearmado de
       refreshColliders basta: el armado salta los vanos cuya puerta
       ya no está 'closed') y tickDoors (main.js, por frame) gira el
       pivote hasta 1,9 rad. La abertura de la ley de luz interior
       sigue al giro: doorU (shader) y doorF (CPU, scene.js) valen
       ángulo/1,9 — a mitad de apertura entra la mitad del ángulo
       sólido de la puerta. Los panteones SELLADOS tienen registro
       desde la v72 (sin pivote, sealed: true): openDoor los deriva
       al sonido de bloqueada y no abre nada; su colisionador sigue
       permanente porque su estado nunca sale de 'closed'. */
    function openDoor(rec) {
      if (!rec) return;
      if (rec.sealed) { // v72: intento sobre puerta sellada — suena a bloqueada y no se mueve
        rec.triedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (typeof playDoorBlocked === 'function') playDoorBlocked();
        return;
      }
      if (rec.state !== 'closed') return;
      rec.state = 'opening';
      if (typeof playDoorOpen === 'function') playDoorOpen(); // v72: el crujido de la hoja al empezar a girar (audio.js)
      colliderChunkKey = ''; // fuerza el rearmado: el vano deja de bloquear en el próximo refreshColliders
    }
    function tickDoors(dt) {
      for (var k in chunks) {
        var rec = chunks[k].door;
        if (!rec || rec.state !== 'opening') continue;
        rec.angle = Math.min(1.9, rec.angle + dt * 2.1);
        rec.pivot.rotation.y = Math.PI + rec.angle;
        var f = rec.angle / 1.9;
        if (rec.cfg && rec.cfg.doorU) rec.cfg.doorU.value = f;
        if (rec.chunk) rec.chunk.doorF = f;
        if (rec.angle >= 1.9) rec.state = 'open';
      }
    }

    /* ============ HAZ DE LUZ DE LA VENTANA: PRISMA + PARCHE + POLVO (v63) ============
       Pedido de Guille (2026-11-22 14:43, foto de referencia
       1000273404): «las motas de polvo deben ser un shader, un haz
       de luz que entra por la ventana y choca contra la superficie».
       Investigación aplicada (research_notes/haz-de-luz-ventana-
       polvo-20261122-2043): lo que se ve en la foto es dispersión
       de Mie del polvo en suspensión (partículas grandes: blanco/
       dorado, pico hacia adelante — NO Tyndall, que es el régimen
       de partículas de 40–900 nm y tiñe azul). Como los rayos del
       sol son paralelos (disco de 0,53°), el haz es un PRISMA
       extruido desde el rectángulo de la ventana, no un cono; solo
       se ensancha por la penumbra: Δ = L·tan(0,53°) ≈ 0,0093·L
       (≈2 cm a 2 m). Sin caída 1/r²: la única pérdida a lo largo
       del haz es Beer–Lambert con σt ≈ 0,01–0,05 /m (despreciable
       en 3 m). Nada de raymarching a pantalla completa ni blur
       radial (caros en la Mali e incorrectos con la fuente fuera
       de pantalla): la pila ganadora del informe son 3–4 draws,
       <30 triángulos + 320 puntos, sin render target ni mapa de
       sombras extra, todo GLSL ES 1.00 (WebGL1 y el camino WebGL2
       de r128). Los shaders son síntesis original desde las
       fórmulas (HG, Beer–Lambert, Fresnel/Schlick): los de
       Shadertoy son CC BY-NC-SA por defecto y NO se copian.
       LAS TRES CAPAS comparten UN bloque de uniforms (beamUni:
       dirección de viaje, color y uLightI), así que haz, parche y
       polvo nunca pueden discrepar:
       1. PRISMA (aire): las 4 esquinas reales de la ventana
          (0,84 × 1,06, geometry.js) extruidas a lo largo de
          −lightDir hasta la primera superficie de la cavidad
          (suelo, pared opuesta o tapa del sarcófago, por test de
          rayo contra la planta real): 4 quads laterales, 12 tris,
          DoubleSide, aditivo, depthTest SÍ (las paredes lo
          ocluyen: un prisma sin depthTest se fuga a través de la
          pared, el bug clásico). Adentro: un segundo prisma al
          55 % hace de núcleo brillante (×1,45). El fragment aplica
          perfil de borde de meseta (smoothstep 0,15 potenciado),
          fase tipo Henyey–Greenstein barata (0,35 + 1,65·μ⁴,
          μ = mirar hacia la fuente: el polvo brilla mirando al
          sol, como en la foto), factor de vista sen θ (de frente
          al haz, las caras laterales se apagan: se mira A TRAVÉS
          del volumen), fundido de extremo en los últimos ~0,35 m
          y neblina de 2 octavas de ruido de VALOR en textura
          tileable 128×128 generada localmente (sin fetch, sin
          snoise por píxel: 2 fetches en vez de ~60 ALU),
          advectada a lo largo del haz — densidad 0,66 + 0,34·n,
          nunca cero (si el ruido apagara el haz, parpadearía).
       2. PARCHE DE LUZ (superficie): el cuadrilátero de las
          esquinas proyectadas sobre el receptor — nace de las
          MISMAS esquinas que el extremo del prisma, así que haz
          y parche se encuentran sin hueco ni solape. Su borde es
          la penumbra física (0,0093·L + suciedad del vidrio,
          clamp 3–6 cm). OJO: el suelo ya recibe el parche «de
          verdad» por el mapa de sombras (el cristal no proyecta
          sombra y el parteluz de hierro sí); este quad es un
          realce de impacto de ganancia baja (0,30) que le da al
          parche los filos nítidos del parteluz que el téxel de
          4,1 cm del mapa difumina, no una segunda luz.
       3. POLVO (puntos GPU): 320 motas SOLO dentro del prisma,
          animadas en el vértice (cero trabajo de CPU por frame):
          deriva browniana ~5 cm, caída despreciable (las motas
          visibles de >50 µm son pocas por m³ y las corrientes
          las sostienen; una caída de Stokes plena vaciaría el
          haz en segundos), destello lento por mota (potencia 16:
          brilla 1–2 s cada 4–12 s, al girar y atrapar la luz),
          brillo = uLightI × fase HG × destello, tamaño 1–8 px
          con atenuación por perspectiva (las cercanas, más
          grandes y tenues: desenfocadas) y fundido en los
          últimos 10 cm sobre el receptor (junto al parche
          brillante una mota pierde contraste: no debe «rebotar»
          visualmente al llegar).
       LA LEY DE BRILLO (una sola, la del informe): uLightI =
       E_frame × τ(θi) — E_frame es la intensidad de la fuente
       activa de ESTE frame ya atenuada por nubes y camino de
       aire (sun.intensity/3, la escala del proyecto), y τ(θi)
       la transmitancia del cristal sorteado a la incidencia de
       este frame: la de incidencia normal del tipo (fino 0,92 ·
       grueso 0,80 · esmerilado 0,45) corregida por Fresnel
       Schlick F₀ 0,0426, τ ∝ (1−R)² normalizado — a 80° queda
       ~0,37 de la normal. El esmerilado además difunde: su haz
       definido vale ×0,30 y su máscara de parteluz se lava
       (uPaneAmt 0,25). Convención de exposición para la luna
       (el informe la exige explícita): sol 100 000 lux contra
       luna llena 0,25 lux son 400 000× físicos, invisibles a
       exposición fija; este juego ya compensa la noche en su
       tubería (la luna llena alumbra el terreno con 1,65 contra
       3,0 del sol), así que el haz lunar usa la misma E_frame
       con un factor de exhibición 0,30: parche y motas tenues,
       haz apenas insinuado — nunca un segundo sol.
       LA MÁSCARA DEL PARTELUZ vive en UNA función GLSL
       (paneMask sobre la UV verdadera de la ventana) que llaman
       el prisma y el parche: las barras oscuras del haz y las
       del parche son las mismas, como en la foto.
       LIMITACIÓN CONOCIDA (del informe, no se oculta): un mueble
       o una persona DENTRO del prisma no talla una muesca oscura
       en el haz — el prisma no se muestrea contra un mapa de
       sombras. El parche sí queda ocluido bien (lo da el mapa de
       sombras real sobre las superficies). Subir a mapa de
       sombras ortográfico propio sería otro coste; no se salta
       a él sin agotar esta versión.
       COSTE: un solo haz a la vez, el del panteón con ventana
       más cercano (≤ 14 m); la geometría se reconstruye solo
       cuando cambian el panteón, la ventana o la dirección de
       la fuente (umbral ~2,4°, la hora se mueve despacio). */
    var BEAM = { on: false, I: 0, glass: null, recv: '' };
    var beamBounceChunk = null; // v70: el chunk cuyo interior está recibiendo el rebote del haz (su cfg.beamU se apaga al cambiar de panteón o al morir el haz)
    function clearBeamBounce() {
      if (beamBounceChunk && beamBounceChunk.mausCfg && beamBounceChunk.mausCfg.beamU) beamBounceChunk.mausCfg.beamU.value.setRGB(0, 0, 0);
      beamBounceChunk = null;
    }
    var DUST_N = 320;
    /* Ruido de valor tileable 128×128 generado en JS (dos octavas
       de rejilla con envoltura: 8 y 16 ciclos por textura, ambos
       potencias de dos → la textura repite sin costura). Sustituye
       al snoise por píxel del informe: en la Mali, 2 fetches. */
    function makeBeamNoiseTex() {
      var S = 128, data = new Uint8Array(S * S * 4);
      function lat(ix, iy, per) {
        var x = ((ix % per) + per) % per, y = ((iy % per) + per) % per;
        return (hash2(x * 3 + per, y * 5 + per * 7) % 100000) / 100000;
      }
      function vnoise(u, v, per) {
        var x = u * per, y = v * per;
        var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        var a = lat(ix, iy, per), b = lat(ix + 1, iy, per), c = lat(ix, iy + 1, per), d = lat(ix + 1, iy + 1, per);
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      }
      for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
        var n = 0.62 * vnoise(x / S, y / S, 8) + 0.38 * vnoise(x / S, y / S, 16);
        var o = (y * S + x) * 4, val = Math.round(clamp(n, 0, 1) * 255);
        data[o] = val; data[o + 1] = val; data[o + 2] = val; data[o + 3] = 255;
      }
      var tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      return tex;
    }
    var beamNoiseTex = makeBeamNoiseTex();
    /* El bloque ÚNICO de uniforms del haz: los mismos objetos se
       comparten entre los materiales del prisma, el parche y el
       polvo — un solo uLightI para los tres consumidores. */
    var beamUni = {
      uTime: { value: 0 }, uLightI: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uSunTravel: { value: new THREE.Vector3(0, -1, 0) },
      uNoise: { value: beamNoiseTex }
    };
    var beamPaneU = { value: 1 }; // fuerza de la máscara del parteluz (el esmerilado la lava)
    var BEAM_PANE_GLSL = [
      'uniform float uPaneAmt;',
      'float paneMask(vec2 wuv) {',
      '  float bu = smoothstep(0.020, 0.034, abs(wuv.x - 0.5));',
      '  float bv = smoothstep(0.015, 0.028, abs(wuv.y - 0.5));',
      '  return mix(1.0, bu * bv, uPaneAmt);',
      '}'
    ].join('\n');
    var shaftBroken = false, poolBroken = false, dustShaderOk = true;
    var shaftMesh = null, coreMesh = null, poolMesh = null;
    var dustGeo = null, dustPts = null, dustPxU = { value: 600 };
    var beamKey = '';
    function makeShaftMaterial(gain, noiseScale) {
      var uniforms = {
        uTime: beamUni.uTime, uLightI: beamUni.uLightI, uColor: beamUni.uColor,
        uSunTravel: beamUni.uSunTravel, uNoise: beamUni.uNoise, uPaneAmt: beamPaneU,
        uGain: { value: gain }, uNoiseScale: { value: noiseScale }
      };
      return new THREE.ShaderMaterial({
        uniforms: uniforms, transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: [
          'attribute vec2 aFace; attribute vec2 aWinUV; attribute float aDist;',
          'varying vec2 vFace; varying vec2 vWinUV; varying vec3 vWp; varying float vDist;',
          'void main() {',
          '  vFace = aFace; vWinUV = aWinUV; vDist = aDist;',
          '  vec4 wp = modelMatrix * vec4(position, 1.0);',
          '  vWp = wp.xyz;',
          '  gl_Position = projectionMatrix * viewMatrix * wp;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor; uniform float uLightI; uniform vec3 uSunTravel;',
          'uniform float uTime; uniform sampler2D uNoise; uniform float uNoiseScale; uniform float uGain;',
          'varying vec2 vFace; varying vec2 vWinUV; varying vec3 vWp; varying float vDist;',
          BEAM_PANE_GLSL,
          'void main() {',
          '  vec3 V = normalize(vWp - cameraPosition);',
          '  float sinT = length(cross(V, uSunTravel));',
          '  float mu = clamp(-dot(V, uSunTravel), 0.0, 1.0);',
          '  float phase = 0.35 + 1.65 * pow(mu, 4.0);',
          '  float edge = smoothstep(0.0, 0.15, vFace.x) * smoothstep(1.0, 0.85, vFace.x);',
          '  edge = pow(edge, 1.5);',
          '  float t = clamp(vFace.y, 0.0, 1.0);',
          '  float len = pow(1.0 - t, 1.15) * smoothstep(1.0, 0.76, t) * smoothstep(0.0, 0.045, t);',
          '  vec2 q = vec2(vWinUV.x * 1.6 + vWinUV.y * 0.9, vDist * 0.55) + vec2(uTime * 0.013, -uTime * 0.006);',
          '  float n = texture2D(uNoise, q * uNoiseScale).r * 0.62 + texture2D(uNoise, q * uNoiseScale * 2.63 + 0.37).r * 0.38;',
          '  float density = 0.66 + 0.34 * n;',
          '  float a = uLightI * 0.34 * uGain * edge * len * pow(sinT, 0.6) * phase * density * paneMask(vWinUV);',
          '  a = clamp(a, 0.0, 0.8);',
          '  if (a < 0.003) discard;',
          '  gl_FragColor = vec4(uColor, a);',
          '}'
        ].join('\n')
      });
    }
    (function initBeam() {
      var shaftMat = makeShaftMaterial(1.0, 0.5);
      var coreMat = makeShaftMaterial(1.45, 0.78);
      shaftMesh = new THREE.Mesh(new THREE.BufferGeometry(), shaftMat);
      coreMesh = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
      shaftMesh.frustumCulled = false; coreMesh.frustumCulled = false;
      shaftMesh.visible = false; coreMesh.visible = false;
      shaftMesh.renderOrder = 10; coreMesh.renderOrder = 10;
      scene.add(shaftMesh); scene.add(coreMesh);
      watchShader(shaftMat, function () { shaftBroken = true; });
      watchShader(coreMat, function () { shaftBroken = true; });
      var poolMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: beamUni.uColor, uLightI: beamUni.uLightI, uPaneAmt: beamPaneU,
          uEdgeU: { value: 0.05 }, uEdgeV: { value: 0.05 }
        },
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        vertexShader: [
          'attribute vec2 aWinUV;',
          'varying vec2 vWinUV;',
          'void main() { vWinUV = aWinUV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor; uniform float uLightI; uniform float uEdgeU; uniform float uEdgeV;',
          'varying vec2 vWinUV;',
          BEAM_PANE_GLSL,
          'void main() {',
          '  float edge = smoothstep(0.0, uEdgeU, vWinUV.x) * smoothstep(1.0, 1.0 - uEdgeU, vWinUV.x)',
          '             * smoothstep(0.0, uEdgeV, vWinUV.y) * smoothstep(1.0, 1.0 - uEdgeV, vWinUV.y);',
          '  float a = clamp(uLightI * 0.30 * edge * paneMask(vWinUV), 0.0, 0.75);',
          '  if (a < 0.003) discard;',
          '  gl_FragColor = vec4(uColor, a);',
          '}'
        ].join('\n')
      });
      poolMesh = new THREE.Mesh(new THREE.BufferGeometry(), poolMat);
      poolMesh.frustumCulled = false;
      poolMesh.visible = false;
      poolMesh.renderOrder = 9;
      scene.add(poolMesh);
      watchShader(poolMat, function () { poolBroken = true; });
      // polvo: un solo Points, motas sembradas dentro del prisma
      dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
      dustGeo.setAttribute('aRem', new THREE.BufferAttribute(new Float32Array(DUST_N), 1));
      var seeds = new Float32Array(DUST_N * 4);
      var drng = mulberry32(4242);
      for (var i = 0; i < DUST_N * 4; i++) seeds[i] = drng();
      dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      var dustMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: beamUni.uTime, uLightI: beamUni.uLightI, uColor: beamUni.uColor,
          uSunTravel: beamUni.uSunTravel, uPxScale: dustPxU
        },
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
        vertexShader: [
          'attribute vec4 aSeed; attribute float aRem;',
          'uniform float uTime; uniform float uPxScale; uniform vec3 uSunTravel; uniform float uLightI;',
          'varying float vA;',
          'void main() {',
          '  vec3 p = position;',
          '  float ph = aSeed.x * 39.7;',
          // deriva browniana: tres senos lentos por eje, amplitud ~5 cm — la mota flota en el aire quieto del interior
          '  p.x += sin(uTime * 0.11 + ph) * 0.030 + sin(uTime * 0.043 + ph * 1.7) * 0.022;',
          '  p.y += sin(uTime * 0.07 + ph * 2.3) * 0.024 + sin(uTime * 0.031 + ph) * 0.016;',
          '  p.z += cos(uTime * 0.09 + ph * 1.3) * 0.030 + cos(uTime * 0.051 + ph * 2.9) * 0.022;',
          '  vec3 toP = p - cameraPosition;',
          '  float dist = max(length(toP), 0.001);',
          // fase Mie barata: la mota brilla mirando hacia la fuente (μ → 1), como en la foto
          '  float mu = clamp(-dot(toP / dist, uSunTravel), 0.0, 1.0);',
          '  float phase = 0.35 + 1.65 * pow(mu, 4.0);',
          // destello: al girar, la mota atrapa la luz 1–2 s cada 4–12 s (potencia 16: pulso breve, no parpadeo)
          '  float glint = pow(0.5 + 0.5 * sin(uTime * (0.55 + aSeed.w * 1.05) + ph * 3.1), 16.0);',
          // fundido junto al receptor: a <10 cm del parche la mota pierde contraste contra la luz que choca
          '  float endFade = smoothstep(0.0, 0.10, aRem);',
          '  float nearF = smoothstep(0.25, 1.1, dist);',
          '  vA = uLightI * phase * (0.30 + 0.70 * glint) * endFade * mix(0.35, 1.0, nearF);',
          '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
          // tamaño en píxeles con atenuación por perspectiva; las cercanas, más grandes y tenues (desenfocadas)
          '  gl_PointSize = clamp(uPxScale * (0.006 + aSeed.y * 0.009) * mix(2.4, 1.0, nearF) / max(-mv.z, 0.05), 1.0, 8.0);',
          '  gl_Position = projectionMatrix * mv;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uColor;',
          'varying float vA;',
          'void main() {',
          '  float d = length(gl_PointCoord - 0.5) * 2.0;',
          '  float a = smoothstep(1.0, 0.1, d);',
          '  a = clamp(a * a * vA * 0.45, 0.0, 0.9);',
          '  if (a < 0.004) discard;',
          '  gl_FragColor = vec4(uColor, a);',
          '}'
        ].join('\n')
      });
      dustPts = new THREE.Points(dustGeo, dustMat);
      dustPts.frustumCulled = false;
      dustPts.visible = false;
      dustPts.renderOrder = 11;
      scene.add(dustPts);
      // respaldo si el shader no compila en este WebGL: puntos
      // estándar con el mismo brillo por opacidad (sin haz: el
      // prisma y el parche comparten su destino vía shaftBroken)
      watchShader(dustMat, function () {
        dustShaderOk = false;
        dustPts.material = new THREE.PointsMaterial({ color: 0xfff2d8, size: 2.0, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      });
    })();
    /* Primera superficie que el rayo que sale de W en la dirección
       de viaje S encuentra DENTRO de la cavidad del panteón
       centrado en (mx, mz): suelo (cara superior a y = 0,03 en el
       mundo, la losa de 0,06 hundida SEAT_SINK), paredes interiores
       (a la planta real del panteón, cav = semiejes interiores
       W/2−T y D/2−T: 2,02 × 1,67 el clásico, 2,67 × 2,22 el grande)
       o el sarcófago (caja, la misma en los dos tamaños). La
       cavidad es convexa y el sarcófago una caja: el mínimo t
       positivo ES el impacto, sin pasos de marcha. */
    function rayReceiver(W, S, mx, mz, cav) {
      var hx = cav ? cav.hx : 2.02, hz = cav ? cav.hz : 1.67;
      var bestT = 8.5, recv = 'suelo', nx = 0, ny = 1, nz = 0, t;
      if (S.y < -1e-5) { t = (0.03 - W.y) / S.y; if (t > 0.01 && t < bestT) { bestT = t; recv = 'suelo'; nx = 0; ny = 1; nz = 0; } }
      if (S.x > 1e-5) { t = (mx + hx - W.x) / S.x; if (t > 0.01 && t < bestT) { bestT = t; recv = 'pared'; nx = -1; ny = 0; nz = 0; } }
      if (S.x < -1e-5) { t = (mx - hx - W.x) / S.x; if (t > 0.01 && t < bestT) { bestT = t; recv = 'pared'; nx = 1; ny = 0; nz = 0; } }
      if (S.z > 1e-5) { t = (mz + hz - W.z) / S.z; if (t > 0.01 && t < bestT) { bestT = t; recv = 'pared'; nx = 0; ny = 0; nz = -1; } }
      if (S.z < -1e-5) { t = (mz - hz - W.z) / S.z; if (t > 0.01 && t < bestT) {
        /* EL HUECO DE LA PUERTA (fix v65, reporte de Guille 18:53 con
           foto: «la luz parece impactar sobre una pared invisible que
           corresponde a la puerta»): la pared frontal NO es un plano
           entero — tiene el vano de la puerta (1,2 m de ancho, hasta
           2,27 m en el mundo). Si el impacto cae DENTRO del rectángulo
           del vano y la puerta está abierta (cav.doorF > 0,2: la hoja
           ya salió del plano), el rayo NO choca ahí: sigue hasta el
           suelo (el escalón de fuera comparte el plano y = 0,03) o el
           tope del test. Con la puerta cerrada o el panteón sellado
           (doorF = 0) el plano sí recibe — la hoja ES sólida y el
           parche cae sobre ella, como debe ser. Antes el test trataba
           la frontal como pared plena siempre: el prisma terminaba en
           el aire del vano y el parche flotaba sobre la «pared
           invisible» de la foto. */
        var dHx = W.x + S.x * t, dHy = W.y + S.y * t;
        var throughDoor = Math.abs(dHx - mx) < 0.6 && dHy < 2.27 && (!cav || (cav.doorF || 0) > 0.2);
        if (!throughDoor) { bestT = t; recv = 'pared'; nx = 0; ny = 0; nz = 1; }
      } }
      // sarcófago: test de losas contra su caja (tapa a 0,815 en el mundo)
      var mnx = mx - 0.59, mxx = mx + 0.59, mnz = mz - 0.82, mxz = mz + 1.52;
      var t0 = 0, t1 = 1e9, anx = 0, any = 0, anz = 0, ok = true;
      if (Math.abs(S.x) < 1e-8) { if (W.x < mnx || W.x > mxx) ok = false; }
      else { var ta = (mnx - W.x) / S.x, tb = (mxx - W.x) / S.x, sg = -1; if (ta > tb) { var tt = ta; ta = tb; tb = tt; sg = 1; } if (ta > t0) { t0 = ta; anx = sg; any = 0; anz = 0; } if (tb < t1) t1 = tb; }
      if (ok) {
        if (Math.abs(S.y) < 1e-8) { if (W.y < 0 || W.y > 0.815) ok = false; }
        else { ta = (0 - W.y) / S.y; tb = (0.815 - W.y) / S.y; sg = -1; if (ta > tb) { tt = ta; ta = tb; tb = tt; sg = 1; } if (ta > t0) { t0 = ta; anx = 0; any = sg; anz = 0; } if (tb < t1) t1 = tb; }
      }
      if (ok) {
        if (Math.abs(S.z) < 1e-8) { if (W.z < mnz || W.z > mxz) ok = false; }
        else { ta = (mnz - W.z) / S.z; tb = (mxz - W.z) / S.z; sg = -1; if (ta > tb) { tt = ta; ta = tb; tb = tt; sg = 1; } if (ta > t0) { t0 = ta; anx = 0; any = 0; anz = sg; } if (tb < t1) t1 = tb; }
      }
      if (ok && t0 > 0.01 && t0 <= t1 && t0 < bestT) { bestT = t0; recv = 'sarcófago'; nx = anx; ny = any; nz = anz; }
      return { t: Math.min(bestT, 8.5), recv: recv, nx: nx, ny: ny, nz: nz };
    }
    /* Geometría del prisma para 4 esquinas de ventana W con sus
       impactos P: 4 quads laterales con aFace (a lo largo del
       borde / a lo largo del haz), aWinUV (la UV VERDADERA de la
       ventana de cada vértice: la máscara del parteluz y el ruido
       la leen igual en las 4 caras) y aDist (metros desde el
       paño). Sin tapas: el paño lo cierra el cristal y el extremo
       lo cierra el parche. */
    function prismGeometry(W, P, WUV) {
      var pos = [], face = [], wuv = [], dist = [], idx = [];
      var edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
      for (var e = 0; e < 4; e++) {
        var a = edges[e][0], b = edges[e][1], base = e * 4;
        var da = W[a].distanceTo(P[a]), db = W[b].distanceTo(P[b]);
        var quad = [
          [W[a], 0, 0, a, 0], [W[b], 1, 0, b, 0], [P[b], 1, 1, b, db], [P[a], 0, 1, a, da]
        ];
        for (var i = 0; i < 4; i++) {
          var v = quad[i];
          pos.push(v[0].x, v[0].y, v[0].z);
          face.push(v[1], v[2]);
          wuv.push(WUV[v[3]][0], WUV[v[3]][1]);
          dist.push(v[4]);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 2));
      g.setAttribute('aWinUV', new THREE.Float32BufferAttribute(wuv, 2));
      g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
      g.setIndex(idx);
      return g;
    }
    /* Reconstruye prisma, núcleo, parche y siembra del polvo para
       el panteón ch y la ventana cand. Todo sale de las mismas 4
       esquinas proyectadas: haz y parche comparten extremo. */
    function buildBeam(ch, cand) {
      var mx = ch.cx * CHUNK + 11, mz = ch.cz * CHUNK + 11;
      var cav = ch.maus ? { hx: ch.maus.halfW - 0.28, hz: ch.maus.halfD - 0.28, doorF: (typeof ch.doorF === 'number' ? ch.doorF : 1) } : null; // cavidad real de ESTE panteón (v64) + el estado de su puerta para el hueco del test de receptores (v65)
      var S = new THREE.Vector3(-lightDir.x, -lightDir.y, -lightDir.z);
      var wx = cand.x, wz = cand.z;
      // esquinas del paño en el mundo: y 1,29…2,35 (1,32…2,38 local
      // menos el hundimiento), z ± 0,42; UV: u a lo largo de z, v en alto
      var W = [
        new THREE.Vector3(wx, 1.29, wz - 0.42), new THREE.Vector3(wx, 1.29, wz + 0.42),
        new THREE.Vector3(wx, 2.35, wz + 0.42), new THREE.Vector3(wx, 2.35, wz - 0.42)
      ];
      var WUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
      var P = [], i, hit;
      for (i = 0; i < 4; i++) { hit = rayReceiver(W[i], S, mx, mz, cav); P.push(new THREE.Vector3(W[i].x + S.x * hit.t, W[i].y + S.y * hit.t, W[i].z + S.z * hit.t)); }
      var Wc = new THREE.Vector3(wx, 1.82, wz);
      var hitC = rayReceiver(Wc, S, mx, mz, cav);
      BEAM.recv = hitC.recv;
      // prisma exterior y núcleo al 55 % sobre el eje del haz
      shaftMesh.geometry.dispose();
      shaftMesh.geometry = prismGeometry(W, P, WUV);
      var Wi = [], Pi = [];
      for (i = 0; i < 4; i++) {
        Wi.push(new THREE.Vector3(Wc.x + (W[i].x - Wc.x) * 0.55, Wc.y + (W[i].y - Wc.y) * 0.55, Wc.z + (W[i].z - Wc.z) * 0.55));
        hit = rayReceiver(Wi[i], S, mx, mz, cav);
        Pi.push(new THREE.Vector3(Wi[i].x + S.x * hit.t, Wi[i].y + S.y * hit.t, Wi[i].z + S.z * hit.t));
      }
      coreMesh.geometry.dispose();
      coreMesh.geometry = prismGeometry(Wi, Pi, WUV);
      // parche: las esquinas proyectadas, levantadas 6 mm por la
      // normal del receptor central (más el polygonOffset del
      // material): nada de z-fighting con el suelo o la pared
      var lift = 0.006;
      var pp = [], puv = [];
      for (i = 0; i < 4; i++) { pp.push(P[i].x + hitC.nx * lift, P[i].y + hitC.ny * lift, P[i].z + hitC.nz * lift); puv.push(WUV[i][0], WUV[i][1]); }
      var pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
      pg.setAttribute('aWinUV', new THREE.Float32BufferAttribute(puv, 2));
      pg.setIndex([0, 1, 2, 0, 2, 3]);
      poolMesh.geometry.dispose();
      poolMesh.geometry = pg;
      // penumbra del parche en UV: 0,0093·L + suciedad del vidrio, 3–6 cm
      var wP = clamp(0.0093 * hitC.t + 0.015, 0.03, 0.06);
      var poolW = Math.max(P[0].distanceTo(P[1]), 0.2), poolH = Math.max(P[1].distanceTo(P[2]), 0.2);
      poolMesh.material.uniforms.uEdgeU.value = clamp(wP / poolW, 0.01, 0.3);
      poolMesh.material.uniforms.uEdgeV.value = clamp(wP / poolH, 0.01, 0.3);
      // polvo: sembrado en el paño y repartido por el tramo del
      // rayo que vive dentro de la cavidad (aRem = lo que le queda
      // hasta chocar: el shader lo apaga junto a la superficie)
      var rng = mulberry32(hash2(ch.cx * 31 + (cand.nx > 0 ? 7 : 3), ch.cz * 17 + 11));
      var pos = dustGeo.attributes.position.array, rem = dustGeo.attributes.aRem.array;
      for (i = 0; i < DUST_N; i++) {
        var sx0 = wx, sy0 = 1.33 + rng() * 0.98, sz0 = wz + (rng() - 0.5) * 0.76;
        var st = new THREE.Vector3(sx0, sy0, sz0);
        var h = rayReceiver(st, S, mx, mz, cav);
        var ss = 0.03 + rng() * Math.max(h.t - 0.05, 0.02);
        pos[i * 3] = sx0 + S.x * ss;
        pos[i * 3 + 1] = sy0 + S.y * ss;
        pos[i * 3 + 2] = sz0 + S.z * ss;
        rem[i] = Math.max(h.t - ss, 0);
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustGeo.attributes.aRem.needsUpdate = true;
    }
    function updateWindowBeam(px, pz, t) {
      if (!dustPts) return;
      // el panteón CON ventana más cercano (el sistema sirve a uno solo)
      var best = null, bestD2 = 14 * 14;
      for (var k in chunks) {
        var ch = chunks[k];
        if (!ch.win) continue;
        var mx = ch.cx * CHUNK + 11, mz = ch.cz * CHUNK + 11;
        var d2 = (mx - px) * (mx - px) + (mz - pz) * (mz - pz);
        if (d2 < bestD2) { bestD2 = d2; best = ch; }
      }
      var lightI = 0, cand = null;
      if (best && lightDir.y > 0.02) {
        var wz = best.cz * CHUNK + 11 + best.win.zc;
        // UNA sola ventana (v64): un solo candidato, en SU pared
        // (win.x = desplazamiento de la pared en coords del chunk;
        // su signo ES la normal exterior de esa pared)
        var cands = [
          { x: best.cx * CHUNK + 11 + best.win.x, z: wz, nx: best.win.x > 0 ? 1 : -1 }
        ];
        var bf = 0.04; // umbral: la fuente casi de perfil no arma haz legible
        for (var i = 0; i < cands.length; i++) {
          var f = cands[i].nx * lightDir.x; // cara a la fuente de ESTA ventana = cos θi sobre su plano
          if (f > bf) { bf = f; cand = cands[i]; }
        }
        if (cand) {
          // τ(θi): la del tipo a incidencia normal × (1−R)² de
          // Fresnel normalizado (a 80° cae a ~0,37 de la normal)
          var cosI = clamp(bf, 0, 1);
          var fresR = 0.0426 + 0.9574 * Math.pow(1 - cosI, 5);
          var tauF = Math.pow((1 - fresR) / 0.9574, 2);
          // el esmerilado transmite difuso: su haz definido casi no existe
          var gGain = best.win.key === 'glassFrost' ? 0.30 : (best.win.key === 'glassThick' ? 0.95 : 1.0);
          // luna: factor de exhibición 0,30 sobre la misma E_frame
          // (la tubería ya compensa la noche; ver la ley en la cabecera)
          var srcF = worldLight.elev > -0.8 ? 1.0 : 0.30;
          lightI = clamp(sun.intensity / 3.0, 0, 1) * best.win.trans * tauF * gGain * srcF;
        }
      }
      BEAM.I = lightI;
      BEAM.glass = best ? best.win.key : null;
      var show = !!cand && lightI > 0.015 && !shaftBroken;
      BEAM.on = show;
      if (!show) {
        if (shaftMesh) shaftMesh.visible = false;
        if (coreMesh) coreMesh.visible = false;
        if (poolMesh) poolMesh.visible = false;
        dustPts.visible = false;
        clearBeamBounce(); // sin haz no hay parche que rebote: la sala vuelve a su ley de aberturas
        return;
      }
      /* REBOTE INTERIOR (v70): el parche luminisce la sala — el
         uniform beamU de ESTE panteón recibe color × intensidad de
         la misma ley del haz, cada frame: si el sol se mueve o una
         nube lo tapa, la luminiscencia respira con él (dinámica,
         no un relleno fijo). Ganancia 0,38: el primer rebote de un
         parche de ~1 m² sobre una cavidad de ~30 m² de superficie
         con albedo de mármol ~0,25 da una elevación media de ese
         orden — la sala se lee, el rayo sigue mandando. */
      if (beamBounceChunk && beamBounceChunk !== best) clearBeamBounce();
      if (best.mausCfg && best.mausCfg.beamU) {
        best.mausCfg.beamU.value.copy(sun.color).multiplyScalar(lightI * 0.30); // v72: 0,38 → 0,30 y, en el shader, el término va × iAp (la ley de aberturas): el rebote ilumina apenas y decae hacia el fondo de la sala (reporte 20:50, interior inundado)
        beamBounceChunk = best;
      }
      var key = best.cx + ',' + best.cz + ',' + cand.nx + '|' + Math.round(lightDir.x * 24) + ',' + Math.round(lightDir.y * 24) + ',' + Math.round(lightDir.z * 24) + '|' + ((best.doorF || 0) > 0.2 ? 1 : 0); // el estado de la puerta entra en la clave: abrirla reconstruye el haz con el hueco libre (fix v65)
      if (key !== beamKey) { beamKey = key; buildBeam(best, cand); }
      shaftMesh.visible = true;
      coreMesh.visible = true;
      poolMesh.visible = !poolBroken;
      dustPts.visible = true;
      beamUni.uTime.value = t;
      beamUni.uLightI.value = lightI;
      beamUni.uColor.value.copy(sun.color);
      beamUni.uSunTravel.value.set(-lightDir.x, -lightDir.y, -lightDir.z);
      beamPaneU.value = best.win.key === 'glassFrost' ? 0.25 : 1.0;
      if (dustShaderOk) {
        dustPxU.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
      } else if (dustPts.material) {
        dustPts.material.opacity = lightI * 0.5;
        dustPts.material.color.copy(sun.color);
      }
    }
