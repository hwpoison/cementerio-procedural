/* scene.js — Renderer, escena, cámara, cielo (THREE.Sky), luces base
   (sol direccional + hemisférica) y la linterna con su estimación de luz.
   Depende de: three.min.js. Lo usan: materials, world, sky, weather, main. */
'use strict';
    /* ================= Escena, sol y cielo diurno ================= */
    var container = document.getElementById('scene');
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // pixel ratio capado a 1,5: en pantallas de alta densidad es la
    // palanca de FPS más grande con vegetación y suelo con shader (la
    // escena se renderiza DOS veces por la pasada Purkinje); a 2× el
    // coste de fragmentos se dispara sin ganancia visible en juego
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.78;
    // Diagnóstico de shaders activo y canalizado: si un programa no
    // compila en este WebGL, three avisa por onShaderError y el bucle
    // principal degrada ESE material a estándar (validateShaders).
    renderer.debug.checkShaderErrors = true;
    renderer.info.autoReset = false; // el bucle lo resetea a mano: así __game.state() puede leer llamadas y triángulos de la escena (con el reset automático solo quedaría la pasada final)
    renderer.debug.onShaderError = function () { pendingShaderCheck = true; };
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    /* Fondo de RESPALDO tras el Sky: si el shader del cielo fallara en
       algún WebGL, se ve este color (weather.js lo mantiene igual al
       color de niebla del momento: azul pálido de día, casi negro de
       noche) en vez del negro puro del clear del renderer. Con el Sky
       sano nunca se ve: la caja del cielo es opaca y lo cubre todo. */
    scene.background = new THREE.Color(0x9fc3e8);
    var FOG_COLOR = new THREE.Color(0xdfe7da);
    /* Niebla como CAPA física, no como velo lineal: FogExp2 = extinción
       de Beer–Lambert a través de gotas de agua (dispersión de Mie: las
       gotas son grandes frente a la longitud de onda, así que la
       extinción es casi independiente de λ — la niebla es blanca/gris,
       nunca azul; el azul es Rayleigh del aire limpio, no de la niebla).
       La densidad la regula weather.js según la niebla del momento y el
       viento; sin niebla (0) el objeto se retira de la escena. */
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0015);
    var fogObj = scene.fog; // con niebla en 0 se retira de la escena (aire claro) y se restaura al subir
    var camera = new THREE.PerspectiveCamera(71, window.innerWidth / window.innerHeight, 0.1, 3000);
    camera.rotation.order = 'YXZ';

    var sky = new THREE.Sky();
    sky.scale.setScalar(1600);
    /* Sin tone mapping en el cielo: ACES desatura y aclara el azul de
       Preetham (ese velo pálido «anieblado» que se veía aun en despejado).
       Sin él, el azul sale saturado y penetrante, y el disco solar —
       cuyo color supera 700 en el shader — recorta a blanco brillante,
       inconfundible contra el azul. El fundido de horizonte no se afecta:
       mezcla DESPUÉS de colorspace_fragment con el mismo color de niebla
       que usa el suelo, como el propio fog de three en esta versión. */
    sky.material.toneMapped = false;
    /* El disco PROPIO del Sky queda APAGADO: su diámetro es de 1,07°
       (el doble del real) y su color es blanco ×760 sin transmitancia.
       El parche de abajo dibuja el disco físico de 0,53° coloreado por
       exp(−τ·m) ENCIMA de ese anillo blanco: el centro se leía oscuro
       contra el anillo — el «punto como un eclipse» de la captura del
       usuario. Con showSunDisc = 0 manda solo el disco físico (y los
       sprites de respaldo si el parche no compila en este WebGL). */
    if (sky.material.uniforms.showSunDisc) sky.material.uniforms.showSunDisc.value = 0;
    scene.add(sky);
    var sunDir = new THREE.Vector3();
    var sunElev = 34, sunAzim = 138;
    var phi = THREE.MathUtils.degToRad(90 - sunElev);
    var theta = THREE.MathUtils.degToRad(sunAzim);
    sunDir.setFromSphericalCoords(1, phi, theta);
    sky.material.uniforms.sunPosition.value.copy(sunDir);
    /* Horizonte SIN división: el cielo se funde con la niebla en la franja
       baja — el color final del Sky en el horizonte se mezcla hacia el
       color EXACTO de la niebla (misma instancia de Color que usa el fog
       de la escena, actualizada cada frame por weather.js según la hora y
       el clima). Así las tumbas lejanas se pierden en la niebla y la
       niebla se pierde en el cielo, sin ninguna línea ni borde visible.
       La fuerza (uFogBlend) la manda la niebla del momento: con niebla
       en 0 no se toca el cielo (despejado real). */
    var skyPatchOk = false;
    var SKY_FRAG_ORIG = sky.material.fragmentShader; // original intacto: restauración si el parche no compila en este WebGL
    try {
      sky.material.uniforms.uFogColor = { value: fogObj.color };
      sky.material.uniforms.uFogBlend = { value: 0 };
      sky.material.uniforms.uFogBand = { value: 0.10 };
      sky.material.uniforms.uFogLayer = { value: 0 }; // profundidad óptica cenital de la CAPA de niebla: el cielo solo se niebla cerca del horizonte, con perfil de capa (1/sen θ)
      sky.material.uniforms.uBlueF = { value: 0 }; // fuerza del azul pleno en despejado (la regula weather.js)
      sky.material.uniforms.uSunDiscCol = { value: new THREE.Color(0xffe9c0) }; // color del disco solar por transmitancia atmosférica (lo regula weather.js con la tabla SUNSIM de sky.js)
      sky.material.uniforms.uSunTrans = { value: 1 }; // T = exp(−τ) del sol a través de las nubes, calculado en la CPU (weather.js): disco, luz directa, hemisférica y resplandor comparten ESTE escalar
      sky.material.uniforms.uCloudSigma = { value: 1 }; // extinción σ del tipo de nube vigente (1 = altocúmulos; cirros ~0,22, cúmulos ~1,9, estratos ~3,1)
      sky.material.uniforms.uCBillow = { value: 0.55 }; // FORMA del campo (esquema §16): peso del canal billow 1−|ruido| (montículos de coliflor) — lo regula weather.js por tipo de nube
      sky.material.uniforms.uCStretch = { value: 0 }; // FORMA del campo: estiramiento del dominio a lo largo de la deriva (filamentos de cirro); 0 = sin estirar
      sky.material.uniforms.uRays = { value: 0 }; // fuerza de los rayos crepusculares (0 con estratos o cielo cerrado; máxima con altocúmulos rotos y sol bajo)
      sky.material.uniforms.uSilver = { value: 1 }; // fuerza del borde plateado/dorado (dispersión Mie hacia adelante en el limbo fino de la nube)
      sky.material.uniforms.uCloudDiffuse = { value: 1 }; // fracción de luz solar que sobrevive a la capa (la regula weather.js con T): el brillo de las nubes del Sky sale del sol ATENUADO, nunca crece con la nubosidad
      sky.material.uniforms.uTestDir = { value: new THREE.Vector3(0, 1, 0) }; // dirección al centro de la NUBE DE PRUEBA del debug (weather.js)
      sky.material.uniforms.uTestTau = { value: 0 }; // τ de la nube de prueba (0 = inactiva): atenúa el disco con la misma ley exp(−τ) y perfil super-gaussiano de borde definido
      sky.material.uniforms.uTestRays = { value: 0 }; // fuerza del abanico crepuscular de la nube de prueba (la fija weather.js: máxima con el tapado parcial)
      sky.material.uniforms.uTestSize = { value: 1 }; // tamaño de la nube de prueba (multiplicador del ancho gaussiano, slider del debug)
      sky.material.uniforms.uSunHalfRad = { value: 0.00465 }; // semidiámetro angular REAL del sol en radianes: varía con la distancia orbital (weather.js, ORBIT)
      sky.material.uniforms.uCircum = { value: 0.5 }; // F1 de Perez: fracción circunsolar de la difusa — escala la aureola alrededor del disco
      sky.material.uniforms.uMoonDir = { value: new THREE.Vector3(0, 1, 0) }; // dirección a la luna (weather.js): bordes plateados y aureola de la capa del Sky
      sky.material.uniforms.uMoonSilver = { value: 0 }; // fuerza de la luz de luna sobre la capa (fase × elevación × T_luna × slider): 0 de día
      sky.material.uniforms.uRainbow = { value: 0 }; // fuerza del arcoíris (weather.js, emergente: lluvia × sol <42° × luz directa): 0 sin lluvia o sin sol directo
      var skyFrag = sky.material.fragmentShader;
      /* Dos correcciones al bloque de nubes PROPIO del Sky (el parche se
         aplica sobre su fuente, con anclas exactas; si un ancla no está,
         esa corrección se salta y el resto sigue):
         1) horizonFade más ancho: la proyección del campo de nubes sobre
            el plano diverge al acercarse al horizonte (cloudUV ∝ 1/y) y
            el ruido se estira en VETAS VERTICALES brillantes que se
            recortaban como una pared sobre las siluetas. Con el fundido
            llegando a ~0,10–0,20 rad la franja baja queda libre de vetas
            y la ocupan la capa de niebla y el gris de cubierta.
         2) El brillo de la nube se multiplica por uCloudDiffuse (= piso
            difuso + (1−piso)·T del frame): con cubierta total la nube
            recibe solo luz difusa y se apaga a gris; jamás suma luz. */
      if (skyFrag.indexOf('float horizonFade = smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y );') !== -1) {
        skyFrag = skyFrag.replace('float horizonFade = smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y );',
          'float horizonFade = smoothstep( 0.0, 0.10 + 0.10 * cloudElevation, direction.y );');
      }
      if (skyFrag.indexOf('vec3 cloudColor = skyAmbient + sunColor * shade;') !== -1) {
        skyFrag = skyFrag.replace('vec3 cloudColor = skyAmbient + sunColor * shade;',
          'vec3 cloudColor = mix( skyAmbient, sunColor * 2.6, 0.42 ) * ( 0.30 + 0.70 * uCloudDiffuse ) + sunColor * shade * uCloudDiffuse + vec3( 0.45, 0.52, 0.68 ) * uMoonSilver * 0.30 * shade;');
        skyFrag = 'uniform float uCloudDiffuse;\n' + skyFrag;
      }
      /* El término con uMoonSilver es la LUZ DE LUNA sobre TODA la capa
         (v44): la luna ilumina el cielo entero como el sol de día, no
         solo un disco alrededor suyo. Sin él, de noche cloudColor caía
         al piso 0,03 del dayFactor y las únicas nubes visibles eran
         las que caían dentro del resplandor/ribete centrados en la
         luna — el «círculo enorme que contiene todas las nubes» de la
         captura del 23:24. uMoonSilver ya trae fase × elevación ×
         T_luna × slider, así que el término se apaga solo de día, sin
         luna o tras cubierta total. */
      /* ===== NUBES SOLO ALREDEDOR DEL SOL/LUNA (v64, pregunta de
         Guille 18:26: «¿por qué las nubes se generan alrededor del
         sol/luna y no en todo el cielo?»). DIAGNÓSTICO en la fuente:
         el CAMPO siempre cubrió todo el cielo (proyección plana del
         fbm, sin máscara angular); lo que estaba centrado en la
         fuente era su ILUMINACIÓN, por tres vías que se suman:
         (1) COMPUERTA NOCTURNA: el Sky original multiplica TODO el
         color de la capa por max(dayFactor, 0,03), con dayFactor
         según la elevación del SOL — de noche la capa entera cae al
         3 % en TODAS direcciones, y el término de luna de la v44,
         que vive DENTRO de ese color, quedaba multiplicado también
         (neto ×0,003): las únicas nubes que sobrevivían eran las
         que los términos ADITIVOS centrados en la luna (ribete HG y
         aureola del parche posterior) pintaban encima.
         (2) CREPÚSCULO: la compuerta sube de 0,03 a 1 recién con el
         sol a 0,3, pero los términos centrados en el sol (aureola,
         ribete, rayos) se encienden con csDay a 0,05: al amanecer y
         al atardecer la capa se leía solo junto al sol.
         (3) DE DÍA: el ambiente de la capa era skyAmbient = Lin·0,04
         — la radiancia del cielo con fase Mie g = 0,85, cuyo pico
         hacia adelante vale cientos de veces su valor a 90°: las
         nubes brillaban junto al sol y se lavaban contra el cielo
         (su ambiente ES el brillo del cielo local) en el resto.
         CORRECCIÓN, sobre la misma ley (la capa se ilumina con la
         luz DIFUSA del frame, que es de todo el cielo, no con la
         cercanía a la fuente):
         · La compuerta pasa a max(pow(dayFactor, 0,35), piso lunar):
         la difusa crepuscular cae mucho más despacio que la directa
         (a sol en el horizonte aún hay ~la mitad de la luz difusa
         del día), así que la capa conserva 45–65 % en el crepúsculo
         en vez de 10–30 %; y de noche manda el piso de la FUENTE
         ACTIVA — clamp(uMoonSilver·0,9, 0,03, 1): con luna llena
         alta la capa conserva ~90 % de su color en todo el cielo;
         sin luna, 0,03 (sin fuente no hay nube visible, como debe).
         · El término de luna de la capa sube 0,10 → 0,30: con la
         compuerta vieja daba igual (×0,003 neto); con el piso nuevo
         es la luz que ilumina la capa entera de noche.
         · El ambiente diurno se aplana: mix(skyAmbient, sunColor·2,6,
         0,42) — el 58 % sigue siendo el Lin local (el brillo hacia
         el sol NO desaparece: es física, dispersión hacia adelante)
         y el 42 % es el término uniforme del sol (vSunE·Fex, sin
         dirección: la luz que la bóveda entera devuelve a la capa),
         con la escala 2,6 que los iguala a media altura. La nube
         lejana al sol ya no se confunde con el cielo: tiene su
         propio piso de luz en todo el cielo. */
      if (skyFrag.indexOf('cloudColor *= max( dayFactor, 0.03 );') !== -1) {
        skyFrag = skyFrag.replace('cloudColor *= max( dayFactor, 0.03 );',
          'cloudColor *= max( pow( dayFactor, 0.35 ), clamp( uMoonSilver * 0.9, 0.03, 1.0 ) );');
      }
      /* VOLUMEN SIMULADO BARATO (a pedido, sin volumétricas ni
         raymarching: todo sale del MISMO campo 2D de densidad):
         3) SILUETA más nítida: la máscara cruzaba el umbral en 0,30 de
            ruido — un borde ancho y difuso que se leía como mancha; en
            0,13 el contorno es de cúmulo y el ribete plateado (edge =
            mask·(1−mask), máximo en la banda de cruce) queda FINO,
            como la difracción real en el limbo (informe test-cloud).
         4) SEGUNDA CAPA CON PARALAJE: otro muestreo del campo a 0,55×
            de escala y 0,55× de deriva — dos capas a distinta altura
            aparente que se mueven a velocidades levemente distintas;
            su profundidad se SUMA a la de la capa principal (τ total
            mayor en el núcleo: con el τ del tipo, el núcleo de cúmulo
            llega a τ 5–25 del informe y el disco desaparece).
         5) NORMALES FALSAS del campo: un muestreo desplazado HACIA el
            sol da la derivada direccional del relieve; el bulto captura
            luz del lado del sol y sombra del opuesto (fakeN, aplicado
            sobre shade más abajo).
         1) GRADIENTE POR PROFUNDIDAD más fuerte: beer pasa de
            exp(−4·depth) a exp(−6·depth) — la luz que sobrevive el
            viaje por la nube cae más rápido, así la copa (depth chico)
            queda brillante y la base (depth grande) oscura: «grey is
            just deep» (informe test-cloud §1). */
      /* FORMA DEL CAMPO — ALGORITMO DE NUBES (esquema §16, v46):
         sobre el fbm + remapeo por cobertura de la capa (Quilez /
         Book of Shaders) se asimilan dos piezas baratas de la
         investigación cloud-generation (notas 02/03/05/06):
         (a) CANAL BILLOW: un muestreo extra de ruido a 2,6× la
         escala base, plegado como 1−|n| — los montículos con cresta
         de los cúmulos (el plegado billow de Cartopolis/Verhulst
         sustituye al Worley de 9 hashes/octava, impagable en una
         Mali). Modula el ESPESOR (cloudNoise) sin tocar la
         cobertura: donde no hay nube no aparece ninguna, y el
         núcleo gana τ mientras el borde se afina — relieve de
         coliflor en el mismo campo que luego da T = exp(−τ).
         (b) ESTIRAMIENTO DE DOMINIO: compresión de las coordenadas
         a lo largo del eje de la deriva (la diagonal (1,1) del
         campo, por donde entra time·cloudSpeed) — los cirros salen
         en filamentos alargados a favor del viento (tosijs:
         cirrus = dominio estirado + billow angosto).
         Las DOS transformaciones se aplican idénticas en los tres
         lectores del campo — este bloque visible, cloudDepthAt
         (τ hacia sol/luna en el shader) y sus réplicas CPU/suelo —
         porque el campo es UNO: si un lector viera otra forma, su
         τ sería la de otra nube. */
      if (skyFrag.indexOf('float cloudNoise = clamp( fbm( cloudUV * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );') !== -1) {
        skyFrag = skyFrag.replace('float cloudNoise = clamp( fbm( cloudUV * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );',
          'vec2 cSt = cloudUV;\n' +
          '\t\t\t\tfloat cK = mix( 1.0, 0.32, uCStretch );\n' +
          '\t\t\t\tfloat cU = dot( cSt, vec2( 0.7071 ) );\n' +
          '\t\t\t\tfloat cV = dot( cSt, vec2( -0.7071, 0.7071 ) );\n' +
          '\t\t\t\tcSt = vec2( 0.7071 ) * ( cU * cK ) + vec2( -0.7071, 0.7071 ) * cV;\n' +
          '\t\t\t\tfloat cloudNoise = clamp( fbm( cSt * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );\n' +
          '\t\t\t\tfloat cBil = 1.0 - abs( noise( cSt * 2600.0 + vec2( 13.7, 7.9 ) + evolve * 0.7 ) );\n' +
          '\t\t\t\tcloudNoise = clamp( cloudNoise * ( 1.0 + uCBillow * ( cBil - 0.45 ) * 0.55 ), 0.0, 1.0 );');
      }
      if (skyFrag.indexOf('float cloudMask = smoothstep( threshold, threshold + 0.3, cloudNoise );') !== -1) {
        skyFrag = skyFrag.replace('float cloudMask = smoothstep( threshold, threshold + 0.3, cloudNoise );',
          'float cloudMask = smoothstep( threshold, threshold + 0.13, cloudNoise );');
      }
      if (skyFrag.indexOf('float depth = max( 0.0, cloudNoise - threshold );') !== -1) {
        skyFrag = skyFrag.replace('float depth = max( 0.0, cloudNoise - threshold );',
          'float depth = max( 0.0, cloudNoise - threshold );\n' +
          '\t\t\t\tfloat cloudNoiseB = clamp( fbm( cloudUV * 550.0 + vec2( 17.3, 9.1 ), evolve * 0.55 ) * 0.7 + 0.5, 0.0, 1.0 );\n' +
          '\t\t\t\tfloat depthB = max( 0.0, cloudNoiseB - threshold * 1.06 ) * 0.55;\n' +
          '\t\t\t\tdepth = depth + depthB * ( 1.0 - clamp( depth, 0.0, 1.0 ) );\n' +
          '\t\t\t\tvec2 sunUVd = vSunDirection.xz / max( abs( vSunDirection.y ), 0.22 );\n' +
          '\t\t\t\tsunUVd = normalize( sunUVd + vec2( 1e-4, 0.0 ) ) * 0.30;\n' +
          '\t\t\t\tfloat cloudNoiseS = clamp( fbm( cloudUV * 1000.0 + sunUVd, evolve ) * 0.7 + 0.5, 0.0, 1.0 );\n' +
          '\t\t\t\tfloat fakeN = clamp( ( cloudNoise - cloudNoiseS ) * 3.0, -1.0, 1.0 );');
      }
      if (skyFrag.indexOf('float beer = exp( depth * -4.0 );') !== -1) {
        skyFrag = skyFrag.replace('float beer = exp( depth * -4.0 );',
          'float beer = exp( depth * -6.0 );');
      }
      if (skyFrag.indexOf('float shade = mix( 0.45, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) );') !== -1) {
        skyFrag = skyFrag.replace('float shade = mix( 0.45, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) );',
          'float shade = mix( 0.45, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) );\n' +
          '\t\t\t\tshade = clamp( shade * ( 0.80 + 0.38 * fakeN ) - depth * 0.16, 0.05, 1.10 ); // normales falsas + base oscura por profundidad: el relieve se lee sin una sola malla 3D');
      }
      /* En ESTA versión de three el fragment del Sky NO tiene varying
         vWorldDirection: la dirección de vista se reconstruye de
         vWorldPosition y cameraPosition (uniform incorporado). La versión
         anterior inyectaba código con vWorldDirection, el shader no
         compilaba y el cielo entero salía negro (sin disco solar ni
         fundido de horizonte). skyPatchOk solo es true si el ancla y el
         varying real existen en el shader.
         SEGUNDA TRAMPA (la del cielo negro de la v16): el uniform
         sunPosition SOLO existe en el VERTEX shader del Sky; en el
         fragment la dirección del sol llega como el varying
         vSunDirection. El parche usaba `sunPosition` en el fragment:
         variable no declarada, el programa no enlazaba, el Sky no se
         dibujaba y se veía el negro del clear del renderer — con el
         suelo iluminado de día, porque las luces no dependen del Sky.
         Aquí abajo se usa vSunDirection, que es exactamente eso. */
      if (skyFrag.indexOf('#include <colorspace_fragment>') !== -1 && skyFrag.indexOf('vWorldPosition') !== -1 && skyFrag.indexOf('vSunDirection') !== -1 && skyFrag.indexOf('void main() {') !== -1) {
        /* Funciones NUBES–SOL inyectadas antes del main: evalúan el MISMO
           campo de ruido (fbm/region) que el bloque de nubes del propio
           Sky, así la transmitancia que apaga el disco es la de la nube
           que el jugador VE tapándolo — no un campo distinto. τ sale de
           Beer–Lambert con la misma calibración que el alfa de las nubes
           del shader (depth · densidad · 12) × σ del tipo de nube. */
        var skyCloudSunFns =
          'float cloudDepthAt(vec3 d) {\n' +
          '  float elevMixC = mix(1.0, 0.1, cloudElevation);\n' +
          '  vec2 cuv = d.xz / (max(d.y, 0.045) * elevMixC);\n' +
          '  cuv = cuv * cloudScale + time * cloudSpeed;\n' +
          // FORMA del campo idéntica a la del bloque visible (esquema §16): estiramiento de dominio + canal billow — la τ de aquí es la de la nube que se VE
          '  float cK = mix(1.0, 0.32, uCStretch);\n' +
          '  float cU = dot(cuv, vec2(0.7071));\n' +
          '  float cV = dot(cuv, vec2(-0.7071, 0.7071));\n' +
          '  vec2 cSt = vec2(0.7071) * (cU * cK) + vec2(-0.7071, 0.7071) * cV;\n' +
          '  float cn = clamp(fbm(cSt * 1000.0, time * cloudSpeed * 300.0) * 0.7 + 0.5, 0.0, 1.0);\n' +
          '  float cBil = 1.0 - abs(noise(cSt * 2600.0 + vec2(13.7, 7.9) + time * cloudSpeed * 300.0 * 0.7));\n' +
          '  cn = clamp(cn * (1.0 + uCBillow * (cBil - 0.45) * 0.55), 0.0, 1.0);\n' +
          '  float rg = noise(cuv * 300.0) * 0.37 + 0.5;\n' +
          '  float cv = clamp(cloudCoverage + (rg - 0.5) * 0.6, 0.0, 1.0);\n' +
          '  return max(0.0, cn - (1.0 - cv));\n' +
          '}\n' +
          'float cloudTransAt(vec3 d, float slant) {\n' +
          // con la cobertura casi cerrada (>72 %) se suma el manto uniforme
          // de la cubierta: una capa de estratos cerrada tiene τ alto en
          // TODAS partes — el campo de ruido solo no debe dejar puntos
          // casi transparentes por los que se cuele un resplandor
          '  float deckB = pow(clamp((cloudCoverage - 0.72) / 0.28, 0.0, 1.0), 1.5) * 0.30;\n' +
          '  return exp(-(cloudDepthAt(d) + deckB) * cloudDensity * 12.0 * uCloudSigma * slant);\n' +
          '}\n' +
          // NUBE DE PRUEBA (debug): misma ley exp(−τ) con perfil gaussiano
          // de 0,75° alrededor de uTestDir; 1 cuando está inactiva
          'float testTransAt(vec3 d) {\n' +
          '  if (uTestTau <= 0.001) return 1.0;\n' +
          '  float daT = acos(clamp(dot(d, uTestDir), -1.0, 1.0));\n' +
          '  return exp(-uTestTau * exp(-pow(daT / (0.0160 * uTestSize), 6.0)));\n' +
          '}\n' +
          // Espectro del arcoíris (Descartes): rampa por el ángulo de
          // desviación de la gota — t=0 violeta (40°, borde interno
          // del primario) → t=1 rojo (42°, borde externo)
          'vec3 spectral(float t) {\n' +
          '  vec3 c = mix(vec3(0.45, 0.20, 0.75), vec3(0.15, 0.35, 0.95), smoothstep(0.0, 0.28, t));\n' +
          '  c = mix(c, vec3(0.10, 0.78, 0.42), smoothstep(0.28, 0.50, t));\n' +
          '  c = mix(c, vec3(0.98, 0.85, 0.15), smoothstep(0.50, 0.68, t));\n' +
          '  c = mix(c, vec3(0.98, 0.48, 0.08), smoothstep(0.68, 0.84, t));\n' +
          '  c = mix(c, vec3(0.95, 0.12, 0.05), smoothstep(0.84, 1.0, t));\n' +
          '  return c;\n' +
          '}\n';
        sky.material.fragmentShader = ('uniform vec3 uFogColor;\nuniform float uFogBlend;\nuniform float uFogBand;\nuniform float uFogLayer;\nuniform float uBlueF;\nuniform vec3 uSunDiscCol;\nuniform float uSunTrans;\nuniform float uCloudSigma;\nuniform float uCBillow;\nuniform float uCStretch;\nuniform float uRays;\nuniform float uSilver;\nuniform vec3 uTestDir;\nuniform float uTestTau;\nuniform float uTestRays;\nuniform float uTestSize;\nuniform float uSunHalfRad;\nuniform float uCircum;\nuniform vec3 uMoonDir;\nuniform float uMoonSilver;\nuniform float uRainbow;\n' + skyFrag.replace('void main() {', skyCloudSunFns + 'void main() {')).replace('#include <colorspace_fragment>',
          '#include <colorspace_fragment>\n' +
          /* ===== AMANECER/ATARDECER SIMULADOS (informe 2026-11-22, §3) =====
             El Sky de three es Preetham 1999: solo luz de día, indefinido
             bajo el horizonte y sin rojos crepusculares — por eso el ocaso
             salía como un resplandor blanco. Encima de su salida se aplica
             la simulación por elevación: keyframes físicos de cenit y de
             horizonte HACIA el sol y OPUESTO (no simétrico: opuesto manda
             la sombra de la Tierra + el Cinturón de Venus rosa), banda
             naranja que se angosta al hundirse el sol (10° → 1,8°), halo
             Mie teñido por la MISMA transmitancia que el disco y con
             ganancia baja, y el DISCO analítico de 0,53° de diámetro
             (cos 0,265° = 0,9999893) coloreado por exp(−τ·m): a 0° es
             #FF4E00 y NO PUEDE salir blanco. El fundido de niebla y el
             azul pleno de despejado se aplican DESPUÉS, en ese orden. */
          'vec3 sDir = normalize(vWorldPosition - cameraPosition);\n' +
          'float sunY = clamp(vSunDirection.y, -1.0, 1.0);\n' + // sen(elevación del sol)
          'float duskW = (1.0 - smoothstep(0.12, 0.23, sunY)) * smoothstep(-0.19, -0.13, sunY);\n' + // activo de +13° a −7,5° aprox.; a −6° (hora azul) sigue pleno y luego cede a la noche
          'vec3 kZen = vec3(0.106, 0.165, 0.322);\n' + // −6° #1B2A52 (azul profundo por ozono)
          'kZen = mix(kZen, vec3(0.165, 0.247, 0.451), smoothstep(-0.1045, -0.0349, sunY));\n' + // −2° #2A3F73
          'kZen = mix(kZen, vec3(0.200, 0.306, 0.541), smoothstep(-0.0349, 0.0, sunY));\n' + // 0° #334E8A
          'kZen = mix(kZen, vec3(0.239, 0.424, 0.722), smoothstep(0.0, 0.0872, sunY));\n' + // +5° #3D6CB8
          'kZen = mix(kZen, vec3(0.290, 0.478, 0.761), smoothstep(0.0872, 0.1736, sunY));\n' + // +10° #4A7AC2
          'vec3 kHorS = vec3(0.478, 0.290, 0.416);\n' + // −6° #7A4A6A (franja malva fina)
          'kHorS = mix(kHorS, vec3(0.788, 0.290, 0.227), smoothstep(-0.1045, -0.0349, sunY));\n' + // −2° #C94A3A (resplandor residual)
          'kHorS = mix(kHorS, vec3(1.0, 0.353, 0.0), smoothstep(-0.0349, 0.0, sunY));\n' + // 0° #FF5A00
          'kHorS = mix(kHorS, vec3(1.0, 0.620, 0.239), smoothstep(0.0, 0.0872, sunY));\n' + // +5° #FF9E3D
          'kHorS = mix(kHorS, vec3(1.0, 0.769, 0.420), smoothstep(0.0872, 0.1736, sunY));\n' + // +10° #FFC46B
          'vec3 kHorO = vec3(0.137, 0.173, 0.290);\n' + // −6° #232C4A
          'kHorO = mix(kHorO, vec3(0.290, 0.333, 0.439), smoothstep(-0.1045, -0.0349, sunY));\n' + // −2° #4A5570 (sombra de la Tierra alta)
          'kHorO = mix(kHorO, vec3(0.420, 0.478, 0.580), smoothstep(-0.0349, 0.0, sunY));\n' + // 0° #6B7A94 (sombra de la Tierra)
          'kHorO = mix(kHorO, vec3(0.659, 0.659, 0.784), smoothstep(0.0, 0.0872, sunY));\n' + // +5° #A8A8C8
          'kHorO = mix(kHorO, vec3(0.725, 0.784, 0.871), smoothstep(0.0872, 0.1736, sunY));\n' + // +10° #B9C8DE
          'float kBand = 0.031;\n' + // alto de la banda (sen del ángulo): −6° ≈ 1,8°
          'kBand = mix(kBand, 0.070, smoothstep(-0.1045, -0.0349, sunY));\n' + // −2° ≈ 4°
          'kBand = mix(kBand, 0.087, smoothstep(-0.0349, 0.0, sunY));\n' + // 0° ≈ 5°
          'kBand = mix(kBand, 0.139, smoothstep(0.0, 0.0872, sunY));\n' + // +5° ≈ 8°
          'kBand = mix(kBand, 0.174, smoothstep(0.0872, 0.1736, sunY));\n' + // +10° ≈ 10°
          'vec2 vH = normalize(sDir.xz + vec2(1e-5, 0.0));\n' +
          'vec2 sH = normalize(vSunDirection.xz + vec2(1e-5, 0.0));\n' +
          'float toward = pow(clamp(dot(vH, sH) * 0.5 + 0.5, 0.0, 1.0), 1.6);\n' + // 1 mirando al sol, 0 al antisol: el atardecer NO es simétrico (clamp: pow de base negativa es indefinido en GLSL)
          'vec3 horC = mix(kHorO, kHorS, toward);\n' +
          'float bandF2 = pow(1.0 - smoothstep(0.0, kBand, sDir.y), 1.25);\n' +
          'vec3 duskSky = mix(kZen, horC, bandF2);\n' +
          // Cinturón de Venus: banda rosa sobre la sombra de la Tierra en el
          // lado OPUESTO, visible de 0° a −4°, a ~6° sobre el horizonte
          'float venusW = (1.0 - toward) * (1.0 - smoothstep(0.02, 0.09, sunY)) * smoothstep(-0.09, -0.03, sunY);\n' +
          'float venusD = (sDir.y - 0.10) / 0.055;\n' +
          'float venusBand = exp(-venusD * venusD);\n' + // gaussiana sin pow(): pow con base negativa es indefinido en GLSL y en algunos drivers da NaN (cielo negro)
          'duskSky = mix(duskSky, vec3(0.851, 0.541, 0.541), venusW * venusBand * 0.55);\n' + // #D98A8A
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, duskSky, duskW * 0.88);\n' +
          'float muSun = dot(sDir, vSunDirection);\n' +
          /* FUNDIDO DE HORIZONTE DE LOS CUERPOS — el mismo del
             horizonFade del bloque de nubes (0,10 + 0,10·elevación
             de la capa): todo término modulado por el campo (rayos,
             ribete plateado, gris de cubierta, bordes de luna) muere
             con los cuerpos al acercarse al horizonte. Sin esto, la
             proyección plana del campo (cloudUV ∝ 1/y) se estira en
             VETAS VERTICALES y esos brillos quedaban colgando en la
             banda baja SIN nube encima: las «paredes» pálidas de la
             captura. Físicamente es la masa de aire rasante (~38 en
             el horizonte): a esa distancia el contraste del campo
             se lava en la luz del aire y no queda estructura. */
          'float horFadeF = smoothstep(0.0, 0.10 + 0.10 * cloudElevation, sDir.y);\n' +
          /* ===== NUBES–SOL (informe cloud-sun, 2026-11-22) =====
             Un solo escalar manda: T = exp(−τ), la transmitancia del sol
             a través de la capa de nubes, evaluada aquí con el MISMO campo
             que dibuja las nubes del skybox (v45: sin combinar con la
             réplica CPU del mismo campo — el campo se contaba dos veces).
             El disco se muestrea
             en 5 puntos (centro + limbo de 0,265°): con oclusión PARCIAL
             la parte destapada sigue deslumbrando (media luna, el caso de
             la foto de referencia); con oclusión TOTAL, T → 0 y disco,
             aureola y rayos colapsan JUNTOS — el error clásico era
             atenuar el disco y dejar el halo/rayos a plena fuerza, y el
             cielo entero se lavaba a blanco. */
          'vec3 sd3 = normalize(vSunDirection);\n' +
          'float csDay = smoothstep(-0.045, 0.05, sunY);\n' +
          'float tSunF = 1.0;\n' +
          'float discTrans = 1.0;\n' +
          'if ((cloudCoverage > 0.001 || uTestTau > 0.001) && csDay > 0.001) {\n' +
          '  float slantS = mix(1.7, 1.0, smoothstep(0.02, 0.35, sunY));\n' + // camino rasante: con el sol bajo el rayo cruza más capa (τ crece)
          '  tSunF = (cloudCoverage > 0.001 ? cloudTransAt(sd3, slantS) : 1.0) * testTransAt(sd3);\n' +
          '  vec3 tA = cross(vec3(0.0, 1.0, 0.0), sd3);\n' +
          '  tA = length(tA) < 0.05 ? vec3(1.0, 0.0, 0.0) : normalize(tA);\n' +
          '  vec3 tB = cross(sd3, tA);\n' +
          '  float tMax = tSunF; float tSum = tSunF;\n' +
          '  for (int k = 0; k < 4; k++) {\n' +
          '    float an = float(k) * 1.5707963;\n' +
          '    vec3 dp = normalize(sd3 + (tA * cos(an) + tB * sin(an)) * uSunHalfRad);\n' + // 0,00463 rad ≈ 0,265°: el limbo del disco
          '    float tk = (cloudCoverage > 0.001 ? cloudTransAt(dp, slantS) : 1.0) * testTransAt(dp);\n' +
          '    tMax = max(tMax, tk); tSum += tk;\n' +
          '  }\n' +
          '  float tSliver = 0.30 * (tSum * 0.2) + 0.70 * tMax;\n' + // manda la parte DESTAPADA (deslumbra), la media entra atenuada
          '  discTrans = clamp(tSliver, 0.0, 1.0);\n' + // UNA SOLA LEY DE DISCO (v45): la T del disco ES el muestreo de 5 puntos de (campo × prueba) — el mismo cómputo que el disco de la luna en la CPU (sliver). Antes se multiplicaba además por uSunTrans, la réplica JS del MISMO campo muestreada en el centro, y se sacaba la raíz del producto: el campo se contaba dos veces, con dos réplicas distintas, y el disco del sol obedecía otra fórmula que el de la luna. uSunTrans sigue mandando en lo difuso (luz, gris de cubierta), como moonTransSm en la luna.
          // AUREOLA: dispersión Mie hacia adelante en el velo fino. Crece
          // con T intermedio (sol tras cirros = foco cegador de pocos
          // grados) y colapsa con nube gruesa: es ANGULAR (grados), nunca
          // un velo global — el cielo lejos del sol conserva su azul.
          '  float aurF = (1.0 - tSunF) * (0.20 + 0.80 * tSunF);\n' +
          '  float aur = (pow(clamp(muSun, 0.0, 1.0), 320.0) * 1.15 + pow(clamp(muSun, 0.0, 1.0), 80.0) * 0.16) * aurF * csDay * (0.30 + 1.40 * uCircum);\n' +
          '  gl_FragColor.rgb += uSunDiscCol * aur * 0.45;\n' + // v54: pico ≈ 10 % de la radiancia del disco (×4,5) — el velo dispersa una fracción de la luz del disco, no compite con él; con 0,85 la aureola de velo llegaba a ~25 % y el disco se ahogaba en ella
          // BORDE PLATEADO / DORADO: el limbo fino de la nube vista hacia
          // el sol tiene gotas bastantes para desviar la luz hacia el ojo
          // pero no para bloquearla (HG g≈0,9): es lo más brillante del
          // encuadre tras el disco, y al ocaso sale dorado porque la luz
          // que lo ilumina ya viene enrojecida (uSunDiscCol).
          '  if (muSun > 0.80) {\n' +
          '    float aV = 1.0 - cloudTransAt(sDir, 1.0);\n' +
          '    float edgeV = aV * (1.0 - aV) * 4.0;\n' + // máximo justo en el borde semitransparente de la masa
          '    float hgS = clamp(0.19 / pow(max(1.81 - muSun * 1.80, 0.02), 1.5) * 1.2, 0.0, 3.0);\n' + // HG con g=0,9 coherente: (1−g²)=0,19, (1+g²)=1,81 — crece fuerte solo a pocos grados del sol
          '    gl_FragColor.rgb += uSunDiscCol * hgS * edgeV * uSilver * 0.55 * csDay * (0.12 + 0.88 * tSunF) * horFadeF;\n' +
          '  }\n' +
          // RAYOS CREPUSCULARES: corredores PARALELOS en el mundo, no un
          // abanico dibujado. Desde el punto donde el rayo de vista cruza
          // la capa se marcha el campo hacia el sol: por un claro pasa el
          // haz (brillo), bajo la masa queda el carril oscuro — la sombra
          // de la nube proyectada sobre el aire. La perspectiva los
          // abanica sola al mirar, y en el punto antisolar los mismos
          // corredores vuelven a converger (anticrepusculares, tenues).
          // NUBE DE PRUEBA: borde dorado y ABANICO crepuscular propios.
          // El borde: la franja semitransparente de la masa frente al
          // sol dispersa hacia adelante (HG) y sale dorada con la luz
          // ya enrojecida del disco. El abanico: haces que escapan por
          // los huecos ALREDEDOR de la masa — la T de la propia nube
          // hace de puerta (tras la masa, carril oscuro; por el hueco,
          // el haz) — con estructura angular en abanico desde el sol.
          // Su fuerza (uTestRays) la fija la CPU: máxima cuando el
          // borde de la nube cruza el disco (tapado parcial).
          '  if (uTestTau > 0.001 && csDay > 0.001) {\n' +
          '    float aT = 1.0 - testTransAt(sDir);\n' +
          '    float edgeTest = aT * (1.0 - aT) * 4.0;\n' +
          '    gl_FragColor.rgb += uSunDiscCol * edgeTest * pow(clamp(muSun, 0.0, 1.0), 6.0) * 0.8 * csDay;\n' +
          '    if (uTestRays > 0.003) {\n' +
          '      vec3 tAxv = normalize(cross(sd3, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));\n' +
          '      vec3 tBxv = cross(sd3, tAxv);\n' +
          '      vec2 pcT = vec2(dot(sDir, tAxv), dot(sDir, tBxv));\n' +
          '      float angT = atan(pcT.y, pcT.x);\n' +
          '      float wedges = 0.40 + 0.60 * pow(clamp(0.5 + 0.5 * sin(angT * 7.0 + 1.7) * sin(angT * 3.0 - 0.6) + 0.35 * sin(angT * 11.0 + 0.9), 0.0, 1.0), 1.5);\n' +
          '      float fanT = pow(clamp(muSun, 0.0, 1.0), 22.0) * 0.6 + pow(clamp(muSun, 0.0, 1.0), 90.0) * 1.1;\n' +
          '      float horT = smoothstep(-0.02, 0.05, sDir.y) * (1.0 - smoothstep(0.62, 0.98, sDir.y));\n' +
          '      gl_FragColor.rgb += uSunDiscCol * (uTestRays * testTransAt(sDir) * wedges * fanT * horT * csDay) * 1.5;\n' +
          '    }\n' +
          '  }\n' +
          '  if (uRays > 0.003 && sDir.y > -0.02) {\n' +
          '    float py2 = max(sDir.y, 0.05);\n' +
          '    float elevMixR = mix(1.0, 0.1, cloudElevation);\n' +
          '    vec2 puv = sDir.xz / (py2 * elevMixR) * cloudScale + time * cloudSpeed;\n' +
          '    vec2 mUV = puv * 1000.0;\n' +
          '    float evo2 = time * cloudSpeed * 300.0;\n' +
          '    vec2 rSt = puv;\n' +
          '    float rK = mix(1.0, 0.32, uCStretch);\n' +
          '    float rU = dot(rSt, vec2(0.7071));\n' +
          '    float rV = dot(rSt, vec2(-0.7071, 0.7071));\n' +
          '    rSt = vec2(0.7071) * (rU * rK) + vec2(-0.7071, 0.7071) * rV;\n' +
          '    float cn0 = clamp(fbm(rSt * 1000.0, evo2) * 0.7 + 0.5, 0.0, 1.0);\n' +
          '    float rBil = 1.0 - abs(noise(rSt * 2600.0 + vec2(13.7, 7.9) + evo2 * 0.7));\n' +
          '    cn0 = clamp(cn0 * (1.0 + uCBillow * (rBil - 0.45) * 0.55), 0.0, 1.0);\n' + // la MUESTRA BASE de la marcha lee el campo CON FORMA (estiramiento + billow, esquema §16), como los demás lectores: el corredor nace en la nube que se VE; los pasos siguientes siguen siendo la aproximación de 2 octavas

          '    float rg0 = noise(puv * 300.0) * 0.37 + 0.5;\n' +
          '    float th0 = 1.0 - clamp(cloudCoverage + (rg0 - 0.5) * 0.6, 0.0, 1.0);\n' +
          '    vec2 sAz = normalize(sd3.xz + vec2(1e-5, 0.0));\n' +
          '    float stepL = 0.55 * mix(2.6, 0.8, smoothstep(0.03, 0.45, sunY));\n' + // sol bajo = camino rasante largo = pasos largos
          '    float tauM = max(0.0, cn0 - th0) * 0.8;\n' +
          '    for (int s2 = 1; s2 <= 5; s2++) {\n' +
          '      vec2 sp3 = mUV + sAz * (float(s2) * stepL);\n' +
          '      float cnS = clamp((noise(sp3) + 0.5 * noise(sp3 * 2.03 + evo2)) * 0.7 + 0.5, 0.0, 1.0);\n' + // 2 octavas bastan para el corredor
          '      tauM += max(0.0, cnS - th0) * stepL;\n' +
          '    }\n' +
          '    float gapT = exp(-tauM * cloudDensity * 12.0 * uCloudSigma * 0.16);\n' + // transmitancia del corredor: 1 en el claro, ~0 bajo la masa
          '    float phR = pow(clamp(muSun, 0.0, 1.0), 20.0) * 0.55 + pow(clamp(muSun, 0.0, 1.0), 160.0) * 1.25;\n' + // fase hacia adelante: los haces se ven mirando hacia el sol
          '    float horR = smoothstep(-0.02, 0.05, sDir.y) * (1.0 - smoothstep(0.62, 0.98, sDir.y));\n' +
          '    gl_FragColor.rgb += uSunDiscCol * (uRays * gapT * phR * smoothstep(0.45, 0.90, muSun) * horR * csDay * horFadeF) * 0.85;\n' +
          '    float muA = dot(sDir, -sd3);\n' +
          '    gl_FragColor.rgb += uSunDiscCol * (uRays * gapT * pow(clamp(muA, 0.0, 1.0), 60.0) * smoothstep(0.80, 0.97, muA) * horR * csDay * horFadeF) * 0.16;\n' + // anticrepusculares
          '  }\n' +
          '}\n' +
          // halo Mie hacia adelante: MISMA transmitancia que el disco y
          // ganancia derivada de la radiancia del disco (v54): la aureola
          // circunsolar es luz del disco DISPERSADA por los aerosoles —
          // su pico vale una fracción chica de la radiancia del disco
          // (en cielo despejado, ~1–5 % a 1–5° del centro; el disco es
          // ~10⁴–10⁵ veces la radiancia del cielo vecino). Aquí el disco
          // se dibuja a ×4,5 sobre uSunDiscCol, así que el pico de la
          // aureola queda en 0,045 + 0,20 = 0,245 ≈ 5 % de 4,5: la
          // componente ancha (pow 30, semiancho ~12°) casi desaparece
          // (0,045) y manda la interna (pow 220, semiancho ~5°). Con los
          // coeficientes viejos (0,18 + 0,40 ≈ 13 % del disco, repartido
          // hasta 25° de diámetro) el atardecer era una mancha difusa
          // sin figura: el disco de 0,53° se ahogaba en su propio halo.
          'float mieGlow = pow(clamp(muSun, 0.0, 1.0), 30.0) * 0.045 + pow(clamp(muSun, 0.0, 1.0), 220.0) * 0.20;\n' +
          'gl_FragColor.rgb += uSunDiscCol * mieGlow * duskW * (0.03 + 0.97 * tSunF * tSunF);\n' + // el halo muere CON el disco: sin suelo residual — con τ grande no queda ni rastro de resplandor tras la nube
          /* El DISCO analítico ya NO se dibuja aquí: se dibuja DESPUÉS
             de la capa de niebla y del azul pleno (más abajo). La capa
             de niebla se aplicaba ENCIMA del disco con el camino
             rasante 1/sen θ calculado por píxel y clamp a 0,012: con
             el sol bajo, cualquier niebla presente (el clima vivo
             deriva la niebla a 0,02–0,10 aun en «soleado») mezclaba el
             disco 70–97 % hacia el color de niebla y la silueta
             desaparecía justo al ocaso — el fallo reportado. El disco
             es el objeto más brillante de la escena: la niebla lo
             atenúa por SU camino (un solo factor por la dirección del
             sol), no disolviéndolo píxel a píxel contra el horizonte. */
          'float skyDirY = normalize(vWorldPosition - cameraPosition).y;\n' +
          /* NIEBLA COMO CAPA (la banda marcada de la captura nocturna):
             la niebla real es una capa de gotas de altura finita sobre el
             suelo. Mirando al horizonte, el rayo la atraviesa entero
             (camino ∝ 1/sen θ, como la masa de aire) y el cielo ES color
             de niebla; mirando arriba, el rayo sale de la capa en pocos
             metros y el cielo queda LIMPIO y sin tocar. El factor es la
             extinción de Beer–Lambert de ese camino, 1 − exp(−τ₀/sen θ):
             continuo, sin borde en ningún ángulo — la banda vieja
             (smoothstep sobre una franja fija) dejaba una línea marcada
             donde terminaba, sobre todo de noche contra el cielo negro.
             τ₀ (uFogLayer) es la profundidad óptica cenital de la capa:
             crece con la niebla del momento; el color es uFogColor, el
             MISMO de la niebla del terreno — en el horizonte exacto
             cielo y suelo son el mismo color y no existe costura. */
          'float fogLayerF = 1.0 - exp(-uFogLayer / max(skyDirY, 0.012));\n' +
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(fogLayerF, 0.0, 1.0) * uFogBlend);\n' +
          // BAJO EL HORIZONTE el cielo ES el color del horizonte,
          // siempre: lo que se ve más allá del borde del suelo (1200 m,
          // él mismo fundido a este color en materials.js) no puede
          // recortarse contra un cielo distinto — sin esta fusión, con
          // niebla 0 el cielo bajo el horizonte quedaba con el color
          // crudo de Preetham y el borde del terreno se leía como una
          // línea recta, la «pared» de la captura.
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, (1.0 - smoothstep(-0.01, 0.015, skyDirY)) * 0.92);\n' +
          // Cielo despejado AZUL EN TODO (a pedido): el Preetham sin tone
          // mapping recorta a blanco la franja baja y el «halo blanco»
          // sobre el horizonte no salía con ningún ajuste de Rayleigh.
          // Con uBlueF (despejado de día) el color se mezcla hacia un
          // degradado azur analítico — horizonte azul cielo, cenit azul
          // profundo — en TODAS las direcciones sobre el horizonte, con
          // una muesca alrededor del disco solar para que su resplandor
          // físico (y los sprites del sol) sigan mandando ahí.
          'vec3 skyDirV = normalize(vWorldPosition - cameraPosition);\n' +
          'float azT = smoothstep(-0.02, 0.60, skyDirV.y);\n' +
          'vec3 azure = mix(vec3(0.32, 0.56, 0.90), vec3(0.06, 0.29, 0.78), azT);\n' +
          'float nearSun = smoothstep(0.9982, 0.99995, dot(skyDirV, vSunDirection));\n' +
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, azure, uBlueF * 0.85 * (1.0 - nearSun * 0.85));\n' +
          // DISCO analítico (movido aquí, tras niebla y azul): 0,53° de
          // diámetro físico, borde suavizado en ~0,06° (refracción),
          // color = transmitancia; × discTrans: la nube que lo tapa lo
          // apaga; × (1 − 0,85·fogSunF): la niebla lo atenúa por el
          // camino del SOL (fogSunF con sen de la elevación del sol, un
          // solo escalar para todo el disco) — con niebla 0 el factor
          // es 1 y el disco sale pleno, rojo/naranja al ocaso.
          'float fogSunF = (1.0 - exp(-max(uFogLayer - 0.03, 0.0) / max(sunY, 0.012))) * uFogBlend;\n' + // SOLO la niebla real atenúa el disco: uFogLayer trae un piso de 0,03 (la bruma mínima de la banda del horizonte) y con el camino rasante clampado a 0,012 ese piso solo le quitaba al disco hasta ~78 % a 0,5° de elevación AUN CON LA NIEBLA EN 0 — doble extinción, porque la tabla SUNSIM del color ya ES exp(−τ·m) con la masa de aire completa. Era el resto que seguía lavando la silueta al ocaso tras el arreglo v43 (reporte con foto, 23:22). Con niebla de verdad el término crece igual que antes (τ 0,27 a niebla plena mata el disco, como debe ser).
          'float discM = smoothstep(cos(uSunHalfRad + 0.00105), cos(uSunHalfRad), muSun) * smoothstep(-0.020, -0.004, sunY) * discTrans * (1.0 - 0.85 * fogSunF);\n' +
          'gl_FragColor.rgb = mix(gl_FragColor.rgb, uSunDiscCol * 4.5, discM);\n' +
          /* ===== EL SOL ES SOLO SU DISCO (v72, revisión estructural
             pedida por Guille 20:46: «la forma del sol no parece
             natural, parece hardcodeada») =====
             Fuera el término dibujado de la v67/v68 (estrella de
             difracción de 16+4 púas y resplandor compacto de dos
             lóbulos): era un efecto PINTADO sobre el cielo, con su
             propia ley paralela (T_R de Kasten & Young) que no era
             la que ilumina el mundo — de ahí la sensación de sol
             «hardcodeado» y de físicas toscas. Lo que queda es lo
             único que el modelo físico produce: el DISCO de 0,53°
             (la línea de arriba) con su color de transmitancia
             SUNSIM — la MISMA tabla que alimenta la luz direccional
             que ilumina la escena: lo que se ve es exactamente lo
             que alumbra. Su apariencia emerge sola de esa cadena:
             al mediodía la radiancia del disco (×4,5, la ganancia
             de contraste de la v44) satura el ACES y se lee como un
             punto cegador sobre el cielo, con la aureola que el
             propio cielo dispersa (el término Mie de la base, no un
             dibujo); al ocaso la transmitancia exp(−τ·m) lo baja
             órdenes de magnitud y queda su silueta naranja de borde
             nítido; la nube que lo cruza lo apaga por discTrans, el
             mismo muestreo que sombrea el suelo. Sin púas, sin
             lóbulos, sin compuertas de apariencia: si el disco
             alumbra, se ve; si no alumbra, no se ve. */
          /* ===== CUBIERTA CERRADA: el cielo tras la nube deja de existir =====
             El bloque de nubes del Sky mezcla su color sobre el cielo por
             alfa, y por el (1−alfa) restante se cuela el resplandor Mie
             del cielo base y su disco de 760×: con nubosidad alta eso era
             la gran mancha blanca donde está el sol, brillando A TRAVÉS
             de las nubes. Físicamente, tras una capa de τ grande no llega
             ni el haz directo ni el halo: la capa lo reemplaza todo por
             su propia radiancia difusa, gris y plana. Aquí se evalúa la
             transmitancia del rayo de VISTA por el mismo campo y se
             sustituye el cielo por ese gris en la medida de (1 − √Tvista)
             — crece más rápido que la atenuación del haz, porque la luz
             dispersada rellena el hueco: con τ grande el reemplazo es
             total (sin disco, sin halo, sin azul); en un claro (T≈1) no
             se toca nada y el sol pasa entero. Va ÚLTIMO a propósito:
             ni el azul pleno ni el fundido de niebla pueden reabrir el
             resplandor por encima de la cubierta. */
          'if (cloudCoverage > 0.001 || uTestTau > 0.001) {\n' +
          '  float tView = (cloudCoverage > 0.001 ? cloudTransAt(sDir, mix(1.7, 1.0, smoothstep(0.02, 0.35, clamp(sDir.y, 0.0, 1.0)))) : 1.0) * testTransAt(sDir);\n' +
          '  float deckW = clamp(max(cloudCoverage * 1.18, uTestTau > 0.001 ? 0.9 : 0.0), 0.0, 1.0) * clamp((sunY + 0.10) / 0.18, 0.0, 1.0);\n' + // de día/crepúsculo; de noche mandan la luna y las estrellas. La nube de prueba TAMBIÉN dibuja su cuerpo aquí: sin esto su masa no existía en el cielo — solo el sprite flotando dentro del halo del sol, y el sol se veía a través (captura del usuario)
          '  float fogK = clamp((uFogLayer - 0.03) / 2.2, 0.0, 1.0);\n' + // dentro de la niebla (v52): con la capa ópticamente gruesa NO se ve cubierta alguna — el gris de cubierta y su fusión de horizonte se apagan con fogK y manda la mezcla de niebla de arriba; sin este apagado, el overGrey (más oscuro que el color de niebla) re-oscurecía el cielo bajo por encima del suelo ya fundido y dejaba la banda blanca de la foto de las 09:28
          '  float gOcc = (1.0 - pow(clamp(tView, 0.0, 1.0), 0.5)) * deckW * (1.0 - fogK);\n' +
          '  float horMix = mix(horFadeF, 1.0, step(0.001, uTestTau) * 0.9);\n' + // cuánto del gris de cubierta sobrevive a esta elevación: muere hacia el horizonte (si no, el mosaico campo/hueco seguía dibujando columnas); la nube de prueba conserva su cuerpo en el cielo (es la sonda: su masa debe verse entera cruzando el sol bajo)
          '  gOcc *= horMix;\n' +
          '  vec3 overGrey = (uFogColor * 0.97 + vec3(0.010, 0.012, 0.016)) * (0.30 + 0.70 * clamp(min(uSunTrans, pow(clamp(tView, 0.0, 1.0), 0.35)), 0.0, 1.0));\n' + // gris de cubierta MODULADO por la T LOCAL del rayo de vista: tras el núcleo denso (tView→0, τ ≥15) la base vista desde abajo es GRIS OSCURA — la luz que la ilumina es la que sobrevivió el viaje por la nube (informe test-cloud §1/§3); en un claro (tView≈1) no se oscurece nada, aunque sea la nube de prueba la que tapa el sol para ESTE ojo: su sombra es local y el resto del cielo sigue brillante
          // DESACOPLE NUBOSIDAD↔BANDA (v52, dato de Guille 09:33: «mientras
          // más nubosidad, más se marca el horizonte con la neblina»): el
          // gris de cubierta puede ser mucho más OSCURO que el color del
          // horizonte (×0,30 tras un núcleo denso) y tanto gOcc como la
          // fusión horF crecen con la nubosidad — al llegar a la franja
          // baja pintaban ese gris oscuro SOBRE el suelo ya fundido al
          // color de niebla/horizonte, y la banda crecía con la cubierta.
          // Físicamente, a ángulo rasante el rayo a la cubierta cruza el
          // camino de aerosoles más largo: el sombreado propio de la nube
          // se lava y la franja converge al COLOR DEL HORIZONTE — el
          // mismo uFogColor al que el suelo funde su borde (invariante
          // del proyecto: en el horizonte cielo y suelo son UN color).
          // overGreyH aplica esa convergencia con el mismo horMix que
          // apaga la fuerza: arriba manda el gris de cubierta; en el
          // horizonte, el color del horizonte, haya la nubosidad que haya.
          '  vec3 overGreyH = mix(uFogColor, overGrey, horMix);\n' +
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, overGreyH, clamp(gOcc, 0.0, 0.93));\n' +
          // FUSIÓN DEL HORIZONTE (la «pared» de la captura): el campo de
          // nubes se proyecta sobre un plano, y al acercarse al horizonte
          // la proyección se estira al infinito — el ruido se convierte en
          // VETAS VERTICALES y por las columnas casi transparentes se
          // cuela el resplandor del cielo base como una pared brillante
          // sobre las siluetas. En el mundo real esa franja es aire con
          // aerosoles: uniforme y sin detalle. Aquí la franja baja
          // (< ~3°) se funde en proporción a la nubosidad, sin escalón:
          // el terreno se pierde en el cielo. El DESTINO de la fusión ya
          // NO es el gris de cubierta (v52, desacople nubosidad↔banda):
          // es uFogColor, el color del horizonte — el mismo al que el
          // suelo funde su borde y al que converge overGreyH — así la
          // fusión sigue matando las vetas pero no puede abrir ninguna
          // banda, crezca lo que crezca la nubosidad.
          '  float horF = (1.0 - smoothstep(0.0, 0.11, sDir.y)) * clamp(cloudCoverage * 1.6, 0.0, 1.0) * (1.0 - duskW * 0.55) * (1.0 - fogK);\n' + // banda de fusión al COLOR DEL HORIZONTE hasta ~6,3°: cubre toda la zona donde la proyección de nubes se estira en vetas (la «pared»); dentro de la niebla se apaga con fogK (v52)
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, horF * 0.88);\n' +
          '}\n' +
          /* ===== LUNA ENTRE CÚMULOS ROTOS (foto de referencia) =====
             La MISMA física que el borde plateado del sol, hacia la
             luna: el limbo semitransparente de la nube vista hacia la
             luna brilla plateado (dispersión hacia adelante, HG g≈0,9),
             la aureola atraviesa el velo fino y un resplandor azul
             profundo amplio rodea la zona — el cielo alto limpio de la
             foto. La fuerza (uMoonSilver) la regula weather.js con la
             cadena real: fase × elevación × T_luna × slider de luna;
             sin luna o de día vale 0 y este bloque no toca nada. El
             disco de la luna es un sprite que se dibuja DESPUÉS (queda
             en el hueco del deck, por encima de las nubes), y los
             cúmulos volumétricos reciben la misma luz por la
             direccional nocturna. */
          /* ===== ARCOÍRIS (Descartes, esquema §15) =====
             Geometría pura sobre el punto ANTISOLAR (−sol): el arco
             está centrado ahí, así que sigue a la cámara sin objeto
             alguno. PRIMARIO a 42° (rojo fuera, violeta dentro a
             40°); SECUNDARIO a 51–53°, más tenue y con los colores
             INVERTIDOS (dos reflexiones internas); entre ambos, la
             banda de ALEXANDER, más oscura porque de las gotas casi
             no llega luz desviada a 43–50°. La altura del arco
             (42° − elevación del sol) y su desaparición con el sol
             alto salen de la geometría + la fuerza uRainbow de la
             CPU (lluvia × sol <42° × luz directa). El color se tiñe
             con el del disco a sol bajo: la luz que se refracta ya
             viene enrojecida por su masa de aire (el arcoíris del
             ocaso es casi todo rojo/naranja, como el real). */
          'if (uRainbow > 0.003) {\n' +
          '  float angA = degrees(acos(clamp(dot(sDir, -sd3), -1.0, 1.0)));\n' + // ángulo al punto antisolar
          '  float rbFade = smoothstep(-0.01, 0.02, sDir.y);\n' + // el arco se apoya en el horizonte visible; bajo él manda el terreno
          '  vec3 rbTint = mix(vec3(1.0), clamp(uSunDiscCol * 1.30, vec3(0.12), vec3(1.0)), (1.0 - smoothstep(0.0, 0.45, sunY)) * 0.65);\n' +
          '  float pBand = smoothstep(39.2, 40.6, angA) * (1.0 - smoothstep(41.9, 42.9, angA));\n' +
          '  if (pBand > 0.001) {\n' +
          '    vec3 bowCol = spectral(clamp((angA - 40.0) / 2.2, 0.0, 1.0)) * rbTint;\n' + // 40° violeta → 42,2° rojo
          '    gl_FragColor.rgb += bowCol * (pBand * uRainbow * 0.65) * rbFade;\n' +
          '  }\n' +
          '  float alex = smoothstep(42.9, 44.0, angA) * (1.0 - smoothstep(49.5, 50.8, angA));\n' +
          '  gl_FragColor.rgb *= 1.0 - alex * uRainbow * 0.12 * rbFade;\n' + // banda de Alexander: el cielo entre arcos, levemente más oscuro
          '  float sBand = smoothstep(50.2, 51.2, angA) * (1.0 - smoothstep(52.8, 54.2, angA));\n' +
          '  if (sBand > 0.001) {\n' +
          '    vec3 bowCol2 = spectral(1.0 - clamp((angA - 51.0) / 2.2, 0.0, 1.0)) * rbTint;\n' + // invertido: 51° rojo → 53,2° violeta
          '    gl_FragColor.rgb += bowCol2 * (sBand * uRainbow * 0.26) * rbFade;\n' +
          '  }\n' +
          '}\n' +
          'if (uMoonSilver > 0.003) {\n' +
          '  float muM = dot(sDir, uMoonDir);\n' +
          '  vec3 moonTint = vec3(0.74, 0.82, 0.99);\n' + // plateado percibido (la luz es cálida 4100 K; el plateado azulado es la percepción mesópica, como el halo del sprite)
          '  float tMoonComb = (cloudCoverage > 0.001 ? cloudTransAt(uMoonDir, 1.0) : 1.0) * testTransAt(uMoonDir);\n' + // T combinada (campo × prueba) hacia el centro de la luna — la misma que apaga el disco sprite en la CPU: es la puerta de la aureola y del resplandor cercano (v45; antes esos términos solo leían el campo por píxel o ni eso, y con la nube de prueba sobre la luna el disco moría pero el resplandor quedaba)
          '  if (cloudCoverage > 0.001) {\n' +
          '    float gM = smoothstep(0.40, 0.78, muM);\n' + // SIN compuerta dura (v44): el if (muM > 0.75) viejo cortaba el ribete y la aureola de golpe a 41,4° de la luna y ese escalón se leía como un CÍRCULO enorme alrededor de la luna conteniendo las nubes (captura 23:24). El HG real sí se concentra hacia adelante, pero decae CONTINUO: este fundido ancho lo reparte sin borde en ningún ángulo.
          '    float aVM = 1.0 - cloudTransAt(sDir, 1.0) * testTransAt(sDir);\n' + // campo × prueba, como el tSunF del sol (v45): el ribete lunar también se apaga tras la nube de prueba, no solo tras el campo
          '    float edgeM = aVM * (1.0 - aVM) * 4.0;\n' + // máximo en el limbo semitransparente de la masa
          '    float hgM = clamp(0.19 / pow(max(1.81 - muM * 1.80, 0.02), 1.5) * 1.2, 0.0, 3.0);\n' + // HG g=0,9, igual que el borde del sol
          '    gl_FragColor.rgb += moonTint * hgM * edgeM * uMoonSilver * 0.55 * horFadeF * gM;\n' +
          '    float tMC = tMoonComb;\n' + // T combinada hacia la luna (campo × prueba), calculada una sola vez arriba
          '    float aurM = (pow(clamp(muM, 0.0, 1.0), 320.0) * 1.10 + pow(clamp(muM, 0.0, 1.0), 48.0) * 0.28) * (1.0 - tMC) * (0.20 + 0.80 * tMC);\n' + // aureola tras velo fino: crece con T intermedio, muere con cubierta total
          '    gl_FragColor.rgb += moonTint * aurM * uMoonSilver * 0.85 * horFadeF * gM;\n' +
          '  }\n' +
          '  gl_FragColor.rgb += vec3(0.07, 0.12, 0.26) * pow(clamp(muM, 0.0, 1.0), 24.0) * uMoonSilver * 0.35 * (0.03 + 0.97 * tMoonComb);\n' + // aureola cercana a la luna (v44): era pow 6 × 0,55 — un disco azul de decenas de grados sobre un cielo casi negro, la otra mitad del «círculo» reportado. La dispersión real junto a la luna es una aureola de pocos grados: pow 24 la abraza al disco y decae continua, sin borde; el brillo ancho de la noche lo dan las nubes iluminadas en todo el cielo (cloudColor, arriba), no un foco centrado en la luna. (v45: y muere con la T combinada hacia la luna, como el halo Mie del sol muere con tSunF.)
          '}');
        sky.material.needsUpdate = true;
        skyPatchOk = true;
      }
    } catch (e) { skyPatchOk = false; }
    // Nubes propias del shader del cielo (skybox): arrancan apagadas y las
    // gobierna weather.js con la nubosidad real de cada frame, para que
    // combinen con las volumétricas y con nubosidad 0 el cielo quede
    // despejado de verdad, sin nubes residuales del valor por defecto.
    if (sky.material.uniforms.cloudCoverage) sky.material.uniforms.cloudCoverage.value = 0;
    if (sky.material.uniforms.cloudDensity) sky.material.uniforms.cloudDensity.value = 0.4;
    // Si el Sky parcheado no compila en este equipo, se restaura el shader
    // original de three (cielo estándar con sol): nunca cielo negro.
    watchShader(sky.material, function () {
      sky.material.fragmentShader = SKY_FRAG_ORIG;
      sky.material.needsUpdate = true;
      skyPatchOk = false;
    });
    sky.material.uniforms.turbidity.value = 5.5;
    sky.material.uniforms.rayleigh.value = 1.6;
    sky.material.uniforms.mieCoefficient.value = 0.0038;
    sky.material.uniforms.mieDirectionalG.value = 0.85;

    var sun = new THREE.DirectionalLight(0xffe9c0, 2.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    /* PENUMBRA FÍSICA (v54, fenómeno→consecuencia): el sol NO es un
       punto — es un disco de 0,53° de diámetro angular. Un borde de
       oclusor a distancia d del receptor (a lo largo del rayo) proyecta
       una penumbra de ancho d · tan(0,53°) ≈ d · 0,00925: para una
       lápida de ~1,5 m al mediodía, d ≈ 1,7 m y la penumbra mide
       ~1,6 cm — las sombras despejadas reales son NÍTIDAS, como la
       foto de las cruces que trajo Guille. El muestreo PCF de three
       (disco de Vogel de 5 taps) reparte sus taps en un disco de
       radio shadow.radius TÉXELES: el ancho de transición del borde
       es ≈ 2 · radius · téxel. Con la cámara vieja (±58 m, téxel de
       5,7 cm) y radius 4, la transición medía ~45 cm — entre 10 y 30
       veces la penumbra física, y con solo 5 taps tan separados el
       borde salía además moteado: las «sombras difuminadas» de la
       captura. Arreglo por la misma ley, sin parches: (1) la cámara
       de sombras se cierra a ±42 m (téxel de 4,1 cm — el campo que el
       jugador realmente examina; fuera de él mandan los LOD lejanos);
       (2) shadow.radius lo calcula weather.js CADA FRAME desde la
       geometría: radius = (h / sen e) · tan(0,53°) / (2 · téxel),
       con h = 1,5 m (oclusor típico: lápida/cruz) y e la elevación de
       la fuente activa — al bajar el sol el camino oclusor→receptor
       se alarga (1/sen e) y la penumbra crece sola, como en la
       realidad; con la fuente tapada por nubes el «disco» pasa a ser
       el cielo entero y la sombra dura desaparece por la otra vía ya
       existente (shadow.intensity ∝ T). PISO DE MUESTREO (v56): el
       clamp inferior NO es «un téxel»: el PCF de three es un disco
       de Vogel de SOLO 5 taps rotado por ruido entrelazado en cada
       píxel; con radio 0,7 los 5 taps caen dentro de la misma celda
       de 4,1 cm y un borde de penumbra física sub-téxel (la cornisa
       del panteón está a ~0,3 m de su pared: penumbra real ~3 mm)
       se dibuja cuantizado en escalones de un téxel — en una pared
       vertical cada escalón se estira a ~6 cm: el «serrucho» de la
       foto de Guille (2026-11-22). El piso correcto es el de
       Nyquist del filtro: radio 1,5 téxeles, para que el disco
       cruce siempre las celdas vecinas y la comparación se
       interpole entre ellas — transición de ~3 téxeles (~12 cm),
       el borde más fino que este mapa puede dibujar SIN escalones
       (y 3–4× más nítido que los ~45 cm de la era difusa). La
       penumbra física manda por encima del piso, como siempre.
       RECALIBRACIÓN v57 (reporte de Guille con fotos, 2026-11-22
       12:13: luz por los bordes en las juntas): el suelo de la
       transición ES la franja que se ve — a 1,5 téxeles el borde
       de sombra se reparte en ~12 cm y su mitad iluminada abraza
       cada base y cada junta piso–pared como una línea de luz
       (la penumbra física de una base de 0,18 m al mediodía mide
       ~2 mm: el mapa no puede bajar de ~1 téxel, pero 12 cm es
       6× ese mínimo). El piso baja a 1,0 téxel: el disco de Vogel
       ya cruza la celda vecina (a 0,7 TODOS los taps caían en la
       misma celda — ese era el serrucho de la v55; a 1,0 las
       muestras ya se reparten entre dos celdas y la comparación
       interpola parcialmente), la transición queda en ~2 téxeles
       (~8 cm) y la franja luminosa pegada a la junta se reduce a
       ~4 cm al 50 %, el mínimo honesto de este mapa. Si el
       serrucho reaparece en bordes largos, el compromiso está
       documentado aquí y en el TODO. */
    sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 240;
    sun.shadow.bias = -0.00018;
    /* SOMBRA DE CONTACTO (v55, fenómeno→consecuencia): el normalBias
       eleva el punto de muestreo del receptor a lo largo de su normal
       antes de comparar profundidades. En el suelo (normal +Y) eso
       levanta la muestra normalBias metros, y el borde de la sombra se
       corre hacia el oclusor en normalBias / tan(elevación): con el
       valor viejo (0,05) la sombra nacía ~7 cm separada de cada base
       a sol de 35° — una franja de suelo ILUMINADO rodeando la junta,
       que es la «separación» que reportó Guille. Peor con las piezas
       bajas: la losa de la fosa mide 0,055 m de alto, así que una
       muestra elevada 0,05 m queda casi a su coronación y su sombra
       de contacto directamente desaparecía (el rayo elevado la
       sobrevuela). Ley: el normalBias debe quedar MUY por debajo de
       la altura del oclusor más bajo que debe anclar su sombra —
       0,015 m ≈ ⅓ del téxel de 4,1 cm y ¼ de la losa: el corrimiento
       residual es ~2 cm a 35° y ~1 cm al mediodía, dentro de la junta
       ya sellada por el hundimiento de las bases (SEAT_SINK,
       geometry.js). El bias de profundidad (−0,00018 ≈ 4 cm de
       holgura sobre el rango 10–240 m) queda como estaba: es el que
       mantiene a raya el acné sin despegar sombras. */
    sun.shadow.normalBias = 0.015;
    sun.shadow.radius = 1.0; // valor inicial = piso de muestreo (v57; era 1,5 en v56); weather.js lo deriva por frame de la penumbra física (arriba)
    scene.add(sun); scene.add(sun.target);
    var hemi = new THREE.HemisphereLight(0xbdd7f2, 0x8a7f5c, 0.85);
    scene.add(hemi);

    /* ================= Pasada PURKINJE (percepción, no luz) =================
       La escena se renderiza a un target HDR lineal y un quad final
       aplica el efecto Purkinje POR PÍXEL antes del tone mapping
       (ACES propio de la pasada + gamma): la fracción escotópica
       global s sale de la luminancia de adaptación La (weather.js,
       PURK) y cada píxel brillante se exime solo (el disco de la luna
       y la linterna son fotópicos y conservan su color cálido). Los
       píxeles tenues se desaturan hacia un gris escotópico pesado a
       verde-azul (V′ culmina a 507 nm; pesos RGB APROXIMADOS, no
       medidos) y se reequilibran R↓/B↑: las ganancias 0,45/0,95/1,22
       son constantes de AJUSTE del informe moonlight-colors §4.4,
       calibradas para que un rojo y un azul de igual luminancia
       fotópica inviertan su brillo relativo, como el geranio de
       Purkinje. Si el target o el shader fallan en este WebGL, se
       renderiza directo como siempre (PURK_OK = false). */
    var PURK_OK = false, purkRT = null, purkScene = null, purkCam = null, purkMat = null;
    /* uMirage lo comparte el shader del suelo (materials.js) con el
       cálculo de weather.js: espejismo inferior como mezcla rasante
       hacia el color del cielo en el suelo lejano. */
    var MIRAGE_U = { value: 0 };
    try {
      purkRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType });
      if (renderer.capabilities.isWebGL2) purkRT.samples = 4;
      purkRT.depthTexture = new THREE.DepthTexture(window.innerWidth, window.innerHeight); // la calima se enmascara por DISTANCIA REAL (abajo), no por banda de pantalla
      purkMat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: purkRT.texture }, tDepth: { value: purkRT.depthTexture }, uNear: { value: 0.1 }, uFar: { value: 3000 }, uS: { value: 0 }, uExposure: { value: 0.78 }, uHaze: { value: 0 }, uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: [
          'uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform float uS; uniform float uExposure; uniform float uHaze; uniform float uTime;',
          'varying vec2 vUv;',
          'vec3 acesP(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }',
          'float hhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
          'float hnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hhash(i), hhash(i + vec2(1.0, 0.0)), f.x), mix(hhash(i + vec2(0.0, 1.0)), hhash(i + vec2(1.0, 1.0)), f.x), f.y); }',
          'void main() {',
          // CALIMA (informe mirage + Wikipedia «Heat haze»): la
          // distorsión por calor es un efecto de LEJOS — crece con la
          // distancia y la magnificación, y la ilusión se aleja al
          // acercarse, como un arcoíris: nunca se está cerca de ella.
          // Por eso la máscara sale de la PROFUNDIDAD REAL del frame
          // (tDepth): cero junto a la cámara (<10 m), plena al fondo
          // (>55 m), multiplicada por la banda vertical del aire bajo
          // (0–2 m sobre el suelo caliente). Dos capas de ruido que
          // SUBEN (el aire caliente asciende) corren el muestreo.
          '  vec2 huv = vUv * vec2(16.0, 10.0);',
          '  float hn1 = hnoise(huv + vec2(0.0, -uTime * 1.4));',
          '  float hn2 = hnoise(huv * 2.3 + vec2(5.2, -uTime * 2.3));',
          '  float depP = texture2D(tDepth, vUv).x;',
          '  float viewZP = (uNear * uFar) / ((uFar - uNear) * depP - uFar);',
          '  float depthMask = smoothstep(10.0, 55.0, -viewZP);', // 0 cerca, 1 al fondo: ninguna ondulación junto al jugador
          '  float hband = smoothstep(1.02, 0.55, vUv.y) * smoothstep(0.0, 0.16, vUv.y) * depthMask;',
          '  vec2 hoff = vec2(hn1 - 0.5, hn2 - 0.5) * uHaze * hband;',
          '  vec3 c = texture2D(tDiffuse, vUv + hoff).rgb;',
          '  float Lp = dot(c, vec3(0.2126, 0.7152, 0.0722));',
          '  float sPix = uS * (1.0 - smoothstep(0.8, 2.6, Lp));', // exención de píxeles brillantes (calibrada en unidades lineales HDR de la escena)
          '  vec3 grey = vec3(dot(c, vec3(0.06, 0.52, 0.42)));', // luminancia escotópica aproximada: verde-azul arriba, rojo abajo
          '  vec3 col = mix(c, grey, clamp(sPix * 0.88, 0.0, 1.0));',
          '  col.r *= mix(1.0, 0.45, sPix); col.g *= mix(1.0, 0.95, sPix); col.b *= mix(1.0, 1.22, sPix);',
          '  col = acesP(col * uExposure);',
          '  col = pow(col, vec3(0.4545));',
          '  gl_FragColor = vec4(col, 1.0);',
          '}'
        ].join('\n'),
        depthTest: false, depthWrite: false
      });
      purkScene = new THREE.Scene();
      purkScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), purkMat));
      purkCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      PURK_OK = true;
      watchShader(purkMat, function () { PURK_OK = false; });
    } catch (e) { PURK_OK = false; }

    /* ================= Linterna: spotlight real desde la cámara =================
       Cono de luz físico (SpotLight con decaimiento y sombra) montado en la
       cámara: ilumina tumbas, suelo y mausoleos dentro del cono y es la única
       luz que permite leer placas cuando el sol no alcanza. El cono tenue
       visible simula el haz dispersándose en la niebla cercana. */
    var flashOn = false, flashLevel = 0; // flashLevel: fundido suave de encendido
    var flashFogK = 0; // extinción del haz por la niebla (0 = aire claro, 1 = niebla máxima): la escribe main.js cada frame desde la densidad real del FogExp2
    var worldLight = { ambient: 1, elev: 58, dayF: 1, occ: 0 }; // luz real del momento (la actualiza updateEnvironment)
    var sunGlow = 1; // brillo del sol regulable (slider en Iluminación): escala glow/halo del disco e intensidad de su luz
    var moonGlow = 1; // brillo de la luna regulable (slider en Iluminación): escala brillo del disco, su glow/halo e intensidad de su luz
    var flashlight = new THREE.SpotLight(0xffdfae, 0, 30, 0.50, 0.55, 1.5);
    flashlight.position.set(0.18, -0.12, 0.06);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.set(1024, 1024);
    flashlight.shadow.camera.near = 0.3;
    flashlight.shadow.camera.far = 30;
    flashlight.shadow.bias = -0.0004;
    flashlight.shadow.normalBias = 0.03;
    flashlight.target.position.set(0, 0, -8);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera);
    /* CONO VISIBLE EN LA NIEBLA (v71, pedido de Guille): la física
       real de apuntar una linterna a la niebla — la dispersión de
       Mie hacia adelante hace VISIBLE el haz (las gotitas dentro
       del cono dispersan luz hacia el ojo) y la retrodispersión
       vela lo lejano (eso ya lo modelan la atenuación v52 del
       SpotLight y el FogExp2 de los materiales: el círculo alumbrado
       al final del cono es lo que se alcanza a ver, un poco más que
       sin linterna porque el haz concentra las candelas ahí).
       Historia: un intento anterior con un cilindro aditivo visto
       desde su vértice dibujaba un ANILLO brillante en pantalla y se
       retiró. Este diseño lo evita por construcción:
       · solo BackSide: se dibuja la pared lejana del cono, nunca la
         cercana que formaba el anillo;
       · la alfa se apaga cerca del vértice (los primeros 25 cm no
         existen en pantalla) y hacia el borde angular del cono
         (smoothstep contra el semángulo real del SpotLight, 0,50
         rad): sin silueta dura ni anillo;
       · decae con la distancia a lo largo del haz (la luz que llega
         lejos ya se extinguió: (1−t)^1,6, la misma extinción que
         sufre el SpotLight) y lleva un ruido advectado tenue para
         que la niebla dentro del cono se mueva;
       · su fuerza es ∝ flashFogK: en aire claro el cono es casi
         invisible (queda un 4 % por el polvo del aire); en niebla
         densa manda el cono lechoso de pocos metros, con la longitud
         del alcance real de la linterna de este frame. */
    var flashConeUni = {
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uAxis: { value: new THREE.Vector3(0, 0, -1) },
      uCamPos: { value: new THREE.Vector3() },
      uNoise: { value: null }
    };
    var flashConeMat = new THREE.ShaderMaterial({
      uniforms: flashConeUni,
      vertexShader: [
        'varying vec2 vUv;',
        'varying vec3 vWp;',
        'void main() {',
        '  vUv = uv;',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWp = wp.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uFlash;',
        'uniform float uTime;',
        'uniform vec3 uAxis;',
        'uniform vec3 uCamPos;',
        'uniform sampler2D uNoise;',
        'varying vec2 vUv;',
        'varying vec3 vWp;',
        'void main() {',
        '  float t = vUv.y; // 0 en el vértice, 1 al final del cono',
        '  vec3 rel = vWp - uCamPos;',
        '  float dist = length(rel);',
        '  float cosA = dot(rel / max(dist, 0.001), uAxis);',
        '  float ang = acos(clamp(cosA, -1.0, 1.0));',
        '  float rim = smoothstep(0.50, 0.30, ang); // borde angular suave contra el semángulo del SpotLight',
        '  float nearF = smoothstep(0.02, 0.10, t); // nada pegado al vértice: ahí nacía el anillo',
        '  float reach = pow(1.0 - t, 1.6);',
        '  float nz = texture2D(uNoise, vec2(vUv.x * 2.0, vUv.y * 1.5 - uTime * 0.05)).r;',
        '  float a = uFlash * rim * nearF * reach * (0.75 + 0.5 * nz);',
        '  if (a < 0.004) discard;',
        '  gl_FragColor = vec4(vec3(1.0, 0.875, 0.68), a);',
        '}'
      ].join('\n'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false
    });
    var flashConeGeo = new THREE.CylinderGeometry(Math.tan(0.50), 0.004, 1, 24, 1, true); // top = extremo lejano (ancho, tan del semángulo), bottom = vértice en la linterna; vUv.y = 0 en el vértice y 1 al fondo
    flashConeGeo.translate(0, 0.5, 0); // el vértice en el origen, el cono crece hacia +Y local…
    var flashCone = new THREE.Mesh(flashConeGeo, flashConeMat);
    flashCone.rotation.x = -Math.PI / 2; // …y la rotación lo apunta hacia −Z (el frente de la cámara)
    flashCone.position.copy(flashlight.position);
    flashCone.renderOrder = 8;
    flashCone.frustumCulled = false;
    flashCone.visible = false;
    camera.add(flashCone);
    // ruido de valor para la niebla dentro del cono (textura propia, pequeña)
    (function () {
      var S = 128, data = new Uint8Array(S * S * 4), vals = new Float32Array(S * S), sm = new Float32Array(S * S), x, y, i;
      for (i = 0; i < S * S; i++) vals[i] = Math.random();
      for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
        var acc = 0;
        for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) acc += vals[(((y + oy + S) % S) * S + ((x + ox + S) % S))];
        sm[y * S + x] = acc / 9;
      }
      for (i = 0; i < S * S; i++) { var v = Math.floor(clamp(sm[i], 0, 1) * 255); data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
      var tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      flashConeUni.uNoise.value = tex;
    })();
    var FLASH_MAX = 34; // candelas (luz física): a 3 m alumbra como el sol del mediodía
    /* LINTERNA CON 3 INTENSIDADES (v65, pedido de Guille): cada
       apretón (F o el botón) avanza un paso del ciclo — apagada →
       BAJA → MEDIA → ALTA → apagada. Al encender arranca siempre en
       la más baja. Los niveles son fracciones de FLASH_MAX (las
       candelas físicas de la alta): 0,30 / 0,60 / 1,00 — y como
       flashLevel interpola hacia la fracción del paso, el cambio de
       nivel también es un fundido suave, y estimateLightAt (la
       legibilidad de placas) lee el nivel real de este frame. */
    var FLASH_FRAC = [0, 0.30, 0.60, 1.0];
    var FLASH_NAMES = ['NO', 'BAJA', 'MEDIA', 'ALTA'];
    var flashStep = 0;
    function cycleFlash() {
      flashStep = (flashStep + 1) % 4;
      flashOn = flashStep > 0;
      var b = document.getElementById('btnFlash');
      if (b) { b.textContent = 'LINTERNA · ' + FLASH_NAMES[flashStep]; b.classList.toggle('on', flashOn); b.setAttribute('aria-pressed', flashOn ? 'true' : 'false'); }
      currentLit = null; // fuerza a reevaluar si la placa cercana ya se puede leer
    }
    function setFlash(on) { // compatibilidad con la API de debug (state().setFlash): encender = nivel BAJO, apagar = paso 0
      flashStep = on ? 1 : 0;
      flashOn = flashStep > 0;
      var b = document.getElementById('btnFlash');
      if (b) { b.textContent = 'LINTERNA · ' + FLASH_NAMES[flashStep]; b.classList.toggle('on', flashOn); b.setAttribute('aria-pressed', flashOn ? 'true' : 'false'); }
      currentLit = null;
    }
    document.getElementById('btnFlash').addEventListener('click', cycleFlash);
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyF') return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      cycleFlash();
    });
    /* Factor de abertura de un punto INTERIOR (v59): la misma ley que
       el parche de materiales (materials.js, applyInteriorPatch) — si
       el punto cae dentro de la cavidad de un panteón (retícula de
       30 m, centro local (11, 11), planta la de ese panteón — 4,6 ×
       3,9 clásica o 5,9 × 5,0 grande, pared 0,28 — leída del chunk),
       la luz ambiental que lo alcanza es la de fuera reducida por el
       ángulo sólido de la puerta desde ese punto, f = A/(A + π·d²)
       con A = 2,76 m² y piso 0,03 de interreflexión, escalado por el
       slider LUZ INTERIOR. Fuera de la cavidad vale 1 (sin cambio).
       La altura del punto se toma como la de los nichos (~1,55 m). */
    function interiorApertureAt(tx, tz) {
      var lx = tx - 11 - 30 * Math.round((tx - 11) / 30);
      var lz = tz - 11 - 30 * Math.round((tz - 11) / 30);
      // planta real del panteón de este chunk (v64: clásica o grande);
      // sin panteón, la clásica — y fuera de su cavidad vale 1 igual
      var ch = null;
      if (typeof chunks !== 'undefined' && typeof keyOf === 'function') ch = chunks[keyOf(Math.floor(tx / 30), Math.floor(tz / 30))];
      var halfW = (ch && ch.maus) ? ch.maus.halfW : 2.3, halfD = (ch && ch.maus) ? ch.maus.halfD : 1.95;
      if (Math.abs(lx) > halfW - 0.22 || Math.abs(lz) > halfD - 0.22) return 1;
      var dx = lx, dy = 1.55 - 1.15, dz = lz + (halfD - 0.14); // distancia al centro de la puerta (local (0, 1,15, −(D/2−T/2)))
      var d2 = dx * dx + dy * dy + dz * dz;
      var doorF = (ch && typeof ch.doorF === 'number') ? ch.doorF : 1; // puerta con estado (v65): cerrada o sellada → 0; el giro de la hoja la abre en la CPU igual que en el shader (uDoorOpen)
      var om = 2.76 * doorF / Math.max(d2, 0.04); // Ω de la puerta; el factor es Ω/(Ω+π) — idéntico a A/(A+π·d²) de la v59
      // VENTANA ÚNICA (v60/v64): si el panteón de este chunk la lleva
      // (world.js guarda su cfg en el chunk: pared y centro en coords
      // del chunk), su Ω × transmitancia del cristal se suma al de la
      // puerta — la misma ley que el parche del shader
      if (ch && ch.win) {
        var w1x = lx - ch.win.x, wy2 = 1.55 - 1.85, wz2 = lz - ch.win.zc;
        om += ch.win.area * ch.win.trans / Math.max(w1x * w1x + wy2 * wy2 + wz2 * wz2, 0.04);
      }
      var ap = clamp(om / (om + Math.PI), 0.03, 0.55);
      var g = (typeof INT_U !== 'undefined') ? INT_U.uInterior.value : 1;
      return clamp(ap * g, 0, 1);
    }
    /* Luz real que cae sobre un punto: ambiente del sol/luna del momento
       (ya atenuada por nubes y tormenta) más el cono de la linterna si el
       punto está dentro del haz y a su alcance. Sin luz, no hay lectura.
       Dentro de un panteón, el ambiente entra solo por la puerta
       (interiorApertureAt): un nicho interior al atardecer no se lee
       sin linterna; la linterna NO se atenúa — es luz propia llevada
       en la mano y alumbra el interior a plena potencia. */
    function estimateLightAt(tx, tz) {
      var L = worldLight.ambient * interiorApertureAt(tx, tz);
      if (flashLevel > 0.05) {
        var vx = tx - camera.position.x, vy = 1.05 - camera.position.y, vz = tz - camera.position.z;
        var d = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (d > 0.001 && d < 12) {
          var cp = Math.cos(pitch);
          var fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
          var dot = (vx * fx + vy * fy + vz * fz) / d;
          var cone = clamp((dot - 0.60) / 0.34, 0, 1);
          L += flashLevel * cone * clamp(1 - d / 12, 0, 1) * 1.6 * (1 - 0.75 * flashFogK); // en niebla el haz se extingue en el camino: la luz ÚTIL que llega a la placa cae con la capa (v52)
        }
      }
      return L;
    }
    var READ_LIGHT_MIN = 0.34; // por debajo de esto, una placa es ilegible
