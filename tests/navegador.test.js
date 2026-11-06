// Pruebas en navegador real (Chrome instalado) con playwright-core.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8790/';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (cond, label, extra) => {
  if (!cond) fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
};

async function newPage(browser, opts) {
  const ctx = await browser.newContext(opts);
  // Estas pruebas son de la demo local: no deben depender de la base compartida.
  await ctx.addInitScript(() => { window.SOCCERCAGE_FORCE_LOCAL = true; });
  const page = await ctx.newPage();
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) issues.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  page.on('requestfailed', r => issues.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) issues.push('http ' + r.status() + ': ' + r.url()); });
  page.issues = issues;
  page.shot = async (name, full) => {
    if (full) {
      // Las fotos usan carga diferida: se recorre la página para que aparezcan en la captura.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)); }
        window.scrollTo(0, 0);
      });
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(450);   // deja terminar las transiciones
    return page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full });
  };
  return page;
}

const scenarios = {
  /* Recorrido visual: tres tiendas, kit, pieza suelta */
  async smoke(browser) {
    const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
    await page.goto(BASE);
    await page.waitForSelector('.kit-card');
    await page.waitForLoadState('networkidle');
    ok(await page.locator('.store-tab').count() === 3, 'tres pestañas de tienda');
    ok(await page.locator('.kit-card').count() === 1, 'Camps muestra 1 kit');
    ok(await page.locator('.p-card').count() === 3, 'Camps muestra 3 piezas sueltas (la camiseta de clínica no se vende)', await page.locator('.p-card').count());
    await page.shot('01-camps', true);

    await page.click('.store-tab[data-store="athletum"]');
    await page.waitForLoadState('networkidle');
    ok(await page.locator('.kit-card').count() === 4, 'Athletum muestra 4 kits');
    ok(await page.locator('.p-card').count() === 27, 'Athletum muestra 27 piezas', await page.locator('.p-card').count());
    const broken = await page.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth === 0).map(i => i.src));
    ok(broken.length === 0, 'todas las fotos cargan', broken);
    await page.shot('02-athletum', true);

    await page.click('.store-tab[data-store="lasvegas"]');
    await page.waitForLoadState('networkidle');
    ok(await page.locator('.kit-card').count() === 2 && await page.locator('.p-card').count() === 13, 'Las Vegas: 2 kits y 13 piezas');
    ok(await page.locator('.sf-nav .sf-nav-link').count() >= 3, 'Las Vegas muestra el menú Kit · Jugador · Goalkeeper');
    ok(!/Recoger/.test(await page.locator('.sfx-ticker-row').first().innerText()), 'Las Vegas no ofrece recoger en la academia: solo USPS');
    await page.shot('03-lasvegas', true);

    await page.click('.kit-card[data-kit="lv-kit-competitive"]');
    await page.waitForSelector('#addKit');
    await page.click('[data-quick="YM"]');
    await page.shot('04-kit-lasvegas');
    ok(await page.locator('#addKit').isEnabled(), 'con talla YM para todo, el kit queda listo', await page.locator('#addKit').innerText());
    await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

    await page.click('.store-tab[data-store="camps"]');
    await page.click('.p-card[data-id="camp-jersey"]');
    await page.waitForSelector('#addCart');
    await page.shot('05-pieza-suelta');
    ok(await page.locator('.modal .alert-warn').count() === 1, 'la pieza suelta avisa que requiere el kit');
    await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

    ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
    await page.context().close();
  },

  /* Flujo completo de compra y regla del kit */
  async buy(browser) {
    const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
    await page.goto(BASE);
    await page.waitForSelector('.kit-card');
    const stock = (pid, size) => page.evaluate(([p, s]) => Store.variantOf(p, s).stock, [pid, size]);

    // 1) Visitante intenta comprar solo una camiseta
    await page.click('.p-card[data-id="camp-jersey"]');
    await page.click('.size-btn[data-size="YM"]');
    await page.click('#addCart');
    await page.waitForSelector('#cartDrawer.open');
    ok(await page.locator('.gate-banner').count() === 1, 'carrito avisa que falta el kit');
    await page.shot('10-carrito-sin-kit');
    await page.click('#goCheckout');
    await page.waitForSelector('#acEmail');
    ok(true, 'al pagar sin kit pide identificarse');

    // 2) Cuenta sin kit: sigue bloqueado
    await page.fill('#acEmail', 'daniel.kim@example.com');
    await page.click('#acGo');
    await page.waitForSelector('#cartDrawer.open');
    ok(await page.locator('#payNow').count() === 0 && await page.locator('.gate-banner').count() === 1, 'cuenta sin kit: no llega al pago');

    // 3) Agrega el kit desde el aviso
    await page.click('#gateKit');
    await page.waitForSelector('#addKit');
    ok(!(await page.locator('#addKit').isEnabled()), 'kit sin tallas: botón deshabilitado', await page.locator('#addKit').innerText());
    await page.fill('#kitPlayer', 'Ethan Kim');
    await page.selectOption('#kitYear', '2014');
    await page.click('[data-quick="YXS"]');
    ok(!(await page.locator('#addKit').isEnabled()), 'talla YXS: short agotado, no deja añadir', await page.locator('.modal .err-msg.show').innerText());
    await page.shot('11-kit-talla-agotada');
    await page.click('[data-quick="YL"]');
    ok(await page.locator('#addKit').isEnabled(), 'talla YL: disponible');
    ok(await page.locator('#kitPlayer').inputValue() === 'Ethan Kim', 'el nombre del jugador se conserva al cambiar tallas');
    await page.shot('12-kit-listo');
    await page.click('#addKit');
    await page.waitForSelector('#cartDrawer.open');
    ok(await page.locator('.gate-banner').count() === 0, 'con el kit en el carrito desaparece el aviso');
    await page.shot('13-carrito-con-kit');

    // 4) Checkout con entrega en el campamento
    const before = [await stock('camp-jersey', 'YL'), await stock('camp-short', 'YL'), await stock('camp-socks', 'M'), await stock('camp-jersey', 'YM')];
    await page.click('#goCheckout');
    await page.waitForSelector('#payNow');
    ok(await page.locator('#ckEmail').inputValue() === 'daniel.kim@example.com', 'checkout precarga la cuenta');
    const payText = await page.locator('#payNow').innerText();
    ok(/80\.25/.test(payText), 'total con entrega en sitio: (50 + 25) × 1.07 = $80.25', payText);
    await page.shot('14-checkout-pickup');
    await page.check('input[name="ckFulfill"][value="shipping"]');
    const payShip = await page.locator('#payNow').innerText();
    ok(/89\.25/.test(payShip), 'con envío USPS suma $9: $89.25', payShip);
    await page.click('#payNow');
    ok(await page.locator('#errAddr.show').count() === 1, 'envío exige dirección');
    await page.check('input[name="ckFulfill"][value="pickup"]');
    await page.click('#payNow');
    await page.waitForSelector('.success-mark', { timeout: 15000 });
    await page.shot('15-confirmacion');
    const after = [await stock('camp-jersey', 'YL'), await stock('camp-short', 'YL'), await stock('camp-socks', 'M'), await stock('camp-jersey', 'YM')];
    ok(before.every((n, i) => after[i] === n - 1), 'inventario descontado pieza por pieza', { before, after });

    // 5) Segunda compra: ya tiene kit, compra solo medias
    await page.click('.modal-foot .btn:not(.btn-primary)');
    ok(/Kit comprado/.test(await page.locator('#shopAccount').innerText()), 'la cuenta ahora muestra "Kit comprado"');
    await page.click('.p-card[data-id="camp-socks"]');
    ok(await page.locator('.modal .alert-warn').count() === 0, 'la pieza suelta ya no pide kit');
    await page.click('.size-btn[data-size="M"]');
    await page.click('#addCart');
    await page.waitForSelector('#cartDrawer.open');
    await page.click('#goCheckout');
    await page.waitForSelector('#payNow');
    ok(/12\.84/.test(await page.locator('#payNow').innerText()), 'segunda compra sin kit: $12 + 7% = $12.84');
    await page.click('#payNow');
    await page.waitForSelector('.success-mark', { timeout: 15000 });

    // 6) El pedido aparece en el panel
    await page.click('#seeOrder');
    await page.waitForSelector('#page-orders.active table');
    await page.shot('16-admin-pedidos', true);
    ok(/Daniel Kim/.test(await page.locator('#page-orders tbody tr').first().innerText()), 'el pedido nuevo encabeza la lista del panel');
    await page.locator('#page-orders [data-order]').nth(1).click();
    await page.waitForSelector('.modal .trace');
    await page.shot('17-admin-detalle-pedido');
    ok(await page.locator('.modal tr.sub-row').count() === 3, 'el detalle desglosa las 3 piezas del kit');

    ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
    await page.context().close();
  },

  /* Panel de administración: todas las páginas y los formularios */
  async admin(browser) {
    const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
    await page.goto(BASE);
    await page.click('#btnAdmin');
    const pages = ['dashboard', 'inventory', 'products', 'movements', 'deliveries', 'orders', 'customers', 'stores', 'alerts', 'reports', 'settings'];
    for (const p of pages) {
      await page.click(`.side-link[data-page="${p}"]`);
      await page.waitForSelector(`#page-${p}.active`);
      const len = (await page.locator(`#page-${p}`).innerText()).length;
      ok(len > 120, `página ${p} con contenido`, len);
      await page.shot('20-admin-' + p, true);
    }

    // Buscar con espacios (antes se perdían)
    await page.click('.side-link[data-page="inventory"]');
    await page.fill('#invQ', '');
    await page.type('#invQ', 'camp jersey');
    ok(await page.locator('#invQ').inputValue() === 'camp jersey', 'la búsqueda conserva los espacios');
    ok(await page.locator('#page-inventory .inv-group').count() === 2 && await page.locator('#page-inventory .size-cell').count() === 14, 'filtra Camp Jersey e ID Camp Jersey, con sus 7 tallas cada uno', await page.locator('#page-inventory .size-cell').count());

    // Entregas: inscripción sin talla → se completa y se entrega
    await page.click('.side-link[data-page="deliveries"]');
    const noSize = await page.locator('[data-set-size]').count();
    ok(noSize === 12, '12 inscripciones de clínica sin talla', noSize);
    await page.locator('[data-set-size="r11"]').selectOption('YL');
    await page.click('[data-deliver="r11"]');
    await page.waitForSelector('#delGo');
    await page.shot('21-entrega-form');
    await page.click('#delGo');
    await page.waitForSelector('[data-undo="r11"]');
    ok(true, 'entrega de clínica registrada');
    await page.click('[data-deliver="r3"]');
    await page.waitForSelector('#delGo');
    ok(!(await page.locator('#delGo').isEnabled()), 'entrega de academia bloqueada por falta de stock de una pieza');
    await page.shot('22-entrega-bloqueada');
    await page.evaluate(() => { UI.closeModal(); Shop.closeCart(); });

    // Producto nuevo y kit nuevo
    await page.click('.side-link[data-page="products"]');
    await page.click('#prodNew');
    await page.waitForSelector('#pfSave');
    await page.fill('#pfName', 'Parent Cap');
    await page.fill('#pfSku', 'camp-cap');
    await page.selectOption('#pfKind', 'accessory');
    await page.fill('#pfPrice', '18');
    await page.fill('#pfCost', '7');
    await page.click('[data-preset="one"]');
    await page.fill('[data-sz-stock="U"]', '15');
    await page.locator('[data-sz-stock="U"]').dispatchEvent('change');
    await page.shot('23-producto-form');
    await page.click('#pfSave');
    await page.waitForSelector('#pfSave', { state: 'detached' });
    const cap = await page.evaluate(() => { const p = Store.products.find(x => x.sku === 'CAMP-CAP'); return p && { v: p.variants.map(v => v.size + ':' + v.stock), stores: p.stores, last: Store.movements[0].reason }; });
    ok(cap && cap.v.join() === 'U:15' && cap.last === 'initial', 'producto creado con stock inicial asentado', cap);

    await page.click('#prodNewKit');
    await page.waitForSelector('#pfAddComp');
    await page.fill('#pfName', 'Camp Kit Plus');
    await page.fill('#pfSku', 'CAMP-KIT-PLUS');
    for (const id of ['camp-jersey', 'camp-short', 'camp-socks']) {
      await page.click('#pfAddComp');
      await page.locator('[data-comp-p]').last().selectOption(id);
    }
    await page.fill('#pfDisc', '10');
    await page.locator('#pfDisc').dispatchEvent('input');
    ok(await page.locator('#pfPrice').inputValue() === '51.30', 'descuento 10% sobre $57 de piezas = $51.30', await page.locator('#pfPrice').inputValue());
    await page.shot('24-kit-form');
    await page.click('#pfSave');
    await page.waitForSelector('#pfSave', { state: 'detached' });
    await page.click('#btnShop');
    ok(await page.locator('.kit-card').count() === 2, 'el kit nuevo aparece en la tienda de Camps');

    // Tiendas: QR y publicación
    await page.click('#btnAdmin');
    await page.click('.side-link[data-page="stores"]');
    ok(await page.locator('.store-card svg.qr').count() === 3, 'cada tienda tiene su QR');
    await page.click('[data-toggle-store="athletum"]');
    ok(await page.evaluate(() => Store.storeCfg('athletum').active), 'Athletum publicada desde el panel');

    // Idioma
    await page.click('#langBtn');
    await page.shot('25-admin-stores-en', true);
    ok(/Stores/.test(await page.locator('#page-stores h1').innerText()), 'panel en inglés');
    await page.click('#btnShop');
    await page.shot('26-shop-en', true);
    await page.click('#langBtn');

    ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
    await page.context().close();
  },

  /* Tienda pública en teléfono (enlace del QR) */
  async mobile(browser) {
    const page = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(BASE + '?store=camps');
    await page.waitForSelector('.kit-card');
    ok(await page.locator('.mode-switch').isHidden(), 'la tienda pública no muestra el panel');
    ok(await page.locator('.store-tabs').count() === 0, 'ni el selector de tiendas');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 0, 'sin desborde horizontal en 390 px', overflow);
    await page.shot('30-movil-tienda', true);

    await page.click('.kit-card');
    await page.waitForSelector('#addKit');
    await page.click('[data-quick="YM"]');
    await page.shot('31-movil-kit');
    await page.fill('#kitPlayer', 'Test Kid');
    await page.selectOption('#kitYear', '2016');
    await page.click('#addKit');
    await page.waitForSelector('#cartDrawer.open');
    await page.shot('32-movil-carrito');
    await page.click('#goCheckout');
    await page.waitForSelector('#payNow');
    await page.fill('#ckEmail', 'movil@example.com');
    await page.fill('#ckName', 'Mobile Parent');
    await page.shot('33-movil-checkout', true);
    await page.click('#payNow');
    await page.waitForSelector('.success-mark', { timeout: 15000 });
    ok(await page.locator('.trace').count() === 0 && await page.locator('#seeOrder').count() === 0, 'la confirmación pública no muestra datos internos');
    await page.shot('34-movil-confirmacion');
    const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov2 <= 0, 'sin desborde horizontal tras la compra', ov2);

    // Tienda aún no publicada
    await page.goto(BASE + 'lasvegas');
    await page.waitForSelector('.sf-hero.is-soon');
    ok(await page.locator('.kit-card').count() === 0, 'una tienda no publicada muestra "Muy pronto"', await page.locator('.sf-hero h1').innerText());

    // Panel en teléfono
    await page.goto(BASE);
    await page.click('#btnAdmin');
    await page.waitForSelector('#page-dashboard.active');
    const ov3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(ov3 <= 0, 'el panel tampoco desborda en móvil', ov3);
    await page.shot('35-movil-admin', true);

    ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
    await page.context().close();
  },

  /* Pedidos de la reunión del 05-10: datos del jugador, correo, envíos, tiendas, Excel */
  async reunion(browser) {
    const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
    await page.goto(BASE);
    await page.waitForSelector('.kit-card');
    ok(await page.locator('.sf-hero').count() === 1 && await page.locator('.sf-nav').count() === 0, 'Summer Camp abre con la franja de marca, sin menú de una sola sección');
    ok(await page.locator('.sf-hero-cta').count() === 1 && await page.locator('.sfx-ticker-row').first().locator('li').count() === 4 && await page.locator('.sf-faq details').count() === 4,
      'portada con botón de compra, 4 beneficios en la cinta y 4 preguntas frecuentes');
    await page.click('.sf-hero-cta');
    await page.waitForTimeout(700);
    ok(await page.evaluate(() => { const r = document.getElementById('shopKits').getBoundingClientRect(); return r.top < innerHeight / 2; }), '«Comprar el kit» lleva al kit');
    ok(await page.locator('.kit-card .sz-pick').count() > 0, 'las tallas del kit se ven sin abrirlo');

    // 1) Kit: nombre y año de nacimiento son obligatorios
    await page.locator('.kit-card .sz-pick:not([disabled])').first().click();
    await page.waitForSelector('#addKit');
    ok(await page.locator('#addKit').isEnabled(), 'la talla elegida en la tarjeta llega al kit');
    await page.click('#addKit');
    ok(await page.locator('#errKitPlayer.show').count() === 1, 'sin nombre no se añade el kit');
    await page.fill('#kitPlayer', 'Leo Test');
    await page.click('#addKit');
    ok(await page.locator('#errKitYear.show').count() === 1, 'sin año de nacimiento no se añade el kit');
    await page.selectOption('#kitYear', '2015');
    ok(await page.locator('#errKitYear.show').count() === 0, 'al elegir el año desaparece el aviso');
    await page.fill('#kitTeam', 'U11 Blue');
    await page.shot('40-kit-datos-jugador');
    await page.click('#addKit');
    await page.waitForSelector('#cartDrawer.open');
    ok(/Leo Test/.test(await page.locator('#cartDrawer').innerText()) && /2015/.test(await page.locator('#cartDrawer').innerText()), 'el carrito muestra jugador y año');

    // 2) Compra con envío → correo del pedido en la bandeja simulada
    await page.click('#goCheckout');
    await page.waitForSelector('#payNow');
    await page.fill('#ckEmail', 'envio.test@example.com');
    await page.fill('#ckName', 'Parent Test');
    await page.check('input[name="ckFulfill"][value="shipping"]');
    await page.fill('#ckAddr', '100 Test St');
    await page.fill('#ckCity', 'Miami');
    await page.fill('#ckZip', '33131');
    await page.click('#payNow');
    await page.waitForSelector('.success-mark', { timeout: 15000 });
    const mail = await page.evaluate(() => { const o = Store.orders[0]; return { m: Store.emailForOrder(o.id), item: o.items[0] }; });
    ok(mail.m && mail.m.to.includes('ordenes@soccercage.com'), 'el pedido deja un correo para quien prepara las órdenes', mail.m && mail.m.to);
    ok(mail.item.player === 'Leo Test' && mail.item.birthYear === 2015 && mail.item.team === 'U11 Blue', 'el pedido guarda jugador, año y equipo', mail.item);

    await page.click('#seeOrder');
    await page.waitForSelector('#page-orders.active table');
    await page.locator('#page-orders [data-order]').first().click();
    await page.waitForSelector('#odMail');
    await page.click('#odMail');
    await page.waitForSelector('.mail');
    const mailText = await page.locator('.mail').innerText();
    ok(/Leo Test/.test(mailText) && /2015/.test(mailText) && /U11 Blue/.test(mailText) && /100 Test St/.test(mailText), 'la vista previa del correo trae jugador, año, equipo y dirección');
    await page.shot('41-correo-pedido');
    await page.click('#mailBack');
    await page.waitForSelector('#odMail');
    await page.evaluate(() => UI.closeModal());

    // 3) Envíos: etiquetas en lote y resumen del día
    await page.click('.side-link[data-page="shipments"]');
    await page.waitForSelector('#page-shipments.active');
    const pend = await page.evaluate(() => Store.pendingShipments().length);
    ok(pend >= 2, 'hay pedidos por enviar (demo + compra nueva)', pend);
    ok(await page.locator('#shipBadge').innerText() === String(pend), 'el menú lateral cuenta los envíos pendientes');
    await page.shot('42-envios', true);
    await page.click('#shipAll');
    ok(/\d/.test(await page.locator('#shipGo').innerText()) && await page.locator('#shipGo').isEnabled(), 'marcar todos habilita crear etiquetas', await page.locator('#shipGo').innerText());
    const [popup] = await Promise.all([page.context().waitForEvent('page'), page.click('#shipGo')]);
    await popup.waitForLoadState();
    const labels = await popup.locator('.lbl').count();
    ok(labels === pend, 'se abre la hoja con una etiqueta 4×6 por pedido', labels);
    ok(/9400/.test(await popup.locator('.trk').first().innerText()), 'cada etiqueta lleva número de seguimiento');
    await popup.close();
    ok(await page.evaluate(() => Store.pendingShipments().length) === 0, 'ya no quedan pedidos por enviar');
    const summary = await page.locator('#page-shipments .kpi').nth(1).innerText();
    ok(new RegExp(pend + ' envíos').test(summary), 'resumen del día: N envíos · N pagos · N personas', summary.replace(/\n/g, ' | '));
    await page.shot('43-envios-hechos', true);

    // 4) Nueva tienda desde el panel
    await page.click('.side-link[data-page="stores"]');
    await page.click('#storeNew');
    await page.waitForSelector('#sfSave');
    await page.click('#sfSave');
    ok(await page.locator('#sfErrName.show').count() === 1, 'nueva tienda sin nombre: avisa');
    await page.fill('#sfName', 'Juventus Summer Camp Chicago');
    await page.fill('#sfStripe', 'sk_live_123');
    await page.click('#sfSave');
    ok(/acct_/.test(await page.locator('#sfErr').innerText()), 'rechaza pegar una clave secreta en vez del ID de Stripe');
    await page.fill('#sfStripe', '');
    await page.locator('#sfSwatches .swatch').nth(3).click();
    await page.selectOption('#sfCopy', 'camps');
    await page.shot('44-nueva-tienda');
    await page.click('#sfSave');
    await page.waitForSelector('#sfSave', { state: 'detached' });
    const nueva = await page.evaluate(() => { const s = Store.stores[Store.stores.length - 1]; return { name: s.name, brand: s.brand, n: Store.productsInStore(s.id).length, camps: Store.productsInStore('camps').length }; });
    ok(nueva.name === 'Juventus Summer Camp Chicago' && nueva.n === nueva.camps, 'la tienda nueva copia los productos de Summer Camps', nueva);
    ok(await page.locator('.store-card').count() === 4, 'aparece su tarjeta en el panel');
    await page.shot('45-tiendas', true);

    // 5) Importar inventario desde Excel (.xlsx real) y CSV con punto y coma
    const sku = await page.evaluate(() => Store.variantOf('camp-socks', 'M').sku);
    const sku2 = await page.evaluate(() => Store.variantOf('camp-jersey', 'YM').sku);
    const before = await page.evaluate(() => [Store.variantOf('camp-socks', 'M').stock, Store.variantOf('camp-jersey', 'YM').stock]);
    await page.click('.side-link[data-page="inventory"]');
    await page.click('#invImport');
    await page.waitForSelector('#siFile');
    await page.setInputFiles('#siFile', { name: 'llegada.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: makeXlsx([['SKU', 'Producto', 'Talla', 'Stock actual', 'Cantidad'], [sku, 'Camp Socks', 'M', before[0], 10], [sku2, 'Camp Jersey', 'YM', before[1], ''], ['NO-EXISTE', 'x', 'x', 0, 3], [sku, 'dup', 'M', 0, 1]]) });
    await page.waitForSelector('.imp-summary');
    const sumTxt = await page.locator('.imp-summary').innerText();
    ok(/Cambios: 1/.test(sumTxt) && /Con error: 2/.test(sumTxt), 'vista previa del .xlsx: 1 cambio, SKU desconocido y repetido marcados', sumTxt.replace(/\n/g, ' | '));
    await page.shot('46-importar-excel');
    await page.click('#siApply');
    await page.waitForSelector('#siApply', { state: 'detached' });
    const afterIn = await page.evaluate(() => [Store.variantOf('camp-socks', 'M').stock, Store.movements[0].ref, Store.movements[0].reason]);
    ok(afterIn[0] === before[0] + 10 && /^IMP-/.test(afterIn[1]) && afterIn[2] === 'purchase', 'entrada aplicada con movimiento IMP-… en el historial', afterIn);

    await page.click('#invImport');
    await page.waitForSelector('#siFile');
    await page.check('input[name="siMode"][value="conteo"]');
    await page.setInputFiles('#siFile', { name: 'conteo.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿SKU;Producto;Cantidad\n' + sku2 + ';"Camp Jersey, YM";5\n') });
    await page.waitForSelector('.imp-summary');
    await page.click('#siApply');
    await page.waitForSelector('#siApply', { state: 'detached' });
    const afterCount = await page.evaluate(() => [Store.variantOf('camp-jersey', 'YM').stock, Store.movements[0].reason]);
    ok(afterCount[0] === 5 && afterCount[1] === 'count', 'conteo físico desde CSV con ";" deja el stock en lo contado', afterCount);
    const ledger = await page.evaluate(() => {
      const sumStock = Store.products.filter(p => !Store.isKit(p)).reduce((s, p) => s + p.variants.reduce((a, v) => a + v.stock, 0), 0);
      const sumMov = Store.movements.reduce((s, m) => s + (m.type === 'entrada' ? m.qty : -m.qty), 0);
      return { sumStock, sumMov };
    });
    ok(ledger.sumStock === ledger.sumMov, 'el libro de movimientos sigue cuadrando con el inventario', ledger);

    // 6) Configuración: destinatarios del correo
    await page.click('.side-link[data-page="settings"]');
    await page.fill('#stNotify', 'rudy@soccercage.com, malo@');
    await page.click('#stOpsSave');
    ok(await page.locator('#errNotify.show').count() === 1, 'rechaza un correo mal escrito');
    await page.fill('#stNotify', 'rudy@soccercage.com, ordenes@soccercage.com');
    await page.click('#stOpsSave');
    ok(await page.evaluate(() => Store.settings.orderNotifyEmails) === 'rudy@soccercage.com, ordenes@soccercage.com', 'guarda los destinatarios');

    ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
    await page.context().close();
  }
};

