// Barrido exhaustivo de la interfaz: pulsa cada botón de cada página del panel y de la
// tienda, en demo local y en modo nube (Supabase simulado), en escritorio y en teléfono.
// Busca: errores de JavaScript, ventanas que no abren o no cierran, contenido que se
// sale de la pantalla y botones que no hacen nada visible.
const { chromium } = require('playwright-core');
const { fakeSupabase, newPage: newCloudPage } = require('./fake-supabase');

const BASE = process.env.BASE || 'http://localhost:8790/';
const PAGES = ['dashboard', 'inventory', 'products', 'movements', 'purchases', 'deliveries', 'orders', 'shipments', 'customers', 'stores', 'alerts', 'reports', 'settings'];
// Acciones que reemplazarían todos los datos o cerrarían la sesión: se prueban en otras suites.
const SKIP = /reiniciar|empezar limpio|cargar datos de demostraci|cerrar sesi|^quitar$|restaurar/i;

const issues = [];
const note = (where, what, extra) => { issues.push({ where, what, extra }); console.log('  HALLAZGO ' + where + ' — ' + what + (extra ? '  → ' + JSON.stringify(extra).slice(0, 200) : '')); };

async function sweep(page, label) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text()); });
  page.context().on('page', p => p.close().catch(() => {}));   // ventanas de impresión
  let clicks = 0;

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const modalState = () => page.evaluate(() => {
    const box = document.getElementById('modalBox');
    const open = document.getElementById('modalOverlay').classList.contains('open');
    if (!open) return { open: false };
    const r = box.getBoundingClientRect();
    return { open: true, wide: box.scrollWidth - box.clientWidth, offscreen: r.right > innerWidth + 1 || r.left < -1, title: (box.querySelector('h2') || {}).textContent || '' };
  });
  const closeAll = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { if (document.getElementById('modalOverlay').classList.contains('open')) UI.closeModal(); Shop.closeCart(); });
  };
  const checkErrors = where => { if (errors.length) { note(label + ' · ' + where, 'error de JavaScript', errors.splice(0)); } };

  // ---------- Panel ----------
  await page.evaluate(() => App.setMode('admin'));
  for (const pg of PAGES) {
    await page.evaluate(p => Admin.go(p), pg);
    await page.waitForTimeout(150);
    checkErrors(pg);
    const ov = await overflow();
    if (ov > 0) note(label + ' · ' + pg, 'la página se sale de la pantalla', ov);
    const empty = await page.evaluate(() => [...document.querySelectorAll('.page.active .kpi-value')].filter(e => !e.textContent.trim()).length);
    if (empty) note(label + ' · ' + pg, 'indicadores vacíos', empty);

    // Un botón por "tipo" (texto + atributo de datos), para no pulsar 300 filas iguales.
    const targets = await page.evaluate(skip => {
      const re = new RegExp(skip, 'i');
      const seen = new Set(), out = [];
      document.querySelectorAll('.page.active button').forEach((b, i) => {
        if (b.disabled || !b.offsetParent) return;
        const text = b.textContent.trim().replace(/\s+/g, ' ');
        if (re.test(text)) return;
        const dataKey = [...b.attributes].map(a => a.name).filter(n => n.startsWith('data-')).join(',');
        const key = text.replace(/\d+/g, '#') + '|' + dataKey;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ i, text, key });
      });
      return out;
    }, SKIP.source);

    for (const t of targets) {
      await page.evaluate(p => Admin.go(p), pg);
      await page.waitForTimeout(60);
      const ok = await page.evaluate(({ i }) => {
        const b = document.querySelectorAll('.page.active button')[i];
        if (!b) return false;
        b.click();
        return true;
      }, t);
      if (!ok) continue;
      clicks++;
      await page.waitForTimeout(220);
      const m = await modalState();
      if (m.open && (m.wide > 2 || m.offscreen)) note(label + ' · ' + pg + ' · "' + t.text + '"', 'la ventana se sale de la pantalla', m);
      // Segundo nivel: dentro de la ventana, cada botón (también guardar con campos vacíos).
      if (m.open && !/¿/.test(m.title)) {
        const inner = await page.evaluate(() => [...document.querySelectorAll('#modalBox button')]
          .map((b, i) => ({ i, text: b.textContent.trim().replace(/\s+/g, ' '), primary: b.classList.contains('btn-primary') }))
          .filter(x => x.text && !/cancelar|cerrar|seguir viendo|^×$/i.test(x.text)));
        for (const b of inner.filter(x => !x.primary).slice(0, 12).concat(inner.filter(x => x.primary))) {
          const still = await modalState();
          if (!still.open) break;
          await page.evaluate(i => { const el = document.querySelectorAll('#modalBox button')[i]; if (el && !el.disabled) el.click(); }, b.i);
          clicks++;
          await page.waitForTimeout(160);
          checkErrors(pg + ' · "' + t.text + '" → "' + b.text + '"');
          const after = await modalState();
          if (after.open && (after.wide > 2 || after.offscreen)) note(label + ' · ' + pg + ' · "' + t.text + '" → "' + b.text + '"', 'la ventana se sale de la pantalla', after);
          if (b.primary) break;
        }
      }
      // Confirmaciones: se cancelan (no se ejecuta la acción)
      if ((await modalState()).open) {
        await closeAll();
        await page.waitForTimeout(80);
        const still = await modalState();
        if (still.open) note(label + ' · ' + pg + ' · "' + t.text + '"', 'la ventana no se cierra con Escape ni Cancelar', still);
        await page.evaluate(() => UI.closeModal());
      }
      checkErrors(pg + ' · "' + t.text + '"');
      const ov2 = await overflow();
      if (ov2 > 0) note(label + ' · ' + pg + ' · "' + t.text + '"', 'tras pulsar, la página se sale de la pantalla', ov2);
    }
  }

  // ---------- Tienda ----------
  await page.evaluate(() => App.setMode('shop'));
  const stores = await page.evaluate(() => Store.stores.map(s => s.id));
  for (const s of stores) {
    await page.evaluate(id => { Store.setStore(id); Shop.render(); }, s);
    await page.waitForTimeout(150);
    checkErrors('tienda ' + s);
    if (await overflow() > 0) note(label + ' · tienda ' + s, 'la tienda se sale de la pantalla', await overflow());
    const cards = await page.evaluate(() => [...document.querySelectorAll('.kit-card[data-kit], .p-card[data-id]')].slice(0, 40).map(c => c.dataset.kit ? { kit: c.dataset.kit } : { id: c.dataset.id }));
    for (const c of cards) {
      await page.evaluate(x => (x.kit ? Shop.openKit(x.kit) : Shop.openProduct(x.id)), c);
      clicks++;
      await page.waitForTimeout(120);
      const m = await modalState();
      if (!m.open) note(label + ' · tienda ' + s, 'una tarjeta no abre su ficha', c);
      else if (m.wide > 2 || m.offscreen) note(label + ' · tienda ' + s + ' · ' + (c.kit || c.id), 'la ficha se sale de la pantalla', m);
      await closeAll();
      checkErrors('tienda ' + s + ' · ' + (c.kit || c.id));
    }
    for (const id of ['cartBtn', 'acctBtn', 'langBtn', 'langBtn']) {
      await page.evaluate(x => document.getElementById(x).click(), id);
      clicks++;
      await page.waitForTimeout(150);
      await closeAll();
      checkErrors('tienda ' + s + ' · ' + id);
    }
  }
  return clicks;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const views = [
    { name: 'escritorio', opts: { viewport: { width: 1366, height: 800 } } },
    { name: 'teléfono', opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ];
  for (const v of views) {
    // Demo local
    console.log(`\n== Demo local · ${v.name} ==`);
    let ctx = await browser.newContext(v.opts);
    await ctx.addInitScript(() => { window.SOCCERCAGE_FORCE_LOCAL = true; });
    let page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('.store-tab');
    console.log('  pulsaciones: ' + await sweep(page, 'local/' + v.name));
    await ctx.close();

    // Base compartida (simulada), con sesión de administrador y datos de demo
    console.log(`\n== Base compartida · ${v.name} ==`);
    const fake = fakeSupabase();
    page = await newCloudPage(browser, fake, v.opts);
    await page.goto(BASE + 'panel');
    await page.waitForSelector('#lgGo');
    await page.fill('#lgEmail', 'admin@soccercage.com');
    await page.fill('#lgPass', 'clave-segura-123');
    await page.click('#lgGo');
    await page.waitForSelector('#frDemo');
    await page.click('#frDemo');
    await page.waitForSelector('#appAdmin.active');
    await page.waitForFunction(() => !Cloud.pending);
    console.log('  pulsaciones: ' + await sweep(page, 'nube/' + v.name));
    await page.waitForFunction(() => !Cloud.pending);
    if (fake.db.state.rev < 1) note('nube/' + v.name, 'los cambios no llegaron al servidor');
    await page.context().close();
  }
  await browser.close();
  console.log(`\n${issues.length} hallazgos`);
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
