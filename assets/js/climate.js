/* climate.js — Modelo climático físico y derivable: SOLO 4 variables
   independientes (temperatura, humedad relativa, CAPE y viento medio)
   y todo lo demás DERIVADO en cadena, nunca fijado por separado:
   punto de rocío (Magnus) → base de nube (LCL = 125·(T−Td)) →
   ascendente (½·√(2·CAPE)) → tipo de nube, tope y su temperatura →
   contenido de agua (tabla de Stephens 1979) → profundidad óptica
   τ = 1,5·LWP/r_e → tasa de lluvia (R = 3,6·v_t·q_p, con evaporación
   bajo la base) → rayos (Price–Rind ∝ H^4,9, con compuerta de fase
   mixta) → ráfagas (factor de ráfaga + bonus de descendente).
   Consecuencia: lluvia fuerte ⇒ tope alto y frío, ascendente fuerte,
   mucha agua, rayos y ráfagas; llovizna ⇒ nube baja y cálida, sin
   rayos. Es imposible un estado contradictorio.
   Fuentes: informe real-weather-data-simulation (2026-11-22) —
   Beaufort (RMetS/NWS), LWC (Stephens 1979), categorías de lluvia
   (Met Office), Price & Rind 1992, Magnus/Clausius–Clapeyron (~7 %/°C).
   Depende de: utils. Lo usan: weather, debug. */
