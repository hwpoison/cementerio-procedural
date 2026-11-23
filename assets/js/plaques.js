/* plaques.js — Generador de placas: 48 placas únicas (registro de persona:
   nombre, fechas, epitafio y medallón foto-cerámico con el rostro de su
   época, v66) en un atlas de canvas. Depende de: utils. */
'use strict';
    /* ================= Generador de placas =================
       48 placas únicas en un atlas 2048×1920 (8×6 celdas de 256×320).
       Cada una: retrato difuminado, nombre, fechas y epitafio. */
    var PLAQUE_COLS = 8, PLAQUE_ROWS = 6, PLAQUE_N = PLAQUE_COLS * PLAQUE_ROWS;
    var CELL_W = 256, CELL_H = 320;
    var MALE = ['José','Antonio','Manuel','Francisco','Juan','Pedro','Miguel','Rafael','Luis','Carlos','Javier','Fernando','Andrés','Tomás','Alejandro','Ricardo','Ernesto','Hugo','Emilio','Salvador','Agustín','Leandro','Mateo','Santiago','Benito','Clemente','Domingo','Eusebio','Fausto','Gregorio'];
    var FEMALE = ['María','Carmen','Ana','Isabel','Dolores','Francisca','Josefa','Antonia','Lucía','Elena','Rosa','Teresa','Pilar','Mercedes','Amparo','Concepción','Beatriz','Clara','Marta','Silvia','Valeria','Camila','Renata','Aurelia','Celina','Dominga','Eugenia','Felisa','Graciela','Honoria'];
    var SURNAMES = ['García','Rodríguez','González','Fernández','López','Martínez','Sánchez','Pérez','Gómez','Jiménez','Ruiz','Hernández','Díaz','Moreno','Álvarez','Muñoz','Romero','Alonso','Gutiérrez','Navarro','Torres','Domínguez','Vázquez','Ramos','Gil','Serrano','Blanco','Suárez','Ortega','Delgado','Ortiz','Marín','Rubio','Sanz','Núñez','Iglesias','Medina','Cortés','Castillo','Lozano'];
    var EPITAPHS = [
      'Descansa en paz', 'Siempre en nuestros corazones', 'Tu recuerdo vive en nosotros',
      'Vuela alto, alma libre', 'Hasta que volvamos a encontrarnos', 'Amado esposo y padre ejemplar',
      'Amada madre, guía eterna', 'Su luz no se apaga', 'Dios lo tenga en su gloria',
      'No es un adiós, es un hasta luego', 'Vivió con fe y murió en paz', 'Su bondad queda entre nosotros',
      'El amor es más fuerte que la muerte', 'Dulce memoria de quien tanto amamos',
      'Aquí duerme quien tanto luchó', 'Pequeño ángel, vuelto al cielo',
      'Su risa aún se escucha en casa', 'Trabajó la tierra que ahora lo guarda'
    ];
    var plaquePool = [];

    /* ============ Registro de rostros (v66) ============
       Cada placa es una PERSONA: nombre, fechas y un rostro DE SU ÉPOCA, con
       la edad del rostro según la edad de muerte. Los rostros viven en un
       atlas local (assets/faces.jpg, 8×6 celdas de 200×252, 545 KB): 48
       retratos FICTICIOS generados localmente en tres épocas — sepia tipo
       cabinet card (muertes < 1935), blanco y negro años 50 (1935–1969) y
       color (≥ 1970) — en 4 bandas de edad (20s / 40s / 60s / 80s) y ambos
       sexos. Ninguna persona real: la vía de fotos de dominio público se
       exploró (informe rostros-lapidas 2026-11-22) y la búsqueda devolvía
       sobre todo personajes famosos o escenas grupales, justo lo que el
       propio informe manda evitar; los rostros generados no tienen ese
       problema ni el de licencias. Las placas infantiles conservan el
       retrato procedural difuminado (sin rostros de niños, por ética). */
    var FACE_W = 200, FACE_H = 252;
    // Sexo por celda del atlas (verificado visualmente celda a celda al armarlo):
    // épocas vintage y moderna alternan H/M; en la de los 50 las bandas 1 y 3 arrancan en mujer.
    var FACE_FEMALE = [
      false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true,
      false, true, false, true, true, false, true, false, false, true, false, true, true, false, true, false,
      false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true
    ];
    function faceEraOf(death) { return death < 1935 ? 0 : (death < 1970 ? 1 : 2); }
    function faceBandOf(ageYears) { return ageYears < 35 ? 0 : (ageYears < 55 ? 1 : (ageYears < 75 ? 2 : 3)); }
    function pickFace(era, band, female, rng) {
      var base = era * 16 + band * 4, cands = [];
      for (var k = 0; k < 4; k++) { var idx = base + k; if (FACE_FEMALE[idx] === female) cands.push(idx); }
      if (!cands.length) cands.push(base);
      return { idx: cands[Math.floor(rng() * cands.length)], flip: rng() > 0.5 };
    }

    /* ============ BASE DE DATOS DE ROSTROS (v70, pedido de Guille:
       «genera un datasheet de rostros, antiguos, modernos, y juntalos
       en una base de datos que pueda consultar el motor procedural,
       en función si es hombre o mujer, el año de nacimiento y
       muerte») ============
       36 rostros ficticios generados (ninguna persona real) en
       assets/facesdb.jpg — atlas 6×6 de celdas 256×320 (1,36 MB)
       armado a partir del manifiesto rostros.json: cada entrada
       declara sexo, nacimiento, muerte, edad al morir, época
       (sepia: muertes 1880–1899 · bn: 1940–1969 · moderno: 1970–2023),
       estilo (formal de estudio / casual casero con fondo) y queda
       en el atlas EN EL ORDEN del manifiesto: el índice de la
       entrada ES su celda. La consulta del motor es queryFaceDB:
       sexo obligatorio; puntaje = desvío de edad aparente contra
       muerte−nacimiento + penalidad de época (la era del rostro
       debe acompañar al año de muerte: un salto de era cuesta 18
       por paso) + preferencia de estilo por época (sepia formal,
       moderno casual, bn mixto). Si el mejor candidato desvía la
       edad más de 30 años, la base «no tiene» esa persona y el
       llamador cae al atlas de la v66. Recurso finito (36): el
       mismo rostro puede reaparecer en tumbas lejanas, con espejado
       y desgaste distintos — Guille ya lo sabe («no será infinito
       el recurso, por el momento»). Las imágenes quedan guardadas
       (DB_IMG / OLD_IMG / SLATE_IMG) para los atlas familiares. */
    var FACE_DB = [
      {s:'M',b:1825,d:1893,a:68,e:'sepia',st:'formal'},
      {s:'F',b:1840,d:1888,a:48,e:'sepia',st:'formal'},
      {s:'F',b:1985,d:2013,a:28,e:'moderno',st:'formal'},
      {s:'M',b:1883,d:1965,a:82,e:'bn',st:'formal'},
      {s:'M',b:1860,d:1886,a:26,e:'sepia',st:'formal'},
      {s:'M',b:1835,d:1880,a:45,e:'sepia',st:'formal'},
      {s:'M',b:1812,d:1895,a:83,e:'sepia',st:'formal'},
      {s:'F',b:1865,d:1889,a:24,e:'sepia',st:'formal'},
      {s:'F',b:1828,d:1894,a:66,e:'sepia',st:'formal'},
      {s:'F',b:1810,d:1894,a:84,e:'sepia',st:'formal'},
      {s:'M',b:1920,d:1947,a:27,e:'bn',st:'formal'},
      {s:'M',b:1908,d:1954,a:46,e:'bn',st:'formal'},
      {s:'M',b:1900,d:1964,a:64,e:'bn',st:'formal'},
      {s:'F',b:1925,d:1950,a:25,e:'bn',st:'formal'},
      {s:'F',b:1910,d:1957,a:47,e:'bn',st:'formal'},
      {s:'F',b:1905,d:1968,a:63,e:'bn',st:'formal'},
      {s:'F',b:1885,d:1966,a:81,e:'bn',st:'formal'},
      {s:'M',b:1980,d:2009,a:29,e:'moderno',st:'formal'},
      {s:'M',b:1970,d:2014,a:44,e:'moderno',st:'formal'},
      {s:'M',b:1955,d:2022,a:67,e:'moderno',st:'formal'},
      {s:'M',b:1935,d:2019,a:84,e:'moderno',st:'formal'},
      {s:'F',b:1975,d:2021,a:46,e:'moderno',st:'formal'},
      {s:'F',b:1960,d:2022,a:62,e:'moderno',st:'formal'},
      {s:'F',b:1938,d:2023,a:85,e:'moderno',st:'formal'},
      {s:'M',b:1920,d:1955,a:35,e:'bn',st:'casual'},
      {s:'F',b:1925,d:1955,a:30,e:'bn',st:'casual'},
      {s:'M',b:1890,d:1960,a:70,e:'bn',st:'casual'},
      {s:'F',b:1940,d:1956,a:16,e:'bn',st:'casual'},
      {s:'M',b:1985,d:2017,a:32,e:'moderno',st:'casual'},
      {s:'F',b:1990,d:2015,a:25,e:'moderno',st:'casual'},
      {s:'M',b:1965,d:2020,a:55,e:'moderno',st:'casual'},
      {s:'F',b:1960,d:2020,a:60,e:'moderno',st:'casual'},
      {s:'M',b:2010,d:2020,a:10,e:'moderno',st:'casual'},
      {s:'F',b:1980,d:2020,a:40,e:'moderno',st:'casual'},
      {s:'M',b:1945,d:2020,a:75,e:'moderno',st:'casual'},
      {s:'F',b:1950,d:2020,a:70,e:'moderno',st:'casual'}
    ];
    var DB_COLS = 6, DB_W = 256, DB_H = 320;
    var DB_IMG = null, OLD_IMG = null, SLATE_IMG = null; // las llena buildPlaqueAtlas al arrancar; los atlas familiares se dibujan después (al nacer cada chunk con panteón)
    var ERA_STEP = { sepia: 0, bn: 1, moderno: 2 };
    function dbEraOf(death) { return death < 1935 ? 'sepia' : (death < 1970 ? 'bn' : 'moderno'); }
    function queryFaceDB(sex, birth, death, rng) {
      if (!DB_IMG) return null;
      var age = death - birth, era = dbEraOf(death), best = 1e9, scored = [];
      for (var i = 0; i < FACE_DB.length; i++) {
        var f = FACE_DB[i];
        if (f.s !== sex) continue;
        var ageDiff = Math.abs(f.a - age);
        if (age < 15 && (f.a > 17 || ageDiff > 8)) continue; // niños: solo los rostros infantiles/juveniles de la base, y cerca de su edad
        var sc = ageDiff + Math.abs(ERA_STEP[f.e] - ERA_STEP[era]) * 18;
        if (era === 'sepia' && f.st === 'formal') sc -= 4; // sepia: estudio formal
        if (era === 'moderno' && f.st === 'casual') sc -= 4; // moderno: mayormente casual (foto casera, portaretratos)
        scored.push({ idx: i, sc: sc, ageDiff: ageDiff });
        if (sc < best) best = sc;
      }
      if (!scored.length) return null;
      var near = scored.filter(function (s2) { return s2.sc <= best + 6; });
      var pick = near[Math.floor(rng() * near.length)];
      if (pick.ageDiff > 30) return null; // la base no tiene a esta persona: que decida el atlas viejo
      return { idx: pick.idx, flip: rng() > 0.5, entry: FACE_DB[pick.idx] };
    }

    /* Medallón desde la base de datos: la misma foto-cerámica de la
       v66 (forma y marco sorteados, porcelana, desgaste con la
       tumba) pero el rostro sale del atlas facesdb.jpg y su «era»
       para el grado de color es la de la ENTRADA (una foto casual
       moderna se apaga a foto impresa; una sepia ya viene sepia). */
    function drawDbMedallion(ctx, dbFace, cx, cy, rng, wear) {
      var entry = dbFace.entry;
      var shape = rng() < 0.52 ? 0 : (rng() < 0.42 ? 1 : (rng() < 0.62 ? 2 : 3));
      var frame = Math.floor(rng() * 4);
      var pw = 92, ph = 116, px = cx + (CELL_W - pw) / 2, py = cy + 48;
      if (shape === 1) { pw = 104; ph = 104; px = cx + (CELL_W - pw) / 2; py = cy + 54; }
      var sx = (dbFace.idx % DB_COLS) * DB_W, sy = Math.floor(dbFace.idx / DB_COLS) * DB_H;
      ctx.save();
      medallionPath(ctx, shape, px, py, pw, ph); ctx.clip();
      if (entry.e === 'moderno') {
        var off = document.createElement('canvas'); off.width = DB_W; off.height = DB_H;
        var octx = off.getContext('2d');
        try { octx.filter = 'saturate(0.55) contrast(0.97) brightness(1.02)'; } catch (e) {}
        octx.drawImage(DB_IMG, sx, sy, DB_W, DB_H, 0, 0, DB_W, DB_H);
        if (dbFace.flip) { ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(off, 0, 0, pw, ph); }
        else ctx.drawImage(off, px, py, pw, ph);
      } else {
        if (dbFace.flip) { ctx.save(); ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(DB_IMG, sx, sy, DB_W, DB_H, 0, 0, pw, ph); ctx.restore(); }
        else ctx.drawImage(DB_IMG, sx, sy, DB_W, DB_H, px, py, pw, ph);
        ctx.fillStyle = entry.e === 'bn' ? 'rgba(112,92,58,0.10)' : 'rgba(112,92,58,0.05)';
        ctx.fillRect(px, py, pw, ph);
      }
      var vg = ctx.createRadialGradient(px + pw / 2, py + ph / 2, pw * 0.32, px + pw / 2, py + ph / 2, pw * 0.86);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,16,10,0.30)');
      ctx.fillStyle = vg; ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(238,236,228,' + (wear * 0.20).toFixed(3) + ')'; ctx.fillRect(px, py, pw, ph);
      var mo = ctx.createRadialGradient(px + pw / 2, py + ph * 1.05, 4, px + pw / 2, py + ph * 1.05, pw * 0.85);
      mo.addColorStop(0, 'rgba(74,66,40,' + (wear * 0.34).toFixed(3) + ')'); mo.addColorStop(0.55, 'rgba(70,84,44,' + (wear * 0.16).toFixed(3) + ')'); mo.addColorStop(1, 'rgba(70,84,44,0)');
      ctx.fillStyle = mo; ctx.fillRect(px, py, pw, ph);
      var nScr = Math.round(wear * 5 * rng());
      ctx.lineWidth = 0.7;
      for (var s2 = 0; s2 < nScr; s2++) {
        ctx.strokeStyle = 'rgba(240,238,230,' + (0.10 + rng() * 0.20 * wear).toFixed(3) + ')';
        var lx = px + rng() * pw, ly = py + rng() * ph;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + (rng() - 0.5) * 26, ly + rng() * 30); ctx.stroke();
      }
      if (wear > 0.55) {
        for (var s3 = 0; s3 < 4; s3++) {
          ctx.fillStyle = 'rgba(38,34,28,' + (0.10 + rng() * 0.16 * wear).toFixed(3) + ')';
          ctx.beginPath(); ctx.ellipse(px + (rng() < 0.5 ? rng() * 12 : pw - rng() * 12), py + rng() * ph, 2 + rng() * 5, 3 + rng() * 8, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      var sp = ctx.createRadialGradient(px + pw * 0.30, py + ph * 0.16, 2, px + pw * 0.30, py + ph * 0.16, pw * 0.62);
      sp.addColorStop(0, 'rgba(255,255,255,0.20)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp; ctx.fillRect(px, py, pw, ph);
      var dg = ctx.createLinearGradient(px, py, px + pw, py + ph);
      dg.addColorStop(0.18, 'rgba(255,255,255,0)'); dg.addColorStop(0.38, 'rgba(255,255,255,0.10)'); dg.addColorStop(0.55, 'rgba(255,255,255,0)');
      ctx.fillStyle = dg; ctx.fillRect(px, py, pw, ph);
      ctx.restore();
      ctx.save();
      if (frame === 0) {
        ctx.strokeStyle = '#6d5830'; ctx.lineWidth = 5; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
        ctx.strokeStyle = '#a8894e'; ctx.lineWidth = 1.4;
        ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(0.93, 0.93); ctx.translate(-(px + pw / 2), -(py + ph / 2));
        medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else if (frame === 1) {
        ctx.strokeStyle = '#cdc6b4'; ctx.lineWidth = 9; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
        ctx.strokeStyle = 'rgba(52,48,40,0.55)'; ctx.lineWidth = 1; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else if (frame === 2) {
        ctx.strokeStyle = 'rgba(52,48,40,0.85)'; ctx.lineWidth = 2.5; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else {
        medallionPath(ctx, shape, px, py, pw, ph); ctx.clip();
        ctx.strokeStyle = 'rgba(30,28,22,0.35)'; ctx.lineWidth = 7; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      }
      ctx.restore();
    }

    // Trayectoria del medallón según la forma sorteada.
    function medallionPath(ctx, shape, x, y, w, h) {
      ctx.beginPath();
      if (shape === 0) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (shape === 1) ctx.ellipse(x + w / 2, y + h / 2, w / 2, w / 2, 0, 0, Math.PI * 2);
      else if (shape === 2) { var r = 12; ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath(); }
      else { var rr = w / 2; ctx.moveTo(x, y + h); ctx.lineTo(x, y + rr); ctx.arc(x + rr, y + rr, rr, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); }
    }

    /* Medallón foto-cerámico: rostro de época recortado a la forma sorteada
       (óvalo / redondo / rectángulo redondeado / arco), marco sorteado
       (bronce doble / mármol / grabado / al ras), brillo de porcelana
       (veladura diagonal + luz especular arriba a la izquierda) y DESGASTE
       según la antigüedad de la tumba: la foto envejece con ella — se lava,
       se raya, le sube humedad por abajo y se le platea el borde. */
    function drawFaceMedallion(ctx, facesImg, face, cx, cy, rng, era, wear) {
      var shape = rng() < 0.52 ? 0 : (rng() < 0.42 ? 1 : (rng() < 0.62 ? 2 : 3));
      var frame = Math.floor(rng() * 4);
      var pw = 92, ph = 116, px = cx + (CELL_W - pw) / 2, py = cy + 48;
      if (shape === 1) { pw = 104; ph = 104; px = cx + (CELL_W - pw) / 2; py = cy + 54; }
      var sx = (face.idx % 8) * FACE_W, sy = Math.floor(face.idx / 8) * FACE_H;
      ctx.save();
      medallionPath(ctx, shape, px, py, pw, ph); ctx.clip();
      // el rostro, con su grado de época (el color moderno se apaga a foto impresa)
      if (era === 2) {
        var off = document.createElement('canvas'); off.width = FACE_W; off.height = FACE_H;
        var octx = off.getContext('2d');
        try { octx.filter = 'saturate(0.55) contrast(0.97) brightness(1.02)'; } catch (e) {}
        octx.drawImage(facesImg, sx, sy, FACE_W, FACE_H, 0, 0, FACE_W, FACE_H);
        if (face.flip) { ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(off, 0, 0, pw, ph); }
        else ctx.drawImage(off, px, py, pw, ph);
      } else {
        if (face.flip) { ctx.save(); ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(facesImg, sx, sy, FACE_W, FACE_H, 0, 0, pw, ph); ctx.restore(); }
        else ctx.drawImage(facesImg, sx, sy, FACE_W, FACE_H, px, py, pw, ph);
        ctx.fillStyle = era === 1 ? 'rgba(112,92,58,0.10)' : 'rgba(112,92,58,0.05)';
        ctx.fillRect(px, py, pw, ph);
      }
      // viñeta suave del retrato
      var vg = ctx.createRadialGradient(px + pw / 2, py + ph / 2, pw * 0.32, px + pw / 2, py + ph / 2, pw * 0.86);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,16,10,0.30)');
      ctx.fillStyle = vg; ctx.fillRect(px, py, pw, ph);
      // desgaste con la edad de la tumba
      ctx.fillStyle = 'rgba(238,236,228,' + (wear * 0.20).toFixed(3) + ')'; ctx.fillRect(px, py, pw, ph); // lavado
      var mo = ctx.createRadialGradient(px + pw / 2, py + ph * 1.05, 4, px + pw / 2, py + ph * 1.05, pw * 0.85);
      mo.addColorStop(0, 'rgba(74,66,40,' + (wear * 0.34).toFixed(3) + ')'); mo.addColorStop(0.55, 'rgba(70,84,44,' + (wear * 0.16).toFixed(3) + ')'); mo.addColorStop(1, 'rgba(70,84,44,0)');
      ctx.fillStyle = mo; ctx.fillRect(px, py, pw, ph); // humedad que sube
      var nScr = Math.round(wear * 5 * rng());
      ctx.lineWidth = 0.7;
      for (var s2 = 0; s2 < nScr; s2++) {
        ctx.strokeStyle = 'rgba(240,238,230,' + (0.10 + rng() * 0.20 * wear).toFixed(3) + ')';
        var lx = px + rng() * pw, ly = py + rng() * ph;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + (rng() - 0.5) * 26, ly + rng() * 30); ctx.stroke();
      }
      if (wear > 0.55) { // plateado / manchas en los bordes de la cerámica vieja
        for (var s3 = 0; s3 < 4; s3++) {
          ctx.fillStyle = 'rgba(38,34,28,' + (0.10 + rng() * 0.16 * wear).toFixed(3) + ')';
          ctx.beginPath(); ctx.ellipse(px + (rng() < 0.5 ? rng() * 12 : pw - rng() * 12), py + rng() * ph, 2 + rng() * 5, 3 + rng() * 8, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
      // brillo de porcelana: especular arriba-izquierda + veladura diagonal
      var sp = ctx.createRadialGradient(px + pw * 0.30, py + ph * 0.16, 2, px + pw * 0.30, py + ph * 0.16, pw * 0.62);
      sp.addColorStop(0, 'rgba(255,255,255,0.20)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp; ctx.fillRect(px, py, pw, ph);
      var dg = ctx.createLinearGradient(px, py, px + pw, py + ph);
      dg.addColorStop(0.18, 'rgba(255,255,255,0)'); dg.addColorStop(0.38, 'rgba(255,255,255,0.10)'); dg.addColorStop(0.55, 'rgba(255,255,255,0)');
      ctx.fillStyle = dg; ctx.fillRect(px, py, pw, ph);
      ctx.restore();
      // marco sorteado
      ctx.save();
      if (frame === 0) { // bronce doble aro
        ctx.strokeStyle = '#6d5830'; ctx.lineWidth = 5; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
        ctx.strokeStyle = '#a8894e'; ctx.lineWidth = 1.4;
        ctx.translate(px + pw / 2, py + ph / 2); ctx.scale(0.93, 0.93); ctx.translate(-(px + pw / 2), -(py + ph / 2));
        medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else if (frame === 1) { // mármol incrustado
        ctx.strokeStyle = '#cdc6b4'; ctx.lineWidth = 9; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
        ctx.strokeStyle = 'rgba(52,48,40,0.55)'; ctx.lineWidth = 1; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else if (frame === 2) { // grabado fino
        ctx.strokeStyle = 'rgba(52,48,40,0.85)'; ctx.lineWidth = 2.5; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      } else { // al ras: sombra interior
        medallionPath(ctx, shape, px, py, pw, ph); ctx.clip();
        ctx.strokeStyle = 'rgba(30,28,22,0.35)'; ctx.lineWidth = 7; medallionPath(ctx, shape, px, py, pw, ph); ctx.stroke();
      }
      ctx.restore();
    }

    function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
      var words = text.split(' '), line = '', lines = [];
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
        else line = test;
      }
      if (line) lines.push(line);
      lines = lines.slice(0, maxLines);
      for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lineH);
      return lines.length;
    }

    function drawPortrait(ctx, x, y, w, h, rng, female) {
      // Retrato pintado en miniatura y ampliado: el rostro queda difuminado.
      var off = document.createElement('canvas'); off.width = 26; off.height = 34;
      var o = off.getContext('2d');
      var bg = o.createLinearGradient(0, 0, 0, 34);
      bg.addColorStop(0, '#8d9296'); bg.addColorStop(1, '#5d6066');
      o.fillStyle = bg; o.fillRect(0, 0, 26, 34);
      o.fillStyle = 'rgba(255,255,255,0.10)'; o.fillRect(0, 0, 26, 10);
      var skin = ['#c9a189', '#b98a68', '#d9b294', '#a87a5c'][Math.floor(rng() * 4)];
      var hair = ['#2e2320', '#4a3826', '#6e6e6e', '#8a8378', '#1c1a18'][Math.floor(rng() * 5)];
      var cloth = ['#23242c', '#31251f', '#26303a', '#3a2d33', '#1f2a22'][Math.floor(rng() * 5)];
      // hombros / ropa
      o.fillStyle = cloth; o.beginPath(); o.ellipse(13, 33, 11, 8, 0, Math.PI, 0); o.fill();
      o.fillRect(2, 30, 22, 4);
      // cuello y cabeza
      o.fillStyle = skin; o.fillRect(11, 19, 4, 5);
      o.beginPath(); o.ellipse(13, 13.5, 5.6, 7, 0, 0, Math.PI * 2); o.fill();
      // pelo
      o.fillStyle = hair;
      o.beginPath(); o.ellipse(13, 8.6, 5.9, 3.6, 0, Math.PI, Math.PI * 2); o.fill();
      if (female) { o.fillRect(6.6, 8, 2.6, 10); o.fillRect(16.8, 8, 2.6, 10); if (rng() > 0.5) { o.beginPath(); o.ellipse(13, 5.4, 3.4, 2.4, 0, 0, Math.PI * 2); o.fill(); } }
      else if (rng() > 0.55) { o.fillStyle = 'rgba(40,32,26,0.85)'; o.fillRect(9.5, 17.5, 7, 2.6); } // barba tenue
      // rasgos apenas insinuados (quedarán borrosos)
      o.fillStyle = 'rgba(30,22,18,0.5)';
      o.fillRect(10.2, 13.2, 1.6, 0.8); o.fillRect(14.2, 13.2, 1.6, 0.8);
      o.fillRect(11.8, 17.6, 2.4, 0.7);
      ctx.save();
      try { ctx.filter = 'blur(2px)'; } catch (e) {}
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, x - 3, y - 3, w + 6, h + 6);
      ctx.restore();
      // velo sepia y viñeta del retrato
      ctx.fillStyle = 'rgba(112, 92, 58, 0.20)'; ctx.fillRect(x, y, w, h);
      var vg = ctx.createRadialGradient(x + w / 2, y + h / 2, w * 0.3, x + w / 2, y + h / 2, w * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(20,16,10,0.42)');
      ctx.fillStyle = vg; ctx.fillRect(x, y, w, h);
    }

    function buildPlaqueAtlas(slateImg, facesImg, facesDbImg) {
      SLATE_IMG = slateImg; OLD_IMG = facesImg; DB_IMG = facesDbImg || null; // quedan para los atlas familiares por chunk (v70)
      var atlas = document.createElement('canvas');
      atlas.width = PLAQUE_COLS * CELL_W; atlas.height = PLAQUE_ROWS * CELL_H;
      var ctx = atlas.getContext('2d');
      var rng = mulberry32(20261121);
      for (var i = 0; i < PLAQUE_N; i++) {
        var cx = (i % PLAQUE_COLS) * CELL_W, cy = Math.floor(i / PLAQUE_COLS) * CELL_H;
        var female = rng() > 0.48;
        var first = (female ? FEMALE : MALE)[Math.floor(rng() * 30)];
        var first2 = rng() > 0.6 ? ' ' + (female ? FEMALE : MALE)[Math.floor(rng() * 30)] : '';
        var sur = SURNAMES[Math.floor(rng() * SURNAMES.length)];
        var sur2 = rng() > 0.55 ? ' ' + SURNAMES[Math.floor(rng() * SURNAMES.length)] : '';
        var child = rng() > 0.93;
        var birth = child ? 1995 + Math.floor(rng() * 25) : 1838 + Math.floor(rng() * 150);
        var age = child ? Math.floor(rng() * 9) : 24 + Math.floor(rng() * 72);
        var death = birth + age;
        var epitaph = child ? EPITAPHS[15] : EPITAPHS[Math.floor(rng() * EPITAPHS.length)];
        var era = faceEraOf(death);
        // la persona consulta PRIMERO la base de datos de rostros
        // (v70: sexo + nacimiento + muerte); si la base no la tiene,
        // cae al atlas de la v66; las infantiles, al difuminado
        var dbFace = !child ? queryFaceDB(female ? 'F' : 'M', birth, death, rng) : null;
        var face = (!dbFace && !child && facesImg) ? pickFace(era, faceBandOf(age), female, rng) : null;
        var wear = Math.min(1, Math.max(0.04, (2026 - death) / 140));
        var data = { name: (first + first2 + ' ' + sur + sur2).toUpperCase(), years: birth + ' — ' + death, epitaph: epitaph, birth: birth, death: death, ageYears: age, era: era, face: face ? face.idx : -1, faceDb: dbFace ? dbFace.idx : -1, wear: wear };
        plaquePool.push(data);

        // fondo de piedra clara con la foto de pizarra atenuada
        ctx.fillStyle = '#b7b3a8'; ctx.fillRect(cx, cy, CELL_W, CELL_H);
        if (slateImg) { ctx.save(); ctx.globalAlpha = 0.30; ctx.drawImage(slateImg, cx, cy, CELL_W, CELL_H); ctx.restore(); }
        var grd = ctx.createLinearGradient(cx, cy, cx, cy + CELL_H);
        grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(30,28,22,0.16)');
        ctx.fillStyle = grd; ctx.fillRect(cx, cy, CELL_W, CELL_H);
        // marco grabado doble
        ctx.strokeStyle = 'rgba(52,48,40,0.75)'; ctx.lineWidth = 2; ctx.strokeRect(cx + 9, cy + 9, CELL_W - 18, CELL_H - 18);
        ctx.strokeStyle = 'rgba(52,48,40,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(cx + 14, cy + 14, CELL_W - 28, CELL_H - 28);
        // ornamento superior: cruz o estrella
        ctx.fillStyle = 'rgba(52,48,40,0.8)';
        if (rng() > 0.25) { ctx.fillRect(cx + CELL_W / 2 - 1.5, cy + 22, 3, 16); ctx.fillRect(cx + CELL_W / 2 - 5.5, cy + 27, 11, 3); }
        else { ctx.beginPath(); var sx = cx + CELL_W / 2, sy = cy + 30; ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 2, sy - 2); ctx.lineTo(sx + 7, sy); ctx.lineTo(sx + 2, sy + 2); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 2, sy + 2); ctx.lineTo(sx - 7, sy); ctx.lineTo(sx - 2, sy - 2); ctx.closePath(); ctx.fill(); }
        // retrato: medallón foto-cerámico con el rostro de su época; las
        // placas infantiles (y el respaldo sin atlas) conservan el difuminado
        if (dbFace) {
          drawDbMedallion(ctx, dbFace, cx, cy, rng, wear);
        } else if (face) {
          drawFaceMedallion(ctx, facesImg, face, cx, cy, rng, era, wear);
        } else {
          var pw = 92, ph = 116, px = cx + (CELL_W - pw) / 2, py = cy + 48;
          ctx.save();
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.clip();
          drawPortrait(ctx, px, py, pw, ph, rng, female);
          ctx.restore();
          ctx.strokeStyle = 'rgba(52,48,40,0.85)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // nombre
        ctx.fillStyle = '#35322a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        var nameParts = data.name.split(' ');
        var surName = nameParts.slice(-2).join(' '), given = nameParts.slice(0, -2).join(' ') || nameParts[0];
        if (nameParts.length <= 2) { surName = nameParts[nameParts.length - 1]; given = nameParts.slice(0, -1).join(' '); }
        var fs = 25;
        ctx.font = '600 ' + fs + 'px Georgia, serif';
        while (ctx.measureText(surName).width > CELL_W - 44 && fs > 14) { fs -= 2; ctx.font = '600 ' + fs + 'px Georgia, serif'; }
        ctx.fillText(surName, cx + CELL_W / 2, cy + 200);
        if (given) { ctx.font = '17px Georgia, serif'; ctx.fillStyle = '#4a463c'; ctx.fillText(given, cx + CELL_W / 2, cy + 222); }
        // fechas
        ctx.font = '16px Georgia, serif'; ctx.fillStyle = '#3d3a31';
        ctx.fillText(data.years, cx + CELL_W / 2, cy + 248);
        ctx.fillRect(cx + 58, cy + 260, CELL_W - 116, 1);
        // epitafio
        ctx.font = 'italic 14.5px Georgia, serif'; ctx.fillStyle = '#4a463c';
        wrapText(ctx, epitaph, cx + CELL_W / 2, cy + 282, CELL_W - 52, 18, 2);
        // desgaste: manchas y vetas
        for (var s = 0; s < 26; s++) {
          ctx.fillStyle = 'rgba(40,38,30,' + (0.03 + rng() * 0.07) + ')';
          ctx.beginPath(); ctx.ellipse(cx + rng() * CELL_W, cy + rng() * CELL_H, 2 + rng() * 14, 1 + rng() * 6, rng() * 3, 0, Math.PI * 2); ctx.fill();
        }
        if (rng() > 0.5) { ctx.fillStyle = 'rgba(52,66,38,0.13)'; ctx.beginPath(); ctx.ellipse(cx + rng() * CELL_W, cy + CELL_H - 12, 30 + rng() * 40, 10 + rng() * 12, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      return atlas;
    }

    /* ============ FAMILIAS DE PANTEÓN: ÁRBOL GENEALÓGICO VIRTUAL
       (v70, pedido de Guille: «ajusta el algoritmo para que los
       panteones contengan familiares, crea virtualmente un árbol
       genealógico para simular internamente parentescos y decidir
       quién murió, quién no») ============
       Cada panteón nace con UNA familia generada por su propio rng
       (semilla del chunk: la misma familia en cada visita): un
       apellido, un fundador y su esposa, hijos con sus cónyuges y
       nietos — generaciones separadas ~25–30 años, como manda la
       demografía. El árbol decide quién murió y quién no con una
       ley de vida por persona (esperanza con cola de muertes
       jóvenes): si el año de muerte que le tocó cae en el futuro,
       la persona VIVE — su nicho queda RESERVADO: nombre y año de
       nacimiento, sin fecha de muerte y sin retrato. El fundador
       siempre murió (el panteón existe por alguien).
       Las casillas del atlas familiar (4×3) se asignan: 0 = placa
       principal del fundador junto a la puerta; después los
       muertos por orden de muerte (sus nichos llevan retrato de la
       base de datos consultada por sexo/nacimiento/muerte, o del
       atlas viejo, o difuminado infantil); después los vivos como
       reservados; las casillas que sobren quedan como nicho vacío
       de la familia. geometry.js consume las casillas en orden al
       colocar nichos y la lectura muestra a LA PERSONA de cada
       placa (reading.js: best.person), no a un desconocido. */
    var FAM_COLS = 4, FAM_ROWS = 3, FAM_N = FAM_COLS * FAM_ROWS;
    var NOW_YEAR = 2026;
    function famLifespan(rng) {
      if (rng() < 0.07) return 4 + Math.floor(rng() * 18); // muerte joven (4–21): los cementerios reales están llenos
      return Math.round(26 + Math.pow(rng(), 0.85) * 66); // 26–92, con cola larga hacia la vejez
    }
    function famMake(rng, sex, rel, birth, name) {
      var death = birth + famLifespan(rng);
      var alive = death > NOW_YEAR;
      return { sex: sex, rel: rel, birth: birth, death: alive ? null : death, alive: alive, name: name, empty: false };
    }
    function buildFamily(rng) {
      var sur = SURNAMES[Math.floor(rng() * SURNAMES.length)];
      var sur2 = SURNAMES[Math.floor(rng() * SURNAMES.length)];
      function given(female) { var L = female ? FEMALE : MALE; return L[Math.floor(rng() * L.length)]; }
      function ownSur() { return SURNAMES[Math.floor(rng() * SURNAMES.length)]; }
      var members = [];
      // generación 0: el fundador y su esposa
      var fBirth = 1818 + Math.floor(rng() * 118); // 1818–1935: los panteones familiares se fundan en cualquier época
      var founder = famMake(rng, 'M', 'Fundador', fBirth, given(false) + ' ' + sur + (rng() > 0.5 ? ' ' + sur2 : ''));
      if (founder.alive) { founder.alive = false; founder.death = 2012 + Math.floor(rng() * 13); } // el fundador murió: sin él no hay panteón
      members.push(founder);
      var wife = famMake(rng, 'F', 'Esposa del fundador', fBirth + Math.round(rng() * 9 - 3), ''); // su nombre se compone tras generar los hijos (apellido de soltera + «de» + el familiar)
      members.push(wife);
      // generación 1: hijos (cada ~2–4 años) y sus cónyuges
      var couples = [];
      var nCh = 2 + Math.floor(rng() * 3), cb = fBirth + 23 + Math.floor(rng() * 10);
      for (var i = 0; i < nCh; i++) {
        var chF = rng() > 0.5;
        var child = famMake(rng, chF ? 'F' : 'M', chF ? 'Hija' : 'Hijo', cb, given(chF) + ' ' + sur + ' ' + sur2);
        members.push(child);
        var spouse = null;
        if (rng() < 0.72) {
          var spF = !chF;
          spouse = famMake(rng, spF ? 'F' : 'M', spF ? 'Nuera' : 'Yerno', cb + Math.round(rng() * 8 - 4), given(spF) + ' ' + ownSur() + ' ' + sur);
          members.push(spouse);
        }
        couples.push({ child: child, spouse: spouse });
        cb += 2 + Math.floor(rng() * 3);
      }
      // generación 2: nietos
      for (var c = 0; c < couples.length; c++) {
        var nG = Math.floor(rng() * 3), gb = couples[c].child.birth + 24 + Math.floor(rng() * 10);
        for (var j = 0; j < nG; j++) {
          var gF = rng() > 0.5;
          members.push(famMake(rng, gF ? 'F' : 'M', gF ? 'Nieta' : 'Nieto', gb, given(gF) + ' ' + sur + ' ' + sur2));
          gb += 2 + Math.floor(rng() * 3);
        }
      }
      // nombre de la esposa: nombre + apellido de soltera + «de» + el del fundador (uso de época)
      wife.name = given(true) + ' ' + ownSur() + ' de ' + sur;
      /* SIN DUPLICADOS (corrección tras la auditoría de la v70: una
         hija y una nieta salieron con nombre y apellidos idénticos):
         dentro de una familia ningún nombre completo se repite — si
         el sorteo choca, se cambia el nombre de pila por otro del
         mismo sexo (hasta 10 intentos; si aun así choca, se suma un
         segundo nombre de pila, como en las familias reales). */
      var usedNames = {};
      for (var un = 0; un < members.length; un++) {
        var mp = members[un], tries = 0;
        while (usedNames[mp.name] && tries < 10) {
          var parts = mp.name.split(' ');
          parts[0] = (mp.sex === 'F' ? FEMALE : MALE)[Math.floor(rng() * 30)];
          mp.name = parts.join(' ');
          tries++;
        }
        if (usedNames[mp.name]) { var pp = mp.name.split(' '); pp.splice(1, 0, (mp.sex === 'F' ? FEMALE : MALE)[Math.floor(rng() * 30)]); mp.name = pp.join(' '); }
        usedNames[mp.name] = 1;
      }
      // epitafios por parentesco y edad
      function epitaphFor(p) {
        var age = (p.death || NOW_YEAR) - p.birth;
        if (p.alive) return 'Nicho reservado';
        if (age < 15) return EPITAPHS[15];
        if (p.rel === 'Fundador') return EPITAPHS[5];
        if (p.rel === 'Esposa del fundador') return EPITAPHS[6];
        var pool = [0, 1, 2, 3, 7, 8, 9, 10, 11, 12, 13, 14, 17];
        return EPITAPHS[pool[Math.floor(rng() * pool.length)]];
      }
      // casillas: 0 fundador · muertos por orden de muerte · vivos por nacimiento · vacías
      var rest = members.slice(1);
      var dead = rest.filter(function (p) { return !p.alive; }).sort(function (a, b) { return a.death - b.death; });
      var alive = rest.filter(function (p) { return p.alive; }).sort(function (a, b) { return a.birth - b.birth; });
      var ordered = [founder].concat(dead, alive);
      var slots = [];
      for (var s = 0; s < FAM_N; s++) {
        if (s < ordered.length) {
          var p = ordered[s];
          var ageD = p.alive ? null : p.death - p.birth;
          var faceDb = null, faceOld = null, childProc = false;
          if (!p.alive) {
            faceDb = queryFaceDB(p.sex, p.birth, p.death, rng); // la base de datos manda: sexo + nacimiento + muerte
            if (!faceDb && ageD >= 15 && OLD_IMG) faceOld = pickFace(faceEraOf(p.death), faceBandOf(ageD), p.sex === 'F', rng);
            if (!faceDb && !faceOld) childProc = ageD < 15;
          }
          slots.push({
            name: p.name.toUpperCase(), years: p.alive ? (p.birth + ' —') : (p.birth + ' — ' + p.death),
            epitaph: epitaphFor(p), rel: p.rel, sex: p.sex, birth: p.birth, death: p.death, alive: p.alive,
            empty: false, surname: sur, faceDb: faceDb, faceOld: faceOld, childProc: childProc,
            wear: p.alive ? 0.05 : Math.min(1, Math.max(0.04, (NOW_YEAR - p.death) / 140))
          });
        } else {
          slots.push({ name: ('FAMILIA ' + sur).toUpperCase(), years: '—', epitaph: 'Nicho sin ocupar', rel: '', sex: '', birth: 0, death: null, alive: false, empty: true, surname: sur, faceDb: null, faceOld: null, childProc: false, wear: 0.3 });
        }
      }
      return { surname: sur, slots: slots };
    }

    /* Dibuja UNA casilla del atlas familiar con la misma receta
       visual de las placas del pool (pizarra, marco grabado,
       ornamento, nombre en dos líneas, fechas, epitafio, desgaste):
       el muerto con su medallón, el vivo con el medallón GRABADO
       VACÍO y «Nicho reservado», la casilla vacía con el apellido. */
    function drawFamilyCell(ctx, cx, cy, p, rng) {
      ctx.fillStyle = '#b7b3a8'; ctx.fillRect(cx, cy, CELL_W, CELL_H);
      if (SLATE_IMG) { ctx.save(); ctx.globalAlpha = 0.30; ctx.drawImage(SLATE_IMG, cx, cy, CELL_W, CELL_H); ctx.restore(); }
      var grd = ctx.createLinearGradient(cx, cy, cx, cy + CELL_H);
      grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(30,28,22,0.16)');
      ctx.fillStyle = grd; ctx.fillRect(cx, cy, CELL_W, CELL_H);
      ctx.strokeStyle = 'rgba(52,48,40,0.75)'; ctx.lineWidth = 2; ctx.strokeRect(cx + 9, cy + 9, CELL_W - 18, CELL_H - 18);
      ctx.strokeStyle = 'rgba(52,48,40,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(cx + 14, cy + 14, CELL_W - 28, CELL_H - 28);
      ctx.fillStyle = 'rgba(52,48,40,0.8)';
      if (rng() > 0.25) { ctx.fillRect(cx + CELL_W / 2 - 1.5, cy + 22, 3, 16); ctx.fillRect(cx + CELL_W / 2 - 5.5, cy + 27, 11, 3); }
      else { ctx.beginPath(); var sx0 = cx + CELL_W / 2, sy0 = cy + 30; ctx.moveTo(sx0, sy0 - 7); ctx.lineTo(sx0 + 2, sy0 - 2); ctx.lineTo(sx0 + 7, sy0); ctx.lineTo(sx0 + 2, sy0 + 2); ctx.lineTo(sx0, sy0 + 7); ctx.lineTo(sx0 - 2, sy0 + 2); ctx.lineTo(sx0 - 7, sy0); ctx.lineTo(sx0 - 2, sy0 - 2); ctx.closePath(); ctx.fill(); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (p.empty) {
        // nicho vacío de la familia: solo el apellido, grabado grande
        ctx.fillStyle = '#35322a';
        ctx.font = '600 24px Georgia, serif';
        ctx.fillText('FAMILIA', cx + CELL_W / 2, cy + 138);
        var fsE = 27; ctx.font = '600 ' + fsE + 'px Georgia, serif';
        var surU = p.surname.toUpperCase();
        while (ctx.measureText(surU).width > CELL_W - 44 && fsE > 14) { fsE -= 2; ctx.font = '600 ' + fsE + 'px Georgia, serif'; }
        ctx.fillText(surU, cx + CELL_W / 2, cy + 172);
        ctx.font = 'italic 14px Georgia, serif'; ctx.fillStyle = '#4a463c';
        ctx.fillText('Panteón familiar', cx + CELL_W / 2, cy + 200);
      } else {
        if (p.alive) {
          // nicho reservado: el medallón va grabado y VACÍO — sin
          // foto y sin fecha de muerte, como en los panteones reales
          var pw = 92, ph = 116, px = cx + (CELL_W - pw) / 2, py = cy + 48;
          ctx.save();
          ctx.fillStyle = 'rgba(30,28,22,0.07)';
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(52,48,40,0.55)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        } else if (p.faceDb) {
          drawDbMedallion(ctx, p.faceDb, cx, cy, rng, p.wear);
        } else if (p.faceOld) {
          drawFaceMedallion(ctx, OLD_IMG, p.faceOld, cx, cy, rng, faceEraOf(p.death), p.wear);
        } else {
          // infantil sin rostro en la base: el difuminado de siempre
          var pw2 = 92, ph2 = 116, px2 = cx + (CELL_W - pw2) / 2, py2 = cy + 48;
          ctx.save();
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py2 + ph2 / 2, pw2 / 2, ph2 / 2, 0, 0, Math.PI * 2); ctx.clip();
          drawPortrait(ctx, px2, py2, pw2, ph2, rng, p.sex === 'F');
          ctx.restore();
          ctx.strokeStyle = 'rgba(52,48,40,0.85)'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(cx + CELL_W / 2, py2 + ph2 / 2, pw2 / 2, ph2 / 2, 0, 0, Math.PI * 2); ctx.stroke();
        }
        // nombre (apellido en grande, nombre de pila debajo — la
        // misma composición que las placas del pool)
        ctx.fillStyle = '#35322a';
        var nameParts = p.name.split(' ');
        var surName = nameParts.slice(-2).join(' '), given = nameParts.slice(0, -2).join(' ') || nameParts[0];
        if (nameParts.length <= 2) { surName = nameParts[nameParts.length - 1]; given = nameParts.slice(0, -1).join(' '); }
        var fs = 25;
        ctx.font = '600 ' + fs + 'px Georgia, serif';
        while (ctx.measureText(surName).width > CELL_W - 44 && fs > 14) { fs -= 2; ctx.font = '600 ' + fs + 'px Georgia, serif'; }
        ctx.fillText(surName, cx + CELL_W / 2, cy + 200);
        if (given) { ctx.font = '17px Georgia, serif'; ctx.fillStyle = '#4a463c'; ctx.fillText(given, cx + CELL_W / 2, cy + 222); }
        ctx.font = '16px Georgia, serif'; ctx.fillStyle = '#3d3a31';
        ctx.fillText(p.years, cx + CELL_W / 2, cy + 248);
        ctx.fillRect(cx + 58, cy + 260, CELL_W - 116, 1);
        ctx.font = 'italic 14.5px Georgia, serif'; ctx.fillStyle = '#4a463c';
        wrapText(ctx, p.epitaph, cx + CELL_W / 2, cy + 282, CELL_W - 52, 18, 2);
      }
      for (var s = 0; s < 26; s++) {
        ctx.fillStyle = 'rgba(40,38,30,' + (0.03 + rng() * 0.07) + ')';
        ctx.beginPath(); ctx.ellipse(cx + rng() * CELL_W, cy + rng() * CELL_H, 2 + rng() * 14, 1 + rng() * 6, rng() * 3, 0, Math.PI * 2); ctx.fill();
      }
      if (rng() > 0.5) { ctx.fillStyle = 'rgba(52,66,38,0.13)'; ctx.beginPath(); ctx.ellipse(cx + rng() * CELL_W, cy + CELL_H - 12, 30 + rng() * 40, 10 + rng() * 12, 0, 0, Math.PI * 2); ctx.fill(); }
    }

    /* El atlas familiar de UN panteón: 12 casillas (4×3) en un
       canvas propio que world.js convierte en la textura del
       material plaqueFam de ese chunk. */
    function buildFamilyAtlas(family, rng) {
      var canvas = document.createElement('canvas');
      canvas.width = FAM_COLS * CELL_W; canvas.height = FAM_ROWS * CELL_H;
      var ctx = canvas.getContext('2d');
      for (var i = 0; i < FAM_N; i++) {
        drawFamilyCell(ctx, (i % FAM_COLS) * CELL_W, Math.floor(i / FAM_COLS) * CELL_H, family.slots[i], rng);
      }
      return canvas;
    }
