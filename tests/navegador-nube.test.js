// Prueba del modo nube (base compartida) en navegador real, con un Supabase simulado.
// Las reglas del servidor ya se prueban en supabase-schema.test.js contra Postgres;
// aquí se prueba el cliente: inicio de sesión, primera carga, guardado, conflictos,
// sondeo, equipo y la tienda pública de solo lectura.
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

// El Supabase simulado vive en fake-supabase.js (mismas reglas que supabase/schema.sql).
const { fakeSupabase, newPage, login, API } = require('./fake-supabase');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const fake = fakeSupabase();

  console.log('\n== Sin sesión: tienda pública y panel cerrado ==');
  let page = await newPage(browser, fake);
  await page.goto(BASE);
  await page.waitForSelector('.home-store');
  ok(await page.locator('.home-store').count() === 3 && await page.locator('#appAdmin.active, #lgGo, .mode-switch:visible, #cartBtn:visible').count() === 0,
    'la raíz muestra las tres tiendas para elegir, sin panel ni carrito');
  ok(await page.getAttribute('.home-store >> nth=0', 'href') === '/camps', 'cada tienda enlaza a su ruta');
  await page.shot('65-nube-inicio');
  await page.goto(BASE + 'panel');
  await page.waitForSelector('#lgGo');
  ok(fake.db.calls.includes('rpc:public_catalog') && !fake.db.calls.includes('rpc:load_state'), 'sin sesión solo se pide el catálogo público');
  ok(await page.locator('#appAdmin.active').count() === 0 && await page.locator('#appShop.active').count() === 0 && await page.locator('#panelGate').count() === 1,
    'el panel pide iniciar sesión y no muestra la tienda detrás');
  await page.fill('#lgPass', 'secreto');
  await page.click('.pw-eye');
  ok(await page.getAttribute('#lgPass', 'type') === 'text' && await page.inputValue('#lgPass') === 'secreto', 'el ojo muestra la contraseña escrita');
  await page.shot('64-nube-ojo');
  await page.click('.pw-eye');
  ok(await page.getAttribute('#lgPass', 'type') === 'password', 'y la vuelve a ocultar');
  await page.fill('#lgPass', '');
  await page.shot('60-nube-login');

  console.log('\n== Inicio de sesión ==');
  await page.fill('#lgEmail', 'admin@soccercage.com');
  await page.fill('#lgPass', 'mala');
  await page.click('#lgGo');
  await page.waitForSelector('#lgErr.show');
  ok(/incorrectos/.test(await page.locator('#lgErr').innerText()), 'contraseña mala: avisa sin entrar');
  page.issues.length = 0;   // el 400 de la contraseña mala es esperado
  await page.fill('#lgPass', 'clave-segura-123');
  await page.click('#lgGo');
  await page.waitForSelector('#frDemo');
  ok(true, 'base vacía: pregunta con qué empezar');
  await page.shot('61-nube-primera-vez');
  await page.click('#frDemo');
  await page.waitForSelector('#appAdmin.active #page-dashboard .kpi', { timeout: 10000 }).catch(e => { console.log('    errores:', page.issues); throw e; });
  await page.waitForFunction(() => !Cloud.pending);
  ok(fake.db.state.rev === 1 && fake.db.state.data.products.length > 20 && fake.db.state.updated_by === 'admin@soccercage.com', 'la demo queda guardada en el servidor (revisión 1)', { rev: fake.db.state.rev, productos: fake.db.state.data.products.length, por: fake.db.state.updated_by });
  ok(fake.db.state.data.carts === undefined && fake.db.state.data.session === undefined, 'el carrito y la sesión del navegador no se suben');
  ok(await page.locator('#userName').innerText() === 'Soccer Cage', 'la barra muestra a quien inició sesión');
  ok(await page.locator('#dashReset').count() === 0, 'el panel no ofrece reiniciar los datos de todos desde el dashboard');
  ok(/Guardado/.test(await page.locator('#syncChip').innerText()), 'indicador: guardado', await page.locator('#syncChip').innerText());

  console.log('\n== Cambios y quién los hizo ==');
  const vid = 'camp-socks-M';
  const before = await page.evaluate(v => Store.findVariant(v).variant.stock, vid);
  await page.evaluate(v => Store.applyMovement({ variantId: v, type: 'entrada', qty: 5, reason: 'purchase', ref: 'NUBE-1' }), vid);
  await page.waitForFunction(() => !Cloud.pending);
  const onServer = fake.db.state.data.products.find(p => p.id === 'camp-socks').variants.find(v => v.id === vid);
  ok(onServer.stock === before + 5 && fake.db.state.rev === 2, 'una entrada llega al servidor', { stock: onServer.stock, rev: fake.db.state.rev });
  ok(await page.evaluate(() => Store.movements[0].user) === 'Soccer Cage', 'el movimiento queda a nombre de quien inició sesión');

  // Diez cambios seguidos se agrupan: no salen diez guardados.
  const saves0 = fake.db.calls.filter(c => c === 'rpc:save_state').length;
  await page.evaluate(v => { for (let i = 0; i < 10; i++) Store.applyMovement({ variantId: v, type: 'entrada', qty: 1, reason: 'purchase', ref: 'LOTE' }); }, vid);
  await page.waitForFunction(() => !Cloud.pending);
  const saves = fake.db.calls.filter(c => c === 'rpc:save_state').length - saves0;
  ok(saves <= 2, 'diez cambios seguidos se envían en uno o dos guardados', saves);

  console.log('\n== Conflicto: otra persona guardó antes ==');
  const other = JSON.parse(JSON.stringify(fake.db.state.data));
  other.settings.company = 'Soccer Cage (editado por Eduardo)';
  fake.db.state = { rev: fake.db.state.rev + 1, data: other, updated_by: 'eduardo@soccercage.com' };
  await page.evaluate(v => Store.applyMovement({ variantId: v, type: 'entrada', qty: 1, reason: 'purchase', ref: 'CHOQUE' }), vid);
  await page.waitForSelector('.toast >> text=Otra persona guardó antes');
  await page.waitForFunction(() => !Cloud.pending);
  ok(await page.evaluate(() => Store.settings.company) === 'Soccer Cage (editado por Eduardo)', 'se adopta lo que guardó Eduardo en vez de pisarlo');
  ok(!fake.db.state.data.movements.some(m => m.ref === 'CHOQUE'), 'lo que chocó no se guardó encima');

  console.log('\n== Sondeo: ver los cambios de los demás ==');
  const other2 = JSON.parse(JSON.stringify(fake.db.state.data));
  other2.settings.city = 'Doral, FL';
  fake.db.state = { rev: fake.db.state.rev + 1, data: other2, updated_by: 'eduardo@soccercage.com' };
  ok(await page.evaluate(() => Cloud.poll()), 'el sondeo encuentra la versión nueva');
  ok(await page.evaluate(() => Store.settings.city) === 'Doral, FL', 'y la pantalla queda con los datos nuevos');

  console.log('\n== La sesión vence con cambios sin guardar ==');
  fake.db.refreshFails = true;
  await page.evaluate(() => { Cloud.session.expires_at = 0; });
  await page.evaluate(v => Store.applyMovement({ variantId: v, type: 'entrada', qty: 2, reason: 'purchase', ref: 'TRAS-VENCER' }), vid);
  await page.waitForSelector('#lgGo');
  ok(/sesión venció/.test(await page.locator('.modal').innerText()), 'pide volver a entrar y avisa que no se perdió nada');
  ok(!fake.db.state.data.movements.some(m => m.ref === 'TRAS-VENCER'), 'el cambio aún no está en el servidor');
  fake.db.refreshFails = false;
  page.issues.length = 0;   // el 400 de la renovación fallida es esperado
  await page.fill('#lgEmail', 'admin@soccercage.com');
  await page.fill('#lgPass', 'clave-segura-123');
  await page.click('#lgGo');
  await page.waitForSelector('#lgGo', { state: 'detached' });
  await page.waitForFunction(() => !Cloud.pending);
  ok(fake.db.state.data.movements.some(m => m.ref === 'TRAS-VENCER'), 'al entrar de nuevo se guarda lo pendiente, sin perderlo');

  console.log('\n== Equipo ==');
  await page.click('.side-link[data-page="settings"]');
  await page.waitForSelector('#tmAdd');
  await page.fill('#tmEmail', 'Eduardo@SoccerCage.com');
  await page.fill('#tmName', 'Eduardo');
  await page.click('#tmAdd');
  await page.waitForSelector('#teamList >> text=eduardo@soccercage.com');
  ok(fake.db.staff.some(s => s.email === 'eduardo@soccercage.com' && s.role === 'staff'), 'el admin da acceso a Eduardo');
  await page.waitForSelector('#histList [data-restore]');
  ok(await page.locator('#histList [data-restore]').count() > 0, 'se ven las copias de seguridad');
  await page.shot('62-nube-equipo');

  console.log('\n== Fotos y textos de la tienda, sin programador ==');
  await page.click('.side-link[data-page="products"]');
  await page.click('[data-edit="camp-jersey"]');
  await page.waitForSelector('#pfFile', { state: 'attached' });
  await page.setInputFiles('#pfFile', { name: 'camiseta.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') });
  await page.waitForFunction(api => Admin.draft && String(Admin.draft.image).startsWith(api + '/storage/v1/object/public/fotos/productos/'), API);
  ok(fake.db.files.length === 1 && fake.db.files[0].startsWith('productos/'), 'la foto se reduce y se sube sola al almacenamiento', fake.db.files);
  await page.click('#pfSave');
  await page.waitForSelector('#pfSave', { state: 'detached' });
  await page.waitForFunction(() => !Cloud.pending);
  const img = fake.db.state.data.products.find(p => p.id === 'camp-jersey').image;
  ok(img.startsWith(API + '/storage/') && !JSON.stringify(fake.db.state.data).includes('data:image'), 'en los datos queda solo el enlace, no la imagen', img.slice(0, 70));
  await page.click('.side-link[data-page="stores"]');
  await page.click('[data-edit-store="camps"]');
  await page.waitForSelector('#sfHeadline');
  await page.fill('#sfHeadline', 'Uniformes del Summer Camp 2027');
  await page.fill('#sfBlurb', 'Pídelo hoy y recógelo el primer día del campamento.');
  await page.click('#sfSave');
  await page.waitForSelector('#sfSave', { state: 'detached' });
  await page.waitForFunction(() => !Cloud.pending);
  const camps = fake.db.state.data.stores.find(x => x.id === 'camps');
  ok(camps.headline === 'Uniformes del Summer Camp 2027' && /primer día/.test(camps.blurb), 'el título y el texto de la tienda se editan desde el panel', camps.headline);

  console.log('\n== La sesión sobrevive a la recarga ==');
  await page.reload();
  await page.waitForSelector('#userChip');
  await page.waitForFunction(() => typeof Cloud !== 'undefined' && Cloud.signedIn && Store.state && !Store.readOnly);
  ok(await page.evaluate(() => Store.settings.city) === 'Doral, FL', 'al recargar sigue dentro y con los datos del servidor');
  ok(page.issues.length === 0, 'sin errores en consola', page.issues);
  await page.context().close();

  console.log('\n== Cuenta sin acceso ==');
  page = await newPage(browser, fake);
  await page.goto(BASE + '?panel=settings');
  await page.waitForSelector('#lgGo');
  ok(new URL(page.url()).pathname === '/panel' && new URL(page.url()).search === '?panel=settings', 'los enlaces viejos (?panel=…) llegan al panel', page.url());
  await login(page, 'intruso@gmail.com', 'intruso-789');
  await page.waitForSelector('#lgErr.show');
  ok(/no tiene acceso/.test(await page.locator('#lgErr').innerText()) && await page.evaluate(() => !Cloud.session), 'una cuenta que no está en el equipo no entra y se cierra su sesión');
  await page.context().close();

  console.log('\n== Eduardo (equipo, no admin) ==');
  page = await newPage(browser, fake);
  await page.goto(BASE + 'panel');
  await page.waitForSelector('#lgGo');
  await login(page, 'eduardo@soccercage.com', 'otra-clave-456');
  await page.waitForSelector('#appAdmin.active #page-dashboard .kpi');
  // Lo primero que hará: cambiar la contraseña temporal.
  await page.click('#userChip');
  await page.click('#amPass');
  await page.waitForSelector('#pwGo');
  await page.fill('#pwNew', 'corta');
  await page.fill('#pwNew2', 'corta');
  await page.click('#pwGo');
  ok(/10 caracteres/.test(await page.locator('#pwErr').innerText()), 'contraseña corta: avisa');
  await page.fill('#pwNew', 'mi-clave-nueva-2026');
  await page.fill('#pwNew2', 'mi-clave-nueva-2027');
  await page.click('#pwGo');
  ok(/no coinciden/.test(await page.locator('#pwErr').innerText()), 'si no coinciden: avisa');
  await page.fill('#pwNew2', 'mi-clave-nueva-2026');
  await page.click('#pwGo');
  await page.waitForSelector('#pwGo', { state: 'detached' });
  ok(fake.db.users['eduardo@soccercage.com'] === 'mi-clave-nueva-2026', 'Eduardo cambia su contraseña desde su nombre, arriba a la derecha');
  await page.click('.side-link[data-page="settings"]');
  ok(await page.locator('#tmAdd').count() === 0 && await page.locator('#stResetClean').count() === 0, 'no ve gestión de equipo ni reinicio (solo administradores)');
  ok(page.issues.length === 0, 'sin errores en consola', page.issues);
  await page.context().close();

  console.log('\n== Tienda pública con datos reales ==');
  page = await newPage(browser, fake, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(BASE + '?store=camps');
  await page.waitForSelector('.kit-card');
  ok(new URL(page.url()).pathname === '/camps', 'el enlace viejo ?store=camps lleva a /camps', page.url());
  const leaked = await page.evaluate(() => ({ cost: Store.products.some(p => p.cost !== undefined), orders: Store.orders.length, customers: Store.customers.length }));
  ok(!leaked.cost && leaked.orders === 0 && leaked.customers === 0, 'el visitante no recibe costos, pedidos ni clientes', leaked);
  ok(await page.locator('.sf-hero h1').innerText() === 'Uniformes del Summer Camp 2027', 'la tienda pública muestra el título editado');
  ok(await page.evaluate(() => [...document.images].some(i => i.src.includes('/storage/v1/object/public/fotos/'))), 'y la foto nueva desde el almacenamiento');
  const stockSeen = await page.evaluate(v => Store.findVariant(v).variant.stock, vid);
  ok(stockSeen === fake.db.state.data.products.find(p => p.id === 'camp-socks').variants.find(v => v.id === vid).stock, 've el stock real del servidor', stockSeen);
  const rev0 = fake.db.state.rev, calls0 = fake.db.calls.length;
  await page.locator('.kit-card .sz-pick:not([disabled])').first().click();
  await page.fill('#kitPlayer', 'Leo Prueba');
  await page.selectOption('#kitYear', '2015');
  await page.click('#addKit');
  await page.waitForSelector('#cartDrawer.open');
  await page.click('#goCheckout');
  await page.waitForSelector('#payNow');
  await page.fill('#ckEmail', 'visitante@example.com');
  await page.fill('#ckName', 'Visitante');
  await page.click('#payNow');
  await page.waitForSelector('text=Tienda en fase de prueba', { timeout: 15000 });
  ok(fake.db.state.rev === rev0 && !fake.db.calls.slice(calls0).includes('rpc:save_state'), 'el pago muestra "fase de prueba" y no escribe nada en el servidor', fake.db.calls.slice(calls0));
  await page.shot('63-nube-tienda-prueba');
  ok(page.issues.length === 0, 'sin errores en consola', page.issues);
  await page.context().close();

  await browser.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
