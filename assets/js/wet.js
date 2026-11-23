/* wet.js — Superficies mojadas según el material: estado de humedad
   (W = saturación de poros, G = película/brillo, D = agua libre en mm)
   integrado desde la tasa de lluvia REAL del modelo físico (climate.js,
   SIM.rainRate en mm/h) y parche de shader que interpola seco→mojado
   sobre los materiales PBR existentes, sin texturas nuevas.
   Física (informe wet-surfaces, 2026-11-22): el agua (n≈1,33) reemplaza
   al aire (n≈1,0) en los poros — la reflexión por frontera cae de ~3,5 %
   a ~0,2 %, la luz penetra más y se absorbe más: el albedo mojado sale
   de mezclar hacia albedo² (Lekner & Dorf: 0,5 seco → 0,32 mojado; suelo
   desnudo medido 0,26 → 0,16). Los poros llenos bajan la rugosidad hacia
   ~0,1 y el Fresnel del agua (F0≈0,02 de frente, ~1 rasante) da el
   brillo. Cada material responde según su porosidad: el sendero
   compactado se moja y encharca primero (Ksat ~1,5 mm/h, almacenamiento
   1–2 mm), la tierra oscurece más (Ksat limo 3,4 mm/h), el césped
   intercepta 1–2 mm y forma gotas sin película, y la piedra de
   cemento de las tumbas — hormigón colado poroso (porosidad capilar
   ~10–15 %; absorción ≤6 % en masa según ASTM C1364, informe
   cement-stone-bounce-properties 2026-11-22) — SÍ oscurece de verdad
   al mojarse: albedo 0,25 meteorizada → ~0,13 (ver WET_CFG.stone).
   Los charcos son llenar-y-rebalsar: solo el EXCESO de lluvia sobre la
   infiltración (Horton simplificado) acumula D, y la máscara sale de D
   contra el microrrelieve — nunca de la tasa instantánea sola.
   El secado es asimétrico: el brillo (G) cae en 0,5–2 h y el color (W)
   tarda 6–48 h. Las capacidades C y los τ por material son la
   CALIBRACIÓN propuesta del informe (no mediciones de laboratorio).
   Escala de tiempo hidrológica: 1 s real = 1 min de simulación (la
   misma aceleración que ya usa el clima vivo para derivar en ~1 min).
   Depende de: utils, scene, climate (SIM), sky (WIND). Lo usan:
   materials (suelo), world (materiales de chunk), weather (updateWet
   por frame), main (pisadas), debug (asa de verificación). */
