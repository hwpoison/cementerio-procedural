/* main.js — Bucle principal (movimiento suave con aceleración progresiva,
   balanceo por distancia, contador de FPS, linterna, suelo infinito) y
   arranque: carga de texturas, atlas de placas y precarga de chunks.
   Depende de: todos los módulos anteriores. */
'use strict';
    /* ================= Bucle principal ================= */
    var elDist = document.getElementById('statDist');
    var distance = 0, lastPos = { x: 0, z: 6 };
    var bobT = 0;
    /* Caminata suave: velocidad con aceleración progresiva (la velocidad
       real persigue a la deseada con amortiguación exponencial, sin
       tirones al arrancar, frenar o cambiar de dirección) y balanceo
       atado a la distancia realmente recorrida, no al reloj. */
    var smVx = 0, smVz = 0, smVy = 0, bobAmp = 0;
    var crouchF = 0; // agachado (C mantenida): 0 de pie → 1 agachado; interpola ojo, velocidad y radio de colisión
    var lastSurface = 'grass'; // material del último paso (lo lee el asa de verificación)
    /* Contador de FPS del HUD: valor de la última ventana de 0,5 s y
       promedio acumulado de la sesión, actualizados en tiempo real. */
    var fpsFrames = 0, fpsWinT = 0, fpsTotal = 0, fpsTotalT = 0, fpsUiT = 0;
    var elFpsNow = document.getElementById('fpsNow'), elFpsAvg = document.getElementById('fpsAvg');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var clock = new THREE.Clock();
    var camTmp = new THREE.Vector3();

    function animate() {
      requestAnimationFrame(animate);
      try {
        if (renderer.info) renderer.info.reset();
        var dt = Math.min(clock.getDelta(), 0.05);
        var t = clock.elapsedTime;

        // entrada (dirección según cámara)
        var ix = 0, iz = 0;
        if (started) {
          // cámara con flechas: ← → giran la vista, ↑ ↓ inclinan la
          // mirada — convive con el ratón (pointer lock), que escribe
          // las mismas yaw/pitch. Caminar queda en WASD, como siempre.
          if (keys.ArrowLeft) yaw += 1.85 * dt;
          if (keys.ArrowRight) yaw -= 1.85 * dt;
          if (keys.ArrowUp) pitch = clamp(pitch + 1.30 * dt, -1.35, 1.35);
          if (keys.ArrowDown) pitch = clamp(pitch - 1.30 * dt, -1.35, 1.35);
          if (keys.KeyW) iz -= 1;
          if (keys.KeyS) iz += 1;
          if (keys.KeyA) ix -= 1;
          if (keys.KeyD) ix += 1;
          ix += joyVec.x; iz += joyVec.y;
          var il = Math.sqrt(ix * ix + iz * iz);
          if (il > 1) { ix /= il; iz /= il; il = 1; }
          var running = keys.ShiftLeft || keys.ShiftRight || runToggle || joyVec.mag > 0.93;
          var speed = running ? SETTINGS.runSpeed : SETTINGS.walkSpeed;
          var sin = Math.sin(yaw), cos = Math.cos(yaw);
          if (SETTINGS.noclip) {
            // vuelo: la dirección sigue a la mirada (yaw + pitch), sin gravedad ni colisiones
            var cp = Math.cos(pitch);
            var vx = (-sin * cp) * (-iz) + cos * ix, vz = (-cos * cp) * (-iz) - sin * ix, vy = Math.sin(pitch) * (-iz);
            if (keys.Space) vy += 1;
            if (keys.KeyC) vy -= 1;
            var vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (vl > 1) { vx /= vl; vy /= vl; vz /= vl; }
            var fs = speed * 2.2;
            var kf = 1 - Math.exp(-dt * 6);
            smVx += (vx * fs - smVx) * kf; smVy += (vy * fs - smVy) * kf; smVz += (vz * fs - smVz) * kf;
            playerBody.velocity.set(smVx, smVy, smVz);
          } else {
            // derecha = (cos, -sin) · frente = (-sin, -cos); iz=-1 (W) es avanzar
            var wx2 = ix * cos + iz * sin, wz2 = -ix * sin + iz * cos;
            /* AGACHARSE (C mantenida, fuera de noclip): ojo más bajo,
               paso más lento y cuerpo más chico — la esfera de
               colisión se achica y pasa por huecos más bajos. */
            crouchF += ((keys.KeyC ? 1 : 0) - crouchF) * (1 - Math.exp(-dt * 10));
            var sph = playerBody.shapes[0];
            if (crouchF > 0.25 && sph.radius > 0.30) { sph.radius = 0.24; sph.updateBoundingSphereRadius(); playerBody.updateBoundingRadius(); }
            else if (crouchF <= 0.25 && sph.radius < 0.30) { sph.radius = 0.35; sph.updateBoundingSphereRadius(); playerBody.updateBoundingRadius(); }
            var crouchMul = 1 - 0.55 * crouchF;
            /* SALTO (Espacio): impulso vertical solo si está apoyado
               (la esfera descansa a 0,36 de pie y a 0,25 agachado). */
            if (keys.Space && playerBody.position.y <= 0.42 && Math.abs(playerBody.velocity.y) < 0.6) playerBody.velocity.y = 4.6;
            // aceleración progresiva: arrancar, frenar y girar toman ~0,25 s
            // de rampa suave en vez de saltos instantáneos de velocidad —
            // sin tirones ni sensación de ir trabado contra las tumbas
            var kw = 1 - Math.exp(-dt * (il > 0.05 ? 6.5 : 9.5));
            smVx += (wx2 * speed * crouchMul - smVx) * kw;
            smVz += (wz2 * speed * crouchMul - smVz) * kw;
            playerBody.velocity.x = smVx;
            playerBody.velocity.z = smVz;
            if (playerBody.position.y < 0.2) { playerBody.position.y = 0.36; playerBody.velocity.y = 0; }
          }
          world.step(1 / 60, dt, 3);
          var p = playerBody.position;
          var frameDist = Math.sqrt((p.x - lastPos.x) * (p.x - lastPos.x) + (p.z - lastPos.z) * (p.z - lastPos.z));
          distance += frameDist;
          lastPos.x = p.x; lastPos.z = p.z;
          elDist.textContent = Math.floor(distance) + ' m';
          /* Balanceo y pasos atados a la distancia REAL recorrida: la fase
             avanza lo que avanzan los pies (zancada de 0,74 m caminando,
             0,98 m corriendo), así la cadencia nunca se desincroniza del
             suelo ni pega saltos cuando la velocidad sube o baja. La
             amplitud entra y sale con su propia rampa (bobAmp). */
          var moving = il > 0.08;
          if (!SETTINGS.noclip) bobT += frameDist / (running ? 0.98 : 0.74) * Math.PI;
          var cyc = Math.floor(bobT / Math.PI);
          if (cyc !== stepCycle) {
            stepCycle = cyc;
            if (moving && il > 0.2 && !SETTINGS.noclip) {
              // cada paso cae con un pie: el material se detecta bajo ESE pie
              var sideF = (cyc % 2 === 0) ? 0.17 : -0.17;
              lastSurface = surfaceAt(p.x + Math.cos(yaw) * sideF, p.z - Math.sin(yaw) * sideF);
              playStep(lastSurface, running);
              wetStep(p.x + Math.cos(yaw) * sideF, p.z - Math.sin(yaw) * sideF, lastSurface); // suela mojada → huella (wet.js)
            }
          }
          var bobTarget = (moving && !reduceMotion && !SETTINGS.noclip) ? clamp(Math.sqrt(smVx * smVx + smVz * smVz) / SETTINGS.walkSpeed, 0, 1.35) : 0;
          bobAmp += (bobTarget - bobAmp) * (1 - Math.exp(-dt * 7));
          var bobY = Math.abs(Math.sin(bobT)) * 0.042 * bobAmp;
          var bobX = Math.sin(bobT) * 0.011 * bobAmp;
          // ojo a 1,67 m (agachado: ~1,09 m); el vaivén lateral va sobre el vector derecha (cos, -sin)
          camera.position.set(p.x + Math.cos(yaw) * bobX, p.y + 1.32 - 0.58 * crouchF + bobY * (1 - crouchF * 0.7), p.z - Math.sin(yaw) * bobX);
          camera.rotation.set(pitch, yaw, 0);
          updatePlayerFigure(dt); // la sombra del personaje sigue posición, giro y acción (modelo animado)
          updatePlaqueCard(p.x, p.z, dt);
        } else {
          // deriva lenta de cámara antes de empezar
          camera.position.set(Math.sin(t * 0.05) * 2.5, 1.7, 6 + Math.sin(t * 0.033) * 1.5);
          camera.rotation.set(-0.03 + Math.sin(t * 0.07) * 0.012, Math.sin(t * 0.045) * 0.35, 0);
        }

        var px = started ? playerBody.position.x : camera.position.x;
        var pz = started ? playerBody.position.z : camera.position.z;
        updateChunks(px, pz, dt);
        if (started) refreshColliders();
        tickDoors(dt); // puertas abribles (v65): el giro de la hoja y la abertura de luz que la sigue
        updateEnvironment(dt, px, pz, t);
        updateWindowBeam(px, pz, t); // haz de luz de la ventana del panteón cercano — prisma + parche + polvo (world.js): sigue a la fuente activa que updateEnvironment acaba de fijar
        updateAmbient(dt); // ambiente sonoro dinámico (audio.js): las capas entran y salen por estado — hora, estación, viento, lluvia, interior — con el silencio como un estado más

        // linterna: encendido suave; el haz sigue a la cámara (es su hija)
        flashLevel += (FLASH_FRAC[flashStep] - flashLevel) * Math.min(1, dt * 14); // el nivel persigue la fracción del paso actual (v65: 3 intensidades)
        if (flashLevel < 0.01 && flashStep === 0) flashLevel = 0;
        /* Linterna EN LA NIEBLA (v52, pedido de Guille): fenómeno→
           consecuencia — el haz cruza la capa dos veces (ida y
           vuelta) y la retrodispersión de las gotitas cercanas ciega
           más de lo que el haz alumbra lejos: con niebla densa una
           linterna real NO perfora la niebla, apenas deja ver unos
           pocos metros en un cono lechoso. flashFogK sale de la
           densidad REAL del FogExp2 de este frame (0,081 ≈ niebla
           máxima en calma): la intensidad útil cae 45 % y el alcance
           de 30 m a ~6,6 m; lo alumbrado además sigue velado por el
           FogExp2 de cada material. En aire claro no cambia nada. */
        flashFogK = scene.fog ? clamp(fogObj.density / 0.081, 0, 1) : 0;
        flashlight.intensity = flashLevel * FLASH_MAX * (1 - 0.45 * flashFogK);
        flashlight.distance = 30 * (1 - 0.78 * flashFogK);
        if (Math.abs(flashlight.shadow.camera.far - flashlight.distance) > 0.5) { flashlight.shadow.camera.far = flashlight.distance; flashlight.shadow.camera.updateProjectionMatrix(); }
        /* El CONO VISIBLE en la niebla (scene.js): su longitud es el
           alcance real de este frame y su fuerza crece con la
           densidad — dispersión de Mie hacia adelante dentro del haz;
           en aire claro queda apenas un velo del 4 % por el polvo. */
        var coneK = flashLevel * (0.04 + 0.96 * flashFogK);
        flashCone.visible = coneK > 0.02;
        if (flashCone.visible) {
          flashConeUni.uFlash.value = coneK * 0.5;
          flashConeUni.uTime.value = t;
          camera.getWorldDirection(flashConeUni.uAxis.value);
          flashConeUni.uCamPos.value.copy(camera.position);
          var coneLen = Math.max(flashlight.distance, 0.5);
          flashCone.scale.set(coneLen, coneLen, coneLen);
        }

        // suelo infinito: la malla sigue al jugador y la textura queda fija al mundo
        groundMesh.position.set(px, 0, pz);
        if (hillsMesh) hillsMesh.position.set(px, 0, pz); // colinas del horizonte (v64): el anillo sigue al jugador como el disco — a 470–1185 m se leen como lejanía, no como un objeto que se acerca
        var tile = 8; // la textura de césped cubre 8 m
        groundMat.map.offset.set((px / tile) % 1, -(pz / tile) % 1);
        groundMat.normalMap.offset.copy(groundMat.map.offset);
        groundMat.roughnessMap.offset.copy(groundMat.map.offset);

        /* Sol y sombras siguen al jugador con SNAP A LA RETÍCULA DEL
           MAPA DE SOMBRAS (v54): la posición del objetivo se redondea
           en los EJES DE LA CÁMARA DE SOMBRAS a múltiplos exactos del
           téxel (4,1 cm). El snap viejo (rejilla mundial de 2 m) no era
           múltiplo del téxel (2 / 0,041 ≈ 48,8): al moverse el jugador,
           cada borde de sombra caía en una fracción de téxel distinta
           en cada frame y el borde «nadaba»/temblaba — suavidad
           aparente añadida sobre la penumbra. Con el snap a téxel, el
           contenido del mapa se traslada entero y el borde solo se
           mueve cuando cruza un téxel completo: sombra estable. */
        var sx = px, sz = pz;
        (function () {
          var texelS = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
          var Lx = lightDir.x, Lz = lightDir.z;
          var lh = Math.hypot(Lx, Lz);
          if (!(lh > 0.05)) return; // fuente casi cenital: sin ejes horizontales definidos, sigue al jugador sin snap
          Lx /= lh; Lz /= lh;
          // eje derecho de la cámara de sombras en el suelo: (Lz, −Lx) —
          // a lo largo de él, un téxel de mapa es un téxel de suelo. El
          // otro eje del mapa (el «arriba» de la cámara) se proyecta
          // sobre el suelo acortado por el coseno de la elevación: un
          // paso de suelo a lo largo del acimut de la luz mueve la
          // coordenada del mapa solo Ly por unidad, así que el paso de
          // la rejilla sobre el suelo es téxel / Ly (Ly = coseno de la
          // elevación efectiva de la luz, con el mismo clamp 0,12 con
          // el que se coloca el sol justo debajo).
          var lyN = Math.max(lightDir.y, 0.12); lyN /= Math.hypot(lightDir.x, lyN, lightDir.z);
          var stepB = texelS / Math.max(Math.abs(lyN), 0.2);
          var a = px * Lz - pz * Lx, b = px * Lx + pz * Lz;
          var a2 = Math.round(a / texelS) * texelS, b2 = Math.round(b / stepB) * stepB;
          sx = a2 * Lz + b2 * Lx; sz = -a2 * Lx + b2 * Lz;
        })();
        sun.position.set(sx + lightDir.x * 110, Math.max(lightDir.y, 0.12) * 110, sz + lightDir.z * 110);
        sun.target.position.set(sx, 0, sz);

        // (el viento ya no se regula aquí: es una capa procedural del
        // sistema de ambiente de audio.js, con sus ráfagas y su estado)

        // render con pasada Purkinje: la escena va a un target HDR
        // lineal (sin tone mapping: three solo lo aplica a pantalla) y
        // el quad final aplica percepción + ACES + gamma. Sin pasada
        // disponible, render directo como siempre.
        if (PURK_OK && purkRT) {
          purkMat.uniforms.uS.value = (typeof PURK !== 'undefined') ? PURK.s : 0;
          purkMat.uniforms.uExposure.value = renderer.toneMappingExposure;
          purkMat.uniforms.uHaze.value = (typeof HAZE !== 'undefined') ? 0.03 * HAZE.f : 0; // calima: uStrength 0–0,030 del informe
          purkMat.uniforms.uTime.value = t * (0.6 + 0.8 * ((typeof HAZE !== 'undefined') ? HAZE.f : 0));
          renderer.setRenderTarget(purkRT);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          renderer.render(purkScene, purkCam);
        } else {
          renderer.render(scene, camera);
        }

        // red de seguridad de shaders: tras el error reportado, al
        // arrancar y cada ~2 s, cualquier material cuyo programa no haya
        // compilado en este WebGL cae a su forma estándar con texturas
        if (pendingShaderCheck) { pendingShaderCheck = false; validateShaders(); }
        else if (fpsTotal === 2 || fpsTotal % 120 === 0) validateShaders();

        // FPS del HUD: ventana de 0,5 s para el valor actual y promedio
        // acumulado de toda la sesión; el texto se refresca 2 veces/s
        fpsFrames++; fpsWinT += dt; fpsTotal++; fpsTotalT += dt; fpsUiT += dt;
        if (fpsWinT >= 0.5) {
          var fpsNow = Math.round(fpsFrames / fpsWinT);
          fpsFrames = 0; fpsWinT = 0;
          if (fpsUiT >= 0.5) {
            fpsUiT = 0;
            elFpsNow.textContent = fpsNow;
            elFpsAvg.textContent = fpsTotalT > 1 ? Math.round(fpsTotal / fpsTotalT) : fpsNow;
          }
        }
      } catch (err) {
        var el = document.getElementById('err');
        el.style.display = 'block';
        el.textContent = 'Error en el bucle: ' + (err && err.message ? err.message : err);
        throw err;
      }
    }

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (purkRT) purkRT.setSize(window.innerWidth, window.innerHeight);
    });

    /* ================= Arranque ================= */
    var btnStart = document.getElementById('btnStart');
    /* ============ Carga de imágenes: el canal que SÍ funciona en PC ====
       Diagnóstico (confirmado por el usuario en su PC): las texturas de
       las TUMBAS cargaban y las del SUELO, las parcelas y los senderos
       no. La diferencia está en el código, no en los archivos — todas
       las fotos son JPG 1024×1024 sanos y en móvil (https normal) carga
       todo. Las texturas que funcionan en PC son TODAS CanvasTexture
       generadas dentro de la página (piedra de las tumbas, atlas de
       placas, luna: la foto solo se usa pintada en un canvas 2D). Las
       únicas que subían a WebGL DIRECTAMENTE desde un <img> de red
       (new THREE.Texture(im)) eran las del suelo/sendero/corteza — y
       son las que el túnel del cliente PC (página blob:) entrega
       inservibles para esa subida directa: el <img> «carga» (onload
       dispara y el juego arranca) pero la textura queda negra.
       Arreglo en dos capas, ambas por canales ya probados en PC:
       1) La foto se baja como BYTES — fetch por cadena, el canal que
          el túnel sí intercepta (así se arregló el Xbot), con la vía
          nativa del túnel __tunnel.resolveToBlobUrl como respaldo — y
          se decodifica desde una URL blob: del MISMO origen: jamás
          queda marcada como insegura para WebGL, en ningún entorno.
       2) La textura se crea como CanvasTexture pintando la foto en un
          canvas 2D: exactamente el mismo canal que usan las texturas
          de las tumbas que siempre funcionaron en PC.
       Y una verificación final con respaldo: si el canvas pintado no
       se puede leer (marcado) o quedó totalmente transparente (la
       foto nunca se decodificó de verdad), se genera una textura
       procedural con la paleta de esa superficie — el suelo NUNCA
       vuelve a quedar negro por un fallo de carga. */
    function loadImage(src) {
      var url = assetUrl(src.replace(/^assets\//, ''));
      function viaImg(u) {
        return new Promise(function (res, rej) {
          var im = new Image();
          im.onload = function () { res(im); };
          im.onerror = function (e) { rej(e || new Error('img error')); };
          im.src = u;
        });
      }
      // Vía principal: la foto EMBEBIDA en el paquete (texdata.js).
      // No genera ninguna petición de red: la VPN del usuario bloqueaba
      // las peticiones de imágenes en PC y por eso el suelo y las
      // parcelas quedaban negros solo ahí (en móvil cargaba todo).
      var dataUrl = texDataUrl(src.replace(/^assets\//, ''));
      if (dataUrl) return viaImg(dataUrl);
      function viaFetch() {
        return fetch(url).then(function (r) {
          if (r && r.ok === false && r.status !== 0) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (blob) {
          if (!blob || !blob.size) throw new Error('blob vacío');
          return viaImg(URL.createObjectURL(blob));
        });
      }
      function viaTunnel() {
        if (window.__tunnel && typeof __tunnel.resolveToBlobUrl === 'function') {
          return __tunnel.resolveToBlobUrl(url).then(function (b) { return viaImg(b); });
        }
        throw new Error('sin túnel');
      }
      if (typeof fetch === 'function' && window.URL && URL.createObjectURL) {
        return viaFetch().catch(function () {
          return viaTunnel().catch(function () { return viaImg(url); });
        });
      }
      return viaTunnel().catch(function () { return viaImg(url); });
    }
    /* Respaldo procedural por superficie: moteado determinista sobre
       la paleta de cada foto. Solo aparece si la foto no se pudo usar;
       en móvil y en web nunca se ve. */
    var FALLBACK_PALETTES = [
      [/grass_diff/, '#5d7038', '#47602c', '#71824a'],
      [/grass_nor/, '#8080ff', '#8080ff', '#8080ff'],
      [/grass_rough/, '#c8c8c8', '#b4b4b4', '#dcdcdc'],
      [/dry_diff/, '#8a7a4e', '#77683f', '#9c8a5c'],
      [/dry_nor/, '#8080ff', '#8080ff', '#8080ff'],
      [/dry_rough/, '#c2c2c2', '#aeaeae', '#d6d6d6'],
      [/path_diff/, '#7d7466', '#6a6154', '#8f8676'],
      [/path_nor/, '#8080ff', '#8080ff', '#8080ff'],
      [/path_rough/, '#bcbcbc', '#a8a8a8', '#d0d0d0'],
      [/bark/, '#5f4630', '#4c3826', '#73573c']
    ];
    function fallbackCanvas(src) {
      var pal = ['#666666', '#555555', '#777777'];
      for (var i = 0; i < FALLBACK_PALETTES.length; i++) if (FALLBACK_PALETTES[i][0].test(src)) { pal = FALLBACK_PALETTES[i].slice(1); break; }
      var c = document.createElement('canvas'); c.width = 512; c.height = 512;
      var x = c.getContext('2d');
      x.fillStyle = pal[0]; x.fillRect(0, 0, 512, 512);
      var r = mulberry32(hash2(src.length * 31 + 7, src.charCodeAt(0) || 1));
      for (var n = 0; n < 26000; n++) {
        x.fillStyle = r() > 0.5 ? pal[1] : pal[2];
        x.globalAlpha = 0.16 + r() * 0.30;
        x.fillRect(r() * 512, r() * 512, 1 + r() * 3, 1 + r() * 3);
      }
      x.globalAlpha = 1;
      return c;
    }
    /* ¿El canvas pintado con la foto sirve? Se muestrean píxeles: si
       leerlos lanza (canvas marcado por origen) o TODOS salen con
       alfa 0 (la imagen nunca se decodificó en el canvas), no sirve. */
    function canvasUsable(x, w, h) {
      try {
        for (var i = 0; i < 16; i++) {
          var px = Math.floor((i % 4 + 0.5) * w / 4), py = Math.floor((Math.floor(i / 4) + 0.5) * h / 4);
          var d = x.getImageData(px, py, 1, 1).data;
          if (d[3] > 0) return true;
        }
        return false;
      } catch (e) { return false; }
    }
    function loadTex(src, srgb) {
      return loadImage(src).then(function (im) {
        var w = im.naturalWidth || im.width || 0, h = im.naturalHeight || im.height || 0;
        var c = document.createElement('canvas');
        var usable = false;
        if (w > 0 && h > 0) {
          c.width = w; c.height = h;
          var cx2 = c.getContext('2d');
          try { cx2.drawImage(im, 0, 0, w, h); usable = canvasUsable(cx2, w, h); } catch (e) { usable = false; }
        }
        if (!usable) c = fallbackCanvas(src);
        var t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        // anisotropía dentro del máximo real de la GPU (en escritorio
        // varía mucho entre GPU integradas y dedicadas)
        t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        // red de seguridad NPOT: sin WebGL2, una textura no potencia de
        // dos no puede repetirse ni llevar mipmaps (se vería negra);
        // se degrada a clamp + lineal en vez de perder la textura
        var pot = (c.width & (c.width - 1)) === 0 && (c.height & (c.height - 1)) === 0;
        if (!pot && renderer.capabilities.isWebGL2 === false) {
          t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
          t.generateMipmaps = false;
          t.minFilter = THREE.LinearFilter;
        }
        t.needsUpdate = true;
        return t;
      });
    }
    Promise.all([
      loadImage('assets/slate.png'),
      loadTex('assets/grass_diff.jpg', true),
      loadTex('assets/grass_nor_gl.jpg', false),
      loadTex('assets/grass_rough.jpg', false),
      loadTex('assets/dry_diff.jpg', true),
      loadTex('assets/dry_nor_gl.jpg', false),
      loadTex('assets/dry_rough.jpg', false),
      loadTex('assets/path_diff.jpg', true),
      loadTex('assets/path_nor_gl.jpg', false),
      loadTex('assets/path_rough.jpg', false),
      loadTex('assets/bark_diff.jpg', true),
      loadTex('assets/marble_diff.jpg', true),
      loadTex('assets/marble_nor_gl.jpg', false),
      loadTex('assets/marble_rough.jpg', false),
      loadTex('assets/cement_diff.jpg', true),
      loadTex('assets/cement_nor_gl.jpg', false),
      loadTex('assets/cement_rough.jpg', false),
      loadTex('assets/doorpine_diff.jpg', true),
      loadTex('assets/doorpine_nor_gl.jpg', false),
      loadTex('assets/doorpine_rough.jpg', false),
      loadTex('assets/doorplank_diff.jpg', true),
      loadTex('assets/doorplank_nor_gl.jpg', false),
      loadTex('assets/doorplank_rough.jpg', false),
      loadImage('assets/faces.jpg?v=66'),
      loadImage('assets/facesdb.jpg?v=70')
    ]).then(function (res) {
      var slateImg = res[0];
      plaqueTex = new THREE.CanvasTexture(buildPlaqueAtlas(slateImg, res[23], res[24])); // res[23] = faces.jpg (atlas v66) y res[24] = facesdb.jpg (la base de datos de rostros, v70), por la misma vía de carga. CORRECCIÓN v72: la v70 pasaba res[24]/res[25] — pero la lista tiene 25 promesas (índices 0–24): facesdb caía en el slot del atlas viejo (se muestreaba con celdas de 200×252 en 8 columnas sobre una imagen de celdas 256×320 en 6: las ventanas cruzaban dos celdas y los rostros salían descentrados y cortados, reporte de Guille 20:42 con la placa CORTÉS TOMÁS) y la base nueva quedaba en undefined → DB_IMG null → queryFaceDB devolvía siempre null. Con los índices reales, la base manda y el atlas viejo es el respaldo.
      plaqueTex.colorSpace = THREE.SRGBColorSpace;
      plaqueTex.anisotropy = 4;
      buildMaterials(slateImg, {
        grass: { diff: res[1], nor: res[2], rough: res[3] },
        dry: { diff: res[4], nor: res[5], rough: res[6] },
        path: { diff: res[7], nor: res[8], rough: res[9] },
        bark: res[10],
        marble: { diff: res[11], nor: res[12], rough: res[13] }, // mármol real de los panteones (ambientCG Marble001, CC0, local)
        cement: { diff: res[14], nor: res[15], rough: res[16] }, // cemento cepillado de los panteones de cemento (Poly Haven Brushed Concrete, CC0, local)
        doorA: { diff: res[17], nor: res[18], rough: res[19] }, // puerta de pino rústico (Poly Haven Rough Pine Door, CC0, local)
        doorB: { diff: res[20], nor: res[21], rough: res[22] } // puerta de tablones (Poly Haven Wooden Garage Door, CC0, local)
      });
      // precarga de los chunks centrales antes de entrar
      for (var dx = -2; dx <= 2; dx++) for (var dz = -2; dz <= 2; dz++) buildChunk(dx, dz - 0);
      btnStart.disabled = false;
      btnStart.textContent = 'Comenzar a jugar';
      animate();
    }).catch(function (e) {
      btnStart.textContent = 'Error al cargar los recursos';
      var el = document.getElementById('err');
      el.style.display = 'block';
      el.textContent = 'No se pudieron cargar las texturas: ' + e;
    });

    var btnHelp = document.getElementById('btnHelp');
    btnHelp.addEventListener('click', function () {
      var open = document.getElementById('helpList').classList.toggle('open');
      btnHelp.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    btnStart.addEventListener('click', function (e) {
      started = true;
      document.getElementById('startOverlay').style.display = 'none';
      startAmbient(); // el ambiente WebAudio nace DENTRO del gesto (audio.js): resume() sincrónico y capas desde ganancia 0
      lockPointer(e); // en PC captura el ratón con este mismo clic; en táctil no hace nada
    });
    
