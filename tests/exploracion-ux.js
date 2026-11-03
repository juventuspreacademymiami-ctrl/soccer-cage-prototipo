// Exploración de experiencia de usuario: recorre acciones de la tienda y del
// panel midiendo, en cada una, si la página o el contenedor se desplazan solos,
// si se pierde el foco o el texto escrito, y si aparecen errores.
// Uso: node exploracion-ux.js  (con `npm run serve` en otra terminal)
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:8790/';

const findings = [];
const note = (sev, where, what, data) => { findings.push({ sev, where, what, data }); console.log(`  [${sev}] ${where}: ${what}` + (data !== undefined ? '  → ' + JSON.stringify(data) : '')); };
const okLine = (where, what) => console.log(`  ok   ${where}: ${what}`);

async function run(browser, label, opts) {
  console.log(`\n== ${label} ==`);
  const ctx = await browser.newContext(opts);
  // Estas pruebas son de la demo local: no deben depender de la base compartida.
  await ctx.addInitScript(() => { window.SOCCERCAGE_FORCE_LOCAL = true; });
  const page = await ctx.newPage();
  page.on('pageerror', e => note('ERROR', label, 'excepción: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') note('ERROR', label, 'consola: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.kit-card');

  const winY = () => page.evaluate(() => window.scrollY);
  const focusDesc = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : ''; });
  const scrollTo = y => page.evaluate(y => window.scrollTo(0, y), y);
  const maxY = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  // En móvil el menú lateral está plegado: se abre con el botón de la barra.
  const nav = async p => {
    if (await page.locator('#sidebarToggle').isVisible()) {
      await page.click('#sidebarToggle');
      await page.waitForTimeout(350);
    }
    await page.click('.side-link[data-page="' + p + '"]');
    if (await page.locator('#sidebar.open').count()) note('UX', 'panel/menú', 'el menú lateral no se cierra tras elegir sección', p);
  };

  /** ¿Algún aviso emergente tapa un botón de acción visible? */
  async function toastCovers(where) {
    const hit = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('.toast')].map(t => t.getBoundingClientRect());
      if (!toasts.length) return null;
      const btns = [...document.querySelectorAll('.modal-foot .btn, .drawer-foot .btn, #cartBody button')].filter(b => b.offsetParent);
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        if (toasts.some(t => !(t.right < r.left || t.left > r.right || t.bottom < r.top || t.top > r.bottom))) return b.textContent.trim().slice(0, 30);
      }
      return '';
    });
    if (hit === null) note('INFO', where, 'no había aviso visible para medir');
    else if (hit) note('UX', where, 'un aviso emergente tapa un botón', hit);
    else okLine(where, 'el aviso no tapa ningún botón');
  }

  /** Ejecuta una acción con la página desplazada y comprueba que no vuelve arriba. */
  async function keepsScroll(where, act, allow) {
    const max = await maxY();
    if (max < 200) { okLine(where, 'página corta, no aplica'); return; }
    await scrollTo(Math.min(max, 600));
    const before = await winY();
    await act();
    await page.waitForTimeout(250);
    const after = await winY();
    if (Math.abs(after - before) > (allow || 4)) note('UX', where, 'la página se desplaza sola', { antes: before, despues: after });
    else okLine(where, 'conserva el desplazamiento (' + before + ')');
  }

  /* ---------- Tienda ---------- */
  // Escribir en el buscador: ¿se pierde el foco o el texto?
  await page.fill('#shopSearch', '');
  await page.type('#shopSearch', 'camp socks', { delay: 20 });
  const q = await page.inputValue('#shopSearch');
  if (q !== 'camp socks') note('UX', 'tienda/buscador', 'se pierde texto al escribir', q);
  if ((await focusDesc()) !== 'shopSearch') note('UX', 'tienda/buscador', 'se pierde el foco al escribir', await focusDesc());
  else okLine('tienda/buscador', 'texto y foco se conservan');
  await page.fill('#shopSearch', '');

  await keepsScroll('tienda/ordenar', () => page.selectOption('#shopSort', 'price-asc'));
  await keepsScroll('tienda/ocultar agotados', () => page.locator('#shopHideOut').evaluate(e => { e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); }));
  await keepsScroll('tienda/cambiar idioma', () => page.locator('#langBtn').evaluate(e => e.click()));
  await page.locator('#langBtn').evaluate(e => e.click());

  // Compra: tras pagar, ¿vuelve arriba la página de fondo?
  await page.evaluate(() => { Store.clearCart(); Store.signIn({ email: 'laura.gomez@example.com' }); Shop.renderAccount(); Shop.renderCart(); });
  await page.click('.p-card[data-id="camp-socks"]');
  await page.click('.size-btn[data-size="M"]');
  await page.click('#addCart');
  await page.waitForSelector('#cartDrawer.open');
  await page.waitForTimeout(350);
  await toastCovers('carrito tras añadir');
  await page.click('#goCheckout');
  await page.waitForSelector('#payNow');
  // Enter en el formulario de pago
  await page.locator('#ckPhone').press('Enter');
  await page.waitForTimeout(300);
  if (await page.locator('#payNow').count() && !(await page.locator('.processing').count())) {
    note('UX', 'checkout', 'Enter dentro del formulario no hace nada (hay que buscar el botón Pagar)');
    await page.click('#payNow');
  } else okLine('checkout', 'Enter en un campo inicia el pago');
  await page.waitForSelector('.success-mark', { timeout: 15000 });
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });
  await page.waitForTimeout(200);
  okLine('checkout', 'compra completa');

  // Clic fuera del checkout con datos escritos: ¿se pierden?
  await page.click('.p-card[data-id="camp-socks"]');
  await page.click('.size-btn[data-size="M"]');
  await page.click('#addCart');
  await page.waitForSelector('#cartDrawer.open');
  await page.click('#goCheckout');
  await page.waitForSelector('#payNow');
  await page.fill('#ckPhone', '(305) 555-9999');
  await page.check('input[name="ckFulfill"][value="shipping"]');
  await page.fill('#ckAddr', '123 Test St');
  await page.mouse.click(5, 300);   // fuera del modal
  await page.waitForTimeout(200);
  if (await page.locator('#payNow').count()) okLine('checkout', 'un clic fuera no cierra el formulario con datos escritos');
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });
  {
    await page.evaluate(() => Shop.checkout());
    await page.waitForSelector('#payNow');
    const addr = await page.locator('#ckAddr').inputValue();
    if (addr !== '123 Test St') note('UX', 'checkout', 'un clic fuera del formulario lo cierra y se pierde lo escrito (dirección, entrega)', { direccion: addr });
    else okLine('checkout', 'clic fuera: se conserva lo escrito');
  }
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });
  await page.evaluate(() => Store.clearCart());

  // Kit: Enter en el nombre del jugador
  await page.click('.kit-card');
  await page.waitForSelector('#addKit');
  await page.fill('#kitPlayer', 'Kid Enter');
  await page.locator('#kitPlayer').press('Enter');
  await page.waitForTimeout(200);
  const kitStill = await page.locator('#addKit').count();
  const nameKept = kitStill ? await page.inputValue('#kitPlayer') : '';
  if (kitStill && nameKept !== 'Kid Enter') note('UX', 'kit', 'Enter en el nombre borra lo escrito', nameKept);
  else okLine('kit', 'Enter en el nombre no rompe nada');
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

  /* ---------- Panel ---------- */
  await page.click('#btnAdmin');
  await page.waitForSelector('#page-dashboard.active');

  const adminSearch = async (page_, id, text) => {
    await nav(page_);
    await page.fill('#' + id, '');
    await page.type('#' + id, text, { delay: 15 });
    const v = await page.inputValue('#' + id);
    const f = await focusDesc();
    if (v !== text || f !== id) note('UX', `panel/${page_}/buscador`, 'se pierde texto o foco al escribir', { valor: v, foco: f });
    else okLine(`panel/${page_}/buscador`, 'texto y foco se conservan');
    await page.fill('#' + id, '');
  };
  await adminSearch('inventory', 'invQ', 'camp socks');
  await adminSearch('products', 'prodQ', 'kit');
  await adminSearch('movements', 'movQ', 'oc-1042');
  await adminSearch('orders', 'ordQ', 'laura');
  await adminSearch('customers', 'custQ', 'gomez');
  await adminSearch('deliveries', 'delQ', 'u12');

  // Filtros que repintan la página mientras estás abajo
  await nav('inventory');
  await keepsScroll('panel/inventario/filtro estado', () => page.selectOption('#invStatus', 'bajo'));
  await page.selectOption('#invStatus', 'todos');
  await keepsScroll('panel/inventario/+ entrada y guardar', async () => {
    await page.locator('[data-size]').last().evaluate(e => e.click());
    await page.waitForSelector('#mvSave');
    await page.click('#mvSave');
    await page.waitForSelector('#mvSave', { state: 'detached' });
  });
  await nav('movements');
  await keepsScroll('panel/movimientos/filtro tipo', () => page.selectOption('#movType', 'salida'));
  await nav('deliveries');
  await keepsScroll('panel/entregas/elegir talla en la tabla', () => page.locator('[data-set-size]').last().evaluate(e => { e.value = 'YM'; e.dispatchEvent(new Event('change', { bubbles: true })); }));
  await keepsScroll('panel/entregas/entregar y confirmar', async () => {
    await page.locator('[data-deliver]').last().evaluate(e => e.click());
    await page.waitForSelector('#delGo');
    await page.waitForTimeout(200);
    await toastCovers('entrega con aviso previo visible');
    if (await page.locator('#delGo').isEnabled()) { await page.click('#delGo'); await page.waitForSelector('#delGo', { state: 'detached' }); }
    else await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });
  });
  await nav('products');
  await keepsScroll('panel/productos/desactivar', async () => {
    await page.locator('[data-toggle]').last().evaluate(e => e.click());
    await page.waitForSelector('#confirmYes');
    await page.click('#confirmYes');
    await page.waitForTimeout(200);
  });
  await page.locator('[data-toggle]').last().evaluate(e => e.click());
  await nav('stores');
  await keepsScroll('panel/tiendas/pausar', () => page.locator('[data-toggle-store]').last().evaluate(e => e.click()));
  await page.locator('[data-toggle-store]').last().evaluate(e => e.click());
  await keepsScroll('panel/tiendas/cambiar idioma', () => page.locator('#langBtn').evaluate(e => e.click()));
  await page.locator('#langBtn').evaluate(e => e.click());
  await nav('orders');
  await keepsScroll('panel/pedidos/abrir detalle y avanzar estado', async () => {
    await page.locator('[data-order]').last().evaluate(e => e.click());
    await page.waitForSelector('.modal-foot');
    if (await page.locator('#odNext').count()) { await page.click('#odNext'); await page.waitForTimeout(200); }
    else await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });
  });
  await nav('alerts');
  await keepsScroll('panel/alertas/reponer y guardar', async () => {
    await page.locator('[data-restock]').last().evaluate(e => e.click());
    await page.waitForSelector('#mvSave');
    await page.click('#mvSave');
    await page.waitForSelector('#mvSave', { state: 'detached' });
  });

  // Formulario de producto: ¿se conservan los datos al cambiar preset o tipo?
  await nav('products');
  await page.click('#prodNew');
  await page.waitForSelector('#pfSave');
  await page.waitForTimeout(150);
  await page.fill('#pfName', 'Prueba UX');
  await page.fill('[data-sz-stock="M"]', '9');
  await page.locator('[data-sz-stock="M"]').dispatchEvent('change');
  await page.click('[data-preset="socks"]');
  const mAfter = await page.locator('[data-sz-stock="M"]').inputValue();
  if (mAfter !== '9') note('UX', 'panel/producto', 'al cambiar el preset de tallas se pierde el stock escrito', { M: mAfter });
  else okLine('panel/producto', 'cambiar preset conserva el stock escrito');
  await page.selectOption('#pfKind', 'socks');
  if ((await page.inputValue('#pfName')) !== 'Prueba UX') note('UX', 'panel/producto', 'cambiar el tipo borra el nombre');
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

  // Cerrar formulario con cambios sin guardar
  await page.click('#prodNew');
  await page.waitForSelector('#pfSave');
  await page.waitForTimeout(150);
  await page.fill('#pfName', 'Sin guardar');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  if (await page.locator('#pfSave').count() === 0) note('UX', 'panel/producto', 'Escape cierra el formulario con cambios sin guardar y sin avisar');
  else okLine('panel/producto', 'Escape con cambios sin guardar avisa antes de cerrar');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  if (await page.locator('#pfSave').count()) note('UX', 'panel/producto', 'la segunda pulsación de Escape no cierra');
  await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

  // Textos cortados / desbordes en el panel en esta anchura
  for (const p of ['dashboard', 'inventory', 'products', 'movements', 'purchases', 'deliveries', 'orders', 'shipments', 'customers', 'stores', 'alerts', 'reports', 'settings']) {
    await nav(p);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 0) note('UX', 'panel/' + p, 'desborde horizontal', over);
    const empty = await page.evaluate(() => [...document.querySelectorAll('.page.active .kpi-value')].filter(e => !e.textContent.trim()).length);
    if (empty) note('UX', 'panel/' + p, 'indicadores vacíos', empty);
  }
  okLine('panel', 'sin desbordes ni indicadores vacíos en las 13 secciones');

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  await run(browser, 'escritorio 1366×768', { viewport: { width: 1366, height: 768 } });
  await run(browser, 'portátil 1280×600', { viewport: { width: 1280, height: 600 } });
  await run(browser, 'móvil 390×844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await browser.close();
  console.log(`\n${findings.length} hallazgos`);
  const seen = new Set();
  findings.forEach(f => { const k = f.where + '|' + f.what; if (!seen.has(k)) { seen.add(k); console.log(` - [${f.sev}] ${f.where}: ${f.what}`); } });
})();
