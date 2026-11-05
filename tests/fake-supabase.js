// Supabase simulado para las pruebas en navegador: mismas reglas que supabase/schema.sql.
const path = require('path');
const API = 'https://fake-proyecto.supabase.co';
const SHOTS = path.join(__dirname, 'shots');

function fakeSupabase() {
  const db = {
    users: { 'admin@soccercage.com': 'clave-segura-123', 'eduardo@soccercage.com': 'otra-clave-456', 'intruso@gmail.com': 'intruso-789' },
    staff: [{ email: 'admin@soccercage.com', name: 'Soccer Cage', role: 'admin' }],
    state: { rev: 0, data: null, updated_by: null },
    history: [],
    calls: [],
    files: []
  };
  const strip = (o, keys) => { const c = Object.assign({}, o); keys.forEach(k => delete c[k]); return c; };
  const who = req => {
    const a = req.headers()['authorization'] || '';
    return a.startsWith('Bearer tok:') ? a.slice('Bearer tok:'.length) : null;
  };
  const member = email => db.staff.find(s => s.email === email) || null;

  const handle = async route => {
    const req = route.request();
    const url = new URL(req.url());
    const isJson = String(req.headers()['content-type'] || '').includes('json');
    const body = isJson && req.postData() ? JSON.parse(req.postData()) : {};
    const send = (status, data) => route.fulfill({ status, contentType: 'application/json', body: data === undefined ? '' : JSON.stringify(data) });
    // Fotos públicas: se sirven sin clave, como en Supabase.
    if (url.pathname.startsWith('/storage/v1/object/public/fotos/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
    }
    if (req.headers()['apikey'] !== 'sb_publishable_prueba') return send(401, { message: 'Invalid API key' });
    if (url.pathname.startsWith('/storage/v1/object/fotos/')) {
      if (!member(who(req))) return send(403, { message: 'new row violates row-level security policy' });
      db.files.push(url.pathname.slice('/storage/v1/object/fotos/'.length));
      return send(200, { Key: 'fotos/' + db.files[db.files.length - 1] });
    }
    db.calls.push(url.pathname.replace('/rest/v1/rpc/', 'rpc:'));

    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'password') {
        if (db.users[body.email] !== body.password) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return send(200, { access_token: 'tok:' + body.email, refresh_token: 'r:' + body.email, expires_in: 3600, user: { email: body.email } });
      }
      if (db.refreshFails) return send(400, { error: 'invalid_grant', error_description: 'Refresh Token Not Found' });
      const email = String(body.refresh_token).slice(2);
      return send(200, { access_token: 'tok:' + email, refresh_token: body.refresh_token, expires_in: 3600, user: { email } });
    }
    if (url.pathname === '/auth/v1/logout') return send(204);
    if (url.pathname === '/auth/v1/user' && req.method() === 'PUT') {
      const email = who(req);
      if (!email) return send(401, { message: 'invalid JWT' });
      if (String(body.password || '').length < 6) return send(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
      db.users[email] = body.password;
      return send(200, { email });
    }
    if (url.pathname === '/auth/v1/recover') return send(200, {});

    const fn = url.pathname.replace('/rest/v1/rpc/', '');
    const email = who(req), me = member(email);
    const denied = () => send(403, { code: '42501', message: 'not_staff' });
    switch (fn) {
      case 'public_catalog': {
        const s = db.state;
        if (!s.data) return send(200, { rev: s.rev, empty: true });
        return send(200, {
          rev: s.rev, version: s.data.version,
          settings: { company: s.data.settings.company, city: s.data.settings.city, currency: s.data.settings.currency },
          stores: s.data.stores.map(x => strip(x, ['stripeAccount'])),
          products: s.data.products.filter(p => p.active).map(p => strip(p, ['cost', 'minStock', 'reorderPoint', 'weightOz']))
        });
      }
      case 'whoami': return send(200, me ? { email: me.email, name: me.name, role: me.role } : null);
      case 'load_state': return me ? send(200, db.state) : denied();
      case 'load_state_if_newer': return me ? send(200, db.state.rev === body.p_rev ? null : db.state) : denied();
      case 'save_state': {
        if (!me) return denied();
        if (db.state.rev !== body.p_rev) return send(200, { ok: false, conflict: true, rev: db.state.rev, updated_by: db.state.updated_by });
        if (db.state.data) db.history.unshift({ id: db.history.length + 1, rev: db.state.rev, data: db.state.data, saved_by: db.state.updated_by, saved_at: new Date().toISOString() });
        db.state = { rev: db.state.rev + 1, data: body.p_data, updated_by: email };
        return send(200, { ok: true, rev: db.state.rev });
      }
      case 'list_staff': return me && me.role === 'admin' ? send(200, db.staff) : denied();
      case 'upsert_staff': {
        if (!me || me.role !== 'admin') return denied();
        const e = String(body.p_email).toLowerCase();
        db.staff = db.staff.filter(s => s.email !== e).concat({ email: e, name: body.p_name, role: body.p_role });
        return send(200, db.staff);
      }
      case 'list_history': return me && me.role === 'admin' ? send(200, db.history.slice(0, 30).map(h => ({ id: h.id, rev: h.rev, saved_by: h.saved_by, saved_at: h.saved_at }))) : denied();
      default: return send(404, { message: 'no existe ' + fn });
    }
  };
  return { db, handle };
}

async function newPage(browser, fake, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 } }, opts));
  // La configuración real apunta al proyecto de verdad: aquí se cambia por la simulada.
  await ctx.route('**/js/config.js', r => r.fulfill({ contentType: 'application/javascript',
    body: `window.SOCCERCAGE_CLOUD = { enabled: true, url: '${API}', key: 'sb_publishable_prueba' };` }));
  await ctx.route(API + '/**', fake.handle);
  const page = await ctx.newPage();
  page.issues = [];
  page.on('pageerror', e => page.issues.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.issues.push(m.text()); });
  page.shot = name => page.screenshot({ path: path.join(SHOTS, name + '.png') });
  return page;
}

const login = async (page, email, pass) => {
  // En /panel sin sesión el formulario ya está abierto; si se cerró, se abre desde la entrada.
  if (!await page.locator('#lgGo').count()) await page.click('#panelGate button');
  await page.waitForSelector('#lgGo');
  await page.fill('#lgEmail', email);
  await page.fill('#lgPass', pass);
  await page.click('#lgGo');
};

module.exports = { fakeSupabase, newPage, login, API };
