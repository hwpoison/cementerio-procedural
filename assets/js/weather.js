/* weather.js — Clima y momento del día: estado ENV/envCur, presets
   (soleado, nublado, lluvia, lúgubre, tormenta) y updateEnvironment, que
   integra sol, luna, nubes, niebla, lluvia y relámpagos en cada frame.
   Depende de: scene, sky (nubes/luna/sol/estrellas), audio (truenos). */
'use strict';
    /* ================= Clima, nubes dinámicas y momento del día ================= */
    var ENV = { hour: 11.5, cloud: 0, fog: 0, rain: 0, storm: 0, sun: 2.9, hemi: 0.85, exp: 0.78 };
    var envCur = { cloud: 0, fog: 0, rain: 0, storm: 0, sun: 2.9, hemi: 0.85, exp: 0.78 };
    var lightDir = new THREE.Vector3(0, 1, 0);
    /* ============ ÓRBITA REAL: distancia, tamaño y potencia del sol ============
       Una sola fuente de verdad orbital (informe sun-distance, 2026-11-22;
       NASA NSSDCA Earth Fact Sheet, NOAA GML Solar Calculator):
       constante solar S0 = 1361 W/m² a 1 UA (valor TIM moderno — el par
       1412/1321 W/m² que circula pertenece a la base vieja de ~1367 y NO
       se mezcla con esta). Excentricidad e = 0,0167: perihelio ≈147,10
       millones de km a principios de enero (¡el sol se ve MÁS grande en
       el invierno boreal!), afelio ≈152,10 a principios de julio.
       Factor de excentricidad de Duffie & Beckman E0 = (a/r)² =
       1 + 0,033·cos(2πn/365): la irradiancia extraterrestre es S0·E0
       (1408 W/m² en perihelio, 1317 en afelio: ±3,4 %) y el diámetro
       aparente θ = 2·atan(1 392 700 / 2r) va de 32,53′ a 31,46′.
       Las ESTACIONES no salen de la distancia: salen de la declinación
       (inclinación axial 23,44°) — serie de Fourier de la NOAA — que con
       la latitud del juego, Córdoba (Argentina) φ = −31,417°, fija la
       altura al mediodía (82,0° en diciembre, 35,2° en junio, 58,6° en
       los equinoccios — verificado contra timeanddate), la duración del
       día (14 h 12 m el 21-dic, 10 h 06 m el 21-jun) y el acimut de
       salida/puesta (63°–118° al amanecer). El sol culmina SIEMPRE al
       norte: las sombras del mediodía apuntan al sur todo el año. Y el
       perihelio (3-ene) cae en pleno VERANO austral: la distancia suma
       +6,9 % de irradiancia al verano y se la quita al invierno — al
       revés que en el hemisferio norte. La hora del juego
       es hora solar aparente: entra la ecuación del tiempo de la NOAA
       (−14 min en febrero a +16 en noviembre). Refracción de Bennett:
       el disco RENDERIZADO se levanta ~34′ en el horizonte (y la salida
       oficial es a −0,833° = 34′ de refracción + 16′ de semidiámetro).
       La luna usa la misma fórmula de tamaño con su distancia del mes
       anomalístico (27,5546 días; perigeo medio 363 300 km, apogeo
       405 500 km; época de perigeo: 24-dic-2026, el de la superluna de
       356 641 km del informe). */
    var ORBIT = {
      latDeg: -31.417, dayOfYear: 288, // Córdoba, Argentina (−31,417°, −64,183°, 425 m) · primavera austral por defecto (la estación manda, materials.js)
      S0: 1361, AU_KM: 149597870.7, SUN_DIAM_KM: 1392700,
      E0: 1, rKm: 149597870.7, thetaRad: 0.00931, thetaArcmin: 32.0, irradiance: 1361,
      declDeg: 0, eotMin: 0, altDeg: 0, azDeg: 180, noonAltDeg: 0, dayLengthH: 12, sunriseH: 6, sunsetH: 18
    };
    var MOONORB = { distKm: 384400, thetaRad: 0.00904, thetaArcmin: 31.1, halfRad: 0.00452 };
    var MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    function orbitDateLabel(n) {
      var m = 0; n = Math.round(clamp(n, 1, 365));
      while (n > MONTH_DAYS[m]) { n -= MONTH_DAYS[m]; m++; }
      return n + ' ' + MONTH_NAMES[m] + ' · día ' + Math.round(clamp(arguments[0], 1, 365));
    }
    function airMassKY(elevDeg) { // Kasten & Young 1989: m ≈ 1 en el cenit, ~38 en el horizonte
      return 1 / (Math.sin(elevDeg * Math.PI / 180) + 0.50572 * Math.pow(Math.max(6.07995 + elevDeg, 0.5), -1.6364));
    }
    function orbitCompute(n, hour) {
      ORBIT.dayOfYear = clamp(Math.round(n), 1, 365);
      var g = 2 * Math.PI * (ORBIT.dayOfYear - 1) / 365; // ángulo fraccional del año (NOAA)
      // distancia e irradiancia: serie de Spencer (SOLPOS) para (a/r)²
      ORBIT.E0 = 1.000110 + 0.034221 * Math.cos(g) + 0.001280 * Math.sin(g) + 0.000719 * Math.cos(2 * g) + 0.000077 * Math.sin(2 * g);
      ORBIT.rKm = ORBIT.AU_KM / Math.sqrt(ORBIT.E0);
      ORBIT.irradiance = ORBIT.S0 * ORBIT.E0;
      ORBIT.thetaRad = 2 * Math.atan(ORBIT.SUN_DIAM_KM / (2 * ORBIT.rKm));
      ORBIT.thetaArcmin = ORBIT.thetaRad * 180 / Math.PI * 60;
      // declinación y ecuación del tiempo: series de Fourier de la NOAA
      var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
      ORBIT.declDeg = decl * 180 / Math.PI;
      ORBIT.eotMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
      // posición: ángulo horario desde la hora solar aparente (reloj + EoT)
      var phi = ORBIT.latDeg * Math.PI / 180;
      var H = 15 * (hour + ORBIT.eotMin / 60 - 12) * Math.PI / 180;
      var sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
      ORBIT.altDeg = Math.asin(clamp(sinAlt, -1, 1)) * 180 / Math.PI;
      var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) * 180 / Math.PI + 180;
      ORBIT.azDeg = ((az % 360) + 360) % 360;
      ORBIT.noonAltDeg = 90 - Math.abs(ORBIT.latDeg - ORBIT.declDeg);
      // duración del día y salida/puesta con el sol a −0,833° (refracción + semidiámetro)
      var cosH0 = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
      if (cosH0 < -1) { ORBIT.dayLengthH = 24; ORBIT.sunriseH = 0; ORBIT.sunsetH = 24; }
      else if (cosH0 > 1) { ORBIT.dayLengthH = 0; ORBIT.sunriseH = 12; ORBIT.sunsetH = 12; }
      else {
        var H0 = Math.acos(cosH0) * 180 / Math.PI / 15;
        ORBIT.dayLengthH = 2 * H0;
        ORBIT.sunriseH = 12 - H0 - ORBIT.eotMin / 60;
        ORBIT.sunsetH = 12 + H0 - ORBIT.eotMin / 60;
      }
      // luna: distancia del mes anomalístico anclada al perigeo del 24-dic-2026
      var daysSincePerigee = (Date.now() - Date.UTC(2026, 11, 24)) / 86400000;
      MOONORB.distKm = 384400 - 21000 * Math.cos(2 * Math.PI * daysSincePerigee / 27.55455);
      MOONORB.thetaRad = 2 * Math.atan(3474.8 / (2 * MOONORB.distKm));
      MOONORB.thetaArcmin = MOONORB.thetaRad * 180 / Math.PI * 60;
      MOONORB.halfRad = MOONORB.thetaRad / 2;
      return ORBIT;
    }
    /* ============ TEMPERATURA AUTOMÁTICA (Córdoba, AR) ============
       La temperatura NO es una constante ni una tabla por temperatura:
       sale de la cadena estación → radiación → temperatura. Media
       mensual y rango diurno de Córdoba según el SMN argentino
       1991–2020 (estación Córdoba Observatorio, OMM 87345, tabla
       CORDOBA_TMEAN/DTR de abajo): la media varía 13,9 °C en el año
       (24,7 ene → 10,8 jul — estaciones AUSTRALES) y el ciclo diurno
       mueve 11–14 °C todo el año, con el máximo ~15:00 (2–3 h tras el
       mediodía solar) y el mínimo al amanecer. Enero es el mes más
       cálido (máx media 31,2) y julio el más frío (mín media 5,5,
       récord −7,1 °C): el invierno cordobés es seco y de noches
       frías, no tropical. La nubosidad del juego recorta la amplitud
       diurna desde los dos extremos, como siempre. */
    // Normales SMN Argentina 1991–2020, estación Córdoba Observatorio
    // (OMM 87345) — 31,4208° S, 64,1983° O, 425 m (vía NOAA NCEI
    // accesión 0253808 / Atlas Climático SMN 2024; informe
    // cordoba-argentina-clima-sol, 2026-11-22). Media anual 18,4 °C
    // (máx 25,3 / mín 12,8), lluvia 815,6 mm/año con el 83 % entre
    // oct y mar. DTR = máx media − mín media del SMN, mes a mes:
    // con Parton–Logan, tmax/tmin = media ± DTR/2 reproduce las
    // máx/mín medias (ene 31,2/18,9 · abr 25,0/13,3 · jul 18,4/5,5 ·
    // oct 26,3/13,4).
    var CORDOBA_TMEAN = [24.7, 23.2, 21.8, 18.4, 14.7, 11.6, 10.8, 13.5, 16.2, 19.4, 22.1, 24.2];
    var CORDOBA_DTR = [12.3, 11.6, 11.6, 11.7, 11.4, 12.6, 12.9, 14.1, 13.8, 12.9, 13.3, 12.9];
    function cordobaInterp(table, doy) {
      var x = (clamp(doy, 1, 365) - 15) / 30.44, i = Math.floor(x), f = x - i;
      i = ((i % 12) + 12) % 12;
      return table[i] * (1 - f) + table[(i + 1) % 12] * f;
    }
    /* Parton–Logan (informe mirage §3.6): de día, seno entre Tmin
       (amanecer) y Tmax con el pico corrido a ~15:00; de noche,
       decaimiento exponencial desde la temperatura de la puesta hacia
       Tmin con TC = 4 h. La nubosidad achica el rango desde los dos
       extremos (menos calentamiento de día, manta de noche), el viento
       mezcla y también lo achica, y la humedad pone piso a Tmin cerca
       del punto de rocío. */
    function autoTempNow() {
      var mean = cordobaInterp(CORDOBA_TMEAN, ORBIT.dayOfYear);
      var dtr = cordobaInterp(CORDOBA_DTR, ORBIT.dayOfYear);
      var shrink = (1 - 0.45 * envCur.cloud) * (1 - clamp((SIM_IN.U - 2) * 0.03, 0, 0.18));
      var tmax = mean + dtr * 0.5 * shrink, tmin = mean - dtr * 0.5 * shrink;
      if (typeof SIM !== 'undefined' && SIM.Td) tmin = Math.max(tmin, SIM.Td - 1.5); // el rocío capa la mínima
      var sr = ORBIT.sunriseH, ss = ORBIT.sunsetH, h = ENV.hour;
      if (h >= sr && h <= ss) {
        var x = (h - sr) / (ss - sr + 2.5);
        return tmin + (tmax - tmin) * Math.sin(Math.PI * clamp(x, 0, 1));
      }
      var xD = (ss - sr) / (ss - sr + 2.5);
      var tSunset = tmin + (tmax - tmin) * Math.sin(Math.PI * clamp(xD, 0, 1));
      var since = h > ss ? h - ss : h + 24 - ss;
      return tmin + (tSunset - tmin) * Math.exp(-since / 4);
    }
    /* ============ TEMPERATURA DE SUPERFICIE, CALIMA Y ESPEJISMO ============
       Informe mirage-heat-haze (2026-11-22): el aire se calienta DESDE
       el suelo. Ts por material sale del GHI real del frame (EVAP.ghi),
       su albedo y el viento (h_c crece con U), y lo mojado evapora y
       enfría: sendero oscuro seco ~+19 °C sobre el aire al mediodía de
       mayo (el modelo de pavimento da ~52 °C con aire 33 °C), césped
       apenas ~+6 °C. De ΔT salen los dos fenómenos: la CALIMA
       (turbulencia: distorsión en la pasada final, scene.js) y el
       ESPEJISMO inferior (gradiente organizado: banda brillante rasante
       en el shader del suelo, materials.js). AVISO DE ESCALA del
       informe: el espejismo real aparece a 200–600 m; en un cementerio
       amurallado es SUTIL y raro — una banda fina al fondo del sendero
       más largo, no un lago. Los cortes (gradiente ΔT 3→15 °C sobre
       una superficie de 33→50 °C, viento pleno ≤1 m/s y cero desde
       6 m/s) son anclas con interpolación de ajuste, no constantes
       medidas. */
    var SURF = { path: 0, stone: 0, ground: 0 };
    var HAZE = { f: 0, mirage: 0 };
    var FOG_DERIVED = 0; // niebla que DERIVA el modelo este frame (radiación / estrato en el suelo / frontal): la lee el panel VALORES y el asa de verificación
    var FOG_FRONTAL = 0; // componente frontal de la niebla derivada: la ÚNICA vía lluvia→niebla (ver el bloque de niebla en updateEnvironment)
    var PRECIP_F = 0; // oscurecimiento por precipitación (0–0,8): extinción de las gotas que caen — reduce la visibilidad SIN ser niebla; no toca el slider de niebla ni sus efectos (capa en altura, turbidez, estrellas)
    var precipCur = 0; // PRECIP_F suavizada en el tiempo, como envCur.fog
    function computeSurfaceTemps() {
      var ghi = (typeof EVAP !== 'undefined') ? EVAP.ghi : 0;
      var u = Math.max(SIM_IN.U, 0);
      function ts(k, wetW) { return SIM_IN.T + k * (ghi / 1000) * 30 / (1 + 0.3 * u) * (1 - wetW * 0.75); }
      SURF.path = ts(1.0, (typeof WET !== 'undefined') ? WET.path.W : 0);
      SURF.stone = ts(0.7, (typeof WET !== 'undefined') ? WET.stone.W : 0);
      SURF.ground = ts(0.3, (typeof WET !== 'undefined') ? WET.ground.W : 0);
      var dT = SURF.path - SIM_IN.T;
      /* CALOR VISIBLE — hacen falta DOS cosas a la vez: gradiente
         (superficie mucho más caliente que el aire) Y superficie
         caliente EN ABSOLUTO. La versión anterior sacaba heat SOLO
         de ΔT, y como Ts = T + Δ(sol, viento, humedad), ese ΔT no
         contiene a T: subir o bajar la temperatura movía Ts y T a
         la par, ΔT quedaba idéntico y el efecto ni aparecía con
         calor ni se quitaba al enfriar — el fallo que reportó el
         usuario. Ahora heat multiplica el gradiente por la
         temperatura absoluta del sendero. Todo sale de la misma Ts,
         que ya integra T, GHI, viento y lo mojado: bajar T enfría
         la superficie y el efecto se apaga; subirla lo enciende si
         hay sol. Sin casos escritos a mano. El viento del espejismo
         también se suavizó: con (4−u)/3 el viento por defecto
         (4 m/s) lo anulaba SIEMPRE y ninguna temperatura podía
         encenderlo; ahora pide calma de verdad (pleno ≤1 m/s, cero
         desde 6 m/s) sin veto al valor por defecto.
         PORTÓN DE TEMPERATURA (decisión de diseño de Guille,
         esquema §7): el arranque subió de ~33 °C a 57 °C de
         superficie y el pleno a ~71 °C. La física permitiría ver
         la distorsión un mediodía de primavera en Córdoba (sendero
         a ~45–50 °C), pero por diseño el efecto queda reservado
         al calor EXTREMO — ola de calor de verano austral, aire a ~40 °C o más:
         a 40 °C de aire con sol pleno y calma el sendero llega a
         ~63–71 °C y la distorsión aparece, solo de lejos como
         siempre (la máscara por profundidad no cambia). */
      var heat = clamp((dT - 3) / 12, 0, 1) * clamp((SURF.path - 57) / 14, 0, 1);
      HAZE.mirage = heat * clamp((worldLight.elev - 20) / 25, 0, 1) * clamp((6 - u) / 5, 0, 1) * (1 - envCur.cloud);
      HAZE.f = heat * clamp(worldLight.elev / 30 + 0.25, 0, 1) * (1 / (1 + u / 2)) * (1 - envCur.cloud * 0.8);
      if (typeof MIRAGE_U !== 'undefined') MIRAGE_U.value = HAZE.mirage;
    }
    function orbitRefraction(elevDeg) { // Bennett: levanta el disco aparente, ~34′ en el horizonte, ~1′ a 45°
      if (elevDeg < -1) return 0.6;
      return (1.02 / Math.tan((elevDeg + 10.3 / (elevDeg + 5.11)) * Math.PI / 180)) / 60;
    }
    orbitCompute(ORBIT.dayOfYear, 11.5);
    /* Cada preset es un estado climático CONSISTENTE completo: sus 4
       variables independientes del modelo físico (climate.js: T, RH,
       CAPE, U). La lluvia, los rayos, las ráfagas y la visibilidad NO
       se fijan aquí: se DERIVAN de esas 4 en cada frame, así el preset
       Lluvia es un nimboestrato real (5 mm/h, sin rayos) y el Tormenta
       un cumulonimbo real (35 mm/h, ~10 rayos/min, ráfagas 25–30 m/s). */
    var WX_PRESETS = {
      sunny:  { cloud: 0, fog: 0, rain: 0, storm: 0, sun: 2.9, hemi: 0.85, exp: 0.78, simT: 23, simRH: 45, simCAPE: 300, simU: 2.5 },
      cloudy: { cloud: 0.85, fog: 0, rain: 0, storm: 0, sun: 1.5, hemi: 0.72, exp: 0.80, simT: 14, simRH: 75, simCAPE: 10, simU: 5 }, // fog 0 a propósito (v45): la NUBOSIDAD NO IMPLICA NIEBLA — la niebla es saturación A NIVEL DEL SUELO (radiación, estrato con la base en la superficie o frontal), y este preset deriva 0 por las tres vías (spread ~5 °C, base ~640 m, viento 6 m/s). El fog 0,22 hardcodeado que traía era el acople que llenaba de neblina la escena al pulsar Nublado (reporte con foto, 23:42): banda blanca en el horizonte y tumbas lejanas lavadas con el aire limpio. Un día nublado puede tener visibilidad perfecta en el suelo.
      rain:   { cloud: 0.90, fog: 0, rain: 0.65, storm: 0, sun: 1.05, hemi: 0.60, exp: 0.75, simT: 14, simRH: 95, simCAPE: 50, simU: 6 }, // fog 0 a propósito: la lluvia NO trae niebla — es un parámetro aparte (slider) o la que derive el modelo por su causa propia; este preset deriva 0 (base ~100 m = nube baja, viento 7 m/s = sin frontal): solo recorta la visibilidad por su propia extinción
      gloomy: { cloud: 0.55, fog: 0.92, rain: 0, storm: 0, sun: 1.25, hemi: 0.55, exp: 0.75, simT: 9, simRH: 98, simCAPE: 0, simU: 1.5 },
      storm:  { cloud: 1.00, fog: 0, rain: 1, storm: 1, sun: 0.65, hemi: 0.50, exp: 0.70, simT: 29, simRH: 78, simCAPE: 2500, simU: 8 } // fog 0: la tormenta convectiva, con ráfagas y mezcla, es el caso opuesto a la niebla — su visibilidad cae por la cortina de lluvia, no por niebla · valores de tormenta de verano cordobesa (SMN: oct–mar, CAPE alto, ráfagas derivadas 70–90 km/h)
    };
    var rainOverride = 0; // el slider de densidad de lluvia queda como extra manual sobre la lluvia derivada del modelo
    /* ============ Clima VIVO: el tiempo evoluciona solo ============
       Los presets del debug son solo el punto de partida. Un «ánimo»
       (wxMood, 0 = despejado … 1 = temporal) pasea al azar y cada
       80–190 s elige una meta nueva (wxGoal): soleado, nublado, lluvia,
       tormenta ocasional o un episodio lúgubre de niebla. ENV deriva
       hacia la meta con una constante de ~40 s — nada cambia de golpe —
       y encima respira: la niebla y la nubosidad oscilan unos puntos
       con senos lentos desfasados. El viento también vive: su dirección
       vagabundea y su velocidad suma ráfagas. Como la oclusión del sol,
       las sombras de nube y la luz salen de las posiciones reales de
       las nubes, la luz cambia sola al caminar y al pasar el tiempo. */
    var wxMood = 0.05, wxTimer = 300;
    /* Clima MANUAL fijo: en cuanto el usuario toca un control de clima
       u hora en el debug, wxManual pasa a true y el clima vivo se
       DETIENE — sin deriva, sin respiración, sin nuevos objetivos: las
       condiciones quedan fijas tal como las dejó. (La hora nunca avanzó
       sola: solo cambia desde el debug, así que queda fija igual.) */
    var wxManual = false;
    var wxGoal = { cloud: ENV.cloud, fog: ENV.fog, rain: 0, storm: 0, sun: ENV.sun, hemi: ENV.hemi, exp: ENV.exp };
    var windAng = 3.927; // dirección instantánea (base + vagabundeo)
    var windBaseAng = 3.927; // dirección base regulable en el debug (225°): el viento predominante de Córdoba es del norte/noreste (MERRA-2, todo el año) — el vector apunta HACIA donde sopla: del NE hacia el SO
    var windMult = 1; // intensidad regulable en el debug (1 = la de la simulación)
    var cloudSpeedMult = 0.5; // velocidad de las nubes regulable; 0,5 por defecto: derivan despacio, como nubes altas reales
    var envFastT = 0; // >0 tras cambiar la hora o el preset: el entorno (nubes, luz, niebla) se acomoda rápido, sin deriva larga
    var wxUiT = 0;
    function pickWxGoal() {
      var R = Math.random;
      wxMood = clamp(wxMood + (R() - 0.44) * 0.55, 0, 1);
      var m = wxMood;
      simPickGoal(m); // el régimen nuevo también mueve las 4 variables del modelo físico: el clima vivo entero queda consistente
      if (R() < 0.10) { // episodio lúgubre: la niebla sube y envuelve todo
        wxGoal.cloud = 0.40 + R() * 0.25; wxGoal.fog = 0.68 + R() * 0.27; wxGoal.rain = 0; wxGoal.storm = 0;
      } else if (m < 0.30) { // despejándose / soleado — SIN meta de niebla (v45): la niebla del clima vivo solo nace del episodio lúgubre (un fenómeno de niebla explícito) o de las tres vías del modelo; ningún ánimo la inventa como acompañamiento
        wxGoal.cloud = 0.06 + R() * 0.24; wxGoal.fog = 0; wxGoal.rain = 0; wxGoal.storm = 0;
      } else if (m < 0.55) { // nublado variable — SIN meta de niebla (v45): este era el segundo acople nubosidad→niebla; el nublado deriva con el aire limpio y las tumbas lejanas nítidas
        wxGoal.cloud = 0.50 + R() * 0.40; wxGoal.fog = 0; wxGoal.rain = 0; wxGoal.storm = 0;
      } else if (m < 0.80) { // lluvia — SIN meta de niebla: la niebla no acompaña a la lluvia por defecto; si el modelo la deriva (frontal/radiación), aparece sola
        wxGoal.cloud = 0.78 + R() * 0.22; wxGoal.fog = 0; wxGoal.rain = 0.35 + R() * 0.50;
        wxGoal.storm = (m > 0.70 && R() < 0.35) ? 0.30 + R() * 0.40 : 0;
      } else { // temporal — ídem: niebla 0; la visibilidad la recorta la propia lluvia
        wxGoal.cloud = 0.90 + R() * 0.10; wxGoal.fog = 0; wxGoal.rain = 0.75 + R() * 0.25; wxGoal.storm = 0.55 + R() * 0.45;
      }
      wxGoal.sun = clamp(2.9 - wxGoal.cloud * 1.25 - wxGoal.rain * 0.55 - wxGoal.storm * 0.85, 0.6, 2.9);
      wxGoal.hemi = clamp(0.85 - wxGoal.cloud * 0.18 - wxGoal.rain * 0.14 - wxGoal.storm * 0.24, 0.50, 0.85);
      wxGoal.exp = clamp(0.78 - wxGoal.cloud * 0.05 - wxGoal.rain * 0.05 - wxGoal.storm * 0.08, 0.68, 0.78);
    }
    // los sliders del debug siguen a la deriva (salvo el que se está arrastrando)
    function syncWxUi() {
      var c = document.getElementById('dbgCloud'), f = document.getElementById('dbgFog');
      if (!c || !f) return;
      if (document.activeElement !== c) { c.value = Math.round(ENV.cloud * 100); var cv = document.getElementById('dbgCloudVal'); if (cv) cv.textContent = c.value + ' %'; }
      if (document.activeElement !== f) { f.value = Math.round(ENV.fog * 100); var fv = document.getElementById('dbgFogVal'); if (fv) fv.textContent = f.value + ' %'; }
    }
    function updateLivingWeather(dt, t) {
      if (wxManual) return; // clima fijado a mano: el tiempo automático está detenido
      wxTimer -= dt;
      if (wxTimer <= 0) { pickWxGoal(); wxTimer = 80 + Math.random() * 110; }
      // metas efectivas con respiración: oscilaciones lentas y desfasadas
      // con meta de niebla 0 la respiración no la levanta: niebla en 0 sigue siendo aire claro
      var gFog = wxGoal.fog <= 0.001 ? 0 : clamp(wxGoal.fog + Math.sin(t * 0.021) * 0.05 + Math.sin(t * 0.0083 + 1.7) * 0.04, 0, 1);
      // con meta de nubosidad 0 la respiración no crea nubes: cielo despejado de verdad
      var gCloud = wxGoal.cloud <= 0.001 ? 0 : clamp(wxGoal.cloud + Math.sin(t * 0.013 + 0.6) * 0.06, 0, 1);
      var kwx = 1 - Math.exp(-dt / 40); // deriva lenta: el clima tarda ~1 min en girar
      ENV.cloud += (gCloud - ENV.cloud) * kwx;
      ENV.fog += (gFog - ENV.fog) * kwx;
      ENV.rain += (wxGoal.rain - ENV.rain) * kwx;
      ENV.storm += (wxGoal.storm - ENV.storm) * kwx;
      ENV.sun += (wxGoal.sun - ENV.sun) * kwx;
      ENV.hemi += (wxGoal.hemi - ENV.hemi) * kwx;
      ENV.exp += (wxGoal.exp - ENV.exp) * kwx;
      wxUiT += dt;
      if (wxUiT > 1.5) { wxUiT = 0; syncWxUi(); }
    }
    var flash = 0, thunderTimer = 7, thunderSoundAt = -1, thunderPlayed = true, thunderVol = 0.8, thunderDistKm = 1;
    var _cDay = new THREE.Color(0xd3e3f2), _cNight = new THREE.Color(0x090d13), _cDusk = new THREE.Color(0xb57a44), _cGray = new THREE.Color(0x767f76), _fogC = new THREE.Color();
    var _sunWarm = new THREE.Color(0xff9a3c), _sunNoon = new THREE.Color(0xffe9c0), _moonC = new THREE.Color(0xffcea6), _moonDim = new THREE.Color(0x8a7460), _moonFogC = new THREE.Color(0xcbb59a); // luna = luz del sol REFLEJADA con color FÍSICO cálido ~4100 K (conversión de Planck aproximada, Tanner Helland): el regolito refleja más el rojo que el azul, así que la luz de luna es MÁS cálida que la del sol (5500–6500 K), no azul. Que se VEA gris azulada es el efecto Purkinje del ojo a baja luz — eso lo aplica la pasada de percepción (scene.js/main.js) según la luminancia, nunca un tinte fijo sobre la luz (informe moonlight-colors, 2026-11-22)
    var _sunSet = new THREE.Color(0xff5a18); // naranja profundo del sol en el horizonte (ocaso real)
    var _simLight = new THREE.Color(), _simZen = new THREE.Color(), _simFog = new THREE.Color(), _simCloud = new THREE.Color(); // temporales de la simulación de ocaso (tabla SUNSIM, sky.js)
    var _hemiSkyD = new THREE.Color(0xbdd7f2), _hemiSkyN = new THREE.Color(0x24344d), _hemiGN = new THREE.Color(0x1c1a14);
    /* Color de suelo de la hemisférica: DERIVADO del césped real de
       este frame (v50) — ya no es una constante verde: el 0x77854f de
       v49, convertido a lineal, era G/B ≈ 3 y bañaba de verde hasta en
       invierno con el pasto amarillo. Dos extremos y la mezcla la
       manda SEASON_DRY_U (la misma fracción de hierba seca que mezcla
       el shader del suelo): césped verde → salvia tenue; césped seco
       → paja cálida y algo más brillante (su ρ es mayor). _hemiGD se
       recalcula cada frame dentro de la tubería. */
    var _hemiGD = new THREE.Color();
    var _groundColGreen = new THREE.Color(0.150, 0.180, 0.110); // lineal: verdoso tenue, luminancia ≈ la del viejo 0x77854f ya convertido
    var _groundColDry = new THREE.Color(0.235, 0.185, 0.088); // lineal: paja cálida (ρ seco 0,35–0,45)
    var _moonDir = new THREE.Vector3(), _sp = new THREE.Vector3();
    var occSmooth = 0; // oclusión del sol por nubes, SUAVIZADA en el tiempo: la luz y las sombras cambian de forma gradual y dinámica cuando una nube cruza el sol, sin saltos
    var occMoonSm = 0, moonTransSm = 1, moonDiscTrans = 1, moonLuxNow = 0; // la MISMA oclusión, hacia la luna: T_luna = exp(−τ_luna), disco muestreado en 5 puntos y lux reflejados
    var moonTauT = 0, moonTauFld = 0, moonSliverFld = 1; // caché del campo lunar (muestreo a ~8 Hz)

    /* ============ NUBE DE PRUEBA (debug) ============
       Una sola nube colocada a demanda frente al sol o la luna para
       probar la oclusión: entra por la MISMA ley T = exp(−τ) con el
       disco muestreado en 5 puntos (centro + limbo de 0,265°) y perfil
       gaussiano de 0,75°, y su T multiplica la cadena normal (disco,
       halo, luz directa, sombras). Es un overlay de prueba: no toca el
       campo de nubes, el clima ni el modelo climático. */
    var TESTC = { on: false, target: 'sun', pos: 0, tau: 3.0, size: 1, sweep: false, sweepDir: 1 }; // size: multiplicador del tamaño angular de la nube (slider TAMAÑO)
    var testPosEl = null, testPosValEl = null; // refs perezosas al slider de posición (lo crea el HTML; lo mueve el barrido)
    var testDirNow = new THREE.Vector3(0, 1, 0);
    var testTNow = { mean: 1, sliver: 1, max: 1 };
    function testCloudCalc(dir) {
      var tAx = dir.z, tAz = -dir.x;
      var tAl = Math.sqrt(tAx * tAx + tAz * tAz);
      if (tAl < 0.05) { tAx = 1; tAz = 0; tAl = 1; }
      tAx /= tAl; tAz /= tAl;
      var tBx = -dir.y * tAz, tBy = dir.z * tAx - dir.x * tAz, tBz = dir.y * tAx;
      var off = Math.tan(TESTC.pos / 100 * (1.6 + TESTC.size * 1.2) * Math.PI / 180); // posición −100..100 → desplazamiento sobre el disco; el recorrido CRECE con el tamaño: una nube de 11° necesita ±8,8° para salir del disco y que el barrido siga mostrando parcial→total→parcial
      testDirNow.set(dir.x + tAx * off, dir.y, dir.z + tAz * off).normalize();
      var sum = 0, mx = 0;
      for (var k = 0; k < 5; k++) {
        var sx = dir.x, sy = dir.y, sz = dir.z;
        if (k > 0) {
          var an = (k - 1) * 1.5707963, limbR = (TESTC.eff || TESTC.target) === 'moon' ? MOONORB.halfRad : ORBIT.thetaRad / 2, cx = Math.cos(an) * limbR, cy = Math.sin(an) * limbR; // limbo al semidiámetro angular real del objetivo (el EFECTIVO: la fuente que la nube tapa este frame)
          sx += tAx * cx + tBx * cy; sy += tBy * cy; sz += tAz * cx + tBz * cy;
          var nl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1; sx /= nl; sy /= nl; sz /= nl;
        }
        var dot = clamp(sx * testDirNow.x + sy * testDirNow.y + sz * testDirNow.z, -1, 1);
        var ti = Math.exp(-TESTC.tau * Math.exp(-Math.pow(Math.acos(dot) / (0.0160 * TESTC.size), 6))); // SUPER-gaussiano (potencia 6): núcleo de τ PLENO y caída rápida en el margen — el ribete semitransparente es fino (silver lining) y el núcleo, con el τ nuevo del slider (hasta 24; el informe pide ≥15–20), da T < 10⁻⁶: el disco desaparece
        sum += ti; if (ti > mx) mx = ti;
      }
      testTNow.mean = sum / 5;
      testTNow.max = mx;
      testTNow.sliver = 0.30 * testTNow.mean + 0.70 * mx;
      return testTNow;
    }
    /* ============ COLOR POR EL CAMINO DE AIRE, NO POR LA NUBE ============
       CORRECCIÓN FÍSICA (informe light-rays, 2026-11-22): las gotas de
       nube son ≫ la longitud de onda (5–20 µm frente a 0,4–0,7 µm), así
       que su dispersión es de Mie NO selectiva: la nube atenúa en GRIS
       (T = exp(−τ) igual para todo λ) y convierte haz en difusa — NO
       tiñe la luz. El enrojecimiento selectivo vive en el camino de
       AIRE CLARO: Rayleigh ∝ λ⁻⁴ quita azul en proporción a la masa de
       aire atravesada. Por eso el factor de color sale de la MASA DE
       AIRE de la fuente (sol o luna, la misma ley): con la fuente alta
       es neutro; baja, el azul cae y la luz enrojece — para el disco,
       el halo, la luz directa y la hemisférica a la vez. τ óptico de
       Rayleigh por canal: 0,0496 (650 nm), 0,0973 (550), 0,221 (450). */
    var chromaSun = { r: 1, g: 1, b: 1 }, chromaMoon = { r: 1, g: 1, b: 1 }, airMoonT = { r: 1, g: 1, b: 1 };
    function chromaFromAirMass(am, out) {
      var ex = Math.max(am - 1, 0); // neutro a masa de aire 1 (fuente alta)
      var tr = Math.exp(-0.0496 * ex), tg = Math.exp(-0.0973 * ex), tb = Math.exp(-0.221 * ex);
      var m = (tr + tg + tb) / 3;
      if (!(m > 0)) { out.r = 1; out.g = 1; out.b = 1; return out; }
      out.r = clamp(tr / m, 0.55, 1.90); out.g = clamp(tg / m, 0.55, 1.90); out.b = clamp(tb / m, 0.45, 1.90);
      return out;
    }
    /* TRANSMITANCIA ABSOLUTA del camino de aire (v58): la misma ley
       Rayleigh y la misma convención (relativa a m = 1) que la croma
       de arriba, pero SIN normalizar por la media — lleva matiz Y
       magnitud: T_canal = exp(−τ_canal · (m − 1)). La croma basta
       para la LUZ (su magnitud la pone la cadena de intensidad),
       pero el DISCO de la luna es un sprite de brillo fijo: sin esta
       T su disco brillaba igual a 3° que a 60° de altura, solo más
       rojo, y se leía como una imagen pegada. Con la T absoluta el
       disco se apaga y enrojece al bajar con la misma física que el
       sol (a 3°, m ≈ 15: R 0,50 · G 0,26 · B 0,04 — brasas al ras del
       horizonte, como la luna real naciente). */
    function airTransFromAirMass(am, out) {
      var ex = Math.max(am - 1, 0);
      out.r = Math.exp(-0.0496 * ex); out.g = Math.exp(-0.0973 * ex); out.b = Math.exp(-0.221 * ex);
      return out;
    }

    /* ============ TIPOS DE NUBE Y TRANSMITANCIA DEL SOL: T = exp(−τ) ============
       Informe cloud-sun (2026-11-22): lo que incide no es la etiqueta de
       la nube sino su PROFUNDIDAD ÓPTICA τ a lo largo del rayo del sol —
       Beer–Lambert: T = exp(−τ). Cada tipo trae su extinción σ (relativa,
       calibrada para que T caiga en los rangos MEDIDOS por tipo), su piso
       de luz hemisférica bajo su sombra (bajo cubierta total la luz no
       muere: queda la difusa, ~25–40 % y sin dirección), su fuerza de
       rayos crepusculares y de borde plateado, la altura de su capa en el
       shader del cielo y cuántos grados de elevación «tarde» sigue viendo
       el sol tras la puesta (las nubes altas se apagan últimas: cirros
       20–25 min después que el suelo; la conversión a grados es ancla de
       ajuste, el ORDEN bajo→alto sí es físico).
         Cirros:            τ 0,1–1   → T 0,85–1,0 · velo, sin rayos duros
         Altocúmulos rotos: τ 1–5     → T 0,3–0,7 en la masa, 1 en claros
                            ★ el tipo de la foto: rayos y borde dorado
         Cúmulos:           núcleo τ 5–25 → T 0,02–0,1; borde T 0,6–0,9
         Estratos/nimbo:    τ 10–100+ → T < 0,3, a menudo < 0,05: sin
                            disco, sin rayos, luz difusa y sin sombras */
    /* billow / stretch: la FORMA del campo por tipo (algoritmo de
       nubes, esquema §16 — fbm + canal billow + estiramiento de
       dominio, asimilado de la investigación cloud-generation):
       billow = peso del canal de montículos 1−|ruido| que da el
       relieve de coliflor (máximo en cúmulos, casi nulo en cirros);
       stretch = compresión del dominio a lo largo de la deriva que
       estira los cirros en filamentos (0 = sin estirar). Ambos los
       leen el shader del cielo, la réplica CPU y el campo del suelo:
       un solo campo, una sola forma. */
    var CLOUD_TYPES = {
      cirrus:      { label: 'Cirros', sigma: 0.35, hemiFloor: 0.70, rays: 0.15, silver: 0.5, layer: 0.85, densMul: 0.55, delay: 4.5, billow: 0.15, stretch: 0.75 },
      altocumulus: { label: 'Altocúmulos rotos', sigma: 1.6, hemiFloor: 0.60, rays: 1.0, silver: 1.0, layer: 0.50, densMul: 1.0, delay: 2.0, billow: 0.55, stretch: 0.10 },
      cumulus:     { label: 'Cúmulos', sigma: 3.6, hemiFloor: 0.55, rays: 0.8, silver: 1.3, layer: 0.30, densMul: 1.5, delay: 0.8, billow: 1.0, stretch: 0.0 },
      stratus:     { label: 'Estratos', sigma: 5.5, hemiFloor: 0.60, rays: 0.0, silver: 0.3, layer: 0.15, densMul: 1.2, delay: 0.3, billow: 0.25, stretch: 0.15 }
    };
    var cloudTypeMode = 'auto'; // 'auto' (derivado del clima) o la clave elegida en el debug
    var cloudType = CLOUD_TYPES.altocumulus; // tipo efectivo de este frame
    var sunTau = 0, sunTrans = 1, sunTransSm = 1; // τ del camino del sol, T = exp(−τ) y su versión suavizada (~0,6 s)
    var occCase = 'Despejado'; // caso de oclusión legible (panel debug)
    var diffuseFrac = 0.12; // fracción difusa estimada de la luz total (medido: 8–16 % despejado, 60–100 % tapado)
    var bounceLevel = 0; // escalar del REBOTE DEL SUELO de este frame (materials.js, término GHI·ρ·(1−cos β)/2): ~0,13 = mediodía despejado con ρ banda ancha del césped 0,20 (v50: aporte SECUNDARIO y sutil a pedido de Guille — la luz principal de las tumbas es el sol DIRECTO sobre su albedo real; el rebote solo rellena); lo leen el panel VALORES y __game.state()
    var bounceTint = [1, 1, 1]; // tinte RGB del rebote de este frame, DERIVADO del estado del césped (verde tenue → paja cálida según SEASON_DRY_U, nunca una constante); lo lee __game.state()
    var rhoGroundNow = 0.20; // ρ de banda ancha del suelo de este frame (verde 0,20 → seco 0,40, ×0,90 mojado); lo lee __game.state()
    var AIRTL = 3, KT_NOW = 0, PEREZ_F1 = 0.5, PEREZ_F2 = 0.15; // turbidez de Linke, índice de claridad Kt y coeficientes de Perez del frame (panel VALORES)
    /* ============ ADAPTACIÓN VISUAL Y EFECTO PURKINJE ============
       El ojo, no la luz (informe moonlight-colors, §3–§4): se sigue
       una luminancia de adaptación La (cd/m²) con historia — la
       luminancia del suelo sale de L = ρ·E/π con ρ medio 0,18 y E la
       iluminancia del frame (sol: W/m² × ~100 lm/W; luna: sus lux).
       La adaptación es ASIMÉTRICA: hacia la luz τ ≈ 3,5 s (real 1–5
       min) y hacia la oscuridad τ ≈ 35 s — COMPRESIÓN JUGABLE
       declarada de los 30–45 min reales de los bastones. La fracción
       escotópica s interpola en log entre 5 cd/m² (fotópico, s=0) y
       0,005 cd/m² (escotópico, s=1), la banda mesópica CIE 191: con
       luna llena el suelo (L≈0,014) da s≈0,85; con cuarto (L≈0,001)
       s→1, monocromo. La pasada por píxel vive en scene.js y la
       aplica main.js: desatura hacia el gris escotópico y reequilibra
       R↓/B↑ SOLO en píxeles tenues — el disco de la luna (fotópico,
       ~2500 cd/m²) y la linterna quedan exentos y conservan su color
       cálido real. */
    var PURK = { La: 800, s: 0 };
    function updatePurkinje(dt, dni, dhi, sinEl, elevDeg) {
      var eLux = elevDeg > -0.8 ? (dni * Math.max(sinEl, 0) + dhi) * 100 : moonLuxNow;
      var target = clamp(eLux * 0.18 / Math.PI, 0.00008, 20000);
      if (typeof flashLevel !== 'undefined' && flashLevel > 0.05) target += flashLevel * 22; // el parche iluminado por la linterna readapta el ojo
      var tau = target > PURK.La ? 3.5 : 35;
      PURK.La += (target - PURK.La) * (1 - Math.exp(-dt / tau));
      if (!isFinite(PURK.La)) PURK.La = target;
      PURK.s = clamp((Math.log10(5) - Math.log10(Math.max(PURK.La, 1e-4))) / 3.0, 0, 1);
    }
    /* Perez et al. 1990 (tabla PVPMC/Sandia): coeficientes por clase de
       claridad ε — F1 = peso circunsolar de la difusa, F2 = brillo del
       horizonte. Despejado (ε>6,2): F1 ≈ 0,5, F2 ≈ +0,15; cubierto
       (ε→1): F1 ≈ 0,1, F2 ≈ −0,06 (el cenit brilla más que el horizonte). */
    var PEREZ_BINS = [1.065, 1.230, 1.500, 1.950, 2.800, 4.500, 6.200];
    var PEREZ_F = [
      [-0.008, 0.588, -0.062, -0.060, 0.072, -0.022], [0.130, 0.683, -0.151, -0.019, 0.066, -0.029],
      [0.330, 0.487, -0.221, 0.055, -0.064, -0.026], [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
      [0.873, -0.392, -0.362, 0.226, -0.462, 0.001], [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
      [1.060, -1.600, -0.359, 0.264, -1.127, 0.131], [0.678, -0.327, -0.250, 0.156, -1.377, 0.251]
    ];
    function perezCompute(dni, dhi, zenDeg, am, e0w) {
      if (!(dhi > 1) || !(e0w > 0) || zenDeg > 88) { PEREZ_F1 = 0.1; PEREZ_F2 = -0.05; return; }
      var zr = zenDeg * Math.PI / 180, z3 = 1.041 * zr * zr * zr;
      var eps = ((dhi + dni) / dhi + z3) / (1 + z3); // claridad del cielo ε
      var delta = dhi * am / e0w; // brillo del cielo Δ
      var bi = 0; while (bi < 7 && eps > PEREZ_BINS[bi]) bi++;
      var f = PEREZ_F[bi];
      PEREZ_F1 = Math.max(0, f[0] + f[1] * delta + zr * f[2]);
      PEREZ_F2 = f[3] + f[4] * delta + zr * f[5];
    }
    var rainEff = 0; // lluvia EFECTIVA del frame: máx(la explícita del clima, la derivada de la nube) — ver el bloque de lluvia
    /* SINCRONÍA LLUVIA–NUBOSIDAD (v65, estructural): el modelo físico
       deriva la tasa MEDIA (mm/h) de la nube media del tipo — la
       misma agua (LWP) que fija su τ = 1,5·LWP/re fija su lluvia
       (3,6·vt·kq·LWC·fEvap): para un tipo, lluvia ∝ τ. DÓNDE cae la
       reparte el campo: tasa local = media × profundidad local del
       MISMO campo fbm (cielo, sombra del suelo y ahora la lluvia) /
       su media espacial rainMeanD, muestreada en CPU (grilla 7×7,
       ±400 m, 2 Hz) con la proyección del suelo (dirección dy=120 ≡
       la ley de csFieldT). La integral sobre la planicie conserva
       la tasa del modelo: nada se inventa, se REDISTRIBUYE. */
    var rainLocalF = 1, rainLocalRate = 0, rainMeanD = 0.3, rainMeanT = -9, rainDtSm = 1 / 60;
    /* mm/h → [rayas dibujadas, alfa pico] — tabla §4.1 del informe de
       lluvia realista (caja 24×20×24, nivel teléfono): la cuenta y el
       alfa llevan la tasa junto con la niebla; por encima de 25 mm/h
       manda el alfa/niebla, no más rayas. Interpolación lineal. */
    var RAIN_TABLE = [[0, 0, 0], [1, 1000, 0.10], [2.5, 1750, 0.15], [5, 2750, 0.185], [10, 3750, 0.24], [25, 4000, 0.275], [60, 4000, 0.30]];
    function rainTableAt(rate) {
      for (var ti = 1; ti < RAIN_TABLE.length; ti++) {
        if (rate <= RAIN_TABLE[ti][0]) {
          var a = RAIN_TABLE[ti - 1], b = RAIN_TABLE[ti], f = (rate - a[0]) / Math.max(b[0] - a[0], 0.001);
          return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
        }
      }
      return [4000, 0.30];
    }
    var SIM_RENDER_TYPE = { clear: 'cirrus', cirrus: 'cirrus', st: 'stratus', sc: 'stratus', ns: 'stratus', cu: 'cumulus', congestus: 'cumulus', cb: 'stratus', cbsev: 'stratus' };
    function pickCloudType() {
      if (cloudTypeMode !== 'auto' && CLOUD_TYPES[cloudTypeMode]) return CLOUD_TYPES[cloudTypeMode];
      if (envCur.cloud < 0.20) return CLOUD_TYPES.cirrus; // capa fina y alta: apenas atenúa
      // el tipo lo decide el MODELO FÍSICO (CAPE × humedad × profundidad),
      // mapeado a la capa de render: nimbo/cumulonimbo/estratos comparten
      // la capa baja y densa; los cúmulos, la suya; cirros, la alta
      return CLOUD_TYPES[SIM_RENDER_TYPE[SIM.typeKey] || 'altocumulus'];
    }
    /* Réplica en JS del campo de nubes del shader del cielo (mismo hash
       sin senos, mismo ruido por gradiente, mismo fbm de 4 octavas y la
       misma variación regional de cobertura): la profundidad de nube que
       la CPU integra hacia el sol es la de la nube que el jugador VE
       tapándolo en el skybox. La precisión float64 vs float32 alcanza
       de sobra para un escalar de iluminación. */
    function _fract(x) { return x - Math.floor(x); }
    function _gradHash(ix, iy) {
      var px = _fract(ix * 0.1031), py = _fract(iy * 0.1030), pz = _fract(ix * 0.0973);
      var d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
      px += d; py += d; pz += d;
      return [_fract((px + py) * pz) * 2 - 1, _fract((px + pz) * py) * 2 - 1];
    }
    function _skyNoise(x, y) {
      var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      var ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      var g00 = _gradHash(ix, iy), g10 = _gradHash(ix + 1, iy), g01 = _gradHash(ix, iy + 1), g11 = _gradHash(ix + 1, iy + 1);
      var a = g00[0] * fx + g00[1] * fy, b = g10[0] * (fx - 1) + g10[1] * fy;
      var c = g01[0] * fx + g01[1] * (fy - 1), dd = g11[0] * (fx - 1) + g11[1] * (fy - 1);
      return lerp(lerp(a, b, ux), lerp(c, dd, ux), uy) * 1.6;
    }
    function _skyFbm(x, y, drift) {
      var r = 0, amp = 1;
      for (var i = 0; i < 4; i++) { r += amp * _skyNoise(x, y); amp *= 0.5; x = x * 2 + drift; y = y * 2 + drift; }
      return r;
    }
    function cloudDepthAtJS(dx, dy, dz, tNow) {
      var u = sky.material.uniforms;
      var elevMix = lerp(1.0, 0.1, cloudType.layer);
      var py = Math.max(dy, 0.045);
      var cs = u.cloudSpeed.value, scale = u.cloudScale ? u.cloudScale.value : 0.0002;
      var cuvX = dx / (py * elevMix) * scale + tNow * cs, cuvY = dz / (py * elevMix) * scale + tNow * cs;
      // FORMA del campo (esquema §16): la MISMA transformación que el
      // shader del cielo — estiramiento del dominio a lo largo de la
      // deriva (filamentos de cirro) y canal billow 1−|ruido| que
      // modula el espesor (montículos de coliflor). Si la réplica no
      // la aplicara, la τ hacia el sol/luna sería la de OTRO campo
      // que el que el jugador ve.
      var cK = lerp(1.0, 0.32, u.uCStretch ? u.uCStretch.value : 0);
      var cU = (cuvX + cuvY) * 0.7071, cV = (cuvY - cuvX) * 0.7071;
      var sX = 0.7071 * cU * cK - 0.7071 * cV, sY = 0.7071 * cU * cK + 0.7071 * cV;
      var evJ = tNow * cs * 300;
      var cn = clamp(_skyFbm(sX * 1000, sY * 1000, evJ) * 0.7 + 0.5, 0, 1);
      var cbJ = 1 - Math.abs(_skyNoise(sX * 2600 + 13.7 + evJ * 0.7, sY * 2600 + 7.9 + evJ * 0.7));
      cn = clamp(cn * (1 + (u.uCBillow ? u.uCBillow.value : 0) * (cbJ - 0.45) * 0.55), 0, 1);
      var rg = _skyNoise(cuvX * 300, cuvY * 300) * 0.37 + 0.5;
      var cv = clamp(u.cloudCoverage.value + (rg - 0.5) * 0.6, 0, 1);
      var dep = Math.max(0, cn - (1 - cv));
      return isFinite(dep) ? dep : 0; // el campo jamás devuelve NaN: un NaN aquí envenenaba τ y la luz quedaba en negro para siempre
    }
    // lecturas derivadas del panel debug (T, τ, caso, difusa): se
    // refrescan ~3 veces por segundo desde updateEnvironment
    var cloudUiT = 0, elSunT = null, elOccCase = null, elDiffuse = null, elCTypeNow = null, elMoonLux = null, orbEls = null;
    function fmtH(h) { h = ((h % 24) + 24) % 24; var hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
    function updateCloudDebug() {
      if (!elSunT) { elSunT = document.getElementById('dbgSunT'); elOccCase = document.getElementById('dbgOccCase'); elDiffuse = document.getElementById('dbgDiffuse'); elCTypeNow = document.getElementById('dbgCloudTypeNow'); elMoonLux = document.getElementById('dbgMoonLux'); }
      if (!orbEls) { orbEls = {}; var oids = ['OrbDist', 'OrbTheta', 'OrbIrr', 'OrbDecl', 'OrbDay', 'OrbMoon', 'AirTL', 'AirKt', 'Perez']; for (var oi = 0; oi < oids.length; oi++) orbEls[oids[oi]] = document.getElementById('dbg' + oids[oi]); }
      if (orbEls.OrbDist) orbEls.OrbDist.textContent = (ORBIT.rKm / 1e6).toFixed(2).replace('.', ',') + ' M km · E0 ' + ORBIT.E0.toFixed(3).replace('.', ',');
      if (orbEls.OrbTheta) orbEls.OrbTheta.textContent = ORBIT.thetaArcmin.toFixed(2).replace('.', ',') + '′ · ' + ORBIT.thetaRad.toFixed(4).replace('.', ',') + ' rad';
      if (orbEls.OrbIrr) orbEls.OrbIrr.textContent = Math.round(ORBIT.irradiance) + ' W/m² (S0 1361 × E0)';
      if (orbEls.OrbDecl) orbEls.OrbDecl.textContent = ORBIT.declDeg.toFixed(1).replace('.', ',') + '° / ' + ORBIT.noonAltDeg.toFixed(1).replace('.', ',') + '° · EoT ' + (ORBIT.eotMin >= 0 ? '+' : '') + ORBIT.eotMin.toFixed(0) + ' min';
      if (orbEls.OrbDay) orbEls.OrbDay.textContent = ORBIT.dayLengthH.toFixed(1).replace('.', ',') + ' h · ' + fmtH(ORBIT.sunriseH) + ' / ' + fmtH(ORBIT.sunsetH);
      if (orbEls.OrbMoon) orbEls.OrbMoon.textContent = Math.round(MOONORB.distKm).toLocaleString('es') + ' km · ' + MOONORB.thetaArcmin.toFixed(1).replace('.', ',') + '′';
      if (orbEls.AirTL) orbEls.AirTL.textContent = AIRTL.toFixed(1).replace('.', ',');
      if (orbEls.AirKt) orbEls.AirKt.textContent = KT_NOW > 0 ? KT_NOW.toFixed(2).replace('.', ',') : '—';
      if (orbEls.Perez) orbEls.Perez.textContent = PEREZ_F1.toFixed(2).replace('.', ',') + ' / ' + (PEREZ_F2 >= 0 ? '+' : '') + PEREZ_F2.toFixed(2).replace('.', ',');
      var elPurk = document.getElementById('dbgPurk');
      if (elPurk) elPurk.textContent = (PURK.La >= 10 ? Math.round(PURK.La).toLocaleString('es') : PURK.La.toFixed(3).replace('.', ',')) + ' cd/m² · s ' + PURK.s.toFixed(2).replace('.', ',');
      var elSurf = document.getElementById('dbgSurfT');
      if (elSurf) elSurf.textContent = SURF.path.toFixed(0) + ' / ' + SURF.stone.toFixed(0) + ' / ' + SURF.ground.toFixed(0) + ' °C · espejismo ' + Math.round(HAZE.mirage * 100) + ' % · calima ' + Math.round(HAZE.f * 100) + ' %';
      if (elMoonLux) elMoonLux.textContent = moonLuxNow.toFixed(2).replace('.', ',') + ' lux · T = ' + moonTransSm.toFixed(2).replace('.', ',');
      var elFogDer = document.getElementById('dbgFogDer');
      if (elFogDer) elFogDer.textContent = Math.round(FOG_DERIVED * 100) + ' % · frontal ' + Math.round(FOG_FRONTAL * 100) + ' % · T−Td ' + (SIM_IN.T - SIM.Td).toFixed(1).replace('.', ',') + ' °C · efectiva ' + Math.round(envCur.fog * 100) + ' %';
      var elRainVis = document.getElementById('dbgRainVis');
      if (elRainVis) elRainVis.textContent = SIM.rainRate >= 0.1 ? (SIM.visRain >= 10000 ? '>10 km' : (SIM.visRain / 1000).toFixed(1).replace('.', ',') + ' km') + ' · β ' + Math.round(precipCur * 100) + ' % · niebla ' + Math.round(envCur.fog * 100) + ' % · aquí ×' + rainLocalF.toFixed(2).replace('.', ',') + ' (' + rainLocalRate.toFixed(1).replace('.', ',') + ' mm/h)' : 'sin lluvia';
      if (elSunT) elSunT.textContent = 'T = ' + sunTransSm.toFixed(2).replace('.', ',') + ' · τ = ' + sunTau.toFixed(2).replace('.', ',');
      var elPen = document.getElementById('dbgPen');
      if (elPen) { var _penSrcE = worldLight.elev > -0.8 ? worldLight.elev : MOON.elev; var _penW = (1.5 / Math.max(Math.sin(Math.max(_penSrcE, 0) * Math.PI / 180), 0.06)) * Math.tan(2 * 0.00465); elPen.textContent = (_penW * 100).toFixed(1).replace('.', ',') + ' cm a 1,5 m · radio ' + sun.shadow.radius.toFixed(1).replace('.', ',') + ' téxeles'; }
      if (elOccCase) elOccCase.textContent = occCase;
      if (elDiffuse) elDiffuse.textContent = Math.round(diffuseFrac * 100) + ' %';
      var elBounce = document.getElementById('dbgBounce');
      if (elBounce) elBounce.textContent = Math.round(bounceLevel / 0.13 * 100) + ' % del mediodía despejado';
      if (elCTypeNow) elCTypeNow.textContent = envCur.cloud <= 0.02 ? 'Sin nubes' : cloudType.label + (cloudTypeMode === 'auto' ? ' (auto)' : '');
    }

    /* ============ LA ÚNICA TUBERÍA DE LUZ (arquitectura del proyecto) ============
       Hay UNA sola fuente de verdad: el sol (la luna es esa misma luz
       reflejada, albedo ~0,12 × fase). Cada frame la luz se CALCULA UNA
       VEZ desde la posición e intensidad de la fuente y se MODULA por lo
       que se interpone — masa de aire y nubes con su τ por tipo y su
       T(λ) = exp(−τ(λ)) por longitud de onda — y TODOS los consumidores
       leen ese mismo resultado: disco, halo, luz direccional, luz
       hemisférica, cielo, niebla, terreno y tumbas. No hay modos de
       iluminación «despejado/nublado» ni valores duros por caso: los
       presets son solo condiciones iniciales de ENV, y fenómenos como
       el enrojecimiento tras la nube, el piso difuso o la luna que se
       apaga y VUELVE al despejarse EMERGEN de la modulación. Nada en la
       cadena guarda un estado que pueda quedar trabado: todo se
       recalcula desde las entradas actuales, así que devolver una
       entrada a su valor anterior devuelve la escena exacta. */
    function updateEnvironment(dt, px, pz, t) {
      updateLivingWeather(dt, t); // el clima deriva solo antes de integrar el frame
      updateClimate(dt); // modelo físico: deriva las 4 independientes y recalcula TODO lo demás (climate.js)
      // lluvia y tormenta dejan de ser perillas: son la salida del modelo
      // (mm/h → fracción de partículas; rayos/min → fracción de tormenta)
      ENV.rain = SIM.rainFrac;
      ENV.storm = SIM.stormFrac;
      SIM_COVER = ENV.cloud; // la cobertura manda sobre el modelo: sin nubes en el cielo, el modelo no deriva ninguna
      // acomodación rápida: tras un cambio de hora (o de preset) la tasa de
      // integración sube ~7× durante 1 s — nubes, luz, niebla y exposición
      // quedan en su sitio casi al instante, sin cola de transición
      envFastT = Math.max(0, envFastT - dt);
      var k = 1 - Math.exp(-dt * (envFastT > 0 ? 7.5 : 1.1)), i, b;
      var fields = ['cloud', 'fog', 'rain', 'storm', 'sun', 'hemi', 'exp'];
      for (i = 0; i < fields.length; i++) { envCur[fields[i]] += (ENV[fields[i]] - envCur[fields[i]]) * k; if (!isFinite(envCur[fields[i]])) envCur[fields[i]] = ENV[fields[i]]; } // ningún estado interpolado puede quedar trabado en NaN
      /* NIEBLA DERIVADA DEL MODELO (a pedido — desacoplada de la
         nubosidad Y de la lluvia): la niebla es un parámetro APARTE.
         Es gotitas SUSPENDIDAS en el aire pegado al suelo (OMM: solo
         se llama niebla si bajan la visibilidad a <1 km); la lluvia
         son gotas que CAEN y recortan la visibilidad por su propia
         extinción, sin ser niebla. Por eso la niebla verdadera solo
         nace por TRES vías, todas con sus condiciones:
         (1) RADIACIÓN: noche despejada y calma, cuando el suelo
         irradia al espacio, se enfría hasta el punto de rocío y el
         aire pegado al suelo se satura — cercanía a la saturación
         (T − Td < ~2 °C), calma (U baja) y FRENO DE LAS NUBES (de
         noche la capa nubosa reemite onda larga hacia abajo, el
         suelo apenas se enfría: más nubes de noche = MENOS niebla).
         Es también la vía POST-LLUVIA: si tras llover el cielo se
         despeja de noche, con el suelo mojado y calma, el spread
         queda chico y esta misma fórmula levanta la niebla sola,
         horas después — sin que la lluvia la fuerce.
         (2) ESTRATO EN EL SUELO: el estrato/nimboestrato cuya base
         derivada baja hasta la SUPERFICIE misma (la nube toca el
         suelo: eso es niebla por definición). El corte bajó de 260 a
         60 m: una base a ~100 m —la del preset Lluvia, LCL con
         T−Td ≈ 0,8 °C— es nube baja con su cortina de lluvia, NO
         niebla; solo con el aire de superficie saturado del todo
         (T−Td ≲ 0,5 °C, base ≲ 60 m) la nube está en el suelo.
         (3) FRONTAL (de precipitación, OMM Atlas de Nubes §3.2.1.1.1):
         la ÚNICA vía directa lluvia→niebla. La lluvia estratiforme
         que cae de aire cálido a una capa fría y ESTABLE se evapora
         bajo la base y satura esa capa. Exige a la vez: tipo
         estratiforme (ns/st — la convectiva mezcla y la destruye),
         aire ya casi saturado (T−Td < ~3 °C: la evaporación solo
         tiene que cerrar una brecha chica), viento LIGERO (<~5 m/s)
         y lluvia continua (≥~0,25 mm/h, creciendo hasta ~2,5 mm/h).
         Fuera de ese rincón, llover no produce niebla alguna.
         La lluvia, en TODOS los casos, aporta su extinción propia
         (PRECIP_F, abajo): β_total = β_niebla + β_lluvia
         (Koschmieder), y solo el β_total recorta la visibilidad. */
      var fogSpread = SIM_IN.T - SIM.Td;
      var fogSatF = clamp((2.4 - fogSpread) / 2.0, 0, 1); // T−Td ≤0,4 °C: pleno; ≥2,4 °C: nada
      var fogCalmF = clamp((3.2 - SIM_IN.U) / 2.6, 0, 1); // calma: U ≤0,6 m/s pleno; ≥3,2 nada (el viento mezcla y rompe la inversión)
      var fogNightF = 1 - (worldLight.dayF || 0); // fracción nocturna (frame anterior: variable lenta, sin saltos)
      var fogCloudBrake = 1 - envCur.cloud * 0.88 * fogNightF; // el freno de onda larga: solo de noche, y casi total con cubierta cerrada
      var fogRad = fogSatF * fogCalmF * fogCloudBrake * (0.20 + 0.80 * fogNightF);
      var fogStrat = (SIM.typeKey === 'st' || SIM.typeKey === 'ns') ? clamp((60 - SIM.base) / 60, 0, 1) * clamp(envCur.cloud * 1.4, 0, 1) : 0; // estrato cuya base ESTÁ en el suelo (≤60 m) = niebla; base ~100 m = nube baja, sin niebla
      var fogFront = 0;
      if ((SIM.typeKey === 'ns' || SIM.typeKey === 'st') && SIM.rainRate >= 0.25) {
        fogFront = clamp((3.0 - fogSpread) / 2.5, 0, 1) * clamp((5 - SIM_IN.U) / 3.5, 0, 1) * clamp(SIM.rainRate / 2.5, 0, 1) * 0.85;
      }
      FOG_FRONTAL = fogFront;
      var fogDerived = clamp(Math.max(fogRad * 0.9, fogStrat, fogFront), 0, 1);
      FOG_DERIVED = fogDerived;
      // la niebla efectiva es la manual del panel O la derivada por
      // las tres vías — la lluvia YA NO entra en esta cuenta
      var fogTarget = Math.max(ENV.fog, fogDerived);
      envCur.fog += (fogTarget - envCur.fog) * k;
      /* OSCURECIMIENTO POR PRECIPITACIÓN (aparte de la niebla): las
         gotas que caen extinguen la luz a lo largo de la vista con su
         β propio (climate.js: rainBeta desde la tasa, Koschmieder).
         Se expresa en la misma escala 0–0,8 que usaba el acople viejo
         para poder SUMAR su densidad a la de la niebla en el objeto
         Fog (abajo), pero NO entra en envCur.fog: no levanta la capa
         de niebla en altura, no enturbia el cielo, no apaga estrellas
         ni tiñe el horizonte como niebla — solo acorta la vista,
         como la lluvia real. Sin lluvia vale 0 y no queda residuo. */
      PRECIP_F = SIM.rainRate >= 0.1 ? clamp((3200 - SIM.visRain) / 3200, 0, 0.8) : 0;
      precipCur += (PRECIP_F - precipCur) * k;
      // sol según la ÓRBITA real (ORBIT): altura y acimut desde latitud
      // −31,417°, declinación del día y ángulo horario con ecuación del
      // tiempo — la salida ya no es siempre a las 6 ni el mediodía a 58°:
      // la época manda (día de 14,2 h en diciembre, 10,1 h en junio,
      // culminación siempre al norte)
      orbitCompute(ORBIT.dayOfYear, ENV.hour);
      var elev = ORBIT.altDeg;
      var elevApp = elev + orbitRefraction(elev); // el disco se RENDERIZA a su altura aparente (refracción de Bennett)
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevApp), THREE.MathUtils.degToRad(ORBIT.azDeg));
      sunThetaF = ORBIT.thetaRad / 0.009308; // tamaño del núcleo sprite ∝ diámetro aparente de la época (media 32,0′)
      moonThetaF = MOONORB.thetaRad / 0.009042; // ídem luna (media 31,1′)
      if (sky.material.uniforms.uSunHalfRad) sky.material.uniforms.uSunHalfRad.value = ORBIT.thetaRad / 2;
      if (sky.material.uniforms.uTestSize) sky.material.uniforms.uTestSize.value = TESTC.size;
      sky.material.uniforms.sunPosition.value.copy(sunDir);
      /* Color del disco ESTE frame según la simulación de atardecer
         (sky.js, SUNSIM): la transmitancia exp(−τ·m) con m = masa de aire
         de Kasten & Young — dorado a +10°, naranja a +5°, #FF4E00 a 0°.
         Lo consumen el shader del cielo (disco analítico + halo Mie), los
         sprites del sol y el color de la luz directa: UN solo color
         físico para todo el sistema, como en el mundo real. */
      sunSimColor(SUNSIM.disc, elev, SUN_DISC_NOW);
      /* El uniform del disco va en el espacio PROPIO de la tabla
         SUNSIM (tríos sRGB), que es el espacio en el que viven los
         literales de la banda del horizonte dentro del parche del
         cielo. La versión anterior copiaba SUN_DISC_NOW en LINEAL
         (setHex de three convierte sRGB→lineal: el verde de #FF4E00
         cae de 0,31 a 0,07) y encima multiplicaba OTRA VEZ por
         chromaSun (g ×0,55 en el horizonte): doble enrojecimiento
         que la banda no sufre. Resultado medido por réplica: bajo
         ~2,5° de elevación el disco quedaba con MENOS luminancia
         que el cielo que lo rodea tras el ACES de la pasada final
         (0,36 contra 0,57 a 0°) — un disco más oscuro que su fondo
         no tiene contorno visible, es el «eclipse» otra vez. La
         tabla ya ES exp(−τ·m) por elevación, así que el chroma no
         se reaplica aquí: sigue tiñendo la luz directa (más abajo)
         y SUN_DISC_NOW queda en lineal para luces y destellos. */
      if (sky.material.uniforms.uSunDiscCol) sky.material.uniforms.uSunDiscCol.value.copy(SUN_DISC_NOW).convertLinearToSRGB();
      var dayF = clamp((elev + 2) / 10, 0, 1);
      var duskF = clamp(1 - Math.abs(elev) / 16, 0, 1);
      /* Cielo DESPEJADO de verdad con nubosidad 0: turbidez y Mie al mínimo
         (aire limpio, azul intenso y nítido, horizonte fino) y Rayleigh
         pleno. Ningún velo residual: el difuminado solo entra en la medida
         exacta en que suben la nubosidad o la niebla — la turbidez crece
         con las nubes (el cielo se vuelve lechoso y gris) y el Mie con la
         niebla. De noche el cielo se apaga a casi negro para que manden
         la luna y las estrellas. */
      var skyClear = (1 - envCur.cloud) * (1 - envCur.fog * 0.7);
      /* Día RADIANTE con aire limpio (nubosidad y niebla en 0): azul
         intenso y nítido. OJO con la trampa que hacía ver el cielo
         «invertido»: el Sky va SIN tone mapping (scene.js), así que su
         radiancia recorta a blanco en cuanto supera 1. El Rayleigh alto
         (antes hasta 4,3 en despejado) dispara Lin — que va elevado a
         1,5 en el shader — y el cielo entero saturaba a BLANCO; al subir
         la nubosidad el Rayleigh bajaba a ~1,7, la radiancia entraba en
         rango y recién ahí aparecía el azul. Por eso el azul se veía
         con nubes y no sin ellas. Ahora el Rayleigh tiene TECHO en
         despejado (~2,1: azul saturado sin saturar la salida) y baja al
         nublarse, mientras turbidez y Mie hacen el trabajo de volver el
         cielo lechoso y gris con las nubes — la dirección correcta:
         despejado = azul penetrante, nublado = pálido. El factor radiant
         (plus de exposición de la escena, no del cielo) se conserva. */
      var radiant = Math.pow(skyClear, 1.6) * clamp((elev - 4) / 26, 0, 1);
      /* DISPERSIÓN ≠ NUBOSIDAD (corrección física, captura del whiteout):
         la turbidez y el Mie del cielo base son AEROSOLES del aire —
         dependen de la NIEBLA, nunca de la nubosidad. Antes ambos
         crecían con (1 − skyClear), es decir CON las nubes: a más
         nubosidad, más dispersión Mie en TODO el cielo y el encuadre
         entero estallaba a blanco plano, sin nubes ni gris. Ahora la
         nubosidad manda SOLO en τ (cobertura × densidad × σ) y en
         T = exp(−τ): disco, halo, aureola, luz directa y brillo de la
         capa de nubes se ATENÚAN con T. La dispersión que las nubes
         añaden es hacia adelante y LOCAL junto al sol (aureola y borde
         plateado del parche, ya multiplicados por T), jamás una
         ganancia global. Techos bajos: turbidez ≤ 5,5 y Mie ≤ 0,006. */
      var skyHaze = 1 - envCur.fog * 0.75;
      sky.material.uniforms.turbidity.value = lerp(5.5, 2.2, skyHaze) * (0.25 + 0.75 * dayF);
      sky.material.uniforms.rayleigh.value = (0.55 + 1.55 * Math.pow(skyClear, 1.25) * clamp((elev + 2) / 14, 0, 1) + duskF * 0.65) * (0.15 + 0.85 * dayF); // el plus de Rayleigh al ocaso/amanecer bajó de 1,2 a 0,65: era parte del gran resplandor blanco que lavaba el cielo en la foto del usuario
      sky.material.uniforms.mieCoefficient.value = lerp(0.006, 0.0015, skyHaze);
      sky.material.uniforms.mieDirectionalG.value = lerp(0.65, 0.80, skyHaze);
      // luna: fase (automática = la real de hoy, u forzada en el debug),
      // arco nocturno propio (sale ~18 h, culmina ~0 h, se pone ~6 h)
      if (MOON.mode === 'auto') { var lp = lunarAgeNow(); MOON.age = lp.age; MOON.p = lp.p; }
      else { MOON.p = MOON.manual / 8; MOON.age = MOON.p * SYNODIC; }
      MOON.illum = (1 - Math.cos(2 * Math.PI * MOON.p)) / 2;
      MOON.name = PHASE_NAMES[Math.floor(((MOON.p + 1 / 16) % 1) * 8)];
      var fm = ((((ENV.hour - 18) % 24) + 24) % 24) / 12;
      MOON.elev = Math.sin(fm * Math.PI) * 54;
      _moonDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - MOON.elev), THREE.MathUtils.degToRad(96 + fm * 168));
      MOON.upF = clamp((MOON.elev + 2) / 12, 0, 1);
      // viento según el clima: brisa con sol, más viento con lluvia y
      // rachas fuertes con tormenta; las nubes derivan con él
      // viento vivo y REGULABLE: la dirección es la base del debug más un
      // vagabundeo lento acotado (±~38°); la velocidad suma ráfagas y todo
      // se multiplica por la intensidad del debug. El mismo viento mueve
      // ramas y césped (uniforms de balanceo), empuja las nubes y, cuando
      // sopla fuerte, disipa la niebla (más abajo).
      windAng = windBaseAng + 0.45 * Math.sin(t * 0.043) + 0.22 * Math.sin(t * 0.011 + 2.0);
      WIND.dirX = Math.cos(windAng); WIND.dirZ = Math.sin(windAng);
      /* FLUJO DE NUBES (a pedido): traslación procedural CONTINUA en una
         sola dirección, sin oscilación de ida y vuelta. La dirección es
         FIJA — la del slider del debug (windBaseAng), sin vagabundeo
         sinusoidal — y la velocidad es constante y lenta, sin ráfagas:
         las nubes fluyen hacia un lugar y siguen; al salir del campo
         reaparecen por el lado opuesto (relativo al
         jugador). El viento con ráfagas y vagabundeo (WIND) queda solo
         para el balanceo de ramas y césped, que sí es oscilatorio. */
      var flowDirX = Math.cos(windBaseAng), flowDirZ = Math.sin(windBaseAng);
      // deriva de nubes desde el viento MEDIO del modelo: la nube baja
      // viaja ~al viento de superficie; el yunque del cumulonimbo, con
      // el viento de altura (~1,4×). El slider de velocidad escala.
      var flowSpeed = SIM_IN.U * 0.45 * (SIM.typeKey === 'cb' || SIM.typeKey === 'cbsev' ? 1.4 : 1.0) * cloudSpeedMult * windMult;
      var gustBase = Math.sin(t * 0.35) * 0.6 + Math.sin(t * 0.13 + 1.3) * 0.55;
      // viento instantáneo = medio del modelo + proceso de ráfagas hasta
      // el pico derivado (factor de ráfaga × medio, o medio + bonus de
      // corriente descendente en tormenta): nunca supera SIM.gustPeak
      var gust = Math.pow(Math.max(0, gustBase), 3) * Math.max(SIM.gustPeak - SIM_IN.U, 0);
      WIND.speed = (SIM_IN.U + gust) * windMult;
      WIND_TIME_U.value = t;
      WIND_AMP_U.value = clamp(WIND.speed / 9, 0.08, 2.4);
      WIND_DIR_U.value.set(WIND.dirX, WIND.dirZ);
      // nubes del propio shader del cielo (skybox): misma cobertura que
      // las volumétricas 3D y avance con el mismo viento, para que el
      // cielo lejano y las nubes cercanas sean el mismo cielo. Con
      // nubosidad 0 la cobertura es 0: cielo despejado y nítido.
      cloudType = pickCloudType(); // el tipo manda en densidad, altura de capa y σ de todo este frame
      /* Factor de DENSIDAD τ (override del debug): la referencia
         automática del tipo es τ_ref = σ·2,2 (cirro ~0,8, altocúmulo
         ~3,5, cúmulo ~6,6, estrato ~11 — los rangos MEDIDOS por tipo).
         Fijar τ escala la densidad del CAMPO COMPARTIDO: el mismo
         escalar entra en el shader del cielo (cloudTransAt), en la
         réplica CPU hacia el sol y hacia la luna (tauField/moonTauFld
         leen este uniform) y por T = exp(−τ) en disco, halo, luz
         directa, hemisférica y brillo de capa — una sola ley. */
      var tauRefNow = Math.max(cloudType.sigma * 2.2, 0.05);
      var tauFactor = TAU_OVR.auto ? 1 : clamp(TAU_OVR.tau / tauRefNow, 0.02, 8);
      if (sky.material.uniforms.cloudCoverage) {
        sky.material.uniforms.cloudCoverage.value = clamp(envCur.cloud * 1.05, 0, 1);
        sky.material.uniforms.cloudDensity.value = clamp((0.35 + envCur.cloud * 0.5) * cloudType.densMul * tauFactor, 0.02, 6); // cada tipo pesa distinto sobre el mismo campo; el override τ escala ese peso
        sky.material.uniforms.cloudSpeed.value = 0.000010 * flowSpeed; // avance monótono del tiempo del shader: las nubes del skybox derivan siempre en el mismo sentido, al ritmo del flujo
        sky.material.uniforms.time.value = t;
        if (sky.material.uniforms.cloudElevation) sky.material.uniforms.cloudElevation.value = cloudType.layer; // altura de la capa: cirros altos y finos, estratos bajos y planos
        if (sky.material.uniforms.uCloudSigma) sky.material.uniforms.uCloudSigma.value = cloudType.sigma / 1.6; // σ relativo (el 12·densidad del shader ya está calibrado para altocúmulos)
        if (sky.material.uniforms.uSilver) sky.material.uniforms.uSilver.value = cloudType.silver;
        if (sky.material.uniforms.uCBillow) sky.material.uniforms.uCBillow.value = cloudType.billow; // forma del campo: canal billow (coliflor) del tipo
        if (sky.material.uniforms.uCStretch) sky.material.uniforms.uCStretch.value = cloudType.stretch; // forma del campo: estiramiento de dominio (filamentos de cirro)
        // brillo de la capa de nubes = sol ATENUADO por la propia capa:
        // piso difuso del tipo + (1 − piso) · T (T suavizada del frame
        // anterior: es un escalar lento, sin saltos) — bajo cubierta
        // total las nubes del Sky se apagan a su gris difuso
        if (sky.material.uniforms.uCloudDiffuse) sky.material.uniforms.uCloudDiffuse.value = cloudType.hemiFloor + (1 - cloudType.hemiFloor) * sunTransSm;
        /* El MISMO cuerpo de nube en los materiales del mundo: los
           uniforms compartidos de csFieldT reciben los valores de
           ESTE frame del shader del cielo (cobertura, densidad, σ,
           capa, deriva) y la dirección de la fuente vigente (sol de
           día, luna de noche): la luz que ilumina cada punto del
           suelo y de las tumbas es la que atravesó ese cuerpo. */
        if (typeof CLOUDSH_U !== 'undefined') {
          CLOUDSH_U.uCCov.value = sky.material.uniforms.cloudCoverage.value;
          CLOUDSH_U.uCDen.value = sky.material.uniforms.cloudDensity.value;
          CLOUDSH_U.uCSigma.value = sky.material.uniforms.uCloudSigma ? sky.material.uniforms.uCloudSigma.value : 1;
          CLOUDSH_U.uCTime.value = t;
          CLOUDSH_U.uCSpeed.value = sky.material.uniforms.cloudSpeed.value;
          CLOUDSH_U.uCElev.value = cloudType.layer;
          CLOUDSH_U.uCFloor.value = cloudType.hemiFloor; // piso difuso dentro de la sombra del campo: el mismo hemiFloor que da el brillo de la capa en el cielo (uCloudDiffuse) — una sola fórmula para la luz que sobrevive a la nube, en el cielo y en el suelo
          CLOUDSH_U.uCBillow.value = cloudType.billow; // la FORMA del campo también es una sola: el suelo lee el mismo billow/estiramiento que dibuja el cielo
          CLOUDSH_U.uCStretch.value = cloudType.stretch;
          CLOUDSH_U.uCSunDir.value.copy(sunDir.y > -0.014 ? sunDir : _moonDir); // el cambio de fuente de la sombra del campo es EL MISMO que el de la luz direccional (elev −0,8° ⇔ sen = −0,014): antes la sombra cambiaba a −1,15° y en esa banda crepuscular la luz ya era de luna pero el campo se seguía proyectando con el sol bajo el horizonte
        }
      }
      /* NUBES VOLUMÉTRICAS: ELIMINADAS a pedido (2026-11-22). Sin
         blobs no hay oclusión por masas ni slots de sombra por blobs:
         el τ hacia el sol es SOLO el cuerpo de nube real — el campo
         de la capa del cielo — y ese mismo campo, evaluado por punto
         en los materiales (csFieldT), es la luz que llega al suelo:
         no hay «sombra de nube» aparte. CLOUD_AMT es la fuerza de esa
         modulación por punto (0 sin nubes; la NUBE DE PRUEBA la sube
         a 0,85 y escribe el slot 0 con su propia mancha). */
      CLOUD_AMT_U.value = envCur.cloud <= 0.01 ? 0 : clamp(0.35 + envCur.cloud * 0.65, 0, 1) * clamp(0.25 + 0.75 * Math.max(dayF, MOON.upF * MOON.illum), 0, 1);
      var occ = 0;
      occSmooth += (occ - occSmooth) * (1 - Math.exp(-dt / 1.1));
      if (!isFinite(occSmooth)) occSmooth = occ;
      if (occSmooth < 0.001 && occ === 0) occSmooth = 0;
      /* ===== T_sun: EL escalar que manda en todo el sistema =====
         τ suma dos capas reales del camino del sol: el campo del skybox
         (réplica JS exacta: es la nube que se VE sobre el disco) y las
         nubes volumétricas 3D a ~120 m (occ). T = exp(−τ) alimenta el
         disco y su aureola (uniform al shader), la luz directa (lineal
         en T, sin exponentes extra: la física ya es exponencial en τ),
         el piso hemisférico del tipo y la suavidad de las sombras. */
      var tauField = 0;
      // manto uniforme de cubierta cerrada (réplica del deckB del shader):
      // con cobertura >72 % la capa tiene τ alto en todas partes, sin
      // puntos casi transparentes por los que se cuele el resplandor.
      // Se calcula SIEMPRE, fuera del if del sol: el bloque de la luna lo
      // reutiliza y antes vivía dentro del if diurno — de noche deckB
      // quedaba undefined, τ_luna salía NaN y el NaN se quedaba pegado
      // en moonTransSm PARA SIEMPRE (la luna desaparecía y no volvía ni
      // bajando la nubosidad a 0: era el bug reportado).
      var deckB = sky.material.uniforms.cloudCoverage ? Math.pow(clamp((sky.material.uniforms.cloudCoverage.value - 0.72) / 0.28, 0, 1), 1.5) * 0.30 : 0;
      if (envCur.cloud > 0.005 && sunDir.y > 0.02 && sky.material.uniforms.cloudCoverage) {
        var depF = cloudDepthAtJS(sunDir.x, sunDir.y, sunDir.z, t);
        var slantF = lerp(1.0, clamp(1 / Math.max(sunDir.y, 0.18), 1, 3.2), 0.65); // camino rasante real: τ del haz = τ vertical / cos θz (Beer–Lambert), amortiguado porque el campo ya integra parte del camino
        tauField = (depF + deckB) * sky.material.uniforms.cloudDensity.value * 12 * (cloudType.sigma / 1.6) * slantF;
        if (!isFinite(tauField)) tauField = 0;
      }
      sunTau = tauField + occSmooth * cloudType.sigma * 0.55;
      if (!isFinite(sunTau)) sunTau = 0;
      sunTrans = Math.exp(-sunTau);
      /* NUBE DE PRUEBA sobre el sol: su oclusión es LOCAL, no global
         (corrección a pedido): una nube es un cuerpo en UN pedazo de
         cielo — tapa el disco PARA EL OJO que mira a través de ella
         (eso lo hace el shader por rayo, testTransAt) y quita la luz
         directa SOLO en su sombra proyectada en el suelo (slot 0 de
         los materiales, abajo). Su T ya NO multiplica sunTrans: antes
         una sola nube al máximo apagaba la luz directa, la
         hemisférica y la exposición de TODO el mundo y el suelo salía
         negro en la captura, como si el cielo entero estuviera
         cubierto. El cálculo se sigue haciendo: alimenta los rayos,
         el borde y la sombra local. */
      /* OBJETIVO EFECTIVO de la nube de prueba (v60, diagnóstico del
         reporte de Guille 13:47: «con la nube de prueba no veo que su
         incidencia afecte la iluminación sobre el terreno»). La cadena
         de la sombra (slot 0) seguía al OBJETIVO elegido a mano, y el
         objetivo por defecto es el Sol: de noche, con el sol bajo el
         horizonte, la nube quedaba bajo el horizonte con él — sin
         sprite, sin oclusión y con el slot en 0 — y la prueba parecía
         no proyectar sombra alguna. La nube es UN CUERPO en el cielo:
         sigue al objetivo elegido mientras esa fuente esté arriba, y
         si está bajo el horizonte pasa a la fuente que manda (la
         activa), para el disco, el sprite y la sombra a la vez. */
      var tcEff = TESTC.target;
      if (TESTC.on) {
        if (tcEff === 'sun' && sunDir.y <= 0.04 && _moonDir.y > 0.04) tcEff = 'moon';
        else if (tcEff === 'moon' && _moonDir.y <= 0.04 && sunDir.y > 0.04) tcEff = 'sun';
      }
      TESTC.eff = tcEff;
      var testSunActive = TESTC.on && tcEff === 'sun';
      if (testSunActive) {
        testCloudCalc(sunDir);
      }
      if (sky.material.uniforms.uTestTau) {
        /* La nube de prueba es UN CUERPO en UNA dirección del cielo,
           esté el objetivo en el sol o en la luna: sus uniforms se
           escriben siempre que esté activa y la GEOMETRÍA decide qué
           fuente tapa (testTransAt vale ~1 hacia cualquier dirección
           lejos del cuerpo). Antes uTestTau solo se escribía con el
           objetivo en el sol: apuntando a la luna, el cuerpo no existía
           para el shader y el bloque lunar (ribete, aureola) no lo
           muestreaba — el disco sprite se apagaba por la CPU pero la
           aureola del cielo seguía brillando a través de la nube. */
        sky.material.uniforms.uTestTau.value = TESTC.on ? TESTC.tau : 0;
        if (TESTC.on) sky.material.uniforms.uTestDir.value.copy(testDirNow);
        if (sky.material.uniforms.uTestSize) sky.material.uniforms.uTestSize.value = TESTC.size; // sin esto el slider TAMAÑO no llegaba al disco del shader (solo a la CPU): parte de por qué el efecto se veía sutil
        /* Fuerza del ABANICO crepuscular de la nube de prueba: máxima
           cuando el BORDE de la masa cruza el disco (algún punto del
           limbo aún transmite y el centro ya no: max ≫ mean), cero
           con el disco libre o tapado del todo. La CPU pone la fuerza;
           el abanico lo dibuja el shader con la T de la propia nube
           como puerta (tras la masa oscuro, por el hueco el haz). */
        if (sky.material.uniforms.uTestRays) sky.material.uniforms.uTestRays.value = testSunActive ? clamp((testTNow.max - testTNow.mean) * 2.4, 0, 1) * clamp(TESTC.tau / 2.5, 0.15, 1) * 1.7 : 0;
      }
      chromaFromAirMass(airMassKY(elev), chromaSun); // color del sol por su camino de aire (Rayleigh): la nube atenúa en gris, el aire enrojece
      sunTransSm += (sunTrans - sunTransSm) * (1 - Math.exp(-dt / 0.6));
      if (!isFinite(sunTransSm)) sunTransSm = sunTrans; // jamás un NaN pegado en la cadena de luz
      if (sky.material.uniforms.uSunTrans) sky.material.uniforms.uSunTrans.value = sunTransSm;
      // luna en el shader del cielo: dirección y fuerza de su luz sobre
      // la capa (bordes plateados, aureola, azul profundo) — la cadena
      // real: fase × elevación × T_luna (frame anterior, variable
      // lenta) × slider de luna, apagada por la niebla y por el día
      if (sky.material.uniforms.uMoonDir) sky.material.uniforms.uMoonDir.value.copy(_moonDir);
      if (sky.material.uniforms.uMoonSilver) sky.material.uniforms.uMoonSilver.value = (1 - dayF) * MOON.illum * MOON.upF * moonTransSm * moonGlow * clamp(1 - envCur.fog * 1.1, 0, 1);
      /* ===== T_luna: UNA SOLA LEY DE TRANSPORTE DE LUZ =====
         El cielo es uno y la luz es una: la luna se ocluye con la MISMA
         física que el sol — T = exp(−τ) a lo largo del rayo hacia la
         luna, sobre el MISMO campo de nubes del skybox y las MISMAS
         nubes volumétricas, con la σ del mismo tipo de nube. Y la luna
         es una fuente INDIRECTA: luz del sol reflejada. Cadena física
         con métricas reales: irradiancia solar 1361 W/m² (constante
         solar, NSSDC) → albedo lunar ~0,12 → luna llena ≈ 0,25 lux en
         el suelo, frente a 32 000–100 000 lux del sol (~1/400 000).
         La fase manda cuánto refleja (nueva = 0) y T_luna cuánto de eso
         atraviesa las nubes: disco, halo, luz direccional, hemisférica
         y niebla nocturna salen TODOS de este mismo escalar. */
      /* El campo hacia la luna se muestrea a ~8 Hz, no por frame: el
         fbm de 4 octavas × 5 puntos es el costo nuevo del bloque y la
         luna se mueve despacio — entre muestreos mandan la caché y el
         suavizado de T. (El del sol sigue por frame, como ya estaba.) */
      moonTauT -= dt;
      if (moonTauT <= 0) {
        moonTauT = 0.12;
        moonTauFld = 0; moonSliverFld = 1;
        if (envCur.cloud > 0.005 && _moonDir.y > 0.02 && sky.material.uniforms.cloudCoverage) {
          var depM = cloudDepthAtJS(_moonDir.x, _moonDir.y, _moonDir.z, t);
          var slantM = lerp(1.0, clamp(1 / Math.max(_moonDir.y, 0.18), 1, 3.2), 0.65); // mismo camino rasante que el sol: exp(−τc/cos θz,luna)
          moonTauFld = (depM + deckB) * sky.material.uniforms.cloudDensity.value * 12 * (cloudType.sigma / 1.6) * slantM;
          if (!isFinite(moonTauFld)) { moonTauFld = 0; moonSliverFld = 1; }
          // disco muestreado en 5 puntos (centro + limbo de 0,265°), como
          // el sol: con oclusión parcial manda la parte destapada — una
          // medialuna de disco brilla a través del borde de la nube
          var tAx = _moonDir.z, tAz = -_moonDir.x; // perpendicular horizontal a la dirección lunar
          var tAl = Math.sqrt(tAx * tAx + tAz * tAz);
          if (tAl < 0.05) { tAx = 1; tAz = 0; tAl = 1; }
          tAx /= tAl; tAz /= tAl;
          var tBx = -_moonDir.y * tAz, tBy = _moonDir.z * tAx - _moonDir.x * tAz, tBz = _moonDir.y * tAx; // segunda perpendicular (cross)
          var tSumM = Math.exp(-moonTauFld), tMaxM = tSumM;
          for (var mk = 0; mk < 4; mk++) {
            var man = mk * 1.5707963, mcx = Math.cos(man) * MOONORB.halfRad, mcy = Math.sin(man) * MOONORB.halfRad; // limbo al semidiámetro angular real de la luna de hoy
            var mdx = _moonDir.x + tAx * mcx + tBx * mcy, mdy = _moonDir.y + tBy * mcy, mdz = _moonDir.z + tAz * mcx + tBz * mcy;
            var mNorm = Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz) || 1;
            var depMk = cloudDepthAtJS(mdx / mNorm, mdy / mNorm, mdz / mNorm, t);
            var tkM = Math.exp(-(depMk + deckB) * sky.material.uniforms.cloudDensity.value * 12 * (cloudType.sigma / 1.6) * slantM);
            tSumM += tkM; if (tkM > tMaxM) tMaxM = tkM;
          }
          moonSliverFld = 0.30 * (tSumM * 0.2) + 0.70 * tMaxM;
        }
      }
      var tauFieldM = moonTauFld, tSliverM = moonSliverFld;
      var occM = 0; // sin volumétricas: la luna se ocluye SOLO con el campo del cielo, como el sol
      occMoonSm += (occM - occMoonSm) * (1 - Math.exp(-dt / 1.1));
      if (!isFinite(occMoonSm)) occMoonSm = occM;
      var moonTau = tauFieldM + occMoonSm * cloudType.sigma * 0.55;
      if (!isFinite(moonTau)) moonTau = 0; // la oclusión se RECALCULA cada frame desde el campo actual: nada queda pegado
      var moonTrans = Math.exp(-moonTau);
      // NUBE DE PRUEBA sobre la luna: la misma ley, el mismo muestreo
      var testMoonActive = TESTC.on && tcEff === 'moon';
      var testSliverM = 1, testMeanM = 1;
      if (testMoonActive) {
        testCloudCalc(_moonDir);
        // LOCAL también de noche: la T de la prueba solo apaga el
        // DISCO para el ojo (testSliverM → moonDiscTrans); la luz de
        // luna global no se toca por una sola nube
        testSliverM = testTNow.sliver;
        testMeanM = testTNow.mean;
      }
      chromaFromAirMass(airMassKY(MOON.elev), chromaMoon); // la luna baja también enrojece por el camino de aire (Rayleigh), no por la nube (gris)
      moonChroma.r = chromaMoon.r; moonChroma.g = chromaMoon.g; moonChroma.b = chromaMoon.b; // lo lee el sprite/halo en sky.js
      airTransFromAirMass(airMassKY(MOON.elev), airMoonT);
      moonAirT.r = airMoonT.r; moonAirT.g = airMoonT.g; moonAirT.b = airMoonT.b; // T ABSOLUTA del camino de aire lunar (matiz y magnitud): la lee el DISCO en sky.js — al bajar, la luna se apaga de verdad, no solo cambia de tono (v58)
      moonTransSm += (moonTrans - moonTransSm) * (1 - Math.exp(-dt / 0.6));
      if (!isFinite(moonTransSm)) moonTransSm = moonTrans; // si algo raro entrara, la luna se recupera en el frame siguiente, nunca desaparece para siempre
      /* UNA SOLA LEY PARA EL DISCO DE AMBAS FUENTES (revisión
         estructural v44, a pedido): T_disco = T_campo × T_prueba,
         multiplicativa, con el MISMO muestreo de 5 puntos (centro +
         limbo al semidiámetro real) que usa el disco del sol en el
         shader. La fórmula anterior (0,35·T_centro + 0,65·sliver)
         tenía un piso ADITIVO que no pasaba por la nube de prueba:
         con la prueba a τ 24 tapando la luna, el disco conservaba
         ~35 % de brillo — «la nube opaca al sol pero no a la luna»
         (reporte 23:28). El sol nunca tuvo ese piso: su disco se
         multiplica por cada capa que se interpone (T_total =
         Π T_capa, Beer–Lambert en serie). moonTransSm (centro,
         suavizada) sigue mandando en lo difuso — halo, lux en el
         suelo, luz y uMoonSilver — como sunTransSm en el sol. */
      moonDiscTrans = clamp(tSliverM * testSliverM * Math.exp(-occMoonSm * cloudType.sigma * 0.55), 0, 1);
      /* Lux reales de luna en el suelo (informes light-rays y
         moonlight-colors): 0,25 lux es SOLO la llena ALTA y despejada
         (techo 0,32 en cenit/trópico/perigeo; la típica llena templada
         da 0,05–0,1). La fase sale de la fórmula de KRISCIUNAS &
         SCHAEFER 1991 según el ángulo de fase α desde la llena:
         factor = 10^(−0,4·(0,026·α + 4·10⁻⁹·α⁴)) — el cuarto (α=90°)
         da 0,095×, no la mitad: la parte litada está a ángulo rasante
         y falta el opposition surge (>40 % en los últimos 4° a llena).
         Escala además con sen(altura), con la distancia (perigeo más
         brillante, ~(384400/D)²) y con T de nubes, que es GRIS. */
      var phaseAngMoon = 360 * Math.abs(MOON.p - 0.5);
      var krisMoon = Math.pow(10, -0.4 * (0.026 * phaseAngMoon + 4e-9 * Math.pow(phaseAngMoon, 4)));
      moonLuxNow = 0.25 * krisMoon * Math.pow(clamp(Math.sin(MOON.elev * Math.PI / 180), 0, 1), 0.7) * Math.pow(384400 / MOONORB.distKm, 2) * moonTransSm;
      /* Rayos: solo con capa ROTA (máximo ~50 % de cobertura), sol bajo
         y un tipo que los admita (estratos = 0 siempre). La compuerta
         (0,30 + 0,70·T) deja pasar rayos de borde aun con el disco
         tapado si el claro está al lado — el corredor lo define la
         marcha del shader, no este escalar. */
      var brokenF = clamp(1 - Math.abs(envCur.cloud - 0.52) / 0.40, 0, 1);
      var rayElev = clamp(1 - Math.max(0, elev - 6) / 34, 0, 1) * clamp((elev + 1.5) / 4, 0, 1);
      if (sky.material.uniforms.uRays) sky.material.uniforms.uRays.value = cloudType.rays * brokenF * rayElev * (0.30 + 0.70 * sunTransSm) * 2.6;
      // caso de oclusión y fracción difusa: lecturas derivadas (debug)
      if (envCur.cloud <= 0.02 || sunTransSm > 0.92) occCase = 'Despejado — sol libre o en un claro';
      else if (sunTransSm > 0.55) occCase = 'Parcial — velo fino sobre el disco';
      else if (sunTransSm > 0.14) occCase = 'Parcial — el sol asoma por un borde';
      else occCase = 'Tapado total — solo luz difusa';
      diffuseFrac = clamp(0.10 + 0.90 * (1 - sunTransSm) * (0.4 + 0.6 * envCur.cloud), 0, 1);
      cloudUiT += dt;
      if (cloudUiT > 0.3) { cloudUiT = 0; updateCloudDebug(); }
      /* Relámpagos DERIVADOS: el intervalo medio es 60/F (Price–Rind
         desde el tope de la nube, climate.js), aleatorizado ±50 %. El
         trueno llega TARDE según la distancia del rayo (343 m/s: ~3 s
         por km), como en el mundo real. Sin compuerta de fase mixta
         (nimboestrato, estratos) F = 0 y nunca hay relámpagos. */
      if (SIM.flashTotal > 0 && started) {
        if (SIM.nextFlashIn < 0) SIM.nextFlashIn = 60 / SIM.flashTotal * (0.5 + Math.random());
        SIM.nextFlashIn -= dt;
        if (SIM.nextFlashIn <= 0) {
          flash = 1;
          var distKm = 0.3 + Math.random() * 2.7;
          thunderDistKm = distKm;
          thunderSoundAt = t + distKm * 1000 / 343;
          thunderPlayed = false;
          thunderVol = clamp(1.05 - distKm * 0.24, 0.3, 0.95);
          SIM.nextFlashIn = 60 / SIM.flashTotal * (0.5 + Math.random());
        }
      }
      if (thunderSoundAt > 0 && t >= thunderSoundAt && !thunderPlayed) { thunderPlayed = true; playThunder(thunderVol, thunderDistKm); } // la distancia también OSCURECE el trueno (audio.js): lejos = retumbo grave, cerca = chasquido
      flash = Math.max(0, flash - dt * 2.6);
      var flashV = flash * flash * (0.75 + 0.25 * Math.sin(t * 80));
      // luz principal: sol de día (atenuado por las nubes), luna de noche.
      // Efecto PRONUNCIADO: el sol alto pega fuerte (hasta ×1.25 sobre el
      // preset) y la luz ambiental no lo lava — las sombras se leen nítidas
      // sobre el suelo y las tumbas, y cuando una nube lo tapa la caída de
      // luz es dramática (hasta −88 %).
      // DNI/DHI del frame (detalle y fórmulas en la rama del sol): se
      // calculan ANTES de la bifurcación porque la hemisférica — que va
      // tras la bifurcación — se alimenta de DHI en ambas ramas
      var airMass = airMassKY(elev); // Kasten & Young 1989
      /* Turbidez de Linke TL derivada del estado del aire (nunca un
         número suelto): aire limpio y frío ≈ 2, limpio cálido ≈ 3,
         húmedo/estancado 4–6 — aquí sale de la humedad del modelo
         físico, la niebla (aerosol bajo) y un resto de la nubosidad.
         TL atenúa el haz sobre todo con el sol bajo (camino largo). */
      AIRTL = clamp(2.6 + (SIM_IN.RH - 45) * 0.022 + envCur.fog * 3.2 + envCur.cloud * 0.6, 1.5, 8);
      /* DNI de cielo claro: la constante es la orbital de HOY
         (1361·E0 W/m²: 1408 en perihelio, 1317 en afelio) y la
         transmitancia es la de Meinel & Meinel sobre la masa de aire,
         corregida por la turbidez de Linke del momento. */
      var dniNow = ORBIT.irradiance * Math.pow(0.7, Math.pow(Math.max(airMass, 1), 0.678)) * Math.exp(-(AIRTL - 3) * 0.045 * (Math.max(airMass, 1) - 1));
      var kdNow = clamp(0.11 + 0.89 * (1 - Math.exp(-(Math.max(airMass, 1) - 1) * 0.115)), 0.11, 0.995); // fracción difusa por masa de aire (cierre de la tabla)
      var dhiNow = elev > 0
        ? kdNow * dniNow * Math.max(sunDir.y, 0.004) / (1 - kdNow) // cierre: GHI = DNI·sen(elev) + DHI, DHI = kd·GHI
        : 5 * Math.pow(10, elev * 0.28); // crepúsculo: ~400 lux a 0°, ~3 a −6°, ~0,01 a −12° (en unidades DHI, 5 ≙ el DHI de 0°)
      /* Reparto haz/difusa de ERBS sobre el GHI de cielo claro: con el
         índice de claridad Kt = GHI/(E0·sen elev) sale la fracción
         difusa fd (despejado Kt≈0,75 → fd≈0,16, la banda medida del
         15–20 %; la fracción sube sola al bajar el sol). Y de ε/Δ de
         Perez salen F1 (circunsolar) y F2 (horizonte), que alimentan
         la aureola del shader y el panel. */
      if (elev > 0.5) {
        var ghiClear = dniNow * Math.max(sunDir.y, 0.004) + dhiNow;
        KT_NOW = clamp(ghiClear / (ORBIT.irradiance * Math.max(sunDir.y, 0.004)), 0, 1);
        var fdErbs = KT_NOW <= 0.22 ? 1 - 0.09 * KT_NOW : KT_NOW <= 0.8
          ? 0.9511 - 0.1604 * KT_NOW + 4.388 * KT_NOW * KT_NOW - 16.638 * KT_NOW * KT_NOW * KT_NOW + 12.336 * Math.pow(KT_NOW, 4)
          : 0.165;
        dhiNow = clamp(fdErbs, 0.05, 1) * ghiClear;
        perezCompute(dniNow, dhiNow, 90 - elev, Math.max(airMass, 1), ORBIT.irradiance);
      } else { KT_NOW = 0; perezCompute(0, 0, 90, 1, ORBIT.irradiance); }
      if (sky.material.uniforms.uCircum) sky.material.uniforms.uCircum.value = PEREZ_F1;
      if (elev > -0.8) {
        /* El sol DIRECTO manda hasta que el disco toca el horizonte (0°):
           antes el traspaso a la luna era a +1,2° y el último tramo del
           ocaso — justo el del sol naranja — quedaba iluminado por una
           falsa luz de luna y sin disco. Ahora la luz directa
           persiste hasta −0,8° (con la refracción el disco visible se
           hunde ~0,5° tras el horizonte geométrico), con el color de la
           transmitancia y una intensidad que colapsa como la iluminancia
           real (~10 000 lux a 10° → ~3 000 a 5–6° → ~50–300 a 0°). */
        lightDir.copy(sunDir);
        sun.color.copy(_sunWarm).lerp(_sunNoon, clamp(elev / 35, 0, 1));
        sun.color.lerp(_sunSet, duskF * 0.60); // en el horizonte el sol se vuelve naranja profundo, como en la vida real
        if (elev < 13) sun.color.lerp(SUN_DISC_NOW, clamp((13 - elev) / 6, 0, 1) * 0.85); // con el sol bajo, el color de la luz ES el color del disco (transmitancia pura)
        sun.color.r *= chromaSun.r; sun.color.g *= chromaSun.g; sun.color.b *= chromaSun.b; // T(λ): la luz que cae sobre el terreno también enrojece al atravesar la nube (al final, tiñe el color ya compuesto)
        /* MÉTRICAS SOLARES REALES (informe solar-illumination, 2026-11-22;
           modelo de Bird/Meinel verificado contra PE-Calc/pvlib):
           masa de aire de Kasten & Young, DNI = 1361·E0(época) · 0,7^(AM^0,678)
           (haz normal al sol) y DHI por cierre con la fracción difusa
           kd(AM) — 11 % con el sol alto, 20 % a 30°, 45 % a 10°, 72 % a
           5°, ~100 % a 0°. Tabla objetivo (W/m²): a 90° DNI 960 / DHI
           122; a 30° 790 / 99 (~52 000 lux en el suelo, 46 % del
           mediodía); a 10° 490 / 69 (~15 000 lux); a 5° 200 / 43; a 0°
           20 / 5 (~400 lux). La luz cae DESPACIO y solo colapsa en los
           últimos grados; el desplome de ~100× es DESPUÉS de la puesta
           (crepúsculo civil: 400 → ~3 lux a −6°), modelado en DHI.
           REGLA CLAVE: la intensidad direccional escala con DNI, NUNCA
           con GHI ni con sen(elev) — el coseno de Lambert ya lo aplica
           three con dot(N, L) (= sen(elev) sobre el suelo); escalar por
           él otra vez era el terreno negro con el sol alto. */
        sun.intensity = (envCur.sun / 2.9) * 3.0 * (dniNow / 960) * Math.max(sunTransSm, 0.02) * sunGlow + flashV * 0.6; // directa = 3,0 · DNI/960 · T de nubes · sunGlow (espec del informe, modo relativo)
        // con el sol tapado por una nube, la luz pasa a ser difusa: las
        // sombras PROYECTADAS sobre el terreno (lápidas, panteones) se
        // desvanecen en la misma medida en que cae la luz directa (T), y
        // vuelven cuando la nube pasa — vía shadow.intensity del sol
        sun.shadow.intensity = clamp(0.06 + 0.94 * sunTransSm, 0, 1);
        /* PENUMBRA por frame (v54; la ley está en scene.js): el radio
           PCF sale del diámetro angular REAL de la fuente — el mismo
           semidiámetro orbital que dibuja el disco en el cielo
           (uSunHalfRad) — y del camino oclusor→receptor h/sen(e) del
           oclusor típico (1,5 m). Al mediodía da ~0,2 téxeles (manda
           el piso de MUESTREO, 1,0 téxel — v57: la historia está en
           scene.js; en síntesis, a 0,7 los 5 taps caían en la misma
           celda y el borde se cuantizaba en escalones (el «serrucho»
           de la v55), a 1,5 la transición de ~12 cm se leía como luz
           fugándose por cada junta (reporte de Guille, 12:13), y a
           1,0 el disco ya cruza la celda vecina e interpola con una
           transición de ~8 cm, el mínimo honesto del mapa);
           al ocaso crece con 1/sen(e) hasta ~2–6 téxeles, como la
           penumbra real. */
        var _penTexS = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
        var _penHalfS = sky.material.uniforms.uSunHalfRad ? sky.material.uniforms.uSunHalfRad.value : 0.00465;
        sun.shadow.radius = clamp((1.5 / Math.max(Math.sin(elev * Math.PI / 180), 0.06)) * Math.tan(2 * _penHalfS) / (2 * _penTexS), 1.0, 6);
      } else {
        // Luna: la misma luz direccional pasa a ser la luna. Su intensidad
        // sale de la fase — nueva ≈ 0,015 (casi nada), cuarto ≈ 0,66,
        // llena ≈ 1,3, suficiente para leer placas — con color frío, más
        // blanco y brillante cuanto más llena, atenuada por nubes y por
        // su altura sobre el horizonte.
        lightDir.copy(_moonDir);
        sun.color.copy(_moonDim).lerp(_moonC, MOON.illum);
        sun.color.r *= chromaMoon.r; sun.color.g *= chromaMoon.g; sun.color.b *= chromaMoon.b; // T(λ): la luz de luna sobre el escenario cambia de brillo Y de color con la nube que la cruza
        /* Intensidad desde la cadena física: lux reales de la luna
           (moonLuxNow = 0,25 lux llena despejada × fase × T_luna) a
           unidades de escena — el paso lux→escena es la única
           CALIBRACIÓN del bloque (llena despejada ≈ 1,65, el nivel con
           el que se leen las placas); todo lo demás es la cadena
           medida: albedo, fase y oclusión de nubes. Con T_luna → 0 la
           directa muere y las sombras se disuelven: queda solo la
           difusa del piso hemisférico, como en una noche tapada real. */
        sun.intensity = (moonLuxNow / 0.25) * 1.65 * MOON.upF * moonGlow + flashV * 0.6; // moonGlow: slider de brillo de la luna (Iluminación)
        sun.shadow.intensity = clamp(0.06 + 0.94 * moonTransSm, 0, 1); // sombras nítidas solo con el disco visible; tapada, la luz es difusa y no proyecta sombra dura
        /* PENUMBRA lunar (v54): la misma ley con el semidiámetro de la
           luna (~0,259° medio, el de su disco visible) y su elevación. */
        var _penTexM = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
        sun.shadow.radius = clamp((1.5 / Math.max(Math.sin(MOON.elev * Math.PI / 180), 0.06)) * Math.tan(2 * 0.00452) / (2 * _penTexM), 1.0, 6); // mismo piso de muestreo que el sol (v57): 1,0 téxel, el mínimo que interpola entre celdas sin abrir franja de luz en las juntas
      }
      /* Brillo del sol = SIMULACIÓN global (a pedido), no cosmética del
         disco: sunGlow (slider) ya escala la luz DIRECTA del sol sobre
         el terreno (sun.intensity, arriba) y con ella el contraste de
         las sombras proyectadas; aquí escala además el REBOTE
         hemisférico diurno (la luz del cielo es luz del sol dispersada),
         y más abajo la exposición, la luz que ilumina la niebla y el
         color de fondo: mover el slider cambia la iluminación entera
         de la escena de forma coherente, como cambiar el sol real. */
      /* Hemisférica bajo nube: NO cae como la directa. Con T → 0 la
         directa muere pero el cielo sigue ahí: la ambiental se asienta
         en el PISO del tipo (estratos 0,25, altocúmulos 0,35, cirros
         0,70) y la fracción difusa tiende al 100 %. Y el caso contrario
         también es real: sol en un claro con nubes brillantes cerca →
         REALCE por nubes (medido hasta ~1,5× el cielo despejado): un
         plus de hasta +28 % SOLO sobre la difusa, nunca sobre el disco. */
      var hemiCloudF = cloudType.hemiFloor + (1 - cloudType.hemiFloor) * sunTransSm;
      var hemiMoonF = cloudType.hemiFloor + (1 - cloudType.hemiFloor) * moonTransSm; // de noche manda T_luna, con el mismo piso difuso del tipo de nube
      var enhF = sunTransSm > 0.8 ? 0.28 * clamp((sunTransSm - 0.8) / 0.2, 0, 1) * clamp((envCur.cloud - 0.25) / 0.25, 0, 1) * clamp((0.95 - envCur.cloud) / 0.2, 0, 1) : 0;
      /* Hemisférica = DHI real (misma tabla del informe): 0,60 · DHI/122
         — 0,60 al mediodía, 0,49 a 30°, 0,34 a 10°, 0,21 a 5°, 0,03 a
         0° y el rastro crepuscular después. Nunca es cero con el sol
         arriba: es la luz que salva las caras en sombra y las paredes
         que miran al lado contrario del sol. El factor (0,10+0,90·dayF)
         anterior la estrangulaba por elevación una segunda vez. */
      hemi.intensity = 0.60 * (dhiNow / 122) * (envCur.hemi / 0.85) * hemiCloudF * (1 + enhF) * (0.62 + 0.38 * sunGlow) + MOON.illum * MOON.upF * (1 - dayF) * 0.13 * moonGlow * hemiMoonF + flashV * 1.4;
      hemi.color.copy(_hemiSkyN).lerp(_hemiSkyD, dayF);
      hemi.color.lerp(_sunWarm, duskF * dayF * 0.32); // la luz ambiental del cielo también se tiñe cálida al atardecer
      var srcChroma = elev > -0.8 ? chromaSun : chromaMoon; // T(λ) también en la DIFUSA: bajo nube gruesa la luz ambiental se vuelve gris cálida, no solo más tenue
      hemi.color.r *= (1 + (srcChroma.r - 1) * 0.55); hemi.color.g *= (1 + (srcChroma.g - 1) * 0.55); hemi.color.b *= (1 + (srcChroma.b - 1) * 0.55);
      if (elev < 13 && elev > -7) { sunSimColor(SUNSIM.zenith, elev, _simZen); hemi.color.lerp(_simZen, clamp((13 - elev) / 6, 0, 1) * 0.45); } // el rebote del cielo al ocaso sale del cenit simulado: azul que se profundiza (ozono), no gris
      /* ESTADO REAL DEL CÉSPED de este frame (v50): la fracción de
         hierba seca que mezcla el shader del suelo (SEASON_DRY_U,
         materials.js) manda en todo lo que el suelo devuelve — color
         de suelo de la hemisférica, ρ de banda ancha y tinte del
         rebote. Nada de tinte verde fijo: pasto verde → verdoso
         tenue; pasto seco/amarillo (invierno) → cálido paja. */
      var grassDry = (typeof SEASON_DRY_U !== 'undefined') ? clamp(SEASON_DRY_U.value, 0, 1) : 0.10;
      _hemiGD.copy(_groundColGreen).lerp(_groundColDry, grassDry);
      hemi.groundColor.copy(_hemiGN).lerp(_hemiGD, dayF);
      /* Término REFLEJADO DEL SUELO (la tercera componente de Perez):
         GHI·ρ·(1−cos β)/2 — nulo en horizontal, la mitad de GHI·ρ en
         caras verticales como las lápidas. Entra por el color de suelo
         de la hemisférica, con el albedo real del césped (informe
         cement-stone-bounce-properties, 2026-11-22): ρ de BANDA ANCHA
         según el césped que hay — verde 0,20 (rango medido 0,15–0,25;
         PVsyst / Briegleb et al.), seco paja 0,40 (rango 0,35–0,45) —
         y mojado ×0,90 (el verde mojado queda en ~0,18; CALIBRACIÓN:
         la evidencia de césped mojado es secundaria y débil; el
         0,33–0,37 «mojado al sol» de las tablas es brillo especular
         de la película de agua, no albedo difuso). */
      var rhoGround = lerp(0.20, 0.40, grassDry) * lerp(1, 0.90, (typeof WET !== 'undefined' && WET.ground) ? WET.ground.W : 0);
      rhoGroundNow = rhoGround;
      hemi.groundColor.multiplyScalar(clamp(rhoGround / 0.20, 0.85, 1.15) * (1 + 0.12 * clamp(PEREZ_F2, -0.1, 0.3))); // F2: el brillo del horizonte de Perez también levanta el rebote
      /* REBOTE DEL SUELO sobre los props (materials.js, applyBouncePatch):
         APORTE SECUNDARIO Y SUTIL (corrección de Guille, v50): la luz
         principal de las tumbas es el sol DIRECTO — 3,0 · DNI/960 sobre
         el albedo real de la piedra (la textura mid promedia 0,245 en
         lineal, el 0,25 meteorizado medido; verificado sobre el slate
         real de los assets) — y este término solo RELLENA las caras
         que no miran al sol. Por eso el nivel de referencia baja de
         0,32 (v49, el valor físico pleno GHI·ρ/2 = 100 W/m²) a 0,13:
         el término analítico GHI·ρ·(1−cos β)/2 se calcula igual desde
         la irradiancia que ESTE frame deposita en el suelo (directa de
         la fuente activa atenuada por nubes y proyectada + difusa que
         llega al suelo; referencia 3,4 al mediodía despejado), pero
         escalado para leerse como relleno, nunca como luz principal
         ni compitiendo con la directa en las caras al sol.
         TINTE DERIVADO, NO FIJO (corrección de Guille, v50): en v49 el
         color era una CONSTANTE — el espectro del césped verde
         normalizado a media 1 (R 0,83 / G 1,50 / B 0,67, de los
         promedios de banda del espectro JPL ECOSTRESS: azul 0,041 /
         verde 0,110 / rojo 0,052) — y rebotaba verde hasta en invierno
         con el pasto amarillo; en pantalla, además, bañaba el panteón
         de verde oliva (foto de Guille, 2026-11-22 08:55). Ahora el
         tinte MEZCLA por grassDry (la fracción de hierba seca real,
         SEASON_DRY_U) entre dos espectros normalizados a media 1 y
         COMPRIMIDOS hacia el neutro (×0,40 de su desviación):
         · verde (0,93 / 1,20 / 0,87): verdoso TENUE, G/R ≈ 1,3 —
           el verde físico existe pero ya no manda;
         · seco (1,20 / 1,02 / 0,78): paja CÁLIDO, del espectro del
           pasto senescente (visible ≈ R 0,30 / G 0,21 / B 0,09); con
           su ρ 0,35–0,45 el rebote de invierno es cálido Y más
           intenso que el de primavera, como el suelo que lo emite.
         La ENERGÍA sigue saliendo del ρ de banda ancha (dominado por
         el NIR invisible, ~50 %: por eso energía y color van por
         separado y nunca se usa el RGB visible crudo como intensidad,
         que subestimaría la energía ~3×). */
      if (typeof BOUNCE_U !== 'undefined') {
        var eGroundB = Math.max(sun.intensity, 0) * Math.max(lightDir.y, 0) + hemi.intensity * 0.85 + 0.55 * (dhiNow / 122) * (elev > -0.8 ? hemiCloudF : hemiMoonF);
        /* Calibración en vivo (DEBUG → ILUMINACIÓN, v51): gain escala
           la intensidad y tintForce la desviación del tinte respecto
           del neutro — 0 = rebote sin color, 1 = el derivado tal cual.
           CALIBRACIÓN FIJADA POR GUILLE (v52): gain = 0 por defecto
           (sin relleno de rebote; manda el sol directo, que sobre el
           cemento lleva su propio slider al 150 %). */
        var bGain = (typeof BOUNCE_CTL !== 'undefined') ? BOUNCE_CTL.gain : 1;
        var tForce = (typeof BOUNCE_CTL !== 'undefined') ? BOUNCE_CTL.tintForce : 1;
        bounceLevel = 0.13 * clamp(eGroundB / 3.4, 0, 1.15) * clamp(rhoGround / 0.20, 0.85, 2.05) * bGain;
        if (!isFinite(bounceLevel)) bounceLevel = 0;
        bounceTint[0] = 1 + (lerp(0.93, 1.20, grassDry) - 1) * tForce; bounceTint[1] = 1 + (lerp(1.20, 1.02, grassDry) - 1) * tForce; bounceTint[2] = 1 + (lerp(0.87, 0.78, grassDry) - 1) * tForce;
        BOUNCE_U.uBounce.value.setRGB(sun.color.r * bounceTint[0], sun.color.g * bounceTint[1], sun.color.b * bounceTint[2]).multiplyScalar(bounceLevel);
        /* CONTRALUZ (v65; corregida en v67): la fuente activa de ESTE
           frame — la misma elección sol/luna que la sombra del campo
           (elev −0,8°) — y el color × intensidad de la luz direccional
           ya modulados por nubes y camino de aire. Ganancia 0,22
           (v67; era 0,38 en v65): con la compuerta ancha de la v65 el
           término valía ~1,14 al mediodía y se leía como resplandor
           permanente sobre el suelo y las caras planas, no como el
           borde de la silueta interpuesta — la geometría corregida
           vive en applyBacklightPatch (materials.js). */
        if (typeof BACKLIGHT_U !== 'undefined') {
          BACKLIGHT_U.uBackDir.value.copy(sunDir.y > -0.014 ? sunDir : _moonDir);
          BACKLIGHT_U.uBackCol.value.copy(sun.color).multiplyScalar(Math.max(sun.intensity, 0) * 0.22);
        }
      }
      /* DISPERSIÓN INTERNA DEL MÁRMOL (materials.js, applyMarblePatch):
         el color que alimenta la dispersión es el de la FUENTE ACTIVA
         de este frame (sun es la direccional activa: su color ya trae
         el tinte por el camino de aire y su intensidad la atenuación
         de las nubes) — la misma tubería única: si una nube tapa el
         sol, la dispersión del mármol cae con él; de noche sigue a la
         luna. Escala 0,34 ≈ intensidad 1 al mediodía despejado
         (directa 3,0). */
      if (typeof MARBLE_U !== 'undefined') {
        var sssI = clamp(sun.intensity * 0.34, 0, 1.1);
        if (!isFinite(sssI)) sssI = 0;
        MARBLE_U.uSSS.value.copy(sun.color).multiplyScalar(sssI);
      }
      /* CRISTALES DE VENTANA (v60, materials.js applyGlassPatch): el
         resplandor a contraluz del esmerilado se alimenta de la MISMA
         fuente activa y con la misma escala que la dispersión del
         mármol — si una nube tapa la fuente, el paño deja de brillar
         con ella; de noche sigue a la luna. */
      if (typeof GLASS_U !== 'undefined') {
        var glI = clamp(sun.intensity * 0.34, 0, 1.1);
        if (!isFinite(glI)) glI = 0;
        GLASS_U.uSun.value.copy(sun.color).multiplyScalar(glI);
      }
      /* ADAPTACIÓN DEL OJO con el sol tapado: un día nublado real es
         más tenue que uno despejado, pero NUNCA casi negro — la luz
         total bajo cubierta es ~25–40 % de la despejada y el ojo se
         adapta. Antes la exposición se ATENUABA con la oclusión y el
         terreno caía a negro; ahora SUBE hasta +38 % en proporción a la
         oclusión y la nubosidad, como la adaptación visual. */
      var srcTransSm = elev > -0.8 ? sunTransSm : moonTransSm; // la fuente que manda: sol de día, luna (reflejo) de noche — la adaptación sigue a la que esté tapada
      /* EXPOSICIÓN ANALÍTICA DE CONTRALUZ (v65, informe de contraluz
         §1.6/§5.4 + su ERRATA): al mirar HACIA la fuente la exposición
         baja (hasta −16 %): el frente del sujeto cae más oscuro y el
         borde conserva su color en vez de quemarse a blanco — el
         comportamiento de la cámara de la foto de referencia. El
         factor es el coseno entre la mirada (cámara → escena) y la
         dirección a la fuente activa: dot(forw, L) = 1 mirándola de
         frente. OJO AL SIGNO (errata del informe): la mirada ya es
         cámara→escena; NO se niega — negada, la exposición caería al
         mirar en dirección contraria, al revés del fenómeno. */
      var _bkDir = sunDir.y > -0.014 ? sunDir : _moonDir;
      var _bkCp = Math.cos(pitch);
      var _bkDot = clamp((-Math.sin(yaw) * _bkCp) * _bkDir.x + Math.sin(pitch) * _bkDir.y + (-Math.cos(yaw) * _bkCp) * _bkDir.z, 0, 1);
      var _bkF = 1 - 0.16 * _bkDot * clamp(_bkDir.y * 4, 0, 1);
      renderer.toneMappingExposure = (envCur.exp * (0.45 + 0.55 * dayF) * (1 + radiant * 0.10) * lerp(1, 0.86 + 0.14 * sunGlow, dayF) * (1 + 0.38 * (1 - srcTransSm) * clamp(envCur.cloud, 0, 1)) + flashV * 0.3) * _bkF;
      /* RED DE SEGURIDAD ESTRUCTURAL (principio del proyecto): la luz
         solo se MODULA — T y T(λ) son multiplicadores que vuelven
         exactamente a 1 cuando las nubes se van; la fuente nunca se
         reemplaza ni se destruye. Si cualquier término diera un valor
         no finito, se cae a la luz SIN atenuar de la fuente de este
         frame, jamás a un negro permanente. */
      if (!isFinite(sun.intensity)) sun.intensity = elev > -0.8 ? (envCur.sun / 2.9) * 3.0 * (dniNow / 960) * sunGlow : (moonLuxNow / 0.25) * 1.65 * MOON.upF * moonGlow;
      if (!isFinite(hemi.intensity)) hemi.intensity = 0.3;
      if (!isFinite(renderer.toneMappingExposure)) renderer.toneMappingExposure = envCur.exp;
      // niebla y su color según hora y clima
      /* Extinción total en 0 = aire totalmente claro: se retira el
         objeto Fog de la escena (sin velo ni fundido en el horizonte) y
         la generación de chunks se oculta por distancia (applyClearAir).
         Vuelve cuando el slider/clima sube la NIEBLA, cuando el modelo
         la deriva (radiación, estrato en el suelo, frontal) O cuando
         llueve: la cortina de lluvia también extingue la vista, con su
         β propio sumado al de la niebla — pero eso no convierte a la
         lluvia en niebla (envCur.fog no se mueve por llover). */
      // la niebla EFECTIVA es manual O derivada del modelo: con niebla
      // de radiación formada (slider en 0) el objeto Fog existe igual
      var fogEffNow = Math.max(ENV.fog, fogDerived);
      var extEffNow = Math.max(fogEffNow, precipCur);
      applyClearAir(extEffNow <= 0);
      if (extEffNow <= 0 && envCur.fog < 0.01 && precipCur < 0.01) { if (scene.fog) scene.fog = null; }
      else if (!scene.fog) scene.fog = fogObj;
      /* Densidad de extinción de la capa (FogExp2, Beer–Lambert): la
         niebla del panel mapea a densidad de gotas — a más densidad,
         menos visibilidad (Koschmieder), sin distancia de corte dura:
         lo lejano se apaga exponencialmente, nunca de golpe. El viento
         disipa la capa: con viento fuerte la densidad cae hasta ~45 %. */
      /* Densidad recalibrada para que la niebla OBSCUREZCA el horizonte
         de verdad (foto de referencia del usuario: todo se difunde con
         la distancia hasta no quedar nada): con niebla 0,22 la extinción
         a 150 m (borde del anillo de chunks) ya es ~90 % y a 250 m es
         total — ninguna silueta lejana atraviesa la capa ni queda línea
         donde los objetos «dejan» de anieblarse. La extinción es la de
         three (FogExp2) aplicada por distancia a TODOS los materiales
         con fog: suelo, tumbas, árboles, panteones y senderos. */
      /* β_total = β_niebla + β_lluvia (Koschmieder: las extinciones se
         SUMAN, los fenómenos no se convierten uno en otro): el viento
         disipa solo el término de niebla — la lluvia cae igual con
         viento — y el término de precipitación entra atenuado (×0,5)
         porque las gotas son grandes y ralas frente a las gotitas de
         niebla: a igual «visibilidad» nominal, la cortina de lluvia
         deja leer más cerca que la niebla. */
      fogObj.density = (0.0012 + Math.pow(envCur.fog, 1.5) * 0.080) * clamp(1.12 - WIND.speed * 0.030, 0.55, 1.12) + Math.pow(precipCur, 1.5) * 0.040;
      /* PROFUNDIDAD ÓPTICA CENITAL de la capa de niebla y transmitancia
         de las fuentes a través de ella (reparación v52, foto de
         Guille 09:28: a niebla máxima quedaba una BANDA blanca fea
         entre el cielo —que seguía azul-grisáceo arriba— y el suelo
         ya fundido al color de niebla). Fenómeno→consecuencia: a
         niebla máxima el observador está DENTRO de la nube de niebla;
         la capa (100–300 m en niebla de radiación) es ópticamente
         gruesa en TODAS direcciones, también hacia el cenit: no hay
         cielo visible ni línea de horizonte, todo converge a la
         radiancia de la propia niebla. La curva vieja (τ₀ 0,03→0,30)
         dejaba pasar el 74 % del cielo en el cenit y por eso el cielo
         se leía azul sobre la banda. La nueva concentra el crecimiento
         al final (fog^2,5): con bruma ligera casi no cambia; a niebla
         plena τ₀ = 3,2 → el cenit queda 96 % niebla y a ≥10° de
         elevación es niebla total, sin escalón contra el suelo.
         fogTSun/fogTMoon son la T de esa MISMA capa por el camino de
         cada fuente (exp(−τ₀/sen e)): los sprites del sol y la luna
         (fog:false, no los extingue el FogExp2) mueren con ella —
         en niebla densa no hay disco, solo la niebla iluminada. */
      var fogTauNow = scene.fog ? 0.03 + 3.17 * Math.pow(clamp(envCur.fog, 0, 1), 2.5) : 0;
      var fogTSun = Math.exp(-fogTauNow / Math.max(sunDir.y, 0.06));
      var fogTMoon = Math.exp(-fogTauNow / Math.max(_moonDir.y, 0.06));
      /* Niebla SIN brillo propio: su color es el del horizonte tal como lo
         ilumina el sol virtual, multiplicado por la luz que de verdad hay.
         Día pleno ≈ 1, ocaso ≈ 0.25–0.4 (cálida pero oscura), noche ≈ 0.05
         (casi negra). Nunca se ve niebla iluminada sin una luz que la ilumine. */
      updateMoonVisual(px, pz, elev, moonDiscTrans * fogTMoon, moonTransSm * testMeanM * fogTMoon); // disco y halo leen T_luna combinada (campo × prueba × CAPA DE NIEBLA): la misma atenuación que la luz que cae al suelo, sin pisos paralelos
      /* NUBE DE PRUEBA: barrido automático y el sprite visible que
         acompaña a la atenuación analítica (el cuerpo de la nube que el
         jugador ve cruzar el disco). */
      if (TESTC.on && TESTC.sweep) {
        TESTC.pos += TESTC.sweepDir * dt * 13; // ~15 s de lado a lado
        if (TESTC.pos > 100) { TESTC.pos = 100; TESTC.sweepDir = -1; }
        if (TESTC.pos < -100) { TESTC.pos = -100; TESTC.sweepDir = 1; }
        if (!testPosEl) { testPosEl = document.getElementById('dbgTestPos'); testPosValEl = document.getElementById('dbgTestPosVal'); }
        if (testPosEl && document.activeElement !== testPosEl) { testPosEl.value = Math.round(TESTC.pos); if (testPosValEl) testPosValEl.textContent = Math.round(TESTC.pos) + ' %'; }
      }
      if (typeof testCloudSprite !== 'undefined' && testCloudSprite) {
        var tcShow = TESTC.on && (tcEff === 'sun' ? sunDir.y > -0.06 : _moonDir.y > -0.06);
        testCloudSprite.visible = !!tcShow;
        if (tcShow) {
          testCloudSprite.position.set(px + testDirNow.x * 1150, testDirNow.y * 1150, pz + testDirNow.z * 1150);
          var tcShade = 0.20 + 0.80 * Math.max(dayF, MOON.upF * MOON.illum * moonTransSm * 0.55);
          testCloudSprite.material.color.setRGB(tcShade * 0.96, tcShade * 0.99, tcShade * 1.07); // de noche toma el azul de la luna
          testCloudSprite.material.opacity = clamp(1 - Math.exp(-TESTC.tau * 0.85), 0.55, 0.99); // masa DENSA: con τ ≥ 1 ya es casi opaca (la textura trae el volumen horneado: copas claras, base negra)
          testCloudSprite.scale.set(64 * TESTC.size, 64 * TESTC.size, 1); // TAMAÑO del slider: al 600 % el cuerpo subtiende ~19° — tapa el disco (0,53°) y su halo con margen, como la foto
          /* CAPA TRASERA (paralaje barato): la base en sombra, más
             grande, más oscura y corrida hacia abajo, unos metros
             detrás del frente — dos capas 2D a distinta profundidad
             aparente que dan el volumen sin volumétricas. */
          if (typeof testCloudBack !== 'undefined' && testCloudBack) {
            testCloudBack.visible = true;
            testCloudBack.position.set(px + testDirNow.x * 1165, testDirNow.y * 1165 - 9 * TESTC.size, pz + testDirNow.z * 1165);
            testCloudBack.material.color.setRGB(tcShade * 0.42, tcShade * 0.45, tcShade * 0.52);
            testCloudBack.material.opacity = testCloudSprite.material.opacity * 0.55;
            testCloudBack.scale.set(76 * TESTC.size, 76 * TESTC.size, 1);
          }
        } else if (typeof testCloudBack !== 'undefined' && testCloudBack) {
          testCloudBack.visible = false;
        }
        // resplandor dorado del borde: máximo con el tapado PARCIAL
        // (el borde de la masa sobre el disco), cero tapado del todo
        if (typeof testCloudGlow !== 'undefined' && testCloudGlow) {
          testCloudGlow.visible = !!tcShow;
          if (tcShow) {
            testCloudGlow.position.copy(testCloudSprite.position);
            var tcEdge = tcEff === 'sun' ? clamp((testTNow.max - testTNow.mean) * 2.4, 0, 1) : 0;
            testCloudGlow.material.opacity = tcEdge * 0.40 * clamp(dayF + 0.2, 0, 1);
            testCloudGlow.scale.set(69 * TESTC.size, 69 * TESTC.size, 1); // ribete FINO (69 frente al cuerpo de 64): el silver lining real es un contorno por difracción en el limbo, no un halo ancho (informe test-cloud §4)
          }
        }
        /* SOMBRA LOCAL de la nube de prueba (corrección a pedido):
           la ÚNICA atenuación que la nube ejerce sobre el mundo es su
           sombra — la proyección de su cuerpo sobre el suelo SIGUIENDO
           LOS RAYOS DE LA FUENTE ACTIVA (slot 0 de los materiales). Geometría
           real: el centro cae desplazado de la vertical de la nube en
           h/tan(elevación) hacia el lado contrario del sol (sol alto:
           casi debajo; sol bajo: lejos); el tamaño escala con la nube
           (30 m × tamaño → 180 m al 600 %); la mancha se ALARGA en la
           dirección del sol por 1/sen(elevación) (la proyección de un
           cuerpo a altura con luz rasante); y el borde se ablanda con
           la altura: penumbra ≈ h·tan(0,53°) — el diámetro angular
           del sol (a 2 km serían ~18 m). Dentro de la sombra NO es
           negro: el material solo quita la fracción directa y queda
           el piso difuso del resto del cielo (materials.js). Fuera de
           la mancha, el sol directo sigue intacto. */
        /* La proyección sigue a la FUENTE ACTIVA (revisión v45): con
           el objetivo en la luna, la mancha se desplaza h/tan(elevación
           lunar) en contra de la luna, con su alargamiento 1/sen y su
           penumbra h·tan(0,52°) — la misma geometría que con el sol
           (0,53°). Antes el slot solo existía de día: de noche la nube
           tapaba el disco lunar (CPU) pero no sombreaba el suelo,
           mientras la sombra del campo global SÍ cambiaba a la luna —
           la sonda del sistema obedecía otra ley que el sistema. */
        var tcSrc = tcEff === 'sun' ? sunDir : _moonDir;
        if (TESTC.on && tcSrc.y > 0.04 && testDirNow.y > 0.02) {
          var tcCx = px + testDirNow.x * 1150, tcCy = testDirNow.y * 1150, tcCz = pz + testDirNow.z * 1150;
          var tcPr = Math.min(tcCy / tcSrc.y, 4000);
          cloudShadowVecs[0].set(tcCx - tcSrc.x * tcPr, tcCz - tcSrc.z * tcPr, 30 * TESTC.size, clamp(1 - Math.exp(-TESTC.tau * 0.8), 0, 1));
          var tcElong = clamp(1 / Math.max(tcSrc.y, 0.10), 1, 6); // alargamiento de la proyección con luz rasante
          var tcPen = clamp(tcCy * (tcEff === 'sun' ? 0.00925 : 0.00908) / (30 * TESTC.size), 0.06, 0.85); // penumbra = h·tan(diámetro angular de la fuente) en fracción del radio
          var tcAzL = Math.sqrt(tcSrc.x * tcSrc.x + tcSrc.z * tcSrc.z) || 1;
          cloudShadowPar[0].set(tcElong, tcPen, tcSrc.x / tcAzL, tcSrc.z / tcAzL);
          CLOUD_AMT_U.value = Math.max(CLOUD_AMT_U.value, 0.85);
        } else {
          cloudShadowVecs[0].w = 0; // sin nube de prueba (o sin fuente arriba) no queda ninguna mancha fantasma
        }
      }
      updateSunVisual(px, pz, elev, sunTransSm * (testSunActive ? testTNow.sliver : 1) * fogTSun); // disco, halo y resplandor de cámara leen la T combinada (campo × prueba × CAPA DE NIEBLA si la prueba apunta al sol): la misma ley multiplicativa que el disco de la luna
      // estrellas: cúpula pegada al jugador, visibles solo con cielo
      // despejado y oscuro — nubosidad o niebla las apagan por completo
      if (starPts) {
        starPts.position.set(px, 0, pz);
        /* Estrellas SOLO con el sol bajo el horizonte (fenómeno →
           consecuencia): el cielo crepuscular sigue siendo fotópico/
           mesópico alto y ninguna estrella se ve con el sol arriba;
           las primeras (las más brillantes) aparecen hacia −4°, el
           campo crece por el crepúsculo náutico y es pleno a −12°.
           La compuerta vieja (1 − dayF) daba 0,28 a +5,2° y 0,80 a 0°:
           estrellas por todo el cielo en pleno ocaso (capturas
           internas del 2026-11-22, mirando al lado antisolar con el
           preset Ocaso). La luna llena además LAVA las débiles: su
           luz (la misma T_luna de siempre) recorta el campo visible. */
        var starOp = clamp((-elev - 3) / 9, 0, 1) * (1 - 0.45 * MOON.illum * MOON.upF * moonTransSm) * clamp(1 - envCur.cloud * 1.5, 0, 1) * clamp(1 - envCur.fog * 1.4, 0, 1);
        starPts.visible = starOp > 0.02;
        if (starPts.visible) {
          if (starPts.material.uniforms) { starPts.material.uniforms.uOpacity.value = starOp * 0.95; starPts.material.uniforms.uTime.value = t; }
          else starPts.material.opacity = starOp * 0.95; // material de reserva (PointsMaterial)
        }
      }
      _fogC.copy(_cNight).lerp(_cDay, Math.pow(dayF, 1.3));
      _fogC.lerp(_cDusk, duskF * dayF * 0.55);
      if (elev < 13 && elev > -7) { sunSimColor(SUNSIM.fog, elev, _simFog); _fogC.lerp(_simFog, clamp((13 - elev) / 6, 0, 1) * 0.55); } // niebla/perspectiva aérea del ocaso según la tabla: naranja a 0°, malva a −2°, azul oscuro a −6°
      _fogC.lerp(_cGray, envCur.cloud * 0.28 * dayF);
      // de noche la niebla solo se aclara con la luz de la luna según su
      // fase: llena la tiñe de azul frío tenue; nueva la deja casi negra
      _fogC.lerp(_moonFogC, MOON.illum * MOON.upF * (1 - dayF) * 0.5);
      var fogLight = 0.045 + 0.955 * clamp((elev + 2) / 15, 0, 1);
      fogLight *= (1 - envCur.cloud * 0.08) * (1 - envCur.storm * 0.10) * lerp(1, 0.70 + 0.30 * sunGlow, dayF); // la niebla y el horizonte bajo nube conservan casi toda su luz: el cielo nublado es gris BRILLANTE y funde el terreno sin oscurecerlo
      var moonFogLight = (0.05 + 0.34 * MOON.illum * MOON.upF) * (0.30 + 0.70 * moonTransSm); // la niebla nocturna la ilumina la misma luna atenuada por las nubes
      if (moonFogLight > fogLight) fogLight = moonFogLight;
      _fogC.multiplyScalar(fogLight);
      fogObj.color.copy(_fogC);
      if (scene.background) scene.background.copy(_fogC); // respaldo tras el Sky: mismo color que el horizonte, nunca negro de día
      // niebla en altura: fuerza del parche de materiales (world.js la
      // aplica a cada chunk) — crece con la niebla y un poco con la
      // nubosidad; sin objeto Fog en la escena (niebla en 0) vale 0
      HEIGHT_FOG_U.value = scene.fog ? clamp(envCur.fog * 1.25, 0, 1) * clamp(1.08 - WIND.speed * 0.022, 0.55, 1.08) : 0; // SOLO niebla de verdad (manual o derivada del modelo, ya dentro de envCur.fog): el término viejo «+ nubosidad» acoplaba la niebla a las nubes — de noche eso es físicamente al revés (las nubes frenan la niebla de radiación). La fusión del horizonte lejano ya la hacen el fundido del suelo y el cielo bajo el horizonte, sin inventar niebla
      // horizonte fundido: el Sky mezcla su franja baja hacia este mismo
      // color de niebla (uniform que comparte la instancia de Color) —
      // fuerza y ancho de banda según cuánta niebla haya: a más niebla,
      // más alto sube el fundido y más total es la fusión
      if (skyPatchOk) {
        // Con niebla presente, el horizonte del cielo es 100 % color de
        // niebla (uFogBlend = 1): mirar al horizonte es mirar a través de
        // niebla infinita, así que suelo, tumbas y cielo comparten el
        // mismo color en la línea y el degradado sube suave desde ahí.
        // El ancho de la franja crece con la niebla (0,05 → 0,42). Sin
        // niebla (scene.fog null) el cielo queda intacto y radiante.
        sky.material.uniforms.uFogBlend.value = scene.fog ? 1 : 0;
        // profundidad óptica cenital de la capa de niebla en el cielo:
        // fina con poca niebla (solo el horizonte exacto se funde) y
        // gruesa con niebla densa (la capa cubre más cielo, siempre con
        // el perfil continuo 1/sen θ, sin banda ni borde)
        if (sky.material.uniforms.uFogLayer) sky.material.uniforms.uFogLayer.value = fogTauNow; // τ₀ de la capa: la misma variable que extingue los discos (arriba) — una sola capa, una sola ley (v52: curva fog^2,5 hasta 3,2 a niebla plena)
        // azul pleno en despejado: máximo con nubosidad y niebla en 0 de
        // día; se apaga al nublarse, con niebla, al ocaso y de noche —
        // ahí manda el cielo físico (atardeceres y noche intactos)
        sky.material.uniforms.uBlueF.value = clamp(skyClear * 1.2, 0, 1) * clamp(dayF * 1.3, 0, 1) * (1 - duskF * 0.88) * (elev < 12 ? clamp((elev - 0.5) / 9, 0, 1) : 1) * clamp(1 - envCur.cloud * 1.5, 0, 1) * clamp(1 - envCur.fog * 1.2, 0, 1); // el azul pleno es de cielo DESPEJADO: se retira rápido al nublarse (a 52 % ya casi no queda; a 67 % nada) — con cubierta manda el gris plano del parche de oclusión, no el azur; y con NIEBLA también muere (v52): el azur se aplica DESPUÉS de la mezcla de niebla en el shader y a niebla máxima re-azulaba el cielo por encima de la capa, mitad del contraste de la foto de las 09:28
      }
      // luz ambiental real del momento, para decidir si una placa se puede leer
      worldLight.dayF = dayF;
      worldLight.elev = elev;
      worldLight.occ = occSmooth;
      worldLight.ambient = clamp(hemi.intensity * 0.55 + sun.intensity * 0.30, 0, 2);
      // lluvia: gotas que caen y su sonido en loop
      /* La precipitación sale del MODELO FÍSICO (climate.js): la misma
         cadena que calcula el tope, el agua y los rayos — así lluvia,
         oclusión del sol, viento y actividad eléctrica nunca se
         contradicen (nada de diluvio con tope bajo y cálido). */
      /* La lluvia visible ES la del modelo físico: envCur.rain ya es la
         fracción derivada de los mm/h reales (raíz cuadrada: 35 mm/h no
         necesita 100× las gotas de 0,3 mm/h). El slider de densidad solo
         puede SUMAR sobre ella (rainOverride). La velocidad de caída es
         la terminal del tamaño de gota del tipo (llovizna 2 m/s, lluvia
         5, tormenta 7–9) y la inclinación la pone el viento medio. */
      rainEff = Math.max(envCur.rain, rainOverride);
      /* FACTOR LOCAL DEL CAMPO (v65): la gota que toca un punto salió
         de la base de la nube VIENTO ARRIBA: el punto de muestreo se
         desplaza −viento·0,32·(base/vt) — la misma deriva que inclina
         las rayas (tope 120 s de caída). rainLocalF se recalcula por
         frame sobre el jugador (barato: un muestreo del campo); la
         media espacial rainMeanD, a 2 Hz sobre la grilla. El deckB
         (capa uniforme de nubosidad > 0,72) se suma en CPU igual que
         en el shader de la lluvia: bajo un deck cerrado el factor
         tiende a 1 en todas partes, como debe ser. */
      var deckBNow = Math.pow(clamp((sky.material.uniforms.cloudCoverage.value - 0.72) / 0.28, 0, 1), 1.5) * 0.30;
      if (t - rainMeanT > 0.5) {
        rainMeanT = t;
        var _rs = 0;
        for (var _gi = -3; _gi <= 3; _gi++) for (var _gj = -3; _gj <= 3; _gj++) _rs += cloudDepthAtJS(_gi * 133, 120, _gj * 133, t);
        rainMeanD = _rs / 49 + deckBNow;
      }
      var _fallT = clamp(SIM.base / Math.max(SIM.fallSpeed, 0.5), 0, 120);
      var _shX = -WIND.dirX * SIM_IN.U * 0.32 * _fallT, _shZ = -WIND.dirZ * SIM_IN.U * 0.32 * _fallT;
      rainLocalF = clamp((cloudDepthAtJS(_shX, 120, _shZ, t) + deckBNow) / Math.max(rainMeanD, 0.05), 0, 3);
      rainLocalRate = Math.max(SIM.rainRate, rainEff * rainEff * 35) * rainLocalF; // mm/h SOBRE el jugador (la misma base que integra wet.js)
      /* ARCOÍRIS EMERGENTE (esquema §15, Descartes): sin
         interruptor — la fuerza sale de las condiciones de ESTE
         frame y la geometría (punto antisolar, primario a 42°,
         secundario a 51–53°, banda de Alexander) vive en el shader
         del cielo. Condiciones: llueve (rainEff, la lluvia efectiva
         del modelo), el sol está a menos de 42° (más alto no hay
         arco visible desde el suelo; la altura del arco, 42° −
         elevación, sale sola de la geometría antisolar) y llega
         luz DIRECTA con la que refractarse (sunTransSm): tras una
         cubierta cerrada el sol es difuso y no hay arco — con el
         preset de lluvia el arco espera a que el campo se abra
         (bajar la nubosidad: el sol entra por los huecos mientras
         sigue lloviendo, que es el escenario real del arcoíris). */
      var rainbowF = 0;
      if (elev > -0.5 && elev < 42 && rainEff > 0.03) {
        rainbowF = clamp(rainEff * 1.4, 0, 1) * clamp((42 - elev) / 10, 0, 1) * clamp(sunTransSm * 1.8, 0, 1) * fogTSun; // la luz que se refracta también cruza la capa de niebla (v52): sin sol directo no hay arco, y en niebla densa no llega
      }
      if (sky.material.uniforms.uRainbow) sky.material.uniforms.uRainbow.value = rainbowF;
      var raining = rainEff > 0.03;
      rainPts.visible = raining && started;
      if (rainPts.visible) {
        rainPts.position.set(px, 0, pz);
        /* QUADS CON SHADER (informe §5): la CPU solo escribe uniforms
           — la población de gotas (diámetro Marshall–Palmer alrededor
           del dropMm del tipo, velocidad Atlas–Ulbrich por gota), el
           largo por exposición y el factor espacial del campo se
           resuelven en el vértice. La CUENTA y el ALFA PICO salen de
           la tabla §4.1 aplicada a la tasa LOCAL (mm/h sobre el
           jugador): llovizna 1 mm/h ≈ 1000 rayas a 0,10; moderada
           5 mm/h ≈ 2750 a 0,185; fuerte 10 mm/h ≈ 3750 a 0,24. */
        var _rt = rainTableAt(rainLocalRate);
        rainDtSm += (clamp(dt, 1 / 60, 1 / 30) - rainDtSm) * 0.12;
        rainUni.uTime.value = t;
        /* EL AGUA QUE DESPRENDE CADA NUBE (recordatorio de Guille,
           18:51): la gota cae a su velocidad TERMINAL — el equilibrio
           entre su peso (gravedad × masa, ∝ D³) y el arrastre del
           aire — sin simular gota a gota: la ley empírica de ese
           equilibrio es Atlas–Ulbrich v(D), aplicada por gota en el
           vértice sobre la población Marshall–Palmer. Y cada nube
           desprende un agua distinta: el dropMm del TIPO (llovizna de
           estratos 0,5 mm → ~2 m/s; nimboestrato 1,5 → ~5,5; cúmulo
           3,5 → ~8,4) y, dentro del tipo, el diámetro medio crece con
           la tasa según la propia Marshall–Palmer (Λ = 4,1·R^−0,21 →
           D₀ ∝ R^0,21): a más mm/h, gotas más grandes y caída más
           rápida. */
        rainUni.uDropMm.value = Math.max(SIM.dropMm, 0.5) * clamp(Math.pow(Math.max(SIM.rainRate, 0.01) / 5, 0.21), 0.8, 1.35);
        rainUni.uDt.value = rainDtSm;
        rainUni.uVel.value.set(WIND.dirX * SIM_IN.U * 0.32, 0, WIND.dirZ * SIM_IN.U * 0.32);
        rainUni.uCam.value.copy(camera.position);
        rainUni.uPixH.value = renderer.domElement.height || 800;
        rainUni.uFovTan.value = Math.tan(camera.fov * Math.PI / 360);
        rainUni.uShaft.value.set(_shX, _shZ);
        rainUni.uMeanInv.value = 1 / Math.max(rainMeanD, 0.05);
        rainUni.uOpacity.value = _rt[1];
        rainUni.uBright.value = clamp(0.25 + worldLight.ambient * 0.55, 0.2, 1.15);
        rainPts.geometry.instanceCount = Math.floor(_rt[0]);
      }
      // (el sonido de lluvia y pájaros ya no se regula aquí: son
      // capas del sistema de ambiente de audio.js, que lee SIM,
      // rainLocalF y worldLight.dayF por su cuenta cada 0,3 s)
      updatePurkinje(dt, dniNow, dhiNow, sunDir.y, elev); // adaptación del ojo (Purkinje): sigue a la luz de ESTE frame con su historia asimétrica
      updateWet(dt, t, px, pz); // superficies mojadas: el estado W/G/D se integra desde la lluvia de ESTE frame (wet.js)
      computeSurfaceTemps(); // Ts por material → calima y espejismo (con el GHI que updateWet acaba de calcular)
      /* Destello de Fresnel en lo mojado: el color que las superficies
         mojadas reflejan especularmente (parche de wet.js, Schlick con
         F0 = 0,02 del agua) suma el DISCO de la fuente vigente — con el
         sol bajo y rasante ese término es el que convierte charcos y
         piedra mojada en espejos; al mediodía casi no aporta. La
         rugosidad mojada baja del parche (0,05–0,20) hace el resto en
         el GGX de los materiales estándar. */
      if (elev > -0.8) { var glintF = clamp(dniNow / 960, 0, 1.2) * sunTransSm * 0.55; UW.sky.value.r += SUN_DISC_NOW.r * glintF; UW.sky.value.g += SUN_DISC_NOW.g * glintF; UW.sky.value.b += SUN_DISC_NOW.b * glintF; }
      else { var glintM = clamp(moonLuxNow / 0.25, 0, 1) * 0.30; UW.sky.value.r += 1.0 * glintM; UW.sky.value.g += 0.83 * glintM; UW.sky.value.b += 0.62 * glintM; } // el reflejo de la luna en lo mojado también es cálido 4100 K, no azul
    }
