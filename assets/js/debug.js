/* debug.js — Menú DEBUG en vivo (densidad, formas, clima, hora, fase
   lunar, velocidades, noclip), regeneración de chunks y el asa de
   verificación window.__game. Depende de: world, weather, player, scene. */
'use strict';
    /* ================= Menú DEBUG: controles en vivo ================= */
    var debugPanel = document.getElementById('debugPanel');
    var btnDebug = document.getElementById('btnDebug');
    function setDebug(open) {
      debugPanel.classList.toggle('open', open);
      if (open && document.pointerLockElement) document.exitPointerLock();
    }
    btnDebug.addEventListener('click', function () { setDebug(!debugPanel.classList.contains('open')); });
    document.getElementById('btnDebugClose').addEventListener('click', function () { setDebug(false); });
    /* Buscador del panel: filtra los parámetros por nombre en vivo.
       Un «parámetro» es su etiqueta (.dbgLabel) más los controles que la
       siguen hasta la siguiente etiqueta; el texto buscable incluye los
       nombres de botones y casillas del grupo (p. ej. «cruz» encuentra
       las formas). Sin texto se ve todo; con texto, las secciones con
       coincidencias se despliegan y las demás se ocultan — al borrar,
       cada sección recupera el despliegue que tenía. */
    var dbgSearchEl = document.getElementById('dbgSearch');
    var dbgFilterGroups = []; // { els: [...], text: '', sec: <details> }
    var dbgFilterSecs = [];
    (function buildDbgFilter() {
      var secs = debugPanel.querySelectorAll('details.dbgSec');
      for (var si = 0; si < secs.length; si++) {
        dbgFilterSecs.push(secs[si]);
        var cur = null;
        var kids = secs[si].children;
        for (var ki = 0; ki < kids.length; ki++) {
          var el = kids[ki];
          if (el.tagName === 'SUMMARY') continue;
          if (el.classList.contains('dbgLabel') || el.querySelector('.dbgLabel') || !cur) { // un contenedor con su propia etiqueta dentro (el bloque de lluvia) también abre grupo
            cur = { els: [], text: '', secIdx: si };
            dbgFilterGroups.push(cur);
          }
          cur.els.push(el);
          cur.text += ' ' + (el.textContent || '');
        }
      }
      for (var gi = 0; gi < dbgFilterGroups.length; gi++) dbgFilterGroups[gi].text = normDbgText(dbgFilterGroups[gi].text);
    })();
    function normDbgText(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    var dbgSavedOpen = null, dbgSavedDisp = null;
    function applyDbgFilter() {
      var q = normDbgText(dbgSearchEl.value).trim();
      var si, gi, el;
      if (!q) {
        // al borrar: cada elemento y cada sección recuperan el display y
        // el despliegue que tenían cuando la búsqueda empezó (p. ej. el
        // bloque de lluvia, oculto salvo con Lluvia/Tormenta, vuelve a
        // su estado de ese momento, no a uno fijo)
        for (gi = 0; gi < dbgFilterGroups.length; gi++) for (el = 0; el < dbgFilterGroups[gi].els.length; el++) dbgFilterGroups[gi].els[el].style.display = dbgSavedDisp ? dbgSavedDisp[gi][el] : '';
        for (si = 0; si < dbgFilterSecs.length; si++) {
          dbgFilterSecs[si].style.display = '';
          if (dbgSavedOpen) dbgFilterSecs[si].open = dbgSavedOpen[si];
        }
        dbgSavedOpen = null; dbgSavedDisp = null;
        return;
      }
      if (!dbgSavedOpen) {
        dbgSavedOpen = []; dbgSavedDisp = [];
        for (si = 0; si < dbgFilterSecs.length; si++) dbgSavedOpen.push(dbgFilterSecs[si].open);
        for (gi = 0; gi < dbgFilterGroups.length; gi++) { dbgSavedDisp.push([]); for (el = 0; el < dbgFilterGroups[gi].els.length; el++) dbgSavedDisp[gi].push(dbgFilterGroups[gi].els[el].style.display); }
      }
      var secVisible = {};
      for (gi = 0; gi < dbgFilterGroups.length; gi++) {
        var g = dbgFilterGroups[gi];
        var vis = g.text.indexOf(q) !== -1;
        for (el = 0; el < g.els.length; el++) g.els[el].style.display = vis ? (dbgSavedDisp[gi][el] === 'none' ? 'block' : dbgSavedDisp[gi][el]) : 'none';
        if (vis) secVisible[g.secIdx] = true;
      }
      for (si = 0; si < dbgFilterSecs.length; si++) {
        var any = !!secVisible[si];
        dbgFilterSecs[si].style.display = any ? '' : 'none';
        if (any) dbgFilterSecs[si].open = true;
      }
    }
    dbgSearchEl.addEventListener('input', applyDbgFilter);
    document.addEventListener('pointerdown', function (e) {
      if (!debugPanel.classList.contains('open')) return;
      if (debugPanel.contains(e.target) || btnDebug.contains(e.target)) return;
      setDebug(false);
    });
    var regenTimer = 0;
    function regenChunks() {
      settingsVer++;
      clearChunkCache();
      fastFadeUntil = Date.now() + 5000;
      buildQueue.length = 0;
      var pcx = Math.floor(playerBody.position.x / CHUNK), pcz = Math.floor(playerBody.position.z / CHUNK);
      var doomed = [];
      for (var k in chunks) { var ch = chunks[k]; if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) <= 3) doomed.push(ch); }
      for (var i = 0; i < doomed.length; i++) {
        var fi = fading.indexOf(doomed[i]); if (fi !== -1) fading.splice(fi, 1);
        disposeChunk(doomed[i]);
      }
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) if (!chunks[keyOf(pcx + dx, pcz + dz)]) buildChunk(pcx + dx, pcz + dz, true);
      lastCellX = 1e9; // la matriz reevalúa los anillos externos al próximo frame
      colliderChunkKey = '';
      refreshColliders();
    }
    function scheduleRegen(immediate) {
      clearTimeout(regenTimer);
      if (immediate) { regenChunks(); return; }
      regenTimer = setTimeout(regenChunks, 220);
    }
    var dbgDensity = document.getElementById('dbgDensity'), dbgDensityVal = document.getElementById('dbgDensityVal');
    dbgDensity.addEventListener('input', function () {
      SETTINGS.density = parseInt(dbgDensity.value, 10) / 100;
      dbgDensityVal.textContent = dbgDensity.value + ' %';
      scheduleRegen(false);
    });
    for (var dk = 0; dk < 5; dk++) (function (idx) {
      document.getElementById('dbgK' + idx).addEventListener('change', function () {
        SETTINGS.kinds[idx] = this.checked;
        scheduleRegen(true);
      });
    })(dk);
    document.getElementById('dbgMaus').addEventListener('change', function () { SETTINGS.mausoleum = this.checked; scheduleRegen(true); });
    // clima y hora
    function fmtHour(h) { var hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60); return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
    var dbgCloud = document.getElementById('dbgCloud'), dbgFog = document.getElementById('dbgFog'), dbgHour = document.getElementById('dbgHour');
    var dbgCloudVal = document.getElementById('dbgCloudVal'), dbgFogVal = document.getElementById('dbgFogVal'), dbgHourVal = document.getElementById('dbgHourVal');
    function setWxPreset(name) {
      var p = WX_PRESETS[name]; if (!p) return;
      ENV.cloud = p.cloud; ENV.fog = p.fog; ENV.rain = p.rain; ENV.storm = p.storm; ENV.sun = p.sun; ENV.hemi = p.hemi; ENV.exp = p.exp;
      // el preset fija las 4 variables independientes del modelo físico:
      // lluvia, rayos, ráfagas y visibilidad se derivan de ellas
      if (typeof simSetInputs === 'function') simSetInputs(p.simT, p.simRH, p.simCAPE, p.simU, true);
      TEMP_DAY.auto = false; TEMP_DAY.offset = null; // el preset es un estado elegido: la temperatura automática se suelta
      rainOverride = 0;
      var dbgRainEl2 = document.getElementById('dbgRain');
      if (dbgRainEl2) { dbgRainEl2.value = 0; document.getElementById('dbgRainVal').textContent = '0 %'; }
      // el preset es el PUNTO DE PARTIDA del clima vivo: la evolución
      // retoma desde aquí (meta = preset, ánimo acorde, próximo giro lejos)
      wxGoal.cloud = p.cloud; wxGoal.fog = p.fog; wxGoal.rain = p.rain; wxGoal.storm = p.storm; wxGoal.sun = p.sun; wxGoal.hemi = p.hemi; wxGoal.exp = p.exp;
      wxMood = clamp(p.cloud * 0.55 + p.rain * 0.45 + p.storm * 0.30, 0, 1);
      wxTimer = 80 + Math.random() * 60;
      wxManual = true; // ajuste manual: el clima vivo se detiene y el preset queda fijo
      envFastT = 1.0; // el entorno se acomoda rápido al nuevo preset
      var btns = document.querySelectorAll('.wbtn.wx');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-wx') === name);
      dbgCloud.value = Math.round(ENV.cloud * 100); dbgCloudVal.textContent = dbgCloud.value + ' %';
      dbgFog.value = Math.round(ENV.fog * 100); dbgFogVal.textContent = dbgFog.value + ' %';
      // el control de lluvia (extra manual sobre la derivada del modelo)
      // solo aparece con los climas Lluvia o Tormenta
      var rainCtlEl = document.getElementById('rainCtl');
      if (rainCtlEl) rainCtlEl.style.display = (name === 'rain' || name === 'storm') ? 'block' : 'none';
    }
    var wxBtns = document.querySelectorAll('.wbtn.wx');
    for (var wb = 0; wb < wxBtns.length; wb++) (function (btn) { btn.addEventListener('click', function () { setWxPreset(btn.getAttribute('data-wx')); }); })(wxBtns[wb]);
    /* ============ PRESETS DE ESCENARIO (select del DEBUG, a pedido) ============
       Cada preset es un estado climático COMPLETO y consistente según
       el ESQUEMA fenómeno→consecuencia — no un aspecto aislado: fija a
       la vez estación y época (día del año), hora, nubosidad, niebla
       (la del panel: la derivada la pone el modelo por su causa), las
       4 variables del modelo físico (T, RH, CAPE, U — de ellas derivan
       tipo/base de nube, lluvia, rayos y visibilidad), el tipo de capa
       de render, los overrides de base y de τ, y la fase de la luna.
       Al aplicarlo, TODOS los controles del panel reflejan sus valores
       (los sliders de T/base/τ se refrescan solos por sus intervalos;
       el resto se sincroniza aquí). El clima queda fijo (wxManual),
       como cualquier ajuste manual del panel. */
    var CLIMATE_PRESETS = {
      'mediodia':        { season: 'primavera', hour: 12,   cloud: 0,    fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 25, RH: 45, CAPE: 400,  U: 3,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' },
      'cirros':          { season: 'primavera', hour: 11,   cloud: 0.30, fog: 0, sun: 2.6,  hemi: 0.82, exp: 0.78, T: 23, RH: 42, CAPE: 80,   U: 5,  ctype: 'cirrus',      base: 'auto', tau: 'auto', moon: 'auto' },
      'cumulos':         { season: 'primavera', hour: 15.5, cloud: 0.52, fog: 0, sun: 2.2,  hemi: 0.78, exp: 0.78, T: 25, RH: 52, CAPE: 600,  U: 3,  ctype: 'altocumulus', base: 'auto', tau: 'auto', moon: 'auto' },
      'nublado':         { season: 'invierno',  hour: 12,   cloud: 1,    fog: 0, sun: 1.5,  hemi: 0.72, exp: 0.80, T: 10, RH: 88, CAPE: 0,    U: 5,  ctype: 'stratus',     base: 'auto', tau: 'auto', moon: 'auto' }, // sudestada de invierno: cielo cubierto frío y húmedo del SE
      'lluvia-ligera':   { season: 'invierno',  hour: 11,   cloud: 0.95, fog: 0, sun: 1.3,  hemi: 0.65, exp: 0.76, T: 9,  RH: 95, CAPE: 10,   U: 4,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto', rainCtl: true }, // llovizna de sudestada (<5 mm/h, la lluvia invernal típica de Córdoba)
      'lluvia-moderada': { season: 'primavera', hour: 13,   cloud: 0.90, fog: 0, sun: 1.05, hemi: 0.60, exp: 0.75, T: 16, RH: 95, CAPE: 50,   U: 6,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto', rainCtl: true },
      /* ARCOÍRIS (esquema §15): el preset NO enciende ningún arco —
         junta las tres condiciones de las que EMERGE en weather.js:
         (1) LLUVIA real del modelo: T 26 / RH 75 / CAPE 600 derivan
         cúmulos congestus (base ~600 m, tope ~4,6 km) con ~7 mm/h de
         chubasco — lluvia de gotas grandes, la que refracta bien;
         (2) SOL BAJO: las 17:30 de verano ponen el sol a ~17° —
         bajo los 42° de Descartes, así el arco culmina a ~25°;
         (3) LUZ DIRECTA: nubosidad ROTA (48 %, capa de cúmulos) —
         el sol entra por los huecos mientras llueve; con la cubierta
         cerrada el sol sería difuso y no habría arco. El arco sale
         en el lado ANTISOLAR: hay que mirar en contra del sol. */
      'arcoiris':        { season: 'verano',    hour: 17.5, cloud: 0.48, fog: 0, sun: 2.9,  hemi: 0.80, exp: 0.78, T: 27, RH: 70, CAPE: 800,  U: 3,  ctype: 'cumulus',     base: 'auto', tau: 'auto', moon: 'auto', rainCtl: true },
      'tormenta':        { season: 'verano',    hour: 17,   cloud: 1,    fog: 0, sun: 0.65, hemi: 0.50, exp: 0.70, T: 29, RH: 78, CAPE: 2500, U: 8,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto', rainCtl: true },
      'amanecer':        { season: 'primavera', hour: 5.6,  cloud: 0,    fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 14, RH: 70, CAPE: 40,   U: 2,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' },
      'ocaso':           { season: 'primavera', hour: 17.9, cloud: 0.05, fog: 0, sun: 2.9, hemi: 0.85, exp: 0.78, T: 22, RH: 50, CAPE: 200,  U: 3,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' }, // 17.9 h solar de oct: sol a ~2,5° (la puesta es ~18.1; a 18.4 ya estaría a −3,8°, crepúsculo)
      'luna-llena':      { season: 'primavera', hour: 23.4, cloud: 0.08, fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 15, RH: 60, CAPE: 0,    U: 2,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 4 },
      'sin-luna':        { season: 'primavera', hour: 23.4, cloud: 0,    fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 15, RH: 60, CAPE: 0,    U: 2,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 0 },
      'niebla-radiacion': { season: 'otono',    hour: 6.4,  cloud: 0.05, fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 10, RH: 98, CAPE: 0,    U: 1,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' }, // niebla matinal de otoño–invierno (calibración del informe §6.1: HR alta, noche despejada, viento calmo — no hay normal mensual SMN)
      'calima':          { season: 'verano',    hour: 13.5, cloud: 0,    fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 36, RH: 28, CAPE: 300,  U: 1,  ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' }, // ola de calor de enero: la T que enciende la distorsión por calor (portón de diseño de Guille)
      /* ESTACIONES con las normales del SMN argentino 1991–2020
         (Córdoba Observatorio, OMM 87345): la T de cada preset es la
         que la curva automática (Parton–Logan anclada a media/DTR
         del SMN) da a ESA hora y ESE día del año — primavera 15 oct
         12:00 ≈ 25 °C (oct: media 19,4, máx 26,3, mín 13,4); verano
         15 ene 13:00 ≈ 30 °C (24,7 / 31,2 / 18,9); otoño 15 abr
         12:30 ≈ 23 °C (18,4 / 25,0 / 13,3); invierno 15 jul 12:00 ≈
         16 °C (10,8 / 18,4 / 5,5 — el mediodía invernal es templado
         al sol; lo frío es la madrugada, DTR 12,9 °C). La RH es la
         media mensual del SMN corrida al mediodía (ene 65,1 · abr
         72,0 · jul 65,8 · oct 59,4). El viento medio es el de
         MERRA-2 (2,0–2,8 m/s, máx. en sep–oct): no hay normal SMN
         tabular de viento para el Observatorio. */
      'primavera':       { season: 'primavera', hour: 12,   cloud: 0.25, fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 25, RH: 48, CAPE: 500,  U: 3,   ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' },
      'verano':          { season: 'verano',    hour: 13,   cloud: 0.35, fog: 0, sun: 2.6,  hemi: 0.82, exp: 0.78, T: 30, RH: 55, CAPE: 1200, U: 2,   ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' },
      'otono':           { season: 'otono',     hour: 12.5, cloud: 0.30, fog: 0, sun: 2.5,  hemi: 0.80, exp: 0.78, T: 23, RH: 60, CAPE: 150,  U: 2,   ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' },
      'invierno':        { season: 'invierno',  hour: 12,   cloud: 0.08, fog: 0, sun: 2.9,  hemi: 0.85, exp: 0.78, T: 16, RH: 48, CAPE: 20,   U: 2.5, ctype: 'auto',        base: 'auto', tau: 'auto', moon: 'auto' }
    };
    var dbgPresetKey = ''; // preset de escenario vigente ('' = ninguno / modificado a mano)
    var dbgPreset = document.getElementById('dbgPreset');
    function applyClimatePreset(key) {
      var p = CLIMATE_PRESETS[key]; if (!p) return;
      dbgPresetKey = key;
      if (dbgPreset && dbgPreset.value !== key) dbgPreset.value = key;
      setSeason(p.season); // estación: botones, tinte del césped y día del año representativo (reflejado en su slider)
      if (p.doy) { // época propia dentro de la estación (ningún preset vigente la usa: la estación ya fija el día representativo)
        ORBIT.dayOfYear = p.doy; dbgDayOfYear.value = p.doy;
        document.getElementById('dbgDayVal').textContent = orbitDateLabel(p.doy);
      }
      ENV.cloud = p.cloud; ENV.fog = p.fog; ENV.rain = 0; ENV.storm = 0; ENV.sun = p.sun; ENV.hemi = p.hemi; ENV.exp = p.exp;
      wxGoal.cloud = p.cloud; wxGoal.fog = p.fog; wxGoal.rain = 0; wxGoal.storm = 0; wxGoal.sun = p.sun; wxGoal.hemi = p.hemi; wxGoal.exp = p.exp;
      wxMood = clamp(p.cloud * 0.55, 0, 1); wxTimer = 80 + Math.random() * 60;
      // las 4 del modelo físico: de ellas derivan tipo y base de nube,
      // lluvia, rayos, ráfagas y visibilidad — el preset no fija ningún
      // derivado por separado
      if (typeof simSetInputs === 'function') simSetInputs(p.T, p.RH, p.CAPE, p.U, true);
      TEMP_DAY.auto = false; TEMP_DAY.offset = null; // la temperatura del preset queda fija, como la de un preset de clima
      rainOverride = 0;
      var dbgRainEl3 = document.getElementById('dbgRain');
      if (dbgRainEl3) { dbgRainEl3.value = 0; document.getElementById('dbgRainVal').textContent = '0 %'; }
      var rainCtlEl2 = document.getElementById('rainCtl');
      if (rainCtlEl2) rainCtlEl2.style.display = p.rainCtl ? 'block' : 'none';
      setCloudTypeMode(p.ctype); // tipo de capa de render (botones sincronizados)
      if (p.base === 'auto') BASE_OVR.auto = true; else { BASE_OVR.auto = false; BASE_OVR.m = p.base; }
      if (p.tau === 'auto') TAU_OVR.auto = true; else { TAU_OVR.auto = false; TAU_OVR.tau = p.tau; }
      setMoonPhase(p.moon === 'auto' ? 'auto' : String(p.moon)); // fase lunar (select sincronizado)
      setHour(p.hour, false); // hora (slider, etiqueta y botones de momento sincronizados)
      dbgCloud.value = Math.round(ENV.cloud * 100); dbgCloudVal.textContent = dbgCloud.value + ' %';
      dbgFog.value = Math.round(ENV.fog * 100); dbgFogVal.textContent = dbgFog.value + ' %';
      for (var i = 0; i < wxBtns.length; i++) wxBtns[i].classList.remove('on'); // el escenario manda: ningún preset simple queda marcado
      wxManual = true; envFastT = 1.0; // fijo y acomodación rápida, como todo ajuste manual
    }
    if (dbgPreset) dbgPreset.addEventListener('change', function () { applyClimatePreset(dbgPreset.value); });
    // si el usuario toca cualquier otro control del panel, el escenario
    // deja de ser «el vigente»: el select vuelve a su posición neutra
    // (los ajustes programáticos de applyClimatePreset no disparan
    // eventos, así que no se borra a sí mismo)
    function dbgPresetDirty(e) {
      if (!dbgPresetKey) return;
      if (e.target === dbgPreset) return;
      dbgPresetKey = ''; if (dbgPreset) dbgPreset.value = '';
    }
    debugPanel.addEventListener('input', dbgPresetDirty);
    debugPanel.addEventListener('change', dbgPresetDirty);
    debugPanel.addEventListener('click', function (e) { if (e.target !== dbgPreset && e.target.closest && e.target.closest('.wbtn')) dbgPresetDirty(e); });
    /* ============ PROTECCIÓN DE SLIDERS AL SCROLLEAR (a pedido) ============
       Al recorrer el menú es fácil arrastrar un slider sin querer. Tres
       capas, para táctil y PC:
       (1) CSS touch-action: pan-y en todos los range del panel — el
       gesto vertical sobre un slider SCROLLEA el menú (el navegador
       cancela el gesto sobre el control) y solo un arrastre
       horizontal deliberado cambia el valor.
       (2) Rueda del ratón sobre un slider: se intercepta y scrollea el
       panel; la rueda nunca cambia un slider.
       (3) Estado visible: mientras el panel scrollea (y 220 ms tras
       parar) lleva la clase .scrolling — los sliders se atenúan y la
       cabecera muestra el distintivo «SLIDERS PROTEGIDOS» — para que
       se vea cuándo la protección está activa. */
    var dbgScrollLockEl = document.getElementById('dbgScrollLock');
    var dbgScrollLockT = 0;
    function armScrollLock() {
      debugPanel.classList.add('scrolling');
      if (dbgScrollLockEl) dbgScrollLockEl.classList.add('on');
      clearTimeout(dbgScrollLockT);
      dbgScrollLockT = setTimeout(function () {
        debugPanel.classList.remove('scrolling');
        if (dbgScrollLockEl) dbgScrollLockEl.classList.remove('on');
      }, 220);
    }
    debugPanel.addEventListener('scroll', armScrollLock, { passive: true });
    debugPanel.addEventListener('wheel', function (e) {
      var r = (e.target && e.target.closest) ? e.target.closest('input[type="range"]') : null;
      if (r) { e.preventDefault(); debugPanel.scrollTop += e.deltaY; armScrollLock(); }
    }, { passive: false });
    // tipo de nube: Auto lo deriva del clima; un tipo fijo manda en la
    // extinción σ, la altura de la capa, los rayos y el borde plateado
    var ctypeBtns = document.querySelectorAll('.wbtn.ctype');
    function setCloudTypeMode(mode) {
      cloudTypeMode = mode;
      for (var j = 0; j < ctypeBtns.length; j++) ctypeBtns[j].classList.toggle('on', ctypeBtns[j].getAttribute('data-ctype') === mode);
    }
    for (var cb2 = 0; cb2 < ctypeBtns.length; cb2++) (function (btn) { btn.addEventListener('click', function () { setCloudTypeMode(btn.getAttribute('data-ctype')); }); })(ctypeBtns[cb2]);
    dbgCloud.addEventListener('input', function () { ENV.cloud = parseInt(dbgCloud.value, 10) / 100; wxGoal.cloud = ENV.cloud; wxManual = true; dbgCloudVal.textContent = dbgCloud.value + ' %'; });
    dbgFog.addEventListener('input', function () { ENV.fog = parseInt(dbgFog.value, 10) / 100; wxGoal.fog = ENV.fog; wxManual = true; dbgFogVal.textContent = dbgFog.value + ' %'; });
    // densidad de lluvia: EXTRA manual sobre la lluvia que deriva el
    // modelo físico de T/RH/CAPE/U (la base siempre es la derivada)
    var dbgRain = document.getElementById('dbgRain');
    dbgRain.addEventListener('input', function () { rainOverride = parseInt(dbgRain.value, 10) / 100; wxManual = true; document.getElementById('dbgRainVal').textContent = dbgRain.value + ' %'; });
    function setHour(h, fromSlider) {
      ENV.hour = h;
      wxManual = true; // hora fijada a mano: el tiempo automático queda detenido
      envFastT = 1.0; // nubes, luz y niebla se acomodan rápido a la nueva hora y a la nueva posición del sol
      dbgHourVal.textContent = fmtHour(h);
      if (!fromSlider) dbgHour.value = h;
      var btns = document.querySelectorAll('.wbtn.tod');
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', Math.abs(parseFloat(btns[i].getAttribute('data-hour')) - h) < 0.05);
    }
    var todBtns = document.querySelectorAll('.wbtn.tod');
    for (var tb = 0; tb < todBtns.length; tb++) (function (btn) { btn.addEventListener('click', function () { setHour(parseFloat(btn.getAttribute('data-hour')), false); }); })(todBtns[tb]);
    dbgHour.addEventListener('input', function () { setHour(parseFloat(dbgHour.value), true); });
    // estaciones: el césped cambia en tiempo real (mezcla de seco + tinte)
    var seasonBtns = document.querySelectorAll('.wbtn.season');
    for (var sb = 0; sb < seasonBtns.length; sb++) (function (btn) { btn.addEventListener('click', function () { setSeason(btn.getAttribute('data-season')); }); })(seasonBtns[sb]);
    // fase de la luna: automática (real de hoy) o una de las 8 fases forzada
    var dbgMoon = document.getElementById('dbgMoon');
    function setMoonPhase(v) {
      if (v === 'auto' || v == null) { MOON.mode = 'auto'; dbgMoon.value = 'auto'; }
      else { MOON.mode = 'manual'; MOON.manual = clamp(parseInt(v, 10) || 0, 0, 7); dbgMoon.value = String(MOON.manual); }
      lastMoonP = -1; moonLabelTxt = ''; // el disco y la etiqueta se rehacen ya
    }
    dbgMoon.addEventListener('change', function () { setMoonPhase(dbgMoon.value); });
    // vegetación regulable: césped (poco denso por defecto) y árboles —
    // regeneran los chunks cercanos en vivo, como la densidad de tumbas
    var dbgGrass = document.getElementById('dbgGrass'), dbgTrees = document.getElementById('dbgTrees');
    dbgGrass.addEventListener('input', function () { SETTINGS.grass = parseInt(dbgGrass.value, 10) / 100; document.getElementById('dbgGrassVal').textContent = dbgGrass.value + ' %'; scheduleRegen(false); });
    dbgTrees.addEventListener('input', function () { SETTINGS.trees = parseInt(dbgTrees.value, 10) / 100; document.getElementById('dbgTreesVal').textContent = dbgTrees.value + ' %'; scheduleRegen(false); });
    // viento regulable: intensidad (multiplicador) y dirección base
    var dbgWind = document.getElementById('dbgWind'), dbgWindDir = document.getElementById('dbgWindDir');
    dbgWind.addEventListener('input', function () { windMult = parseInt(dbgWind.value, 10) / 100; document.getElementById('dbgWindVal').textContent = dbgWind.value + ' %'; });
    dbgWindDir.addEventListener('input', function () { windBaseAng = parseInt(dbgWindDir.value, 10) * Math.PI / 180; document.getElementById('dbgWindDirVal').textContent = dbgWindDir.value + '°'; });
    // velocidad de las nubes: deriva del skybox, de las volumétricas y de sus sombras
    var dbgCloudSpd = document.getElementById('dbgCloudSpd');
    dbgCloudSpd.addEventListener('input', function () { cloudSpeedMult = parseInt(dbgCloudSpd.value, 10) / 100; document.getElementById('dbgCloudSpdVal').textContent = dbgCloudSpd.value + ' %'; });
    // brillo del sol (Iluminación): glow/halo del disco e intensidad de su luz
    var dbgSun = document.getElementById('dbgSun');
    dbgSun.addEventListener('input', function () { sunGlow = parseInt(dbgSun.value, 10) / 100; document.getElementById('dbgSunVal').textContent = dbgSun.value + ' %'; });
    // brillo de la luna (Iluminación): brillo del disco, su glow/halo e intensidad de su luz
    var dbgMoonGlow = document.getElementById('dbgMoonGlow');
    dbgMoonGlow.addEventListener('input', function () { moonGlow = parseInt(dbgMoonGlow.value, 10) / 100; document.getElementById('dbgMoonGlowVal').textContent = dbgMoonGlow.value + ' %'; });
    // calibración en vivo (Iluminación): intensidad del rebote del suelo,
    // fuerza de su tinte derivado del césped y sol directo SOLO sobre el
    // cemento — Guille prueba y anota; sus valores pasan a ser el default
    var dbgBounceGain = document.getElementById('dbgBounceGain');
    dbgBounceGain.addEventListener('input', function () { BOUNCE_CTL.gain = parseInt(dbgBounceGain.value, 10) / 100; document.getElementById('dbgBounceGainVal').textContent = dbgBounceGain.value + ' %'; });
    var dbgTintForce = document.getElementById('dbgTintForce');
    dbgTintForce.addEventListener('input', function () { BOUNCE_CTL.tintForce = parseInt(dbgTintForce.value, 10) / 100; document.getElementById('dbgTintForceVal').textContent = dbgTintForce.value + ' %'; });
    var dbgStoneSun = document.getElementById('dbgStoneSun');
    dbgStoneSun.addEventListener('input', function () { STONE_SUN_U.value = parseInt(dbgStoneSun.value, 10) / 100; document.getElementById('dbgStoneSunVal').textContent = dbgStoneSun.value + ' %'; });
    // luz interior (v59): escala el factor de abertura de la puerta que
    // atenúa la difusa dentro del panteón (materials.js, INT_U) —
    // 100 % = el factor físico del ángulo sólido; 0 % = interior a oscuras
    var dbgInterior = document.getElementById('dbgInterior');
    dbgInterior.addEventListener('input', function () { INT_U.uInterior.value = parseInt(dbgInterior.value, 10) / 100; document.getElementById('dbgInteriorVal').textContent = dbgInterior.value + ' %'; });
    // movimiento: velocidades y noclip
    var dbgWalk = document.getElementById('dbgWalk'), dbgRun = document.getElementById('dbgRun');
    dbgWalk.addEventListener('input', function () { SETTINGS.walkSpeed = parseFloat(dbgWalk.value); document.getElementById('dbgWalkVal').textContent = SETTINGS.walkSpeed.toFixed(1) + ' m/s'; });
    dbgRun.addEventListener('input', function () { SETTINGS.runSpeed = parseFloat(dbgRun.value); document.getElementById('dbgRunVal').textContent = SETTINGS.runSpeed.toFixed(1) + ' m/s'; });
    function setNoclip(on) {
      SETTINGS.noclip = on;
      playerBody.collisionResponse = on ? 0 : 1;
      world.gravity.set(0, on ? 0 : -9.82, 0);
      playerBody.velocity.set(0, 0, 0);
      if (!on && playerBody.position.y < 0.36) playerBody.position.y = 0.36;
      var bn = document.getElementById('btnNoclip'); // el botón de la UI general (v70) refleja el mismo estado que la tecla N y la casilla del DEBUG
      if (bn) { bn.textContent = on ? 'NOCLIP · SÍ' : 'NOCLIP · NO'; bn.classList.toggle('on', on); bn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    }
    var btnNoclipEl = document.getElementById('btnNoclip');
    if (btnNoclipEl) btnNoclipEl.addEventListener('click', function () { toggleNoclip(); });
    document.getElementById('dbgNoclip').addEventListener('change', function () { setNoclip(this.checked); });
    function toggleNoclip() { // tecla N (player.js): alterna y sincroniza la casilla del DEBUG
      var on = !SETTINGS.noclip;
      document.getElementById('dbgNoclip').checked = on;
      setNoclip(on);
    }
    // NUBE DE PRUEBA: una nube frente al sol o la luna para probar la
    // oclusión a demanda (parcial → total → parcial), con la misma ley
    // T = exp(−τ) de las nubes reales; TESTC vive en weather.js
    var dbgTestPos = document.getElementById('dbgTestPos'), dbgTestTau = document.getElementById('dbgTestTau');
    document.getElementById('dbgTestOn').addEventListener('change', function () { TESTC.on = this.checked; });
    document.getElementById('dbgTestSweep').addEventListener('change', function () { TESTC.sweep = this.checked; });
    var tcBtns = document.querySelectorAll('.wbtn.tcloud');
    tcBtns.forEach(function (btn) { btn.addEventListener('click', function () { TESTC.target = btn.getAttribute('data-tc'); tcBtns.forEach(function (x) { x.classList.toggle('on', x === btn); }); }); });
    dbgTestPos.addEventListener('input', function () { TESTC.pos = parseFloat(dbgTestPos.value); document.getElementById('dbgTestPosVal').textContent = dbgTestPos.value + ' %'; });
    dbgTestTau.addEventListener('input', function () { TESTC.tau = parseFloat(dbgTestTau.value); document.getElementById('dbgTestTauVal').textContent = TESTC.tau.toFixed(1).replace('.', ','); });
    var dbgTestSize = document.getElementById('dbgTestSize');
    dbgTestSize.addEventListener('input', function () { TESTC.size = parseInt(dbgTestSize.value, 10) / 100; document.getElementById('dbgTestSizeVal').textContent = dbgTestSize.value + ' %'; });
    // día del año: la época orbital (distancia, tamaño e irradiancia del
    // sol, declinación y duración del día salen de ORBIT, weather.js)
    var dbgDayOfYear = document.getElementById('dbgDayOfYear');
    dbgDayOfYear.addEventListener('input', function () { ORBIT.dayOfYear = parseInt(dbgDayOfYear.value, 10); document.getElementById('dbgDayVal').textContent = orbitDateLabel(ORBIT.dayOfYear); wxManual = true; });
    // TEMPERATURA DEL DÍA: slider + caja de texto. Mover cualquiera de
    // los dos FIJA la temperatura (la lee toda la simulación: modelo,
    // evaporación, superficies, calima) y la MANTIENE: como todo
    // control de clima del panel, detiene el clima vivo (wxManual) y
    // suelta la automática. La versión anterior guardaba un offset
    // que decaía en ~45 s y no detenía el clima vivo: la temperatura
    // puesta a mano se escurría de vuelta a la automática en menos
    // de un minuto y probar cualquier efecto térmico (calor,
    // evaporación) era imposible — el fallo que reportó el usuario.
    // El botón Automática la suelta y vuelve a regularse sola
    // (climatología + hora + nubosidad). El control siempre MUESTRA
    // la temperatura vigente, manual o auto.
    var dbgTempDay = document.getElementById('dbgTempDay'), dbgTempBox = document.getElementById('dbgTempBox'), dbgTempState = document.getElementById('dbgTempState');
    function setTempOverride(v) {
      v = clamp(parseFloat(v), -10, 40);
      if (!isFinite(v)) return;
      TEMP_DAY.auto = false; TEMP_DAY.offset = null;
      SIM_IN.T = v; SIM_GOAL.T = v;
      wxManual = true; // ajuste manual de clima: el clima vivo se detiene, como con nubosidad, niebla u hora
    }
    dbgTempDay.addEventListener('input', function () { setTempOverride(parseFloat(dbgTempDay.value)); });
    dbgTempBox.addEventListener('change', function () { setTempOverride(parseFloat(dbgTempBox.value)); });
    document.getElementById('dbgTempAuto').addEventListener('click', function () { TEMP_DAY.offset = null; TEMP_DAY.auto = true; });
    setInterval(function () {
      var tv = SIM_IN.T;
      if (document.activeElement !== dbgTempDay) dbgTempDay.value = tv;
      if (document.activeElement !== dbgTempBox) dbgTempBox.value = tv.toFixed(1);
      dbgTempState.textContent = (TEMP_DAY.offset != null ? 'Manual → auto' : (TEMP_DAY.auto ? 'Automática' : 'Manual')) + ' · ' + tv.toFixed(1).replace('.', ',') + ' °C';
    }, 400);
    // BASE DE NUBE: mismo patrón que la temperatura del día. Mover el
    // slider FIJA la base (la leen el tope convectivo, la niebla por
    // estrato y la altura del deck volumétrico); el botón Automática
    // la devuelve a la derivada del modelo (LCL = 125·(T−Td)). El
    // control siempre MUESTRA la base vigente, manual o automática.
    var dbgBase = document.getElementById('dbgBase'), dbgBaseState = document.getElementById('dbgBaseState');
    dbgBase.addEventListener('input', function () { BASE_OVR.auto = false; BASE_OVR.m = parseInt(dbgBase.value, 10); wxManual = true; });
    document.getElementById('dbgBaseAuto').addEventListener('click', function () { BASE_OVR.auto = true; });
    setInterval(function () {
      if (document.activeElement !== dbgBase) dbgBase.value = Math.round(clamp(SIM.base, 100, 3000));
      dbgBaseState.textContent = (BASE_OVR.auto ? 'Automática' : 'Manual') + ' · ' + Math.round(SIM.base) + ' m';
    }, 400);
    // DENSIDAD DE NUBE (τ): mismo patrón — mover el slider FIJA τ
    // (escala logarítmica 0,1–30: el rango físico de cirro a nimbo) y
    // la etiqueta dice «Manual» hasta pulsar Automática o RESETEAR.
    // El control muestra siempre el τ vigente: en Automática, el de
    // referencia del tipo de nube actual (σ·2,2).
    var dbgTau = document.getElementById('dbgTau'), dbgTauState = document.getElementById('dbgTauState');
    function tauFromSlider(v) { return 0.1 * Math.pow(10, v * 0.02477); }
    function tauToSlider(tau) { return Math.round(clamp(Math.log10(Math.max(tau, 0.1) / 0.1) / 0.02477, 0, 100)); }
    dbgTau.addEventListener('input', function () { TAU_OVR.auto = false; TAU_OVR.tau = tauFromSlider(parseInt(dbgTau.value, 10)); wxManual = true; });
    document.getElementById('dbgTauAuto').addEventListener('click', function () { TAU_OVR.auto = true; });
    setInterval(function () {
      var tauNow = TAU_OVR.auto ? Math.max(cloudType.sigma * 2.2, 0.05) : TAU_OVR.tau;
      if (document.activeElement !== dbgTau) dbgTau.value = tauToSlider(tauNow);
      dbgTauState.textContent = (TAU_OVR.auto ? 'Automática' : 'Manual') + ' · τ ' + tauNow.toFixed(1).replace('.', ',');
    }, 400);
    /* RESETEAR: vuelve TODAS las variables del panel a sus valores de
       recién cargado — ajustes de mundo, estación, clima (con el clima
       vivo reactivado, como al entrar), hora, luna, brillos, viento,
       velocidades, noclip, nubes 3D y hasta la humedad acumulada en las
       superficies — sin recargar la página ni cerrar el panel. */
    function resetDebug() {
      // mundo y vegetación
      SETTINGS.density = 0.1; SETTINGS.kinds = [true, true, true, true, true]; SETTINGS.mausoleum = true;
      SETTINGS.grass = 0; SETTINGS.trees = 0;
      dbgDensity.value = 10; dbgDensityVal.textContent = '10 %';
      for (var ri = 0; ri < 5; ri++) document.getElementById('dbgK' + ri).checked = true;
      document.getElementById('dbgMaus').checked = true;
      dbgGrass.value = 0; document.getElementById('dbgGrassVal').textContent = '0 %';
      dbgTrees.value = 0; document.getElementById('dbgTreesVal').textContent = '0 %';
      setSeason('primavera'); // la estación de recién cargado (también restaura el día del año 288 vía ORBIT)
      // clima: preset soleado (fija ENV y las 4 del modelo físico) y
      // después el clima vivo vuelve a mandar, como en una carga nueva
      setWxPreset('sunny');
      envCur.cloud = 0; envCur.fog = 0; envCur.rain = 0; envCur.storm = 0; envCur.sun = 2.9; envCur.hemi = 0.85; envCur.exp = 0.78;
      setCloudTypeMode('auto');
      windMult = 1; dbgWind.value = 100; document.getElementById('dbgWindVal').textContent = '100 %';
      windBaseAng = 3.927; dbgWindDir.value = 225; document.getElementById('dbgWindDirVal').textContent = '225°';
      cloudSpeedMult = 0.5; dbgCloudSpd.value = 50; document.getElementById('dbgCloudSpdVal').textContent = '50 %';
      // iluminación
      setHour(11.5, false);
      setMoonPhase('auto');
      sunGlow = 1; dbgSun.value = 100; document.getElementById('dbgSunVal').textContent = '100 %';
      moonGlow = 1; dbgMoonGlow.value = 100; document.getElementById('dbgMoonGlowVal').textContent = '100 %';
      BOUNCE_CTL.gain = 0; dbgBounceGain.value = 0; document.getElementById('dbgBounceGainVal').textContent = '0 %';
      BOUNCE_CTL.tintForce = 1; dbgTintForce.value = 100; document.getElementById('dbgTintForceVal').textContent = '100 %';
      STONE_SUN_U.value = 1.5; dbgStoneSun.value = 150; document.getElementById('dbgStoneSunVal').textContent = '150 %';
      INT_U.uInterior.value = 1; dbgInterior.value = 100; document.getElementById('dbgInteriorVal').textContent = '100 %';
      // jugador y rendimiento
      SETTINGS.walkSpeed = 5.2; dbgWalk.value = 5.2; document.getElementById('dbgWalkVal').textContent = '5.2 m/s';
      SETTINGS.runSpeed = 7.8; dbgRun.value = 7.8; document.getElementById('dbgRunVal').textContent = '7.8 m/s';
      document.getElementById('dbgNoclip').checked = false; setNoclip(false);
      // nube de prueba apagada y en su sitio, como recién cargado
      TESTC.on = false; TESTC.target = 'sun'; TESTC.pos = 0; TESTC.tau = 3.0; TESTC.size = 1; TESTC.sweep = false; TESTC.sweepDir = 1;
      document.getElementById('dbgTestOn').checked = false; document.getElementById('dbgTestSweep').checked = false;
      tcBtns.forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tc') === 'sun'); });
      dbgTestPos.value = 0; document.getElementById('dbgTestPosVal').textContent = '0 %';
      dbgTestTau.value = 3; document.getElementById('dbgTestTauVal').textContent = '3,0';
      dbgTestSize.value = 100; document.getElementById('dbgTestSizeVal').textContent = '100 %';
      // humedad acumulada: todo seco, como recién cargado
      for (var rk in WET) {
        var rs = WET[rk];
        if (rs && typeof rs === 'object') { rs.W = 0; rs.G = 0; if ('D' in rs) rs.D = 0; }
      }
      WET.I = 0; WET.shoe = 0;
      fpData.fill(0); fpTex.needsUpdate = true;
      // temperatura del día como recién cargado: automática, sin override
      TEMP_DAY.offset = null; TEMP_DAY.auto = true;
      // base de nube como recién cargado: automática (la del modelo)
      BASE_OVR.auto = true;
      // densidad de nube (τ) como recién cargado: automática
      TAU_OVR.auto = true;
      // buscador limpio y clima vivo reactivado (lo último: setWxPreset
      // y setHour lo dejan fijo a mano, como cualquier ajuste manual)
      dbgSearchEl.value = ''; applyDbgFilter();
      dbgPresetKey = ''; if (dbgPreset) dbgPreset.value = ''; // ningún preset de escenario vigente tras resetear
      wxManual = false; wxMood = 0.05; wxTimer = 300;
      wxGoal.cloud = 0; wxGoal.fog = 0; wxGoal.rain = 0; wxGoal.storm = 0; wxGoal.sun = 2.9; wxGoal.hemi = 0.85; wxGoal.exp = 0.78;
      scheduleRegen(true);
    }
    document.getElementById('btnReset').addEventListener('click', resetDebug);
    /* DRENAR SUELO: quita SOLO el agua — charcos (D), saturación (W) y
       película (G) de todas las superficies (suelo, senderos, piedra de
       las tumbas, madera, césped, hierro), la intercepción del césped,
       la humedad de las suelas y las huellas mojadas. No toca ninguna
       otra variable: clima, hora, nubosidad y el resto del panel quedan
       exactamente como están. Los uniforms UW se reescriben solos desde
       WET en el próximo updateWet. */
    function drainSoil() {
      for (var dk2 in WET) {
        var ds = WET[dk2];
        if (ds && typeof ds === 'object') { ds.W = 0; ds.G = 0; if ('D' in ds) ds.D = 0; }
      }
      WET.I = 0; WET.shoe = 0;
      fpData.fill(0); fpTex.needsUpdate = true;
    }
    document.getElementById('btnDrain').addEventListener('click', drainSoil);
    // asa de verificación: permite comprobar hora, niebla, luz y linterna en vivo
    window.__game = {
      reset: resetDebug, drainSoil: drainSoil,
      setFlash: setFlash, setHour: setHour, setWx: setWxPreset, setClimatePreset: applyClimatePreset, setMoon: setMoonPhase, setSeason: setSeason,
      setFog: function (v) { ENV.fog = v; wxGoal.fog = v; dbgFog.value = Math.round(v * 100); dbgFogVal.textContent = dbgFog.value + ' %'; },
      setCloud: function (v) { ENV.cloud = v; wxGoal.cloud = v; dbgCloud.value = Math.round(v * 100); dbgCloudVal.textContent = dbgCloud.value + ' %'; },
      toggleNoclip: toggleNoclip,
      setCloudType: function (mode) { setCloudTypeMode(mode); },
      setTestCloud: function (o) { if (!o) return; if ('on' in o) { TESTC.on = !!o.on; document.getElementById('dbgTestOn').checked = TESTC.on; } if ('target' in o) { TESTC.target = o.target; tcBtns.forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tc') === TESTC.target); }); } if ('pos' in o) { TESTC.pos = o.pos; dbgTestPos.value = o.pos; document.getElementById('dbgTestPosVal').textContent = Math.round(o.pos) + ' %'; } if ('tau' in o) { TESTC.tau = o.tau; dbgTestTau.value = o.tau; document.getElementById('dbgTestTauVal').textContent = TESTC.tau.toFixed(1).replace('.', ','); } if ('size' in o) { TESTC.size = o.size; dbgTestSize.value = Math.round(o.size * 100); document.getElementById('dbgTestSizeVal').textContent = Math.round(o.size * 100) + ' %'; } if ('sweep' in o) { TESTC.sweep = !!o.sweep; document.getElementById('dbgTestSweep').checked = TESTC.sweep; } },
      setDayOfYear: function (n) { ORBIT.dayOfYear = clamp(Math.round(n), 1, 365); dbgDayOfYear.value = ORBIT.dayOfYear; document.getElementById('dbgDayVal').textContent = orbitDateLabel(ORBIT.dayOfYear); },
      setSim: function (T, RH, CAPE, U) { wxManual = true; simSetInputs(T, RH, CAPE, U, true); },
      setTempDay: function (v) { setTempOverride(v); },
      setBase: function (m) { if (m == null) { BASE_OVR.auto = true; } else { BASE_OVR.auto = false; BASE_OVR.m = clamp(Math.round(m), 100, 3000); wxManual = true; } },
      setTau: function (tau) { if (tau == null) { TAU_OVR.auto = true; } else { TAU_OVR.auto = false; TAU_OVR.tau = clamp(tau, 0.1, 30); wxManual = true; } },
      simState: function () {
        return {
          T: SIM_IN.T, RH: SIM_IN.RH, CAPE: SIM_IN.CAPE, U: SIM_IN.U, Td: SIM.Td,
          type: SIM.typeLabel, base: SIM.base, top: SIM.top, topTemp: SIM.topTemp,
          lwcPeak: SIM.lwcPeak, lwcMean: SIM.lwcMean, lwp: SIM.lwp, tau: SIM.tau,
          rainRate: SIM.rainRate, rainCat: SIM.rainCat, fallSpeed: SIM.fallSpeed, fEvap: SIM.fEvap, virga: SIM.virga,
          flashTotal: SIM.flashTotal, flashCG: SIM.flashCG, nextFlashIn: SIM.nextFlashIn,
          wUp: SIM.wUp, gustPeak: SIM.gustPeak, beaufort: SIM.beaufort, visibility: SIM.visibility, visRain: SIM.visRain, rainBeta: SIM.rainBeta,
          verdict: SIM.verdict, warnings: SIM.warnings
        };
      },
      teleport: function (x, z) { playerBody.position.set(x, 0.36, z); playerBody.velocity.set(0, 0, 0); },
      setLook: function (y, p) { yaw = y; pitch = p; },
      nearestTomb: function () {
        var px = playerBody.position.x, pz = playerBody.position.z, bd = 1e9, bt = null;
        for (var k in chunks) for (var i = 0; i < chunks[k].tombs.length; i++) {
          var t = chunks[k].tombs[i], d = Math.hypot(t.x - px, t.z - pz);
          if (d < bd) { bd = d; bt = t; }
        }
        return bt ? { x: bt.x, z: bt.z, d: bd, plaqueIdx: bt.plaqueIdx } : null;
      },
      state: function () {
        return {
          name: document.title, hour: ENV.hour, elev: worldLight.elev, dayF: worldLight.dayF,
          ambient: worldLight.ambient, fog: scene.fog ? '#' + scene.fog.color.getHexString() : 'none',
          fogRGB: scene.fog ? [scene.fog.color.r, scene.fog.color.g, scene.fog.color.b] : null,
          fogTarget: ENV.fog, fogCur: envCur.fog, clearAir: clearAir, loadR: LOAD_R,
          sunIntensity: sun.intensity, hemiIntensity: hemi.intensity,
          moonMode: MOON.mode, moonPhase: MOON.name, moonP: MOON.p, moonAge: MOON.age,
          moonIllum: MOON.illum, moonElev: MOON.elev, moonVisible: moonSprite.visible,
          moonOpacity: moonSprite.material.opacity, moonLight: (worldLight.elev <= 1.2 ? sun.intensity : 0),
          cloudTarget: ENV.cloud, cloudCur: envCur.cloud,
          simType: SIM.typeLabel, simRainRate: SIM.rainRate, simFlash: SIM.flashTotal, simTop: SIM.top, simTau: SIM.tau, simGust: SIM.gustPeak,
          moonTrans: moonTransSm, moonDiscTrans: moonDiscTrans, moonLux: moonLuxNow,
          sunTrans: sunTransSm, sunTau: sunTau, cloudType: cloudType.label, cloudTypeMode: cloudTypeMode,
          wetPathW: WET.path.W, wetPathG: WET.path.G, wetPathD: WET.path.D,
          wetGroundW: WET.ground.W, wetGroundG: WET.ground.G, wetGroundD: WET.ground.D,
          wetStoneW: WET.stone.W, wetStoneG: WET.stone.G, wetGrassW: WET.grass.W, wetShoe: WET.shoe,
          wetSkyRefl: [UW.sky.value.r, UW.sky.value.g, UW.sky.value.b],
          testCloud: TESTC.on ? TESTC.target + '@' + Math.round(TESTC.pos) + '/tau' + TESTC.tau : 'off',
          testCloudSize: TESTC.size, testShadow: [Math.round(cloudShadowVecs[0].x), Math.round(cloudShadowVecs[0].y), Math.round(cloudShadowVecs[0].z), +cloudShadowVecs[0].w.toFixed(2)], testShadowElong: +cloudShadowPar[0].x.toFixed(2), testShadowPen: +cloudShadowPar[0].y.toFixed(2), dayOfYear: ORBIT.dayOfYear, sunDistKm: Math.round(ORBIT.rKm), sunThetaArcmin: ORBIT.thetaArcmin, sunIrradiance: Math.round(ORBIT.irradiance), orbitE0: ORBIT.E0,
          declDeg: ORBIT.declDeg, noonAltDeg: ORBIT.noonAltDeg, dayLengthH: ORBIT.dayLengthH, sunriseH: ORBIT.sunriseH, sunsetH: ORBIT.sunsetH, eotMin: ORBIT.eotMin,
          moonDistKm: Math.round(MOONORB.distKm), moonThetaArcmin: MOONORB.thetaArcmin, linkeTL: AIRTL, ktIndex: KT_NOW, perezF1: PEREZ_F1, perezF2: PEREZ_F2,
          tempNow: SIM_IN.T, tempOverride: TEMP_DAY.offset != null ? SIM_IN.T : null, tempOffset: TEMP_DAY.offset, tempAuto: TEMP_DAY.auto, surfTPath: SURF.path, surfTStone: SURF.stone, surfTGround: SURF.ground, hazeF: HAZE.f, mirageF: HAZE.mirage, evapET0: EVAP.et0, evapPuddle: EVAP.puddle, evapRn: EVAP.rn, purkS: PURK.s, adaptLa: PURK.La, purkOk: PURK_OK,
          climatePreset: dbgPresetKey, scrollLock: debugPanel.classList.contains('scrolling'),
          fogDerived: (typeof FOG_DERIVED !== 'undefined' ? FOG_DERIVED : 0), fogFrontal: (typeof FOG_FRONTAL !== 'undefined' ? FOG_FRONTAL : 0), precipF: (typeof PRECIP_F !== 'undefined' ? PRECIP_F : 0), precipCur: (typeof precipCur !== 'undefined' ? precipCur : 0), fogDensity: scene.fog ? fogObj.density : 0, cloudBase: SIM.base, cloudBaseAuto: BASE_OVR.auto, tauOvr: TAU_OVR.auto ? null : TAU_OVR.tau, tauAutoRef: cloudType.sigma * 2.2, moonSilver: sky.material.uniforms.uMoonSilver ? sky.material.uniforms.uMoonSilver.value : -1, rainKind: rainPts ? 'quads' : 'none', crouch: (typeof crouchF !== 'undefined' ? +crouchF.toFixed(2) : 0), testRays: sky.material.uniforms.uTestRays ? sky.material.uniforms.uTestRays.value : -1,
          chromaSun: [chromaSun.r, chromaSun.g, chromaSun.b], chromaMoon: [chromaMoon.r, chromaMoon.g, chromaMoon.b],
          occCase: occCase, diffuseFrac: diffuseFrac, bounceLevel: +bounceLevel.toFixed(3), bounceTint: [+bounceTint[0].toFixed(2), +bounceTint[1].toFixed(2), +bounceTint[2].toFixed(2)], rhoGround: +rhoGroundNow.toFixed(3), bounceGain: BOUNCE_CTL.gain, tintForce: BOUNCE_CTL.tintForce, stoneSun: STONE_SUN_U.value, interiorGain: INT_U.uInterior.value, cloudOcc: occSmooth, rainEff: rainEff,
          beamOn: (typeof BEAM !== 'undefined') ? BEAM.on : false, beamI: (typeof BEAM !== 'undefined') ? +BEAM.I.toFixed(3) : 0, beamGlass: (typeof BEAM !== 'undefined') ? BEAM.glass : null, beamRecv: (typeof BEAM !== 'undefined') ? BEAM.recv : '',
          skyRays: sky.material.uniforms.uRays ? sky.material.uniforms.uRays.value : -1,
          skySigma: sky.material.uniforms.uCloudSigma ? sky.material.uniforms.uCloudSigma.value : -1,
          cloudBillow: sky.material.uniforms.uCBillow ? +sky.material.uniforms.uCBillow.value.toFixed(2) : -1, cloudStretch: sky.material.uniforms.uCStretch ? +sky.material.uniforms.uCStretch.value.toFixed(2) : -1,
          windSpeed: WIND.speed,
          sunVisible: sunSprite.visible, sunOpacity: sunSprite.material.opacity,
          starsVisible: starPts ? starPts.visible : false, starsOpacity: starPts ? (starPts.material.uniforms ? starPts.material.uniforms.uOpacity.value : starPts.material.opacity) : 0,
          shaderFallbacks: shaderFallbackCount,
          assetBase: ASSET_BASE,
          season: season, seasonDryMix: SEASON_DRY_U.value,
          grassDensity: SETTINGS.grass, treeDensity: SETTINGS.trees, windMult: windMult, windDirDeg: Math.round(windBaseAng * 180 / Math.PI),
          cloudSpeedMult: cloudSpeedMult, cloudShadowAmt: CLOUD_AMT_U.value,
          sunGlow: sunGlow, moonGlow: moonGlow, figureVisible: playerFigure.visible, figureShadow: figLegL.children[0].castShadow,
          figureModel: figModel ? 'xbot' : 'procedural', figureState: figState,
          skyTurbidity: sky.material.uniforms.turbidity.value, skyRayleigh: sky.material.uniforms.rayleigh.value, skyMie: sky.material.uniforms.mieCoefficient.value,
          skyCloudCoverage: sky.material.uniforms.cloudCoverage ? sky.material.uniforms.cloudCoverage.value : -1,
          wxMood: wxMood, wxGoalCloud: wxGoal.cloud, wxGoalFog: wxGoal.fog, wxGoalRain: wxGoal.rain, wxGoalStorm: wxGoal.storm,
          windDir: [WIND.dirX, WIND.dirZ],
          pointerLocked: !!document.pointerLockElement, hasFinePointer: hasFinePointer,
          drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
          chunksFar: (function () { var n = 0; for (var k4 in chunks) if (chunks[k4].lodFar) n++; return n; })(),
          chunksTotal: (function () { var n = 0; for (var k5 in chunks) n++; return n; })(),
          cypressReady: (typeof CYPRESS !== 'undefined' && CYPRESS.ready), pixelRatio: renderer.getPixelRatio(),
          fpsNow: elFpsNow.textContent, fpsAvg: elFpsAvg.textContent,
          heightFog: HEIGHT_FOG_U.value, skyPatched: skyPatchOk, rainbow: sky.material.uniforms.uRainbow ? +sky.material.uniforms.uRainbow.value.toFixed(3) : -1,
          skyFogBlend: skyPatchOk ? sky.material.uniforms.uFogBlend.value : -1,
          surfaceNow: surfaceAt(playerBody.position.x, playerBody.position.z), lastSurface: lastSurface,
          walkSpeed: SETTINGS.walkSpeed, gazeBarHidden: (function () { var g = document.getElementById('gaze'); return g ? getComputedStyle(g).display === 'none' : null; })(),
          startButtons: (function () { var a = document.getElementById('btnStart'), b2 = document.getElementById('btnHelp'); return (a ? a.textContent : '') + '|' + (b2 ? b2.textContent : ''); })(),
          flashOn: flashOn, flashIntensity: flashlight.intensity,
          plaqueShown: plaqueCard.classList.contains('show'), plaqueDark: plaqueCard.classList.contains('dark'),
          gazeT: gazeT, gazeRevealed: gazeRevealed, gazeKey: gazeKey, gazeFaceDot: gazeFaceDot,
          plaqueName: elName.textContent, readCount: readCount
        };
      }
    };
