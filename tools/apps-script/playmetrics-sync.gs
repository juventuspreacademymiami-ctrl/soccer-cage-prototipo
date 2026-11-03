/* ============================================================
   SOCCER CAGE — Sincronización PlayMetrics → plataforma de inventario

   Cada hora lee las inscripciones vigentes de los programas elegidos en
   PlayMetrics y manda a la plataforma la lista de jugadores con derecho a
   uniforme (nombre, correo del acudiente, equipo, portero o no, talla).
   La plataforma la combina con lo que ya tiene: no duplica, no borra y
   no toca a quien ya recibió su uniforme.

   Proyecto propio de Apps Script (no comparte nada con otras automatizaciones
   de la misma cuenta). Configuración en Propiedades del script:
     PM_REFRESH        llave de renovación de la sesión de PlayMetrics (secreta).
                       Es la misma forma que usa "LV · Resultados a Meta": sirve
                       para cuentas que entran con invitación o con Google, sin
                       contraseña. Si se cambia la contraseña o se cierran todas
                       las sesiones de PlayMetrics, hay que renovarla.
     PM_ROL            rol con el que se entra (Admin_576 = Juventus Miami / Athletum FC)
     PM_EMAIL / PM_PASSWORD   alternativa a PM_REFRESH para un usuario con contraseña
     PM_FIREBASE_KEY   clave web pública de Firebase que usa app.playmetrics.com
     PM_PROGRAMS       ids de programas separados por coma, p. ej. 94780
     SC_URL            https://abrjwvfeymexkwecjpxr.supabase.co
     SC_KEY            clave publicable de Supabase (sb_publishable_…)
     SC_ROSTER_KEY     clave del receptor (la da "rotate_integration_key")
     SC_PROGRAM        programa en la plataforma: academy
   ============================================================ */

var PM_API = 'https://api.playmetrics.com';
var ROL_MIAMI = 'Admin_576';
var POPULATE = 'subscriptions,subscriptions:player,subscriptions:payment_details,subscriptions:user,team_assignments';

/** Instala el disparador de cada hora (ejecutar una sola vez). */
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  return 'Disparador instalado: cada hora.';
}