/* Compras a proveedor (reunión 14-10): pedido → llegado → vendido → saldo y aviso de reposición */
scenarios.compras = async function (browser) {
  const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
  await page.goto(BASE);
  await page.click('#btnAdmin');
  await page.click('.side-link[data-page="purchases"]');
  await page.waitForSelector('#page-purchases.active .kpi');
  ok(await page.locator('#page-purchases [data-po-receive]').count() === 3, 'la demo muestra 3 pedidos a proveedor');
  ok(await page.locator('#poBadge').innerText() === String(await page.evaluate(() => Store.reorderList().length)), 'el menú cuenta los uniformes por pedir');
  await page.shot('50-compras', true);

  // Desplegar las tallas de un uniforme en la tabla de etapas
  await page.fill('#poQ', 'camp short');
  await page.waitForTimeout(400);
  await page.locator('[data-po-toggle="camp-short"]').click();
  ok(await page.locator('.po-stages .sub-row').count() === 7, 'al tocar el uniforme se ven sus 7 tallas', await page.locator('.po-stages .sub-row').count());
  await page.shot('51-compras-etapas');

  // Nuevo pedido desde "hay que pedir más"
  const needId = await page.evaluate(() => Store.reorderList()[0].p.id);
  await page.fill('#poQ', '');
  await page.waitForTimeout(400);
  await page.click(`[data-po-order="${needId}"]`);
  await page.waitForSelector('#poSave');
  ok(await page.locator('[data-po-qty]').count() > 0 && !(await page.locator('#poSave').isDisabled()), 'el pedido llega con cantidades sugeridas');
  await page.click('#poSave');
  ok(await page.locator('#errPoSupplier.show').count() === 1, 'sin proveedor no se crea');
  await page.fill('#poSupplier', 'Proveedor Prueba');
  await page.selectOption('#poPick', 'camp-jersey');
  await page.locator('[data-po-qty^="1|"]').first().fill('12');
  await page.locator('[data-po-qty^="1|"]').first().dispatchEvent('change');
  ok(await page.locator('#poSupplier').inputValue() === 'Proveedor Prueba', 'añadir un uniforme conserva el proveedor escrito');
  await page.shot('52-compras-nuevo-pedido');
  const stockBefore = await page.evaluate(() => Store.variantOf('camp-jersey', 'YXS').stock);
  await page.click('#poSave');
  await page.waitForSelector('#poSave', { state: 'detached' });
  const created = await page.evaluate(() => Store.purchases[0]);
  ok(created.number === 'OC-0004' && created.supplier === 'Proveedor Prueba' && created.lines.some(l => l.variantId === 'camp-jersey-YXS' && l.qty === 12), 'pedido OC-0004 creado con las dos referencias', created.lines.length);
  ok(await page.evaluate(() => Store.variantOf('camp-jersey', 'YXS').stock) === stockBefore, 'crear el pedido no suma al stock');
  ok(await page.evaluate(id => !Store.reorderState(Store.product(id)).need, needId), 'el uniforme sale de "hay que pedir más" porque ya viene en camino');

  // Registrar llegada parcial
  await page.click(`[data-po-receive="${created.id}"]`);
  await page.waitForSelector('#rcSave');
  await page.locator('[data-recv="camp-jersey-YXS"]').fill('5');
  await page.click('#rcSave');
  await page.waitForSelector('#rcSave', { state: 'detached' });
  const after = await page.evaluate(() => ({ stock: Store.variantOf('camp-jersey', 'YXS').stock, coming: Store.onOrder('camp-jersey-YXS'), status: Store.purchases[0].status, mov: Store.movements[0].ref }));
  ok(after.stock === stockBefore + 5 && after.coming === 7 && after.mov === 'OC-0004', 'llegan 5 de 12: suman al stock y 7 siguen en camino', after);

  await page.click('.side-link[data-page="inventory"]');
  await page.fill('#invQ', 'CAMP-JER-YXS');
  await page.waitForTimeout(400);
  ok(/\+7 en camino/.test(await page.locator('#page-inventory .inv-list').innerText()), 'el inventario muestra lo que viene en camino');

  // Configuración del aviso
  await page.click('.side-link[data-page="settings"]');
  await page.fill('#stReorder', '15');
  await page.fill('#stStockMail', 'eduardo@soccercage.com');
  await page.click('#stOpsSave');
  ok(await page.evaluate(() => [Store.settings.reorderPointDefault, Store.settings.stockAlertEmails].join('|')) === '15|eduardo@soccercage.com', 'guarda el punto de aviso y quién recibe el correo');

  ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
  await page.context().close();
};

