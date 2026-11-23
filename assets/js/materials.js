/* materials.js — Texturas y materiales: piedra, suelo con mezcla por zonas
   y sombras de nubes, senderos. Depende de: scene, utils. */
'use strict';
    /* ================= Texturas y materiales ================= */
    function stoneCanvas(slateImg, tint, mossAmt, seed) {
      var c = document.createElement('canvas'); c.width = 512; c.height = 512;
      var x = c.getContext('2d');
      x.fillStyle = '#8f9296'; x.fillRect(0, 0, 512, 512);
      if (slateImg) x.drawImage(slateImg, 0, 0, 512, 512);
      if (tint) { x.fillStyle = tint; x.fillRect(0, 0, 512, 512); }
      var r = mulberry32(seed);
      for (var i = 0; i < 2600; i++) {
        x.fillStyle = 'rgba(' + (r() > 0.5 ? '255,255,255' : '10,10,12') + ',' + (0.02 + r() * 0.05) + ')';
        x.fillRect(r() * 512, r() * 512, 1 + r() * 2, 1 + r() * 2);
      }
      if (mossAmt > 0) {
        for (var m = 0; m < 26 * mossAmt; m++) {
          var gx = r() * 512, gy = 300 + r() * 212, gr = 14 + r() * 46;
          var g = x.createRadialGradient(gx, gy, 2, gx, gy, gr);
          g.addColorStop(0, 'rgba(74,94,44,0.34)'); g.addColorStop(1, 'rgba(74,94,44,0)');
          x.fillStyle = g; x.beginPath(); x.arc(gx, gy, gr, 0, Math.PI * 2); x.fill();
        }
      }
      var t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    }
    /* Mapa de ALTURAS de la piedra — separado del color a propósito
       (reparación v52, foto de Guille 1000273341: «algo extraño en la
       superficie, como una rejilla encima»). Causa: el material usaba
       LA TEXTURA DE COLOR COMO SU PROPIO bumpMap con bumpScale 0,6.
       El grano fino de la foto de pizarra queda al límite de Nyquist
       del lienzo de 512², y el bump de three.js se calcula con las
       DERIVADAS de pantalla de ese grano: al ampliarse 0,6, el alias
       entre la retícula de téxeles y la de píxeles se lee como una
       trama regular de puntos sobre TODA la superficie — la rejilla.
       Fenómeno→consecuencia: la altura real de una piedra colada es
       relieve de BAJA frecuencia (ondulación del molde, poros
       grandes); el grano fotográfico fino no es altura y no debe
       alimentarla. Este lienzo es la misma foto pasada por un pasa-
       bajos fuerte (reducida a 128² y reescalada con suavizado):
       conserva la ondulación y elimina el grano que aliasaba. Sin
       motas (las del color son manchas de albedo, no relieve) y en
       lineal (un bumpMap no lleva espacio sRGB). */
    function stoneBumpCanvas(slateImg) {
      var S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
      var x = c.getContext('2d');
      x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
      if (slateImg) x.drawImage(slateImg, 0, 0, S, S);
      var big = document.createElement('canvas'); big.width = 512; big.height = 512;
      var bx = big.getContext('2d');
      bx.imageSmoothingEnabled = true;
      bx.drawImage(c, 0, 0, 512, 512);
      var t = new THREE.CanvasTexture(big);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      return t;
    }
    /* Ruido de valor en dos escalas (R: zonas grandes, G: detalle), repetible:
       decide dónde el césped da paso a la hierba seca. */
    function zoneNoiseTexture() {
      var S = 256, c = document.createElement('canvas'); c.width = S; c.height = S;
      var x = c.getContext('2d');
      var img = x.createImageData(S, S);
      function grid(n, seed) { var g = [], r = mulberry32(seed); for (var i = 0; i < n * n; i++) g.push(r()); return { g: g, n: n }; }
      function sample(gr, u, v) {
        var n = gr.n, fx = u * n, fy = v * n;
        var x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        var tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var a = gr.g[y0 * n + x0], b = gr.g[y0 * n + x1], cc = gr.g[y1 * n + x0], d = gr.g[y1 * n + x1];
        return a + (b - a) * tx + (cc - a) * ty + (a - b - cc + d) * tx * ty;
      }
      var gR = grid(10, 1234), gG = grid(40, 987);
      for (var py = 0; py < S; py++) for (var px3 = 0; px3 < S; px3++) {
        var o = (py * S + px3) * 4, u = px3 / S, v = py / S;
        img.data[o] = Math.floor(sample(gR, u, v) * 255);
        img.data[o + 1] = Math.floor(sample(gG, u, v) * 255);
        img.data[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      var t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    }

    /* ============ Estaciones: el césped cambia en tiempo real ============
       Cada estación define cuánto de la hierba seca amarillenta se mezcla
       en el suelo (uDryMix del shader del terreno) y el tinte general del
       césped: Primavera verde vibrante (casi sin seco), Verano verde,
       Otoño el actual medio amarillento, Invierno el mismo pero pálido y
       frío. Se aplica al instante sobre el material del suelo: sin
       regenerar chunks ni reiniciar. */
    var SEASON_DRY_U = { value: 0.10 };
    var SEASONS = {
      primavera: { tint: [0.49, 1.19, 1.28], dry: 0.35 }, // verde de primavera CALIBRADO (v55): la foto base del césped es AMARILLA (media medida sRGB (110, 96, 62) = lineal (0,156 / 0,117 / 0,048), tono ~43°: una foto de pasto seco) y el tinte viejo (0,68 / 1,34 / 0,52, a ojo) solo la rotaba a un oliva de tono ~67° (medido en pantalla: G/R 1,09). El verde que se veía en las fotos de la era v49 NO era del césped: era el relleno verde de toda la escena (rebote + suelo hemisférico fijos) que la v50 quitó a pedido de Guille — al irse, el albedo real quedó al desnudo. Este tinte hace foto × tinte = el espectro MEDIDO del pasto verde (JPL ECOSTRESS, la fuente del rebote: R 0,05 / G 0,09 / B 0,04) reescalado a la luminancia de la foto → albedo (0,077 / 0,139 / 0,062), tono renderizado ~98° al mediodía: la primavera se lee verde a toda hora, y a sol bajo el croma cálido la lleva a un verde dorado, no a paja. · CÓRDOBA (v56): la fracción seca es la CALIBRACIÓN del informe cordoba-clima §5 para el 15-oct (gramilla reverdeciendo tras el invierno seco: oct 0,35 — estimación, no medida del SMN)
      verano: { tint: [0.52, 1.17, 1.24], dry: 0.05 }, // verano austral (ene): gramilla en verde pleno — lluvia 121,6 mm y mín. 18,9 °C (SMN); seco 0,05 (calibración §5)
      otono: { tint: [0.80, 1.08, 1.02], dry: 0.25 }, // otoño (abr): verde que empieza a amarillear con las primeras noches frescas; seco 0,25 (calibración §5)
      invierno: { tint: [1.14, 1.16, 1.20], dry: 0.85 } // invierno (jul): gramilla en DORMICIÓN por frío — marrón/pajiza con lluvia de solo 6,7 mm y mín. media 5,5 °C (SMN); seco 0,85 (calibración §5, máximo del año)
    };
    var season = 'primavera'; // estación por defecto al cargar (a pedido): primavera (austral, oct)
    // día del año representativo de cada estación (15 del mes central,
    // hemisferio SUR): la estación también fija la ÉPOCA orbital —
    // distancia al sol, tamaño aparente, declinación y duración del
    // día (weather.js). Primavera = 15-oct, verano = 15-ene,
    // otoño = 15-abr, invierno = 15-jul.
    var SEASON_DOY = { primavera: 288, verano: 15, otono: 105, invierno: 196 };
    function setSeason(name) {
      var s = SEASONS[name];
      if (!s) return;
      season = name;
      if (typeof ORBIT !== 'undefined' && SEASON_DOY[name]) {
        ORBIT.dayOfYear = SEASON_DOY[name];
        var dEl = document.getElementById('dbgDayOfYear'), dVal = document.getElementById('dbgDayVal');
        if (dEl) dEl.value = ORBIT.dayOfYear;
        if (dVal && typeof orbitDateLabel === 'function') dVal.textContent = orbitDateLabel(ORBIT.dayOfYear);
      }
      SEASON_DRY_U.value = s.dry;
      if (groundMat) groundMat.color.setRGB(s.tint[0], s.tint[1], s.tint[2]);
      var btns = document.querySelectorAll('.wbtn.season');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-season') === name);
    }
    var MAT = {}; // materiales base (se clonan por chunk para el fundido)
    var groundMat = null, groundMesh = null, groundUniforms = null;
    var hillsMesh = null; // anillo de colinas del horizonte (v64): lo crea buildMaterials junto al suelo y main.js lo mueve con el jugador
    var plaqueTex = null;
    /* Niebla EN ALTURA: la niebla normal de three.js solo depende de la
       distancia horizontal a la cámara; este parche de shader añade un
       segundo factor que crece con la altura del fragmento y con la
       distancia — las copas de los cipreses, los obeliscos y los techos
       de los mausoleos se pierden en la niebla antes que sus bases, y el
       entorno se envuelve verticalmente, no solo en el horizonte.
       world.js lo aplica a los materiales clonados de cada chunk y
       weather.js regula su fuerza (uHeightFog) según niebla y nubosidad.
       Sin niebla en la escena (niebla en 0) el parche no actúa. */
    var HEIGHT_FOG_U = { value: 0 };
    function applyHeightFog(shader) {
      shader.uniforms.uHeightFog = HEIGHT_FOG_U;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY2;\nvarying float vFogDepth2;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldY2 = (modelMatrix * vec4(transformed, 1.0)).y;\nvFogDepth2 = -mvPosition.z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY2;\nvarying float vFogDepth2;\nuniform float uHeightFog;')
        .replace('#include <fog_fragment>', [
          '#include <fog_fragment>',
          '#ifdef USE_FOG',
          'float hFogF = smoothstep(1.2, 22.0, vWorldY2) * smoothstep(12.0, 80.0, vFogDepth2) * uHeightFog;',
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(hFogF, 0.0, 1.0) * (1.0 - fogFactor));',
          '#endif'
        ].join('\n'));
    }
    /* Balanceo por viento: parche de shader para césped, copas y ramas.
       Desplaza los vértices en el vertex shader en proporción a su altura
       (la base queda clavada; las puntas y las ramas altas se mecen), con
       fase por posición en el mundo — cada árbol y cada mechón se mueve
       a su ritmo. Los uniforms son objetos compartidos que weather.js
       actualiza por frame con el viento real (dirección, velocidad con
       ráfagas ya incluidas): a más viento, más balanceo. */
    var WIND_TIME_U = { value: 0 };
    var WIND_AMP_U = { value: 0.4 };
    var WIND_DIR_U = { value: new THREE.Vector2(0.94, 0.34) };
    function applyWindSway(shader) {
      shader.uniforms.uWindTime = WIND_TIME_U;
      shader.uniforms.uWindAmp = WIND_AMP_U;
      shader.uniforms.uWindDir = WIND_DIR_U;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindAmp;\nuniform vec2 uWindDir;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          'vec4 swayWp = modelMatrix * vec4(transformed, 1.0);',
          'float swayH = smoothstep(0.30, 2.6, transformed.y);',
          'float swayPh = dot(swayWp.xz, vec2(0.33, 0.29)) + uWindTime * (1.1 + uWindAmp * 1.1);',
          'float swayA = swayH * swayH * 0.13 * uWindAmp;',
          'transformed.x += uWindDir.x * sin(swayPh) * swayA + uWindDir.y * cos(swayPh * 1.37) * swayA * 0.35;',
          'transformed.z += uWindDir.y * sin(swayPh) * swayA - uWindDir.x * cos(swayPh * 1.37) * swayA * 0.35;'
        ].join('\n'));
    }
    // Sombras de nubes: 12 manchas (x, z, radio, fuerza) que proyectan las
    // posiciones reales de las nubes. Las leen el suelo Y los materiales
    // de chunk (tumbas, panteones, árboles, senderos): cuando una nube
    // pasa, su sombra suave se desplaza sobre todo el paisaje a la vez.
    var cloudShadowVecs = [];
    for (var csv = 0; csv < 12; csv++) cloudShadowVecs.push(new THREE.Vector4(0, 0, 60, 0));
    /* Parámetros de PROYECCIÓN de cada mancha (x: alargamiento por
       1/sen(elevación) de la fuente, y: penumbra en fracción del radio
       ≈ h·tan(0,53°)/radio, z/w: acimut de la fuente en XZ): la sombra
       es la proyección del cuerpo a su altura, no un círculo pegado —
       con luz rasante se desplaza, se alarga y su borde se ablanda.
       Solo el slot 0 (nube de prueba) los escribe; el resto queda en
       su valor neutro. */
    var cloudShadowPar = [];
    for (var csp = 0; csp < 12; csp++) cloudShadowPar.push(new THREE.Vector4(1, 0.15, 1, 0));
    var CLOUD_AMT_U = { value: 0 }; // fuerza compartida (la regula weather.js por frame)
    /* EL CUERPO DE NUBE — UNA SOLA LEY (principio del proyecto): la
       capa de nubes es un cuerpo físico en el camino de la luz, con su
       opacidad τ (clima + forma + densidad). La luz la atraviesa y ESA
       luz modulada es la única que ilumina el mundo: no existe una
       «sombra de nube» como efecto aparte. Por eso este parche evalúa
       en cada punto la MISMA transmitancia del campo que apaga el
       disco en el cielo (mismo fbm, misma calibración depth·densidad
       ·12·σ de cloudTransAt) a lo largo del rayo fuente→punto, con la
       proyección anclada al mundo (el rayo cruza la capa a su altura
       efectiva). Los uniforms los escribe weather.js por frame con
       los mismos valores que alimentan el shader del cielo; el slot 0
       de uClouds lo usa la NUBE DE PRUEBA (el mismo cuerpo, aislado
       para test) y los demás slots quedan en cero sin volumétricas.
       La proyección cumple la ley del esquema §13 igual que el slot 0:
       desplazamiento h/tan(elevación) (h efectiva 120 m), alargamiento
       1/sen(elevación) con clamp 6 con el sol bajo, y piso difuso
       piso+(1−piso)·T dentro de la sombra. La penumbra a 120 m sería
       h·tan(0,53°) ≈ 1,1 m — menor que la escala del borde del propio
       campo fbm, que ya es más blando que eso. */
    var CLOUDSH_U = {
      uCSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uCCov: { value: 0 }, uCDen: { value: 0.4 }, uCSigma: { value: 1 },
      uCTime: { value: 0 }, uCSpeed: { value: 0.00002 }, uCElev: { value: 0.5 },
      uCFloor: { value: 0.6 }, // piso difuso del tipo (hemiFloor, lo escribe weather.js): la fracción de luz difusa que SOBREVIVE dentro de la sombra del campo — la sombra de una nube normal cumple la misma ley que la del slot 0 (nube de prueba): atenuada, nunca negra
      uCBillow: { value: 0.55 }, uCStretch: { value: 0 } // FORMA del campo (esquema §16, los escribe weather.js por tipo): el suelo lee el mismo billow/estiramiento que el cielo — un solo campo
    };
    var CS_GLSL = [
      'uniform vec3 uCSunDir; uniform float uCCov; uniform float uCDen; uniform float uCSigma; uniform float uCTime; uniform float uCSpeed; uniform float uCElev; uniform float uCFloor; uniform float uCBillow; uniform float uCStretch;',
      'vec2 csGradient(vec2 i) { vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0; }',
      'float csNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); float a = dot(csGradient(i), f); float b = dot(csGradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)); float c = dot(csGradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)); float d = dot(csGradient(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)); return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6; }',
      'float csFbm(vec2 p, float drift) { float result = 0.0; float amplitude = 1.0; for (int i = 0; i < 4; i++) { result += amplitude * csNoise(p); amplitude *= 0.5; p = p * 2.0 + drift; } return result; }',
      'float csFieldT(vec3 wp, float amt) {',
      '  if (amt < 0.003 || uCSunDir.y < 0.03) return 1.0;',
      '  float elevMixC = mix(1.0, 0.1, uCElev);',
      // PROYECCIÓN con la misma ley que la sombra de la nube de prueba
      // (slot 0): el cruce con la capa va desplazado h/tan(elevación)
      // en contra de la fuente (el término uCSunDir·(120/dir.y) de
      // abajo, h efectiva 120 m) y el parche se ALARGA a lo largo del
      // acimut por 1/sen(elevación) con el sol bajo — mismo clamp
      // 1–6 que el slot. El estiramiento se aplica alrededor del
      // ancla de la cámara (el campo es cámara-anclado, como en el
      // cielo): el punto bajo el jugador sigue leyendo la T del
      // disco y el alargamiento crece con la distancia, como la
      // proyección real de un cuerpo a altura.
      '  vec2 csRel = wp.xz - cameraPosition.xz;',
      '  vec2 csAz = normalize(uCSunDir.xz + vec2(1e-5, 0.0));',
      '  float csElong = clamp(1.0 / max(uCSunDir.y, 0.10), 1.0, 6.0);',
      '  vec2 csRelS = csAz * (dot(csRel, csAz) / csElong) + vec2(-csAz.y, csAz.x) * dot(csRel, vec2(-csAz.y, csAz.x));',
      '  vec3 hit = vec3(cameraPosition.x + csRelS.x, wp.y, cameraPosition.z + csRelS.y) + uCSunDir * (120.0 / uCSunDir.y);',
      '  vec2 cuv = (hit.xz - cameraPosition.xz) * (0.0002 / (120.0 * elevMixC)) + uCTime * uCSpeed;',
      // FORMA del campo idéntica a la del cielo (esquema §16): estiramiento de dominio + canal billow — la sombra en el suelo es la de la nube que se VE
      '  float csK = mix(1.0, 0.32, uCStretch);',
      '  float csU = dot(cuv, vec2(0.7071));',
      '  float csV = dot(cuv, vec2(-0.7071, 0.7071));',
      '  vec2 csSt = vec2(0.7071) * (csU * csK) + vec2(-0.7071, 0.7071) * csV;',
      '  float cn = clamp(csFbm(csSt * 1000.0, uCTime * uCSpeed * 300.0) * 0.7 + 0.5, 0.0, 1.0);',
      '  float csBil = 1.0 - abs(csNoise(csSt * 2600.0 + vec2(13.7, 7.9) + uCTime * uCSpeed * 300.0 * 0.7));',
      '  cn = clamp(cn * (1.0 + uCBillow * (csBil - 0.45) * 0.55), 0.0, 1.0);',
      '  float rg = csNoise(cuv * 300.0) * 0.37 + 0.5;',
      '  float cv = clamp(uCCov + (rg - 0.5) * 0.6, 0.0, 1.0);',
      '  float depth = max(0.0, cn - (1.0 - cv)) * clamp((uCCov - 0.02) / 0.13, 0.0, 1.0);', // sin cobertura no hay cuerpo: el ruido regional solo no puede inventar manchas con el cielo despejado (pasaba al subir uCloudAmt por la nube de prueba)
      '  float deckB = pow(clamp((uCCov - 0.72) / 0.28, 0.0, 1.0), 1.5) * 0.30;',
      '  float slant = clamp(1.0 / max(uCSunDir.y, 0.18), 1.0, 3.2);',
      // PISO DIFUSO — la misma fórmula que el brillo de la capa en el
      // cielo (uCloudDiffuse = piso + (1−piso)·T) y que la sombra del
      // slot 0: el haz directo muere con exp(−τ), pero la difusa del
      // resto del cielo sigue cayendo dentro de la sombra. Sin este
      // piso, bajo un núcleo denso (τ del campo 20–40, como el de la
      // nube de prueba a 24) el factor era exp(−τ) ≈ 0 y el suelo
      // salía NEGRO: la nube normal no cumplía la ley de la de prueba.
      '  float csBeam = exp(-(depth + deckB) * uCDen * 12.0 * uCSigma * slant * 0.85);',
      '  return uCFloor + (1.0 - uCFloor) * csBeam;',
      '}'
    ].join('\n');
    /* Sombra LOCAL proyectada (GLSL compartido por suelo y chunks):
       cada mancha es una ELIPSE en el marco de la fuente — el eje del
       acimut solar se estira por el alargamiento de la proyección —
       con núcleo pleno y borde de penumbra (ancho = h·tan(0,53°), el
       diámetro angular del sol a la altura del cuerpo). Y atenuar la
       sombra NO es pintar negro: el factor 0,62 deja el PISO DIFUSO
       — dentro de la mancha la directa cae pero el resto del cielo
       sigue iluminando (por eso las sombras reales se ven azuladas,
       no negras); solo una cubierta total baja también la difusa, y
       eso lo hace la cadena global, no esta mancha. */
    var CS_SLOT_GLSL =
      'float csSlot(vec2 wxz) {\n' +
      '  float s = 0.0;\n' +
      '  for (int i = 0; i < 12; i++) {\n' +
      '    if (uClouds[i].w < 0.003) continue;\n' +
      '    vec2 dv = wxz - uClouds[i].xy;\n' +
      '    vec2 az = uCloudP[i].zw;\n' +
      '    float along = dot(dv, az) / max(uCloudP[i].x, 1.0);\n' +
      '    float across = dot(dv, vec2(-az.y, az.x));\n' +
      '    float q = length(vec2(along, across)) / max(uClouds[i].z, 1.0);\n' +
      '    float pen = clamp(uCloudP[i].y, 0.04, 0.9);\n' +
      '    s += uClouds[i].w * (1.0 - smoothstep(1.0 - pen, 1.0 + pen, q));\n' +
      '  }\n' +
      '  return clamp(s, 0.0, 0.85);\n' +
      '}\n';
    function applyCloudShadow(shader) {
      shader.uniforms.uClouds = { value: cloudShadowVecs };
      shader.uniforms.uCloudP = { value: cloudShadowPar };
      shader.uniforms.uCloudAmt = CLOUD_AMT_U;
      for (var csk in CLOUDSH_U) shader.uniforms[csk] = CLOUDSH_U[csk];
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosC;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPosC = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosC;\nuniform vec4 uClouds[12];\nuniform vec4 uCloudP[12];\nuniform float uCloudAmt;\n' + CS_GLSL + '\n' + CS_SLOT_GLSL)
        .replace('#include <map_fragment>', [
          '#include <map_fragment>',
          'float cshT = csFieldT(vWorldPosC, uCloudAmt);', // la luz que llega a ESTE punto tras cruzar el cuerpo de nube (el mismo campo que apaga el disco)
          'float csh2 = csSlot(vWorldPosC.xz);', // la sombra LOCAL proyectada de la nube de prueba: solo ese pedazo pierde la directa
          'diffuseColor.rgb *= mix(1.0, cshT * (1.0 - csh2 * 0.62), uCloudAmt);' // ×(1 − 0,62·sombra): dentro queda el piso difuso del resto del cielo, nunca negro
        ].join('\n'));
    }

    /* ============ REBOTE DEL SUELO — luz indirecta analítica (sin raytracing) ============
       El suelo iluminado es una fuente secundaria Lambertiana: irradia
       hacia arriba GHI·ρ (ρ = albedo del césped) y una superficie
       inclinada β respecto de la horizontal recibe de ese hemisferio
       inferior el término de la fórmula de superficie inclinada de
       Perez: GHI·ρ·(1−cos β)/2 — nulo en caras horizontales (el suelo
       no se rebota a sí mismo), GHI·ρ/2 en caras VERTICALES como las
       lápidas y GHI·ρ en techos invertidos. En día despejado ese
       término (100 W/m² de banda ancha sobre una cara vertical, con
       GHI ~1000 W/m² y ρ = 0,20) es comparable a TODA la difusa del
       cielo sobre esa misma cara (DHI/2 ≈ 60 W/m²): sin él, las caras
       de los props que no miran al sol solo recibían la mitad de la
       hemisférica y salían casi negras contra un suelo bien iluminado
       (reporte de Guille, 2026-11-22 08:25).
       La emulación es ese término exacto dentro de la ÚNICA tubería de
       luz: el parche suma a la luz indirecta uBounce·albedo·(1−cos β)/2
       con cos β = componente Y de la normal (las geometrías de chunk
       ya traen las normales en orientación de mundo; el grupo solo
       traslada). uBounce lo escribe weather.js CADA FRAME desde la
       misma cadena que todo lo demás: irradiancia que de verdad cae
       sobre el suelo este frame (directa de la fuente activa × T de
       nubes × sen(elevación) + difusa DHI × piso de nube), albedo ρ
       del suelo de BANDA ANCHA para la ENERGÍA (0,20 con el césped
       verde → 0,40 con el seco paja, ×0,90 mojado; el de banda ancha
       está dominado por el NIR invisible, ~50 %, por eso energía y
       color van por separado) y para el COLOR un tinte DERIVADO del
       estado del césped (v50, corrección de Guille): mezcla por la
       fracción de hierba seca (SEASON_DRY_U) entre el espectro verde
       medido (JPL ECOSTRESS: azul 0,041 / verde 0,110 / rojo 0,052) y
       el del pasto seco, ambos normalizados a media 1 y comprimidos
       hacia el neutro — verdoso TENUE con pasto verde, CÁLIDO paja
       con pasto seco, nunca una constante verde. Y es un aporte
       SECUNDARIO: sin nubes y al mediodía el escalar vale ~0,13 de
       luminancia (la luz principal de la piedra es el sol directo
       sobre su albedo real); al ocaso colapsa con el GHI y de noche
       sigue a la luna en la calibración de la escena. El suelo mismo
       NO recibe el parche (β=0 → término 0). */
    var BOUNCE_U = { uBounce: { value: new THREE.Color(0, 0, 0) } };
    function applyBouncePatch(shader) {
      shader.uniforms.uBounce = BOUNCE_U.uBounce;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vBounceNy;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvBounceNy = objectNormal.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBounceNy;\nuniform vec3 uBounce;')
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          // (1 − cos β)/2 con cos β = normal.y: 0 arriba, ½ en vertical, 1 abajo
          'reflectedLight.indirectDiffuse += uBounce * diffuseColor.rgb * clamp(0.5 * (1.0 - vBounceNy), 0.0, 1.0);'
        ].join('\n'));
    }

    /* ============ INTERIOR SIN LUZ PROPIA — la difusa entra por la abertura (v59) ============
       Pregunta de Guille (2026-11-22 12:58, foto 1000273378): ¿qué
       criterio rige la iluminación de una habitación sin lámpara?
       ¿No debería ser más oscura? ¿Cómo se controla?
       EL CRITERIO QUE HABÍA: ninguno para el interior. La luz DIRECTA
       sí obedece al recinto (el mapa de sombras la corta en el techo
       y las paredes), pero la DIFUSA — la hemisférica, que es la luz
       del cielo DHI·(1+cos β)/2 de la fórmula de superficie
       inclinada, más el rebote del suelo — es GLOBAL en three.js:
       la hemisférica no tiene sombras ni oclusión, así que una pared
       interior recibía exactamente la misma difusa que una pared
       exterior en sombra. Por eso el interior del panteón se leía
       entero a cualquier hora: al atardecer la DHI cae ~20×, pero la
       adaptación de exposición de la escena la volvía a levantar y
       el interior parecía tener luz propia.
       LA LEY FÍSICA: una habitación sin fuente propia solo recibe la
       luz que cruza sus ABERTURAS. Para un punto interior, la
       iluminancia difusa es la exterior multiplicada por la fracción
       del hemisferio que ocupa la abertura vista desde ese punto —
       su ángulo sólido Ω ≈ A/d² (A = área de la puerta, d = distancia
       del punto a la puerta): es el «factor de luz diurna» clásico
       de la iluminación natural. Junto a la puerta vale ~½ (la pared
       ya tapa medio cielo), al fondo de un cuarto chico cae a unos
       pocos %, y las interreflexiones entre paredes dejan un piso
       bajo y uniforme. Y como el factor MULTIPLICA a la difusa
       exterior de este frame (la que weather.js deriva de la DHI
       real tras las nubes y el camino de aire), el interior hereda
       su proporción sin ninguna constante nueva: mediodía →
       interior tenue pero legible cerca de la puerta; atardecer →
       la DHI colapsa y el interior se va a negro con solo un
       resplandor leve junto a la entrada; noche de luna → su difusa,
       atenuada por el mismo factor.
       LA EMULACIÓN (sin raytracing, en la misma tubería única): el
       parche escala reflectedLight.indirectDiffuse — SOLO la
       indirecta: hemisférica y rebote — por el factor de abertura
       en los fragmentos que caen DENTRO de la cavidad del panteón.
       La directa no se toca: el sol que entra por la puerta ya lo
       dibuja el mapa de sombras, y la linterna (directa puntual)
       sigue alumbrando el interior a plena potencia, como debe ser.
       DETECCIÓN DE LA CAVIDAD por fragmento, sin datos extra: los
       panteones nacen en la retícula de chunks (30 m) siempre en el
       mismo sitio local (11, 11) y con la misma planta (geometry.js:
       W 4,6 × D 3,9, pared 0,28, alto 3,0; puerta de 1,2 × 2,3 en el
       frente, que tras el giro de π de world.js mira a −Z local):
       la posición local sale de mod(posición, 30) y un fragmento es
       interior si cae en la cavidad (|lx| ≤ 2,08, |lz| ≤ 1,73,
       y ≤ 3,05 — las caras internas de las paredes viven justo en
       ese borde) o si, estando en la cáscara de la pared, su normal
       mira hacia la cavidad (las caras internas de frente y fondo
       que en x sobresalen de la cavidad). Las caras EXTERIORES
       quedan fuera por las dos vías (posición y normal), la silueta
       lejana también (su caja es mayor que la cáscara), y ningún
       otro objeto usa estos materiales dentro de esa caja (world.js
       reserva la parcela del panteón: sin tumbas con lx>7 y lz>7).
       EL FACTOR: f = clamp(A/(A + π·d²), 0,03, 0,55), con A = 2,76 m²
       (el área real de la puerta) y d la distancia al centro de la
       puerta (0, 1,15, −1,81 local): 0,42 sobre el suelo junto al
       umbral, ~0,20 a mitad de la sala, ~0,07 junto a la pared del
       fondo; el piso 0,03 es la interreflexión entre las placas
       (albedo del mármol ~0,25: la luz que entra rebota unas veces
       y deja un resto uniforme). uInterior (DEBUG → ILUMINACIÓN,
       slider LUZ INTERIOR) lo escala para que Guille lo calibre:
       100 % = el factor físico derivado; 0 % = interior a oscuras.
       estimateLightAt (scene.js) aplica la MISMA función en CPU a
       la legibilidad de placas: los nichos interiores obedecen esta
       ley también para leerse (sin linterna, al atardecer no se
       leen). Se aplica a los materiales que visten el interior —
       mármol, placa, puerta y hierro — en world.js (marca '_int'
       en la clave de caché de programa). El ORDEN de la cadena
       importa: este parche se aplica ANTES que el del rebote para
       que su código quede DESPUÉS en el shader (cada parche inserta
       tras el #include compartido) y escale también lo que el
       rebote suma a la indirecta. */
    var INT_U = { uInterior: { value: 1 } };
    var INT_DOOR_DEFAULT = { value: 1 }; // puerta «abierta» por defecto: los chunks sin panteón no tienen cavidad y los panteones anteriores a la v65 abrían siempre
    var INT_BEAM_DEFAULT = { value: new THREE.Color(0, 0, 0) }; // sin haz servido: rebote cero
    function applyInteriorPatch(shader, mausCfg) {
      shader.uniforms.uInterior = INT_U.uInterior;
      /* REBOTE DEL HAZ DE LA VENTANA (v70, pedido de Guille con
         foto: «que también proyecte un poco de luminiscencia
         adentro y no solamente se vea el rayo como algo fijo — una
         especie de iluminación dinámica»): la ley de aberturas de
         arriba reparte la difusa que entra por puerta y ventana,
         pero es ESTÁTICA por chunk (el ángulo sólido no sabe si el
         sol está frente a la ventana ni si una nube lo tapó) y el
         parche real del suelo no devolvía nada a la sala: el
         interior quedaba negro salvo el rayo. El término nuevo es
         el primer rebote de ese parche: uBeamBounce es un uniform
         POR CHUNK (mausCfg.beamU, el mismo patrón que doorU) que
         updateWindowBeam (world.js) escribe CADA FRAME solo para
         el panteón servido por el haz, con color × intensidad de
         la MISMA ley del haz (E_frame × τ del cristal × Fresnel,
         factor luna incluido): si el sol se mueve, una nube lo
         tapa o la ventana deja de mirar a la fuente, la luminiscencia
         de la sala respira con él — dinámica porque sigue a la
         fuente, no un relleno fijo. Se suma a la indirecta SOLO
         dentro de la cavidad (iIn), tras el escalado de aberturas. */
      shader.uniforms.uBeamBounce = (mausCfg && mausCfg.beamU) ? mausCfg.beamU : INT_BEAM_DEFAULT;
      /* PUERTA CON ESTADO (v65): el término de la puerta en Ω se
         multiplica por uDoorOpen — un uniform POR CHUNK (mausCfg.
         doorU, lo crea world.js): 0 con la puerta cerrada o el
         panteón sellado (por la puerta no entra NADA: solo queda la
         ventana, si la hay, y el piso de interreflexión), y sube con
         el giro de la hoja al abrirse. La ventana no se toca: su
         abertura es real abra o no la puerta. */
      shader.uniforms.uDoorOpen = (mausCfg && mausCfg.doorU) ? mausCfg.doorU : INT_DOOR_DEFAULT;
      /* PLANTA Y VENTANA (v60/v64): la cfg la trae world.js desde
         buildMausoleum — la planta REAL de ESTE panteón (clásica
         4,6 × 3,9 × 3,0 o grande 5,9 × 5,0 × 3,45) y, si la lleva,
         su ventana ÚNICA (centro en coords del chunk y A·T del
         cristal sorteado). La detección de cavidad y la distancia a
         la puerta se hornean con esa planta; el ángulo sólido de la
         ventana se SUMA al de la puerta en la misma ley — Ω total =
         A_puerta/d² + A_ventana·T_vidrio/d², y el factor es
         Ω/(Ω+π), que para la puerta sola reproduce EXACTO la
         fórmula de la v59 (A/(A+π·d²)). Sin panteón en el chunk,
         mausCfg es null y se hornea la planta clásica (idéntico a
         la v63: no hay cavidad que detectar). Las constantes van
         horneadas en el GLSL y la clave de caché de programa de
         world.js lleva la marca de tamaño y ventana: cada
         combinación compila su propio programa. */
      var halfW = mausCfg ? mausCfg.halfW : 2.3, halfD = mausCfg ? mausCfg.halfD : 1.95, mH = mausCfg ? mausCfg.H : 3.0;
      var cavX = (halfW - 0.22).toFixed(2), cavZ = (halfD - 0.22).toFixed(2);
      var shX = (halfW + 0.06).toFixed(2), shZ = (halfD + 0.06).toFixed(2);
      var topY = (mH + 0.05).toFixed(2), shTopY = (mH + 0.08).toFixed(2);
      var doorOff = (halfD - 0.14).toFixed(2); // el centro de la puerta queda a −(D/2 − T/2) en el eje local del shader
      var iOmLines = ['  float iOm = (2.76 * uDoorOpen) / max(iDist * iDist, 0.04);'];
      if (mausCfg && mausCfg.winKey) {
        var wAT = mausCfg.winAT.toFixed(3), wX = mausCfg.winX.toFixed(2), wZ = mausCfg.winZ.toFixed(2);
        iOmLines.push('  float iDw1 = length(vec3(iLx - ' + wX + ', vIntWp.y - 1.85, iLz - ' + wZ + '));');
        iOmLines.push('  iOm += ' + wAT + ' / max(iDw1 * iDw1, 0.04);');
      }
      iOmLines.push('  float iAp = clamp(iOm / (iOm + 3.14159), 0.03, 0.55);');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vIntWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvIntWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vIntWp;\nuniform float uInterior;\nuniform float uDoorOpen;\nuniform vec3 uBeamBounce;')
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          // posición local al panteón de ESTE chunk (retícula de 30 m, centro local (11, 11))
          'float iLx = mod(vIntWp.x - 11.0 + 15.0, 30.0) - 15.0;',
          'float iLz = mod(vIntWp.z - 11.0 + 15.0, 30.0) - 15.0;',
          // dentro de la cavidad (las caras internas de las paredes viven en su borde, tolerancia incluida)
          'float iInCav = step(abs(iLx), ' + cavX + ') * step(abs(iLz), ' + cavZ + ') * step(vIntWp.y, ' + topY + ') * step(-0.10, vIntWp.y);',
          // o en la cáscara de la pared con la normal mirando a la cavidad (caras internas de frente/fondo fuera del rango x de la cavidad)
          'vec3 iN = inverseTransformDirection(normalize(vNormal), viewMatrix);',
          'float iFaceIn = step(dot(iN.xz, vec2(iLx, iLz)), -0.01);',
          'float iInShell = step(abs(iLx), ' + shX + ') * step(abs(iLz), ' + shZ + ') * step(vIntWp.y, ' + shTopY + ') * step(-0.10, vIntWp.y);',
          'float iIn = max(iInCav, iInShell * iFaceIn);',
          'if (iIn > 0.5) {',
          '  float iDist = length(vec3(iLx, vIntWp.y - 1.15, iLz + ' + doorOff + '));' // distancia al centro de la puerta (local (0, 1,15, −(D/2−T/2)))
        ].concat(iOmLines, [
          '  reflectedLight.indirectDiffuse *= mix(1.0, clamp(iAp * uInterior, 0.0, 1.0), iIn);',
          '  reflectedLight.indirectDiffuse += uBeamBounce * iIn * iAp;', // v70: primer rebote del parche del haz — la sala entera se luminisce un poco, no solo el rayo · CORRECCIÓN v72 (reporte de Guille 20:50: el interior quedaba INUNDADO de luz cálida): el término se sumaba PLANO a toda la cavidad, sin pasar por la ley de aberturas — una sala cerrada recibía el mismo rebote en el fondo que junto a la ventana. Ahora lo modula iAp (el factor de abertura de esta misma ley: ~0,4 junto a la puerta/ventana, ~0,07 al fondo): el resplandor ilumina, pero apenas, y decae hacia adentro como el rebote real.
          '}'
        ]).join('\n'));
    }

    /* ============ CONTRALUZ (v65, pedido de Guille con foto) ============
       La foto de referencia: fuente cálida DETRÁS del sujeto, la cara
       frontal en sombra y un borde luminoso que recorre la silueta,
       con velo de lente. En esta escena el fenómeno se reparte en la
       tubería que ya existe — la cara en sombra sale sola de la única
       luz direccional (la cara que no mira a la fuente no recibe
       directa) y el velo es el #sunGlare del cielo — y lo que faltaba
       es el BORDE: la luz que roza la silueta cuando la fuente está
       detrás del objeto respecto de la cámara. Este parche lo suma
       como término de la misma tubería: color e intensidad son LOS
       de la fuente activa de este frame (sol de día, luna de noche —
       weather.js escribe uBackDir/uBackCol desde la misma luz
       direccional, con su T de nubes y su color de camino de aire:
       al atardecer el borde es naranja porque la fuente lo es, sin
       tinte hardcodeado), y la geometría es la del fenómeno:
       rim = (1 − |N·V|)⁵ — máximo en el limbo de la silueta, cero de
       frente — por la compuerta de contraluz ( −V·L )¹⁰ y por el
       factor de roce con la luz (1 − |N·L|)². Se suma a la indirecta
       para no reabrir la directa ya sombreada por el mapa.
       CORRECCIÓN v67 (reporte de Guille tras la v66: «solo veo un
       resplandor permanente cada vez que miro el sol, brilla
       mucho»): la v65 sumaba el término SIN modular por el albedo,
       con compuerta ( −V·L )³ — 0,65 a 30° del sol, 0,35 a 45° — y
       ganancia 0,38 × intensidad ≈ 3,0 ≈ 1,14: sobre el SUELO
       (plano a vista rasante, N·V → 0 en todo el terreno visible)
       y sobre las caras planas de las tumbas perpendiculares a la
       vista (rim constante = 1 en toda la cara) eso no era un
       borde: era un velo cálido permanente sobre medio encuadre
       cada vez que se miraba hacia el sol. El borde de la foto de
       referencia vive SOLO en la silueta del objeto INTERPUESTO —
       a pocos grados del disco en pantalla — y la cara frontal del
       objeto queda en sombra. Por eso: (1) la compuerta sube a la
       potencia 10 — a 30° vale 0,03, a 15° ≈ 0,42: el rim solo
       existe en la vecindad del disco, donde está el objeto que lo
       tapa —; (2) el factor (1 − |N·L|)² apaga las caras que miran
       a la cámara o a la fuente (la frontal interpuesta queda en
       sombra, como en la foto) y deja solo las superficies
       rasantes a AMBOS rayos, vista y luz: el limbo; (3) el rim
       sube a la potencia 5 (banda más fina); (4) la ganancia baja
       0,38 → 0,22 (weather.js); y (5) el SUELO pierde el parche:
       un plano sin silueta no tiene borde que encender — su
       respuesta hacia el sol ya es su directa iluminada más la
       aureola del cielo. Las colinas lo conservan: su cresta SÍ es
       la silueta del horizonte. */
    var BACKLIGHT_U = {
      uBackDir: { value: new THREE.Vector3(0, 1, 0) },
      uBackCol: { value: new THREE.Color(0, 0, 0) }
    };
    function applyBacklightPatch(shader) {
      shader.uniforms.uBackDir = BACKLIGHT_U.uBackDir;
      shader.uniforms.uBackCol = BACKLIGHT_U.uBackCol;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBackWp;\nvarying vec3 vBackN;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvBackWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBackN = normalize(mat3(modelMatrix) * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBackWp;\nvarying vec3 vBackN;\nuniform vec3 uBackDir;\nuniform vec3 uBackCol;')
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          'vec3 bV = normalize(cameraPosition - vBackWp);',
          'vec3 bN = normalize(vBackN);',
          'float bRim = pow(1.0 - abs(dot(bN, bV)), 5.0);', // v67: banda fina (potencia 5, antes 3)
          'float bGate = pow(clamp(dot(-bV, uBackDir), 0.0, 1.0), 10.0);', // v67: compuerta estrecha (potencia 10, antes 3) — el borde solo vive a pocos grados del disco en pantalla, donde está el objeto interpuesto
          'float bWrap = pow(1.0 - abs(dot(bN, uBackDir)), 2.0);', // v67: roce con la luz — apaga las caras frontales (a la cámara o a la fuente) y deja solo el limbo rasante a ambos rayos
          'reflectedLight.indirectDiffuse += uBackCol * (bRim * bGate * bWrap);'
        ].join('\n'));
    }

    /* ============ CÁSCARA DE CONTRALUZ (v69, reporte de Guille tras
       la v68 con foto: «sigue sin haber contraluz cuando se intenta
       mirar al sol con un obstáculo en el frente» — el sol asomando
       por la arista vertical de un panteón y NINGÚN borde encendido)
       ============
       DIAGNÓSTICO (en la fuente, con los números de esa foto): el
       término de arriba es un rim de FRESNEL, y el Fresnel vive de
       que la normal varíe sobre la superficie. En una caja de caras
       planas la arista que forma la silueta pertenece a la cara que
       mira a la cámara: N·V ≈ 0,9 en TODA la cara, arista incluida
       → rim = (1 − 0,9)⁵ ≈ 1×10⁻⁵; y esa misma cara apunta en
       contra de la fuente → bWrap = (1 − |N·L|)² ≈ 0,09. Producto
       con uBackCol de mediodía (0,66): ≈ 3×10⁻⁷. El borde es CERO
       por construcción, no por calibración: ninguna ganancia lo
       levanta sin volver a encender la cara entera (el error de la
       v65). El Fresnel queda para lo curvo (columnas, crestas de
       colina, follaje), donde sí funciona.
       Para la arista VIVA hace falta geometría, no otro exponente:
       la técnica clásica sin post-proceso es la CÁSCARA INVERTIDA
       — la geometría opaca del chunk expandida a lo largo de las
       normales y dibujada por su cara trasera (BackSide) en
       aditivo. De la cáscara solo asoma la banda que queda FUERA
       de la huella en pantalla del objeto (el resto lo tapa el
       propio objeto vía depth test): una línea pegada a la
       silueta, exista curva o no. La banda se enciende con dos
       compuertas que son el fenómeno:
       · gateA — el rayo de vista del fragmento contra la dirección
         a la fuente (potencia 24): la línea solo vive en la
         vecindad en pantalla de la fuente, donde el objeto la tapa;
       · gateB — la normal de la cara que GENERA ese tramo de banda
         contra la fuente: el tramo de silueta cuyo vecino tras la
         arista mira al sol (la pared lateral soleada del panteón)
         brilla; el tramo opuesto, cuyo vecino mira en contra, no.
         Es literalmente por qué la arista real brilla: justo tras
         ella hay una cara a pleno sol, y la luz se derrama por el
         borde (difracción + dispersión hacia adelante).
       Color e intensidad: LOS MISMOS uniforms compartidos del
       parche (uBackDir/uBackCol, que weather.js escribe cada frame
       desde la luz direccional activa — sol de día, luna de noche,
       con su T de nubes y su color de camino de aire): si una nube
       tapa el sol, la línea muere con él; al ocaso es naranja
       porque la fuente lo es. Ancho: angular constante (la
       expansión escala con la distancia a la cámara en el vértice)
       ≈ 0,14° ≈ 2–3 px a 1080p — una línea, no un halo. Ganancia
       2,2 sobre uBackCol (v72; era 1,9): a plena alineación ≈ 1,45
       al mediodía, el ACES lo resuelve como el borde quemado de la
       foto. La compuerta de la banda es la CORREGIDA en v72 (ver el
       fragment): rasante a la vista × fuente detrás, no la normal
       mirando a la fuente (eso la anulaba al ocaso).
       La cáscara la construye world.js (una por chunk, solo LOD
       cercano: a >100 m la banda es subpíxel) y sigue el fundido
       del chunk por su uniform uFade. Sin EffectComposer, sin
       render targets: un draw call aditivo por chunk. */
    var RIMHULL_KEYS = { light: 1, mid: 1, dark: 1, moss: 1, marble: 1, cement: 1, plaque: 1, wood: 1, iron: 1, door: 1, doorA: 1, doorB: 1 }; // geometría opaca que forma silueta: piedra, mármol, madera, hierro, puertas — fuera cristal (su óptica es otra) y fuera vegetación (normales variables: su borde lo da el Fresnel, y su cáscara sería una mancha)
    function makeRimHullMaterial() {
      return new THREE.ShaderMaterial({
        uniforms: {
          uBackDir: BACKLIGHT_U.uBackDir, // compartidos con el parche de Fresnel: la misma fuente activa de este frame
          uBackCol: BACKLIGHT_U.uBackCol,
          uFade: { value: 0 },
          uRimWidth: { value: 0.0024 } // tan del semiancho angular de la banda ≈ 0,14°
        },
        vertexShader: [
          'uniform float uRimWidth;',
          'varying vec3 vHullN;',
          'varying vec3 vHullWp;',
          'void main() {',
          '  vec4 wp0 = modelMatrix * vec4(position, 1.0);',
          '  float dCam = max(distance(wp0.xyz, cameraPosition), 0.001);',
          '  vec3 p = position + normal * (uRimWidth * dCam);', // ancho angular constante: la expansión crece con la distancia
          '  vec4 wp = modelMatrix * vec4(p, 1.0);',
          '  vHullWp = wp.xyz;',
          '  vHullN = normalize(mat3(modelMatrix) * normal);', // la normal de la cara que genera este tramo de banda
          '  gl_Position = projectionMatrix * viewMatrix * wp;',
          '}'
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 uBackDir;',
          'uniform vec3 uBackCol;',
          'uniform float uFade;',
          'varying vec3 vHullN;',
          'varying vec3 vHullWp;',
          'void main() {',
          '  vec3 ray = normalize(vHullWp - cameraPosition);',
          '  float gateA = pow(clamp(dot(ray, uBackDir), 0.0, 1.0), 24.0);', // solo junto a la fuente en pantalla
          /* CORRECCIÓN v72 (reporte de Guille 20:46: «la contraluz NO
             funciona»): la compuerta B de la v69 era
             pow(dot(N, uBackDir), 1,5) — la normal de la cara que
             genera la banda debía mirar A LA FUENTE. Pero la banda de
             la silueta la forman las caras RASANTES (la de arriba con
             normal +Y, las laterales con normal ±X): con el sol bajo
             tras el obstáculo — justo la prueba de contraluz — esas
             normales son casi perpendiculares a la dirección de la
             fuente (dot ≈ 0,1–0,3) o directamente negativas (la
             lateral opuesta), y la cáscara valía ~0 por construcción
             en el caso canónico, igual que el Fresnel que venía a
             reemplazar. La condición física no es esa: el borde
             brilla porque la superficie que sigue TRAS la arista (la
             cara que mira a la fuente) está iluminada y la luz se
             dispersa hacia adelante bordeando la silueta; en la
             cáscara eso se lee como RASANTE a la vista (la banda vive
             donde la superficie se pone de canto: 1 − |N·rayo| ≈ 1)
             con la fuente detrás del objeto (gateA). La nueva
             compuerta: rasante^1,5 × un factor de fuente SUAVE
             (0,35–1: la cara cuyo exterior mira algo a la fuente
             aporta pleno; la opuesta no se apaga del todo, porque la
             dispersión rodea la arista convexa entera). Ganancia
             1,9 → 2,2 para compensar el uBackCol ya atenuado al ocaso. */
          '  float bNn = dot(normalize(vHullN), uBackDir);',
          '  float gateB = pow(1.0 - abs(dot(normalize(vHullN), ray)), 1.5) * (0.35 + 0.65 * clamp(bNn * 0.5 + 0.5, 0.0, 1.0));',
          '  float a = gateA * gateB * uFade;',
          '  if (a < 0.004) discard;',
          '  gl_FragColor = vec4(uBackCol * 2.2, a);',
          '}'
        ].join('\n'),
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
      });
    }

    /* ============ CALIBRACIÓN EN VIVO DEL REBOTE Y DEL SOL EN LA PIEDRA ============
       Controles del menú DEBUG → ILUMINACIÓN (a pedido de Guille,
       v51): tres perillas para que ÉL fije la calibración definitiva
       probando en vivo; 1 = el valor que sale de la física de la
       escena, y lo que él elija pasa a ser el default a aplicar.
       · BOUNCE_CTL.gain — intensidad del rebote del suelo (multiplica
         el escalar que weather.js calcula cada frame).
       · BOUNCE_CTL.tintForce — fuerza del tinte DERIVADO del césped:
         0 = rebote neutro (luz sin color), 1 = el tinte derivado tal
         cual, >1 = exagerado. Escala la desviación del tinte
         respecto del neutro (1,1,1).
       · STONE_SUN_U — ganancia de la luz DIRECTA solo sobre la piedra
         de cemento (el parche de abajo escala reflectedLight.
         directDiffuse tras lights_fragment_end, únicamente en los
         materiales de piedra/placa de los chunks): la directa global
         del sol NO se toca — esto permite subir el sol sobre las
         tumbas sin lavar el suelo ni el cielo. */
    /* CALIBRACIÓN FIJADA POR GUILLE (v52, probando en vivo con los
       sliders de v51): rebote del suelo en 0 (sin relleno de rebote:
       las caras viven del sol directo y de la hemisférica) y sol
       directo sobre el cemento al 150 %. Los sliders siguen activos
       para seguir probando; RESETEAR vuelve a ESTOS valores. */
    var BOUNCE_CTL = { gain: 0, tintForce: 1 };
    var STONE_SUN_U = { value: 1.5 };
    function applyStoneSunPatch(shader) {
      shader.uniforms.uStoneSun = STONE_SUN_U;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uStoneSun;')
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          'reflectedLight.directDiffuse *= uStoneSun;'
        ].join('\n'));
    }

    /* ============ MÁRMOL PULIDO de los panteones (v52, pedido de Guille) ============
       Los panteones dejan la piedra de cemento de las tumbas y pasan
       a PLACAS DE MÁRMOL REAL: textura fotográfica CC0 (ambientCG
       Marble001, local en assets/, sin fetch en runtime) con su
       mapa de rugosidad medido de la placa pulida (media ~0,17: el
       brillo especular del sol sale del GGX del material físico con
       ESE mapa — vetas más mates ~0,5, campo pulido ~0,1 — más una
       capa clearcoat que hace de barniz de pulido) y su normal GL
       atenuada (0,5: placa pulida, relieve apenas insinuado). SIN
       bumpMap derivado del color: la rejilla de la v51 no vuelve.
       DISPERSIÓN INTERNA (SSS sin raytracing): el mármol real es
       translúcido a escala de milímetros–centímetros — la luz entra,
       se dispersa entre los cristales de calcita y sale por los
       alrededores: el terminador luz/sombra se ABLANDA (la luz
       «sangra» un poco pasado el borde geométrico). Emulación barata
       en el parche, con la MISMA tubería única: uMarbleSSS lo
       escribe weather.js cada frame con el color × intensidad de la
       fuente activa tras las nubes (sol de día, luna de noche), y la
       dirección sale de uCSunDir (el uniform compartido del parche
       de sombras de nube). Término WRAP: (NdotL + 0,15)/1,15 al
       cuadrado × 0,20, ∝ albedo (las vetas oscuras dispersan menos,
       como en la placa real).
       CORRECCIÓN v53 (reporte de Guille, foto 1000273349: las caras
       opuestas al sol del panteón no caían en sombra — «parece que
       el edificio tuviera su propia iluminación»): la ley es la de
       siempre y no admite términos extra — el sol es una fuente
       direccional: una cara con NdotL ≤ 0 NO recibe luz directa,
       solo la difusa del cielo (hemisférica, factor de vista
       (1+cos β)/2) y el rebote del suelo; y lo que el edificio
       bloquea cae en sombra por el mapa de sombras sobre la directa
       real. La v52 violaba esa ley dos veces, sumando a
       directDiffuse DESPUÉS de lights_fragment_end (es decir, sin
       pasar por el mapa de sombras ni por el terminador):
       (1) el término THRU de transmisión a contraluz — su factor
       (1 − NdotL)/2 vale 1 EXACTAMENTE sobre la cara opuesta al sol
       y brillaba hasta 0,35 × fuente × albedo sobre la pared
       entera. La transmisión a través del mármol solo existe en
       espesores de mm–cm (una placa fina a contraluz); a través de
       una pared de decenas de cm la atenuación de Beer–Lambert la
       lleva a cero. Sin espesor en la fórmula, el término era luz
       inventada: ELIMINADO.
       (2) el WRAP con desplazamiento 0,55 entregaba sol directo a
       caras giradas hasta ~33° más allá del terminador; el camino
       libre medio de la dispersión en el mármol es de milímetros,
       así que a escala de edificio el sangrado solo puede cubrir
       una banda angosta junto al terminador: desplazamiento
       0,55 → 0,15 (la cara con NdotL ≤ −0,15 recibe exactamente
       cero; a NdotL = 0 el aporte es ~0,3 % de la fuente). El
       residuo sin sombra del wrap queda confinado a esa banda de
       ~9°, donde vive la penumbra geométrica.
       Resultado: la cara opuesta al sol queda iluminada SOLO por el
       cielo (y el rebote si Guille lo sube), como manda la fórmula
       de superficie inclinada. Nada de esto toca al cemento (parche
       solo-mármol, world.js lo aplica únicamente a 'marble').
       CORRECCIÓN v57 (reporte de Guille con foto, 2026-11-22 12:13:
       «en el suelo del interior del panteón pasa luz por los
       bordes»): quedaba UNA fuga de la misma familia — el término
       wrap, ya reducido a su banda física en v53, seguía sumándose
       DESPUÉS del mapa de sombras, así que sobre el suelo INTERIOR
       del panteón (normal +Y, mbWrap ≈ 0,93 al mediodía) vertía
       ~0,17 × fuente × albedo de sol directo SIN que el techo
       existiera: el interior recibía luz de la fuente como si el
       edificio no tuviera techo, y esa luz inventada se leía
       pegada a las juntas, donde el ojo compara contra la pared en
       sombra. La dispersión interna es luz de la fuente que entró
       en la placa: obedece a la MISMA oclusión que la directa. El
       término ahora se multiplica por mbVis, el factor de sombra
       de la luz direccional recalculado con la llamada getShadow
       idéntica a la del motor (mapa, bias, radio e intensidad de
       la propia luz): en sombra plena vale lo que valga la sombra
       (0 en la práctica) y en la penumbra se desvanece con ella.
       Fuera, a pleno sol, mbVis = 1 y el ablandado del terminador
       queda como en v53. */
    var MARBLE_U = { uSSS: { value: new THREE.Color(0, 0, 0) } };
    function applyMarblePatch(shader) {
      shader.uniforms.uMarbleSSS = MARBLE_U.uSSS;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uMarbleSSS;')
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          'vec3 mbN = inverseTransformDirection(normalize(vNormal), viewMatrix);',
          'float mbWrap = clamp((dot(mbN, uCSunDir) + 0.15) / 1.15, 0.0, 1.0);',
          // VISIBILIDAD DE LA FUENTE (v57): la dispersión nace de la
          // luz que de verdad ALCANZA este punto — si el techo del
          // panteón (o cualquier oclusor) tapa la fuente, no hay
          // fotones que dispersar. El factor es el MISMO getShadow
          // con el que el motor atenuó la directa de esta luz (mismo
          // mapa, mismo radio PCF, misma intensidad de sombra): donde
          // la directa muere, la dispersión muere con ella, y a
          // través de la penumbra se desvanece en la misma medida.
          'float mbVis = 1.0;',
          '#ifdef USE_SHADOWMAP',
          '#if NUM_DIR_LIGHT_SHADOWS > 0',
          'mbVis = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );',
          '#endif',
          '#endif',
          'reflectedLight.directDiffuse += uMarbleSSS * diffuseColor.rgb * mbWrap * mbWrap * 0.20 * mbVis;'
        ].join('\n'));
    }

    /* ============ CRISTALES DE LAS VENTANAS DEL PANTEÓN (v60) ============
       Pedido de Guille: ventanas con cristales con shader, gruesos o
       finos según el vidrio, con distinta incidencia de la luz. La
       física de un paño de vidrio tiene DOS efectos que dependen del
       ángulo de incidencia, y el parche implementa los dos con la
       óptica real, sin constantes de «brillo» a ojo:
       (1) FRESNEL (Schlick con F₀ físico): el vidrio común tiene
       IOR 1,52 → F₀ = ((1,52−1)/(1,52+1))² = 0,0426. De frente
       refleja ~4 % y deja pasar el resto; a incidencia rasante la
       reflectancia tiende a 1: TODO vidrio se vuelve espejo al
       mirarlo de costado, y eso — no un tinte — es lo que apaga la
       vista a través del paño al mover la cámara.
       (2) BEER–LAMBERT POR EL CAMINO REAL: el rayo refractado
       (Snell, sen²θt = sen²θi/1,52²) recorre dentro del paño una
       distancia t/cos θt, y la absorción es exp(−α·t/cos θt) por
       canal. El α del vidrio sodocálcico con hierro absorbe más el
       rojo y el azul que el verde: de ahí el tinte verdoso del
       vidrio grueso, que CRECE con el espesor y con la oblicuidad.
       LOS TRES TIPOS que sortea geometry.js difieren en t y α:
       · FINO (6 mm, α bajo): a incidencia normal transmite ~95 %
         (alfa del fragmento ~0,05, réplica numérica); el interior
         se ve nítido.
       · GRUESO (24 mm, α ×5): transmite ~83 % (alfa ~0,17) con
         tinte verde marcado en el canto y a rasante; es el vidrio
         viejo. A incidencia rasante los tres tienden a espejo
         (alfa 0,79–0,91 por Fresnel): la incidencia manda.
       · ESMERILADO (12 mm, superficie rugosa 0,55): la transmisión
         directa cae a ~45 % — el resto se DIFUNDE: el paño se lee
         lechoso, no deja ver formas y BRILLA a contraluz (el término
         de resplandor de abajo, alimentado por la fuente activa).
       El reflejo especular del sol sale del GGX del material con su
       rugosidad por tipo (el destello se mueve con la cámara y con
       el sol, como en un vidrio real), y el reflejo del CIELO se
       suma por Fresnel desde UW.sky — el mismo color de cielo que
       reflejan los charcos (wet.js), de la tubería única: de noche
       el reflejo sigue a la luna y con nubes se apaga con ellas.
       GLASS_U.uSun lo escribe weather.js por frame con el color ×
       intensidad de la fuente activa, la misma escala que alimenta
       la dispersión del mármol (MARBLE_U). El alfa final del
       fragmento ES la física: alfa = 1 − T·(1−F) — el material es
       transparente de verdad y lo que hay detrás (el interior del
       panteón, con su ley de luz por aberturas) se ve a través,
       atenuado por el paño. El cristal NO proyecta sombra (world.js
       apaga su castShadow): el sol entra por la ventana al interior
       vía el hueco de la pared, como en la realidad; un vidrio que
       bloqueara el sol como una pared sería la mentira contraria. */
    var GLASS_U = { uSun: { value: new THREE.Color(0, 0, 0) } };
    var GLASS_TYPES = {
      glassThin:  { thick: 0.006, absorb: [1.4, 0.7, 1.6], rough: 0.06, frost: 0, clear: 1.0, sky: 1.0, tint: 0xf2f7f4 },
      glassThick: { thick: 0.024, absorb: [7.0, 3.0, 8.0], rough: 0.16, frost: 0, clear: 1.0, sky: 1.0, tint: 0xd8ecd9 },
      glassFrost: { thick: 0.012, absorb: [2.2, 1.6, 2.4], rough: 0.55, frost: 1, clear: 0.45, sky: 0.35, tint: 0xecefe8 }
    };
    function applyGlassPatch(shader, gt) {
      shader.uniforms.uGlassSun = GLASS_U.uSun;
      shader.uniforms.uGlassSky = UW.sky; // el color del cielo de los charcos (wet.js): un solo cielo para todo reflejo
      shader.uniforms.uGlassSunDir = CLOUDSH_U.uCSunDir;
      var th = gt.thick.toFixed(4);
      var ab = gt.absorb;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGlassWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWp;\nuniform vec3 uGlassSun;\nuniform vec3 uGlassSky;\nuniform vec3 uGlassSunDir;\nfloat gGF = 0.0426;\nfloat gGT = 0.9;\nvec3 gGN = vec3(0.0, 1.0, 0.0);')
        .replace('#include <map_fragment>', [
          '#include <map_fragment>',
          'float gOpA = diffuseColor.a;', // la opacidad del material trae el fundido de entrada del chunk: el alfa físico la multiplica, no la pisa
          'vec3 gNw = inverseTransformDirection(normalize(vNormal), viewMatrix);',
          'vec3 gVw = normalize(cameraPosition - vGlassWp);',
          'float gCosI = clamp(abs(dot(gNw, gVw)), 0.0, 1.0);',
          // Fresnel Schlick, F₀ = 0,0426 (IOR 1,52): de frente casi nada, a rasante espejo
          'gGF = 0.0426 + 0.9574 * pow(1.0 - gCosI, 5.0);',
          // Snell: el camino dentro del paño es t/cos θt — crece con la oblicuidad
          'float gCosT = sqrt(max(0.05, 1.0 - (1.0 - gCosI * gCosI) / 2.3104));',
          // Beer–Lambert por canal con el α del tipo: el grueso absorbe ~5× y tiñe verdoso
          'vec3 gBeer = exp(vec3(' + ab[0].toFixed(2) + ', ' + ab[1].toFixed(2) + ', ' + ab[2].toFixed(2) + ') * (-' + th + ' / gCosT));',
          'gGT = dot(gBeer, vec3(0.3333)) * (1.0 - gGF);',
          // el alfa del fragmento ES la transmisión: lo de detrás se ve atenuado por el paño
          'diffuseColor.a = clamp(1.0 - gGT * ' + gt.clear.toFixed(2) + ', 0.03, 1.0) * gOpA;',
          'gGN = gNw;'
        ].join('\n'))
        .replace('#include <lights_fragment_end>', [
          '#include <lights_fragment_end>',
          // reflejo del cielo por Fresnel (el GGX del material ya da el destello del sol/luna)
          'reflectedLight.indirectSpecular += uGlassSky * gGF * ' + gt.sky.toFixed(2) + ';',
          // esmerilado a contraluz: la luz de la fuente que cruza el paño se difunde en él y el paño entero resplandece (solo frost = 1)
          'reflectedLight.indirectDiffuse += uGlassSun * (' + gt.frost.toFixed(1) + ' * 0.55 * gGT);'
        ].join('\n'));
    }

    function buildMaterials(slateImg, ground) {
      /* PIEDRA DE CEMENTO de las tumbas — parámetros reales (informe
         cement-stone-bounce-properties, 2026-11-22; esquema §17). La
         piedra colada de cementerio es hormigón prefabricado que imita
         piedra cortada (ASTM C1364). Su espectro MEDIDO (USGS splib05a,
         hormigón WTC01-37A) sube monótono de azul a rojo — 0,452 a
         450 nm, 0,520 a 550 nm, 0,555 a 650 nm, R/B = 1,23 —: es un
         gris CÁLIDO, no neutro; de esa FORMA, reescalada, salen los
         RGB de abajo (la muestra USGS es un hormigón claro ~0,52: se
         usa su forma, no su nivel). Albedo de banda ancha MEDIDO:
         nueva 0,35–0,40 (ACPA/Levinson & Akbari, LBNL), meteorizada
         0,20–0,30 → la tumba típica es la METEORIZADA, ρ = 0,25, RGB
         lineal (0,27, 0,26, 0,22) ≈ sRGB (143, 138, 130). Las veladuras
         de stoneCanvas dejan el promedio de cada variante en su blanco
         sRGB: light ≈ (168, 164, 153) — piedra nueva/limpia, cerca del
         (171, 166, 156) del informe —; mid ≈ (138, 135, 128) y moss ≈
         (133, 131, 123) — meteorizada —; dark ≈ (113, 110, 104) — el
         extremo bajo del envejecimiento (meteorización −0,06, suciedad
         −0,05, abrasión −0,19, Levinson; la eflorescencia puede
         ACLARAR localmente: el envejecimiento no es monótono).
         Rugosidad GGX 0,90 en seco: CALIBRACIÓN, no medición — no
         existe un valor GGX publicado para esta piedra; se ancla en
         Ra ~1–10 µm del hormigón y en la práctica PBR (piedra/
         hormigón 0,85–0,95). Mojada baja a ~0,40 y el albedo a ~0,13
         (wet.js, WET_CFG.stone). Metalness 0 siempre. */
      var lightTex = stoneCanvas(slateImg, 'rgba(226,220,205,0.68)', 0, 11);
      var midTex = stoneCanvas(slateImg, 'rgba(206,200,188,0.58)', 0.4, 23);
      var darkTex = stoneCanvas(slateImg, 'rgba(182,176,164,0.50)', 0.15, 37);
      var mossTex = stoneCanvas(slateImg, 'rgba(206,202,188,0.55)', 1, 51);
      var stoneBumpTex = stoneBumpCanvas(slateImg); // relieve suavizado compartido (v52): el color ya NO es su propio bump — ver stoneBumpCanvas
      function stone(tex, rough) {
        return new THREE.MeshStandardMaterial({ map: tex, bumpMap: stoneBumpTex, bumpScale: 0.18, roughness: rough || 0.90, metalness: 0.0 });
      }
      MAT.light = stone(lightTex);
      MAT.mid = stone(midTex);
      MAT.dark = stone(darkTex);
      MAT.moss = stone(mossTex);
      MAT.plaque = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.80, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      MAT.plaqueFam = new THREE.MeshStandardMaterial({ map: null, roughness: 0.80, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); // v70: base de las placas FAMILIARES de panteón — world.js le pone a cada chunk su propio atlas familiar (CanvasTexture) sobre el clon; mismos parámetros que la placa general // placa de la misma piedra, cara más lisa (honeada: 0,70–0,80, calibración del informe). polygonOffset (v68): la placa es una lámina sobre la piedra — el offset de profundidad la adelanta en el buffer y corta el parpadeo placa↔piedra a distancia, igual que el del sendero (MAT.dirt); la separación física subió a 15–20 mm en geometry.js
      /* MÁRMOL de los panteones (v52): material FÍSICO — el brillo del
         pulido sale de su mapa de rugosidad real (media ~0,17) leído
         por el GGX según cómo pegue el sol, más clearcoat 0,5 de
         barniz de pulido con su propia rugosidad 0,35; la dispersión
         interna va en applyMarblePatch (arriba). La textura es
         ambientCG Marble001 (CC0): placa blanca veteada, albedo
         medio medido sobre el archivo ≈ (224, 221, 215) sRGB. */
      MAT.marble = new THREE.MeshPhysicalMaterial({ map: ground.marble.diff, normalMap: ground.marble.nor, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: ground.marble.rough, roughness: 1.0, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.35 });
      MAT.foliage = new THREE.MeshStandardMaterial({ color: 0x39512b, roughness: 1 });
      MAT.foliage2 = new THREE.MeshStandardMaterial({ color: 0x2c4423, roughness: 1 });
      MAT.grass = new THREE.MeshStandardMaterial({ color: 0x59783a, roughness: 1, side: THREE.DoubleSide });
      // follaje del ciprés REAL (trees.js): nace como color plano y
      // cuando el GLB termina de cargar recibe su textura fotográfica
      // con recorte alfa (alphaTest, sin blending)
      MAT.cypress = new THREE.MeshStandardMaterial({ color: 0x44543c, roughness: 1, side: THREE.DoubleSide });
      // si el GLB del ciprés cargó ANTES que los materiales, su textura
      // quedó guardada en CYPRESS.tex: se aplica ahora
      if (typeof CYPRESS !== 'undefined' && CYPRESS.tex && typeof cypressApplyTex === 'function') cypressApplyTex(CYPRESS.tex);
      MAT.wood = new THREE.MeshStandardMaterial({ map: darkTex, color: 0x9a7d55, roughness: 1 });
      MAT.iron = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.55, metalness: 0.85 });
      // senderos: tierra con piedras real (difuso + normal + rugosidad).
      // SIN repeat en la textura: el tiling por metro va en las UVs de cada
      // tramo (makePathGeo), idéntico en U y en V — nada se estira.
      ground.path.diff.repeat.set(1, 1);
      ground.path.nor.repeat.set(1, 1);
      ground.path.rough.repeat.set(1, 1);
      MAT.dirt = new THREE.MeshStandardMaterial({ map: ground.path.diff, normalMap: ground.path.nor, roughnessMap: ground.path.rough, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      MAT.door = new THREE.MeshStandardMaterial({ color: 0x201c16, roughness: 0.92 });
      /* VARIEDAD DE PANTEONES (v65, pedido de Guille): el material de
         pared ya no es siempre mármol — el sorteo de buildMausoleum
         elige CEMENTO cepillado (Poly Haven Brushed Concrete, CC0) en
         ~35 % de los panteones. Y las PUERTAS llevan textura real de
         puerta completa (la UV de la caja la mapea entera por cara):
         doorA = pino rústico con paneles (Poly Haven Rough Pine Door,
         CC0) y doorB = puerta de tablones con herrajes (Poly Haven
         Wooden Garage Door, CC0). MAT.door (oscuro liso) queda para
         las cajas de los nichos interiores. */
      MAT.cement = new THREE.MeshStandardMaterial({ map: ground.cement.diff, normalMap: ground.cement.nor, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: ground.cement.rough, roughness: 1.0, metalness: 0.0 });
      MAT.doorA = new THREE.MeshStandardMaterial({ map: ground.doorA.diff, normalMap: ground.doorA.nor, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: ground.doorA.rough, roughness: 1.0, metalness: 0.0 });
      MAT.doorB = new THREE.MeshStandardMaterial({ map: ground.doorB.diff, normalMap: ground.doorB.nor, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: ground.doorB.rough, roughness: 1.0, metalness: 0.0 });
      /* CRISTALES de las ventanas del panteón (v60): un material por
         tipo de vidrio (GLASS_TYPES arriba); su óptica vive en
         applyGlassPatch, que world.js aplica a los clones de chunk.
         transparent de verdad (el interior se ve a través, atenuado)
         y depthWrite apagado: dos paños enfrentados (las dos paredes
         laterales) se mezclan en orden sin que el cercano borre al
         lejano por profundidad. DoubleSide: el paño se lee igual
         desde dentro del panteón. */
      for (var gk60 in GLASS_TYPES) {
        var gt60 = GLASS_TYPES[gk60];
        MAT[gk60] = new THREE.MeshStandardMaterial({ color: gt60.tint, roughness: gt60.rough, metalness: 0.0, transparent: true, opacity: 1.0, side: THREE.DoubleSide, depthWrite: false });
      }

      /* PROFUNDIDAD DE SOMBRA POR LA CARA CERCANA (v58, reporte de
         Guille 12:42/12:43: la franja de luz seguía en TODAS las juntas
         suelo-pared del panteón y en las tumbas tras la v57). Causa
         raíz, verificada en el three.min.js que se sirve: con
         shadowSide = null, WebGLShadowMap renderiza el mapa de
         profundidad con el lado INVERTIDO del material (u[side]:
         FrontSide → BackSide; la rama sin invertir es solo para VSM y
         esto usa PCFShadowMap). El mapa guardaba entonces la
         superficie LEJANA de cada oclusor — la cara interna de la
         pared — y junto a esa cara la profundidad guardada casi
         coincide con la del receptor (el suelo a sus pies, la pared
         perpendicular en la esquina): el margen del bias (~4 cm) no
         alcanza y la comparación deja pasar una línea de luz de
         ~1 téxel pegada a CADA junta, en las cuatro caras y a
         cualquier hora. Guardando la cara CERCANA (la que mira al
         sol), la junta gana de margen todo el grosor de la pared
         (28 cm en el panteón) y la línea desaparece por geometría,
         no por ajuste. El compañero estándar de la profundidad por
         cara cercana es el normalBias (ya en 0,015, scene.js), que
         aparta el punto de muestreo del receptor de su propia
         superficie y mantiene a raya el acné en las caras al sol.
         Solo materiales FrontSide opacos (piedra, mármol, placa,
         madera, hierro, puerta): los DoubleSide (mechones, copas)
         ya resuelven a la superficie cercana por la propia prueba
         de profundidad al dibujar ambas caras. Los clones de chunk
         (world.js) heredan la propiedad. */
      for (var msk in MAT) {
        var mm58 = MAT[msk];
        if (mm58 && mm58.isMeshStandardMaterial && mm58.side === THREE.FrontSide) mm58.shadowSide = THREE.FrontSide;
      }

      var grass = ground.grass, dry = ground.dry;
      groundMat = new THREE.MeshStandardMaterial({
        map: grass.diff, normalMap: grass.nor, roughnessMap: grass.rough, roughness: 1, metalness: 0, color: 0xffffff
      });
      groundMat.map.repeat.set(300, 300);
      groundMat.normalMap.repeat.set(300, 300);
      groundMat.roughnessMap.repeat.set(300, 300);
      /* Variación por zonas con hierba seca real (difuso, normal y rugosidad
         mezclados por ruido de mundo) + sombras de las nubes en el suelo. */
      groundMat.onBeforeCompile = function (shader) {
        // SIN parche de contraluz en el suelo (v67): un plano a vista rasante tiene N·V → 0 en todo el terreno visible, así que el rim lo encendía ENTERO hacia el sol — el «resplandor permanente» del reporte de Guille tras la v66. Un plano no tiene silueta interpuesta que bordear; su respuesta hacia la fuente ya sale de su directa iluminada y de la aureola del cielo. El parche queda en chunks (tumbas/panteones) y colinas (su cresta sí es silueta).
        shader.uniforms.dryMap = { value: dry.diff };
        shader.uniforms.dryNor = { value: dry.nor };
        shader.uniforms.dryRough = { value: dry.rough };
        shader.uniforms.zoneNoise = { value: zoneNoiseTexture() };
        shader.uniforms.uClouds = { value: cloudShadowVecs };
        shader.uniforms.uCloudP = { value: cloudShadowPar };
        shader.uniforms.uCloudAmt = CLOUD_AMT_U;
        for (var csk2 in CLOUDSH_U) shader.uniforms[csk2] = CLOUDSH_U[csk2];
        shader.uniforms.uDryMix = SEASON_DRY_U;
        // humedad del suelo (wet.js): mismos uniforms compartidos que
        // leen los materiales de chunk — un solo estado para todo
        shader.uniforms.uWetW = UW.groundW;
        shader.uniforms.uWetG = UW.groundG;
        shader.uniforms.uWetD = UW.groundD;
        // sendero pintado por el propio suelo (bloque SENDERO en
        // map_fragment): texturas de la tierra y SU estado de humedad
        // (la clase 'path' de wet.js, los mismos objetos compartidos)
        shader.uniforms.pathMap = { value: ground.path.diff };
        shader.uniforms.pathNor = { value: ground.path.nor };
        shader.uniforms.pathRough = { value: ground.path.rough };
        shader.uniforms.uWetPW = UW.pathW;
        shader.uniforms.uWetPG = UW.pathG;
        shader.uniforms.uWetPD = UW.pathD;
        shader.uniforms.uMirage = MIRAGE_U;
        shader.uniforms.uWetTime = UW.time;
        shader.uniforms.uWetRain = UW.rain;
        shader.uniforms.uWetSky = UW.sky;
        shader.uniforms.uFpTex = { value: fpTex };
        shader.uniforms.uFpCenter = fpCenter;
        // viento compartido (los mismos objetos que mecen el césped y
        // las copas): el brillo viajero del detalle de césped de abajo
        shader.uniforms.uWindTime = WIND_TIME_U;
        shader.uniforms.uWindAmp = WIND_AMP_U;
        shader.uniforms.uWindDir = WIND_DIR_U;
        // color del horizonte: LA MISMA instancia de Color que usa el
        // cielo (uFogColor) y la niebla — el fundido del borde del
        // suelo (abajo, tras fog_fragment) lleva el terreno exactamente
        // a ese color, así suelo y cielo son el mismo color en la línea
        shader.uniforms.uHorizonCol = { value: fogObj.color };
        groundUniforms = shader.uniforms;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
          .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D dryMap;\nuniform sampler2D dryNor;\nuniform sampler2D dryRough;\nuniform sampler2D zoneNoise;\nuniform vec4 uClouds[12];\nuniform vec4 uCloudP[12];\nuniform float uCloudAmt;\n' + CS_GLSL + '\n' + CS_SLOT_GLSL + '\nuniform float uDryMix;\nfloat gZone;\nvec2 gDryUv;\nuniform float uWetW; uniform float uWetG; uniform float uWetD;\nuniform float uWetTime; uniform float uWetRain; uniform vec3 uWetSky;\nuniform float uMirage;\nuniform vec3 uHorizonCol;\nuniform sampler2D uFpTex; uniform vec2 uFpCenter;\nfloat gWetW2 = 0.0; float gPudG = 0.0; float gWetDepthG = 0.0;\nuniform sampler2D pathMap; uniform sampler2D pathNor; uniform sampler2D pathRough;\nuniform float uWetPW; uniform float uWetPG; uniform float uWetPD;\nfloat gPathF = 0.0; vec2 gPathUv = vec2(0.0); float gWetG2 = 0.0; float gWetD2 = 0.0;\nuniform float uWindTime; uniform float uWindAmp; uniform vec2 uWindDir;\nfloat gNearF = 0.0;\nvec2 gParOff = vec2(0.0);\nfloat wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }\nfloat wetNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = wetHash(i); float b = wetHash(i + vec2(1.0, 0.0)); float c = wetHash(i + vec2(0.0, 1.0)); float d = wetHash(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\nvec2 wetRippleGrad(vec2 wp, float t) { vec2 grad = vec2(0.0); for (int i = 0; i < 3; i++) { float fi = float(i); vec2 cell = floor(wp * 0.85 + fi * 19.19); vec2 ctr = cell + vec2(wetHash(cell + fi), wetHash(cell + 4.7 + fi)); vec2 dv = wp * 0.85 + fi * 19.19 - ctr; float r = length(dv) + 0.0001; float ph = fract(t * 0.55 + wetHash(cell + 9.1 + fi) * 7.0); float ring = sin((r - ph * 1.5) * 26.0) * exp(-r * 2.6) * (1.0 - ph) * step(r, 1.5); grad += (dv / r) * ring; } return grad; }')
          .replace('#include <fog_fragment>', [
            '#include <fog_fragment>',
            // FUSIÓN DEL BORDE (la «pared» del horizonte, a pedido):
            // perspectiva aérea HORNEADA en el suelo, independiente del
            // slider de niebla — el color final (ya iluminado y
            // anieblado) tiende al color EXACTO del horizonte del cielo
            // entre 420 y 1120 m, y el borde del disco (1200 m) ya ES
            // ese color: no queda línea en ninguna dirección, a
            // ninguna hora y con niebla 0. Antes el fundido dependía
            // solo del FogExp2 de la escena: con niebla 0 el suelo
            // llegaba nítido y cálido hasta su borde recto (el plano
            // era cuadrado: 1200 m en un sentido, 1697 en diagonal) y
            // se recortaba contra el cielo pálido como un muro.
            'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonCol, smoothstep(420.0, 1120.0, length(vWorldPos.xz - cameraPosition.xz)));'
          ].join('\n'))
          .replace('#include <map_fragment>', [
            '#include <map_fragment>',
            'float zn = texture2D(zoneNoise, vWorldPos.xz * 0.006).r;',
            'float zn2 = texture2D(zoneNoise, vWorldPos.xz * 0.045 + 0.37).g;',
            'gZone = smoothstep(0.46, 0.62, zn * 0.74 + zn2 * 0.36);',
            'gDryUv = vWorldPos.xz / 9.0;',
            'vec3 dryCol = texture2D(dryMap, gDryUv).rgb;',
            'diffuseColor.rgb = mix(diffuseColor.rgb, dryCol * vec3(0.94, 1.0, 0.84), gZone * uDryMix);',
            // ===== SENDERO: FUSIÓN PASTO–TIERRA (v58; DISCRETA en
            // v60, a pedido de Guille: el borde de la v58 se comía la
            // parcela — deriva de ±0,42 m, tierra pisada hasta 0,85 m
            // fuera y lenguas de pasto por todo el ancho). Los caminos
            // no son planos sobre el pasto (world.js no los emite): el
            // propio suelo los pinta como CAMPO DE DISTANCIA con signo
            // al eje de la retícula de 30 m (gPs < 0 dentro del camino
            // de 3,4 m), con el borde apenas erosionado por ruido
            // anclado al mundo: una deriva amplia de ±0,15 m (escala
            // 0,55) que quita la rectitud sin mover la orilla de su
            // sitio y un grano fino de ±0,04 m que la deshilacha al
            // tacto. La mezcla es corta (~12 cm) y vive SOLO en la
            // unión: la tierra pisada fuera del borde llega a ~0,24 m
            // con fuerza tenue (0,30, manchas aisladas donde pisa la
            // gente al esquivar) y las lenguas de pasto solo muerden
            // la franja de unión (v61, a pedido: «solo los bordes se
            // ven alterados para fusionar» — antes las islas de pasto
            // llegaban hasta el centro del camino y se leían como
            // manchas de musgo en el barro; ahora viven entre 0,52 m
            // antes del borde y el borde mismo, y pasado ese palmo,
            // a ambos lados manda el material pleno: la parcela es
            // parcela y el camino es camino, tierra plena en todo su
            // ancho). Una sola superficie, sin costura entre chunks
            // ni parches superpuestos; el color de la tierra se
            // muestrea con las UV por metro de siempre (baldosa de
            // 3 m) y conserva su color verdadero (v61: sin dividir
            // por el tinte de estación — ver TIERRA SECA más abajo).
            'vec2 gPc = vec2(abs(fract(vWorldPos.x / 30.0 + 0.5) - 0.5) * 30.0, abs(fract(vWorldPos.z / 30.0 + 0.5) - 0.5) * 30.0);',
            'float gPs = min(gPc.x, gPc.y) - 1.7;',
            'gPathUv = vWorldPos.xz / 3.0;',
            'if (gPs < 0.55) {',
            '  float gPn1 = wetNoise(vWorldPos.xz * 0.55);',
            '  float gPn2 = wetNoise(vWorldPos.xz * 2.3 + 5.2);',
            '  float gEdge = gPs + (gPn1 - 0.5) * 0.30 + (gPn2 - 0.5) * 0.08;',
            '  float gBase = 1.0 - smoothstep(-0.03, 0.09, gEdge);',
            '  float gOut = smoothstep(0.62, 0.78, wetNoise(vWorldPos.xz * 0.9 + 13.1)) * (1.0 - smoothstep(0.03, 0.24, gPs)) * 0.30;',
            '  float gIsl = smoothstep(0.64, 0.78, wetNoise(vWorldPos.xz * 1.35 + 7.7)) * smoothstep(-0.52, -0.30, gPs) * (1.0 - smoothstep(0.0, 0.14, gPs)) * 0.50;',
            '  gPathF = clamp(max(gBase, gOut) - gIsl * gBase, 0.0, 1.0);',
            '}',
            'if (gPathF > 0.003) {',
            // TIERRA SECA (v61, reporte de Guille 14:11 con foto: «parece
            // fango el camino, necesito que sea de tierra»): dos errores
            // componían el barro. (1) El color de la tierra se DIVIDÍA
            // por el tinte de estación del césped (diffuse): en
            // primavera ese tinte es (0,49 · 1,19 · 1,28), así que el
            // rojo se DUPLICABA y el verde/azul caían — la tierra salía
            // rojo-ladrillo saturada a cualquier humedad. La tierra
            // conserva su color verdadero: sin división. (2) La foto
            // base es suelo OSCURO y húmedo (media lineal medida
            // (0,064 · 0,035 · 0,016), el extremo mojado de la ley de
            // wet.js: suelo desnudo 0,26 seco → 0,16 mojado, y esta
            // foto está aún por debajo), y el sistema de humedad la
            // oscurecía OTRA vez al llover: el camino vivía mojado
            // aun en seco. El estado SECO se deriva invirtiendo esa
            // misma ley — la mezcla hacia albedo² que moja se deshace
            // con la raíz (exponente 0,55) — y desaturando 38 % hacia
            // la luminancia (la tierra seca es polvorienta y grisácea,
            // no saturada): media resultante ≈ (0,19 · 0,13 · 0,09)
            // lineal, albedo de tierra seca, mate y terrosa. Cuando
            // llueve, wet.js vuelve a oscurecerla desde ESTE seco:
            // fango solo con lluvia de verdad, como manda la ley.
            '  vec3 gDirtRaw = texture2D(pathMap, gPathUv).rgb;',
            '  float gDirtLum = dot(gDirtRaw, vec3(0.3333));',
            '  vec3 gDirtCol = pow(mix(gDirtRaw, vec3(gDirtLum), 0.38), vec3(0.55)) * 0.85;',
            '  diffuseColor.rgb = mix(diffuseColor.rgb, gDirtCol, gPathF);',
            '}',
            'float cshT = csFieldT(vWorldPos, uCloudAmt);', // la luz que llega a ESTE punto tras cruzar el cuerpo de nube (el mismo campo que apaga el disco)
            'float csh = csSlot(vWorldPos.xz);', // la sombra LOCAL proyectada de la nube de prueba (elipse + penumbra por altura)
            'diffuseColor.rgb *= mix(1.0, cshT * (1.0 - csh * 0.62), uCloudAmt);', // dentro de la sombra queda el piso difuso: atenuada, nunca negra
            // humedad (wet.js): W del suelo + huellas del jugador; el
            // oscurecimiento va hacia albedo² con fuerza por zona (la
            // tierra seca oscurece más que el césped) y el charco sale
            // de D contra el microrrelieve — llenar y rebalsar
            'gWetW2 = mix(uWetW, uWetPW, gPathF);', // sobre el sendero manda la humedad de la clase 'path' (wet.js): el panel SUPERFICIE MOJADA · SENDERO describe lo que se ve
            'gWetG2 = mix(uWetG, uWetPG, gPathF);',
            'gWetD2 = mix(uWetD, uWetPD, gPathF);',
            'vec2 fpUvG = (vWorldPos.xz - uFpCenter) / 96.0 + 0.5;',
            'float fpInG = step(0.0, fpUvG.x) * step(fpUvG.x, 1.0) * step(0.0, fpUvG.y) * step(fpUvG.y, 1.0);',
            'gWetW2 = max(gWetW2, texture2D(uFpTex, fpUvG).r * fpInG * 0.85);',
            // charcos con FORMA PROPIA (a pedido): la misma ley que en
            // los senderos (wet.js) — cada depresión es un charco con
            // centro sembrado y radio perturbado por armónicos
            // angulares de su semilla (lóbulos únicos, contorno
            // orgánico, nunca círculos), evaluado en las 9 celdas del
            // entorno para no recortar en los bordes, y crece con D
            'float gPudAcc = 0.0;',
            'vec2 gBaseCell = floor(vWorldPos.xz * 0.07);',
            'for (int gcx = -1; gcx <= 1; gcx++) {',
            '  for (int gcz = -1; gcz <= 1; gcz++) {',
            '    vec2 gCell = gBaseCell + vec2(float(gcx), float(gcz));',
            '    float gSeed = wetHash(gCell);',
            '    if (gSeed < 0.30) {',
            '      vec2 gCtr = (gCell + 0.22 + 0.56 * vec2(wetHash(gCell + 7.31), wetHash(gCell + 3.17))) / 0.07;',
            '      vec2 gDv = vWorldPos.xz - gCtr;',
            '      float gDist = length(gDv);',
            '      float gAng = atan(gDv.y, gDv.x);',
            '      float gRad = (2.1 + gSeed * 5.2) * (1.0 + 0.27 * sin(gAng * 3.0 + wetHash(gCell + 11.7) * 6.2831) + 0.17 * sin(gAng * 5.0 + wetHash(gCell + 5.93) * 6.2831) + 0.09 * sin(gAng * 9.0 + wetHash(gCell + 9.41) * 6.2831));',
            '      float gEdge = gRad * (0.30 + 0.70 * clamp(gWetD2 / 1.8, 0.0, 1.0));',
            '      gPudAcc = max(gPudAcc, 1.0 - smoothstep(gEdge - 0.38, gEdge, gDist));',
            '    }',
            '  }',
            '}',
            'gWetDepthG = max(gWetD2 - wetNoise(vWorldPos.xz * 0.35) * 1.6, 0.0);',
            'gPudG = gPudAcc * smoothstep(0.04, 0.30, gWetW2) * step(0.02, gWetD2);',
            'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * diffuseColor.rgb, mix(0.48, 0.60, gZone) * gWetW2);',
            'float wetLumG = dot(diffuseColor.rgb, vec3(0.3333));',
            'diffuseColor.rgb = mix(vec3(wetLumG), diffuseColor.rgb, 1.0 + 0.13 * gWetW2);',
            'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, gPudG * 0.5);',
            // ESPEJISMO inferior (informe mirage §1.5/§2.2): el suelo
            // lejano visto rasante mezcla hacia el color del cielo —
            // una banda fina y brillante que ondula con el tiempo;
            // uMirage ya trae ΔT × sol × calma × despejado (weather.js)
            'float mirDist = length(vWorldPos.xz - cameraPosition.xz);',
            'vec3 mirV = normalize(cameraPosition - vWorldPos);',
            'float mirGraz = pow(1.0 - clamp(mirV.y, 0.0, 1.0), 3.0);',
            'float mirRip = 0.85 + 0.15 * sin(vWorldPos.x * 2.1 + uWetTime * 3.0) * sin(vWorldPos.z * 1.7 - uWetTime * 2.3);',
            'diffuseColor.rgb = mix(diffuseColor.rgb, uWetSky * 1.15, clamp(uMirage * mirGraz * smoothstep(60.0, 280.0, mirDist) * mirRip, 0.0, 0.85));', // la banda del espejismo vive LEJOS (60–280 m) y retrocede al acercarse: de cerca no existe
            // ===== CÉSPED CON CUERPO (a pedido): la planicie deja de
            // ser un plano liso iluminado. Capas SOLO cerca de la
            // cámara (gNearF se apaga hacia los 30 m: más lejos la
            // brizna no se resuelve y el detalle solo costaría
            // fragmentos): 1) la MISMA foto de césped remuestreada a
            // 0,55 m por baldosa — grano de brizna real bajo los pies,
            // no el tiling de 8 m; 2) moteado de briznas por dos
            // ruidos cruzados estirados (grano fino direccional);
            // 3) un brillo que VIAJA con el viento real del momento
            // (dirección y fuerza de los uniforms WIND_* compartidos):
            // la luz barre la planicie en oleadas, como en un campo;
            // 4) VOLUMEN POR PARALLAX DE CAPAS (v49, a pedido: «shader
            // de césped que dé sensación de volumen»): la luminancia de
            // la foto hace de ALTURA de brizna (las puntas claras
            // arriba, las bases oscuras abajo) y la muestra de detalle
            // — y la de la normal fina, en normal_fragment_maps — se
            // desplaza según el ángulo de vista (offset ∝ (h − media)
            // · tan del ángulo rasante, altura de brizna ~5,5 cm): al
            // mirar rasante las puntas tapan a las bases y el suelo
            // gana profundidad real de paralaje; un AO de capas
            // (shell) oscurece las grietas y deja las puntas a la luz
            // en ese mismo ángulo. Es parallax EN FRAGMENTO: cero
            // geometría nueva, cero triángulos, el LOD ni se entera
            // (el suelo es un único disco) y el coste es UNA muestra de
            // textura extra por fragmento solo dentro de 18 m (fuera,
            // gParF = 0 y el desplazamiento es nulo) — seguro para la
            // Mali del Redmi. Las briznas instanciadas se descartaron:
            // cubrir el anillo cercano costaría cientos de miles de
            // triángulos contra este coste fijo por píxel cercano.
            'float gCamD = length(vWorldPos.xz - cameraPosition.xz);',
            'gNearF = 1.0 - smoothstep(7.0, 30.0, gCamD);',
            'if (gNearF > 0.003) {',
            '  vec2 gUvB = vWorldPos.xz / 0.55;',
            '  vec3 gDet = texture2D(map, gUvB).rgb;',
            '  float gDetL = dot(gDet, vec3(0.3333));',
            '  vec3 gViewW = normalize(cameraPosition - vWorldPos);',
            '  float gParF = (1.0 - smoothstep(9.0, 18.0, gCamD)) * (1.0 - clamp(gViewW.y, 0.0, 1.0));', // el parallax vive rasante y cerca: de pie encima (vista cenital) no hay desplazamiento que ver
            '  gParOff = (-gViewW.xz / max(gViewW.y, 0.30)) * ((gDetL - 0.40) * 0.055) / 0.55 * gParF;', // desplazamiento en UVs de la baldosa de 0,55 m: la altura (luminancia − media) proyectada por la tangente del ángulo de vista
            '  vec3 gDetP = texture2D(map, gUvB + gParOff).rgb;',
            '  float gDetPL = dot(gDetP, vec3(0.3333));',
            '  gDet = mix(gDet, gDetP, gParF); gDetL = mix(gDetL, gDetPL, gParF);',
            '  diffuseColor.rgb *= mix(1.0, 0.70 + gDetL * 0.66, gNearF * 0.85 * (1.0 - gPathF));', // el detalle de brizna se apaga sobre la tierra del sendero (gPathF): son capas del PASTO, no de la tierra
            '  diffuseColor.rgb *= mix(1.0, 0.72 + 0.55 * gDetL, gParF * 0.8 * (1.0 - gPathF));', // AO de capas (shell): a rasante las grietas entre briznas se oscurecen y las puntas quedan a la luz — el volumen se lee en el contraste, no solo en el desplazamiento
            '  float gBlade = wetNoise(vWorldPos.xz * vec2(46.0, 9.0)) * wetNoise(vWorldPos.xz * vec2(9.0, 46.0) + 3.7);',
            '  diffuseColor.rgb *= 1.0 + (gBlade - 0.25) * 0.38 * gNearF * (1.0 - gPathF);',
            '  float gShim = sin(dot(vWorldPos.xz, uWindDir) * 0.9 - uWindTime * 2.2) * 0.6 + sin(dot(vWorldPos.xz, uWindDir) * 2.7 - uWindTime * 3.9) * 0.4;',
            '  diffuseColor.rgb *= 1.0 + gShim * 0.05 * gNearF * (0.25 + uWindAmp) * (1.0 - gPathF);',
            '}'
          ].join('\n'))
          .replace('#include <roughnessmap_fragment>', [
            '#include <roughnessmap_fragment>',
            'roughnessFactor = mix(roughnessFactor, texture2D(dryRough, gDryUv).g, gZone);',
            'roughnessFactor = mix(roughnessFactor, texture2D(pathRough, gPathUv).g, gPathF);', // la rugosidad de la tierra manda donde el sendero manda (v58)
            // superficie LIGERAMENTE mojada: la rugosidad baja con
            // moderación (nada de espejo general); solo el charco es liso
            'roughnessFactor = mix(roughnessFactor, mix(0.38, 0.30, gZone), smoothstep(0.15, 1.0, gWetG2) * 0.8);',
            'roughnessFactor = mix(roughnessFactor, 0.05, gPudG);'
          ].join('\n'))
          .replace('#include <normal_fragment_maps>', [
            'vec3 gBaseN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;',
            'vec3 gDryN = texture2D(dryNor, gDryUv).xyz * 2.0 - 1.0;',
            'vec3 gMixN = normalize(mix(gBaseN, vec3(gDryN.xy * 0.85, gDryN.z), gZone));',
            'normal = normalize(tbn * gMixN);',
            // relieve de la tierra del sendero sobre el del pasto (v58)
            'if (gPathF > 0.003) {',
            '  vec3 gPathN = texture2D(pathNor, gPathUv).xyz * 2.0 - 1.0;',
            '  gMixN = normalize(mix(gMixN, vec3(gPathN.xy * 0.6, gPathN.z), gPathF));', // relieve atenuado (v61): la grava de la foto a plena fuerza atrapaba la luz por piedritas y brillaba como grava MOJADA; la tierra seca es polvorienta y su microrrelieve se lee suave
            '  normal = normalize(tbn * gMixN);',
            '}',
            // relieve de brizna cerca: la normal fina de la foto a
            // 0,55 m se mezcla sobre la del tiling de 8 m — el suelo
            // cercano atrapa la luz por parches en vez de responder
            // como una sola superficie pulida
            'if (gNearF > 0.003) {',
            '  vec3 gFineN = texture2D(normalMap, vWorldPos.xz / 0.55 + gParOff).xyz * 2.0 - 1.0;', // la normal fina se muestrea con el MISMO desplazamiento de parallax que el color (gParOff, calculado en map_fragment): relieve y color describen las mismas briznas
            '  vec3 gMixN2 = normalize(mix(gMixN, normalize(vec3(gFineN.xy * 0.9, max(gMixN.z, 0.35))), gNearF * 0.55 * (1.0 - gPathF)));',
            '  normal = normalize(tbn * gMixN2);',
            '}',
            // dentro del charco la normal se aplana a vertical y las
            // ondas de la lluvia la perturban (solo donde hay agua)
            'if (gPudG > 0.001) {',
            '  vec3 wetUpVG = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
            '  normal = normalize(mix(normal, wetUpVG, gPudG * 0.92));',
            '  if (uWetRain > 0.003) {',
            '    vec2 wetRgG = wetRippleGrad(vWorldPos.xz, uWetTime);',
            '    vec3 wetRgVG = (viewMatrix * vec4(wetRgG.x, 0.0, wetRgG.y, 0.0)).xyz;',
            '    normal = normalize(normal + wetRgVG * (uWetRain * gPudG * clamp(gWetDepthG * 0.6, 0.0, 1.0) * 0.30));',
            '  }',
            '}'
          ].join('\n'))
          .replace('#include <emissivemap_fragment>', [
            '#include <emissivemap_fragment>',
            '{',
            '  vec3 wetVG = normalize(vViewPosition);',
            '  float wetFresG = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, wetVG), 0.0, 1.0), 5.0);',
            '  totalEmissiveRadiance += uWetSky * wetFresG * (gPudG * 1.0 + uWetG * 0.08);',
            '}'
          ].join('\n'));
      };
      setSeason(season); // aplica la estación vigente (primavera por defecto) al suelo recién creado
      watchShader(groundMat, null); // si el parche del suelo no compila en este WebGL, queda el material estándar con sus texturas
      /* Texturas reales para la vegetación (fotografías CC0 de Poly
         Haven): corteza marrón en troncos y ramas, y la foto de césped
         en los mechones y en las copas (clones con su propio repeat,
         teñidos a tonos de follaje). Se notan cuando la vegetación se
         activa en el debug; por defecto está en 0 %. */
      if (ground.bark) {
        ground.bark.repeat.set(2, 2);
        MAT.wood.map = ground.bark;
        MAT.wood.color.set(0xffffff);
        MAT.wood.needsUpdate = true;
      }
      var tuftTex = grass.diff.clone();
      tuftTex.repeat.set(1, 1);
      tuftTex.needsUpdate = true;
      MAT.grass.map = tuftTex;
      MAT.grass.color.set(0xb9c8a6);
      MAT.grass.needsUpdate = true;
      var canopyTex = grass.diff.clone();
      canopyTex.repeat.set(3, 3);
      canopyTex.needsUpdate = true;
      MAT.foliage.map = canopyTex;
      MAT.foliage.color.set(0x5d7350);
      MAT.foliage.needsUpdate = true;
      MAT.foliage2.map = canopyTex;
      MAT.foliage2.color.set(0x46543e);
      MAT.foliage2.needsUpdate = true;
      // DISCO de 2400 m de diámetro (antes un PLANO cuadrado): el borde
      // queda a 1200 m del jugador EN TODAS DIRECCIONES — el cuadrado
      // ponía el borde a 1200 m en los ejes y a 1697 m en diagonal, y
      // esa variación se leía como una línea recta al fondo. El disco,
      // más el fundido a color de horizonte horneado en su shader
      // (420→1120 m, tras fog_fragment) y el cielo bajo el horizonte
      // fundido al mismo color, hacen el borde invisible a cualquier
      // hora, con o sin niebla. Las UV del CircleGeometry cubren el
      // diámetro 0..1 como el plano: el tiling de 8 m no cambia.
      groundMesh = new THREE.Mesh(new THREE.CircleGeometry(1200, 72), groundMat);
      groundMesh.rotation.x = -Math.PI / 2;
      groundMesh.receiveShadow = true;
      scene.add(groundMesh);
      /* COLINAS DEL HORIZONTE (v64, pedido de Guille 18:23: «crear
         colinas al fondo — variaciones del nivel del terreno que se
         puedan divisar en el horizonte»). Un ANILLO de relieve bajo
         (470→1185 m, dentro del disco de suelo) que sigue al jugador
         como el propio disco: a esa distancia la falta de paralaje
         se lee como lejanía, igual que el cielo. El perfil es
         determinista (sumas de senos de frecuencia entera: el anillo
         cierra sin costura) y NO es un donut uniforme: la amplitud
         por sectores (frecuencias 2 y 3) deja direcciones de llanura
         plena hasta el horizonte y levanta sierras en otras — como
         las de Córdoba al oeste — con crestas de 15–60 m (a ~900 m
         subtienden 1–4°: se divisan, no dominan). Radialmente nace
         en 0 (470 m, más allá del último chunk incluso en aire
         claro), cresta a ~930 m y vuelve a 0 en el borde del disco
         para fundirse con él. LUZ: material estándar (sol y
         hemisférica de la tubería única: de noche se apaga, al
         ocaso se tiñe) + el FogExp2 de la escena cuando lo hay + la
         MISMA fusión al color de horizonte del suelo (uHorizonCol =
         fogObj.color, smoothstep 420→1120 m) pero al 85 %: la
         colina conserva un resto de su luz sobre el color del
         horizonte y por eso se DIVISA en aire claro en vez de
         desaparecer como el borde del disco. Sin sombras: están
         fuera de la cámara de sombras y no reciben ninguna. */
      (function buildHills() {
        var SEG = 256;
        var rowsR = [470, 620, 780, 930, 1070, 1185];
        var rowsF = [0, 0.38, 0.78, 1.0, 0.52, 0];
        function peakAt(a) {
          var sector = 0.5 + 0.5 * (Math.sin(a * 2 + 0.9) * 0.62 + Math.sin(a * 3 + 2.7) * 0.38); // 0..1 (las amplitudes suman 1)
          var amp = clamp((sector - 0.30) / 0.55, 0, 1); // sectores bajo el umbral: llanura plena
          if (amp <= 0) return 0;
          var det = 0.5 + 0.5 * (Math.sin(a * 5 + 1.3) * 0.40 + Math.sin(a * 9 + 4.1) * 0.30 + Math.sin(a * 17 + 2.2) * 0.19 + Math.sin(a * 29 + 5.6) * 0.11);
          return amp * (14 + 46 * det);
        }
        var pos = [], idx = [];
        for (var ri = 0; ri < rowsR.length; ri++) {
          for (var si = 0; si <= SEG; si++) {
            var a = si / SEG * Math.PI * 2, r = rowsR[ri];
            var h = peakAt(a) * rowsF[ri];
            if (h > 0) h *= 1 + 0.10 * Math.sin(a * 23 + r * 0.013) * rowsF[ri]; // la ladera no es un cono perfecto
            pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
          }
        }
        for (var rj = 0; rj < rowsR.length - 1; rj++) {
          for (var sj = 0; sj < SEG; sj++) {
            var b0 = rj * (SEG + 1) + sj, b1 = b0 + SEG + 1;
            idx.push(b0, b1, b0 + 1, b1, b1 + 1, b0 + 1);
          }
        }
        var hg = new THREE.BufferGeometry();
        hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        hg.setIndex(idx);
        hg.computeVertexNormals();
        var hillsMat = new THREE.MeshStandardMaterial({ color: 0x7a8770, roughness: 1, metalness: 0 });
        hillsMat.onBeforeCompile = function (shader) {
          applyBacklightPatch(shader); // contraluz (v65): las crestas contra el sol/ la luna llevan el borde luminoso — es LA silueta del horizonte
          shader.uniforms.uHorizonCol = { value: fogObj.color }; // LA MISMA instancia de Color que funde el borde del suelo y el cielo bajo
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vHillWp;')
            .replace('#include <project_vertex>', '#include <project_vertex>\nvHillWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vHillWp;\nuniform vec3 uHorizonCol;')
            .replace('#include <fog_fragment>', '#include <fog_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHorizonCol, smoothstep(420.0, 1120.0, length(vHillWp.xz - cameraPosition.xz)) * 0.85);');
        };
        hillsMat.customProgramCacheKey = function () { return 'hills65'; };
        watchShader(hillsMat, null); // si el parche no compila, quedan las colinas estándar con el FogExp2 de la escena
        hillsMesh = new THREE.Mesh(hg, hillsMat);
        hillsMesh.frustumCulled = false; // sigue al jugador: su esfera local no representa su sitio en el mundo
        hillsMesh.castShadow = false;
        hillsMesh.receiveShadow = false;
        scene.add(hillsMesh);
      })();
    }
