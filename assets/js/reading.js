/* reading.js — Lectura de placas por ACCIÓN: mirando la placa de frente
   aparece el botón LEER y la placa se lee al apretar E (PC) o tocar el
   botón (móvil). Regla de luz: en oscuridad no se lee. Depende de:
   scene (estimateLightAt), world, player, plaques. */
'use strict';
    /* ================= Lectura de placas ================= */
    var plaqueCard = document.getElementById('plaqueCard');
    var elName = document.getElementById('pName'), elYears = document.getElementById('pYears'), elEpitaph = document.getElementById('pEpitaph');
    var readSet = {}, readCount = 0, currentPlaque = -1, currentLit = null;
    var elRead = document.getElementById('statRead');
    /* La placa entra con el fade de la clase .show al accionar la
       lectura sobre el objetivo actual; al apartar la mirada, sale con
       el mismo fade (fade out). */
    var gazeKey = null, gazeT = 0, gazeRevealed = false;
    var gazeFaceDot = null; // coseno jugador↔normal de la placa del objetivo (verificación en vivo)
    var gazeEl = document.getElementById('gaze'), gazeFillEl = document.getElementById('gazeFill');
    /* Objetivo e interacción: cuando una placa es el objetivo (cerca,
       de frente a su cara con la inscripción, en el centro de la vista)
       aparece el botón LEER; la lectura ocurre al apretar E en PC o al
       tocar ese botón en móvil — ya no hay lectura automática por
       mirada sostenida. */
    var interactTarget = null;
    var btnInteract = document.getElementById('btnInteract');
    function doInteract() {
      if (!interactTarget) return;
      if (interactTarget.doorRec) { // puerta (v65): la acción es ABRIR, no leer
        if (interactTarget.doorRec.sealed) { // v72: puerta sellada — el intento suena a bloqueada (openDoor lo deriva) y el objetivo queda: se puede reintentar
          openDoor(interactTarget.doorRec);
          return;
        }
        openDoor(interactTarget.doorRec);
        interactTarget = null;
        if (btnInteract) { btnInteract.classList.remove('on'); btnInteract.textContent = 'LEER'; }
        return;
      }
      if (gazeRevealed) return;
      gazeRevealed = true;
      if (btnInteract) btnInteract.classList.remove('on');
      renderPlaque(interactTarget);
    }
    if (btnInteract) btnInteract.addEventListener('click', doInteract);
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyE') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      doInteract();
    });
    function hidePlaqueCard() {
      currentPlaque = -1;
      currentLit = null;
      gazeRevealed = false;
      plaqueCard.classList.remove('show');
      plaqueCard.classList.remove('dark');
    }
    function renderPlaque(best) {
      /* La placa solo se lee si le cae luz de verdad: la del sol/luna del
         momento o el haz de la linterna apuntando a esta tumba. En
         oscuridad el nombre ni siquiera entra en la tarjeta legible:
         queda difuminado y sin contar como leída. */
      var lit = estimateLightAt(best.x, best.z) >= READ_LIGHT_MIN;
      currentPlaque = best.plaqueIdx;
      currentLit = lit;
      var data = best.person || plaquePool[best.plaqueIdx]; // persona propia (placas familiares de panteón, v70) o la del pool general
      if (lit) {
        elName.textContent = data.name;
        elYears.textContent = data.years;
        elEpitaph.textContent = '«' + data.epitaph + '»';
        plaqueCard.classList.remove('dark');
        var rk = best.x.toFixed(1) + ',' + best.z.toFixed(1);
        if (!readSet[rk]) { readSet[rk] = 1; readCount++; elRead.textContent = readCount; }
      } else {
        elName.textContent = '— — — — —';
        elYears.textContent = '· · · ·';
        elEpitaph.textContent = '· · · · ·';
        plaqueCard.classList.add('dark');
      }
      plaqueCard.classList.add('show');
    }
    function updatePlaqueCard(px, pz, dt) {
      var best = null, bestD = 2.6, bestFace = null;
      var pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
      var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      /* PUERTA COMO OBJETIVO (v65): si el jugador mira una puerta
         CERRADA desde su frente (la puerta mira a −Z del mundo: hay
         que estar del lado de afuera, z menor) y a menos de 3,4 m,
         el objetivo de interacción es la puerta y el botón dice
         ABRIR — manda sobre cualquier placa cercana. Desde la v72
         las SELLADAS también son objetivo (world.js las registra
         con sealed: true): el botón aparece igual, el intento suena
         a bloqueada y la etiqueta dice SELLADA un instante. */
      var doorBest = null, doorD = 3.4; // v70: 2,8 → 3,4 m y mirada 0,45 → 0,38 — en móvil apuntar con el arrastre es menos preciso y la puerta es un blanco grande; el botón ABRIR tiene que aparecer sin puntería fina
      for (var ddx = -1; ddx <= 1; ddx++) for (var ddz = -1; ddz <= 1; ddz++) {
        var chD = chunks[keyOf(pcx + ddx, pcz + ddz)];
        if (!chD || !chD.door || chD.door.state !== 'closed') continue;
        var dvx = chD.door.x - px, dvz = chD.door.z - pz;
        var dd = Math.sqrt(dvx * dvx + dvz * dvz);
        if (dd > doorD || dd < 0.3) continue;
        if ((dvx * fx + dvz * fz) / (dd || 1) < 0.38) continue; // la mirada no apunta a la puerta
        if ((chD.door.z - pz) / (dd || 1) < 0.3) continue; // no está del lado de afuera (frente)
        doorBest = chD.door; doorD = dd;
      }
      if (doorBest) {
        if (currentPlaque !== -1 || gazeRevealed) hidePlaqueCard();
        gazeKey = null;
        interactTarget = { doorRec: doorBest };
        if (btnInteract) { // v72: tras un intento sobre una sellada, la etiqueta lo dice un instante y vuelve a ABRIR
          var triedAgo = doorBest.triedAt ? ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - doorBest.triedAt) : 1e9;
          btnInteract.textContent = (doorBest.sealed && triedAgo < 900) ? 'SELLADA' : 'ABRIR';
          btnInteract.classList.add('on');
        }
        return;
      }
      if (btnInteract && btnInteract.textContent !== 'LEER') btnInteract.textContent = 'LEER';
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        var ch = chunks[keyOf(pcx + dx, pcz + dz)];
        if (!ch) continue;
        for (var i = 0; i < ch.tombs.length; i++) {
          var t = ch.tombs[i];
          if (t.plaqueIdx == null) continue;
          /* La mirada debe apuntar a la CARA con la inscripción, no a la
             tumba en general: el objetivo es el centro de la placa
             (t.px/t.pz) y el jugador tiene que estar DELANTE de esa cara
             — el vector placa→jugador debe alinearse con la normal de la
             placa (t.fx/t.fz). Desde el lado opuesto (la parte sin placa)
             la tumba ni siquiera es objetivo: la mirada de 2 s no arranca
             y la placa no se puede leer. */
          var qx = (t.px != null ? t.px : t.x), qz = (t.pz != null ? t.pz : t.z);
          var vx = qx - px, vz = qz - pz;
          var d = Math.sqrt(vx * vx + vz * vz);
          if (d > bestD || d < 0.3) continue;
          var dot = (vx * fx + vz * fz) / (d || 1);
          if (dot < 0.45) continue;
          var faceDot = 1;
          if (t.fx != null) {
            faceDot = ((px - qx) * t.fx + (pz - qz) * t.fz) / (d || 1);
            if (faceDot < 0.35) continue; // detrás o de canto: cara no visible
          }
          best = t; bestD = d; bestFace = faceDot;
        }
      }
      gazeFaceDot = best ? bestFace : null;
      if (!best) {
        // sin objetivo: se apaga el botón LEER y la placa sale con fade out
        interactTarget = null;
        if (btnInteract) btnInteract.classList.remove('on');
        if (gazeKey !== null) { gazeKey = null; gazeT = 0; }
        if (currentPlaque !== -1 || gazeRevealed) hidePlaqueCard();
        return;
      }
      var key = best.x.toFixed(1) + ',' + best.z.toFixed(1);
      if (key !== gazeKey) {
        // objetivo nuevo: la placa anterior desaparece y esta espera la acción
        gazeKey = key;
        gazeT = 0;
        if (currentPlaque !== -1 || gazeRevealed) hidePlaqueCard();
      }
      interactTarget = best;
      if (!gazeRevealed) {
        if (btnInteract) btnInteract.classList.add('on'); // «LEER»: E en PC o toque en móvil
      } else {
        // ya leída y visible: si cambia la luz (linterna, hora, luna) se re-renderiza
        var litNow = estimateLightAt(best.x, best.z) >= READ_LIGHT_MIN;
        if (currentPlaque !== best.plaqueIdx || currentLit !== litNow) renderPlaque(best);
      }
    }
