/* deco.js — Decoración descargada de internet (v72, pedido de
   Guille 2026-11-22 20:42: «descarga modelos de ángeles y cosas así
   de panteones en internet para ubicar aleatoriamente a modo de
   decoración»), aplicando el informe
   research_notes/modelos-angeles-panteones-20261122-2342 §5:
   · ÁNGEL HÉROE: «Cathedral angel» de Polyfork (CC BY 4.0 — crédito
     en la ayuda del juego), GLB de 4.944 tris. El original viene
     riggeado con animaciones (2,08 MB); en build se horneó el
     skinning en la pose de reposo y se soldaron los vértices:
     estatua estática de 222 KB, 2,03 m de alto, sin texturas (el
     material lo pone la piedra del chunk, como manda el informe).
   · CRUCES: «Cross» (158 tris) y «Gravestone Cross» (222 tris) del
     Graveyard Kit de Kenney (CC0), GLB tal cual salen del kit.
   La carga sigue el canal del ciprés (trees.js): fetch por cadena +
   GLTFLoader.parse() desde el ArrayBuffer. Al parsear se extrae UNA
   geometría fusionada por modelo (solo position/normal/uv, la base
   en y = 0 y el centro en x/z = 0) y world.js la clona en los
   buckets de cada chunk con su rng propio de decoración: el ángel
   corona algunos techos de panteón y las cruces acompañan algunas
   tumbas. Si la carga falla, el cementerio queda como siempre.
   Depende de: three (GLTFLoader), utils (assetUrl). */
'use strict';
    var DECO = { ready: false, angel: null, cross: null, grave: null, angelH: 2.03 };

    function decoFetchBuffer(name) {
      var url = assetUrl(name);
      return fetch(url).then(function (r) {
        if (r && r.ok === false && r.status !== 0) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).catch(function (err) {
        if (window.__tunnel && typeof __tunnel.resolveToBlobUrl === 'function') {
          return __tunnel.resolveToBlobUrl(url).then(function (b) { return fetch(b); }).then(function (r2) { return r2.arrayBuffer(); });
        }
        throw err;
      });
    }
    function decoStrip(geo) {
      var keep = { position: 1, normal: 1, uv: 1 };
      for (var name in geo.attributes) if (!keep[name]) geo.deleteAttribute(name);
      if (!geo.attributes.uv) { // los buckets fusionan por atributos: sin uv no hay fusión posible
        var n = geo.attributes.position.count, uvs = new Float32Array(n * 2);
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      }
      return geo;
    }
    function decoExtract(gltf) {
      var geos = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(function (o) {
        if (!o.isMesh) return;
        geos.push(decoStrip(o.geometry.clone().applyMatrix4(o.matrixWorld)));
      });
      if (!geos.length) return null;
      var merged = geos.length === 1 ? geos[0] : THREE.BufferGeometryUtils.mergeGeometries(geos, false);
      if (!merged) return null;
      /* Los GLB traen geometría INDEXADA y los buckets de chunk
         fusionan geometrías NO indexadas (toda pieza procedural y
         el ciprés pasan por xform(), que desindexa). Sin este paso
         la cruz/lápida/ángel entraban indexados al bucket, la fusión
         devolvía null («index attribute exists among all geometries,
         or in none») y el chunk nacía con una malla de geometría null
         que rompía el render al leer geometry.morphAttributes —
         el juego no cargaba (regresión v72, reporte de Guille
         2026-11-22 18:05). Se desindexa aquí, en la extracción,
         para que DECO cumpla el mismo contrato que el ciprés. */
      if (merged.index) merged = merged.toNonIndexed();
      merged.computeBoundingBox();
      var bb = merged.boundingBox;
      merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      merged.computeBoundingBox();
      return { geo: merged, h: merged.boundingBox.max.y - merged.boundingBox.min.y };
    }
    function decoLoadOne(name, targetH) {
      return decoFetchBuffer(name).then(function (buf) {
        return new Promise(function (res) {
          new THREE.GLTFLoader().parse(buf, '', function (gltf) {
            var ex = null;
            try {
              ex = decoExtract(gltf);
              if (ex && targetH && ex.h > 0.01) { // el kit no garantiza escala real: se normaliza a la altura pedida
                var s = targetH / ex.h;
                ex.geo.scale(s, s, s);
                ex.h = targetH;
              }
            } catch (e) { ex = null; }
            res(ex);
          }, function () { res(null); });
        });
      }).catch(function () { return null; });
    }
    function loadDeco(attempt) {
      if (!THREE.GLTFLoader) return;
      Promise.all([decoLoadOne('angel.glb', 0), decoLoadOne('cross.glb', 1.0), decoLoadOne('gravestone-cross.glb', 1.1)]).then(function (r) {
        if (r[0]) { DECO.angel = r[0].geo; DECO.angelH = r[0].h; }
        if (r[1]) DECO.cross = r[1].geo;
        if (r[2]) DECO.grave = r[2].geo;
        DECO.ready = !!(DECO.angel || DECO.cross || DECO.grave);
        if (DECO.ready && typeof scheduleRegen === 'function') scheduleRegen(false); // los chunks ya nacidos se rehacen con la decoración puesta
      }).catch(function () {
        if (attempt < 2) setTimeout(function () { loadDeco(attempt + 1); }, 1500 * (attempt + 1));
      });
    }
    try { loadDeco(0); } catch (e) { /* sin decoración descargada: el cementerio procedural de siempre */ }