'use strict';
    var SIM_IN = { T: 24, RH: 45, CAPE: 300, U: 2.5 };   // las 4 independientes, vigentes (U: viento medio de Córdoba ~2,3 m/s, MERRA-2)
    var SIM_GOAL = { T: 24, RH: 45, CAPE: 300, U: 2.5 }; // meta del clima vivo
    /* TEMPERATURA DEL DÍA (control del debug): automática Parton–
       Logan (autoTempNow en weather.js) mientras TEMP_DAY.auto esté
       activo. Mover el slider/caja de temperatura del día FIJA la
       temperatura (auto = false, clima vivo detenido) y la mantiene
       hasta pulsar «Automática» o RESETEAR — antes era un offset que
       decaía en ~45 s (diseño del informe mirage §3.5) y la puesta a
       mano se escurría sola, imposible de probar contra efectos
       térmicos como la calima. La temperatura fijada la lee TODA la
       simulación (derivaciones del modelo, evaporación FAO-56,
       temperaturas de superficie y, por ellas, la calima). Un preset
       de clima o el slider fino de T también apagan el modo auto.
       updateClimate conserva el soporte de offset con decaimiento
       (T = T_auto + offset·exp(−t/45 s)) por si algún control lo
       vuelve a producir; hoy ningún control lo genera. */
    var TEMP_DAY = { offset: null, auto: true };
    /* BASE DE NUBE (override del debug, a pedido): automática = la
       derivada del modelo (LCL = 125·(T−Td) acotada por régimen);
       manual = el slider la FIJA (100–3000 m) y todo lo que cuelga de
       la base la lee igual: tope convectivo, la niebla por estrato que
       toca el suelo y la altura a la que weather.js coloca el deck
       volumétrico. El botón Automática la devuelve al modelo. */
    var BASE_OVR = { auto: true, m: 1200 };
    /* DENSIDAD DE NUBE (override del debug, a pedido): la densidad ES
       la profundidad óptica τ = 1,5·LWP/r_e del modelo. Automática =
       la del tipo vigente (σ del tipo × campo). Manual = el slider
       FIJA τ (0,1–30) y weather.js lo convierte en un factor sobre la
       densidad del campo compartido, así TODO se mueve por la misma
       ley T = exp(−τ): oscuridad de la nube, disco del sol/luna, luz
       directa, halo y brillo de la capa. «Automática» o RESETEAR lo
       devuelven al modelo, como la temperatura y la base. */
    var TAU_OVR = { auto: true, tau: 3 };
    var SIM = {
      Td: 0, es: 0, base: 0, top: 0, depth: 0, topTemp: 0, freezeKm: 0,
      typeKey: 'cu', typeLabel: 'Cúmulos', wTheor: 0, wUp: 0,
      lwcPeak: 0, lwcMean: 0, lwp: 0, tau: 0, re: 10,
      rainCloud: 0, rainRate: 0, rainCat: 'Sin lluvia', fallSpeed: 0, dropMm: 0, fEvap: 1, virga: false,
      phase: 'Lluvia', flashTotal: 0, flashCG: 0, nextFlashIn: -1,
      gustFactor: 1.3, gustBonus: 0, gustPeak: 0, beaufort: 3, beaufortName: 'Brisa ligera',
      visibility: 10000, visRain: 10000, rainBeta: 0, rainFrac: 0, stormFrac: 0, verdict: '', warnings: ''
    };
    var BEAUFORT = [ // [límite superior m/s, fuerza, nombre] — escala Beaufort (viento medio 10 min a 10 m)
      [0.2, 0, 'Calma'], [1.5, 1, 'Ventolina'], [3.3, 2, 'Brisa ligera'], [5.4, 3, 'Brisa suave'],
      [7.9, 4, 'Brisa moderada'], [10.7, 5, 'Brisa fresca'], [13.8, 6, 'Brisa fuerte'], [17.1, 7, 'Viento fuerte'],
      [20.7, 8, 'Temporal'], [24.4, 9, 'Temporal fuerte'], [28.4, 10, 'Temporal duro'], [32.6, 11, 'Borrasca'], [1e9, 12, 'Huracán']
    ];
    // tabla por tipo: LWC pico (Stephens), fracción media de columna,
    // radio efectivo de gota, velocidad de caída y agua precipitante
    var SIM_TYPES = {
      clear:     { label: 'Despejado',        lwc: 0,    meanF: 0,   re: 10, vt: 0, kq: 0 },
      cirrus:    { label: 'Cirros',           lwc: 0.05, meanF: 0.5, re: 25, vt: 0, kq: 0 },
      st:        { label: 'Estratos',         lwc: 0.22, meanF: 0.6, re: 10, vt: 2, kq: 0.18 },
      sc:        { label: 'Estratocúmulos',   lwc: 0.40, meanF: 0.5, re: 10, vt: 2, kq: 0.03 },
      ns:        { label: 'Nimboestratos',    lwc: 0.50, meanF: 0.34, re: 12, vt: 5, kq: 0.75 }, // kq calibrado al estado de referencia del informe: Ns a 12 °C/95 % → 5,0 mm/h
      cu:        { label: 'Cúmulos',          lwc: 1.00, meanF: 0.5, re: 12, vt: 0, kq: 0 },
      congestus: { label: 'Cúmulos congestus', lwc: 1.40, meanF: 0.4, re: 14, vt: 5, kq: 0.30 },
      cb:        { label: 'Cumulonimbos',     lwc: 2.50, meanF: 0.4, re: 18, vt: 7, kq: 0.56 },
      cbsev:     { label: 'Cumulonimbos severo', lwc: 2.50, meanF: 0.4, re: 20, vt: 7, kq: 0.62 }
    };
    function simEs(T) { return 6.112 * Math.exp(17.62 * T / (243.12 + T)); } // Magnus, hPa
    function simSetInputs(T, RH, CAPE, U, instant) {
      SIM_GOAL.T = clamp(T, -5, 35); SIM_GOAL.RH = clamp(RH, 30, 100);
      SIM_GOAL.CAPE = clamp(CAPE, 0, 4000); SIM_GOAL.U = clamp(U, 0, 30);
      if (instant) { SIM_IN.T = SIM_GOAL.T; SIM_IN.RH = SIM_GOAL.RH; SIM_IN.CAPE = SIM_GOAL.CAPE; SIM_IN.U = SIM_GOAL.U; }
      simSyncSliders();
    }
    // metas del clima vivo según el ánimo (0 despejado … 1 temporal):
    // cada régimen es un estado CONSISTENTE completo, no perillas sueltas
    function simPickGoal(m) {
      var R = Math.random;
      if (m < 0.30) { SIM_GOAL.T = 16 + R() * 8; SIM_GOAL.RH = 40 + R() * 18; SIM_GOAL.CAPE = 100 + R() * 400; SIM_GOAL.U = 1.5 + R() * 2.5; }
      else if (m < 0.55) { SIM_GOAL.T = 12 + R() * 6; SIM_GOAL.RH = 64 + R() * 20; SIM_GOAL.CAPE = R() * 120; SIM_GOAL.U = 3 + R() * 3; }
      else if (m < 0.80) {
        if (R() < 0.30) { SIM_GOAL.T = 18 + R() * 6; SIM_GOAL.RH = 70 + R() * 18; SIM_GOAL.CAPE = 400 + R() * 500; SIM_GOAL.U = 4 + R() * 3; } // chubascos congestus
        else { SIM_GOAL.T = 8 + R() * 6; SIM_GOAL.RH = 90 + R() * 8; SIM_GOAL.CAPE = 30 + R() * 60; SIM_GOAL.U = 4 + R() * 3; } // nimboestratos
      } else { SIM_GOAL.T = 24 + R() * 6; SIM_GOAL.RH = 72 + R() * 13; SIM_GOAL.CAPE = 1800 + R() * 1400; SIM_GOAL.U = 6 + R() * 4; } // cumulonimbos
    }
    var SIM_COVER = 1; // cobertura EFECTIVA del cielo (la fija weather.js cada frame): sin cobertura no hay nube que derivar
    function simDerive() {
      var T = SIM_IN.T, RH = SIM_IN.RH, CAPE = SIM_IN.CAPE, U = SIM_IN.U;
      var es = simEs(T), e = RH / 100 * es;
      var lnE = Math.log(Math.max(e, 0.01) / 6.112);
      var Td = 243.12 * lnE / (17.62 - lnE); // inversión de Magnus
      SIM.es = es; SIM.Td = Td;
      var convective = CAPE >= 200;
      var lcl = 125 * Math.max(T - Td, 0); // base convectiva, m
      var base = convective ? clamp(lcl, 100, 3000) : (RH >= 85 ? clamp(lcl, 80, 600) : clamp(lcl, 100, 1500));
      if (!BASE_OVR.auto) base = BASE_OVR.m; // override del debug: la base fijada manda en toda la cadena (tope, estrato-niebla, altura del deck)
      var wTheor = Math.sqrt(2 * CAPE), wUp = convective ? 0.5 * wTheor : 0.1;
      var freezeKm = Math.max(T / 6.5, 0);
      // tipo y tope por la tabla de decisión (CAPE × RH × profundidad)
      var key, topKm;
      if (!convective) {
        if (RH >= 88 && CAPE >= 25) { key = 'ns'; topKm = 5.0; }
        else if (RH >= 85) { key = 'st'; topKm = 0.9; }
        else if (RH >= 55) { key = 'sc'; topKm = 1.5; }
        else if (CAPE >= 60 || RH >= 40) { key = 'cirrus'; topKm = 7; }
        else { key = 'clear'; topKm = 0; }
      } else if (CAPE < 1000) {
        var dC = clamp(1.5 + CAPE * 0.0042, 2, 6);
        topKm = base / 1000 + dC;
        key = dC >= 3.2 ? 'congestus' : 'cu';
      } else {
        key = CAPE > 2500 ? 'cbsev' : 'cb';
        topKm = Math.min(base / 1000 + clamp(1.5 + CAPE * 0.0042, 2, 14), CAPE > 3000 ? 16 : 13);
      }
      if (key === 'cirrus') base = 6000; else if (key === 'clear') { base = 0; topKm = 0; }
      // equivalencia con la escena: si el cielo está despejado de verdad
      // (cobertura ~0), no existe nube alguna — tipo Despejado, τ 0, sin
      // lluvia ni rayos, digan lo que digan T/RH/CAPE en abstracto
      if (SIM_COVER < 0.03) { key = 'clear'; base = 0; topKm = 0; }
      var depthKm = Math.max(topKm - base / 1000, 0);
      var topTemp = T - 6.5 * topKm;
      var ty = SIM_TYPES[key];
      // Clausius–Clapeyron: el aire cálido guarda más agua (~7 %/°C) —
      // el LWC escala con e_s(T)/e_s(20 °C), acotado
      var ccF = clamp(es / simEs(20), 0.75, 1.15);
      var lwcPeak = ty.lwc * ccF, lwcMean = lwcPeak * ty.meanF;
      var lwp = lwcMean * depthKm * 1000; // g/m²
      var tau = ty.lwc > 0 ? 1.5 * lwp / ty.re : 0;
      var qp = lwcPeak * ty.kq; // agua precipitante, g/m³
      var rainCloud = 3.6 * ty.vt * qp; // flujo de precipitación en la nube, mm/h
      var fEvap = (RH > 85 || base < 500) ? 1 : clamp((RH - 30) / 55, 0, 1);
      var rainRate = rainCloud * fEvap;
      var virga = rainRate < 0.05 && rainCloud > 0.5;
      if (virga) rainRate = 0;
      // rayos: Price–Rind continental con compuerta física (sin zona de
      // fase mixta o sin CAPE no hay tormenta eléctrica, aunque el tope
      // sea frío: el nimboestrato jamás truena)
      var flash = 0;
      if (topTemp <= -10 && (topKm - freezeKm) >= 2 && CAPE >= 500) {
        flash = 3.44e-5 * Math.pow(topKm, 4.9);
        if (CAPE > 3500) flash *= 7; // supercélula: la fórmula subestima ×5–10 (observado 100–300+/min)
      }
      // ráfagas: factor sobre el medio + bonus de corriente descendente
      var gf = 1.3, bonus = 0;
      if (key === 'ns') gf = 1.4; else if (key === 'congestus') { gf = 1.45; bonus = 7; }
      else if (key === 'cb' || key === 'cbsev') { gf = 1.5; bonus = 15; }
      var gustPeak = Math.max(gf * U, U + bonus);
      var bf = BEAUFORT[BEAUFORT.length - 1];
      for (var bi = 0; bi < BEAUFORT.length; bi++) if (U <= BEAUFORT[bi][0]) { bf = BEAUFORT[bi]; break; }
      /* VISIBILIDAD POR LLUVIA — NO ES NIEBLA (OMM, Atlas de Nubes:
         «niebla» son gotitas SUSPENDIDAS que bajan la visibilidad a
         <1 km; la visibilidad que recorta la lluvia es extinción de
         las gotas que CAEN, un fenómeno aparte — las parametrizaciones
         de visibilidad tipo FRAM tratan niebla, lluvia, nieve y HR
         como términos SEPARADOS que se suman en β, Koschmieder:
         Vis = 3,912/β_total). Aquí se deriva SOLO el término de la
         lluvia: visRain y su coeficiente de extinción rainBeta (1/m).
         La visibilidad total la compone weather.js sumando el β de la
         niebla verdadera (manual o derivada) y este β de precipitación:
         puede llover con visibilidad recortada y CERO niebla. */
      var visRain = 10000;
      if (rainRate >= 10) visRain = 800; else if (rainRate >= 2.5) visRain = 2000; else if (rainRate >= 0.1) visRain = 3000;
      var vis = visRain;
      if (base > 0 && base < 100 && RH > 95) vis = Math.min(vis, 800);
      SIM.base = base; SIM.top = topKm; SIM.depth = depthKm; SIM.topTemp = topTemp; SIM.freezeKm = freezeKm;
      SIM.typeKey = key; SIM.typeLabel = ty.label; SIM.wTheor = wTheor; SIM.wUp = wUp;
      SIM.lwcPeak = lwcPeak; SIM.lwcMean = lwcMean; SIM.lwp = lwp; SIM.tau = tau; SIM.re = ty.re;
      SIM.rainCloud = rainCloud; SIM.rainRate = rainRate; SIM.fEvap = fEvap; SIM.virga = virga;
      SIM.fallSpeed = ty.vt; SIM.dropMm = key === 'st' || key === 'sc' ? 0.5 : key === 'ns' || key === 'congestus' ? 1.5 : (key === 'cb' || key === 'cbsev') ? 3.5 : 0;
      SIM.rainCat = rainRate < 0.05 ? 'Sin lluvia' : rainRate < 0.25 ? 'Llovizna' : rainRate < 2.5 ? 'Ligera' : rainRate < 10 ? 'Moderada' : rainRate < 50 ? 'Fuerte' : 'Violenta';
      SIM.phase = T > 2 ? 'Lluvia' : T >= 0 ? 'Mixta' : 'Nieve';
      SIM.flashTotal = flash; SIM.flashCG = flash * 0.25;
      if (flash <= 0) SIM.nextFlashIn = -1;
      SIM.gustFactor = gf; SIM.gustBonus = bonus; SIM.gustPeak = gustPeak;
      SIM.beaufort = bf[1]; SIM.beaufortName = bf[2];
      SIM.visibility = vis;
      SIM.visRain = visRain; SIM.rainBeta = visRain < 10000 ? 3.912 / visRain : 0; // β de precipitación (1/m, Koschmieder con umbral 0,05)
      SIM.rainFrac = rainRate >= 0.15 ? clamp(Math.sqrt(rainRate / 35), 0.08, 1) : 0;
      SIM.stormFrac = clamp(flash / 10, 0, 1);
      var warn = [];
      if (virga) warn.push('VIRGA: la lluvia se evapora bajo la base y no llega al suelo');
      if (rainRate > 10 && topTemp > 0) warn.push('⚠ lluvia fuerte con tope cálido: imposible');
      if (flash > 0 && CAPE < 500) warn.push('⚠ rayos con CAPE < 500: imposible');
      SIM.warnings = warn.join(' · ');
      if (SIM_COVER < 0.03) { SIM.wUp = 0; SIM.wTheor = 0; } // sin nube no hay ascendente que mostrar: equivalencia total con el cielo despejado
      SIM.verdict = ty.label + ' · tope ' + topKm.toFixed(1).replace('.', ',') + ' km · ' + Math.round(SIM.wUp) + ' m/s · ' +
        rainRate.toFixed(1).replace('.', ',') + ' mm/h · ' + flash.toFixed(1).replace('.', ',') + ' rayos/min';
    }
    /* Panel debug: las 4 que mandan son sliders; todo lo derivado es
       lectura, refrescada ~3 veces por segundo desde updateClimate. */
    function fmtN(v, d) { return v.toFixed(d).replace('.', ','); }
    var simUiT = 0, simEls = null;
    function simCacheEls() {
      simEls = {};
      var ids = ['simType', 'simBaseTop', 'simTopTemp', 'simTau', 'simLWC', 'simRain', 'simDrop', 'simEvap', 'simFlash', 'simNextFlash', 'simUpdraft', 'simWind', 'simVis', 'simVerdict'];
      for (var i = 0; i < ids.length; i++) simEls[ids[i]] = document.getElementById('dbg' + ids[i][0].toUpperCase() + ids[i].slice(1));
    }
    function simUpdatePanel() {
      if (!simEls) simCacheEls();
      if (!simEls.simType) return;
      simEls.simType.textContent = SIM.typeLabel;
      simEls.simBaseTop.textContent = SIM.base > 0 ? Math.round(SIM.base) + ' m / ' + fmtN(SIM.top, 1) + ' km' : '—';
      simEls.simTopTemp.textContent = SIM.top > 0 ? fmtN(SIM.topTemp, 0) + ' °C' : '—';
      simEls.simTau.textContent = SIM.tau > 0 ? fmtN(SIM.tau, SIM.tau < 10 ? 1 : 0) + ' · LWP ' + Math.round(SIM.lwp) + ' g/m²' : '0';
      simEls.simLWC.textContent = SIM.lwcPeak > 0 ? fmtN(SIM.lwcPeak, 2) + ' / ' + fmtN(SIM.lwcMean, 2) + ' g/m³' : '0 g/m³';
      simEls.simRain.textContent = fmtN(SIM.rainRate, 1) + ' mm/h · ' + SIM.rainCat + (SIM.phase !== 'Lluvia' ? ' · ' + SIM.phase : '');
      simEls.simDrop.textContent = SIM.fallSpeed > 0 ? fmtN(SIM.dropMm, 1) + ' mm · ' + SIM.fallSpeed + ' m/s' : '—';
      simEls.simEvap.textContent = fmtN(SIM.fEvap, 2) + (SIM.virga ? ' · VIRGA' : '');
      simEls.simFlash.textContent = SIM.flashTotal > 0 ? fmtN(SIM.flashTotal, 1) + ' /min · CG ' + fmtN(SIM.flashCG, 1) : '0 /min';
      simEls.simNextFlash.textContent = SIM.flashTotal > 0 ? (SIM.nextFlashIn >= 0 ? fmtN(Math.max(SIM.nextFlashIn, 0), 0) + ' s' : '—') : '—';
      simEls.simUpdraft.textContent = fmtN(SIM.wUp, 1) + ' m/s (teór. ' + fmtN(SIM.wTheor, 0) + ')';
      simEls.simWind.textContent = fmtN(SIM_IN.U, 1) + ' / ' + fmtN(SIM.gustPeak, 1) + ' m/s · Beaufort ' + SIM.beaufort + ' ' + SIM.beaufortName;
      simEls.simVis.textContent = (SIM.visibility >= 10000 ? '>10 km' : fmtN(SIM.visibility / 1000, 1) + ' km') + (SIM.rainRate >= 0.1 ? ' · solo lluvia ' + (SIM.visRain >= 10000 ? '>10 km' : fmtN(SIM.visRain / 1000, 1) + ' km') : '');
      simEls.simVerdict.textContent = SIM.warnings ? SIM.warnings : SIM.verdict;
    }
    var simSliders = null;
    function simSyncSliders() {
      if (!simSliders) {
        simSliders = {
          T: document.getElementById('dbgSimT'), RH: document.getElementById('dbgSimRH'),
          CAPE: document.getElementById('dbgSimCAPE'), U: document.getElementById('dbgSimU')
        };
      }
      if (!simSliders.T) return;
      if (document.activeElement !== simSliders.T) { simSliders.T.value = Math.round(SIM_IN.T); document.getElementById('dbgSimTVal').textContent = Math.round(SIM_IN.T) + ' °C · rocío ' + fmtN(SIM.Td, 1) + ' °C'; }
      if (document.activeElement !== simSliders.RH) { simSliders.RH.value = Math.round(SIM_IN.RH); document.getElementById('dbgSimRHVal').textContent = Math.round(SIM_IN.RH) + ' %'; }
      if (document.activeElement !== simSliders.CAPE) { simSliders.CAPE.value = Math.round(SIM_IN.CAPE); document.getElementById('dbgSimCAPEVal').textContent = Math.round(SIM_IN.CAPE) + ' J/kg'; }
      if (document.activeElement !== simSliders.U) { simSliders.U.value = SIM_IN.U; document.getElementById('dbgSimUVal').textContent = fmtN(SIM_IN.U, 1) + ' m/s'; }
    }
    (function bindSimSliders() {
      function on(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('input', function () { fn(parseFloat(el.value)); }); }
      on('dbgSimT', function (v) { SIM_IN.T = SIM_GOAL.T = v; wxManual = true; TEMP_DAY.auto = false; TEMP_DAY.offset = null; });
      on('dbgSimRH', function (v) { SIM_IN.RH = SIM_GOAL.RH = v; wxManual = true; });
      on('dbgSimCAPE', function (v) { SIM_IN.CAPE = SIM_GOAL.CAPE = v; wxManual = true; });
      on('dbgSimU', function (v) { SIM_IN.U = SIM_GOAL.U = v; wxManual = true; });
    })();
    function updateClimate(dt) {
      // temperatura del día: la automática manda; el override manual es
      // un offset sobre ella que decae exponencial hasta desaparecer
      if ((TEMP_DAY.auto || TEMP_DAY.offset != null) && typeof autoTempNow === 'function') {
        if (TEMP_DAY.offset != null) { TEMP_DAY.offset *= Math.exp(-dt / 45); if (Math.abs(TEMP_DAY.offset) < 0.1) TEMP_DAY.offset = null; }
        var atT = autoTempNow() + (TEMP_DAY.offset || 0);
        SIM_GOAL.T = atT; SIM_IN.T += (atT - SIM_IN.T) * (1 - Math.exp(-dt / 20));
      }
      if (!wxManual) { // clima vivo: las 4 independientes derivan hacia la meta del régimen
        var k = 1 - Math.exp(-dt / 40);
        SIM_IN.T += (SIM_GOAL.T - SIM_IN.T) * k;
        SIM_IN.RH += (SIM_GOAL.RH - SIM_IN.RH) * k;
        SIM_IN.CAPE += (SIM_GOAL.CAPE - SIM_IN.CAPE) * k;
        SIM_IN.U += (SIM_GOAL.U - SIM_IN.U) * k;
      }
      simDerive();
      simUiT += dt;
      if (simUiT > 0.3) { simUiT = 0; simUpdatePanel(); simSyncSliders(); }
    }
    simDerive();
