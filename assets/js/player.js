/* player.js — Entrada del jugador: teclado, ratón con pointer lock,
   mirada táctil, joystick virtual y botón de correr.
   Depende de: scene (canvas), world (playerBody vía main). */
'use strict';
    /* ================= Entrada: teclado, ratón y táctil ================= */
    var keys = {};
    var yaw = 0, pitch = -0.02; // al inicio se mira hacia -Z, a lo largo del sendero
    var started = false, soundOn = true;
    var joyVec = { x: 0, y: 0, mag: 0 };
    var runToggle = false;

    window.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Escape') e.target.blur(); return; }
      if (e.code === 'Escape' && typeof debugPanel !== 'undefined' && debugPanel && debugPanel.classList.contains('open')) { setDebug(false); return; }
      if (e.code === 'KeyN' && !e.repeat && typeof toggleNoclip === 'function') toggleNoclip(); // N: noclip sí/no (atravesar tumbas, muros y suelo)
      keys[e.code] = true;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) !== -1) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });

    var canvas = renderer.domElement;
    /* Captura del ratón (pointer lock) en PC. NO se detecta por
       'ontouchstart': en portátiles y PC con pantalla táctil vale true
       aunque haya ratón, y la captura nunca se pedía. Manda el tipo de
       puntero del propio clic (PointerEvent.pointerType) o, sin evento,
       si el dispositivo tiene un puntero fino (ratón/trackpad). Chrome
       devuelve una promesa de requestPointerLock que puede rechazarse
       (p. ej. al recapturar demasiado pronto tras salir con Escape):
       se captura el rechazo para que no rompa nada ni ensucie la
       consola, y el siguiente clic en la escena reintenta la captura.
       Escape libera el ratón por comportamiento nativo del navegador. */
    var hasFinePointer = window.matchMedia ? window.matchMedia('(pointer: fine)').matches : !('ontouchstart' in window);
    /* Marca de UI táctil REAL (v70): si el dispositivo tiene
       capacidad de tacto, <html> lleva .touch-ui y el CSS muestra
       los controles táctiles por esta vía TAMBIÉN — la media query
       (pointer: coarse) sola dejaba el botón de interactuar
       (ABRIR/LEER) sin aparecer en webviews que la reportan mal. */
    if ((window.navigator && navigator.maxTouchPoints > 0) || 'ontouchstart' in window) document.documentElement.classList.add('touch-ui');
    function lockPointer(e) {
      if (!started || document.pointerLockElement) return;
      if (e && e.pointerType) { if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return; }
      else if (!hasFinePointer) return;
      try {
        var r = canvas.requestPointerLock();
        if (r && typeof r.catch === 'function') r.catch(function () {});
      } catch (err) { /* el próximo clic reintenta */ }
    }
    document.addEventListener('pointerlockerror', function () { /* el próximo clic reintenta */ });
    canvas.addEventListener('click', function (e) { lockPointer(e); });
    document.addEventListener('mousemove', function (e) {
      if (!document.pointerLockElement || !started) return;
      yaw -= e.movementX * 0.0023;
      pitch = clamp(pitch - e.movementY * 0.0023, -1.35, 1.35);
    });
    // mirada táctil: arrastrar sobre el lienzo
    var lookId = null, lookLX = 0, lookLY = 0;
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      lookId = e.pointerId; lookLX = e.clientX; lookLY = e.clientY;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerId !== lookId || !started) return;
      yaw -= (e.clientX - lookLX) * 0.0042;
      pitch = clamp(pitch - (e.clientY - lookLY) * 0.0042, -1.35, 1.35);
      lookLX = e.clientX; lookLY = e.clientY;
    });
    function endLook(e) { if (e.pointerId === lookId) lookId = null; }
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);

    /* ============ Figura del jugador: solo existe para su SOMBRA ============
       Silueta humanoide articulada con material que no escribe ni color
       ni profundidad: en pantalla no se ve nada, pero el mapa de sombras
       la registra y el sol (o la luna) proyecta su sombra real sobre el
       suelo. Se coloca en la posición del cuerpo físico, mira hacia yaw
       y se anima con la fase de zancada real (bobT/bobAmp de main.js):
       piernas y brazos se balancean al caminar, más amplio y con el
       torso inclinado al correr; al girar, la sombra gira con el jugador. */
    var playerFigure = new THREE.Group();
    var figMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    function figPart(parent, w, h, d, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), figMat);
      m.position.set(x, y, z); m.castShadow = false; // sombra del jugador DESACTIVADA a pedido: ni la figura procedural ni el Xbot proyectan sombra
      parent.add(m); return m;
    }
    var figLegL = new THREE.Group(), figLegR = new THREE.Group(), figArmL = new THREE.Group(), figArmR = new THREE.Group(), figTorso = new THREE.Group();
    (function buildFigure() {
      figLegL.position.set(-0.10, 0.96, 0); figLegR.position.set(0.10, 0.96, 0);
      figPart(figLegL, 0.13, 0.92, 0.16, 0, -0.46, 0);
      figPart(figLegR, 0.13, 0.92, 0.16, 0, -0.46, 0);
      figTorso.position.set(0, 0.96, 0);
      figPart(figTorso, 0.36, 0.58, 0.20, 0, 0.30, 0);            // torso
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), figMat);
      head.position.set(0, 0.72, 0); head.castShadow = false; figTorso.add(head);
      figArmL.position.set(-0.235, 0.54, 0); figArmR.position.set(0.235, 0.54, 0);
      figPart(figArmL, 0.09, 0.60, 0.12, 0, -0.28, 0);
      figPart(figArmR, 0.09, 0.60, 0.12, 0, -0.28, 0);
      figTorso.add(figArmL); figTorso.add(figArmR);
      playerFigure.add(figLegL); playerFigure.add(figLegR); playerFigure.add(figTorso);
      playerFigure.visible = false;
      scene.add(playerFigure);
    })();
    /* Modelo real animado: el Xbot de Mixamo (el mismo del ejemplo
       oficial de three.js), guardado en assets/xbot.glb. Se carga en
       segundo plano; mientras tanto — o si la carga falla en este
       equipo — la sombra la proyecta la figura procedural de arriba.
       El modelo comparte el material que no escribe color ni
       profundidad: es invisible y solo existe su sombra, animada con
       sus clips reales idle / walk / run según lo que hace el jugador,
       proyectada por la luz direccional del sol o de la luna. */
    var figMixer = null, figActions = {}, figState = '', figModel = null;
    if (THREE.GLTFLoader) {
      try { loadXbot(0); } catch (e) { /* la figura procedural queda de sombra */ }
    }
    /* Carga del Xbot SIN GLTFLoader.load(): ese método usa FileLoader,
       que construye internamente `new Request(url)` — y contra la base
       blob: del cliente de PC ese constructor LANZA «Failed to parse
       URL from assets/xbot.glb» de forma síncrona y sin atrapar: el
       error llegaba al banner rojo y, peor, cortaba el resto de este
       script (joystick y botón CORRER quedaban sin cablear en PC).
       Aquí el GLB se pide con fetch(CADENA): el fetch por cadena es el
       que el túnel del cliente PC intercepta y resuelve por su puerto
       interno, y en web/móvil resuelve la relativa como siempre. Los
       bytes se parsean con GLTFLoader.parse() — el .glb es autocontenido
       (un único buffer embebido, sin imágenes ni URIs externas), así que
       parsear no dispara ninguna otra carga por red. Cualquier fallo es
       una promesa rechazada atrapada aquí: se reintenta y, si persiste,
       queda la figura procedural, sin banner de error. */
    function fetchXbotBuffer() {
      var url = assetUrl('xbot.glb');
      return fetch(url).then(function (r) {
        if (r && r.ok === false && r.status !== 0) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).catch(function (err) {
        // Segunda vía en el cliente PC: pedir al túnel la URL blob:
        // del asset y bajarla con el fetch nativo (una blob: absoluta
        // sí se puede parsear y descargar en cualquier base).
        if (window.__tunnel && typeof __tunnel.resolveToBlobUrl === 'function') {
          return __tunnel.resolveToBlobUrl(url).then(function (b) { return fetch(b); }).then(function (r2) { return r2.arrayBuffer(); });
        }
        throw err;
      });
    }
    function loadXbot(attempt) {
      fetchXbotBuffer().then(function (buf) {
        new THREE.GLTFLoader().parse(buf, '', function (gltf) {
        figModel = gltf.scene;
        var bb = new THREE.Box3().setFromObject(figModel);
        var mh = Math.max(bb.max.y - bb.min.y, 0.01);
        var msc = 1.78 / mh; // altura humana real, venga en m o en cm
        figModel.scale.setScalar(msc);
        figModel.position.y = -bb.min.y * msc;
        figModel.traverse(function (o) {
          if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.material = figMat; } // sin sombra del jugador (a pedido)
        });
        playerFigure.add(figModel);
        figLegL.visible = false; figLegR.visible = false; figTorso.visible = false; // la procedural se retira
        figMixer = new THREE.AnimationMixer(figModel);
        var clipNames = ['idle', 'walk', 'run'];
        for (var i = 0; i < clipNames.length; i++) {
          var clip = THREE.AnimationClip.findByName(gltf.animations, clipNames[i]);
          if (clip) figActions[clipNames[i]] = figMixer.clipAction(clip);
        }
        if (figActions.idle) { figActions.idle.play(); figState = 'idle'; }
        }, function () { xbotFailed(attempt); });
      }).catch(function () { xbotFailed(attempt); });
    }
    function xbotFailed(attempt) {
      /* Fallo de carga o de parseo: se reintenta hasta 2 veces con
         espera. Si aun así falla, queda la figura procedural como
         sombra — en silencio, sin banner de error: es un respaldo
         previsto, no un error del juego. */
      if (attempt < 2) setTimeout(function () { loadXbot(attempt + 1); }, 1200 * (attempt + 1));
    }
    function figSetState(name, timeScale) {
      var a = figActions[name];
      if (!a) return;
      a.timeScale = timeScale;
      if (figState === name) return;
      var prev = figActions[figState];
      figState = name;
      a.reset().fadeIn(0.25).play();
      if (prev && prev !== a) prev.fadeOut(0.25);
    }
    function updatePlayerFigure(dt) {
      playerFigure.visible = started;
      if (!started) return;
      var p = playerBody.position;
      playerFigure.position.set(p.x, Math.max(p.y - 0.36, 0), p.z);
      playerFigure.rotation.y = yaw;
      var hv = Math.sqrt(playerBody.velocity.x * playerBody.velocity.x + playerBody.velocity.z * playerBody.velocity.z);
      if (figMixer) {
        // animación según la acción real: quieto, caminando o corriendo,
        // con la velocidad de reproducción atada a la velocidad real
        if (hv < 0.25) figSetState('idle', 1);
        else if (hv > SETTINGS.walkSpeed * 1.12) figSetState('run', clamp(hv / 4.6, 0.7, 1.6));
        else figSetState('walk', clamp(hv / 1.5, 0.6, 1.7));
        figMixer.update(dt || 0.016);
        return;
      }
      var runF = clamp((hv - SETTINGS.walkSpeed * 0.9) / Math.max(SETTINGS.runSpeed - SETTINGS.walkSpeed, 0.1), 0, 1);
      var swing = (typeof bobAmp !== 'undefined' ? bobAmp : 0) * (0.55 + runF * 0.45);
      var ph = (typeof bobT !== 'undefined' ? bobT : 0);
      figLegL.rotation.x = Math.sin(ph) * swing;
      figLegR.rotation.x = -Math.sin(ph) * swing;
      figArmL.rotation.x = -Math.sin(ph) * swing * 0.8;
      figArmR.rotation.x = Math.sin(ph) * swing * 0.8;
      figTorso.rotation.x = -(0.04 + runF * 0.13 * clamp(hv / SETTINGS.runSpeed, 0, 1)); // inclinación hacia adelante al correr (mira a -Z)
      figTorso.position.y = 0.96 + Math.abs(Math.sin(ph)) * 0.03 * (typeof bobAmp !== 'undefined' ? bobAmp : 0);
    }

    // joystick virtual
    var joyEl = document.getElementById('joy'), knobEl = document.getElementById('joyKnob');
    var joyId = null;
    function joyMove(e) {
      var r = joyEl.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var max = r.width / 2 - 8, d = Math.sqrt(dx * dx + dy * dy);
      if (d > max) { dx *= max / d; dy *= max / d; d = max; }
      knobEl.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
      joyVec.x = dx / max; joyVec.y = dy / max; joyVec.mag = d / max;
    }
    joyEl.addEventListener('pointerdown', function (e) { joyId = e.pointerId; joyEl.setPointerCapture(joyId); joyMove(e); e.preventDefault(); });
    joyEl.addEventListener('pointermove', function (e) { if (e.pointerId === joyId) joyMove(e); });
    function joyEnd(e) {
      if (e.pointerId !== joyId) return;
      joyId = null; joyVec.x = 0; joyVec.y = 0; joyVec.mag = 0;
      knobEl.style.transform = 'translate(-50%,-50%)';
    }
    joyEl.addEventListener('pointerup', joyEnd);
    joyEl.addEventListener('pointercancel', joyEnd);
    var btnRun = document.getElementById('btnRun');
    btnRun.addEventListener('click', function () { runToggle = !runToggle; btnRun.classList.toggle('on', runToggle); });