/** Prueba sin enviar nada: inicia sesión, lee los programas y resume lo que se mandaría. */
function probar() {
  var cfg = config_();
  var ses = iniciarSesion_(cfg);
  var out = [];
  cfg.programas.forEach(function (id) {
    var filas = leerPrograma_(ses, id);
    var sinTalla = filas.filter(function (f) { return !f.size; }).length;
    var porteros = filas.filter(function (f) { return f.role === 'goalkeeper'; }).length;
    out.push('Programa ' + id + ': ' + filas.length + ' jugadores vigentes · ' + porteros + ' porteros · ' + sinTalla + ' sin talla');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

/** Lo que corre cada hora. */
function sincronizar() {
  var cfg = config_();
  var ses = iniciarSesion_(cfg);
  var filas = [];
  cfg.programas.forEach(function (id) { filas = filas.concat(leerPrograma_(ses, id)); });
  if (!filas.length) { Logger.log('Sin jugadores vigentes; no se envía nada.'); return; }
  var r = enviar_(cfg, filas);
  Logger.log('Enviados ' + filas.length + ' → nuevos ' + r.added + ', actualizados ' + r.updated + ', sin cambios ' + (r.unchanged || 0) + ', ya entregados ' + r.kept + ', omitidos ' + r.skipped);
  PropertiesService.getScriptProperties().setProperty('ULTIMA_SINCRONIZACION', new Date().toISOString() + ' · ' + filas.length + ' jugadores');
}

/* ---------- Configuración ---------- */
function config_() {
  var pr = PropertiesService.getScriptProperties();
  var need = ['PM_FIREBASE_KEY', 'PM_PROGRAMS', 'SC_URL', 'SC_KEY', 'SC_ROSTER_KEY', 'SC_PROGRAM'];
  var faltan = need.filter(function (k) { return !pr.getProperty(k); });
  var conClave = pr.getProperty('PM_EMAIL') && pr.getProperty('PM_PASSWORD') && pr.getProperty('PM_PASSWORD') !== 'PENDIENTE';
  if (!pr.getProperty('PM_REFRESH') && !conClave) faltan.push('PM_REFRESH (o PM_EMAIL y PM_PASSWORD)');
  if (faltan.length) throw new Error('Faltan propiedades del script: ' + faltan.join(', '));
  return {
    refresh: pr.getProperty('PM_REFRESH'), rol: pr.getProperty('PM_ROL') || ROL_MIAMI,
    email: pr.getProperty('PM_EMAIL'), password: pr.getProperty('PM_PASSWORD'), firebaseKey: pr.getProperty('PM_FIREBASE_KEY'),
    programas: pr.getProperty('PM_PROGRAMS').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    scUrl: pr.getProperty('SC_URL').replace(/\/$/, ''), scKey: pr.getProperty('SC_KEY'), rosterKey: pr.getProperty('SC_ROSTER_KEY'), programa: pr.getProperty('SC_PROGRAM')
  };
}

/* ---------- PlayMetrics ----------
   La web de PlayMetrics se identifica con Firebase (correo y contraseña) y
   luego pide a su API una "access key". Aquí se hace lo mismo que hace la
   web, sin guardar nada más que lo necesario durante la ejecución. */
function iniciarSesion_(cfg) {
  var idToken = cfg.refresh ? tokenPorLlave_(cfg) : tokenPorClave_(cfg);
  var r2 = UrlFetchApp.fetch(PM_API + '/firebase/user/login', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'Firebase-Token': idToken }, payload: JSON.stringify({ current_role_id: cfg.rol, client_type: 'desktop' })
  });
  if (r2.getResponseCode() !== 200) throw new Error('PlayMetrics no devolvió la sesión (' + r2.getResponseCode() + ')');
  var u = JSON.parse(r2.getContentText()); u = u.data || u;
  if (!u.access_key) throw new Error('PlayMetrics no devolvió la access key');
  var club = (u.current_role || {}).club_id, quiero = Number(String(cfg.rol).replace(/\D/g, ''));
  if (quiero && club && club !== quiero) throw new Error('PlayMetrics entró al club ' + club + ' y no al ' + quiero + ' (rol ' + cfg.rol + ')');
  return { token: idToken, accessKey: u.access_key };
}

/** Sesión guardada (como "LV · Resultados a Meta"): renueva el token sin contraseña. */
function tokenPorLlave_(cfg) {
  var r = UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.firebaseKey), {
    method: 'post', muteHttpExceptions: true, contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cfg.refresh)
  });
  var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (!j.id_token) throw new Error('PlayMetrics: la sesión guardada ya no sirve (' + ((j.error || {}).message || r.getResponseCode()) + '). Hay que renovar PM_REFRESH.');
  if (j.refresh_token && j.refresh_token !== cfg.refresh) PropertiesService.getScriptProperties().setProperty('PM_REFRESH', j.refresh_token);
  return j.id_token;
}

/** Usuario con correo y contraseña. */
function tokenPorClave_(cfg) {
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(cfg.firebaseKey), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: cfg.email, password: cfg.password, returnSecureToken: true })
  });
  if (r.getResponseCode() !== 200) {
    var msg = ''; try { msg = JSON.parse(r.getContentText()).error.message; } catch (e) {}
    throw new Error('PlayMetrics no aceptó el correo o la contraseña (' + r.getResponseCode() + ' ' + msg + ')');
  }
  return JSON.parse(r.getContentText()).idToken;
}

function pedir_(ses, ruta) {
  var r = UrlFetchApp.fetch(PM_API + ruta, { muteHttpExceptions: true, headers: { 'Firebase-Token': ses.token, 'pm-access-key': ses.accessKey, 'Content-Type': 'application/json' } });
  if (r.getResponseCode() !== 200) throw new Error('PlayMetrics respondió ' + r.getResponseCode() + ' en ' + ruta);
  var j = JSON.parse(r.getContentText());
  return j.data || j;
}

