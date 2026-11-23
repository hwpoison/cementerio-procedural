/* sky.js — Cielo vivo: nubes volumétricas 3D que derivan con el viento,
   luna con fases reales sincronizadas con la fecha, disco del sol con
   halo, estrellas de cielo despejado y lluvia visible.
   Depende de: scene, utils. Lo usa: weather (updateEnvironment). */
'use strict';
    function puffTexture() {
      var c = document.createElement('canvas'); c.width = 256; c.height = 256;
      var x = c.getContext('2d');
      var r = mulberry32(31337);
      for (var i = 0; i < 16; i++) {
        var gx = 40 + r() * 176, gy = 88 + r() * 80, gr = 26 + r() * 52;
        var g = x.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
      }
      return new THREE.CanvasTexture(c);
    }
    /* (La textura de racha para puntos se retiró con el render nuevo de
       lluvia: segmentos de línea, ver el bloque de lluvia al final.) */
    /* NUBES VOLUMÉTRICAS 3D: ELIMINADAS a pedido (2026-11-22). Queda solo
       la capa de nubes del shader del cielo (scene.js), que es la que
       atenúa sol y luna con T = exp(−τ), la que mueve el control de
       densidad τ y la del borde plateado lunar. Sin mallas 3D de nube:
       ni su costo de dibujo, ni oclusión por blobs, ni sombras
       proyectadas por blobs — la luz sigue saliendo de la única
       tubería (campo del cielo + τ del modelo). */
    /* NUBE DE PRUEBA (debug): un único sprite con la textura de las nubes
       reales que weather.js coloca frente al sol o la luna para probar la
       oclusión a demanda. Es solo un overlay de prueba: no toca el campo
       de nubes, el clima ni el modelo climático; su atenuación entra por
       la misma ley T = exp(−τ) en weather.js. */
    function testCloudTexture() {
      var c = document.createElement('canvas'); c.width = 256; c.height = 256;
      var x = c.getContext('2d');
      var rr = mulberry32(777);
      /* VOLUMEN HORNEADO EN 2D (volumen simulado, sin mallas): la
         textura ya trae la física que el informe test-cloud pide —
         (1) GRADIENTE POR PROFUNDIDAD: cada soplo se tiñe por su
         altura en la masa: copas claras (la luz les llega casi
         directa) a vientre casi negro (la luz sobrevivió todo el
         viaje: con τ del núcleo ≥15–20 no llega nada); (2) NORMALES
         FALSAS horneadas: los bultos altos reciben un toque claro
         extra, como relieve iluminado desde arriba/sol; (4) BORDE
         NÍTIDO: el degradado de cada soplo cae en el último 45 % del
         radio (antes caía en todo el radio: la masa era una mancha
         difusa y el sol se veía a través, captura del usuario). La
         base es PLANA y oscura, como un cúmulo visto desde abajo. */
      for (var i = 0; i < 46; i++) {
        var a = rr() * Math.PI * 2, rad = Math.pow(rr(), 0.6) * 62;
        var gx = 128 + Math.cos(a) * rad * 1.25, gy = 138 + Math.sin(a) * rad * 0.55 - rad * 0.18;
        var gr = 24 + rr() * 38;
        var top = clamp((168 - gy) / 120, 0, 1);
        var lit = Math.pow(top, 1.35);
        var cr = Math.round(24 + lit * 178), cg = Math.round(28 + lit * 182), cb = Math.round(38 + lit * 186);
        var g = x.createRadialGradient(gx, gy, 1, gx, gy, gr);
        g.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.52)');
        g.addColorStop(0.55, 'rgba(' + cr + ',' + cg + ',' + cb + ',0.47)');
        g.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
        x.fillStyle = g; x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
      }
      // base plana y oscura: el vientre del cúmulo, sin luz directa
      var gb = x.createRadialGradient(128, 198, 4, 128, 198, 96);
      gb.addColorStop(0, 'rgba(16,18,26,0.62)'); gb.addColorStop(0.7, 'rgba(16,18,26,0.34)'); gb.addColorStop(1, 'rgba(16,18,26,0)');
      x.save(); x.translate(128, 198); x.scale(1, 0.30); x.translate(-128, -198);
      x.fillStyle = gb; x.beginPath(); x.arc(128, 198, 96, 0, Math.PI * 2); x.fill(); x.restore();
      // copas iluminadas: toques claros sobre los bultos altos (el
      // relieve que captura la luz del sol, horneado como normal falsa)
      for (var j = 0; j < 12; j++) {
        var hx = 52 + rr() * 150, hy = 62 + rr() * 52, hr = 12 + rr() * 20;
        var hg2 = x.createRadialGradient(hx, hy, 1, hx, hy, hr);
        hg2.addColorStop(0, 'rgba(238,244,252,0.30)'); hg2.addColorStop(1, 'rgba(238,244,252,0)');
        x.fillStyle = hg2; x.beginPath(); x.arc(hx, hy, hr, 0, Math.PI * 2); x.fill();
      }
      return new THREE.CanvasTexture(c);
    }
    var testCloudTex = testCloudTexture();
    var testCloudSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: testCloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    testCloudSprite.scale.set(56, 56, 1);
    testCloudSprite.visible = false;
    scene.add(testCloudSprite);
    /* CAPA TRASERA con paralaje (volumen simulado, punto 3): la misma
       masa un poco más grande, más oscura y corrida hacia abajo —
       la «base en sombra» detrás del frente iluminado. weather.js la
       coloca unos metros más lejos y con un pelín de retraso en el
       barrido: al moverse la nube, frente y fondo no se mueven
       idénticos y el ojo lee profundidad sin una sola malla 3D. */
    var testCloudBack = new THREE.Sprite(new THREE.SpriteMaterial({ map: testCloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    testCloudBack.scale.set(74, 74, 1);
    testCloudBack.visible = false;
    scene.add(testCloudBack);
    /* Resplandor del borde: el mismo cuerpo un poco más grande, en
       aditivo y dorado — el halo que escapa por el contorno cuando la
       nube tapa el sol parcialmente (bordes dorados de la foto). Su
       opacidad la manda weather.js con el factor de borde (máximo con
       el tapado parcial, cero con el total o sin nube). */
    var testCloudGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: testCloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, color: 0xffb45e }));
    testCloudGlow.scale.set(66, 66, 1);
    testCloudGlow.visible = false;
    scene.add(testCloudGlow);
    /* Viento del momento: dirección casi constante (del oeste, con deriva
       al sur) y velocidad según el clima — brisa suave en soleado, viento
       fuerte en lluvia y rachas en tormenta. Las nubes se mueven con él. */
    var WIND = { dirX: -0.707, dirZ: -0.707, speed: 3 }; // dirección inicial: sopla del NE hacia el SO (viento predominante de Córdoba)
    /* ================= Luna y sus fases =================
       Fase real sin red: edad lunar desde la luna nueva de referencia del
       6-ene-2000 18:14 UTC, módulo el mes sinódico (29,530588853 días).
       Fracción iluminada k = (1 − cos(2π·edad/mes)) / 2: nueva 0, cuarto
       0,5, llena 1. El selector del debug puede forzar cualquiera de las
       8 fases; en Automática manda la fecha y hora del dispositivo. */
    var SYNODIC = 29.530588853;
    var NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
    var PHASE_NAMES = ['Nueva', 'Creciente', 'Cuarto creciente', 'Gibosa creciente', 'Llena', 'Gibosa menguante', 'Cuarto menguante', 'Menguante'];
    var MOON = { mode: 'auto', manual: 4, p: 0, age: 0, illum: 0, name: '—', elev: -54, upF: 0 };
    var moonChroma = { r: 1, g: 1, b: 1 }; // color por el CAMINO DE AIRE de la luna (weather.js): Rayleigh por masa de aire — la luna baja enrojece; la nube atenúa en gris y no entra aquí
    var moonAirT = { r: 1, g: 1, b: 1 }; // TRANSMITANCIA ABSOLUTA del camino de aire (weather.js, v58): matiz y MAGNITUD — el disco se apaga al bajar, no solo enrojece; sin ella el sprite brillaba igual a cualquier altura y se leía como imagen flotando
    function lunarAgeNow() {
      var days = (Date.now() - NEW_MOON_MS) / 86400000;
      var age = days % SYNODIC;
      if (age < 0) age += SYNODIC;
      return { age: age, p: age / SYNODIC };
    }
    // Disco lunar: canvas que se redibuja solo cuando la fase cambia.
    var moonCanvas = document.createElement('canvas');
    moonCanvas.width = 1024; moonCanvas.height = 1024; // 1024 (v58; antes 512): la foto es 1411×1424 — el disco conserva mares y cráteres al acercar la vista; el dibujo sigue en el espacio virtual de 512 con setTransform(2,…) en drawMoonPhase, así que ninguna coordenada cambia
    var moonCtx = moonCanvas.getContext('2d');
    var moonTex = new THREE.CanvasTexture(moonCanvas);
    var lastMoonP = -1, moonLabelTxt = '';
    /* Foto REAL de la luna casi llena (Luc Viatour, CC BY-SA 3.0, vía
       Wikimedia Commons; crédito en la Ayuda): es la textura del disco.
       Se carga en segundo plano; si falla, el disco se dibuja procedural
       como antes. */
    var moonPhoto = new Image();
    var moonPhotoOk = false;
    moonPhoto.onload = function () { moonPhotoOk = true; lastMoonP = -1; };
    moonPhoto.src = texDataUrl('moon.jpg') || assetUrl('moon.jpg'); // embebida primero: sin petición de red que una VPN pueda bloquear
    /* Fase VISIBLE muy abierta: la porción iluminada que se DIBUJA nunca
       baja del 74 % — siempre cercana a llena, nunca una creciente fina.
       (La fase real sigue mandando en la LUZ de la luna; esto es solo el
       disco que se ve.) */
    function displayPhase(p) {
      var illum = (1 - Math.cos(2 * Math.PI * p)) / 2;
      var illumD = 0.74 + 0.26 * illum;
      var half = Math.acos(clamp(1 - 2 * illumD, -1, 1)) / (2 * Math.PI);
      return p <= 0.5 ? half : 1 - half;
    }
    function moonLitPath(x, cx, cy, r, p) {
      var cosT = Math.cos(2 * Math.PI * p), rx = Math.abs(cosT) * r;
      x.beginPath();
      if (p <= 0.5) { // creciente: limbo derecho
        x.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
        x.ellipse(cx, cy, rx, r, 0, Math.PI / 2, Math.PI * 1.5, cosT > 0);
      } else { // menguante: limbo izquierdo
        x.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
        x.ellipse(cx, cy, rx, r, 0, Math.PI / 2, Math.PI * 1.5, cosT < 0);
      }
      x.closePath();
    }
    function drawMoonPhase(pReal) {
      var x = moonCtx, cx = 256, cy = 256, r = 208;
      var p = displayPhase(pReal);
      x.setTransform(2, 0, 0, 2, 0, 0); // lienzo real de 1024, dibujo en el espacio de 512 de siempre (v58)
      x.clearRect(0, 0, 512, 512);
      if (moonPhotoOk) {
        // luz cenicienta: la foto entera, apenas visible en la sombra
        x.save();
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
        x.globalAlpha = 0.13;
        x.drawImage(moonPhoto, cx - r * 1.05, cy - r * 1.05, r * 2.1, r * 2.1);
        x.restore();
        // la parte iluminada: la foto real a pleno brillo
        x.save();
        moonLitPath(x, cx, cy, r, p); x.clip();
        x.globalAlpha = 1;
        x.drawImage(moonPhoto, cx - r * 1.05, cy - r * 1.05, r * 2.1, r * 2.1);
        x.restore();
      } else {
        // reserva procedural (sin foto): degradado y mares como antes
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
        x.fillStyle = '#26303f'; x.fill();
        x.save();
        x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.clip();
        moonLitPath(x, cx, cy, r, p);
        var g = x.createRadialGradient(cx - 60, cy - 68, 24, cx, cy, r * 1.15);
        g.addColorStop(0, '#f5f8ff'); g.addColorStop(0.7, '#ccd8ea'); g.addColorStop(1, '#9db1c9');
        x.fillStyle = g; x.fill();
        x.fillStyle = 'rgba(88,108,140,0.20)';
        var craters = [[192, 184, 34], [300, 156, 22], [244, 296, 42], [332, 276, 18], [176, 336, 20], [292, 368, 26], [140, 240, 16]]; // coordenadas ×2 del canvas de 256
        for (var ci = 0; ci < craters.length; ci++) { x.beginPath(); x.arc(craters[ci][0], craters[ci][1], craters[ci][2], 0, Math.PI * 2); x.fill(); }
        x.restore();
      }
      // SIN aro pintado alrededor del disco (v58): el anillo claro de
      // antes dibujaba un contorno de pegatina — el limbo real es MÁS
      // OSCURO que el centro (oscurecimiento al limbo, ya presente en
      // la foto), nunca un filete brillante.
      moonTex.needsUpdate = true;
    }
    var moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    moonSprite.material.color.setRGB(2.3, 2.3, 2.3); // disco NEUTRO (v60) con BRILLO PROPIO (v61): el color del regolito YA viene en la foto; la ganancia uniforme 2,3 lo pone por encima del cielo como cuerpo luminoso SIN tocar el contraste interno — mares y cráteres conservan su razón de luminancia (ver updateMoonVisual)
    moonSprite.scale.set(95, 95, 1);
    moonSprite.visible = false;
    scene.add(moonSprite);
    var haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128; haloCanvas.height = 128;
    (function () {
      var hx = haloCanvas.getContext('2d');
      var hg = hx.createRadialGradient(64, 64, 4, 64, 64, 64);
      hg.addColorStop(0, 'rgba(190,208,240,0.15)'); hg.addColorStop(0.4, 'rgba(160,185,225,0.04)'); hg.addColorStop(1, 'rgba(160,185,225,0)'); // halo SUAVE y más tenue (v44): el degradado ya llegaba a 0 en el borde, pero su suma sobre el cielo casi negro dibujaba un disco visible alrededor de la luna; con menos pico acompaña al disco sin pintar un círculo
      hx.fillStyle = hg; hx.fillRect(0, 0, 128, 128);
    })();
    var moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(haloCanvas), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    moonHalo.scale.set(400, 400, 1);
    moonHalo.visible = false;
    scene.add(moonHalo);
    /* BRILLO DE LIMBO (v61, pedido de Guille 14:12: «un brillo
       alrededor de los bordes y un brillo interno también, pero que
       no tape la imagen — los mares y cráteres deben seguir
       viéndose»): un ANILLO aditivo pegado al limbo. Es luz de la
       luna dispersada en el aire junto al disco (la misma aureola,
       concentrada en el limbo), así que obedece a la misma cadena
       que el halo: fase, T de nubes y extinción del camino de aire.
       El brillo INTERNO lo da la ganancia uniforme del disco (2,3):
       escala todos los téxeles por igual y la razón mares/tierras
       altas — el contraste que dibuja la cara — queda intacta.
       GEOMETRÍA CORREGIDA (v62, reporte de Guille 14:43: «la luna
       se ve con un borde extraño»): el disco NO llena su sprite —
       en el lienzo se dibuja con r = 208 sobre un semilienzo de
       256, así que su limbo cae a 208/256 = 0,8125 del semiancho
       del sprite del disco, y como el sprite del anillo mide 1,5×
       ese, el limbo cae a 0,8125/1,5 = 0,542 del radio del lienzo
       del anillo. La v61 supuso el limbo a 0,667: su anillo nacía a
       0,55 (ya fuera del disco), tocaba a 0,615 (1,14 radios del
       disco) y picaba a 0,66 (1,22 radios) — un aro luminoso
       DESPEGADO del disco, con una franja oscura de cielo entre el
       limbo y el aro: el «borde extraño» de la captura. Ahora el
       perfil nace DENTRO de la cara (alfa 0 hasta 0,40 = 0,74
       radios; un toque de 0,10 a 0,50 = 0,92 radios, sobre el borde
       ya oscuro por el oscurecimiento al limbo de la foto), pica
       SUAVE (0,34) justo fuera del limbo (0,545) y decae sin
       escalón hasta 0 en el borde del sprite: del limbo hacia
       fuera el brillo es monótono decreciente — disco, limbo,
       resplandor — sin anillo separado ni franja oscura. */
    var rimCanvas = document.createElement('canvas');
    rimCanvas.width = 256; rimCanvas.height = 256;
    (function () {
      var rx2 = rimCanvas.getContext('2d');
      var rg2 = rx2.createRadialGradient(128, 128, 0, 128, 128, 128);
      rg2.addColorStop(0.0, 'rgba(255,255,255,0)');
      rg2.addColorStop(0.40, 'rgba(255,255,255,0)');
      rg2.addColorStop(0.50, 'rgba(255,255,255,0.10)');
      rg2.addColorStop(0.545, 'rgba(255,255,255,0.34)');
      rg2.addColorStop(0.62, 'rgba(255,255,255,0.16)');
      rg2.addColorStop(0.78, 'rgba(255,255,255,0.045)');
      rg2.addColorStop(1.0, 'rgba(255,255,255,0)');
      rx2.fillStyle = rg2; rx2.fillRect(0, 0, 256, 256);
    })();
    var moonRim = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rimCanvas), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    moonRim.visible = false;
    scene.add(moonRim);
    /* ================= Sol visible: disco + halo =================
       El Sky shader pinta el resplandor alrededor del sol, pero el disco
       en sí queda lavado. Estos dos sprites anclados a la dirección real
       del sol lo hacen inconfundible: un núcleo casi blanco, pequeño y
       durísimo, y un halo cálido amplio. Su brillo cae con la oclusión
       de las nubes (occ): cuando una nube tapa el sol, el disco se apaga
       igual que su luz. */
    var sunCanvas = document.createElement('canvas');
    sunCanvas.width = 256; sunCanvas.height = 256;
    (function () {
      var sx2 = sunCanvas.getContext('2d');
      var sg = sx2.createRadialGradient(128, 128, 2, 128, 128, 128);
      sg.addColorStop(0, 'rgba(255,255,246,1)');
      sg.addColorStop(0.10, 'rgba(255,246,214,0.98)');
      sg.addColorStop(0.16, 'rgba(255,226,160,0.55)');
      sg.addColorStop(0.38, 'rgba(255,205,120,0.16)');
      sg.addColorStop(1, 'rgba(255,195,105,0)');
      sx2.fillStyle = sg; sx2.fillRect(0, 0, 256, 256);
    })();
    var sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunCanvas), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    sunSprite.scale.set(350, 350, 1);
    sunSprite.visible = false;
    scene.add(sunSprite);
    var sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sunCanvas), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    sunCore.scale.set(120, 120, 1);
    /* Factores de tamaño angular REAL (weather.js, desde la órbita):
       1 = tamaño medio (sol 32,0′, luna 31,1′). El núcleo del sol y el
       disco de la luna escalan con el diámetro aparente de la época —
       el sol, ±3,4 % anual; la luna, hasta ±7 % en su mes anomalístico. */
    var sunThetaF = 1, moonThetaF = 1;
    sunCore.visible = false;
    scene.add(sunCore);
    /* Resplandor EN LA CÁMARA al mirar el sol (a pedido): una capa DOM
       a pantalla completa con un degradado cálido centrado donde el sol
       se proyecta en pantalla. Su fuerza crece con la alineación entre
       la mirada y el sol (al encuadrarlo de frente, el resplandor lava
       la imagen como en una foto real) y cae con la oclusión de nubes
       vía visF. Sin sol a la vista, opacidad 0. */
    var sunGlareEl = document.getElementById('sunGlare');
    var _glareFwd = new THREE.Vector3(), _glareProj = new THREE.Vector3();
    function updateSunGlare(visF) {
      if (!sunGlareEl) return;
      var g = 0, gx = 50, gy = 50;
      if (visF > 0.01) {
        camera.getWorldDirection(_glareFwd);
        var align = _glareFwd.dot(sunDir);
        if (align > 0.70) { // v67: cono estrecho (antes 0,35 ≈ 69° de semicono: el velo estaba presente mirando a medio cielo, «resplandor permanente» del reporte tras la v66; un velo de lente solo aparece cuando la fuente está en el encuadre o a su borde — a partir de ~45° de la mirada)
          _glareProj.copy(sunDir).multiplyScalar(120).add(camera.position).project(camera);
          if (_glareProj.z < 1) {
            gx = (_glareProj.x * 0.5 + 0.5) * 100;
            gy = (-_glareProj.y * 0.5 + 0.5) * 100;
            g = Math.pow(clamp((align - 0.70) / 0.30, 0, 1), 1.7) * visF * clamp(sunGlow, 0.4, 1.6);
          }
        }
      }
      sunGlareEl.style.opacity = g > 0.01 ? String(clamp(g * 0.11, 0, 0.11)) : '0'; // v67: techo 0,11 (v54: 0,16; antes 0,42) — el resplandor de cámara es un VELO sobre la foto, no una fuente de luz: con 0,42 y alfa central 0,95 levantaba todo el entorno del sol a un blanco lechoso de decenas de grados y la figura del disco (0,53°) se perdía dentro; en las fotos reales de atardecer el velo de lente es tenue frente al disco y el disco manda
      if (g > 0.01) {
        sunGlareEl.style.setProperty('--gx', gx + '%'); sunGlareEl.style.setProperty('--gy', gy + '%');
        // el resplandor de cámara se tiñe con el color del disco (transmitancia):
        // al ocaso es NARANJA, no blanco — el degradado se reconstruye solo
        // cuando el color cambia de forma apreciable (bucket por elevación)
        var gb = Math.round(sunDir.y * 40);
        if (gb !== updateSunGlare._gb) {
          updateSunGlare._gb = gb;
          sunSimColor(SUNSIM.disc, Math.asin(clamp(sunDir.y, -1, 1)) * 180 / Math.PI, _sunTint);
          var gs = _sunTint.getStyle();
          sunGlareEl.style.background = 'radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), ' + gs.replace('rgb', 'rgba').replace(')', ',0.55)') + ' 0%, ' + gs.replace('rgb', 'rgba').replace(')', ',0.20)') + ' 16%, ' + gs.replace('rgb', 'rgba').replace(')', ',0.06)') + ' 40%, rgba(255,196,105,0) 68%)'; // alfas del velo reducidos con el techo (v54): 0,95/0,40/0,13 → 0,55/0,20/0,06
        }
      }
    }
    /* ============ SIMULACIÓN DE AMANECER / ATARDECER (física real) ============
       Investigado el 2026-11-22 (informe sunrise-sunset): el atardecer es
       una RESTA, no una luz nueva. Con el sol bajo, su luz cruza hasta
       ~38 masas de aire (Kasten & Young: m = 2,0 a 30°, 10,3 a 5°, 37,9 en
       el horizonte) en vez de 1, y el aire dispersa el azul ~4,5–5,9× más
       que el rojo (Rayleigh, ∝ 1/λ⁴): por Beer–Lambert T = exp(−τ·m) en el
       horizonte sobrevive ~15 % del rojo y ~0,02 % del azul — el disco se
       vuelve naranja/rojo SOLO, sin aerosoles. El cenit sigue azul porque
       su camino es corto y porque el ozono (banda de Chappuis, ~600 nm)
       absorbe naranja/rojo en el camino rasante (Hulburt 1953: sin ozono
       el cenit crepuscular sería GRIS). Las nubes toman el color de la luz
       que les llega (dispersión de Mie casi neutra): blancas al mediodía,
       naranjas al ocaso, rosas tras la puesta si su altura sigue al sol.
       Estas tablas son los keyframes del informe (§3): colores del disco
       medidos en simulador físico (The Science 360) y cenit/horizonte/
       nube/niebla calibrados desde esos mismos datos — se interpolan por
       ELEVACIÓN del sol, no por hora. Fuentes: thescience360.com,
       explorehall.com, blog.maximeheckel.com, Wikipedia (Twilight). */
    var SUNSIM_ELEV = [10, 5, 0, -2, -6];
    var SUNSIM = {
      disc:   [0xffd18b, 0xffb54f, 0xff4e00, 0xd94f30, 0x7a4a6a], // color del DISCO por transmitancia exp(−τ·m)
      zenith: [0x4a7ac2, 0x3d6cb8, 0x334e8a, 0x2a3f73, 0x1b2a52], // azul que se profundiza (ozono al final)
      horSun: [0xffc46b, 0xff9e3d, 0xff5a00, 0xc94a3a, 0x7a4a6a], // banda hacia el sol: se angosta y enrojece
      horOpp: [0xb9c8de, 0xa8a8c8, 0x6b7a94, 0x4a5570, 0x232c4a], // opuesto: sombra de la Tierra gris-azul
      cloud:  [0xffd9a0, 0xffb25e, 0xff7a2e, 0xe86a5a, 0x7a6a9a], // nubes = color de la luz que las alcanza
      fog:    [0xe8c49a, 0xe8a56a, 0xd97a45, 0x8a5a5a, 0x3a4266], // niebla / perspectiva aérea
      band:   [10, 8, 5, 4, 1.8] // alto de la banda naranja del horizonte, en grados: se angosta al hundirse el sol
    };
    var _simC1 = new THREE.Color(), _simC2 = new THREE.Color();
    function sunSimColor(table, elev, out) {
      var s = SUNSIM_ELEV;
      if (elev >= s[0]) return out.setHex(table[0]);
      if (elev <= s[4]) return out.setHex(table[4]);
      for (var i = 0; i < 4; i++) {
        if (elev <= s[i] && elev >= s[i + 1]) {
          _simC1.setHex(table[i]); _simC2.setHex(table[i + 1]);
          return out.copy(_simC1).lerp(_simC2, (s[i] - elev) / (s[i] - s[i + 1]));
        }
      }
      return out.setHex(table[2]);
    }
    function sunSimScalar(table, elev) {
      var s = SUNSIM_ELEV;
      if (elev >= s[0]) return table[0];
      if (elev <= s[4]) return table[4];
      for (var i = 0; i < 4; i++) if (elev <= s[i] && elev >= s[i + 1]) return table[i] + (table[i + 1] - table[i]) * ((s[i] - elev) / (s[i] - s[i + 1]));
      return table[2];
    }
    var SUN_DISC_NOW = new THREE.Color(0xffe9c0); // color del disco ESTE frame (transmitancia): lo leen el shader del cielo, los sprites y la luz
    var _sunTint = new THREE.Color(), _whiteC = new THREE.Color(0xffffff);
    function updateSunVisual(px, pz, elev, trans) {
      /* Visibilidad del disco: NO se desvanece antes de llegar al
         horizonte (el fallo que impedía ver el sol naranja al ocaso: el
         fundido viejo lo apagaba a 21 % justo a 0°). Físicamente el disco
         sigue siendo el objeto más brillante hasta tocar el horizonte
         (ganancia ~3× sobre el cielo a 0°, informe §3); se apaga solo al
         hundirse BAJO el horizonte (−0,9° → 0), y el suelo recorta su
         mitad inferior al ponerse, como en la foto real.
         El segundo factor es T (transmitancia por las NUBES, weather.js):
         disco, halo y resplandor comparten el escalar con la luz — con
         el sol tapado del todo (T ≈ 0) no queda ni un resto de foco
         flotando sobre la nube, y tras un velo fino (T ~0,6) el disco
         sigue presente pero atenuado, como en la foto real. */
      var visF = clamp((elev + 0.9) / 1.6, 0, 1) * (0.03 + 0.97 * clamp(trans, 0, 1));
      sunSprite.visible = visF > 0.01;
      /* UN SOLO DISCO (v54): el sprite-núcleo es un degradado radial
         SUAVE de ~5° de diámetro sumado (aditivo) sobre el disco
         analítico de 0,53° del shader del cielo — dos discos, uno
         duro y uno blando 10× más grande, dan exactamente la «figura
         difusa» del atardecer reportada. Con el parche del cielo
         activo manda SOLO el disco físico; el sprite-núcleo queda
         como respaldo para el caso en que el parche no compile en
         este WebGL (skyPatchOk = false), que es para lo que nació. */
      sunCore.visible = visF > 0.01 && !skyPatchOk;
      // color del disco por TRANSMITANCIA (tabla SUNSIM): blanco cálido
      // arriba, dorado a 10°, naranja a 5°, naranja-rojo #FF4E00 a 0°
      sunSimColor(SUNSIM.disc, elev, _sunTint);
      if (sunSprite.visible) {
        sunSprite.position.set(px + sunDir.x * 1350, sunDir.y * 1350, pz + sunDir.z * 1350);
        sunCore.position.copy(sunSprite.position);
        // Amanecer/ocaso como la FOTO REAL (a pedido): sol COMPACTO y
        // brillante con resplandor anaranjado contenido — nada del gran
        // resplandor blanco que lavaba el cielo. Por eso el halo ya NO
        // crece en el horizonte: se achica un poco y baja su opacidad, y
        // el núcleo queda chico y denso, una silueta naranja nítida
        // contra la banda naranja del horizonte y el azul profundo de
        // arriba. sunGlow (slider) sigue escalando ambos, sin inflarlos.
        var lowF = clamp(1 - elev / 22, 0, 1);
        /* AUREOLA DEL SPRITE (v54): es luz del disco dispersada hacia
           adelante (Mie), así que su pico es una fracción chica de la
           radiancia del disco: el disco se dibuja a ×4,5 y el pico de
           este sprite queda en 0,22 ≈ 5 % — antes el pico era
           0,55–1,0 (12–22 % del disco) repartido en un degradado de
           ~15°, y el disco se ahogaba en su propio halo. El TAMAÑO sí
           sale de la física: el lóbulo hacia adelante de Henyey–
           Greenstein con g = 0,85 (el mieDirectionalG del cielo) tiene
           FWHM ≈ 14°, que a la distancia del sprite (1350 m) son
           ~330 m — los ~350 m de siempre. Fuera el achique «a ojo» con
           el sol bajo (lowF): el lóbulo no se encoge al ocaso; lo que
           cambia con la elevación es su color (el del disco, por
           transmitancia) y su fuerza vía visF/T, que ya lo gobiernan. */
        /* ALFA DEL HALO POR TRANSMITANCIA ROJA (v68, investigación
           sol-lámpara §4.5): la aureola es luz del disco dispersada —
           cuando la extinción del camino de aire hunde el disco al
           ocaso, el halo cae con él (tabla del informe: alfa ~0,30 al
           mediodía → 0,20 a 10° → 0,12 a 6° → 0,06 a 2° → ~0,03 en
           el horizonte); con el 0,22 fijo de la v54 el resplandor
           sobrevivía a plena fuerza sobre la silueta del ocaso.
           T_R = exp(−0,113·m), m de Kasten & Young — la misma ley
           que extingue el disco en el shader del cielo (scene.js),
           así halo y disco mueren juntos. (En la v72 la estrella
           dibujada de la «lámpara» salió del shader: el sol visible
           es solo este halo suave + el disco físico de 0,53°.) */
        var _mAir = 1 / (Math.sin(Math.max(elev, 0) * Math.PI / 180) + 0.50572 * Math.pow(Math.max(elev, 0) + 6.07995, -1.6364));
        var _tRed = Math.exp(-0.113 * _mAir);
        sunSprite.material.opacity = clamp(visF * (0.03 + 0.27 * _tRed) * sunGlow, 0, 1);
        // halo = luz dispersada (Mie): el color del disco aclarado hacia
        // blanco cálido — más pálido que el disco, nunca más blanco que él
        sunSprite.material.color.copy(_sunTint).lerp(_whiteC, 0.38);
        var sc = 350 * (0.75 + sunGlow * 0.30);
        sunSprite.scale.set(sc, sc, 1);
        /* El disco NÍTIDO lo dibuja el shader del cielo (máscara analítica
           de 0,53° × transmitancia, scene.js): con el parche activo el
           sprite-núcleo solo acompaña con un brillo tenue teñido del color
           del disco — si brillara a pleno, la suma aditiva lo volvería
           blanco y se perdería el naranja. Sin parche, el núcleo manda. */
        sunCore.material.opacity = clamp(visF * (0.55 + sunGlow * 0.45), 0, 1) * (skyPatchOk && elev < 13 ? 0.45 : 1);
        var scCore = 120 * (0.8 + sunGlow * 0.25) * (1 - lowF * 0.12) * sunThetaF;
        sunCore.scale.set(scCore, scCore, 1);
        sunCore.material.color.copy(_sunTint).lerp(_whiteC, elev > 13 ? 0.72 : 0.12); // disco = color de transmitancia casi puro con el sol bajo: SILUETA ANARANJADA, no foco blanco
      }
      updateSunGlare(visF);
    }
    /* ================= Estrellas: solo con el cielo despejado =================
       1100 puntos en una cúpula que sigue al jugador. Se ven de noche en
       proporción a (oscuridad) × (1 − nubosidad) × (1 − niebla): con
       nubosidad 0 y noche, el cielo estrellado es nítido; con nubes,
       desaparecen detrás de ellas. */
    var starPts = null;
    (function () {
      /* Estrellas REALISTAS con shader propio, no puntos planos: cada
         estrella tiene tamaño, brillo y temperatura de color propios
         (blanco azulado, blanco puro, cálido), disco suave con halo y
         titileo individual. La Vía Láctea es una banda real: miles de
         estrellas tenues concentradas junto a un plano galáctico
         inclinado, más un resplandor difuso de estrellas sin resolver
         (puntos grandes, casi transparentes, a lo largo de la banda). */
      var srng = mulberry32(777);
      var posA = [], sizeA = [], colA = [], phaseA = [], twA = [], alphaA = [];
      var galN = new THREE.Vector3(0.34, 0.52, -0.78).normalize(); // normal del plano galáctico
      var tmpV = new THREE.Vector3();
      function pushStar(dir, size, bright, warm) {
        posA.push(dir.x * 1400, Math.abs(dir.y) * 1400 * 0.94 + 14, dir.z * 1400);
        sizeA.push(size);
        var cr = bright, cg = bright, cb = bright;
        if (warm > 0.66) { cr *= 1.0; cg *= 0.86; cb *= 0.68; }        // cálida
        else if (warm < 0.33) { cr *= 0.78; cg *= 0.86; cb *= 1.0; }  // azulada
        colA.push(cr, cg, cb);
        phaseA.push(srng());
        twA.push(0.15 + srng() * 0.55);
        alphaA.push(1);
      }
      function randDir() {
        var u = srng() * 2 - 1, th = srng() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
        return tmpV.set(Math.cos(th) * rr, u, Math.sin(th) * rr).clone();
      }
      var i, d;
      // campo general: pocas brillantes, muchas tenues (ley de potencias)
      // Tamaños de PUNTO (1–3 px): sin discos grandes ni halo — las
      // estrellas se ven como puntos en el cielo, no como orbes.
      for (i = 0; i < 1500; i++) {
        d = randDir(); if (d.y < 0.02) d.y = -d.y;
        var m = Math.pow(srng(), 2.6);
        pushStar(d, 1.0 + m * 2.0, 0.25 + m * 0.75, srng());
      }
      // Vía Láctea: estrellas pegadas al plano galáctico, chicas y tenues
      for (i = 0; i < 2100; i++) {
        d = randDir();
        var dn = d.dot(galN);
        d.addScaledVector(galN, -dn * (0.82 + srng() * 0.16)).normalize(); // aplastar hacia el plano
        if (d.y < 0.02) d.y = -d.y;
        var along = 0.55 + 0.45 * Math.sin(Math.atan2(d.z, d.x) * 1.0 + 0.8); // núcleo más denso en un tramo
        pushStar(d, 0.8 + Math.pow(srng(), 3) * 1.1, (0.10 + srng() * 0.30) * along, 0.3 + srng() * 0.4);
      }
      // SIN resplandor difuso de la banda (a pedido): los puntos grandes
      // y tenues que lo formaban se veían de noche como ORBES flotantes
      // en el cielo. La Vía Láctea queda solo como densidad de puntos.
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posA), 3));
      g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(sizeA), 1));
      g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(colA), 3));
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(phaseA), 1));
      g.setAttribute('aTw', new THREE.BufferAttribute(new Float32Array(twA), 1));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(alphaA), 1));
      var starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: [
          'attribute float aSize;', 'attribute vec3 aColor;', 'attribute float aPhase;', 'attribute float aTw;', 'attribute float aAlpha;',
          'uniform float uTime;',
          'varying vec3 vColor;', 'varying float vTw;', 'varying float vAlpha;',
          'void main() {',
          '  vColor = aColor;',
          '  vAlpha = aAlpha;',
          '  vTw = 1.0 - aTw * (0.5 + 0.5 * sin(uTime * (1.2 + aPhase * 2.9) + aPhase * 43.7));',
          '  gl_PointSize = aSize;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform float uOpacity;',
          'varying vec3 vColor;', 'varying float vTw;', 'varying float vAlpha;',
          'void main() {',
          '  vec2 pc = gl_PointCoord - 0.5;',
          '  float dist = length(pc) * 2.0;',
          // PUNTO seco, sin glow: el alfa cae en el último tramo del
          // píxel — nada de disco suave con halo que se lea como orbe.
          '  float a = smoothstep(1.0, 0.62, dist);',
          '  a = a * a * uOpacity * vTw * vAlpha;',
          '  if (a < 0.004) discard;',
          '  gl_FragColor = vec4(vColor, a);',
          '}'
        ].join('\n')
      });
      starPts = new THREE.Points(g, starMat);
      starPts.frustumCulled = false;
      starPts.visible = false;
      scene.add(starPts);
      // Si el shader de estrellas no compila en este WebGL, se cae a
      // puntos estándar: la noche estrellada no desaparece.
      watchShader(starMat, function () {
        starPts.material = new THREE.PointsMaterial({ color: 0xdfe9ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
      });
    })();
    function updateMoonVisual(px, pz, sunElev, discTrans, transSm) {
      if (Math.abs(MOON.p - lastMoonP) > 0.004 || lastMoonP < 0) { drawMoonPhase(MOON.p); lastMoonP = MOON.p; }
      // visible cuando el sol ya bajó y la luna está sobre el horizonte
      var visF = clamp((3 - sunElev) / 9, 0, 1) * clamp((MOON.elev + 3) / 9, 0, 1);
      if (discTrans == null) discTrans = 1;
      if (transSm == null) transSm = 1;
      moonSprite.visible = visF > 0.01 && discTrans > 0.015; // tapada del todo por la nube, el disco DESAPARECE: no queda ningún resto flotando
      moonHalo.visible = visF > 0.01 && transSm > 0.01;
      moonRim.visible = false; // el anillo de limbo (v61) solo vive si el disco vive: se enciende dentro del bloque de abajo
      if (moonSprite.visible || moonHalo.visible) {
        moonSprite.scale.set(95 * moonThetaF, 95 * moonThetaF, 1); // tamaño aparente real según la distancia Tierra–Luna de hoy
        moonSprite.position.set(px + _moonDir.x * 1350, _moonDir.y * 1350, pz + _moonDir.z * 1350);
        moonHalo.position.copy(moonSprite.position);
        // brillo según la fase VISIBLE (siempre abierta): disco y halo
        // luminosos incluso en fases reales tenues
        // moonGlow (slider de Iluminación): escala el brillo del disco
        // (color por encima del 1,0 neutro), la opacidad y el halo
        var illumD = 0.74 + 0.26 * MOON.illum;
        // color FÍSICO del disco (CORREGIDO en v60, reporte de Guille
        // 13:47: «la luna sigue igual que antes y es amarillenta —
        // ¿por qué?»): el disco es la FOTO de la luna, y el color del
        // regolito (su leve calidez real) YA viene en sus píxeles. La
        // v58 le multiplicaba encima un tinte fijo ~4100 K de
        // (1,42 · 1,24 · 1,00) — R/B = 1,42 a TODA elevación — que
        // duplicaba esa calidez y la volvía amarilla-crema incluso
        // alta en el cielo; y como la T absoluta de la v58 vale ~1
        // con la luna alta (es relativa a m = 1), a esa altura el
        // arreglo de la v58 no cambiaba nada: por eso «sigue igual».
        // El amarillo de una luna real es SOLO del camino de aire y
        // crece al bajar. Ahora el disco es NEUTRO (×1,25 parejo de
        // brillo fotópico) y el ÚNICO tinte es la TRANSMITANCIA
        // ABSOLUTA de su camino de aire (moonAirT, v58: la misma ley
        // Rayleigh del sol, sin normalizar — matiz y magnitud a la
        // vez): alta, la luna es la de la foto, gris cálido natural;
        // baja, se apaga y enrojece hasta ser una brasa al ras del
        // horizonte: un cuerpo DENTRO de la atmósfera, no una imagen
        // flotando. El halo toma SOLO la croma normalizada del mismo
        // camino (antes llevaba además un multiplicador cálido fijo
        // (1,00 · 0,90 · 0,74): la misma doble cuenta en el resplandor).
        moonSprite.material.color.setRGB(2.3 * moonGlow * moonAirT.r, 2.3 * moonGlow * moonAirT.g, 2.3 * moonGlow * moonAirT.b); // ganancia 2,3 (v61; era 1,25): brillo PROPIO del disco — escala uniforme, el contraste mares/cráteres de la foto no se toca
        moonHalo.material.color.setRGB(moonChroma.r, moonChroma.g, moonChroma.b); // el tinte del halo es solo el de su camino de aire (v60)
        // el disco se atenúa con T_luna muestreada en su limbo (discTrans):
        // tras un velo fino sigue presente pero débil; asomando por un
        // borde, la parte destapada sigue brillando
        moonSprite.material.opacity = clamp(visF * (0.45 + 0.55 * illumD) * (0.55 + moonGlow * 0.45), 0, 1) * (0.02 + 0.98 * clamp(discTrans, 0, 1));
        /* HALO tras nube fina (fenómeno real): la dispersión hacia
           adelante en el velo mantiene un resplandor ancho alrededor de
           la luna aunque el disco ya se atenuó — el halo decae MÁS
           LENTO que el disco (factor T + (1−T)·T·1,5) y solo muere con
           la cubierta total, junto con el disco y la luz del suelo. */
        var haloF = clamp(transSm + (1 - transSm) * transSm * 1.5, 0, 1);
        var haloAirF = clamp((moonAirT.r + moonAirT.g + moonAirT.b) / 3, 0.12, 1); // el halo es luz de la luna dispersada: se apaga con la misma extinción del camino de aire que el disco (v58)
        moonHalo.material.opacity = clamp(visF * illumD * 0.22 * moonGlow, 0, 1) * haloF * haloAirF; // 0,22 (v58; era 0,30): la aureola real es de pocos grados y tenue — el resplandor ancho de antes dibujaba un segundo disco pálido alrededor y la luna se leía flotando
        var haloSc = 300 * (0.85 + moonGlow * 0.2); // ≈12,6° de diámetro total, núcleo visible de ~5°: la escala de la aureola lunar real (v58; era 560 ≈ 23°)
        moonHalo.scale.set(haloSc, haloSc, 1);
        /* BRILLO DE LIMBO (v61; geometría corregida en v62): el
           anillo aditivo abraza el borde del disco (1,5× su tamaño;
           el limbo real cae a 0,542 del radio del anillo — el disco
           ocupa 0,8125 de su propio sprite — y el pico suave del
           perfil queda justo ahí, sin aro despegado ni franja
           oscura entre disco y resplandor). Su fuerza sigue a la
           misma cadena que el halo (visF × fase visible × T de
           nubes suavizada × extinción del camino de aire): tras
           nube total se apaga con el disco, y con la luna baja se
           apaga y enrojece con ella. */
        moonRim.visible = moonSprite.visible;
        if (moonRim.visible) {
          moonRim.position.copy(moonSprite.position);
          var rimSc = 95 * moonThetaF * 1.5;
          moonRim.scale.set(rimSc, rimSc, 1);
          moonRim.material.color.setRGB(moonChroma.r, moonChroma.g, moonChroma.b);
          moonRim.material.opacity = clamp(visF * illumD * 0.55 * moonGlow, 0, 1) * haloF * haloAirF;
        }
      }
      var txt = MOON.name + ' · ' + Math.round(MOON.illum * 100) + ' % iluminada' + (MOON.mode === 'auto' ? ' (real, hoy)' : '');
      if (txt !== moonLabelTxt) {
        moonLabelTxt = txt;
        var el = document.getElementById('dbgMoonVal');
        if (el) el.textContent = txt;
      }
    }

    /* Lluvia como RAYAS DE AGUA, no como bolas ni líneas blancas (a
       pedido): quads instanciados orientados a cámara con shader
       propio — traslúcidos, azul grisáceos, con gradiente de brillo
       (punta luminosa, cola que se desvanece) y grosor/alfa por gota.
       En la realidad la gota cae a su velocidad terminal (llovizna
       ~2 m/s, fuerte ~9 m/s) y el ojo la ve como una raya fina por
       desenfoque de movimiento, nunca como un círculo. La población
       de gotas, la cuenta y el alfa salen de los mm/h del modelo
       (tablas del informe de lluvia realista, §4.1–4.2) y el factor
       espacial del campo de nubes, todo en weather.js vía uniforms.
       Caja de 24×20×24 que sigue al jugador; la caída se resuelve
       en el vértice. */
    var RAIN_N = 6000, rainPts = null, rainUni = null, rainBroken = false;
    (function () {
      /* QUADS instanciados con shader propio (informe de lluvia
         realista 2026-11-22, §5): la línea de 1 px no admite gradiente
         ni grosor — y en esta fuente NO existe ninguna primitiva de
         línea para la lluvia (sin Line/LineDashedMaterial en todo el
         código). Cada gota es un quad orientado a cámara estirado a
         lo largo de SU vector de caída, resuelto en el VÉRTICE.
         POBLACIÓN POR GOTA (§1.2–1.3 del informe): el diámetro sale
         de las bandas de Marshall–Palmer alrededor del dropMm del
         tipo de nube del motor climático, y su velocidad terminal de
         Atlas–Ulbrich v(D) = 9,65 − 10,3·exp(−0,6·D) — nunca una
         sola velocidad: la inclinación por viento sale por gota
         (θ = atan(U/v), un abanico, §1.6). LARGO = v · dt · 2,5
         (exposición del ojo/cámara, §1.4), clamp 0,10–0,50 m. ANCHO
         con piso de píxel y alfa que conserva la energía
         (α × D/ancho, §4.2). Desvanecimiento cerca (0,5–2 m) y a la
         distancia visible de la lluvia (12–22 m, §1.4).
         SINCRONÍA CON LA NUBE (v65): el vértice muestrea el MISMO
         campo fbm que dibuja el cielo y sombrea el suelo (réplica
         GLSL de cloudDepthAtJS, uniforms COMPARTIDOS con CLOUDSH_U)
         sobre la vertical de la gota, desplazada viento arriba por
         la deriva de la caída desde la base (U·0,32·base/vt): el
         alfa escala con profundidad local / media espacial del
         campo — bajo un hueco despejado no cae nada; bajo un núcleo
         denso, hasta ~1,6×. La media la muestrea weather.js en CPU
         sobre la planicie; la integral conserva la tasa del modelo. */
      var base = new THREE.PlaneGeometry(1, 1);
      var g = new THREE.InstancedBufferGeometry();
      g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
      var seeds = new Float32Array(RAIN_N * 4);
      var rr = mulberry32(555);
      for (var i = 0; i < RAIN_N; i++) {
        seeds[i * 4] = (rr() - 0.5) * 24;            // x en la caja de 24 m (informe §5.1)
        seeds[i * 4 + 1] = rr();                      // fase vertical 0..1
        seeds[i * 4 + 2] = (rr() - 0.5) * 24;         // z
        seeds[i * 4 + 3] = rr();                      // semilla por gota (diámetro/alfa)
      }
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      g.instanceCount = 0;
      var CSH = (typeof CLOUDSH_U !== 'undefined') ? CLOUDSH_U : null;
      function csU(k, dflt) { return CSH && CSH[k] ? CSH[k] : { value: dflt }; }
      rainUni = {
        uTime: { value: 0 }, uDropMm: { value: 1.5 }, uDt: { value: 1 / 60 },
        uOpacity: { value: 0 }, uBright: { value: 1 },
        uVel: { value: new THREE.Vector3(0, 0, 0) },
        uCam: { value: new THREE.Vector3() },
        uPixH: { value: 800 }, uFovTan: { value: 0.713 },
        uMeanInv: { value: 1 }, uShaft: { value: new THREE.Vector2(0, 0) },
        uCCov: csU('uCCov', 0), uCTime: csU('uCTime', 0), uCSpeed: csU('uCSpeed', 0.00002),
        uCElev: csU('uCElev', 0.5), uCBillow: csU('uCBillow', 0.55), uCStretch: csU('uCStretch', 0)
      };
      var m = new THREE.ShaderMaterial({
        uniforms: rainUni, transparent: true, depthWrite: false,
        vertexShader: [
          'attribute vec4 aSeed;',
          'uniform float uTime, uDropMm, uDt, uPixH, uFovTan, uMeanInv;',
          'uniform vec3 uVel, uCam;',
          'uniform vec2 uShaft;',
          'uniform float uCCov, uCTime, uCSpeed, uCElev, uCBillow, uCStretch;',
          'varying vec2 vUvR; varying float vSeed, vA;',
          // el MISMO campo que el cielo y la sombra del suelo (réplica de cloudDepthAtJS)
          'vec2 rfGrad(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }',
          'float rfNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); float a = dot(rfGrad(i), f); float b = dot(rfGrad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)); float c = dot(rfGrad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)); float d = dot(rfGrad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)); return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6; }',
          'float rfFbm(vec2 p, float drift) { float r = 0.0; float amp = 1.0; for (int i = 0; i < 4; i++) { r += amp * rfNoise(p); amp *= 0.5; p = p * 2.0 + drift; } return r; }',
          'float rfDepth(vec2 relM) {',
          '  float elevMixC = mix(1.0, 0.1, uCElev);',
          '  vec2 cuv = relM * (0.0002 / (120.0 * elevMixC)) + uCTime * uCSpeed;',
          '  float csK = mix(1.0, 0.32, uCStretch);',
          '  float csU2 = dot(cuv, vec2(0.7071));',
          '  float csV = dot(cuv, vec2(-0.7071, 0.7071));',
          '  vec2 csSt = vec2(0.7071) * (csU2 * csK) + vec2(-0.7071, 0.7071) * csV;',
          '  float cn = clamp(rfFbm(csSt * 1000.0, uCTime * uCSpeed * 300.0) * 0.7 + 0.5, 0.0, 1.0);',
          '  float bil = 1.0 - abs(rfNoise(csSt * 2600.0 + vec2(13.7, 7.9) + uCTime * uCSpeed * 300.0 * 0.7));',
          '  cn = clamp(cn * (1.0 + uCBillow * (bil - 0.45) * 0.55), 0.0, 1.0);',
          '  float rg = rfNoise(cuv * 300.0) * 0.37 + 0.5;',
          '  float cv = clamp(uCCov + (rg - 0.5) * 0.6, 0.0, 1.0);',
          '  float deckB = pow(clamp((uCCov - 0.72) / 0.28, 0.0, 1.0), 1.5) * 0.30;',
          '  return max(0.0, cn - (1.0 - cv)) + deckB;',
          '}',
          'void main() {',
          '  vUvR = uv; vSeed = aSeed.w;',
          // población Marshall–Palmer por bandas alrededor del dropMm del tipo (informe §4.2)
          '  float rq = fract(aSeed.w * 7.317);',
          '  float dFac = rq < 0.30 ? 0.5 : rq < 0.60 ? 0.7 : rq < 0.80 ? 1.0 : rq < 0.93 ? 1.35 : 2.0;',
          '  float Dmm = clamp(uDropMm * dFac, 0.4, 6.0);',
          '  float fallV = clamp(9.65 - 10.3 * exp(-0.6 * Dmm), 1.5, 9.2);', // Atlas–Ulbrich
          '  float y = mod(aSeed.y * 20.0 - uTime * fallV, 20.0);',
          '  vec3 c = vec3(aSeed.x, y, aSeed.z);',
          '  vec3 vel = vec3(uVel.x, -fallV, uVel.z);',
          '  vec3 dir = normalize(vel);',
          '  vec3 wc = c + modelMatrix[3].xyz;',
          '  vec3 toCamV = uCam - wc;',
          '  float dist = max(length(toCamV), 0.001);',
          '  vec3 toCam = toCamV / dist;',
          // sincronía: profundidad del campo sobre la vertical de la gota (+ deriva de la caída)
          '  float fac = clamp(rfDepth((wc.xz - uCam.xz) + uShaft) * uMeanInv, 0.0, 3.0);',
          '  float fade = smoothstep(0.5, 2.0, dist) * (1.0 - smoothstep(12.0, 22.0, dist));',
          '  float pixW = 2.0 * dist * uFovTan / max(uPixH, 1.0);',
          '  float trueW = Dmm * 0.001;',
          '  float wdt = max(trueW, 1.15 * pixW);',           // piso de píxel (informe §4.2)
          '  vA = fade * clamp(trueW / wdt, 0.05, 1.0) * clamp(fac, 0.0, 1.6);', // alfa que conserva la energía × factor del campo
          '  float len = clamp(fallV * uDt * 2.5, 0.10, 0.50) * clamp(fac, 0.0, 1.0);', // largo por exposición; sin nube encima, la raya colapsa
          '  vec3 cxv = cross(dir, toCam);',
          '  float cl2 = length(cxv);',
          '  vec3 side = cl2 > 0.001 ? cxv / cl2 : normalize(cross(dir, vec3(1.0, 0.0, 0.0)));', // mirando A LO LARGO de la caída el cross se anula: sin guarda, normalize(0) = NaN y el quad sale corrupto (v64)
          '  vec3 wp = c + side * (position.x * wdt) + dir * ((uv.y - 0.5) * len);',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform float uOpacity, uBright;',
          'varying vec2 vUvR; varying float vSeed, vA;',
          'void main() {',
          '  float across = 1.0 - abs(vUvR.x - 0.5) * 2.0;',
          '  float tip = 0.30 + 0.70 * vUvR.y;',                // la punta que cae (uv.y=1 en el extremo de avance) brilla más; la cola se desvanece
          '  float a = min(uOpacity * vA * (0.55 + vSeed * 0.75) * tip * pow(across, 1.6), 0.42);',
          '  if (a < 0.004) discard;',
          // NUNCA NEGRO (reporte de Guille con foto: «se ven líneas
          // negras»): el color lleva su piso DENTRO del shader — azul
          // grisáceo de agua (0,66 · 0,74 · 0,84) por el brillo del
          // frame clampado a [0,35, 1,20] y con piso absoluto
          // (0,28 · 0,34 · 0,42): ni con el uniform a cero puede
          // salir una raya oscura, y el alfa está techado a 0,42 —
          // una mezcla translúcida con este color jamás pinta negro
          // puro (0,0,0). La lluvia NO usa ningún asset: es este
          // shader procedural, nada puede dar 404. (El origen de los
          // guiones de la captura no está verificado; la garantía de
          // ESTA versión es la del piso, no un diagnóstico de aquella.)
          '  vec3 col = max(vec3(0.66, 0.74, 0.84) * clamp(uBright, 0.35, 1.20), vec3(0.28, 0.34, 0.42));',
          '  gl_FragColor = vec4(col, a);',
          '}'
        ].join('\n')
      });
      m.customProgramCacheKey = function () { return 'rain65'; }; // programa propio: la caché de three nunca lo confunde con otro ShaderMaterial del proyecto
      rainPts = new THREE.Mesh(g, m);
      rainPts.frustumCulled = false;
      rainPts.visible = false;
      rainPts.renderOrder = 5;
      scene.add(rainPts);
      // si el shader no compila en este WebGL, three salta el objeto
      // (lluvia invisible) — jamás lo dibuja en negro; la bandera
      // queda para el state() del debug
      watchShader(m, function () { rainBroken = true; });
    })();
