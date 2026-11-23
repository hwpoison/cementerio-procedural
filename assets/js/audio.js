/* audio.js — Audio: ambiente DINÁMICO por capas WebAudio (v71, pila
   del informe sonido-ambiental-dinamico §4), pasos sobre hierba y
   tierra según la superficie, y truenos con retardo por distancia.
   Depende de: world (retícula de senderos), weather (SIM, WIND,
   ORBIT, worldLight). */
'use strict';
    var btnSound = document.getElementById('btnSound');
    btnSound.addEventListener('click', function () {
      soundOn = !soundOn;
      btnSound.textContent = soundOn ? 'SONIDO · SÍ' : 'SONIDO · NO';
      if (ambCtx && ambMaster) ambMaster.gain.setTargetAtTime(soundOn ? 0.8 : 0, ambCtx.currentTime, 0.15); // el bus maestro es la única perilla del botón: las capas siguen vivas por debajo
    });

    /* ================= Pasos y truenos (grabaciones reales) ================= */
    function looseAudio(name) {
      var a = new Audio(); a.preload = 'auto';
      var s1 = document.createElement('source'); s1.src = assetUrl(name + '.ogg'); s1.type = 'audio/ogg';
      var s2 = document.createElement('source'); s2.src = assetUrl(name + '.mp3'); s2.type = 'audio/mpeg';
      a.appendChild(s1); a.appendChild(s2);
      return a;
    }
    var thunderAudios = [looseAudio('thunder1'), looseAudio('thunder2')];
    /* El retardo ya lo pone weather.js (distancia/343, ~3 s por km,
       como manda el informe); aquí la distancia además OSCURECE el
       trueno: el aire se come los agudos del camino, así que un rayo
       lejano es solo retumbo — playbackRate bajo = espectro corrido
       a graves sobre la misma grabación (0,66 a 3 km, ~0,95 al lado). */
    function playThunder(vol, distKm) {
      if (!soundOn) return;
      var a = thunderAudios[Math.floor(Math.random() * thunderAudios.length)];
      var dk = (typeof distKm === 'number') ? distKm : 1;
      try { a.pause(); a.currentTime = 0; a.volume = clamp(vol, 0.1, 1); a.playbackRate = clamp(1.02 - dk * 0.11, 0.66, 1.0) * (0.94 + Math.random() * 0.10); var pr = a.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
    var stepGrass = [looseAudio('step_g1'), looseAudio('step_g2'), looseAudio('step_g3'), looseAudio('step_g4')];
    var stepDirt = [looseAudio('step_d1'), looseAudio('step_d2'), looseAudio('step_d3'), looseAudio('step_d4')];
    var lastStepIdx = -1, stepCycle = 0;
    /* Material REAL bajo cada pie, detectado en cada paso:
       1) rectángulos pisables que cada chunk declara al construirse
          (surfaces en world.js): losas de fosa, suelo y escalón del
          panteón y pedestal del ángel = piedra; explanada ante la
          puerta del panteón = grava.
       2) el cruce de senderos (donde se cruzan las dos franjas de la
          retícula) = grava pisada; el resto del sendero = tierra.
       3) todo lo demás = hierba. */
    function surfaceAt(x, z) {
      var pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = chunks[keyOf(pcx + dx, pcz + dz)];
        if (!ch || !ch.surfaces) continue;
        for (var i = 0; i < ch.surfaces.length; i++) {
          var s = ch.surfaces[i];
          var vx = x - s.x, vz = z - s.z, c = Math.cos(s.ry), sn = Math.sin(s.ry);
          var lx = vx * c - vz * sn, lz = vx * sn + vz * c;
          if (Math.abs(lx) <= s.hw && Math.abs(lz) <= s.hd) return s.type;
        }
      }
      var mx = Math.abs(((x % CHUNK) + CHUNK) % CHUNK); mx = Math.min(mx, CHUNK - mx);
      var mz = Math.abs(((z % CHUNK) + CHUNK) % CHUNK); mz = Math.min(mz, CHUNK - mz);
      if (mx < 1.9 && mz < 1.9) return 'gravel';
      if (mx < 1.9 || mz < 1.9) return 'dirt';
      return 'grass';
    }
    function onPathAt(x, z) { return surfaceAt(x, z) === 'dirt'; }
    /* Piedra y grava no tienen grabación en el paquete: se sintetizan con
       WebAudio en el momento del paso — la piedra es un chasquido duro y
       seco con golpe sordo; la grava, un racimo de crujidos cortos y
       desplazados, como piedrecillas que se mueven bajo la suela. */
    var stepCtx = null, noiseBuf = null;
    function ensureStepCtx() {
      if (stepCtx) { if (stepCtx.state === 'suspended') stepCtx.resume(); return stepCtx; }
      try {
        stepCtx = new (window.AudioContext || window.webkitAudioContext)();
        var len = Math.floor(stepCtx.sampleRate * 0.5);
        noiseBuf = stepCtx.createBuffer(1, len, stepCtx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { stepCtx = null; }
      return stepCtx;
    }
    function synthStep(type, running) {
      var ctx = ensureStepCtx();
      if (!ctx || !noiseBuf) return;
      var t0 = ctx.currentTime + 0.01, vol = running ? 0.5 : 0.38;
      function burst(when, dur, freq, q, gain) {
        var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.9 + Math.random() * 0.2;
        var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0011), when + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(f); f.connect(g); g.connect(ctx.destination);
        src.start(when, Math.random() * 0.3, dur + 0.05); src.stop(when + dur + 0.06);
      }
      function thump(when, freq, gain, dur) {
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(freq, when);
        o.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.55, 30), when + dur);
        var g = ctx.createGain();
        g.gain.setValueAtTime(gain, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(when); o.stop(when + dur + 0.02);
      }
      if (type === 'stone') {
        burst(t0, 0.07, 2100, 1.1, vol * 0.8);
        thump(t0, 130, vol * 0.5, 0.09);
      } else {
        var n = 3 + Math.floor(Math.random() * 3);
        for (var i = 0; i < n; i++) burst(t0 + i * (0.018 + Math.random() * 0.02), 0.045, 800 + Math.random() * 1700, 2.2, vol * (0.34 + Math.random() * 0.3));
        thump(t0, 95, vol * 0.28, 0.07);
      }
    }
    function playStep(surface, running) {
      if (!soundOn) return;
      if (surface === 'stone' || surface === 'gravel') { synthStep(surface, running); return; }
      var pool = surface === 'dirt' ? stepDirt : stepGrass, n = Math.floor(Math.random() * pool.length);
      if (n === lastStepIdx) n = (n + 1) % pool.length;
      lastStepIdx = n;
      var a = pool[n];
      try { a.pause(); a.currentTime = 0; a.volume = (running ? 0.55 : 0.42) + Math.random() * 0.14; a.playbackRate = 0.92 + Math.random() * 0.16; var pr = a.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }

    /* ================= SONIDOS DE PUERTA (v72) =================
       Pedido de Guille (20:42): que se escuche la puerta al abrirse
       y también al INTENTAR abrir una sellada/bloqueada. Como los
       pasos de piedra y los grillos de la v71: síntesis WebAudio en
       el momento, 0 KB y sin licencia de por medio (las grabaciones
       CC0 de puertas quedaron tras los retos JS de las fuentes,
       igual que pasó con los grillos). Salen por el contexto de los
       pasos, directos a destino — son eventos del jugador, no
       ambiente: no pasan por el filtro de interior. Respetan el
       botón de sonido (soundOn), como todo.
       · ABRIR: la hoja de un panteón no gira suave — arranca con el
         chirrido de la bisagra (banda estrecha que cae de ~950 a
         ~520 Hz), roza el marco con un roce grave mientras gira
         (~0,7 s, lo que tickDoors tarda en llevarla a ~1,5 rad) y
         termina con el golpe sordo contra el tope.
       · BLOQUEADA: dos golpes secos contra la hoja — intento, pausa,
         intento — con el traqueteo corto de la manija entre ambos, y
         ningún giro: se entiende sin mirar la etiqueta SELLADA. */
    function doorBurst(ctx, when, dur, freq, q, gain, sweepTo) {
      var src = ctx.createBufferSource(); src.buffer = noiseBuf; src.playbackRate.value = 0.9 + Math.random() * 0.2;
      var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
      f.frequency.setValueAtTime(freq, when);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, when + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0011), when + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, when + dur);
      src.connect(f); f.connect(g); g.connect(ctx.destination);
      src.start(when, Math.random() * 0.3, dur + 0.05); src.stop(when + dur + 0.06);
    }
    function doorThump(ctx, when, freq, gain, dur) {
      var o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq, when);
      o.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.5, 28), when + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(gain, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(when); o.stop(when + dur + 0.02);
    }
    function playDoorOpen() {
      if (!soundOn) return;
      var ctx = ensureStepCtx(); if (!ctx || !noiseBuf) return;
      var t0 = ctx.currentTime + 0.01;
      doorBurst(ctx, t0, 0.55, 950, 9, 0.16, 520);        // chirrido de bisagra
      doorBurst(ctx, t0 + 0.05, 0.75, 210, 0.8, 0.20);    // roce grave del giro
      doorBurst(ctx, t0 + 0.30, 0.30, 640, 7, 0.07, 430); // segundo quejido, más corto
      doorThump(ctx, t0 + 0.74, 88, 0.30, 0.13);          // golpe contra el tope
    }
    function playDoorBlocked() {
      if (!soundOn) return;
      var ctx = ensureStepCtx(); if (!ctx || !noiseBuf) return;
      var t0 = ctx.currentTime + 0.01;
      doorThump(ctx, t0, 132, 0.34, 0.10);                // primer golpe contra la hoja
      doorBurst(ctx, t0, 0.05, 1900, 1.4, 0.14);
      for (var i = 0; i < 4; i++) doorBurst(ctx, t0 + 0.14 + i * 0.045, 0.03, 2500 + Math.random() * 900, 3.0, 0.08); // traqueteo de la manija
      doorThump(ctx, t0 + 0.38, 118, 0.30, 0.11);         // segundo intento
      doorBurst(ctx, t0 + 0.38, 0.05, 1700, 1.4, 0.12);
    }

    /* ================= AMBIENTE DINÁMICO POR CAPAS (v71) =================
       Pedido de Guille (20:17 + refinamiento 20:22): aplicar la pila
       del informe sonido-ambiental-dinamico §4 y que la noche tenga
       sus sonidos — grillos y demás — COMO SISTEMA DINÁMICO: las
       capas entran y salen por el estado del juego (hora, estación,
       viento, lluvia, interior) e incluye el SILENCIO como estado,
       con ratos reales sin eventos, no un loop constante.
       Arquitectura del informe, sin librerías: un AudioContext, un
       bus (filtro paso-bajo interior/exterior → ganancia maestra →
       compresor → destino) y capas que son UN nodo fuente en loop +
       UNA ganancia creados una sola vez; el estado solo mueve
       objetivos con setTargetAtTime cada 0,3 s (tau 1,5 s clima,
       3 s día/noche, 0,4 s interior). Capas:
       · VIENTO procedural (ruido marrón 3 s → paso-bajo 250–900 Hz
         según m/s, LFO de ráfagas compartido) — 0 KB, sin costura.
       · HOJAS procedural (ruido blanco → paso-banda 2,8 kHz, ∝
         viento², más en otoño) — 0 KB.
       · LLUVIA grabada (rain.ogg, el loop de siempre) por mm/h
         LOCALES del modelo climático (SIM.rainRate × rainLocalF).
       · PÁJAROS grabados (birds.ogg) por día × estación, con pico
         de amanecer en primavera/verano y ahogo por lluvia.
       · GRILLOS: el informe manda gastar archivo en ellos (la
         síntesis se nota), pero la fuente CC0 (Freesound) exige
         cuenta para descargar y no hubo acceso en este build: el
         coro va SINTETIZADO sample a sample en un buffer de 45 s
         (tres especies con portadoras 3,9/4,4/5,3 kHz, pulsos de
         45 ms en cantos de 3–5, tandas con pausas) y queda la
         ranura para cambiarlo por la grabación CC0 sin tocar el
         resto. A ganancia de coro lejano (≤0,26) y tras el filtro
         del bus cumple su papel.
       · ONE-SHOTS por temporizador (no loops): búho sintetizado de
         noche (dos ululatos senoidales graves, paneado, lejos),
         pájaro carpintero de día (ráfaga de golpecitos filtrados);
         se saltan con lluvia > 5 mm/h. Cuervo/perro lejanos quedan
         para cuando haya grabaciones CC0 descargables.
       · EL SILENCIO COMO ESTADO (refinamiento de Guille): el coro
         de grillos tiene una compuerta viva — canta 30–90 s, calla
         15–45 s — y de noche, sin coro, sin lluvia y con viento
         bajo, el ambiente cae al suelo del viento (0,05): silencio
         real entre eventos, no un colchón constante.
       · AGUA: el informe la ata a un arroyo cercano; este
         cementerio no tiene arroyo — sin capa (no se inventa).
       Interior: si el jugador está dentro de un panteón, el bus
       baja a 650 Hz y el maestro a 0,7, y pájaros/grillos se
       ahogan más (la misma ley del informe, un solo filtro). */
    var ambCtx = null, ambMaster = null, ambFilter = null, ambWindFilter = null;
    var ambL = {};
    var ambOn = false, ambTick = 0, ambIndoor = 0;
    var chorusOn = true, chorusTimer = 25, nextOneShot = 40;
    var ambWhiteBuf = null;
    function ambNoiseBuffer(sec, brown) {
      var len = Math.floor(ambCtx.sampleRate * sec), buf = ambCtx.createBuffer(1, len, ambCtx.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) { var w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.5; }
      return buf;
    }
    function ambCricketBuffer() {
      var sr = 22050, len = sr * 45, buf = ambCtx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      var rng = mulberry32(20261122);
      function species(carrier, gain) {
        var t = rng() * 2;
        while (t < 43.5) {
          var chirps = 3 + Math.floor(rng() * 4);
          for (var b = 0; b < chirps; b++) {
            var pulses = 3 + Math.floor(rng() * 3);
            for (var p = 0; p < pulses; p++) {
              var start = Math.floor(t * sr), plen = Math.floor(0.045 * sr);
              for (var i = 0; i < plen; i++) {
                var idx = start + i; if (idx >= len) break;
                d[idx] += Math.sin(2 * Math.PI * carrier * (idx / sr)) * Math.sin(Math.PI * i / plen) * gain;
              }
              t += 0.075;
            }
            t += 0.55 + rng() * 0.5;
          }
          t += 1.5 + rng() * 3.0; // pausa entre tandas: el coro respira y a ratos calla
        }
      }
      species(4400, 0.15); species(5300, 0.09); species(3900, 0.06);
      var peak = 0, i2;
      for (i2 = 0; i2 < len; i2++) peak = Math.max(peak, Math.abs(d[i2]));
      if (peak > 0.85) { var k = 0.85 / peak; for (i2 = 0; i2 < len; i2++) d[i2] *= k; }
      var fade = Math.floor(sr * 0.4); // la costura del loop se disimula con fundidos cortos en los extremos
      for (i2 = 0; i2 < fade; i2++) { var f2 = i2 / fade; d[i2] *= f2; d[len - 1 - i2] *= f2; }
      return buf;
    }
    function ambAddLayer() {
      var g = ambCtx.createGain(); g.gain.value = 0;
      g.connect(ambFilter);
      return { gain: g };
    }
    function ambLoopInto(layer, buf) {
      var src = ambCtx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.connect(layer.gain); src.start(0);
    }
    function ambLoadLayer(layer, file) {
      fetch(assetUrl(file)).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return ambCtx.decodeAudioData(ab); }).then(function (buf) { ambLoopInto(layer, buf); }).catch(function () { /* sin esa grabación, la capa queda muda: el resto del ambiente sigue */ });
    }
    function startAmbient() {
      if (ambOn) return;
      try { ambCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      ambOn = true;
      if (ambCtx.state === 'suspended') ambCtx.resume(); // dentro del gesto de arranque (clic en Empezar), como manda la política de autoplay
      ambFilter = ambCtx.createBiquadFilter(); ambFilter.type = 'lowpass'; ambFilter.frequency.value = 17000; ambFilter.Q.value = 0.7;
      ambMaster = ambCtx.createGain(); ambMaster.gain.value = soundOn ? 0.8 : 0;
      var comp = ambCtx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
      ambFilter.connect(ambMaster); ambMaster.connect(comp); comp.connect(ambCtx.destination);
      document.addEventListener('pointerup', function () { if (ambCtx && ambCtx.state === 'suspended') ambCtx.resume(); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden && ambCtx && ambCtx.state === 'suspended') ambCtx.resume(); });
      // viento procedural: ruido marrón en loop → su propio paso-bajo
      ambL.wind = ambAddLayer();
      ambWindFilter = ambCtx.createBiquadFilter(); ambWindFilter.type = 'lowpass'; ambWindFilter.frequency.value = 380;
      var wsrc = ambCtx.createBufferSource(); wsrc.buffer = ambNoiseBuffer(3, true); wsrc.loop = true;
      wsrc.connect(ambWindFilter); ambWindFilter.connect(ambL.wind.gain); wsrc.start(0);
      // hojas: ruido blanco → paso-banda alto
      ambWhiteBuf = ambNoiseBuffer(2.7, false);
      ambL.leaves = ambAddLayer();
      var lf = ambCtx.createBiquadFilter(); lf.type = 'bandpass'; lf.frequency.value = 2800; lf.Q.value = 0.7;
      var lsrc = ambCtx.createBufferSource(); lsrc.buffer = ambWhiteBuf; lsrc.loop = true;
      lsrc.connect(lf); lf.connect(ambL.leaves.gain); lsrc.start(0);
      // grillos: coro sintetizado de 45 s (ver la nota de cabecera)
      ambL.crickets = ambAddLayer();
      ambLoopInto(ambL.crickets, ambCricketBuffer());
      // grabadas: las decodifica el navegador desde los archivos locales de siempre
      ambL.birds = ambAddLayer(); ambLoadLayer(ambL.birds, 'birds.ogg');
      ambL.rain = ambAddLayer(); ambLoadLayer(ambL.rain, 'rain.ogg');
      nextOneShot = ambCtx.currentTime + 18 + Math.random() * 30;
    }
    function playerIndoor01() {
      if (typeof playerBody === 'undefined' || typeof chunks === 'undefined') return 0;
      var px = playerBody.position.x, pz = playerBody.position.z;
      var pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = chunks[keyOf(pcx + dx, pcz + dz)];
        if (!ch || !ch.maus) continue;
        if (Math.abs(px - (ch.cx * CHUNK + 11)) < ch.maus.halfW - 0.1 && Math.abs(pz - (ch.cz * CHUNK + 11)) < ch.maus.halfD - 0.1) return 1;
      }
      return 0;
    }
    function ambOneShot(kind, t) {
      var out = ambCtx.createGain(); out.gain.value = 1;
      if (ambCtx.createStereoPanner) { var pan = ambCtx.createStereoPanner(); pan.pan.value = Math.random() * 1.4 - 0.7; out.connect(pan); pan.connect(ambFilter); }
      else out.connect(ambFilter);
      if (kind === 'owl') {
        // búho lejano: dos ululatos senoidales graves con caída de
        // tono, tras paso-bajo — a esta distancia y ganancia se lee
        // como un búho de verdad entre los cipreses
        var og = ambCtx.createGain(); og.gain.value = 0;
        var of = ambCtx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 850;
        var o = ambCtx.createOscillator(); o.type = 'sine';
        o.connect(of); of.connect(og); og.connect(out);
        var base = 320 + Math.random() * 60, gv = 0.05 + Math.random() * 0.06;
        function hoot(t0, dur) {
          o.frequency.setValueAtTime(base * 1.06, t0);
          o.frequency.exponentialRampToValueAtTime(base * 0.88, t0 + dur);
          og.gain.setValueAtTime(0.0001, t0);
          og.gain.exponentialRampToValueAtTime(gv, t0 + dur * 0.3);
          og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        }
        hoot(t, 0.42); hoot(t + 0.62, 0.30);
        o.start(t); o.stop(t + 1.2);
      } else {
        // pájaro carpintero: ráfaga de golpecitos secos que decae
        var bp = ambCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 2.0;
        var bg = ambCtx.createGain(); bg.gain.value = 1;
        bp.connect(bg); bg.connect(out);
        var n = 6 + Math.floor(Math.random() * 4), gv2 = 0.05 + Math.random() * 0.05;
        for (var i = 0; i < n; i++) {
          var s = ambCtx.createBufferSource(); s.buffer = ambWhiteBuf; s.playbackRate.value = 1.4;
          var sg = ambCtx.createGain(); var tt = t + i * 0.055, amp = gv2 * (1 - i / (n + 2));
          sg.gain.setValueAtTime(amp, tt); sg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
          s.connect(sg); sg.connect(bp);
          s.start(tt, Math.random() * 0.2, 0.05); s.stop(tt + 0.06);
        }
      }
    }
    function updateAmbient(dt) {
      if (!ambOn || !ambCtx) return;
      ambTick += dt;
      if (ambTick < 0.3) return;
      var step = ambTick; ambTick = 0;
      var t = ambCtx.currentTime;
      var day = (typeof worldLight !== 'undefined' && typeof worldLight.dayF === 'number') ? worldLight.dayF : 1;
      var night = 1 - day;
      var doy = (typeof ORBIT !== 'undefined') ? ORBIT.dayOfYear : 288;
      var season = (doy >= 335 || doy <= 59) ? 'summer' : (doy <= 151 ? 'autumn' : (doy <= 243 ? 'winter' : 'spring')); // estaciones australes (Córdoba)
      var SB = { spring: 1.0, summer: 0.85, autumn: 0.45, winter: 0.15 }[season];
      var SC = { spring: 0.30, summer: 1.0, autumn: 0.50, winter: 0.0 }[season];
      var windMs = (typeof WIND !== 'undefined') ? WIND.speed : 2;
      var windG = clamp(windMs / 12, 0, 1);
      var rainMm = (typeof SIM !== 'undefined' ? SIM.rainRate : 0) * (typeof rainLocalF !== 'undefined' ? rainLocalF : 1);
      ambIndoor += (playerIndoor01() - ambIndoor) * 0.25;
      var gust = 0.72 + 0.28 * Math.sin(t * 0.13) * Math.sin(t * 0.041 + 1.7); // ráfaga lenta compartida por viento y hojas
      function ease(L, target, tau) { if (L) L.gain.gain.setTargetAtTime(Math.max(0, target), t, tau); }
      ease(ambL.wind, (0.05 + windG * 0.30) * gust * (season === 'winter' ? 1.15 : 1), 1.5); // el viento nunca calla del todo: es el suelo del silencio
      if (ambWindFilter) ambWindFilter.frequency.setTargetAtTime(250 + windG * 650, t, 1.5);
      ease(ambL.leaves, windG * windG * (season === 'autumn' ? 0.20 : 0.12) * gust, 1.5);
      ease(ambL.rain, clamp(rainMm / 8, 0, 1) * 0.50, 1.5);
      var dawn = 1;
      if (typeof ORBIT !== 'undefined' && typeof ORBIT.sunriseH === 'number' && typeof ENV !== 'undefined') { var dh = Math.abs(ENV.hour - (ORBIT.sunriseH + 0.7)); dawn = 1 + ((season === 'spring' || season === 'summer') ? 0.6 * Math.exp(-dh * dh / 1.4) : 0); }
      ease(ambL.birds, day * SB * dawn * (rainMm > 2 ? 0.25 : 1) * (1 - ambIndoor * 0.85) * 0.30, 3);
      chorusTimer -= step;
      if (chorusTimer <= 0) { chorusOn = !chorusOn; chorusTimer = chorusOn ? 30 + Math.random() * 60 : 15 + Math.random() * 45; }
      ease(ambL.crickets, night * SC * (rainMm > 0.5 ? 0 : 1) * (1 - ambIndoor * 0.7) * (chorusOn ? 1 : 0) * 0.26, 3);
      ambFilter.frequency.setTargetAtTime(ambIndoor > 0.5 ? 650 : 17000, t, 0.4);
      ambMaster.gain.setTargetAtTime((soundOn ? 0.8 : 0) * (ambIndoor > 0.5 ? 0.7 : 1), t, 0.4);
      // one-shots: temporizador, no loop — y con lluvia fuerte, nada
      if (t >= nextOneShot) {
        nextOneShot = t + (day > 0.5 ? 25 + Math.random() * 65 : 40 + Math.random() * 80);
        if (rainMm <= 5 && soundOn) ambOneShot(day > 0.5 ? 'woodpecker' : 'owl', t);
      }
    }