/** Jugadores vigentes de un programa, ya en el formato de la plataforma. */
function leerPrograma_(ses, programId) {
  var d = pedir_(ses, '/director/programs/' + programId + '?populate=' + POPULATE);
  var cfg = typeof d.json === 'string' ? JSON.parse(d.json) : (d.json || d.config || {});
  var preguntas = preguntas_(cfg.questions);
  var idTalla = idPregunta_(preguntas, /shirt size|talla/i), idPortero = idPregunta_(preguntas, /goalkeeper|portero/i);
  var sedes = {};
  (cfg.packages || []).forEach(function (p) { sedes[p.id] = sede_(p.name); });
  return (d.subscriptions || []).filter(function (s) { return /^(Current|Completed)$/.test(s.status); }).map(function (s) {
    var f = (s.values_json && s.values_json.form) || {};
    var pl = s.player || {}, us = s.user || {};
    var talla = normTalla_(idTalla != null ? f[idTalla] : '');
    return {
      external_id: 'pm-' + s.id,
      player: ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim(),
      email: String(us.email || us.secondary_email || '').trim().toLowerCase(),
      team: (('U' + (pl.age_by_birth_year || '?') + ' ' + (pl.gender || '')).trim() + (sedes[s.package_id] ? ' · ' + sedes[s.package_id] : '')),
      role: (idPortero != null && String(f[idPortero]).toLowerCase() === 'yes') ? 'goalkeeper' : 'player',
      size: talla,
      sockSize: mediasPorTalla_(talla)
    };
  }).filter(function (x) { return x.player; });
}

/** "COMPETITIVE PROGRAM CORAL GABLES 2026/27" → "Coral Gables" */
function sede_(name) {
  var n = String(name || '').replace(/competitive prog(ram|\.)?/i, '').replace(/\d{4}\/\d{2}/g, '').replace(/\s+/g, ' ').trim();
  return n.toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
}

function preguntas_(q) {
  var out = [];
  (function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6) return;
    if (Array.isArray(o)) { o.forEach(function (x) { walk(x, depth + 1); }); return; }
    var txt = o.label || o.title;   // PlayMetrics guarda el texto de la pregunta en "title"
    if (txt && o.id != null) out.push({ id: o.id, label: String(txt) });
    Object.keys(o).forEach(function (k) { walk(o[k], depth + 1); });
  })(q, 0);
  return out;
}
function idPregunta_(preguntas, re) { var p = preguntas.filter(function (x) { return re.test(x.label); })[0]; return p ? String(p.id) : null; }

/** "Youth M" → YM, "Adult S" → S. Lo que no se reconoce queda vacío para corregir en el panel. */
function normTalla_(raw) {
  var k = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  var alias = { 'youth xxs': 'YXS', 'youth xs': 'YXS', 'youth s': 'YS', 'youth small': 'YS', 'youth m': 'YM', 'youth medium': 'YM', 'youth l': 'YL', 'youth large': 'YL',
    'adult s': 'S', 'adult small': 'S', 'adult m': 'M', 'adult medium': 'M', 'adult l': 'L', 'adult large': 'L', 'adult xl': 'XL', 'yxs': 'YXS', 'ys': 'YS', 'ym': 'YM', 'yl': 'YL', 's': 'S', 'm': 'M', 'l': 'L', 'xl': 'XL' };
  return alias[k] || '';
}
/** La inscripción no pregunta talla de medias: se asume por la de camiseta. */
function mediasPorTalla_(t) { return { YXS: 'S', YS: 'S', YM: 'S', YL: 'M', S: 'M', M: 'M', L: 'L', XL: 'L' }[t] || ''; }

/* ---------- Plataforma (Supabase) ---------- */
function enviar_(cfg, filas) {
  var r = UrlFetchApp.fetch(cfg.scUrl + '/rest/v1/rpc/import_roster', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: cfg.scKey, Authorization: 'Bearer ' + cfg.scKey },
    payload: JSON.stringify({ p_key: cfg.rosterKey, p_program: cfg.programa, p_rows: filas })
  });
  if (r.getResponseCode() !== 200) throw new Error('La plataforma respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}