/* Un enlace por tienda y el panel aparte (petición de David del 2026-11-04) */
scenarios.enlaces = async function (browser) {
  const page = await newPage(browser, { viewport: { width: 1366, height: 900 } });
  await page.goto(BASE);
  await page.waitForSelector('.store-tab');
  await page.evaluate(() => Store.stores.forEach(s => Store.saveStore(s.id, { active: true })));
  const temas = { camps: 'summer', lasvegas: 'neon', athletum: 'stadium' };
  for (const id of Object.keys(temas)) {
    await page.goto(BASE + id);
    await page.waitForSelector('.sf-hero');
    const v = await page.evaluate(() => ({ sf: App.storefront, tabs: document.querySelectorAll('.store-tab').length,
      sw: getComputedStyle(document.querySelector('.mode-switch')).display, theme: document.getElementById('appShop').dataset.theme }));
    ok(v.sf === id && v.tabs === 0 && v.sw === 'none', `/${id} abre solo su tienda, sin selector ni panel`, v);
    ok(v.theme === temas[id] && await page.locator('.sfx-' + temas[id]).count() === 1, `/${id} tiene su propio diseño de portada (${temas[id]})`, v.theme);
  }
  // Dos pestañas con tiendas distintas: ninguna se cambia a la tienda de la otra.
  await page.goto(BASE + 'lasvegas');
  await page.waitForSelector('.sfx-neon');
  const otra = await page.context().newPage();
  await otra.goto(BASE + 'camps');
  await otra.waitForSelector('.sfx-summer');
  await otra.evaluate(() => Store.addToCart && Store.save());
  await page.waitForTimeout(800);
  ok(await page.evaluate(() => Store.currentStore.id) === 'lasvegas' && await page.locator('.sfx-neon').count() === 1,
    'con /camps abierta en otra pestaña, /lasvegas sigue en Las Vegas', await page.evaluate(() => Store.currentStore.id));
  await otra.close();

  await page.goto(BASE + 'panel');
  await page.waitForSelector('#appAdmin.active #page-dashboard');
  const p = await page.evaluate(() => ({ panel: App.panelOnly, shop: document.querySelector('#appShop.active') !== null,
    sw: getComputedStyle(document.querySelector('.mode-switch')).display, cart: getComputedStyle(document.getElementById('cartBtn')).display }));
  ok(p.panel && !p.shop && p.sw === 'none' && p.cart === 'none', '/panel es solo el panel: sin pestaña de tienda ni carrito', p);
  await page.click('.side-link[data-page="stores"]');
  const popup = page.waitForEvent('popup');
  await page.click('[data-open-store="camps"]');
  const tab = await popup;
  ok(/\/camps$/.test(tab.url()) && await page.evaluate(() => App.mode) === 'admin', '«Ver tienda» abre la tienda en otra pestaña y el panel se queda', tab.url());
  await tab.close();
  // El diseño se cambia desde el panel.
  await page.click('[data-edit-store="camps"]');
  await page.selectOption('#sfHero', 'neon');
  await page.click('#sfSave');
  ok(await page.evaluate(() => Store.storeCfg('camps').heroStyle) === 'neon', 'el diseño de la portada se elige en el panel');
  await page.goto(BASE + 'camps');
  await page.waitForSelector('.sfx-neon');
  ok(true, 'y la tienda lo usa');
  await page.goto(BASE + 'no-existe');
  await page.waitForSelector('.sf-missing');
  ok(await page.locator('#appAdmin.active').count() === 0, 'una ruta que no es tienda avisa, sin abrir el panel');
  ok(page.issues.length === 0, 'sin errores ni advertencias en consola', page.issues);
  await page.context().close();
};

