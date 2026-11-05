/* ============================================================
   SOCCER CAGE — Núcleo de estado e inventario

   Un solo inventario, varias tiendas. Toda mutación de stock pasa
   por applyMovement(): ningún módulo de interfaz toca `stock`
   directamente. Esa regla es la que garantiza la trazabilidad,
   venga la salida de una venta, de un kit o de una entrega.
   ============================================================ */

const DB_KEY = 'soccercage_db_v2';
const REV_KEY = 'soccercage_rev';
const DB_SCHEMA = 6;
const ORDER_FLOW = ['pendiente', 'procesando', 'enviado', 'completado'];

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));

const Store = {
  state: null,
  _clock: null,     // fecha simulada (solo para construir el historial de demo)
  _silent: false,   // agrupa escrituras durante cargas masivas
  onSaveError: null,  // avisos a la interfaz: el almacenamiento falló
  onConflict: null,   // otra pestaña guardó antes; esta operación se descartó

  /* ---------- Persistencia ---------- */
  versionTag() {
    return DB_SCHEMA + ':' + (typeof CATALOG !== 'undefined' ? CATALOG.importedAt : '-');
  },

  load() {
    try { localStorage.removeItem('soccercage_db_v1'); } catch (e) { /* sin acceso a almacenamiento */ }
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st && st.products && st.products.length) {
          const [schema] = String(st.version || '').split(':');
          if (Number(schema) === DB_SCHEMA) {
            this.state = st;
            this.state.rev = Number(localStorage.getItem(REV_KEY) || st.rev || 0);
            this.migrate();
            // Un catálogo reimportado actualiza precios y fotos sin borrar lo demás.
            if (st.version !== this.versionTag()) { this.mergeCatalog(); this.state.version = this.versionTag(); this.save(); }
            return;
          }
        }
      }
    } catch (e) {
      console.warn('No se pudo leer localStorage, se reinicia la demo.', e);
    }
    this.reset();
  },

  /** Ajustes puntuales sobre datos ya guardados: cada uno se aplica una sola vez. */
  migrate() {
    const done = this.state.migrations = this.state.migrations || [];
    let changed = false;
    // Reunión 05-10: las academias envían todo por USPS; la entrega en mano queda solo para el campamento.
    if (!done.includes('academias-solo-usps')) {
      this.state.stores.forEach(s => { if (s.id === 'athletum' || s.id === 'lasvegas') { s.pickup = false; s.shipping = true; } });
      done.push('academias-solo-usps');
      changed = true;
    }
    // Reunión 14-10: compras a proveedor y aviso de reposición por uniforme.
    if (!done.includes('compras-proveedor')) {
      this.state.purchases = this.state.purchases || [];
      const st = this.state.settings;
      if (st.reorderPointDefault == null) st.reorderPointDefault = 10;
      if (st.stockAlertEmails == null) st.stockAlertEmails = 'inventario@soccercage.com';
      done.push('compras-proveedor');
      changed = true;
    }
    if (!done.includes('peso-envios')) {
      if (!this.state.settings.parcel) this.state.settings.parcel = { weightOz: 2, length: 12, width: 10, height: 2 };
      done.push('peso-envios');
      changed = true;
    }
    if (!done.includes('sin-cargar')) {
      // Datos de antes de este cambio: si el inventario ya estaba en marcha (hay movimientos), todo cuenta como cargado.
      const running = this.state.movements.length > 0;
      this.state.products.forEach(p => p.variants.forEach(v => { if (running || v.stock > 0) v.loaded = true; }));
      done.push('sin-cargar');
      changed = true;
    }
    if (changed) this.save();
  },

  /**
   * Guarda el estado. Cada escritura lleva un número de revisión: si otra
   * pestaña guardó después de que esta cargó, esta escritura se descarta y
   * se recarga lo guardado, en vez de pisar el trabajo de la otra pestaña.
   */
  save() {
    if (this._silent) return true;
    if (this.cloudMode) {
      // Base compartida: lo propio de este navegador se queda aquí; lo demás va al servidor.
      this.saveLocalPart();
      if (!this.readOnly) Cloud.queueSave(() => this.sharedState());
      return true;
    }
    try {
      const disk = Number(localStorage.getItem(REV_KEY) || 0);
      const mine = Number(this.state.rev || 0);
      if (disk && mine && disk !== mine) {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) { this.state = JSON.parse(raw); this.state.rev = disk; }
        if (this.onConflict) this.onConflict();
        return false;
      }
      this.state.rev = (disk || mine) + 1;
      localStorage.setItem(DB_KEY, JSON.stringify(this.state));
      localStorage.setItem(REV_KEY, String(this.state.rev));
      return true;
    } catch (e) {
      console.warn('No se pudo guardar en localStorage.', e);
      if (this.onSaveError) this.onSaveError(e);
      return false;
    }
  },

  /* ---------- Modo nube (Supabase) ----------
     El estado completo es compartido, salvo lo que es de cada navegador. */
  cloudMode: false,
  readOnly: false,    // tienda pública sin sesión: solo catálogo y stock
  LOCAL_KEYS: ['carts', 'session', 'currentStore', 'currentUser'],
  LOCAL_DB: 'soccercage_local',

  sharedState() {
    const s = {};
    Object.keys(this.state).forEach(k => { if (!this.LOCAL_KEYS.includes(k) && k !== 'rev') s[k] = this.state[k]; });
    return s;
  },

  localPart() {
    try { return JSON.parse(localStorage.getItem(this.LOCAL_DB) || '{}') || {}; } catch (e) { return {}; }
  },

  saveLocalPart() {
    try {
      const part = {};
      this.LOCAL_KEYS.forEach(k => { part[k] = this.state[k]; });
      localStorage.setItem(this.LOCAL_DB, JSON.stringify(part));
    } catch (e) { /* sin almacenamiento: el carrito no sobrevive a la recarga */ }
  },

  withLocal(state) {
    const local = this.localPart();
    state.carts = local.carts || {};
    state.session = local.session || null;
    state.currentStore = local.currentStore || 'camps';
    state.currentUser = 'u1';
    ['orders', 'customers', 'movements', 'purchases', 'outbox', 'roster', 'programs', 'users'].forEach(k => { if (!Array.isArray(state[k])) state[k] = []; });
    if (!state.users.length) state.users = clone(SEED.users);
    state.counters = state.counters || {};
    if (!state.stores.some(s => s.id === state.currentStore)) state.currentStore = state.stores[0] ? state.stores[0].id : 'camps';
    return state;
  },

  /** Datos completos del servidor (equipo con sesión). */
  adopt(data, rev) {
    this.readOnly = false;
    this.state = this.withLocal(data);
    this.state.rev = rev;
    this.migrate();
    if (this.state.version !== this.versionTag()) { this.mergeCatalog(); this.state.version = this.versionTag(); this.save(); }
  },

  /** Catálogo público (sin sesión): lo justo para mostrar y vender la tienda. */
  adoptCatalog(cat) {
    this.readOnly = true;
    this.state = this.withLocal({
      version: cat.version, products: cat.products || [], stores: cat.stores || [],
      settings: Object.assign({ lowStockGlobal: 4, reorderPointDefault: 10, parcel: { weightOz: 2, length: 12, width: 10, height: 2 } }, cat.settings || {}),
      migrations: ['academias-solo-usps', 'compras-proveedor', 'peso-envios', 'sin-cargar']
    });
    this.state.rev = cat.rev;
  },

  /** Arranque limpio para datos reales: catálogo y tiendas, todo el stock en cero, sin historial. */
  resetClean() {
    this.reset();
    const st = this.state;
    st.products.forEach(p => p.variants.forEach(v => { v.stock = 0; v.reserved = 0; v.loaded = false; }));
    Object.assign(st, { orders: [], customers: [], movements: [], purchases: [], outbox: [], carts: {}, session: null });
    st.roster = [];
    st.clean = true;   // datos reales: sin el aviso de "datos de demostración"
    st.counters = { order: 10230, movement: 0, product: 100, customer: 0, delivery: 0, line: 0, roster: 100, purchase: 0 };
    this.save();
  },

  /** Otra pestaña guardó: se adopta su estado. Devuelve true si cambió algo. */
  syncFromStorage() {
    try {
      const disk = Number(localStorage.getItem(REV_KEY) || 0);
      if (!disk || disk === Number(this.state.rev || 0)) return false;
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return false;
      this.state = JSON.parse(raw);
      this.state.rev = disk;
      return true;
    } catch (e) {
      return false;
    }
  },

  /** Incorpora un catálogo reimportado: añade productos nuevos y actualiza
      datos de catálogo de los existentes sin tocar stock, costo ni mínimos. */
  mergeCatalog() {
    if (typeof CATALOG === 'undefined') return;
    const fresh = SEED.buildProducts();
    CATALOG.products.forEach(c => {
      const p = this.product(c.id);
      if (!p) {
        const np = fresh.find(x => x.id === c.id);
        if (!np) return;
        np.variants.forEach(v => { v.stock = 0; });
        this.state.products.push(np);
        return;
      }
      ['name', 'price', 'image', 'images', 'description', 'stores', 'categories', 'line', 'colorHex'].forEach(k => { if (c[k] !== undefined) p[k] = clone(c[k]); });
      if (c.components) p.components = clone(c.components);
      (c.sizes || []).forEach(size => {
        if (!p.variants.some(v => v.size === size)) {
          p.variants.push({ id: p.id + '-' + size, sku: p.sku + (size === 'U' ? '' : '-' + size), size, stock: 0, reserved: 0 });
        }
      });
      this.sortSizes(p.variants);
    });
  },

  reset() {
    this.state = {
      version: this.versionTag(),
      rev: 0,
      products:  SEED.buildProducts(),
      stores:    clone(SEED.stores),
      programs:  clone(SEED.programs),
      roster:    clone(SEED.roster).map(e => Object.assign({ status: 'pendiente' }, e)),
      users:     clone(SEED.users),
      orders: [], customers: [], movements: [],
      carts: {}, currentStore: 'camps', session: null,
      counters: { order: 10230, movement: 0, product: 100, customer: 0, delivery: 0, line: 0, roster: 100, purchase: 0 },
      settings: {
        company: 'Soccer Cage', city: 'Miami, FL', currency: 'USD', lowStockGlobal: 4,
        // A quién llega el correo de cada pedido (quien prepara las órdenes).
        orderNotifyEmails: 'ordenes@soccercage.com',
        // Remitente de las etiquetas de envío.
        shipFrom: { name: 'Soccer Cage', line: '', city: 'Miami', state: 'FL', zip: '' },
        // Reposición: aviso cuando a un uniforme le quedan estas unidades (todas las tallas).
        reorderPointDefault: 10,
        stockAlertEmails: 'inventario@soccercage.com',
        // Empaque de los envíos: bolsa de envío estándar (pulgadas) y su peso vacío (onzas).
        parcel: { weightOz: 2, length: 12, width: 10, height: 2 }
      },
      purchases: [],
      outbox: [],
      migrations: ['academias-solo-usps', 'compras-proveedor', 'peso-envios', 'sin-cargar'],   // la demo nueva ya nace con estos ajustes
      currentUser: 'u1'
    };
    this._silent = true;
    try { SEED.history(this); } finally { this._silent = false; this._clock = null; }
    this.save();
  },

  nowISO() { return this._clock || new Date().toISOString(); },

  /** Día local (YYYY-MM-DD) de una fecha ISO: las ventas "de hoy" son las del día local. */
  dayKey(d) {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  },

  /* ---------- Accesores ---------- */
  get products()  { return this.state.products; },
  get orders()    { return this.state.orders; },
  get customers() { return this.state.customers; },
  get movements() { return this.state.movements; },
  get settings()  { return this.state.settings; },
  get stores()    { return this.state.stores; },
  get roster()    { return this.state.roster; },
  get programs()  { return this.state.programs; },

  storeCfg(id) { return this.state.stores.find(s => s.id === id); },
  get currentStore() { return this.storeCfg(this.state.currentStore) || this.state.stores[0]; },
  setStore(id) {
    if (!this.storeCfg(id)) return;
    this.state.currentStore = id;
    this.save();
  },

  validateStore(data, existing) {
    if (!String(data.name || '').trim()) return I18N.t('err.storeName');
    if (!(Number(data.taxRate) >= 0 && Number(data.taxRate) < 0.3)) return I18N.t('err.storeTax');
    if (!(Number(data.shippingFlat) >= 0)) return I18N.t('err.priceInvalid');
    if (!data.pickup && !data.shipping) return I18N.t('adm.stores.needDeliveryBody');
    if (data.brand && !/^#[0-9a-f]{6}$/i.test(data.brand)) return I18N.t('err.storeBrand');
    if (data.stripeAccount && !/^acct_[A-Za-z0-9]{6,}$/.test(data.stripeAccount)) return I18N.t('err.stripeAccount');
    if (String(data.headline || '').length > 80 || String(data.blurb || '').length > 300) return I18N.t('err.storeTexts');
    return null;
  },

  /** Identificador de tienda a partir del nombre: "Summer Camp Chicago" → "summer-camp-chicago". */
  storeSlug(name) {
    const base = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'tienda';
    let id = base, n = 2;
    while (this.storeCfg(id)) id = base + '-' + n++;
    return id;
  },

  saveStore(id, patch) {
    const s = this.storeCfg(id);
    if (!s) return { ok: false, error: I18N.t('err.notAvailable') };
    const err = this.validateStore(Object.assign({}, s, patch), s);
    if (err) return { ok: false, error: err };
    Object.assign(s, patch);
    this.save();
    return { ok: true, store: s };
  },

  /** Crea una tienda nueva sobre el mismo inventario. Opcionalmente copia
      el surtido (qué productos vende) de otra tienda. */
  addStore(data, copyFrom) {
    const err = this.validateStore(data);
    if (err) return { ok: false, error: err };
    const name = data.name.trim();
    const s = {
      id: this.storeSlug(name), name, short: String(data.short || name).trim().slice(0, 24),
      phase: Math.max(...this.state.stores.map(x => x.phase || 0), 0) + 1,
      active: !!data.active, kitRequired: !!data.kitRequired,
      taxRate: round2(data.taxRate * 1000) / 1000, pickup: !!data.pickup, shipping: !!data.shipping,
      shippingFlat: round2(data.shippingFlat), brand: data.brand || '#111111', logo: data.logo || null, cover: data.cover || null, heroStyle: data.heroStyle || null,
      stripeAccount: data.stripeAccount || '', source: null,
      headline: String(data.headline || '').trim().slice(0, 80), blurb: String(data.blurb || '').trim().slice(0, 300)
    };
    this.state.stores.push(s);
    if (copyFrom && this.storeCfg(copyFrom)) {
      this.state.products.forEach(p => { if (p.stores.includes(copyFrom) && !p.stores.includes(s.id)) p.stores.push(s.id); });
    }
    this.save();
    return { ok: true, store: s };
  },

  user() {
    // Con base compartida, quien trabaja es la persona que inició sesión.
    if (this.cloudMode && typeof Cloud !== 'undefined' && Cloud.staff) {
      const s = Cloud.staff, name = s.name || s.email;
      return { id: 'staff:' + s.email, name, role: s.role, initials: name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() };
    }
    return this.state.users.find(u => u.id === this.state.currentUser) || this.state.users[0];
  },

  product(id) { return this.state.products.find(p => p.id === id); },

  /** Localiza una variante y su producto padre en una sola pasada. */
  findVariant(variantId) {
    for (const p of this.state.products) {
      const v = p.variants.find(x => x.id === variantId);
      if (v) return { product: p, variant: v };
    }
    return null;
  },

  variantBySku(sku) {
    for (const p of this.state.products) {
      const v = p.variants.find(x => x.sku === sku);
      if (v) return { product: p, variant: v };
    }
    return null;
  },

  variantOf(productId, size) {
    const p = this.product(productId);
    return p ? p.variants.find(v => v.size === size) || null : null;
  },

  nextId(kind) {
    this.state.counters[kind] = (this.state.counters[kind] || 0) + 1;
    return this.state.counters[kind];
  },

  /** Productos que una tienda vende (activos y listados en ella). */
  productsInStore(storeId) {
    return this.state.products.filter(p => p.active && p.stores.includes(storeId));
  },

  sortSizes(list) {
    const i = s => { const n = SEED.sizeScale.indexOf(s); return n < 0 ? 99 : n; };
    return list.sort((a, b) => i(a.size || a) - i(b.size || b));
  },

  /* ---------- Kits ---------- */
  isKit(p) { return !!p && p.kind === 'kit'; },

  kitParts(p) {
    return (p.components || [])
      .map(c => ({ product: this.product(c.productId), qty: c.qty }))
      .filter(x => x.product);
  },

  /** Lo que costarían las piezas compradas sueltas. */
  kitListPrice(p) { return round2(this.kitParts(p).reduce((s, x) => s + x.product.price * x.qty, 0)); },
  kitSavings(p)   { return Math.max(0, round2(this.kitListPrice(p) - p.price)); },
  kitCost(p)      { return round2(this.kitParts(p).reduce((s, x) => s + x.product.cost * x.qty, 0)); },

  /* ---------- Cálculos de stock ---------- */
  /** Stock realmente vendible = físico − reservado. */
  available(v) { return Math.max(0, v.stock - (v.reserved || 0)); },

  productStock(p) {
    if (this.isKit(p)) {
      // Kits completos que se pueden armar, sin mirar la talla.
      const parts = this.kitParts(p);
      if (!parts.length || parts.some(x => !x.product.active)) return 0;
      return Math.min(...parts.map(x => Math.floor(x.product.variants.reduce((s, v) => s + this.available(v), 0) / x.qty)));
    }
    return p.variants.reduce((s, v) => s + v.stock, 0);
  },

  /** Una talla cuenta como cargada desde su primera entrada de inventario. */
  loaded(v) { return !!v.loaded || v.stock > 0; },
  productLoaded(p) {
    if (this.isKit(p)) return this.kitParts(p).every(x => x.product.variants.some(v => this.loaded(v)));
    return p.variants.some(v => this.loaded(v));
  },

  variantStatus(p, v) {
    const a = this.available(v);
    if (!this.loaded(v)) return 'sincargar';
    if (a <= 0) return 'agotado';
    if (a <= (p.minStock || 0)) return 'bajo';
    return 'ok';
  },

  productStatus(p) {
    if (!p.active) return 'inactivo';
    const total = this.productStock(p);
    if (total <= 0) return this.productLoaded(p) ? 'agotado' : 'sincargar';
    if (this.isKit(p)) return 'ok';
    const anyLow = p.variants.some(v => this.available(v) > 0 && this.available(v) <= (p.minStock || 0));
    return anyLow ? 'bajo' : 'ok';
  },

  /* ---------- Métricas del dashboard ---------- */
  metrics() {
    const stocked = this.state.products.filter(p => p.active && !this.isKit(p));

    let invValue = 0, invRetail = 0, units = 0;
    const lowItems = [], outItems = [];
    let unloaded = 0;
    stocked.forEach(p => p.variants.forEach(v => {
      invValue  += v.stock * p.cost;
      invRetail += v.stock * p.price;
      units     += v.stock;
      const a = this.available(v);
      if (!this.loaded(v)) unloaded++;
      else if (a <= 0) outItems.push({ p, v });
      else if (a <= (p.minStock || 0)) lowItems.push({ p, v });
    }));

    // Ventana móvil de 30 días: no se vacía al cambiar de mes.
    const today = this.dayKey(new Date());
    const since = Date.now() - 30 * 864e5;
    const paid = this.state.orders.filter(o => o.paymentStatus === 'pagado');
    const paid30 = paid.filter(o => new Date(o.date).getTime() >= since);
    const salesToday = paid.filter(o => this.dayKey(o.date) === today).reduce((s, o) => s + o.total, 0);
    const sales30 = paid30.reduce((s, o) => s + o.total, 0);
    const tax30   = paid30.reduce((s, o) => s + (o.tax || 0), 0);

    const pending   = this.state.orders.filter(o => ['pendiente', 'procesando'].includes(o.status)).length;
    const completed = this.state.orders.filter(o => o.status === 'completado').length;

    // Ranking por unidades vendidas (solo pedidos pagados). Un kit cuenta como kit.
    const tally = {};
    paid.forEach(o => o.items.forEach(it => {
      if (!tally[it.name]) tally[it.name] = { name: it.name, qty: 0, revenue: 0 };
      tally[it.name].qty += it.qty;
      tally[it.name].revenue += it.qty * it.price;
    }));
    const topProducts = Object.values(tally).sort((a, b) => b.qty - a.qty).slice(0, 5);

    const byStore = this.state.stores.map(s => {
      const list = paid.filter(o => o.storeId === s.id);
      return { store: s, orders: list.length, revenue: list.reduce((x, o) => x + o.total, 0) };
    });

    return {
      invValue, invRetail, units,
      margin: invRetail - invValue,
      activeCount: this.state.products.filter(p => p.active).length,
      kitCount: this.state.products.filter(p => p.active && this.isKit(p)).length,
      skuCount: stocked.reduce((s, p) => s + p.variants.length, 0),
      lowItems, outItems,
      lowCount: lowItems.length, outCount: outItems.length, unloadedCount: unloaded,
      salesToday, sales30, tax30, pending, completed,
      topProducts, byStore,
      ticket: paid30.length ? sales30 / paid30.length : 0,
      alertCount: lowItems.length + outItems.length,
      deliveriesPending: this.state.roster.filter(e => e.status === 'pendiente').length
    };
  },

  /* ============================================================
     MOVIMIENTOS — única puerta de entrada a la mutación de stock
     ============================================================ */
  applyMovement({ variantId, type, qty, reason, ref, user }) {
    const found = this.findVariant(variantId);
    if (!found) return { ok: false, error: I18N.t('err.variantNotFound') };
    if (type !== 'entrada' && type !== 'salida') return { ok: false, error: I18N.t('err.typeInvalid') };
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return { ok: false, error: I18N.t('err.qtyInvalid') };

    const { product, variant } = found;
    const before = variant.stock;
    const after = before + (type === 'entrada' ? qty : -qty);

    // Regla dura: el inventario nunca queda negativo.
    if (after < 0) {
      return { ok: false, error: I18N.t('err.insufficient', { sku: variant.sku, have: before, want: qty }) };
    }

    variant.stock = after;
    if (type === 'entrada') variant.loaded = true;

    const mov = {
      id: 'm' + this.nextId('movement'),
      date: this.nowISO(),
      productId: product.id, variantId: variant.id,
      sku: variant.sku, product: product.name, variant: variant.size,
      type, qty,
      reason: reason || 'fix',
      ref: ref || '—',
      before, after,
      user: user || this.user().name
    };

    this.state.movements.unshift(mov);

    // Aviso de reposición: solo en el momento en que el uniforme cruza su punto de alerta.
    if (type === 'salida') {
      const st = this.reorderState(product);
      if (st.need && st.available + st.coming + qty > st.point) this.queueReorderEmail(product, st);
    }

    this.save();
    return { ok: true, movement: mov };
  },

  /* ============================================================
     CUENTAS DE CLIENTE
     El comprador se identifica con su correo. De ahí sale la regla
     "el kit solo es obligatorio en la primera compra".
     ============================================================ */
  customerByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    return this.state.customers.find(c => c.email.toLowerCase() === e) || null;
  },

  get session() {
    return this.state.session ? this.state.customers.find(c => c.id === this.state.session) || null : null;
  },

  signIn({ email, name, phone }) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: I18N.t('err.emailInvalid') };

    let c = this.customerByEmail(email);
    let created = false;
    if (!c) {
      if (!String(name || '').trim()) return { ok: false, needName: true, error: I18N.t('err.nameRequired') };
      c = {
        id: 'c' + this.nextId('customer'),
        name: name.trim(), email, phone: (phone || '').trim() || '—',
        city: '', orders: 0, spent: 0, kitGrants: [],
        since: this.nowISO().slice(0, 10)
      };
      this.state.customers.unshift(c);
      created = true;
    } else {
      if (name && name.trim()) c.name = name.trim();
      if (phone && phone.trim()) c.phone = phone.trim();
    }
    this.state.session = c.id;
    this.save();
    return { ok: true, customer: c, created };
  },

  signOut() { this.state.session = null; this.save(); },

  /** ¿De dónde le viene el kit a este cliente en esta tienda? null = no lo tiene. */
  kitSource(customer, storeId) {
    if (!customer) return null;
    const order = this.state.orders.find(o =>
      o.customerId === customer.id && o.storeId === storeId && o.status !== 'cancelado' &&
      o.items.some(i => i.kind === 'kit'));
    if (order) return { type: 'order', ref: order.number, date: order.date };

    const entry = this.state.roster.find(e => {
      if (e.status !== 'entregado' || (e.email || '').toLowerCase() !== customer.email.toLowerCase()) return false;
      const prog = this.program(e.program);
      return prog && prog.grantsKit && prog.storeId === storeId;
    });
    if (entry) return { type: 'delivery', ref: entry.ref, date: entry.deliveredAt };

    if ((customer.kitGrants || []).includes(storeId)) return { type: 'grant', ref: '—' };
    return null;
  },

  hasKit(customer, storeId) { return !!this.kitSource(customer, storeId); },

  setKitGrant(customerId, storeId, on) {
    const c = this.state.customers.find(x => x.id === customerId);
    if (!c) return { ok: false };
    c.kitGrants = (c.kitGrants || []).filter(s => s !== storeId);
    if (on) c.kitGrants.push(storeId);
    this.save();
    return { ok: true };
  },

  /* ============================================================
     CARRITO — uno por tienda
     ============================================================ */
  get cart() {
    const id = this.state.currentStore;
    if (!this.state.carts[id]) this.state.carts[id] = [];
    return this.state.carts[id];
  },

  /** Unidades de inventario que consume una línea: [[variantId, unidades], …] */
  lineUnits(line) {
    if (line.kind === 'kit') return line.components.map(c => [c.variantId, c.qty * line.qty]);
    return [[line.variantId, line.qty]];
  },

  /** Unidades ya comprometidas en el carrito, por variante. */
  demand(exceptLineId) {
    const d = {};
    this.cart.forEach(l => {
      if (l.lineId === exceptLineId) return;
      this.lineUnits(l).forEach(([vid, n]) => { d[vid] = (d[vid] || 0) + n; });
    });
    return d;
  },

  /** Comprueba contra el stock real, contando lo que ya hay en el carrito. */
  _fits(pairs, exceptLineId) {
    const d = this.demand(exceptLineId);
    const want = {};
    pairs.forEach(([vid, n]) => { want[vid] = (want[vid] || 0) + n; });

    for (const vid of Object.keys(want)) {
      const f = this.findVariant(vid);
      if (!f) return I18N.t('err.notAvailable');
      const avail = this.available(f.variant);
      const inCart = d[vid] || 0;
      if (inCart + want[vid] > avail) {
        const vars = { name: f.product.name, size: UI.sizeLabel(f.variant.size), n: avail, inCart };
        if (avail <= 0) return I18N.t('err.soldOut', vars);
        return I18N.t(inCart ? 'err.onlyLeftInCart' : 'err.onlyLeft', vars);
      }
    }
    return null;
  },

  addItem(productId, variantId, qty) {
    const p = this.product(productId);
    const v = p && p.variants.find(x => x.id === variantId);
    if (!p || !v || !p.active || !p.stores.includes(this.state.currentStore)) {
      return { ok: false, error: I18N.t('err.notAvailable') };
    }
    qty = Math.floor(Number(qty) || 0);
    if (qty < 1) return { ok: false, error: I18N.t('err.qtyInvalid') };

    const err = this._fits([[variantId, qty]]);
    if (err) return { ok: false, error: err };

    const existing = this.cart.find(l => l.kind === 'item' && l.variantId === variantId);
    if (existing) existing.qty += qty;
    else this.cart.push({
      lineId: 'L' + this.nextId('line'), kind: 'item',
      productId, variantId, qty,
      name: p.name, sku: v.sku, size: v.size, price: p.price
    });

    this.save();
    return { ok: true };
  },

  /** selections: [{ productId, variantId }] — una talla por cada pieza del kit. */
  /** Datos del jugador de un kit: nombre, año de nacimiento y equipo.
      Acepta un texto (solo el nombre) o un objeto. */
  normPlayer(player) {
    const p = typeof player === 'object' && player ? player : { name: player };
    const year = parseInt(p.birthYear, 10);
    const now = new Date().getFullYear();
    return {
      name: String(p.name || '').trim(),
      birthYear: year >= now - 80 && year <= now ? year : null,
      team: String(p.team || '').trim()
    };
  },

  addKit(productId, selections, qty, player) {
    const p = this.product(productId);
    if (!this.isKit(p) || !p.active || !p.stores.includes(this.state.currentStore)) {
      return { ok: false, error: I18N.t('err.notAvailable') };
    }

    const comps = [];
    for (const part of this.kitParts(p)) {
      const sel = (selections || []).find(s => s.productId === part.product.id);
      const v = sel && part.product.variants.find(x => x.id === sel.variantId);
      if (!part.product.active) return { ok: false, error: I18N.t('err.notAvailable') };
      if (!v) return { ok: false, error: I18N.t('err.kitPickSizes') };
      comps.push({ productId: part.product.id, variantId: v.id, qty: part.qty, name: part.product.name, size: v.size, sku: v.sku });
    }

    qty = Math.floor(Number(qty) || 1);
    if (qty < 1) return { ok: false, error: I18N.t('err.qtyInvalid') };
    const err = this._fits(comps.map(c => [c.variantId, c.qty * qty]));
    if (err) return { ok: false, error: err };

    // Cada kit es una línea propia: suele ser un jugador distinto.
    this.cart.push({
      lineId: 'L' + this.nextId('line'), kind: 'kit',
      productId, qty, name: p.name, sku: p.sku,
      price: p.price, listPrice: this.kitListPrice(p),
      ...(pl => ({ player: pl.name, birthYear: pl.birthYear, team: pl.team }))(this.normPlayer(player)),
      components: comps
    });

    this.save();
    return { ok: true };
  },

  updateLineQty(lineId, qty) {
    const line = this.cart.find(l => l.lineId === lineId);
    if (!line) return { ok: false };
    qty = Math.floor(Number(qty) || 0);
    if (qty <= 0) return this.removeLine(lineId);

    const err = this._fits(this.lineUnits(Object.assign({}, line, { qty })), lineId);
    if (err) return { ok: false, error: err };
    line.qty = qty;
    this.save();
    return { ok: true };
  },

  removeLine(lineId) {
    this.state.carts[this.state.currentStore] = this.cart.filter(l => l.lineId !== lineId);
    this.save();
    return { ok: true };
  },

  clearCart() { this.state.carts[this.state.currentStore] = []; this.save(); },

  cartCount() { return this.cart.reduce((s, l) => s + l.qty, 0); },

  /**
   * Regla de negocio: en una tienda con kit obligatorio, las piezas
   * sueltas solo se venden a quien ya tiene el kit o lo lleva en este
   * mismo pedido. Sin esto, muchos comprarían solo la camiseta.
   */
  kitGate(email) {
    const st = this.currentStore;
    if (!st.kitRequired) return { required: false, ok: true };
    if (!this.productsInStore(st.id).some(p => this.isKit(p))) return { required: false, ok: true };
    if (this.cart.some(l => l.kind === 'kit')) return { required: true, ok: true, via: 'cart' };

    const c = email ? this.customerByEmail(email) : this.session;
    const src = this.kitSource(c, st.id);
    if (src) return { required: true, ok: true, via: 'owned', source: src };
    return { required: true, ok: false, known: !!c };
  },

  cartTotals(fulfillment) {
    const st = this.currentStore;
    const subtotal = round2(this.cart.reduce((s, l) => s + l.price * l.qty, 0));
    const list = round2(this.cart.reduce((s, l) => s + (l.kind === 'kit' ? (l.listPrice || l.price) : l.price) * l.qty, 0));
    const shipping = (subtotal > 0 && fulfillment === 'shipping') ? round2(st.shippingFlat) : 0;
    const tax = round2(subtotal * (st.taxRate || 0));
    return {
      subtotal, shipping, tax,
      taxRate: st.taxRate || 0,
      savings: Math.max(0, round2(list - subtotal)),
      total: round2(subtotal + shipping + tax)
    };
  },

  /* ============================================================
     CHECKOUT — simula el webhook de pago confirmado.
     Mismo orden que un backend real:
     regla del kit → validar stock → crear pedido → descontar → asentar.
     ============================================================ */
  placeOrder(data) {
    const cart = this.cart;
    const st = this.currentStore;
    if (!cart.length) return { ok: false, error: I18N.t('err.cartEmpty') };
    // Tienda pública en la fase de prueba: se navega y se arma el carrito; el cobro llega con Stripe.
    if (this.readOnly) return { ok: false, code: 'trial', error: I18N.t('err.storeTrial') };

    const fulfillment = data.fulfillment === 'shipping' ? 'shipping' : 'pickup';
    // Cada tienda decide cómo entrega: las academias, solo por USPS.
    if (!st[fulfillment]) return { ok: false, error: I18N.t('err.fulfillNotAllowed') };
    if (fulfillment === 'shipping' && !(data.address && data.address.line && data.address.zip)) {
      return { ok: false, error: I18N.t('err.addressRequired') };
    }

    // 1) Regla del kit, evaluada contra el correo con el que se compra.
    const gate = this.kitGate(data.email);
    if (!gate.ok) return { ok: false, code: 'kit', error: I18N.t('err.kitRequired') };

    // 2) Revalidación de stock ANTES de cobrar: otro cliente pudo llevarse
    //    las últimas unidades mientras este llenaba el formulario.
    const need = {};
    cart.forEach(l => this.lineUnits(l).forEach(([vid, n]) => { need[vid] = (need[vid] || 0) + n; }));
    for (const vid of Object.keys(need)) {
      const f = this.findVariant(vid);
      if (!f) return { ok: false, error: I18N.t('err.notAvailable') };
      if (need[vid] > f.variant.stock) {
        return { ok: false, error: I18N.t('err.stockChanged', { name: f.product.name, size: UI.sizeLabel(f.variant.size), n: f.variant.stock }) };
      }
    }

    // 3) Cliente: se reutiliza si el correo ya existe; si no, se crea.
    const acc = this.signIn({ email: data.email, name: data.name, phone: data.phone });
    if (!acc.ok) return { ok: false, error: acc.error };
    const customer = acc.customer;
    if (fulfillment === 'shipping' && data.address) {
      customer.city = [data.address.city, data.address.state].filter(Boolean).join(', ');
    }

    // 4) Pedido
    const totals = this.cartTotals(fulfillment);
    const number = 'SC-' + this.nextId('order');
    const order = {
      id: 'o' + this.state.counters.order,
      number, storeId: st.id, customerId: customer.id,
      date: this.nowISO(),
      status: 'pendiente', paymentStatus: 'pagado',
      paymentMethod: data.paymentMethod || 'Stripe · Visa ···4242',
      fulfillment,
      address: fulfillment === 'shipping' ? (data.address || null) : null,
      items: clone(cart).map(l => { delete l.lineId; return l; }),
      subtotal: totals.subtotal, savings: totals.savings,
      shipping: totals.shipping, tax: totals.tax, taxRate: totals.taxRate, total: totals.total
    };

    // 5) Descuento de inventario + asiento en el libro. Un kit descuenta cada pieza.
    const trace = [];
    cart.forEach(l => this.lineUnits(l).forEach(([vid, n]) => {
      const r = this.applyMovement({
        variantId: vid, type: 'salida', qty: n,
        reason: l.kind === 'kit' ? 'sale_kit' : 'sale',
        ref: number, user: 'Sistema'
      });
      if (r.ok) trace.push(r.movement);
    }));

    this.state.orders.unshift(order);
    customer.orders += 1;
    customer.spent = round2(customer.spent + order.total);
    this.queueOrderEmail(order, customer);

    this.clearCart();
    this.save();
    return { ok: true, order, customer, trace };
  },

  /* ---------- Correo de pedido al equipo que prepara las órdenes ----------
     En el prototipo el correo se guarda en una bandeja de salida y se puede
     ver desde el panel; en producción lo envía el servicio de correo. */
  queueOrderEmail(order, customer) {
    if (!this.state.outbox) this.state.outbox = [];
    const to = String(this.settings.orderNotifyEmails || '').split(/[,;\s]+/).filter(Boolean);
    if (!to.length) return null;
    const mail = {
      id: 'e' + this.nextId('email'), orderId: order.id, to,
      subject: I18N.t('mail.subject', { number: order.number, store: (this.storeCfg(order.storeId) || {}).name || '' }),
      date: this.nowISO(), status: 'simulado', customerId: customer.id
    };
    this.state.outbox.unshift(mail);
    return mail;
  },

  emailForOrder(orderId) {
    return (this.state.outbox || []).find(m => m.orderId === orderId) || null;
  },

  /* ---------- Peso del paquete ---------- */
  itemWeightOz(p) {
    if (!p) return 8;
    if (this.isKit(p)) return this.kitParts(p).reduce((s, x) => s + this.itemWeightOz(x.product) * x.qty, 0);
    return Number(p.weightOz) > 0 ? Number(p.weightOz) : (SEED.kindWeightOz[p.kind] || 8);
  },

  /** Paquete de un pedido: peso total (prendas + empaque) y medidas de la bolsa. */
  orderParcel(o) {
    const pk = this.settings.parcel || { weightOz: 2, length: 12, width: 10, height: 2 };
    let oz = Number(pk.weightOz) || 0;
    o.items.forEach(it => {
      if (it.kind === 'kit' && it.components) it.components.forEach(c => { oz += this.itemWeightOz(this.product(c.productId)) * (c.qty || 1) * it.qty; });
      else oz += this.itemWeightOz(this.product(it.productId)) * it.qty;
    });
    return { weightOz: Math.round(oz * 10) / 10, length: pk.length, width: pk.width, height: pk.height };
  },

  /* ---------- Etiquetas de envío ----------
     Simulación del flujo que hará la API de envíos: crear la etiqueta,
     pagarla y dejar el número de seguimiento en el pedido. */
  /** Pedidos pagados por USPS que aún no tienen etiqueta ni han salido. */
  pendingShipments() {
    return this.state.orders.filter(o => o.fulfillment === 'shipping' && !o.label &&
      o.paymentStatus === 'pagado' && (o.status === 'pendiente' || o.status === 'procesando'));
  },

  createLabels(orderIds) {
    const done = [], skipped = [];
    orderIds.forEach(id => {
      const o = this.state.orders.find(x => x.id === id);
      if (!o || !this.pendingShipments().includes(o)) { skipped.push(id); return; }
      const n = this.nextId('label');
      o.label = {
        tracking: '9400 1' + String(1e15 + n * 7919).slice(1, 4) + ' ' + String(1e15 + n * 104729).slice(-4) + ' ' + String(1e15 + n * 15485863).slice(-4) + ' ' + String(n).padStart(4, '0'),
        service: 'USPS Ground Advantage', cost: round2(o.shipping || 0),
        createdAt: this.nowISO(), createdBy: this.user().name, simulated: true
      };
      if (o.status === 'pendiente') o.status = 'procesando';
      if (o.status === 'procesando') o.status = 'enviado';
      done.push(o);
    });
    this.save();
    return { ok: true, done, skipped };
  },

  /* ============================================================
     COMPRAS A PROVEEDOR — pedido → llegado → vendido → saldo
     Un pedido a proveedor no toca el stock: solo deja la mercancía
     "en camino". Al recibirla (toda o por partes) entra al
     inventario con un movimiento de compra que lleva el número OC-….
     ============================================================ */
  get purchases() { return this.state.purchases || (this.state.purchases = []); },

  purchase(id) { return this.purchases.find(x => x.id === id) || null; },

  purchasePending(l) { return Math.max(0, l.qty - (l.received || 0)); },

  /** Unidades pedidas y aún no recibidas de una variante (o de todo el producto). */
  onOrder(variantId) {
    let n = 0;
    this.purchases.forEach(po => {
      if (po.status === 'recibido' || po.status === 'cancelado') return;
      po.lines.forEach(l => { if (l.variantId === variantId) n += this.purchasePending(l); });
    });
    return n;
  },
  productOnOrder(p) { return p.variants.reduce((s, v) => s + this.onOrder(v.id), 0); },

  suppliers() {
    return [...new Set(this.purchases.map(po => po.supplier).filter(Boolean))].sort();
  },

  createPurchase({ supplier, expected, note, lines }) {
    supplier = String(supplier || '').trim();
    if (!supplier) return { ok: false, error: I18N.t('err.poSupplier') };
    const clean = [], seen = new Set();
    for (const l of lines || []) {
      const qty = Math.floor(Number(l.qty) || 0);
      if (!qty) continue;
      if (qty < 0 || qty > 100000) return { ok: false, error: I18N.t('err.qtyInvalid') };
      const f = this.findVariant(l.variantId);
      if (!f || this.isKit(f.product)) return { ok: false, error: I18N.t('err.variantNotFound') };
      if (seen.has(l.variantId)) return { ok: false, error: I18N.t('err.poDupLine') };
      seen.add(l.variantId);
      clean.push({ variantId: f.variant.id, productId: f.product.id, sku: f.variant.sku, name: f.product.name,
        size: f.variant.size, qty, received: 0, unitCost: round2(Number(l.unitCost != null ? l.unitCost : f.product.cost) || 0) });
    }
    if (!clean.length) return { ok: false, error: I18N.t('err.poEmpty') };
    const po = {
      id: 'po' + this.nextId('purchase'),
      number: 'OC-' + String(this.state.counters.purchase).padStart(4, '0'),
      supplier, expected: expected || '', note: String(note || '').trim(),
      date: this.nowISO(), createdBy: this.user().name,
      status: 'pedido', lines: clean, receipts: []
    };
    this.purchases.unshift(po);
    this.save();
    return { ok: true, purchase: po };
  },

  /** Recibe mercancía de un pedido. qtyByVariant: { variantId: unidades que llegaron ahora }. */
  receivePurchase(id, qtyByVariant) {
    const po = this.purchase(id);
    if (!po) return { ok: false, error: I18N.t('err.notAvailable') };
    if (po.status === 'recibido' || po.status === 'cancelado') return { ok: false, error: I18N.t('err.poClosed') };
    const todo = [];
    for (const l of po.lines) {
      const n = Math.floor(Number(qtyByVariant[l.variantId]) || 0);
      if (!n) continue;
      if (n < 0 || n > this.purchasePending(l)) return { ok: false, error: I18N.t('err.poTooMany', { sku: l.sku, n: this.purchasePending(l) }) };
      todo.push([l, n]);
    }
    if (!todo.length) return { ok: false, error: I18N.t('err.poNothing') };

    const wasSilent = this._silent;
    this._silent = true;   // una sola escritura para toda la recepción
    const receipt = { date: this.nowISO(), user: this.user().name, lines: [] };
    try {
      todo.forEach(([l, n]) => {
        const r = this.applyMovement({ variantId: l.variantId, type: 'entrada', qty: n, reason: 'purchase', ref: po.number });
        if (r.ok) { l.received = (l.received || 0) + n; receipt.lines.push({ variantId: l.variantId, qty: n }); }
      });
    } finally { this._silent = wasSilent; }
    po.receipts.push(receipt);
    po.status = po.lines.every(l => this.purchasePending(l) === 0) ? 'recibido' : 'parcial';
    this.save();
    return { ok: true, purchase: po, units: receipt.lines.reduce((s, x) => s + x.qty, 0) };
  },

  /** Cancela lo que falta por llegar. Lo ya recibido se queda en el inventario. */
  cancelPurchase(id) {
    const po = this.purchase(id);
    if (!po) return { ok: false, error: I18N.t('err.notAvailable') };
    if (po.status === 'recibido' || po.status === 'cancelado') return { ok: false, error: I18N.t('err.poClosed') };
    po.status = po.lines.some(l => l.received) ? 'recibido' : 'cancelado';
    po.closedEarly = true;
    po.closedAt = this.nowISO();
    this.save();
    return { ok: true, purchase: po };
  },

  /**
   * Estado de cada uniforme: inicial, pedido, en camino, llegado, vendido, otros y saldo.
   * Cuadra siempre: saldo = inicial + llegado − vendido + otros (otros = entregas
   * de academia/ID Camp, conteos, mermas y correcciones).
   */
  uniformStages() {
    const row = () => ({ initial: 0, ordered: 0, onOrder: 0, arrived: 0, sold: 0, other: 0, stock: 0 });
    const byVariant = {};
    const get = vid => byVariant[vid] || (byVariant[vid] = row());
    this.state.movements.forEach(m => {
      const r = get(m.variantId), s = m.type === 'entrada' ? m.qty : -m.qty;
      if (m.reason === 'initial') r.initial += s;
      else if (m.reason === 'purchase') r.arrived += s;
      else if (m.reason === 'sale' || m.reason === 'sale_kit' || m.reason === 'return') r.sold -= s;
      else r.other += s;
    });
    this.purchases.forEach(po => po.lines.forEach(l => {
      const r = get(l.variantId);
      r.ordered += po.status === 'cancelado' ? 0 : (po.closedEarly ? (l.received || 0) : l.qty);
      if (po.status === 'pedido' || po.status === 'parcial') r.onOrder += this.purchasePending(l);
    }));
    return this.state.products.filter(p => !this.isKit(p) && p.active).map(p => {
      const total = row();
      const sizes = p.variants.map(v => {
        const r = Object.assign(row(), byVariant[v.id] || {}, { stock: v.stock });
        Object.keys(total).forEach(k => { total[k] += r[k]; });
        return { v, ...r };
      });
      return { p, total, sizes };
    });
  },

  /* ---------- Reposición: "hay que pedir más de este uniforme" ----------
     Se mide por el total del uniforme (todas las tallas). Lo que ya está
     pedido cuenta: si viene en camino, no se vuelve a avisar. */
  reorderPoint(p) {
    return p.reorderPoint != null && p.reorderPoint !== '' ? Number(p.reorderPoint) : Number(this.settings.reorderPointDefault || 0);
  },

  reorderState(p) {
    const available = p.variants.reduce((s, v) => s + this.available(v), 0);
    const coming = this.productOnOrder(p);
    const point = this.reorderPoint(p);
    const need = point > 0 && available + coming <= point && this.productLoaded(p);
    return { available, coming, point, need, covered: point > 0 && available <= point && !need && this.productLoaded(p) };
  },

  reorderList() {
    return this.state.products.filter(p => p.active && !this.isKit(p))
      .map(p => ({ p, ...this.reorderState(p) })).filter(x => x.need)
      .sort((a, b) => a.available - b.available);
  },

  /** Cantidades sugeridas por talla para volver a un nivel cómodo (3 veces el punto de alerta). */
  reorderSuggestion(p) {
    const point = Math.max(this.reorderPoint(p), 1);
    const perSize = Math.max((p.minStock || 0) * 3, Math.ceil(point * 3 / Math.max(p.variants.length, 1)));
    return p.variants.map(v => ({ variantId: v.id, qty: Math.max(0, perSize - this.available(v) - this.onOrder(v.id)) }));
  },

  /** Correo de aviso cuando un uniforme cruza su punto de reposición. */
  queueReorderEmail(p, st) {
    const to = String(this.settings.stockAlertEmails || '').split(/[,;\s]+/).filter(Boolean);
    if (!to.length) return;
    const outbox = this.state.outbox || (this.state.outbox = []);
    outbox.unshift({
      id: 'e' + this.nextId('email'), kind: 'reorder', productId: p.id,
      to, subject: I18N.t('mail.reorderSubject', { name: p.name, n: st.available }),
      date: this.nowISO(), status: 'simulado'
    });
  },

  lastReorderEmail(productId) {
    return (this.state.outbox || []).find(m => m.kind === 'reorder' && m.productId === productId) || null;
  },

  /* ---------- Gestión de pedidos ---------- */
  /** Transiciones permitidas: solo el siguiente paso del flujo, o cancelar. Cancelado es final. */
  canTransition(from, to) {
    if (from === 'cancelado') return false;
    if (to === 'cancelado') return true;
    return ORDER_FLOW.indexOf(to) === ORDER_FLOW.indexOf(from) + 1;
  },

  setOrderStatus(orderId, status) {
    const o = this.state.orders.find(x => x.id === orderId);
    if (!o) return { ok: false, error: I18N.t('err.notAvailable') };
    if (!this.canTransition(o.status, status)) return { ok: false, error: I18N.t('err.statusInvalid') };
    const prev = o.status;
    o.status = status;

    // Cancelar un pedido pagado devuelve la mercancía al inventario, pieza por pieza.
    const restock = status === 'cancelado' && prev !== 'cancelado' && o.paymentStatus === 'pagado';
    if (restock) {
      o.paymentStatus = 'reembolsado';
      o.items.forEach(it => this.lineUnits(it).forEach(([vid, n]) => {
        this.applyMovement({ variantId: vid, type: 'entrada', qty: n, reason: 'return', ref: o.number });
      }));
      const c = this.state.customers.find(x => x.id === o.customerId);
      if (c) { c.spent = Math.max(0, round2(c.spent - o.total)); c.orders = Math.max(0, c.orders - 1); }
    }

    this.save();
    return { ok: true, order: o, restocked: restock };
  },

  /* ============================================================
     PRODUCTOS
     data.sizes = [{ size, stock }] para piezas; data.components para kits.
     ============================================================ */
  /** Las mismas reglas que el formulario, para que ninguna vía las esquive. */
  validateProduct(data, existing) {
    const sizes = data.sizes || [];
    const isKit = data.kind === 'kit';
    if (!String(data.name || '').trim()) return I18N.t('err.productName');
    if (!String(data.sku || '').trim()) return I18N.t('err.productSku');
    if (this.state.products.some(p => p.sku === data.sku && (!existing || p.id !== existing.id))) return I18N.t('err.skuDup', { sku: data.sku });
    if (!SEED.kinds.includes(data.kind)) return I18N.t('err.kindInvalid');
    if (!(Number(data.price) >= 0) || !(Number(data.cost || 0) >= 0) || !(Number(data.minStock || 0) >= 0)) return I18N.t('err.priceInvalid');
    if ((data.stores || []).some(s => !this.storeCfg(s))) return I18N.t('err.storeInvalid');
    if (isKit) {
      const comps = data.components || [];
      if (!comps.length) return I18N.t('err.kitNoComponents');
      if (new Set(comps.map(c => c.productId)).size !== comps.length) return I18N.t('err.kitDupComponent');
      for (const c of comps) {
        const x = this.product(c.productId);
        if (!x || this.isKit(x)) return I18N.t('err.kitComponentInvalid');
        if (!(Math.floor(Number(c.qty)) >= 1)) return I18N.t('err.qtyInvalid');
      }
    } else {
      if (!sizes.length) return I18N.t('err.sizesRequired');
      if (sizes.some(s => !SEED.sizeScale.includes(s.size)) || new Set(sizes.map(s => s.size)).size !== sizes.length) return I18N.t('err.sizesInvalid');
    }
    return null;
  },

  saveProduct(data) {
    const existing = data.id ? this.product(data.id) : null;
    if (data.id && !existing) return { ok: false, error: I18N.t('err.notAvailable') };
    const err = this.validateProduct(data, existing);
    if (err) return { ok: false, error: err };

    const sizes = (data.sizes || []).map(s => ({ size: s.size, stock: Math.max(0, Math.floor(Number(s.stock) || 0)) }));
    const fields = Object.assign({}, data);
    delete fields.sizes;
    delete fields.id;
    fields.name = fields.name.trim();
    fields.sku = fields.sku.trim();
    fields.price = round2(fields.price);
    fields.cost = round2(fields.cost || 0);
    fields.minStock = Math.floor(Number(fields.minStock) || 0);
    fields.weightOz = Number(fields.weightOz) > 0 ? Math.round(Number(fields.weightOz) * 10) / 10 : null;
    fields.reorderPoint = fields.reorderPoint == null || fields.reorderPoint === '' ? null : Math.max(0, Math.floor(Number(fields.reorderPoint) || 0));
    if (fields.components) fields.components = fields.components.map(c => ({ productId: c.productId, qty: Math.floor(Number(c.qty)) }));

    const skuFor = (base, size) => base + (size === 'U' ? '' : '-' + size);
    const isKit = fields.kind === 'kit';

    if (existing) {
      const p = existing;
      Object.assign(p, fields);

      if (isKit) {
        p.variants = [];
      } else {
        delete p.components;
        const bySize = {};
        p.variants.forEach(v => { bySize[v.size] = v; });
        const next = sizes.map(({ size }) => {
          const v = bySize[size] || { id: p.id + '-' + size, size, stock: 0, reserved: 0 };
          v.sku = skuFor(p.sku, size);
          return v;
        });
        // Una talla con existencias no se puede quitar: el inventario no desaparece.
        p.variants.forEach(v => { if (!next.includes(v) && v.stock > 0) next.push(v); });
        p.variants = this.sortSizes(next);

        // Los cambios manuales de stock quedan asentados como conteo.
        sizes.forEach(({ size, stock }) => {
          const v = p.variants.find(x => x.size === size);
          const diff = stock - v.stock;
          if (diff) this.applyMovement({
            variantId: v.id, type: diff > 0 ? 'entrada' : 'salida',
            qty: Math.abs(diff), reason: 'count', ref: 'EDIT-' + p.sku
          });
        });
      }
      this.save();
      return { ok: true, product: p, created: false };
    }

    const p = Object.assign({ id: 'p' + this.nextId('product'), images: [], variants: [] }, fields);
    if (!isKit) {
      p.variants = this.sortSizes(sizes.map(({ size }) => ({
        id: p.id + '-' + size, sku: skuFor(p.sku, size), size, stock: 0, reserved: 0
      })));
    }
    this.state.products.push(p);

    // El stock inicial también deja rastro.
    sizes.forEach(({ size, stock }) => {
      if (!isKit && stock > 0) this.applyMovement({
        variantId: p.id + '-' + size, type: 'entrada', qty: stock, reason: 'initial', ref: 'ALTA-' + p.sku
      });
    });

    this.save();
    return { ok: true, product: p, created: true };
  },

  toggleProduct(id) {
    const p = this.product(id);
    if (!p) return { ok: false };
    // Desactivar, no borrar: el histórico de ventas debe seguir siendo legible.
    p.active = !p.active;
    this.save();
    return { ok: true, active: p.active };
  },

  /** Kits activos que dejarían de poder venderse si se desactiva esta pieza. */
  kitsUsing(productId) {
    return this.state.products.filter(p => this.isKit(p) && (p.components || []).some(c => c.productId === productId));
  },

  /* ============================================================
     ENTREGAS — salidas de inventario que no son venta
     (uniforme de academia según PlayMetrics, camiseta de la clínica)
     ============================================================ */
  program(id) { return this.state.programs.find(p => p.id === id); },
  rosterEntry(id) { return this.state.roster.find(e => e.id === id); },

  normSize(raw) {
    const k = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const alias = {
      'youth xs': 'YXS', 'youth x-small': 'YXS', 'yxs': 'YXS',
      'youth small': 'YS', 'youth s': 'YS', 'ys': 'YS',
      'youth medium': 'YM', 'youth m': 'YM', 'ym': 'YM',
      'youth large': 'YL', 'youth l': 'YL', 'yl': 'YL',
      'adult small': 'S', 'adult s': 'S', 'small': 'S', 's': 'S',
      'adult medium': 'M', 'adult m': 'M', 'medium': 'M', 'm': 'M',
      'adult large': 'L', 'adult l': 'L', 'large': 'L', 'l': 'L',
      'adult xl': 'XL', 'xl': 'XL', 'x-large': 'XL'
    };
    return alias[k] || '';
  },

  /** Talla que le corresponde a una pieza según la ficha del jugador. */
  sizeFor(product, entry) {
    const sizes = product.variants.map(v => v.size);
    if (sizes.length === 1 && sizes[0] === 'U') return 'U';
    if (product.kind === 'socks') {
      const s = entry.sockSize || SEED.sockFor[entry.size] || '';
      return sizes.includes(s) ? s : '';
    }
    return sizes.includes(entry.size) ? entry.size : '';
  },

  /** Qué piezas y tallas saldrían del inventario para un jugador, y si alcanzan. */
  deliveryPlan(entryId, overrides) {
    const entry = this.rosterEntry(entryId);
    const prog = entry && this.program(entry.program);
    if (!entry || !prog) return null;
    const pkg = this.product(prog.packages[entry.role] || prog.packages.player);
    if (!pkg) return null;

    const parts = this.isKit(pkg) ? this.kitParts(pkg) : [{ product: pkg, qty: 1 }];
    const lines = parts.map(({ product, qty }) => {
      const size = (overrides && overrides[product.id]) || this.sizeFor(product, entry);
      const variant = size ? product.variants.find(v => v.size === size) || null : null;
      const available = variant ? this.available(variant) : 0;
      return { product, qty, size, variant, available, ok: !!variant && available >= qty };
    });
    return { entry, program: prog, package: pkg, lines, ok: lines.every(l => l.ok) };
  },

  deliver(entryId, overrides) {
    const plan = this.deliveryPlan(entryId, overrides);
    if (!plan) return { ok: false, error: I18N.t('err.notAvailable') };
    if (plan.entry.status === 'entregado') return { ok: false, error: I18N.t('err.alreadyDelivered') };

    const bad = plan.lines.find(l => !l.ok);
    if (bad) {
      return {
        ok: false,
        error: bad.variant
          ? I18N.t('err.deliveryNoStock', { name: bad.product.name, size: UI.sizeLabel(bad.size), n: bad.available })
          : I18N.t('err.deliveryNoSize', { name: bad.product.name })
      };
    }

    const ref = 'ENT-' + String(this.nextId('delivery')).padStart(4, '0');
    const items = [];
    plan.lines.forEach(l => {
      const r = this.applyMovement({
        variantId: l.variant.id, type: 'salida', qty: l.qty,
        reason: 'delivery_' + plan.program.id, ref
      });
      if (r.ok) items.push({ variantId: l.variant.id, sku: l.variant.sku, name: l.product.name, size: l.size, qty: l.qty });
    });

    Object.assign(plan.entry, {
      status: 'entregado', ref, items,
      deliveredAt: this.nowISO(), deliveredBy: this.user().name
    });
    this.save();
    return { ok: true, entry: plan.entry, ref };
  },

  /** Deshace una entrega registrada por error: las piezas vuelven al inventario. */
  undoDelivery(entryId) {
    const e = this.rosterEntry(entryId);
    if (!e || e.status !== 'entregado') return { ok: false };
    (e.items || []).forEach(it => this.applyMovement({
      variantId: it.variantId, type: 'entrada', qty: it.qty, reason: 'delivery_undo', ref: e.ref
    }));
    Object.assign(e, { status: 'pendiente', items: [], deliveredAt: null, deliveredBy: null });
    this.save();
    return { ok: true };
  },

  updateRoster(id, patch) {
    const e = this.rosterEntry(id);
    if (!e) return { ok: false };
    Object.assign(e, patch);
    this.save();
    return { ok: true, entry: e };
  },

  /** Separa una línea CSV respetando comillas ("Doe, John") y el separador , ; o tabulador. */
  parseCsvLine(line, forcedSep) {
    const sep = forcedSep || (line.includes('\t') ? '\t' : (line.includes(';') && !line.includes(',') ? ';' : ','));
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  },

  /**
   * Importa una lista exportada de PlayMetrics (CSV).
   * Columnas: jugador, correo del acudiente, equipo, posición, talla, talla de medias.
   */
  importRoster(text, programId) {
    const prog = this.program(programId);
    if (!prog) return { ok: false, added: 0, skipped: 0 };

    const rows = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    rows.forEach((line, i) => {
      const c = this.parseCsvLine(line);
      if (i === 0 && /player|jugador|name|nombre/i.test(c[0])) return;   // encabezado
      if (!c[0]) { skipped++; return; }
      const dupe = this.state.roster.some(e =>
        e.program === programId && e.player.toLowerCase() === c[0].toLowerCase() &&
        (e.email || '').toLowerCase() === (c[1] || '').toLowerCase());
      if (dupe) { skipped++; return; }

      this.state.roster.push({
        id: 'r' + this.nextId('roster'), program: programId,
        player: c[0], email: c[1] || '', team: c[2] || '',
        role: /^(g|port|arq)/i.test(c[3] || '') ? 'goalkeeper' : 'player',
        size: this.normSize(c[4]), sockSize: this.normSize(c[5]),
        status: 'pendiente'
      });
      added++;
    });
    this.save();
    return { ok: true, added, skipped };
  },

  /** Conteo físico de un uniforme: cada talla queda en lo contado; la diferencia se registra como movimiento. */
  countProduct(productId, qtyBySize) {
    const p = this.product(productId);
    if (!p || this.isKit(p)) return { ok: false, error: I18N.t('err.notAvailable') };
    const d = new Date(this.nowISO());
    const ref = 'CONTEO-' + this.dayKey(d).replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    let changed = 0;
    const failed = [];
    const wasSilent = this._silent;
    this._silent = true;   // un solo guardado para todo el conteo
    try {
      p.variants.forEach(v => {
        if (!(v.id in qtyBySize)) return;
        const n = Math.floor(Number(qtyBySize[v.id]));
        if (!Number.isFinite(n) || n < 0) { failed.push(v.sku); return; }
        const diff = n - v.stock;
        if (!diff) { v.loaded = true; return; }   // contado y confirmado, aunque no cambie
        const r = this.applyMovement({ variantId: v.id, type: diff > 0 ? 'entrada' : 'salida', qty: Math.abs(diff), reason: 'count', ref });
        if (r.ok) { changed++; v.loaded = true; } else failed.push(v.sku);
      });
    } finally { this._silent = wasSilent; }
    this.save();
    return { ok: true, changed, failed, ref };
  },

  /* ---------- Importación de inventario (Excel / CSV) ----------
     rows: filas de la hoja, con encabezado. Se buscan las columnas SKU y
     Cantidad. Modo 'entrada' suma lo recibido; 'conteo' deja el stock en
     el número contado. Primero se arma el plan (vista previa) y solo al
     confirmar se aplican los movimientos: todo queda en el historial. */
  planStockImport(rows, mode) {
    const plan = { lines: [], errors: [], unchanged: 0, empty: 0 };
    if (!rows || !rows.length) return plan;

    const head = rows[0].map(h => String(h || '').trim().toLowerCase());
    let skuCol = head.findIndex(h => /^(sku|c[oó]digo|code)\b/.test(h));
    let qtyCol = head.findIndex(h => /^(cantidad|qty|quantity|conteo|count|unidades|units)\b/.test(h));
    const hasHead = skuCol >= 0 || qtyCol >= 0;
    if (skuCol < 0) skuCol = 0;
    if (qtyCol < 0) qtyCol = rows[0].length - 1;

    const bySku = new Map();
    this.state.products.filter(p => !this.isKit(p)).forEach(p =>
      p.variants.forEach(v => bySku.set(String(v.sku).toUpperCase(), { p, v })));

    const seen = new Set();
    rows.slice(hasHead ? 1 : 0).forEach((r, i) => {
      const row = i + (hasHead ? 2 : 1);
      const sku = String(r[skuCol] || '').trim().toUpperCase();
      const raw = String(r[qtyCol] == null ? '' : r[qtyCol]).trim();
      if (!sku && !raw) return;
      if (raw === '') { plan.empty++; return; }   // fila de la plantilla sin tocar
      const err = msg => plan.errors.push({ row, sku: sku || '—', msg });
      if (!sku) return err(I18N.t('imp.errNoSku'));
      const hit = bySku.get(sku);
      if (!hit) return err(I18N.t('imp.errUnknown'));
      const n = Number(raw.replace(',', '.'));
      if (!Number.isInteger(n) || n < 0) return err(I18N.t('imp.errQty', { v: raw }));
      if (seen.has(sku)) return err(I18N.t('imp.errDupe'));
      seen.add(sku);

      const before = hit.v.stock;
      const after = mode === 'conteo' ? n : before + n;
      if (after === before) { plan.unchanged++; return; }
      plan.lines.push({ row, sku: hit.v.sku, variantId: hit.v.id, product: hit.p.name, size: hit.v.size, before, after, diff: after - before });
    });
    return plan;
  },

  /** Aplica la importación. Se vuelve a calcular el plan por si el stock cambió desde la vista previa. */
  applyStockImport(rows, mode) {
    const plan = this.planStockImport(rows, mode);
    const d = new Date(this.nowISO());
    const ref = 'IMP-' + this.dayKey(d).replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
    let applied = 0;
    const failed = [];
    plan.lines.forEach(l => {
      const r = this.applyMovement({
        variantId: l.variantId, type: l.diff > 0 ? 'entrada' : 'salida', qty: Math.abs(l.diff),
        reason: mode === 'conteo' ? 'count' : 'purchase', ref
      });
      if (r.ok) applied++; else failed.push({ row: l.row, sku: l.sku, msg: r.error });
    });
    return { ok: true, applied, failed, ref, plan };
  }
};
