/* utils.js — RNG determinista, hash de chunks y helpers (clamp/lerp).
   Sin dependencias. Lo usa todo el resto de módulos. */
'use strict';
    /* ================= Utilidades y RNG determinista ================= */
    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function hash2(x, y) {
      var h = (x * 374761393 + y * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    }
    function chunkRng(cx, cz) { return mulberry32(hash2(cx * 131 + 7, cz * 197 + 13) ^ 0x9e3779b9); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    function lerp(a, b, t) { return a + (b - a) * t; }

    /* ============ Vigilante de shaders: red de seguridad WebGL ============
       En algunos WebGL de escritorio (ANGLE/DirectX y ciertas GPU) un
       parche de shader válido en móvil puede no compilar. three guarda el
       veredicto en material.diagnostics.runnable: si es false, el programa
       no sirve. validateShaders() recorre la escena y, por cada material
       roto, lo devuelve a su forma ESTÁNDAR con sus texturas (sin parche)
       o ejecuta su restauración registrada (cielo, estrellas). La escena
       nunca queda negra ni sin color por un shader: degrada, no rompe. */
    var ASSET_V = '?v=34'; // etiqueta de caché: súbela en cada build para invalidar copias viejas
    /* ============ Base de assets: SIEMPRE local y relativa ============
       A pedido expreso del usuario: todos los assets son archivos del
       propio paquete y NINGUNA carga sale a internet. Por eso la base
       es, sin excepción, la ruta relativa «assets/»:
       - Las 12 fotos (texturas de suelo/senderos/corteza, pizarra y la
         foto de la luna) van EMBEBIDAS como data: URI en texdata.js:
         ni siquiera generan una petición; se decodifican en la página.
       - El resto (scripts, CSS, audios y el modelo xbot.glb) se pide
         por su ruta relativa del paquete. En el cliente de PC (página
         blob:) el túnel interno intercepta esas rutas relativas y las
         sirve desde el paquete local; en móvil/web resuelven contra el
         propio origen del artefacto. Nunca se construye una URL
         http(s) absoluta: las derivaciones anteriores desde
         performance entries / script.src / location.href se quitaron
         justamente para que ningún fetch pueda salir a una dirección
         de internet.
       - El Xbot se pide con fetch(cadena relativa) y se parsea desde
         el ArrayBuffer (player.js): GLTFLoader.load() no se usa porque
         construye `new Request(url)`, que lanza contra la base blob:.
       TODA carga de assets por código pasa por assetUrl(). */
    var ASSET_BASE = 'assets/';
    function assetUrl(name) {
      return ASSET_BASE + name + ASSET_V;
    }
    /* Fotos embebidas en el paquete (texdata.js): data: URI servida sin
       NINGUNA petición de red. Es la vía principal de las texturas del
       suelo/senderos/corteza/pizarra/luna: la VPN del usuario bloqueaba
       las peticiones de imágenes en PC y el suelo quedaba negro; sin
       petición, no hay nada que bloquear. */
    function texDataUrl(name) {
      try { if (typeof EMBEDDED_TEX !== 'undefined' && EMBEDDED_TEX && EMBEDDED_TEX[name]) return EMBEDDED_TEX[name]; } catch (e) {}
      return null;
    }
    // Los <audio> del HTML traen rutas relativas escritas: se reescriben
    // a absolutas y se recargan, por la misma razón blob:.
    (function fixAudioSources() {
      var sources = document.querySelectorAll('audio source');
      for (var i = 0; i < sources.length; i++) {
        var rel = sources[i].getAttribute('src') || '';
        if (rel.indexOf('assets/') === 0) {
          sources[i].src = assetUrl(rel.slice(7).split('?')[0]);
          var au = sources[i].parentNode;
          if (au && au.load) { try { au.load(); } catch (e) {} }
        }
      }
    })();
    var SHADER_WATCH = [];
    var shaderFallbackCount = 0;
    var pendingShaderCheck = false;
    function watchShader(mat, restore) { SHADER_WATCH.push({ mat: mat, restore: restore || null }); }
    function stripToStandard(mat) {
      mat.onBeforeCompile = function () {};
      mat.customProgramCacheKey = function () { return 'fallback-std'; };
      mat.needsUpdate = true;
    }
    function validateShaders() {
      if (typeof scene === 'undefined' || !scene) return;
      var seen = {};
      scene.traverse(function (o) {
        var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          if (!m || seen[m.uuid]) continue;
          seen[m.uuid] = 1;
          var d = m.diagnostics;
          if (d && d.runnable === false && !m.__fellBack) {
            m.__fellBack = true;
            shaderFallbackCount++;
            var w = null;
            for (var j = 0; j < SHADER_WATCH.length; j++) if (SHADER_WATCH[j].mat === m) w = SHADER_WATCH[j];
            if (w && w.restore) w.restore();
            else if (!m.isShaderMaterial) stripToStandard(m);
          }
        }
      });
    }
