/* geometry.js — Constructores de geometría: tumbas, árboles, panteones
   accesibles, ángel y cercas (sistema de buckets por material).
   Depende de: utils, materials (solo en tiempo de construcción de chunks). */
'use strict';
    /* ================= Constructores de geometría ================= */
    var _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
    function xform(geo, x, y, z, ry, rx, rz, sx, sy, sz) {
      _e.set(rx || 0, ry || 0, rz || 0);
      _q.setFromEuler(_e);
      _v.set(x, y, z); _s.set(sx || 1, sy || 1, sz || 1);
      _m4.compose(_v, _q, _s);
      var g = geo.clone().applyMatrix4(_m4);
      return g.index ? g.toNonIndexed() : g;
    }
    function Bucket() { this.map = {}; }
    Bucket.prototype.add = function (matKey, geo) {
      if (!this.map[matKey]) this.map[matKey] = [];
      this.map[matKey].push(geo);
    };
    Bucket.prototype.build = function (mats, group, shadow) {
      var meshes = {};
      for (var k in this.map) {
        var merged = THREE.BufferGeometryUtils.mergeGeometries(this.map[k], false);
        if (!merged) { // una fusión fallida no debe parir una malla con geometría null: el render la lee (morphAttributes) y tumba el juego entero con un error que parece de texturas (regresión v72). Se salta el material y el resto del chunk vive.
          if (window.console && console.warn) console.warn('Bucket: fusión fallida, material omitido:', k);
          continue;
        }
        var mesh = new THREE.Mesh(merged, mats[k]);
        mesh.castShadow = shadow !== false;
        mesh.receiveShadow = true;
        group.add(mesh);
        meshes[k] = mesh;
      }
      return meshes;
    };

    /* ASENTAMIENTO (v55, fenómeno→consecuencia): ninguna base nace en
       tangencia exacta con el suelo (y = 0). Una base que solo TOCA el
       plano se lee flotando en cuanto el muestreo de sombras aparta el
       borde de sombra unos centímetros del contacto (normalBias, PCF):
       queda una franja de suelo iluminado donde la sombra debería nacer
       pegada a la piedra. Toda pieza colocada se hunde SEAT_SINK en el
       terreno al trasladarla a su sitio (world.js y las siluetas
       lejanas de abajo): la base CORTA el suelo, la intersección es
       real y la sombra nace sobre la propia junta a cualquier ángulo
       de vista y de sol. 3 cm es invisible en la altura de cualquier
       pieza (la menor, la losa de la fosa, mide 5,5 cm) y sobra para
       sellar la junta. Los colisionadores no cambian: describen el
       volumen sobre el suelo, no la junta. */
    var SEAT_SINK = 0.03;

    /* REGLA DE JUNTAS (v57, reporte de Guille con fotos, 2026-11-22
       12:13: luz por los bordes del interior del panteón y de las
       tumbas — «los modelos no son consistentes»): el hundimiento de
       arriba sella la junta pieza↔terreno, pero DENTRO de cada
       modelo quedaban contactos en TANGENCIA EXACTA (la tapa del
       sarcófago apoyada a ras sobre el cuerpo, el segundo zócalo de
       la cruz sobre el primero, el obelisco sobre su capitel, el
       frontón sobre el techo, la cabecera de la losa baja colgando
       32 cm FUERA de su losa sobre el pasto) y la losa de la fosa
       terminaba ANTES de la base, que quedaba parada sobre el pasto
       junto a ella: dos piezas vecinas que no se tocan se leen como
       un modelo roto y cualquier muestreo de sombra abre una línea
       de luz en la junta. La regla pasa a ser la de la construcción
       real y vale para TODA junta, también las interiores: las
       piezas se INTERSECAN 1,5–3 cm (nunca tangencia, nunca hueco)
       y la losa de la fosa corre POR DEBAJO de la base, que nace
       fundida en ella como en las tumbas reales. */

    /* REGLA ANTI-PARPADO (v68, reporte de Guille 2026-11-22 19:37:
       «parpadeo en las columnas y demás partes del modelo — a veces,
       según el movimiento de la cámara, muestra una textura o la
       otra»). Diagnóstico por AUDITORÍA GEOMÉTRICA en Node sobre
       estos mismos constructores (las 8 variantes de panteón, las 5
       tumbas, ángel, cerca): pares de triángulos de piezas distintas
       con planos paralelos a <20 mm y solape. Lo que peleaba de
       verdad (caras EXPUESTAS, misma orientación, mismo plano):
       (1) las ESQUINAS del panteón estaban construidas DOS VECES —
       laterales a todo el fondo y frente/fondo a todo el ancho se
       solapaban en el cubo de la esquina, y sus caras exteriores
       coplanares se alternaban la textura al mover la cámara; ahora
       cada esquina es de UNA sola pared (fondo entre laterales,
       frente hasta donde empieza la lateral). (2) Las CRUCES
       (lápida cruz y la del sarcófago): mástil y travesaño con el
       mismo fondo y el mismo centro = frente coplanar en el cruce;
       ahora el travesaño va 2 cm en relieve. (3) El MARCO de la
       ventana: las 4 piezas compartían el plano lateral y se
       solapaban en las esquinas; los laterales van retranqueados
       12 mm por cara, y la barra horizontal del parteluz es más
       fina que la vertical por la misma razón. (4) Las COLUMNAS
       del pórtico: el vértice trasero del fuste caía EXACTO sobre
       el plano frontal de la cornisa (tangencia) — a 0,39 m ya no.
       (5) Las PLACAS volaban a 1–11 mm de su piedra (la de la losa
       baja, a ¡1 mm!): a media distancia la precisión del buffer de
       profundidad (near 0,1 / far 3000) ya no las separa y placa y
       piedra se alternan; ahora vuelan 15–20 mm y su material lleva
       polygonOffset (materials.js), como ya hacía el sendero.
       (6) Los postes de la cerca (0,045) contra los rieles (0,05):
       caras a 2,5 mm dentro del cruce; poste a 0,065.
       (7) La cabecera de la losa baja compartía el plano trasero
       (z = −0,45) con su losa: caras traseras coplanares; la
       cabecera entera se adelantó 2 cm. Tras los arreglos, la
       auditoría pasa de 311 a 91 clases coplanares de misma
       orientación, y las 91 son caras inferiores en y = 0 (bajo el
       terreno) o interfaces encerradas entre sólidos.
       Lo que la auditoría encontró y NO se toca, por invisible: las
       caras inferiores en y = 0 de piezas vecinas (quedan bajo el
       terreno tras el SEAT_SINK) y las interfaces encerradas entre
       sólidos (techos de pared contra fondo de techo, bases contra
       pedestales): ninguna raya de vista las alcanza. */

    /* ============ Versiones LEJANAS (low-poly) ============
       Proxies de silueta para el LOD por distancia de world.js: la
       misma tumba/árbol/panteón reducido a 2–3 cajas (12–36 tris) sin
       placas, sin bisel y sin detalle. A más de ~100 m, dentro de la
       niebla o en aire claro a esa distancia, la silueta es todo lo
       que se lee; el detalle completo solo se construye y se dibuja
       en el anillo cercano. Los proxies van en el MISMO bucket de
       materiales del chunk (mismos clones), así el fundido de
       entrada/salida los cubre igual que a la versión completa. */
    function farInto(bucket, matKey, geos, ry, lx, lz) {
      for (var i = 0; i < geos.length; i++) {
        var g = geos[i];
        g.rotateY(ry); g.translate(lx, -SEAT_SINK, lz);
        bucket.add(matKey, g);
      }
    }
    function addFarTomb(bucket, kind, matKey, ry, lx, lz) {
      var geos = [];
      if (kind === 0) { // redonda: base + losa como caja
        geos.push(xform(GEO.box, 0, 0.09, 0, 0, 0, 0, 0.95, 0.18, 0.62));
        geos.push(xform(GEO.box, 0, 0.70, 0, 0, 0, 0, 0.78, 1.06, 0.13));
        geos.push(xform(GEO.box, 0, 0.028, 0.885, 0, 0, 0, 0.92, 0.055, 2.7));
      } else if (kind === 1) { // gótica
        geos.push(xform(GEO.box, 0, 0.09, 0, 0, 0, 0, 0.9, 0.18, 0.6));
        geos.push(xform(GEO.box, 0, 0.72, 0, 0, 0, 0, 0.74, 1.10, 0.13));
        geos.push(xform(GEO.box, 0, 0.028, 0.885, 0, 0, 0, 0.92, 0.055, 2.7));
      } else if (kind === 2) { // cruz: zócalo + mástil + travesaño
        geos.push(xform(GEO.box, 0, 0.075, 0, 0, 0, 0, 1.02, 0.15, 0.7));
        geos.push(xform(GEO.box, 0, 0.785, 0, 0, 0, 0, 0.17, 1.30, 0.17));
        geos.push(xform(GEO.box, 0, 1.13, 0, 0, 0, 0, 0.64, 0.17, 0.17));
        geos.push(xform(GEO.box, 0, 0.028, 0.885, 0, 0, 0, 0.92, 0.055, 2.7));
      } else if (kind === 3) { // obelisco: pedestal + fuste
        geos.push(xform(GEO.box, 0, 0.26, 0, 0, 0, 0, 0.84, 0.52, 0.84));
        geos.push(xform(GEO.box, 0, 1.35, 0, 0, 0, 0, 0.46, 1.70, 0.46));
        geos.push(xform(GEO.box, 0, 0.028, 0.885, 0, 0, 0, 0.92, 0.055, 2.7));
      } else { // losa baja
        geos.push(xform(GEO.box, 0, 0.07, 0.55, 0, 0, 0, 1.0, 0.14, 2.0));
        geos.push(xform(GEO.box, 0, 0.40, -0.24, 0, 0, 0, 0.6, 0.56, 0.11));
      }
      farInto(bucket, matKey, geos, ry, lx, lz);
    }
    function addFarTree(bucket, dead, tx, tz) {
      if (!dead) { // ciprés procedural: cono ya es la silueta
        bucket.add('wood', xform(GEO.cyl, tx, 0.3 - SEAT_SINK, tz, 0, 0, 0, 0.22, 0.6, 0.22));
        bucket.add('foliage', xform(GEO.cylTaper, tx, 0.4 + 1.7 - SEAT_SINK, tz, 0, 0, 0, 1.15, 3.4, 1.15));
      } else { // seco: tronco inclinado, sin ramas
        bucket.add('wood', xform(GEO.cylTaper, tx, 1.15 - SEAT_SINK, tz, 0, 0, 0.08, 0.55, 2.3, 0.55));
      }
    }

    var GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      cylTaper: new THREE.CylinderGeometry(0.30, 0.52, 1, 7),
      obelisk: new THREE.CylinderGeometry(0.20, 0.38, 1, 4),
      pyramid: new THREE.ConeGeometry(0.30, 1, 4),
      sphere: new THREE.SphereGeometry(0.5, 12, 10),
      plane: null // se crea por placa (UV al atlas)
    };
    function roundedSlabGeo(w, h, depth) {
      var s = new THREE.Shape();
      var r = w / 2, straight = h - r;
      s.moveTo(-r, 0); s.lineTo(-r, straight);
      s.absarc(0, straight, r, Math.PI, 0, true);
      s.lineTo(r, 0); s.lineTo(-r, 0);
      var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 14 });
      g.translate(0, 0, -depth / 2);
      return g;
    }
    function gothicSlabGeo(w, h, depth) {
      var s = new THREE.Shape();
      var r = w / 2;
      s.moveTo(-r, 0); s.lineTo(-r, h * 0.62);
      s.quadraticCurveTo(-r, h * 0.92, 0, h);
      s.quadraticCurveTo(r, h * 0.92, r, h * 0.62);
      s.lineTo(r, 0); s.lineTo(-r, 0);
      var g = new THREE.ExtrudeGeometry(s, { depth: depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1, curveSegments: 10 });
      g.translate(0, 0, -depth / 2);
      return g;
    }
    var slabRound = roundedSlabGeo(0.78, 1.08, 0.13);
    var slabRoundSmall = roundedSlabGeo(0.6, 0.78, 0.11);
    var slabGothic = gothicSlabGeo(0.74, 1.22, 0.13);

    function plaqueGeo(w, h, plaqueIdx) {
      return plaqueGeoGrid(w, h, plaqueIdx, PLAQUE_COLS, PLAQUE_ROWS);
    }

    /* Variante con retícula arbitraria (v70): las placas del panteón
       familiar leen del atlas PROPIO de su familia (FAM_COLS×FAM_ROWS,
       plaques.js), no del atlas general de 48. */
    function plaqueGeoGrid(w, h, idx, cols, rows) {
      var g = new THREE.PlaneGeometry(w, h);
      var col = idx % cols, row = Math.floor(idx / cols);
      var uv = g.attributes.uv;
      var u0 = col / cols, v1 = 1 - row / rows, v0 = v1 - 1 / rows;
      for (var i = 0; i < uv.count; i++) {
        uv.setXY(i, u0 + uv.getX(i) / cols, v0 + uv.getY(i) / rows);
      }
      return g;
    }

    /* Tramo de sendero: plano cuyas UVs ya van en metros — la textura de
       tierra cubre PATH_TILE metros por baldosa tanto en U como en V, así
       se repite sin estirarse en ninguna dirección ni orientación. */
    var PATH_TILE = 3;
    function makePathGeo(w, h) {
      var g = new THREE.PlaneGeometry(w, h);
      var uv = g.attributes.uv;
      for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / PATH_TILE, uv.getY(i) * h / PATH_TILE);
      return g;
    }

    /* Mechón de césped: tres láminas cruzadas que se afilan hacia la punta
       (los vértices altos se cierran al centro), con inclinación y giro al
       azar. Barato (pocos triángulos) y con volumen desde cualquier lado. */
    function makeGrassTuft(rng) {
      var parts = [];
      for (var i = 0; i < 3; i++) {
        var h = 0.30 + rng() * 0.28, w = 0.30 + rng() * 0.14;
        var g = new THREE.PlaneGeometry(w, h, 1, 2);
        var pos = g.attributes.position;
        for (var vi = 0; vi < pos.count; vi++) {
          var f = (pos.getY(vi) + h / 2) / h; // 0 = base, 1 = punta
          pos.setX(vi, pos.getX(vi) * (1 - f * 0.88));
        }
        g.translate(0, h / 2, 0);
        g.rotateX((rng() - 0.5) * 0.38);
        g.rotateY(rng() * Math.PI);
        parts.push(g.index ? g.toNonIndexed() : g);
      }
      var merged = THREE.BufferGeometryUtils.mergeGeometries(parts, false);
      for (var q = 0; q < parts.length; q++) parts[q].dispose();
      return merged;
    }

    /* Cada tumba: piezas al bucket, placa opcional y colisionador (semiejes y altura). */
    function buildTomb(bucket, kind, matKey, plaqueIdx, withSlab) {
      var info = { plaque: null, col: null };
      if (withSlab) bucket.add(matKey, xform(GEO.box, 0, 0.028, 0.885, 0, 0, 0, 0.92, 0.055, 2.7)); // losa de la fosa: corre bajo la base (z −0,465…2,235) y la base nace fundida en ella (v57)
      if (kind === 0) { // lápida redonda clásica
        bucket.add(matKey, xform(GEO.box, 0, 0.09, 0, 0, 0, 0, 0.95, 0.18, 0.62));
        bucket.add(matKey, xform(slabRound, 0, 0.17, 0, 0));
        info.plaque = { x: 0, y: 0.70, z: 0.092, w: 0.5, h: 0.66 }; // v68: 15 mm ante la cara de la lápida (antes 5 mm: a media distancia la precisión de profundidad ya no separaba placa y piedra)
        info.col = { hw: 0.48, hd: 0.32, h: 1.3 };
      } else if (kind === 1) { // gótica
        bucket.add(matKey, xform(GEO.box, 0, 0.09, 0, 0, 0, 0, 0.9, 0.18, 0.6));
        bucket.add(matKey, xform(slabGothic, 0, 0.17, 0, 0));
        info.plaque = { x: 0, y: 0.72, z: 0.092, w: 0.48, h: 0.64 }; // v68: 15 mm ante la cara (antes 5 mm)
        info.col = { hw: 0.45, hd: 0.31, h: 1.42 };
      } else if (kind === 2) { // cruz
        bucket.add(matKey, xform(GEO.box, 0, 0.075, 0, 0, 0, 0, 1.02, 0.15, 0.7));
        bucket.add(matKey, xform(GEO.box, 0, 0.21, 0, 0, 0, 0, 0.8, 0.15, 0.54));
        bucket.add(matKey, xform(GEO.box, 0, 0.83, 0, 0, 0, 0, 0.17, 1.12, 0.17));
        bucket.add(matKey, xform(GEO.box, 0, 1.13, 0.02, 0, 0, 0, 0.64, 0.17, 0.17)); // travesaño 2 cm en relieve (v68): mismo fondo y mismo centro que el mástil = caras frontales coplanares que peleaban en el cruce
        info.plaque = { x: 0, y: 0.52, z: 0.100, w: 0.15, h: 0.42 };
        info.col = { hw: 0.51, hd: 0.35, h: 1.45 };
      } else if (kind === 3) { // obelisco
        bucket.add(matKey, xform(GEO.box, 0, 0.26, 0, 0, 0, 0, 0.84, 0.52, 0.84));
        bucket.add(matKey, xform(GEO.box, 0, 0.56, 0, 0, 0, 0, 0.62, 0.1, 0.62));
        bucket.add(matKey, xform(GEO.obelisk, 0, 1.30, 0, Math.PI / 4, 0, 0, 1, 1.42, 1));
        bucket.add(matKey, xform(GEO.pyramid, 0, 2.13, 0, Math.PI / 4, 0, 0, 1, 0.26, 1));
        info.plaque = { x: 0, y: 0.27, z: 0.438, w: 0.46, h: 0.42 }; // v68: 18 mm ante el pedestal (antes 8 mm)
        info.col = { hw: 0.43, hd: 0.43, h: 2.3 };
      } else { // losa baja con cabecera pequeña
        bucket.add(matKey, xform(GEO.box, 0, 0.07, 0.55, 0, 0, 0, 1.0, 0.14, 2.0));
        bucket.add(matKey, xform(GEO.box, 0, 0.08, -0.22, 0, 0, 0, 0.8, 0.16, 0.42)); // cabecera 2 cm hacia adelante (v68): su cara trasera caía en el MISMO plano que la trasera de la losa (z = −0,45) y peleaban por detrás
        bucket.add(matKey, xform(slabRoundSmall, 0, 0.15, -0.22, 0));
        info.plaque = { x: 0, y: 0.5, z: -0.22 + 0.082, w: 0.4, h: 0.52 }; // v68: 15 mm ante la cara (antes ¡1 mm!: la placa y la piedra empataban en profundidad y se alternaban al mover la cámara)
        info.col = { hw: 0.5, hd: 1.0, h: 0.95, cz: 0.1 };
      }
      if (info.plaque && plaqueIdx != null) {
        var p = info.plaque;
        bucket.add('plaque', xform(plaqueGeo(p.w, p.h, plaqueIdx), p.x, p.y, p.z, 0));
        info.plaqueIdx = plaqueIdx;
      }
      return info;
    }

    function buildTree(bucket, rng, dead) {
      if (!dead) { // ciprés
        var h = 2.6 + rng() * 1.6;
        bucket.add('wood', xform(GEO.cyl, 0, 0.3, 0, 0, 0, 0, 0.22, 0.6, 0.22));
        var fk = rng() > 0.5 ? 'foliage' : 'foliage2';
        bucket.add(fk, xform(GEO.cylTaper, 0, 0.4 + h / 2, 0, 0, 0, 0, 1.15, h, 1.15));
        bucket.add(fk, xform(GEO.pyramid, 0, 0.4 + h + 0.28, 0, 0, 0, 0, 1.0, 0.6, 1.0));
        return { hw: 0.3, hd: 0.3, h: 1.2 };
      }
      // árbol seco: tronco torcido y ramas desnudas
      var lean = (rng() - 0.5) * 0.16, th = 1.9 + rng() * 0.9;
      bucket.add('wood', xform(GEO.cylTaper, 0, th / 2, 0, 0, 0, lean, 0.55, th, 0.55));
      var branches = 3 + Math.floor(rng() * 3);
      for (var i = 0; i < branches; i++) {
        var a = rng() * Math.PI * 2, tilt = 0.6 + rng() * 0.7, bl = 0.7 + rng() * 0.8;
        var bx = Math.cos(a) * 0.3, bz = Math.sin(a) * 0.3;
        bucket.add('wood', xform(GEO.cylTaper,
          bx + Math.cos(a) * bl * 0.36, th * (0.72 + rng() * 0.22) + bl * 0.3, bz + Math.sin(a) * bl * 0.36,
          0, tilt * Math.sin(a), tilt * Math.cos(a), 0.16, bl, 0.16));
      }
      return { hw: 0.32, hd: 0.32, h: 1.4 };
    }

    /* Panteón accesible: paredes con puerta abierta, interior con nichos
       legibles y sarcófago central. Devuelve colisionadores y placas en
       coordenadas locales (la entrada mira hacia +Z). */
    function buildMausoleum(bucket, rng, plaqueIdx, family) {
      /* MATERIAL DE PARED (v65, pedido de Guille): ya no es siempre
         mármol — ~35 % de los panteones son de CEMENTO cepillado
         (MAT.cement, Poly Haven Brushed Concrete CC0); el resto,
         mármol pulido (v52). El material viaja en el retorno (mk)
         para que la silueta lejana use el mismo. */
      var mk = rng() < 0.35 ? 'cement' : 'marble';
      /* TAMAÑO (v64, pedido de Guille): la planta clásica de siempre
         (4,6 × 3,9 × 3,0 m) sigue siendo la norma; ~30 % de los
         panteones sale GRANDE (5,9 × 5,0 × 3,45 m — un poco más de
         ancho, fondo y alto, como los panteones familiares de varias
         plazas). El grosor de pared y la ventana no cambian. El
         tamaño viaja en el retorno (maus) para que la ley de luz
         interior, el haz de la ventana y la réplica CPU de lectura
         usen la cavidad real de cada panteón, no la clásica. */
      var big = rng() < 0.30;
      var W = big ? 5.9 : 4.6, D = big ? 5.0 : 3.9, H = big ? 3.45 : 3.0, T = 0.28; // ancho, fondo, alto, grosor de pared
      var cols = [], tombsIn = [];
      /* ===== VENTANAS (v60, pedido de Guille): REGLA DE GENERACIÓN =====
         No todo panteón lleva ventana: el sorteo del chunk decide —
         ~62 % llevan UNA SOLA ventana (v64, pedido de Guille: «que
         tengan solo una»): va en UNA de las dos paredes laterales,
         con el lado también por sorteo, y la otra pared queda
         entera; el ~38 % restante queda ciego, como los panteones
         chicos reales. El lado viaja en el retorno (win.side, en
         coordenadas locales: el giro de π de world.js lo pasa a la
         pared de enfrente en el chunk, y world.js lo convierte). El
         CRISTAL también sale del sorteo, con las proporciones de los
         materiales que se ven en los cementerios: vidrio FINO claro
         de 6 mm (45 %), vidrio GRUESO verdoso de 24 mm (35 %, el de
         las construcciones viejas, colado con hierro: absorbe más y
         tiñe) y ESMERILADO de 12 mm (20 %, el que busca privacidad:
         transmite la luz difusa, no la imagen). Cada tipo es un
         material propio (materials.js, GLASS_TYPES) con su shader
         físico — Fresnel + Beer–Lambert por el camino real dentro
         del paño — y su espesor visual sigue al real (1 / 4 / 2 cm:
         el grueso se lee en el canto del hueco). La ventana es una
         ABERTURA de verdad, no un adorno: el hueco corta la pared,
         el sol entra por él vía mapa de sombras (el cristal no
         proyecta sombra) y su ángulo sólido × transmitancia se suma
         al de la puerta en la ley de luz interior (world.js pasa el
         dato a applyInteriorPatch). Hueco: 0,84 de ancho × 1,06 de
         alto, antepecho a 1,32 y dintel a 2,38, centrado a z = −0,20
         (algo hacia el fondo, lejos de la puerta). */
      var WIN = null, winGlass = null;
      if (rng() < 0.62) {
        var gRoll = rng();
        winGlass = gRoll < 0.45 ? 'glassThin' : (gRoll < 0.80 ? 'glassThick' : 'glassFrost');
        WIN = { zc: -0.20, w: 0.84, sill: 1.32, top: 2.38, side: rng() < 0.5 ? -1 : 1 }; // UNA sola ventana (v64): el lado sale del sorteo
      }
      bucket.add(mk, xform(GEO.box, 0, 0.03, 0, 0, 0, 0, W + 0.6, 0.06, D + 0.2));     // suelo del panteón (a ras): llega hasta z D/2 + 0,10, donde EMPIEZA el escalón — se tocan en la arista, no se solapan (v58)
      bucket.add(mk, xform(GEO.box, 0, 0.03, D / 2 + 0.55, 0, 0, 0, 1.9, 0.06, 0.9));  // escalón de entrada (z D/2+0,10…D/2+1,00): a ras con el suelo pero SIN pisarlo — antes el suelo corría hasta z 2,45 y ambos ocupaban la banda 2,05…2,45 con la cara superior COPLANAR a 0,06: z-fighting en toda la banda al mover la cámara (reporte 12:48)
      bucket.add(mk, xform(GEO.box, 0, H / 2, -D / 2 + T / 2, 0, 0, 0, W - 2 * T, H, T)); // pared del fondo: ENTRE las laterales (v68, ver regla anti-parpadeo abajo)
      cols.push({ x: 0, z: -D / 2 + T / 2, hw: W / 2 - T, hd: T / 2, h: H });
      if (WIN) {
        // LA pared de la ventana (una sola, v64) EN CUATRO PIEZAS
        // alrededor del hueco (bajo el antepecho, sobre el dintel, y
        // los dos tramos a los lados del hueco): la abertura es
        // geometría real. La OTRA pared lateral va entera. El
        // colisionador sigue siendo la pared entera en las dos: el
        // hueco empieza a 1,32 m, fuera del cuerpo del jugador.
        var wh = WIN.top - WIN.sill, wy = (WIN.sill + WIN.top) / 2;
        var zF = WIN.zc + WIN.w / 2, zB = WIN.zc - WIN.w / 2;
        var wx = WIN.side * (W / 2 - T / 2);
        bucket.add(mk, xform(GEO.box, wx, WIN.sill / 2, 0, 0, 0, 0, T, WIN.sill, D));
        bucket.add(mk, xform(GEO.box, wx, (WIN.top + H) / 2, 0, 0, 0, 0, T, H - WIN.top, D));
        bucket.add(mk, xform(GEO.box, wx, wy, (zF + D / 2) / 2, 0, 0, 0, T, wh, D / 2 - zF));
        bucket.add(mk, xform(GEO.box, wx, wy, (zB - D / 2) / 2, 0, 0, 0, T, wh, zB + D / 2));
        // marco de mármol: solapa 2 cm la piedra y 2 cm el cristal
        // (regla de juntas v57: intersección, nunca tangencia)
        var fd = T + 0.06, fw = 0.09;
        bucket.add(mk, xform(GEO.box, wx, WIN.top + 0.025, WIN.zc, 0, 0, 0, fd, fw, WIN.w + 0.13));
        bucket.add(mk, xform(GEO.box, wx, WIN.sill - 0.025, WIN.zc, 0, 0, 0, fd, fw, WIN.w + 0.13));
        bucket.add(mk, xform(GEO.box, wx, wy, WIN.zc - WIN.w / 2 - 0.025, 0, 0, 0, fd - 0.024, wh, fw)); // laterales del marco RETRANQUEADOS 12 mm por cara (v68): con el mismo fd, las caras laterales de las 4 piezas eran coplanares y se solapaban en las esquinas — z-fighting en los cantos del marco
        bucket.add(mk, xform(GEO.box, wx, wy, WIN.zc + WIN.w / 2 + 0.025, 0, 0, 0, fd - 0.024, wh, fw));
        // parteluz de hierro: la cruz que divide el paño en cuatro
        bucket.add('iron', xform(GEO.box, wx, wy, WIN.zc, 0, 0, 0, 0.055, wh - 0.02, 0.045));
        bucket.add('iron', xform(GEO.box, wx, wy, WIN.zc, 0, 0, 0, 0.05, 0.045, WIN.w - 0.02)); // barra horizontal: 0,05 en x (v68) — ni 0,055 (coplanar con la barra vertical en el cruce) ni 0,04 (coplanar con el cristal grueso, que también mide 0,04 y va centrado en el mismo plano)
        // el CRISTAL, centrado en el espesor de la pared; su grosor
        // visual sigue al tipo sorteado (fino 1 cm · esmerilado 2 cm
        // · grueso 4 cm: el canto del grueso se lee en el hueco)
        var gth = winGlass === 'glassThick' ? 0.04 : (winGlass === 'glassFrost' ? 0.02 : 0.01);
        bucket.add(winGlass, xform(GEO.box, wx, wy, WIN.zc, 0, 0, 0, gth, wh - 0.03, WIN.w - 0.03));
        bucket.add(mk, xform(GEO.box, -wx, H / 2, 0, 0, 0, 0, T, H, D)); // la otra lateral, entera
        cols.push({ x: -W / 2 + T / 2, z: 0, hw: T / 2, hd: D / 2, h: H });
        cols.push({ x: W / 2 - T / 2, z: 0, hw: T / 2, hd: D / 2, h: H });
      } else {
        bucket.add(mk, xform(GEO.box, -W / 2 + T / 2, H / 2, 0, 0, 0, 0, T, H, D));     // pared izquierda
        cols.push({ x: -W / 2 + T / 2, z: 0, hw: T / 2, hd: D / 2, h: H });
        bucket.add(mk, xform(GEO.box, W / 2 - T / 2, H / 2, 0, 0, 0, 0, T, H, D));      // pared derecha
        cols.push({ x: W / 2 - T / 2, z: 0, hw: T / 2, hd: D / 2, h: H });
      }
      // frente con hueco de puerta de 1,2 m: los tramos laterales
      // cubren desde el borde del hueco (±0,6) hasta donde empiezan
      // las paredes laterales (±(W/2 − T)): la esquina es SOLO de la
      // lateral (v68, ver regla anti-parpadeo abajo)
      var segW = W / 2 - T - 0.6, segX = 0.6 + segW / 2;
      bucket.add(mk, xform(GEO.box, -segX, H / 2, D / 2 - T / 2, 0, 0, 0, segW, H, T));
      cols.push({ x: -segX, z: D / 2 - T / 2, hw: segW / 2, hd: T / 2, h: H });
      bucket.add(mk, xform(GEO.box, segX, H / 2, D / 2 - T / 2, 0, 0, 0, segW, H, T));
      cols.push({ x: segX, z: D / 2 - T / 2, hw: segW / 2, hd: T / 2, h: H });
      bucket.add(mk, xform(GEO.box, 0, (2.3 + H) / 2, D / 2 - T / 2, 0, 0, 0, 1.2, H - 2.3, T)); // dintel: de la coronación de la puerta (2,3) al techo
      // techo, cornisa y frontón (vuelan 0,3–0,4 m sobre la planta)
      bucket.add(mk, xform(GEO.box, 0, H + 0.16, 0, 0, 0, 0, W + 0.6, 0.32, D + 0.6));
      bucket.add(mk, xform(GEO.box, 0, H - 0.02, 0, 0, 0, 0, W + 0.4, 0.16, D + 0.4));
      var tri = new THREE.Shape();
      var pedHW = W / 2 - 0.1, pedApex = W * 0.185;
      tri.moveTo(-pedHW, 0); tri.lineTo(pedHW, 0); tri.lineTo(0, pedApex); tri.lineTo(-pedHW, 0);
      var ped = new THREE.ExtrudeGeometry(tri, { depth: 0.4, bevelEnabled: false });
      ped.translate(0, 0, -0.2);
      bucket.add(mk, xform(ped, 0, H + 0.30, D / 2 - 0.05, 0));
      // columnas de la entrada (a 0,35 m de las esquinas, ante el frente)
      // v68: a z = D/2 + 0,39 (antes 0,35) — el vértice trasero del fuste
      // caía EXACTAMENTE sobre el plano frontal de la cornisa (D/2 + 0,20):
      // tangencia pura, y las facetas vecinas pasaban a <1 mm de ese plano
      // en su tercio alto — parpadeo al mover la cámara. A 0,39 el fuste
      // queda 4 cm por delante de la cornisa y el techo (frente a D/2 + 0,30)
      // lo sigue cortando 6 cm: la columna sigue «cargando» el techo.
      [-(W / 2 - 0.35), W / 2 - 0.35].forEach(function (cx) {
        bucket.add(mk, xform(GEO.cyl, cx, H / 2, D / 2 + 0.39, 0, 0, 0, 0.3, H, 0.3));
        bucket.add(mk, xform(GEO.box, cx, 0.1, D / 2 + 0.39, 0, 0, 0, 0.44, 0.2, 0.44));
        cols.push({ x: cx, z: D / 2 + 0.39, hw: 0.2, hd: 0.2, h: H });
      });
      /* PUERTA CON ESTADO (v65, pedido de Guille): hasta la v64 toda
         puerta nacía abierta de par en par, fija. Ahora el sorteo
         decide: ~40 % de los panteones están SELLADOS — la hoja va
         CERRADA en el hueco, con su textura real, y el vano lleva
         colisionador permanente: se ven puerta y (si la hay) ventana,
         pero no se entra. El ~60 % restante es ABRIBLE: la hoja NO va
         en el bucket estático — world.js la monta en un pivote en la
         bisagra, nace cerrada con colisionador, y al interactuar (E /
         botón) gira hacia adentro; su colisionador se retira y la ley
         de luz interior abre la abertura de la puerta con el giro
         (uDoorOpen). La TEXTURA de la hoja también sale del sorteo:
         pino rústico (doorA) o tablones con herrajes (doorB), ambas
         Poly Haven CC0. El picaporte de hierro acompaña a la hoja. */
      var doorSealed = rng() < 0.40;
      var doorTex = rng() < 0.5 ? 'doorA' : 'doorB';
      var doorInfo = { sealed: doorSealed, tex: doorTex };
      if (doorSealed) {
        bucket.add(doorTex, xform(GEO.box, 0, 1.16, D / 2 - T / 2, 0, 0, 0, 1.15, 2.32, 0.06)); // hoja cerrada en el vano
        bucket.add('iron', xform(GEO.sphere, 0.42, 1.15, D / 2 - T / 2 + 0.08, 0, 0, 0, 0.07, 0.07, 0.07));
        cols.push({ x: 0, z: D / 2 - T / 2, hw: 0.6, hd: T / 2, h: 2.3 }); // el vano sellado bloquea el paso, como una pared
      } else {
        cols.push({ x: 0, z: D / 2 - T / 2, hw: 0.6, hd: T / 2, h: 2.3, door: true }); // colisionador de la hoja cerrada: world.js lo retira al abrir
      }
      // sarcófago central
      bucket.add(mk, xform(GEO.box, 0, 0.36, -0.35, 0, 0, 0, 1.05, 0.72, 2.2));
      bucket.add(mk, xform(GEO.box, 0, 0.775, -0.35, 0, 0, 0, 1.18, 0.14, 2.34));
      bucket.add(mk, xform(GEO.box, 0, 0.98, -0.35, 0, 0, 0, 0.14, 0.5, 0.14));
      bucket.add(mk, xform(GEO.box, 0, 1.06, -0.33, 0, 0, 0, 0.44, 0.14, 0.14)); // travesaño 2 cm en relieve (v68): con el mismo fondo que el mástil, sus caras frontales eran coplanares y peleaban en el cruce
      cols.push({ x: 0, z: -0.35, hw: 0.56, hd: 1.12, h: 0.9 });
      // nichos interiores con placa legible: paredes laterales y fondo
      var ni = 0, famSlot = 1; // la casilla 0 del atlas familiar es la placa principal (el fundador); los nichos consumen las siguientes en orden de colocación
      function niche(nx, ny, nz, nry) {
        bucket.add('door', xform(GEO.box, nx, ny, nz, nry, 0, 0, 0.66, 0.84, 0.07));
        var px2 = nx + Math.sin(nry) * 0.05, pz2 = nz + Math.cos(nry) * 0.05;
        if (family && famSlot < FAM_N) {
          // placa de UN MIEMBRO de la familia de este panteón (v70):
          // atlas propio del chunk (material plaqueFam), persona
          // propia para la lectura — ya no un desconocido del pool
          var fs = famSlot++;
          bucket.add('plaqueFam', xform(plaqueGeoGrid(0.46, 0.6, fs, FAM_COLS, FAM_ROWS), px2, ny, pz2, nry));
          tombsIn.push({ lx: px2, lz: pz2, plaqueIdx: fs, person: family.slots[fs], nx: Math.sin(nry), nz: Math.cos(nry) });
          ni++;
          return;
        }
        var idx = (plaqueIdx + 1 + ni * 7) % PLAQUE_N; ni++;
        bucket.add('plaque', xform(plaqueGeo(0.46, 0.6, idx), px2, ny, pz2, nry));
        tombsIn.push({ lx: px2, lz: pz2, plaqueIdx: idx, nx: Math.sin(nry), nz: Math.cos(nry) }); // normal de la cara con la inscripción
      }
      /* PLACAS × VENTANA (v61, reporte de Guille 14:10: «en el interior
         se generan muchas placas de difuntos y pueden tapar la
         ventana»): la fila de nichos laterales va a y = 1,55 con caja
         de 0,66 × 0,84 — su banda vertical (1,13…1,97) SIEMPRE cruza
         la de la ventana (1,32…2,38) — y el nicho central (nz = 0)
         cae sobre el hueco (zc = −0,20, ancho 0,84: z −0,62…0,22):
         su caja ocupaba z −0,33…0,33, tapando más de la mitad del
         paño y cortando el haz que entra. REGLA: en una pared CON
         ventana, ningún nicho cuyo rectángulo — dilatado 6 cm por
         lado, el resguardo del marco — invada el rectángulo de la
         ventana se coloca en esa pared; la pared lleva dos nichos
         (los de los extremos, que no la tocan) en vez de tres, como
         en los panteones reales, donde la ventana manda sobre la
         pared que la lleva. Con UNA sola ventana (v64) la regla
         muerde solo en SU pared; la otra fila queda completa. */
      function nicheRow(nx, nry, hasWin) {
        [-1.15, 0, 1.15].forEach(function (nz) {
          if (hasWin && Math.abs(nz - WIN.zc) < WIN.w / 2 + 0.33 + 0.06) return; // invadiría la ventana: no se coloca
          niche(nx, 1.55, nz, nry);
        });
      }
      nicheRow(-W / 2 + T + 0.02, Math.PI / 2, !!(WIN && WIN.side < 0));
      nicheRow(W / 2 - T - 0.02, -Math.PI / 2, !!(WIN && WIN.side > 0));
      [-1.3, 0, 1.3].forEach(function (nx) { niche(nx, 1.6, -D / 2 + T + 0.02, 0); });
      // placa principal junto a la puerta: con familia (v70) es la
      // del FUNDADOR, casilla 0 del atlas familiar; sin familia, la
      // del pool general de siempre
      if (family) {
        bucket.add('plaqueFam', xform(plaqueGeoGrid(0.56, 0.68, 0, FAM_COLS, FAM_ROWS), 1.5, 1.75, D / 2 + 0.02, 0));
        tombsIn.push({ lx: 1.5, lz: D / 2 + 0.55, plaqueIdx: 0, person: family.slots[0], nx: 0, nz: 1 });
      } else if (plaqueIdx != null) {
        bucket.add('plaque', xform(plaqueGeo(0.56, 0.68, plaqueIdx), 1.5, 1.75, D / 2 + 0.02, 0));
        tombsIn.push({ lx: 1.5, lz: D / 2 + 0.55, plaqueIdx: plaqueIdx, nx: 0, nz: 1 });
      }
      // la ventana sorteada viaja al chunk: world.js la pasa a la ley
      // de luz interior (su ángulo sólido × transmitancia se suma al
      // de la puerta) y al haz. trans = la fracción difusa que el
      // cristal deja pasar a incidencia normal según su tipo
      // (materials.js). side = la pared local que la lleva (±1).
      // maus = la planta de ESTE panteón (v64): la cavidad real para
      // la luz interior, el haz y la lectura.
      var winInfo = WIN ? { key: winGlass, zc: WIN.zc, side: WIN.side, area: WIN.w * (WIN.top - WIN.sill), trans: winGlass === 'glassThin' ? 0.92 : (winGlass === 'glassThick' ? 0.80 : 0.45) } : null;
      return { colliders: cols, tombs: tombsIn, win: winInfo, door: doorInfo, maus: { W: W, D: D, H: H, big: big, mk: mk } };
    }

    function buildAngel(bucket, rng) {
      var mk = 'light';
      bucket.add(mk, xform(GEO.box, 0, 0.3, 0, 0, 0, 0, 0.95, 0.6, 0.95));
      bucket.add(mk, xform(GEO.box, 0, 0.72, 0, 0, 0, 0, 0.7, 0.27, 0.7));
      // túnica: perfil torneado
      var pts = [];
      pts.push(new THREE.Vector2(0.30, 0));
      pts.push(new THREE.Vector2(0.27, 0.25));
      pts.push(new THREE.Vector2(0.17, 0.62));
      pts.push(new THREE.Vector2(0.15, 0.95));
      pts.push(new THREE.Vector2(0.19, 1.12));
      pts.push(new THREE.Vector2(0.10, 1.2));
      var robe = new THREE.LatheGeometry(pts, 11);
      bucket.add(mk, xform(robe, 0, 0.84, 0, 0));
      bucket.add(mk, xform(GEO.sphere, 0, 2.2, 0, 0, 0, 0, 0.30, 0.34, 0.30));        // cabeza
      bucket.add(mk, xform(GEO.box, -0.30, 1.78, -0.10, 0.15, 0, 0.5, 0.10, 0.85, 0.42)); // alas
      bucket.add(mk, xform(GEO.box, 0.30, 1.78, -0.10, -0.15, 0, -0.5, 0.10, 0.85, 0.42));
      return { hw: 0.5, hd: 0.5, h: 2.4 };
    }

    function buildFence(bucket, x0, z0, x1, z1) {
      var dx = x1 - x0, dz = z1 - z0;
      var len = Math.sqrt(dx * dx + dz * dz), ang = Math.atan2(dx, dz);
      var n = Math.floor(len / 0.55);
      for (var i = 0; i <= n; i++) {
        var t = i / n, px = x0 + dx * t, pz = z0 + dz * t;
        bucket.add('iron', xform(GEO.box, px, 0.5 - SEAT_SINK, pz, ang, 0, 0, 0.065, 1.0, 0.065)); // poste más grueso que el riel (v68): con 0,045 contra 0,05 del riel, sus caras laterales quedaban a 2,5 mm de las del riel dentro del cruce — casi coplanares
        bucket.add('iron', xform(GEO.pyramid, px, 1.06 - SEAT_SINK, pz, ang, 0, 0, 0.09, 0.14, 0.09));
      }
      var mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      bucket.add('iron', xform(GEO.box, mx, 0.88 - SEAT_SINK, mz, ang, 0, 0, 0.05, 0.05, len));
      bucket.add('iron', xform(GEO.box, mx, 0.3 - SEAT_SINK, mz, ang, 0, 0, 0.05, 0.05, len));
    }
