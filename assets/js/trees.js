/* trees.js — Ciprés italiano REAL: modelo «Young Italian Cypress» de
   tevy (CC0), con su cadena de LOD publicada (LOD0 7.048 tris,
   LOD1 3.848 tris, LOD2 1.070 tris; ~9 m de alto real). Los GLB
   originales vienen con compresión meshopt y texturas KTX2, que el
   GLTFLoader clásico del paquete no decodifica: en build se
   convirtieron a GLB planos (geometría desquantizada, texturas WebP)
   con glTF-Transform y la herramienta KTX de Khronos, y esos son los
   archivos cypress_lod0/1/2.glb de assets/.
   La carga sigue el canal del Xbot (player.js): fetch por cadena +
   GLTFLoader.parse() desde el ArrayBuffer — GLTFLoader.load() no se
   usa porque construye un Request que lanza contra la base blob:.
   Al parsear se extraen, por LOD, la geometría del tronco+ramas y la
   del follaje (con su textura de recorte alfa) ya normalizadas con la
   base en y=0; world.js las funde en los buckets de cada chunk como
   cualquier otra geometría (cerca: LOD0/LOD1; lejos: LOD2). Si la
   carga falla, los árboles quedan procedurales, como siempre.
   Depende de: three (GLTFLoader), utils (assetUrl), materials (MAT). */
'use strict';
    var CYPRESS = { ready: false, tex: null, bark: [null, null, null], leaves: [null, null, null] };

    function cypressFetchBuffer(name) {
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
    function cypressStrip(geo) {
      // solo position/normal/uv: los buckets fusionan geometrías y
      // exigen los mismos atributos que las procedurales (fuera
      // COLOR_0, _WIND y cualquier extra del GLB)
      var keep = { position: 1, normal: 1, uv: 1 };
      for (var name in geo.attributes) if (!keep[name]) geo.deleteAttribute(name);
      return geo;
    }
    function cypressExtract(gltf) {
      var barkGeos = [], leavesGeos = [], leavesTex = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(function (o) {
        if (!o.isMesh) return;
        var mat = o.material || {};
        var isLeaves = (mat.alphaMode === 'MASK' || mat.alphaMode === 'BLEND' || /leav/i.test(mat.name || ''));
        var g = cypressStrip(o.geometry.clone().applyMatrix4(o.matrixWorld));
        if (isLeaves) { leavesGeos.push(g); if (!leavesTex && mat.map) leavesTex = mat.map; }
        else barkGeos.push(g);
      });
      if (!barkGeos.length || !leavesGeos.length) return null;
      var bark = THREE.BufferGeometryUtils.mergeGeometries(barkGeos, false);
      var leaves = THREE.BufferGeometryUtils.mergeGeometries(leavesGeos, false);
      // base en y=0 (el modelo trae la raíz ~0,2 m bajo el origen)
      bark.computeBoundingBox(); leaves.computeBoundingBox();
      var minY = Math.min(bark.boundingBox.min.y, leaves.boundingBox.min.y);
      bark.translate(0, -minY, 0); leaves.translate(0, -minY, 0);
      return { bark: bark, leaves: leaves, tex: leavesTex };
    }
    function loadCypress(attempt) {
      if (!THREE.GLTFLoader) return;
      var names = ['cypress_lod0.glb', 'cypress_lod1.glb', 'cypress_lod2.glb'];
      var jobs = names.map(function (name, idx) {
        return cypressFetchBuffer(name).then(function (buf) {
          return new Promise(function (res, rej) {
            new THREE.GLTFLoader().parse(buf, '', function (gltf) {
              var ex = null;
              try { ex = cypressExtract(gltf); } catch (e) { ex = null; }
              if (ex) { CYPRESS.bark[idx] = ex.bark; CYPRESS.leaves[idx] = ex.leaves; if (idx === 0 && ex.tex) { CYPRESS.tex = ex.tex; cypressApplyTex(ex.tex); } }
              res();
            }, function (err) { rej(err); });
          });
        });
      });
      Promise.all(jobs).then(function () {
        if (CYPRESS.bark[0] && CYPRESS.bark[1] && CYPRESS.bark[2] && CYPRESS.leaves[2]) {
          CYPRESS.ready = true;
          // si la vegetación ya está activada, los chunks se rehacen
          // con el modelo real; si no, entrará solo al subir el slider
          if (typeof SETTINGS !== 'undefined' && SETTINGS.trees > 0 && typeof scheduleRegen === 'function') scheduleRegen(false);
        }
      }).catch(function () {
        if (attempt < 2) setTimeout(function () { loadCypress(attempt + 1); }, 1500 * (attempt + 1));
      });
    }
    function cypressApplyTex(tex) {
      if (typeof MAT === 'undefined' || !MAT.cypress) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      MAT.cypress.map = tex;
      MAT.cypress.alphaTest = 0.45; // recorte alfa del follaje (MASK del GLB), sin blending: sin coste de ordenación
      MAT.cypress.color.set(0xffffff);
      MAT.cypress.needsUpdate = true;
    }
    try { loadCypress(0); } catch (e) { /* quedan los cipreses procedurales */ }