'use strict';
    var WET = {
      path:   { W: 0, G: 0, D: 0 },
      ground: { W: 0, G: 0, D: 0 },
      stone:  { W: 0, G: 0 },
      plaque: { W: 0, G: 0 },
      wood:   { W: 0, G: 0 },
      grass:  { W: 0, G: 0 },
      iron:   { W: 0, G: 0 },
      I: 0,        // intercepción del dosel de césped (mm, máx 1,5)
      shoe: 0      // humedad que el jugador lleva en las suelas
    };
    // parámetros por material: C (mm para llegar a W≈0,63 mojando) y
    // Wmax (mm equivalentes del almacén rápido que la evaporación debe
    // vaciar para secar W: informe evaporation §4.3 — piedra/sendero
    // 0,5, césped/madera 2, tierra franca 4)
    var WET_PAR = {
      path:   { C: 1.0, Wmax: 0.5 },
      ground: { C: 2.5, Wmax: 4.0 },
      stone:  { C: 0.55, Wmax: 0.42 },
      plaque: { C: 0.2, Wmax: 0.5 },
      wood:   { C: 2.0, Wmax: 2.0 },
      grass:  { C: 0.5, Wmax: 2.0 },
      iron:   { C: 0.3, Wmax: 0.5 }
    };
    /* ============ EVAPORACIÓN FAO-56 (Penman–Monteith horario) ============
       Informe water-evaporation-drainage (2026-11-22), cadena completa
       §5–§6: día del año → declinación/radiación (ORBIT) → nubosidad
       (T del frame) → Rn → ET0 con T, RH y viento DEL MODELO — nunca
       una tabla por temperatura sola (en Córdoba enero ≈ diciembre en
       T media pero la radiación y el VPD no coinciden: manda Rn y el VPD).
       ET0 = [0,408·Δ·(Rn−G) + γ·(37/(T+273))·u2·(es−ea)] /
             [Δ + γ·(1+0,24·u2)]  mm/h, con es de Magnus (el mismo de
       climate.js), γ = 0,064 kPa/°C (Córdoba, 425 m → P ≈ 96,1 kPa), G = 0,1·Rn.
       El charco (agua libre) evapora ET0/0,70 y el sendero oscuro al
       sol suma el boost de pavimento (superficie 20–30 °C sobre el
       aire: ×1,5–2,5 con sol alto, tope total 2 mm/h). */
    var EVAP = { et0: 0, puddle: 0, puddlePath: 0, rn: 0, ghi: 0 };
    function computeEvap() {
      var T = SIM_IN.T, RH = SIM_IN.RH, u2 = Math.max(SIM_IN.U, 0);
      var es = 0.6108 * Math.exp(17.27 * T / (T + 237.3));
      var ea = es * RH / 100;
      var delta = 4098 * es / Math.pow(T + 237.3, 2);
      var gamma = 0.064; // γ psicrométrica a 425 m (Córdoba): 0,000665 · 96,1 kPa
      var sinEl = (typeof sunDir !== 'undefined') ? Math.max(sunDir.y, 0) : 0;
      // GHI del frame desde la irradiancia orbital de hoy, la altura
      // del sol y la transmitancia real de las nubes (T suavizada)
      var ghiW = (typeof ORBIT !== 'undefined') ? ORBIT.irradiance * sinEl * 0.74 * (0.25 + 0.75 * (typeof sunTransSm !== 'undefined' ? sunTransSm : 1)) * (1 - (typeof envCur !== 'undefined' ? envCur.fog : 0) * 0.3) : 0;
      var Rs = ghiW * 0.0036; // W/m² → MJ/m²/h
      var Rn = Math.max(0, 0.77 * Rs - 0.10); // Rn ≈ 0,77·Rs − Rnl (Rnl ~3 MJ/m²/día prorrateado)
      var et0 = (0.408 * delta * (Rn * 0.9) + gamma * (37 / (T + 273)) * u2 * (es - ea)) / (delta + gamma * (1 + 0.24 * u2));
      EVAP.et0 = clamp(et0, 0, 1.6);
      EVAP.rn = Rn; EVAP.ghi = ghiW;
      EVAP.puddle = Math.min(EVAP.et0 / 0.70, 2);
      var boost = 1 + 1.0 * sinEl * (1 - (typeof envCur !== 'undefined' ? envCur.cloud : 0)); // pavimento oscuro al sol
      EVAP.puddlePath = Math.min(EVAP.et0 / 0.70 * boost, 2);
      return EVAP;
    }
    // uniforms compartidos: UN solo objeto por valor, referenciado por
    // todos los programas — al actualizar el objeto se actualiza todo
    var UW = {
      time: { value: 0 }, rain: { value: 0 },
      sky: { value: new THREE.Color(0x8fa8c4) },
      pathW: { value: 0 }, pathG: { value: 0 }, pathD: { value: 0 },
      groundW: { value: 0 }, groundG: { value: 0 }, groundD: { value: 0 },
      stoneW: { value: 0 }, stoneG: { value: 0 },
      plaqueW: { value: 0 }, plaqueG: { value: 0 },
      woodW: { value: 0 }, woodG: { value: 0 },
      grassW: { value: 0 }, grassG: { value: 0 },
      ironW: { value: 0 }, ironG: { value: 0 },
      zero: { value: 0 }
    };
    /* ============ Huellas mojadas: textura de datos anclada al mundo ====
       192×192 téxeles sobre 96 m (0,5 m/téxel) centrada cerca del
       jugador: cada pisada con suela mojada estampa oscuridad que el
       shader del suelo y de los senderos lee como humedad local. Se
       recentra por desplazamiento cuando el jugador se aleja, y decae
       con el secado de la superficie. */
    var FP_N = 192, FP_EXT = 96;
    var fpData = new Uint8Array(FP_N * FP_N);
    var fpTex = new THREE.DataTexture(fpData, FP_N, FP_N, THREE.RedFormat);
    fpTex.magFilter = THREE.LinearFilter; fpTex.minFilter = THREE.LinearFilter;
    fpTex.wrapS = fpTex.wrapT = THREE.ClampToEdgeWrapping;
    fpTex.generateMipmaps = false; fpTex.needsUpdate = true;
    var fpCenter = { value: new THREE.Vector2(0, 0) };
    var fpCx = 0, fpCz = 0, fpDirty = false, fpTick = 0;
    function fpStamp(x, z, strength) {
      var tx = Math.round((x - fpCx) / FP_EXT * FP_N + FP_N / 2 - 0.5);
      var tz = Math.round((z - fpCz) / FP_EXT * FP_N + FP_N / 2 - 0.5);
      var amp = Math.round(clamp(strength, 0, 1) * 255);
      for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
        var px = tx + dx, pz = tz + dz;
        if (px < 0 || pz < 0 || px >= FP_N || pz >= FP_N) continue;
        var w = (dx === 0 && dz === 0) ? 1 : (dx === 0 || dz === 0) ? 0.5 : 0.25;
        var idx = pz * FP_N + px, v = Math.round(amp * w);
        if (v > fpData[idx]) fpData[idx] = v;
      }
      fpDirty = true;
    }
    function fpRecenter(px, pz) {
      var texel = FP_EXT / FP_N;
      var sx = Math.round((px - fpCx) / texel), sz = Math.round((pz - fpCz) / texel);
      if (!sx && !sz) return;
      var old = fpData;
      fpData = new Uint8Array(FP_N * FP_N);
      for (var z = 0; z < FP_N; z++) for (var x = 0; x < FP_N; x++) {
        var ox = x + sx, oz = z + sz;
        if (ox >= 0 && oz >= 0 && ox < FP_N && oz < FP_N) fpData[z * FP_N + x] = old[oz * FP_N + ox];
      }
      fpCx += sx * texel; fpCz += sz * texel;
      fpTex.image.data = fpData;
      fpDirty = true;
    }
    /* Pisada (la llama main.js en cada ciclo de paso): la suela recoge
       la humedad de la superficie pisada — si hay charco, se empapa —
       y deja huella oscura sobre sendero o césped mientras le dure. */
    function wetStep(x, z, surface) {
      var target = 0;
      if (surface === 'dirt') target = Math.max(WET.path.W, WET.path.D > 1.2 ? 1 : 0);
      else if (surface === 'stone') target = WET.stone.W;
      else if (surface === 'gravel') target = WET.path.W * 0.7;
      else target = Math.max(WET.ground.W, WET.ground.D > 3 ? 1 : 0);
      WET.shoe = clamp(WET.shoe + (target - WET.shoe) * 0.45, 0, 1);
      if (WET.shoe > 0.30 && surface !== 'stone') fpStamp(x, z, WET.shoe);
      WET.shoe *= 0.88; // la suela se seca en ~14 m de caminata
    }
    /* ============ GLSL compartido ============ */
    var WET_GLSL_HEAD = [
      'varying vec3 vWetWP;',
      'uniform float uWetW; uniform float uWetG; uniform float uWetD;',
      'uniform float uWetTime; uniform float uWetRain; uniform vec3 uWetSky;',
      'float gWetW = 0.0; float gWetPud = 0.0; float gWetStr = 0.0; float gWetDepth = 0.0;',
      'float wetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
      'float wetNoise(vec2 p) {',
      '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
      '  float a = wetHash(i); float b = wetHash(i + vec2(1.0, 0.0));',
      '  float c = wetHash(i + vec2(0.0, 1.0)); float d = wetHash(i + vec2(1.0, 1.0));',
      '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
      '}',
      // ondas de lluvia: anillos que se expanden desde centros con hash,
      // 3 capas desfasadas — solo perturban la normal dentro del charco
      'vec2 wetRippleGrad(vec2 wp, float t) {',
      '  vec2 grad = vec2(0.0);',
      '  for (int i = 0; i < 3; i++) {',
      '    float fi = float(i);',
      '    vec2 cell = floor(wp * 0.85 + fi * 19.19);',
      '    vec2 ctr = cell + vec2(wetHash(cell + fi), wetHash(cell + 4.7 + fi));',
      '    vec2 dv = wp * 0.85 + fi * 19.19 - ctr;',
      '    float r = length(dv) + 0.0001;',
      '    float ph = fract(t * 0.55 + wetHash(cell + 9.1 + fi) * 7.0);',
      '    float ring = sin((r - ph * 1.5) * 26.0) * exp(-r * 2.6) * (1.0 - ph) * step(r, 1.5);',
      '    grad += (dv / r) * ring;',
      '  }',
      '  return grad;',
      '}'
    ].join('\n');
    function wetEmissiveGLSL(film) {
      return [
        '#include <emissivemap_fragment>',
        '{',
        '  vec3 wetV = normalize(vViewPosition);',
        '  float wetFres = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, wetV), 0.0, 1.0), 5.0);',
        '  totalEmissiveRadiance += uWetSky * wetFres * (gWetPud * 1.0 + uWetG * ' + film.toFixed(3) + ');',
        '}'
      ].join('\n');
    }
    function wetNormalGLSL() {
      return [
        '#include <normal_fragment_maps>',
        'if (gWetPud > 0.001) {',
        '  vec3 wetUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);',
        '  normal = normalize(mix(normal, wetUpV, gWetPud * 0.92));',
        '  if (uWetRain > 0.003) {',
        '    vec2 wetRg = wetRippleGrad(vWetWP.xz, uWetTime);',
        '    vec3 wetRgV = (viewMatrix * vec4(wetRg.x, 0.0, wetRg.y, 0.0)).xyz;',
        // ondas SOLO donde hay agua parada de verdad (profundidad > 0)
        // y sutiles: sobre suelo apenas húmedo no existe anillo alguno
        '    normal = normalize(normal + wetRgV * (uWetRain * gWetPud * clamp(gWetDepth * 0.6, 0.0, 1.0) * 0.30));',
        '  }',
        '}'
      ].join('\n');
    }
    /* Configuración del parche por clase de material de chunk.
       dark: cuánto de la mezcla hacia albedo² a W=1 · roughWet: rugosidad
       de la superficie saturada · film: fuerza del velo especular. */
    var WET_CFG = {
      // piedra de cemento (informe cement-stone-bounce-properties, 2026-11-22):
      // mojada, el albedo de la meteorizada cae de 0,25 a ~0,13 — CALIBRACIÓN
      // anclada en Levinson & Akbari (mojar bajó el albedo medio −0,23 en
      // mezclas claras de laboratorio 0,41–0,77; restar 0,23 de 0,25 daría
      // ~0,02, físicamente imposible: el piso lo pone la película de agua,
      // ~0,15 en Pang et al.) — y la mezcla hacia albedo² con dark 0,60 lleva
      // el 0,25 lineal a ~0,14 a W=1. La rugosidad mojada 0,40 (rango
      // 0,35–0,50) también es CALIBRACIÓN: el agua llena los poros y baja la
      // rugosidad desde 0,90, pero una piedra colada mojada no es un espejo
      // (el 0,12 anterior la volvía casi pulida). La placa, más lisa, 0,35.
      stone:  { wU: 'stoneW', gU: 'stoneG', dU: null, dark: 0.60, sat: 0.10, roughWet: 0.40, roughAmt: 0.90, film: 0.50, streaks: true, droplets: false, fp: false, depScale: 0 },
      plaque: { wU: 'plaqueW', gU: 'plaqueG', dU: null, dark: 0.32, sat: 0.04, roughWet: 0.35, roughAmt: 0.95, film: 0.65, streaks: false, droplets: false, fp: false, depScale: 0 },
      // mármol pulido de los panteones (v52): comparte el estado de humedad de la placa pulida (plaqueW/G); mojado oscurece menos que el cemento poroso (placa densa, poca absorción) y su rugosidad baja hacia 0,12 — el pulido mojado brilla MÁS, no menos
      marble: { wU: 'plaqueW', gU: 'plaqueG', dU: null, dark: 0.25, sat: 0.03, roughWet: 0.12, roughAmt: 1.0, film: 0.65, streaks: false, droplets: false, fp: false, depScale: 0 },
      path:   { wU: 'pathW', gU: 'pathG', dU: 'pathD', dark: 0.58, sat: 0.14, roughWet: 0.10, roughAmt: 1.0, film: 0.18, streaks: false, droplets: false, fp: true, depScale: 0.55 },
      wood:   { wU: 'woodW', gU: 'woodG', dU: null, dark: 0.50, sat: 0.08, roughWet: 0.45, roughAmt: 0.8, film: 0.08, streaks: false, droplets: false, fp: false, depScale: 0 },
      grass:  { wU: 'grassW', gU: 'grassG', dU: null, dark: 0.30, sat: 0.16, roughWet: 0.65, roughAmt: 0.7, film: 0.05, streaks: false, droplets: true, fp: false, depScale: 0 },
      iron:   { wU: 'ironW', gU: 'ironG', dU: null, dark: 0.30, sat: 0.0, roughWet: 0.25, roughAmt: 0.85, film: 0.30, streaks: false, droplets: false, fp: false, depScale: 0 }
    };
    var WET_KIND = { light: 'stone', mid: 'stone', dark: 'stone', moss: 'stone', marble: 'marble', cement: 'stone', plaque: 'plaque', dirt: 'path', wood: 'wood', door: 'wood', doorA: 'wood', doorB: 'wood', iron: 'iron', grass: 'grass', foliage: 'grass', foliage2: 'grass', cypress: 'grass' };
    function applyWetPatch(shader, cfg) {
      shader.uniforms.uWetW = UW[cfg.wU];
      shader.uniforms.uWetG = UW[cfg.gU];
      shader.uniforms.uWetD = cfg.dU ? UW[cfg.dU] : UW.zero;
      shader.uniforms.uWetTime = UW.time;
      shader.uniforms.uWetRain = UW.rain;
      shader.uniforms.uWetSky = UW.sky;
      if (cfg.fp) {
        shader.uniforms.uFpTex = { value: fpTex };
        shader.uniforms.uFpCenter = fpCenter;
      }
      var head = WET_GLSL_HEAD;
      if (cfg.fp) head += '\nuniform sampler2D uFpTex; uniform vec2 uFpCenter;';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWetWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWetWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      var mapCode = ['#include <map_fragment>', 'gWetW = uWetW;'];
      if (cfg.fp) mapCode.push(
        'vec2 fpUv = (vWetWP.xz - uFpCenter) / ' + FP_EXT.toFixed(1) + ' + 0.5;',
        'float fpIn = step(0.0, fpUv.x) * step(fpUv.x, 1.0) * step(0.0, fpUv.y) * step(fpUv.y, 1.0);',
        'gWetW = max(gWetW, texture2D(uFpTex, fpUv).r * fpIn * 0.85);'
      );
      if (cfg.dU) mapCode.push(
        // charcos con FORMA PROPIA (a pedido): cada depresión es un
        // charco individual con centro sembrado por hash y un radio
        // perturbado por armónicos angulares (3, 5 y 9 lóbulos con
        // fases y amplitudes de SU semilla): contorno orgánico, único,
        // jamás un círculo ni una elipse. Se evalúan las 9 celdas del
        // entorno para que el agua cruce los bordes de celda sin
        // recortes rectos ni alineados a la grilla, y el charco CRECE
        // desde el centro a medida que D (el agua acumulada) llena la
        // depresión — llenar y rebalsar, como el charco real.
        'float wetPudAcc = 0.0;',
        'vec2 wetBaseCell = floor(vWetWP.xz * 0.07);',
        'for (int wcx = -1; wcx <= 1; wcx++) {',
        '  for (int wcz = -1; wcz <= 1; wcz++) {',
        '    vec2 wCell = wetBaseCell + vec2(float(wcx), float(wcz));',
        '    float wSeed = wetHash(wCell);',
        '    if (wSeed < 0.30) {',
        '      vec2 wCtr = (wCell + 0.22 + 0.56 * vec2(wetHash(wCell + 7.31), wetHash(wCell + 3.17))) / 0.07;',
        '      vec2 wDv = vWetWP.xz - wCtr;',
        '      float wDist = length(wDv);',
        '      float wAng = atan(wDv.y, wDv.x);',
        '      float wRad = (2.1 + wSeed * 5.2) * (1.0 + 0.27 * sin(wAng * 3.0 + wetHash(wCell + 11.7) * 6.2831) + 0.17 * sin(wAng * 5.0 + wetHash(wCell + 5.93) * 6.2831) + 0.09 * sin(wAng * 9.0 + wetHash(wCell + 9.41) * 6.2831));',
        '      float wEdge = wRad * (0.30 + 0.70 * clamp(uWetD / 2.7, 0.0, 1.0));',
        '      wetPudAcc = max(wetPudAcc, 1.0 - smoothstep(wEdge - 0.38, wEdge, wDist));',
        '    }',
        '  }',
        '}',
        'gWetDepth = max(uWetD - wetNoise(vWetWP.xz * 0.40) * 1.2, 0.0);',
        'gWetPud = wetPudAcc * smoothstep(0.04, 0.30, gWetW) * step(0.02, uWetD);'
      );
      if (cfg.streaks) mapCode.push(
        // chorreaduras: ruido estirado en vertical sobre las caras casi
        // verticales (normal del mundo), más la franja húmeda de la base
        'vec3 wetWN = normalize(inverseTransformDirection(normalize(vNormal), viewMatrix));',
        'float wetVert = 1.0 - abs(wetWN.y);',
        'float wetStrN = wetNoise(vec2((vWetWP.x + vWetWP.z) * 5.0, vWetWP.y * 0.5));',
        'gWetStr = smoothstep(0.52, 0.85, wetStrN) * wetVert * uWetW;',
        'diffuseColor.rgb *= 1.0 - gWetStr * 0.22;',
        'diffuseColor.rgb *= 1.0 - smoothstep(0.6, 0.05, vWetWP.y) * uWetW * 0.16;'
      );
      mapCode.push(
        'vec3 wetSq = diffuseColor.rgb * diffuseColor.rgb;',
        'diffuseColor.rgb = mix(diffuseColor.rgb, wetSq, ' + cfg.dark.toFixed(3) + ' * gWetW);',
        'float wetLum = dot(diffuseColor.rgb, vec3(0.3333));',
        'diffuseColor.rgb = mix(vec3(wetLum), diffuseColor.rgb, 1.0 + ' + cfg.sat.toFixed(3) + ' * gWetW);',
        'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5, gWetPud * 0.5);'
      );
      var roughCode = [
        '#include <roughnessmap_fragment>',
        'float wetGlossAmt = smoothstep(0.15, 1.0, uWetG);',
        'roughnessFactor = mix(roughnessFactor, ' + cfg.roughWet.toFixed(3) + ', wetGlossAmt * ' + cfg.roughAmt.toFixed(3) + ');'
      ];
      if (cfg.streaks) roughCode.push('roughnessFactor = mix(roughnessFactor, 0.07, gWetStr * uWetG * 0.85);');
      if (cfg.streaks) roughCode.push('roughnessFactor = mix(roughnessFactor, 0.07, clamp(wetWN.y, 0.0, 1.0) * uWetG * 0.75);'); // las caras HORIZONTALES de la piedra juntan película de agua (brillo de tapa mojada); las verticales quedan con sus chorretes
      if (cfg.droplets) roughCode.push(
        // el césped no forma película (cera hidrófoba): forma GOTAS —
        // manchas puntuales de rugosidad casi nula que destellan al sol
        'float wetDrp = wetNoise(vWetWP.xz * 16.0 + vWetWP.yy * 9.0);',
        'roughnessFactor = mix(roughnessFactor, 0.10, step(0.80, wetDrp) * uWetG * 0.65);'
      );
      if (cfg.dU) roughCode.push('roughnessFactor = mix(roughnessFactor, 0.05, gWetPud);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + head)
        .replace('#include <map_fragment>', mapCode.join('\n'))
        .replace('#include <roughnessmap_fragment>', roughCode.join('\n'))
        .replace('#include <normal_fragment_maps>', wetNormalGLSL())
        .replace('#include <emissivemap_fragment>', wetEmissiveGLSL(cfg.film));
    }
    /* ============ Integración del estado (la llama weather.js) ============ */
    var wetUiT = 0, elWetW = null, elWetD = null;
    function wetStepClass(st, par, R, dtH) {
      if (R > 0.02) {
        st.W = clamp(st.W + (1 - st.W) * R * dtH / par.C, 0, 1);
        st.G = clamp(st.G + (1 - st.G) * R * dtH / (par.C * 0.5), 0, 1);
        if (st.G < st.W * 0.9) st.G = st.W * 0.9; // la película acompaña a la saturación mientras llueve
      } else {
        // secado en 3 etapas (informe §2.2): a W alto la superficie
        // evapora a tasa plena (etapa 1); al bajar W la tasa cae hacia
        // ~10 % (etapas 2–3, el suelo profundo tarda días). La tasa es
        // la ET0 de FAO-56 de ESTE frame dividida por el almacén Wmax.
        var fw = st.W > 0.6 ? 1 : 0.1 + 0.9 * (st.W / 0.6);
        st.W = clamp(st.W - EVAP.et0 * fw * dtH / par.Wmax, 0, 1);
        st.G = clamp(st.G - EVAP.et0 * dtH / (par.Wmax * 0.35), 0, 1); // la película (brillo) se va antes que el color
        if (st.W < 0.001) st.W = 0;
        if (st.G < 0.001) st.G = 0;
      }
    }
    function wetPond(st, R, f0, fc, tauDrain, maxD, dtH, ePud) {
      if (R > 0.02) {
        var f = fc + (f0 - fc) * (1 - st.W); // Horton simplificado: la capacidad cae al saturarse
        var excess = Math.max(0, R - f);
        // topes BAJOS a propósito: D es la lámina sobre el fondo de las
        // depresiones, no sobre todo el terreno — con el tope de 3–4,5 mm
        // y la máscara de charcos discretos, ni la tormenta inunda
        st.D = clamp(st.D + (excess - st.D / tauDrain) * dtH, 0, maxD);
      } else {
        // sin lluvia: dh/dt = −evaporación − infiltración (Ksat del
        // material: sendero compactado 1,5 mm/h, tierra franca 3,4 —
        // valores de ajuste del informe, no mediciones: los Ksat
        // publicados para la misma textura varían más de 10×)
        st.D = clamp(st.D - (ePud + fc) * dtH, 0, maxD);
      }
    }
    function updateWet(dt, t, px, pz) {
      UW.time.value = t;
      var R = Math.max(SIM.rainRate, rainEff * rainEff * 35) * (typeof rainLocalF !== 'undefined' ? rainLocalF : 1); // mm/h LOCALES: la del modelo (o el extra del slider) redistribuida por el campo de nubes sobre el jugador (v65) — el suelo se moja donde llueve, no en toda la planicie a la vez
      UW.rain.value = clamp(R / 35, 0, 1);
      var dtH = dt / 60; // horas de simulación (1 s real = 1 min)
      computeEvap(); // FAO-56 con la radiación, T, RH y viento de ESTE frame: el secado sale de la cadena, no de un factor suelto
      var dryF = clamp(EVAP.et0 / 0.45, 0.12, 2.2); // factor derivado SOLO para intercepción y huellas (lo demás usa EVAP directo)
      if (R > 0.02) WET.I = Math.min(1.5, WET.I + R * dtH);
      else WET.I = Math.max(0, WET.I - 0.25 * dryF * dtH);
      var groundR = WET.I >= 1.49 ? R : 0; // el suelo bajo el césped no recibe nada hasta llenar la intercepción
      wetStepClass(WET.path, WET_PAR.path, R, dtH);
      wetStepClass(WET.ground, WET_PAR.ground, groundR, dtH);
      wetStepClass(WET.stone, WET_PAR.stone, R, dtH);
      wetStepClass(WET.plaque, WET_PAR.plaque, R, dtH);
      wetStepClass(WET.wood, WET_PAR.wood, R, dtH);
      wetStepClass(WET.grass, WET_PAR.grass, R, dtH);
      wetStepClass(WET.iron, WET_PAR.iron, R, dtH);
      wetPond(WET.path, R, 25, 1.5, 1.5, 4.5, dtH, EVAP.puddlePath); // el sendero oscuro al sol evapora con boost de pavimento
      wetPond(WET.ground, groundR, 76, 3.4, 2.5, 3.0, dtH, EVAP.puddle);
      UW.pathW.value = WET.path.W; UW.pathG.value = WET.path.G; UW.pathD.value = WET.path.D;
      UW.groundW.value = WET.ground.W; UW.groundG.value = WET.ground.G; UW.groundD.value = WET.ground.D;
      UW.stoneW.value = WET.stone.W; UW.stoneG.value = WET.stone.G;
      UW.plaqueW.value = WET.plaque.W; UW.plaqueG.value = WET.plaque.G;
      UW.woodW.value = WET.wood.W; UW.woodG.value = WET.wood.G;
      UW.grassW.value = WET.grass.W; UW.grassG.value = WET.grass.G;
      UW.ironW.value = WET.iron.W; UW.ironG.value = WET.iron.G;
      // color de cielo que reflejan las superficies mojadas: el color del
      // horizonte del momento (niebla/cielo) atenuado por la luz real —
      // de día gris-azul brillante, al ocaso cálido, de noche casi negro
      UW.sky.value.copy(fogObj.color).multiplyScalar(0.30 + 0.80 * clamp(worldLight.ambient, 0, 1));
      // huellas: recentrado y decaimiento
      if (Math.abs(px - fpCx) > 18 || Math.abs(pz - fpCz) > 18) fpRecenter(px, pz);
      fpCenter.value.set(fpCx, fpCz);
      fpTick += dt;
      if (fpTick > 0.25) {
        var fdt = fpTick; fpTick = 0;
        var tauFp = R > 2 ? 6 : 12 + 30 * WET.ground.W; // minutos de simulación
        var dec = Math.exp(-(fdt * 1) / tauFp);
        if (dec < 0.9995) {
          for (var i = 0; i < fpData.length; i++) if (fpData[i]) fpData[i] = Math.floor(fpData[i] * dec);
          fpDirty = true;
        }
      }
      if (fpDirty) { fpTex.needsUpdate = true; fpDirty = false; }
      // panel VALORES del debug
      wetUiT += dt;
      if (wetUiT > 0.3) {
        wetUiT = 0;
        if (!elWetW) { elWetW = document.getElementById('dbgWetW'); elWetD = document.getElementById('dbgWetD'); }
        var elEvap = document.getElementById('dbgEvap');
        if (elEvap) elEvap.textContent = EVAP.et0.toFixed(2).replace('.', ',') + ' / ' + EVAP.puddle.toFixed(2).replace('.', ',') + ' mm/h · Rn ' + EVAP.rn.toFixed(2).replace('.', ',') + ' MJ/m²h';
        if (elWetW) elWetW.textContent = Math.round(WET.path.W * 100) + ' % / ' + Math.round(WET.ground.W * 100) + ' % / ' + Math.round(WET.stone.W * 100) + ' %';
        if (elWetD) elWetD.textContent = WET.path.D.toFixed(1).replace('.', ',') + ' mm / ' + WET.ground.D.toFixed(1).replace('.', ',') + ' mm · brillo ' + Math.round(WET.path.G * 100) + ' %';
      }
    }