/* Dominio propio por tienda (petición de Eduardo del 2026-11-02) */
scenarios.dominios = async function (browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { window.SOCCERCAGE_FORCE_LOCAL = true; });
  // El sitio real responde en localhost; se simula que se entra por store.athletumfc.com.
  await ctx.route('https://store.athletumfc.com/**', async r => {
    const res = await r.fetch({ url: r.request().url().replace('https://store.athletumfc.com/', BASE) });
    await r.fulfill({ response: res });
  });
  await ctx.route('**/js/config.js', async r => {
    const res = await r.fetch({ url: BASE + 'js/config.js' });
    const body = (await res.text()).replace(/window\.SOCCERCAGE_HOSTS = \{[\s\S]*?\};/, "window.SOCCERCAGE_HOSTS = { 'store.athletumfc.com': 'athletum', 'store.juventuscamps.com': 'camps' };");
    await r.fulfill({ contentType: 'application/javascript', body });
  });
  const page = await ctx.newPage();
  page.issues = [];
  page.on('pageerror', e => page.issues.push(e.message));
  await page.goto('https://store.athletumfc.com/');
  await page.waitForSelector('#appShop.active');
  ok(await page.evaluate(() => App.storefront) === 'athletum', 'entrar por store.athletumfc.com abre la tienda de Athletum');
  ok(await page.locator('.store-tabs').count() === 0 && await page.locator('.mode-switch').isHidden(), 'sin selector de tiendas ni panel: es la tienda pública');
  ok(/Athletum/.test(await page.locator('#brandName').innerText()), 'la marca de la barra es la de Athletum');

  // Desde el sitio principal, el panel enlaza y dibuja el QR con el dominio propio.
  await page.goto(BASE);
  await page.waitForSelector('.store-tab');
  await page.click('#btnAdmin');
  await page.click('.side-link[data-page="stores"]');
  const urls = await page.evaluate(() => [...document.querySelectorAll('.store-url')].map(e => e.textContent.trim()));
  ok(urls.some(u => u === 'https://store.athletumfc.com/') && urls.some(u => u === 'https://store.juventuscamps.com/') && urls.some(u => /:8790\/lasvegas$/.test(u)), 'cada tienda enlaza a su dominio propio; sin dominio, a su ruta (/lasvegas)', urls);
  ok(page.issues.length === 0, 'sin errores en consola', page.issues);
  await ctx.close();
};

/* .xlsx mínimo (zip + XML) para probar el lector sin librerías. */
function makeXlsx(rows) {
  const zlib = require('zlib');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const strings = [];
  const si = s => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const col = i => String.fromCharCode(65 + i);
  const sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v === '' ? '' : typeof v === 'number'
      ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`
      : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + strings.map(s => `<si><t>${esc(s)}</t></si>`).join('') + '</sst>'
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(raw), nameB = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, comp); centrals.push(ch, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

(async () => {
  const which = process.argv.slice(2);
  const list = which.length ? which : Object.keys(scenarios);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const name of list) {
    console.log('\n== ' + name + ' ==');
    try { await scenarios[name](browser); }
    catch (e) { fails++; console.log('  FAIL excepción: ' + e.message.split('\n')[0]); }
  }
  await browser.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})();
