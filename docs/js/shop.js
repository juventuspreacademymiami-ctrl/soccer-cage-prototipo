/* ============================================================
   SOCCER CAGE — Tienda (experiencia del cliente)

   Tres tiendas, un inventario. Flujo:
   kit obligatorio → piezas sueltas → carrito → cuenta → entrega → pago.
   Todo el texto visible pasa por I18N.t(); nombres de producto, SKU
   y cifras son datos y no se traducen.
   ============================================================ */

const Shop = {
  filters: { cat: 'todos', q: '', sort: 'rel', hideOut: false },
  sel: { productId: null, size: null, qty: 1 },
  kit: { productId: null, sizes: {}, player: '', img: null },
  fulfill: 'pickup',
  form: {},

  init() {
    if (!App.panelOnly) this.loadFonts();   // el panel no las necesita
    document.getElementById('cartBtn').onclick = () => this.openCart();
    document.getElementById('cartClose').onclick = () => this.closeCart();
    document.getElementById('cartOverlay').onclick = () => this.closeCart();
    this.render();
    this.renderCart();
  },

  /** Tipografías de las portadas de las tiendas. */
  loadFonts() {
    if (document.getElementById('sfxFonts')) return;
    const l = document.createElement('link');
    l.id = 'sfxFonts';
    l.rel = 'stylesheet';
    // La fuente de Juventus va en el sitio (fonts/); Oswald es la de los titulares de Athletum.
    l.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&display=swap';
    document.head.appendChild(l);
  },

  get store() { return Store.currentStore; },
  products() { return Store.productsInStore(this.store.id); },
  kits() { return this.products().filter(p => Store.isKit(p)); },
  singles() { return this.products().filter(p => !Store.isKit(p)); },

  /** Unidades que este cliente aún puede añadir: stock real menos lo que ya lleva en el carrito. */
  free(v) { return Math.max(0, Store.available(v) - (Store.demand()[v.id] || 0)); },

  setStore(id) {
    Store.setStore(id);
    this.filters = { cat: 'todos', q: '', sort: 'rel', hideOut: false };
    this.render();
    this.renderCart();
    window.scrollTo({ top: 0 });
  },

  /* ============================================================
     PÁGINA DE LA TIENDA
     ============================================================ */
  render() {
    const root = document.getElementById('shopRoot');
    const st = this.store;

    // El equipo con sesión ve la tienda aunque no esté publicada.
    const staffPreview = !st.active && Store.cloudMode && typeof Cloud !== 'undefined' && Cloud.signedIn;
    this.applyTheme(st);
    root.style.cssText = UI.brandVars(st);

    const closed = App.storefront && !st.active && !staffPreview;
    document.body.classList.toggle('sf-closed', !!closed);
    if (closed) {
      root.innerHTML = this.heroHTML(st, [], [], true);
      return;
    }

    const kits = this.kits();
    const singles = this.singles();
    const cats = this.navCats();
    // El aviso de "vista previa" (catálogo importado, stock de ejemplo) solo aplica a la demo local.

    root.innerHTML = `
      ${App.storefront ? '' : `
      <div class="store-tabs" role="tablist" aria-label="${I18N.t('shop.storesAria')}">
        ${Store.stores.map(s => `
          <button class="store-tab ${s.id === st.id ? 'active' : ''}" data-store="${s.id}" role="tab" aria-selected="${s.id === st.id}">
            ${UI.storeMark(s, 26)}
            <span class="store-tab-text">
              <span class="store-tab-name">${UI.esc(s.name)}</span>
            </span>
          </button>`).join('')}
      </div>`}

      ${!st.active && !Store.cloudMode ? `
      <div class="alert alert-info">
        ${UI.infoIcon()}
        <div>
          <div class="alert-title">${I18N.t('shop.previewTitle', { n: st.phase })}</div>
          <div class="alert-body">${I18N.t(st.source ? 'shop.previewBodySource' : 'shop.previewBody', { source: UI.esc((st.source || '').replace(/^https?:\/\//, '').replace(/\/$/, '')) })}</div>
        </div>
      </div>` : ''}

      ${this.heroHTML(st, kits, singles, false)}
      ${this.tickerHTML(st, kits.length > 0)}

      ${cats.length < 2 ? '' : `<nav class="sf-nav" aria-label="${I18N.t('shop.navAria')}">
        ${kits.length ? `<button class="sf-nav-link" data-go="shopKits">${I18N.t(st.kitRequired ? 'shop.navKitRequired' : 'shop.navKits')}</button>` : ''}
        ${cats.map(c => `<button class="sf-nav-link ${this.filters.cat === c ? 'active' : ''}" data-navcat="${c}">${I18N.t('cat.' + c)}</button>`).join('')}
        <button class="sf-nav-link ${this.filters.cat === 'todos' && cats.length ? '' : 'hidden'}" data-navcat="todos">${I18N.t('shop.navAll')}</button>
      </nav>`}

      ${kits.length ? `
      <section id="shopKits" class="shop-section">
        <div class="section-head">
          <div>
            <h2>${I18N.t(st.kitRequired ? 'shop.kitRequiredTitle' : 'shop.kitsTitle')}</h2>
            <p class="muted tiny" style="margin-top:3px">${I18N.t(st.kitRequired ? 'shop.kitRequiredSub' : 'shop.kitsSub')}</p>
          </div>
        </div>
        <div id="shopAccount"></div>
        <div class="kit-grid ${kits.length === 1 ? 'single' : ''}" id="shopKitGrid"></div>
      </section>` : '<div id="shopAccount"></div>'}

      <section id="shopSingles" class="shop-section">
        <div class="section-head sf-singles-head">
          <div>
            <h2>${I18N.t('shop.singlesTitle')}</h2>
            <p class="muted tiny" style="margin-top:3px">${I18N.t(st.kitRequired && kits.length ? 'shop.singlesSubGate' : 'shop.availSub')}</p>
          </div>
          <div class="shop-toolbar">
            <div class="search-box">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input class="input" id="shopSearch" type="search" placeholder="${I18N.t('shop.searchPh')}" aria-label="${I18N.t('shop.search')}" value="${UI.esc(this.filters.q)}">
            </div>
            <select class="select" id="shopSort" aria-label="${I18N.t('shop.sort')}">
              ${[['rel', 'shop.sortFeatured'], ['price-asc', 'shop.sortPriceAsc'], ['price-desc', 'shop.sortPriceDesc'], ['name', 'shop.sortName']]
                .map(([v, k]) => `<option value="${v}"${this.filters.sort === v ? ' selected' : ''}>${I18N.t(k)}</option>`).join('')}
            </select>
            <label class="chip chip-check chip-sm">
              <input type="checkbox" id="shopHideOut" ${this.filters.hideOut ? 'checked' : ''}> ${I18N.t('shop.hideOut')}
            </label>
          </div>
        </div>
        <div class="sf-count muted tiny" id="shopResultCount"></div>
        <div class="product-grid" id="shopGrid"></div>
      </section>

      ${this.helpHTML(kits.length > 0)}

      <footer class="sf-footer">
        <div class="sf-footer-brand">${UI.storeMark(st, 28)}<span>${UI.esc(st.name)}</span></div>
        <p class="shop-foot muted tiny">${I18N.t('shop.footNote', { tax: UI.pct(st.taxRate) })}</p>
      </footer>`;

    root.querySelectorAll('[data-store]').forEach(b => b.onclick = () => this.setStore(b.dataset.store));

    const go = id => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    root.querySelectorAll('[data-navcat]').forEach(b => b.onclick = () => {
      this.filters.cat = b.dataset.navcat;
      root.querySelectorAll('[data-navcat]').forEach(x => x.classList.toggle('active', x.dataset.navcat === this.filters.cat && this.filters.cat !== 'todos'));
      root.querySelector('[data-navcat="todos"]').classList.toggle('hidden', this.filters.cat === 'todos');
      this.renderGrid();
      go('shopSingles');
    });

    document.getElementById('shopSearch').oninput = e => { this.filters.q = e.target.value.trim().toLowerCase(); this.renderGrid(); };
    document.getElementById('shopSort').onchange = e => { this.filters.sort = e.target.value; this.renderGrid(); };
    document.getElementById('shopHideOut').onchange = e => { this.filters.hideOut = e.target.checked; this.renderGrid(); };

    this.renderAccount();
    this.renderKits();
    this.renderGrid();
  },

  /* ---------- Portada: un diseño por marca ----------
     Siguen las líneas gráficas de D:\Soccer Cage LLC: Juventus Camps (negro,
     rojo y dorado), Juventus Academy (blanco y dorado, solo la fuente de
     Juventus) y Athletum (negro y amarillo, con el toro). Se elige en el panel;
     si no, cada tienda trae la suya. Título, texto y foto salen de la tienda. */
  THEMES: ['camps', 'academy', 'athletum'],
  // Nombres de los primeros diseños, por si alguna tienda quedó guardada con ellos.
  OLD_THEMES: { summer: 'camps', neon: 'academy', stadium: 'athletum' },

  theme(st) {
    const t = st && (this.OLD_THEMES[st.heroStyle] || st.heroStyle);
    if (this.THEMES.includes(t)) return t;
    return { camps: 'camps', lasvegas: 'academy', athletum: 'athletum' }[st && st.id] || 'camps';
  },

  /** Logo oficial de la portada (versión para fondo oscuro). Las demás tiendas usan el logo del panel. */
  heroBrand(st) {
    if (st.id === 'lasvegas') return `<img class="sfx-logo" src="img/marcas/lasvegas-blanco.png" alt="${UI.esc(st.name)}">`;
    if (st.id === 'athletum') return `<img class="sfx-logo sfx-logo-crest" src="img/marcas/athletum-escudo.png" alt="${UI.esc(st.name)}">`;
    // Camps: la J de juventuscampsusa.com con el nombre en la fuente de Juventus, como en las piezas de la agencia.
    if (st.id === 'camps') return `<span class="sfx-lockup"><img src="img/marcas/juventus-j-blanca.svg" alt=""><span>${UI.esc(st.name)}</span></span>`;
    return `<span class="sfx-lockup">${UI.storeMark(st, 56)}<span>${UI.esc(st.name)}</span></span>`;
  },

  /** El fondo de toda la página acompaña a la portada. */
  applyTheme(st) {
    const app = document.getElementById('appShop');
    if (app) app.dataset.theme = this.theme(st);
  },

  heroHTML(st, kits, singles, soon) {
    const theme = this.theme(st);
    const key = I18N.has('store.' + st.id + '.title') ? 'store.' + st.id : 'store.generic';
    const title = soon ? I18N.t('shop.soonTitle') : st.headline || I18N.t(key + '.title');
    const lead = soon ? I18N.t('shop.soonBody') : st.blurb || I18N.t(key + '.body');
    const kit = kits[0];
    const price = n => UI.money(n).replace(/\.00$/, '');
    const save = kit ? Store.kitSavings(kit) : 0;

    // Al lado del texto: la foto de portada si la hay; si no, los productos de la tienda.
    let stage = '';
    if (st.cover) stage = `<img class="sfx-cover" src="${UI.esc(st.cover)}" alt="">`;
    else if (theme === 'academy') {
      const picks = [...kits, ...singles.filter(p => p.featured), ...singles].filter((p, i, all) => all.indexOf(p) === i).slice(0, 3);
      stage = picks.map((p, i) => `
        <figure class="sfx-card sfx-card-${i + 1}">
          <div class="sfx-card-img">${UI.media(p)}</div>
          <figcaption><span>${UI.esc(p.name)}</span><b>${price(p.price)}</b></figcaption>
        </figure>`).join('');
    } else if (kit || singles[0]) stage = `<div class="sfx-product">${UI.media(kit || singles[0])}</div>`;
    const sticker = !soon && kit ? `
      <div class="sfx-sticker"><span>
        <small>${I18N.t('sfx.kitOfficial')}</small>
        <b>${price(kit.price)}</b>
        ${save ? `<em>${I18N.t('shop.kitSave', { amount: price(save) })}</em>` : ''}
      </span></div>` : '';

    return `
      <section class="sf-hero sfx sfx-${theme}${soon ? ' is-soon' : ''}">
        <div class="sfx-word" aria-hidden="true">${UI.esc((st.short || st.name).toUpperCase())}</div>
        <div class="sfx-copy">
          <div class="sfx-brand">${this.heroBrand(st)}</div>
          <div class="sfx-eyebrow">${I18N.t('shop.official')}</div>
          <h1${title.length > 34 ? ' class="is-long"' : ''}>${UI.esc(title)}</h1>
          <p>${UI.esc(lead)}</p>
          ${soon ? '' : `<div class="sf-hero-actions">
            ${kits.length ? `<button class="btn btn-lg sf-hero-cta" data-go="shopKits">${I18N.t(st.kitRequired ? 'shop.heroBuyKit' : 'shop.heroKits')}${UI.icon('arrowRight')}</button>` : ''}
            ${singles.length ? `<button class="btn btn-lg sf-hero-alt" data-go="shopSingles">${I18N.t('shop.heroSingles')}</button>` : ''}
          </div>`}
        </div>
        ${stage ? `<div class="sfx-stage" aria-hidden="true">${stage}${sticker}</div>` : ''}
      </section>`;
  },

  /** Cinta bajo la portada con lo que la tienda ofrece de verdad (entrega, pago, tallas). */
  tickerHTML(st, hasKits) {
    const items = [
      st.pickup ? [this.pickupLabel(), I18N.t('shop.perkPickupSub')] : null,
      st.shipping ? [I18N.t('shop.perkShip'), I18N.t('shop.perkShipSub')] : null,
      [I18N.t('shop.perkPayT'), I18N.t('shop.perkPaySub')],
      hasKits ? [I18N.t('shop.perkSizesT'), I18N.t('shop.perkSizesSub')] : null
    ].filter(Boolean);
    const li = items.map(([t, d]) => `<li><b>${UI.esc(t)}</b><span>${UI.esc(d)}</span></li>`).join('');
    // La segunda copia solo sirve para que la cinta corra sin cortes.
    return `
      <div class="sfx-ticker">
        <div class="sfx-ticker-track">
          <ul class="sfx-ticker-row">${li}</ul>
          <ul class="sfx-ticker-row" aria-hidden="true">${li}${li}</ul>
        </div>
      </div>`;
  },

  /** Cómo funciona y preguntas frecuentes: lo que un papá pregunta antes de comprar.
      Solo afirma lo que la tienda hace de verdad (entrega, pago, kit, tallas);
      la política de cambios va aparte cuando esté escrita. */
  helpHTML(hasKits) {
    const st = this.store;
    const where = I18N.t('shop.pickupWhere.' + (I18N.has('shop.pickupWhere.' + st.id) ? st.id : 'generic'));
    const gate = st.kitRequired && hasKits;
    const how = st.pickup && st.shipping ? 'both' : st.pickup ? 'pickup' : 'ship';
    const steps = [
      [I18N.t(hasKits ? 'shop.step1Kit' : 'shop.step1'), I18N.t(hasKits ? 'shop.step1KitSub' : 'shop.step1Sub')],
      [I18N.t('shop.step2'), I18N.t('shop.step2Sub')],
      [I18N.t('shop.step3'), I18N.t('shop.step3Sub.' + how, { where })]
    ];
    const faq = [
      gate ? ['shop.faqKitQ', 'shop.faqKitA', {}] : null,
      hasKits ? ['shop.faqSizesQ', 'shop.faqSizesA', {}] : null,
      ['shop.faqDeliveryQ', 'shop.faqDeliveryA.' + how, { where }],
      ['shop.faqPayQ', 'shop.faqPayA', { tax: UI.pct(st.taxRate) }]
    ].filter(Boolean);
    return `
      <section class="shop-section sf-help">
        <div class="sf-steps">
          <h2>${I18N.t('shop.howTitle')}</h2>
          <ol>
            ${steps.map(([t, d], i) => `<li><span class="sf-step-n">${i + 1}</span><div><b>${UI.esc(t)}</b><p>${UI.esc(d)}</p></div></li>`).join('')}
          </ol>
        </div>
        <div class="sf-faq">
          <h2>${I18N.t('shop.faqTitle')}</h2>
          ${faq.map(([q, a, v]) => `<details><summary>${I18N.t(q)}</summary><p>${UI.esc(I18N.t(a, v))}</p></details>`).join('')}
        </div>
      </section>`;
  },

  /** Categorías con productos sueltos en esta tienda (para el menú). */
  navCats() {
    const used = new Set();
    this.singles().forEach(p => p.categories.forEach(c => used.add(c)));
    const cats = SEED.categories.filter(c => used.has(c));
    return cats.length > 1 ? cats : [];
  },

  /* ---------- Cuenta del comprador ----------
     El acceso vive en la barra superior; junto al kit solo se muestra
     el estado que importa para comprar: si ya tiene el kit o no. */
  renderAccount() {
    const st = this.store;
    const c = Store.session;
    const needsKit = st.kitRequired && this.kits().length > 0;

    const btn = document.getElementById('acctBtn');
    if (btn) {
      btn.innerHTML = c
        ? `<span class="acct-dot">${UI.esc(c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())}</span><span class="label">${UI.esc(c.name.split(' ')[0])}</span>`
        : `${UI.icon('user')}<span class="label">${I18N.t('acct.signInShort')}</span>`;
      btn.setAttribute('aria-label', c ? I18N.t('acct.menuAria', { name: c.name }) : I18N.t('acct.signIn'));
      btn.onclick = () => (c ? this.accountMenu() : this.accountForm());
    }

    const box = document.getElementById('shopAccount');
    if (!box) return;
    if (!needsKit) { box.innerHTML = ''; return; }

    if (!c) {
      box.innerHTML = `
        <div class="kit-status">
          ${UI.icon('user')}
          <span>${I18N.t('acct.guestSubKit')}</span>
          <button class="link-btn" id="acctIn">${I18N.t('acct.signIn')}</button>
        </div>`;
      document.getElementById('acctIn').onclick = () => this.accountForm();
      return;
    }

    const src = Store.kitSource(c, st.id);
    box.innerHTML = `
      <div class="kit-status ${src ? 'ok' : 'pending'}">
        <span class="badge ${src ? 'badge-ok' : 'badge-warn'}"><span class="dot"></span>${I18N.t(src ? 'acct.kitOwned' : 'acct.kitPending')}</span>
        <span>${I18N.t('acct.hello', { name: UI.esc(c.name.split(' ')[0]) })} · ${src ? I18N.t('acct.kitOwnedSub.' + src.type, { ref: UI.esc(src.ref || '') }) : I18N.t('acct.kitPendingSub')}</span>
      </div>`;
  },

  /** Menú de la cuenta: datos, estado del kit en cada tienda y salir. */
  accountMenu() {
    const c = Store.session;
    if (!c) return this.accountForm();
    const stores = App.storefront ? [this.store] : Store.stores.filter(s => s.kitRequired);
    UI.modal(`
      <div class="modal-head">
        <div><h2>${UI.esc(c.name)}</h2><p class="muted tiny" style="margin-top:2px">${UI.esc(c.email)}</p></div>
        ${UI.closeBtn()}
      </div>
      <div class="modal-body">
        ${stores.map(s => {
          const src = Store.kitSource(c, s.id);
          return `<div class="kv"><span class="k">${UI.esc(s.name)}</span><span class="v">${src
            ? `<span class="badge badge-ok"><span class="dot"></span>${I18N.t('acct.kitOwned')}</span>`
            : `<span class="badge badge-warn"><span class="dot"></span>${I18N.t('acct.kitPending')}</span>`}</span></div>`;
        }).join('')}
        <p class="tiny muted" style="margin-top:12px">${I18N.t('acct.ordersCount', { n: c.orders })}</p>
      </div>
      <div class="modal-foot">
        <button class="btn" id="acctOut">${I18N.t('acct.signOut')}</button>
        <button class="btn btn-primary" onclick="UI.closeModal()">${I18N.t('ui.close')}</button>
      </div>`, 'narrow');
    document.getElementById('acctOut').onclick = () => {
      UI.closeModal();
      Store.signOut();
      this.form = null;
      this.renderAccount();
      this.renderCart();
      UI.toast('info', I18N.t('acct.signedOutTitle'), I18N.t('acct.signedOutBody'));
    };
  },

  accountForm(next) {
    // Atajos de cuentas de prueba y nota de prototipo: solo en la demo local, nunca con datos reales.
    const demo = !App.storefront && !Store.cloudMode;
    UI.modal(`
      <div class="modal-head">
        <h2>${I18N.t('acct.formTitle')}</h2>
        ${UI.closeBtn()}
      </div>
      <div class="modal-body">
        <p class="muted" style="font-size:13.5px;line-height:1.6;margin-bottom:16px">${I18N.t(this.store.kitRequired ? 'acct.formIntroKit' : 'acct.formIntro')}</p>
        <div class="field">
          <label for="acEmail">${I18N.t('checkout.email')} <span class="req">*</span></label>
          <input class="input" id="acEmail" type="email" data-autofocus autocomplete="email" placeholder="name@email.com">
        </div>
        <div class="field">
          <label for="acName">${I18N.t('acct.fullName')}</label>
          <input class="input" id="acName" autocomplete="name">
          <div class="hint">${I18N.t('acct.nameHint')}</div>
        </div>
        <div class="field">
          <label for="acPhone">${I18N.t('checkout.phone')}</label>
          <input class="input" id="acPhone" autocomplete="tel" placeholder="(305) 555-0100">
        </div>
        <div class="err-msg" id="acErr"></div>
        ${demo ? `
        <div class="demo-banner" style="margin:14px 0 0;flex-wrap:wrap">
          ${UI.infoIcon()}
          <span>${I18N.t('acct.demoAccounts')}</span>
          <button class="chip chip-sm" data-fill="laura.gomez@example.com">${I18N.t('acct.demoWithKit')}</button>
          <button class="chip chip-sm" data-fill="daniel.kim@example.com">${I18N.t('acct.demoNoKit')}</button>
        </div>` : ''}
        ${demo ? `<p class="tiny muted" style="margin-top:12px;line-height:1.6">${I18N.t('acct.protoNote')}</p>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('ui.cancel')}</button>
        <button class="btn btn-primary" id="acGo">${I18N.t('acct.continue')}</button>
      </div>`, 'narrow');

    const email = document.getElementById('acEmail');
    document.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { email.value = b.dataset.fill; submit(); });

    const submit = () => {
      const r = Store.signIn({
        email: email.value,
        name: document.getElementById('acName').value,
        phone: document.getElementById('acPhone').value
      });
      if (!r.ok) {
        const err = document.getElementById('acErr');
        err.textContent = r.error;
        err.classList.add('show');
        (r.needName ? document.getElementById('acName') : email).focus();
        return;
      }
      UI.closeModal();
      this.form = null;   // otra cuenta: el borrador del pago anterior ya no aplica
      this.renderAccount();
      this.renderCart();
      const src = Store.kitSource(r.customer, this.store.id);
      UI.toast('ok',
        I18N.t(r.created ? 'acct.createdTitle' : 'acct.welcomeTitle', { name: r.customer.name.split(' ')[0] }),
        this.store.kitRequired && this.kits().length ? I18N.t(src ? 'acct.toastHasKit' : 'acct.toastNoKit') : '');
      if (next === 'checkout') this.checkout();
    };

    document.getElementById('acGo').onclick = submit;
    // Enter se enlaza a los campos de ESTE formulario, no a la ventana modal:
    // la ventana se reutiliza y el manejador seguiría vivo en los siguientes.
    ['acEmail', 'acName', 'acPhone'].forEach(id => {
      document.getElementById(id).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    });
  },

  /* ---------- Kits ---------- */
  renderKits() {
    const grid = document.getElementById('shopKitGrid');
    if (!grid) return;

    const required = this.store.kitRequired;
    grid.innerHTML = this.kits().map(p => {
      const parts = Store.kitParts(p);
      const save = Store.kitSavings(p);
      const out = ['agotado', 'sincargar'].includes(Store.productStatus(p));
      // Tallas de ropa del kit, marcando las que no se pueden armar completas.
      const sizes = this.kitMainSizes(p).map(s => {
        const ok = parts.every(x => {
          if (x.product.variants.length === 1) return Store.available(x.product.variants[0]) >= x.qty;
          const want = x.product.kind === 'socks' ? SEED.sockFor[s] : s;
          const v = x.product.variants.find(k => k.size === want) || (x.product.kind === 'socks' ? x.product.variants.find(k => Store.available(k) >= x.qty) : null);
          return v && Store.available(v) >= x.qty;
        });
        return `<button class="sz-pick ${ok ? '' : 'off'}" data-kitsize="${s}" ${ok ? '' : 'disabled'} title="${UI.esc(UI.sizeTitle(s))}">${s}</button>`;
      }).join('');
      return `
        <article class="kit-card" data-kit="${p.id}" tabindex="0" role="button" aria-label="${I18N.t('shop.viewProduct', { name: UI.esc(p.name) })}">
          <div class="kit-media" style="background:${UI.mediaBg()}">
            ${UI.media(p)}
            <div class="p-flags">
              ${required ? `<span class="badge badge-brand">${I18N.t('shop.badgeRequired')}</span>` : ''}
              ${out ? `<span class="badge badge-danger">${I18N.t('shop.badgeOut')}</span>` : ''}
            </div>
          </div>
          <div class="kit-info">
            <div class="p-cat">${UI.esc(UI.catNames(p))}${UI.lineName(p) ? ' · ' + UI.esc(UI.lineName(p)) : ''}</div>
            <h3 class="kit-name">${UI.esc(p.name)}</h3>
            <div class="kit-price">
              <span class="p-price">${UI.money(p.price)}</span>
              ${save ? `<span class="was">${UI.money(Store.kitListPrice(p))}</span><span class="kit-save">${I18N.t('shop.kitSave', { amount: UI.money(save) })}</span>` : ''}
            </div>
            <p class="kit-includes"><b>${I18N.t('shop.kitIncludes')}</b> ${parts.map(x => `${x.qty > 1 ? x.qty + '× ' : ''}${UI.esc(x.product.name)}`).join(' · ')}</p>
            ${sizes ? `<div class="kit-sizes" aria-label="${I18N.t('shop.size')}">${sizes}</div>` : ''}
            <span class="btn btn-brand btn-block kit-cta">${I18N.t('shop.kitChoose')}</span>
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('[data-kit]').forEach(card => {
      const open = () => this.openKit(card.dataset.kit);
      card.onclick = open;
      card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      // Elegir una talla en la tarjeta abre el kit con esa talla ya puesta.
      card.querySelectorAll('[data-kitsize]').forEach(b => b.onclick = e => {
        e.stopPropagation();
        this.openKit(card.dataset.kit, b.dataset.kitsize);
      });
    });
  },

  /* ---------- Piezas sueltas ---------- */
  visibleProducts() {
    let list = this.singles();
    if (this.filters.cat !== 'todos') list = list.filter(p => p.categories.includes(this.filters.cat));

    if (this.filters.q) {
      const q = this.filters.q;
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q));
    }
    if (this.filters.hideOut) list = list.filter(p => !['agotado', 'sincargar'].includes(Store.productStatus(p)));

    const s = this.filters.sort;
    const kindRank = k => SEED.kinds.indexOf(k);
    if (s === 'price-asc')  list.sort((a, b) => a.price - b.price);
    if (s === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (s === 'name')       list.sort((a, b) => a.name.localeCompare(b.name, I18N.lang));
    if (s === 'stock')      list.sort((a, b) => Store.productStock(b) - Store.productStock(a));
    if (s === 'rel')        list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || kindRank(a.kind) - kindRank(b.kind));
    return list;
  },

  renderGrid() {
    const grid = document.getElementById('shopGrid');
    if (!grid) return;
    const list = this.visibleProducts();
    const count = document.getElementById('shopResultCount');
    count.textContent = list.length
      ? I18N.t(list.length === 1 ? 'shop.results' : 'shop.resultsPlural', { n: list.length }) +
        (this.filters.cat !== 'todos' ? ' · ' + I18N.t('cat.' + this.filters.cat) : '')
      : '';

    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1">${UI.empty(
        I18N.t('shop.noResults'), I18N.t('shop.noResultsBody'),
        '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>')}</div>`;
      return;
    }

    grid.innerHTML = list.map(p => {
      const status = Store.productStatus(p);
      const total = Store.productStock(p);
      // Avisar solo si el producto está realmente por agotarse: que una talla
      // suelta esté baja es normal y, si se avisa siempre, el aviso deja de leerse.
      const sellable = p.variants.filter(v => Store.available(v) > 0).length;
      const scarce = total > 0 && (total <= p.minStock * 2 || (p.variants.length > 2 && sellable <= 2));

      const flags = [];
      if (status === 'agotado') flags.push(`<span class="badge badge-danger">${I18N.t('shop.badgeOut')}</span>`);
      else if (status === 'sincargar') flags.push(`<span class="badge badge-neutral">${I18N.t('shop.badgeSoon')}</span>`);
      else if (scarce) flags.push(`<span class="badge badge-warn">${I18N.t('shop.badgeScarce')}</span>`);

      const sizes = p.variants.length === 1 && p.variants[0].size === 'U'
        ? I18N.t('size.one')
        : p.variants.filter(v => Store.available(v) > 0).map(v => `<span class="sz">${UI.esc(v.size)}</span>`).join('');

      return `
        <article class="p-card" data-id="${p.id}" tabindex="0" role="button" aria-label="${I18N.t('shop.viewProduct', { name: UI.esc(p.name) })}">
          <div class="p-media" style="background:${UI.mediaBg()}">
            ${UI.media(p)}
            <div class="p-flags">${flags.join('')}</div>
          </div>
          <div class="p-info">
            <div class="p-cat">${UI.esc(UI.catNames(p))}</div>
            <div class="p-name">${UI.esc(p.name)}</div>
            <div class="p-price">${UI.money(p.price)}</div>
            <div class="p-sizes">${sizes}</div>
          </div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.p-card').forEach(card => {
      const open = () => this.openProduct(card.dataset.id);
      card.onclick = open;
      card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    });
  },

  /** Aviso dentro de una pieza suelta cuando la tienda exige el kit y el cliente no lo tiene. */
  gateNoteHTML() {
    const g = Store.kitGate();
    if (!g.required || g.ok) return '';
    return `
      <div class="alert alert-warn" style="margin-bottom:var(--s5)">
        ${UI.infoIcon()}
        <div>
          <div class="alert-title">${I18N.t('gate.noteTitle')}</div>
          <div class="alert-body">${I18N.t(Store.session ? 'gate.noteBodyKnown' : 'gate.noteBody')}</div>
        </div>
      </div>`;
  },

  /* ---------- Detalle de una pieza suelta ---------- */
  openProduct(id) {
    const p = Store.product(id);
    if (!p) return;
    if (Store.isKit(p)) return this.openKit(id);
    const only = p.variants.length === 1 ? p.variants[0] : null;
    this.sel = { productId: id, size: only ? only.size : null, qty: 1 };
    UI.modal(this.productHTML(p), 'wide');
    this.bindProduct();
  },

  productHTML(p) {
    const selVar = p.variants.find(v => v.size === this.sel.size);
    const avail = selVar ? this.free(selVar) : 0;
    const oneSize = p.variants.length === 1 && p.variants[0].size === 'U';

    let availText = `<span class="muted tiny">${I18N.t('shop.pickSize')}</span>`;
    if (selVar) {
      if (avail <= 0) availText = `<span class="badge badge-danger">${I18N.t(oneSize ? 'shop.badgeOut' : 'shop.outSize')}</span>`;
      else if (avail <= p.minStock) availText = `<span class="badge badge-warn">${I18N.t('shop.lowSize', { n: avail })}</span>`;
      else availText = `<span class="badge badge-ok">${I18N.t('shop.okSize', { n: avail })}</span>`;
    }

    return `
      <div class="modal-head">
        <div>
          <div class="p-cat">${UI.esc(UI.catNames(p))}${UI.lineName(p) ? ' · ' + UI.esc(UI.lineName(p)) : ''}</div>
          <h2 style="margin-top:3px">${UI.esc(p.name)}</h2>
        </div>
        ${UI.closeBtn()}
      </div>

      <div class="modal-body">
        <div class="pd-grid">
          <div>
            <div class="pd-media" style="background:${UI.mediaBg()}">${UI.media(p)}</div>
            <div class="mono tiny muted" style="margin-top:10px">${I18N.t('shop.skuBase', { sku: UI.esc(selVar ? selVar.sku : p.sku) })}</div>
          </div>

          <div>
            <div class="pd-price">${UI.money(p.price)} <span class="tax-note">+ ${I18N.t('shop.plusTax', { tax: UI.pct(this.store.taxRate) })}</span></div>
            ${p.description ? `<p class="pd-desc">${UI.esc(p.description)}</p>` : ''}
            ${p.provisional ? `<p class="tiny muted" style="margin-top:8px">${I18N.t('shop.provisional')}</p>` : ''}

            <div style="height:1px;background:var(--border);margin:20px 0"></div>
            ${this.gateNoteHTML()}

            ${oneSize ? '' : `
            <div class="opt-group">
              <div class="opt-label">
                <span>${I18N.t('shop.size')}</span>
                <span class="opt-aside">${I18N.t('shop.liveStock')}</span>
              </div>
              <div class="size-row">
                ${p.variants.map(v => {
                  const a = this.free(v);
                  return `<button class="size-btn ${this.sel.size === v.size ? 'sel' : ''} ${a <= 0 ? 'out' : ''} ${a > 0 && a <= p.minStock ? 'low' : ''}"
                            data-size="${UI.esc(v.size)}" ${a <= 0 ? 'disabled' : ''}
                            title="${UI.esc(UI.sizeTitle(v.size))} · ${a <= 0 ? I18N.t('shop.soldOutTitle') : I18N.t('shop.availableCount', { n: a })}">
                            <span>${UI.esc(v.size)}</span><span class="s-qty">${a}</span>
                          </button>`;
                }).join('')}
              </div>
              <div class="hint">${I18N.t('shop.sizeLegend')}</div>
            </div>`}
            <div style="margin:-6px 0 var(--s5)">${availText}</div>

            <div class="opt-group">
              <div class="opt-label">${I18N.t('shop.quantity')}</div>
              <div class="qty-stepper">
                <button id="qMinus" aria-label="${I18N.t('cart.decrease')}">−</button>
                <input id="qInput" type="text" inputmode="numeric" value="${this.sel.qty}" aria-label="${I18N.t('shop.quantity')}">
                <button id="qPlus" aria-label="${I18N.t('cart.increase')}">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('shop.keepShopping')}</button>
        <button class="btn btn-gold" id="addCart" ${(!selVar || avail <= 0) ? 'disabled' : ''}>
          ${!selVar ? I18N.t('shop.pickSizeBtn') : (avail <= 0 ? I18N.t('shop.soldOutBtn') : I18N.t('shop.addToCart', { price: UI.money(p.price * this.sel.qty) }))}
        </button>
      </div>`;
  },

  refreshProduct() {
    const p = Store.product(this.sel.productId);
    UI.rerenderModal(this.productHTML(p));
    this.bindProduct();
  },

  bindProduct() {
    const p = Store.product(this.sel.productId);
    const box = document.getElementById('modalBox');
    const current = () => p.variants.find(x => x.size === this.sel.size);
    const maxFor = () => { const v = current(); return v ? this.free(v) : 1; };

    box.querySelectorAll('.size-btn:not(.out)').forEach(b => b.onclick = () => {
      this.sel.size = b.dataset.size;
      this.sel.qty = 1;
      this.refreshProduct();
    });

    document.getElementById('qMinus').onclick = () => {
      if (this.sel.qty > 1) { this.sel.qty--; this.refreshProduct(); }
    };
    document.getElementById('qPlus').onclick = () => {
      if (this.sel.qty < maxFor()) { this.sel.qty++; this.refreshProduct(); }
      else UI.toast('warn', I18N.t('shop.limitReached'), I18N.t('shop.limitReachedBody'));
    };
    const input = document.getElementById('qInput');
    input.onchange = () => {
      this.sel.qty = Math.max(1, Math.min(Math.max(1, maxFor()), parseInt(input.value) || 1));
      this.refreshProduct();
    };

    document.getElementById('addCart').onclick = () => {
      const v = current();
      if (!v) return;
      const r = Store.addItem(p.id, v.id, this.sel.qty);
      if (!r.ok) { UI.toast('danger', I18N.t('shop.notFoundTitle'), r.error); return; }
      UI.closeModal();
      this.afterAdd(I18N.t('shop.addedBody', { qty: this.sel.qty, name: p.name, variant: UI.sizeLabel(v.size) }));
    };
  },

  afterAdd(msg) {
    this.renderGrid();
    this.renderKits();
    this.renderCart();
    this.bumpCart();
    UI.toast('ok', I18N.t('shop.addedTitle'), msg);
    this.openCart();
  },

  /* ---------- Configurador de kit: una talla por pieza ---------- */
  /** quickSize: talla elegida desde la tarjeta; se aplica a todas las piezas. */
  openKit(id, quickSize) {
    const p = Store.product(id);
    if (!p) return;
    const sizes = {};
    Store.kitParts(p).forEach(x => {
      if (x.product.variants.length === 1) sizes[x.product.id] = x.product.variants[0].size;
    });
    this.kit = { productId: id, sizes, player: '', birthYear: '', team: '', img: null };
    if (quickSize) this.applyQuickSize(p, quickSize);
    UI.modal(this.kitHTML(p), 'wide');
    this.bindKit();
  },

  /** Una talla para todo el kit: cada pieza la toma; las medias, su equivalente. */
  applyQuickSize(p, s) {
    Store.kitParts(p).forEach(x => {
      const sizes = x.product.variants.map(v => v.size);
      if (sizes.length === 1) return;
      const want = x.product.kind === 'socks' ? SEED.sockFor[s] : s;
      if (sizes.includes(want)) this.kit.sizes[x.product.id] = want;
    });
  },

  /** Tallas de ropa que ofrece el kit (las medias tienen su propia escala). */
  kitMainSizes(p) {
    const set = new Set();
    Store.kitParts(p).forEach(x => {
      if (x.product.kind === 'socks') return;
      x.product.variants.forEach(v => { if (v.size !== 'U') set.add(v.size); });
    });
    return Store.sortSizes([...set]);
  },

  kitRows(p) {
    return Store.kitParts(p).map(x => {
      const size = this.kit.sizes[x.product.id] || '';
      const v = size ? x.product.variants.find(k => k.size === size) : null;
      const free = v ? this.free(v) : 0;
      return { product: x.product, qty: x.qty, size, variant: v, free, ok: !!v && free >= x.qty };
    });
  },

  kitHTML(p) {
    const rows = this.kitRows(p);
    const ready = rows.every(r => r.ok);
    const missing = rows.filter(r => !r.size).length;
    const short = rows.filter(r => r.size && !r.ok);
    const save = Store.kitSavings(p);
    const gallery = p.images && p.images.length > 1 ? p.images : [];
    const mains = this.kitMainSizes(p);
    const st = this.store;
    // Talla común a toda la ropa del kit (si la hay), para marcarla en el atajo.
    const apparel = rows.filter(r => r.product.kind !== 'socks' && r.product.variants.length > 1);
    const common = apparel.length && apparel.every(r => r.size && r.size === apparel[0].size) ? apparel[0].size : null;

    return `
      <div class="modal-head">
        <div>
          <div class="p-cat">${UI.esc(UI.catNames(p))}${UI.lineName(p) ? ' · ' + UI.esc(UI.lineName(p)) : ''}</div>
          <h2 style="margin-top:3px">${UI.esc(p.name)}</h2>
        </div>
        ${UI.closeBtn()}
      </div>

      <div class="modal-body">
        <div class="pd-grid">
          <div>
            <div class="pd-media" style="background:${UI.mediaBg()}">${UI.media(p, this.kit.img)}</div>
            ${gallery.length ? `<div class="pd-thumbs">
              ${gallery.map(src => `<button class="pd-thumb ${(this.kit.img || p.image) === src ? 'sel' : ''}" data-img="${UI.esc(src)}"><img src="${UI.esc(src)}" alt="" loading="lazy"></button>`).join('')}
            </div>` : ''}
            <div class="mono tiny muted" style="margin-top:10px">${I18N.t('shop.skuBase', { sku: UI.esc(p.sku) })}</div>
          </div>

          <div>
            <div class="pd-price">${UI.money(p.price)}
              ${save ? `<span class="was">${UI.money(Store.kitListPrice(p))}</span>` : ''}
              <span class="tax-note">+ ${I18N.t('shop.plusTax', { tax: UI.pct(st.taxRate) })}</span>
            </div>
            ${save ? `<div class="kit-save" style="margin-top:4px">${I18N.t('shop.kitSaveLong', { amount: UI.money(save) })}</div>` : ''}
            ${p.description ? `<p class="pd-desc">${UI.esc(p.description)}</p>` : ''}

            <div style="height:1px;background:var(--border);margin:18px 0"></div>

            <div class="kit-player">
              <div class="opt-label"><span>${I18N.t('kit.playerData')}</span><span class="opt-aside">${I18N.t('kit.playerHint')}</span></div>
              <div class="form-grid tight">
                <div class="field span-2">
                  <label for="kitPlayer">${I18N.t('kit.player')} <span class="req">*</span></label>
                  <input class="input" id="kitPlayer" value="${UI.esc(this.kit.player)}" placeholder="${I18N.t('kit.playerPh')}" autocomplete="off">
                  <div class="err-msg" id="errKitPlayer">${I18N.t('kit.playerErr')}</div>
                </div>
                <div class="field">
                  <label for="kitYear">${I18N.t('kit.birthYear')} <span class="req">*</span></label>
                  <select class="select" id="kitYear">
                    <option value="">${I18N.t('kit.pick')}</option>
                    ${this.birthYears().map(y => `<option value="${y}"${String(this.kit.birthYear) === String(y) ? ' selected' : ''}>${y}</option>`).join('')}
                  </select>
                  <div class="err-msg" id="errKitYear">${I18N.t('kit.birthYearErr')}</div>
                </div>
                <div class="field">
                  <label for="kitTeam">${I18N.t('kit.team')}</label>
                  <input class="input" id="kitTeam" value="${UI.esc(this.kit.team)}" placeholder="${I18N.t('kit.teamPh')}" autocomplete="off">
                </div>
              </div>
            </div>

            ${mains.length ? `
            <div class="opt-group">
              <div class="opt-label"><span>${I18N.t('kit.quick')}</span><span class="opt-aside">${I18N.t('kit.quickAside')}</span></div>
              <div class="size-row">
                ${mains.map(s => `<button class="size-btn compact ${common === s ? 'sel' : ''}" data-quick="${s}" title="${UI.esc(UI.sizeTitle(s))}">${s}</button>`).join('')}
              </div>
            </div>` : ''}

            <div class="opt-label"><span>${I18N.t('kit.contents')}</span><span class="opt-aside">${I18N.t('shop.liveStock')}</span></div>
            <div class="kit-rows">
              ${rows.map(r => {
                const one = r.product.variants.length === 1 && r.product.variants[0].size === 'U';
                return `
                <div class="kit-row ${r.size && !r.ok ? 'bad' : ''}">
                  <div class="thumb thumb-media">${UI.media(r.product)}</div>
                  <div class="kit-row-name"><span class="q">${r.qty}×</span> ${UI.esc(r.product.name)}</div>
                  ${one
                    ? `<span class="muted tiny">${I18N.t('size.one')}${r.free < r.qty ? ' · ' + I18N.t('shop.badgeOut') : ''}</span>`
                    : `<select class="select" data-comp="${r.product.id}" aria-label="${I18N.t('shop.size')} — ${UI.esc(r.product.name)}">
                        <option value="">${I18N.t('kit.pick')}</option>
                        ${r.product.variants.map(v => {
                          const a = this.free(v);
                          const tail = a < r.qty ? ' — ' + I18N.t('shop.soldOutTitle') : (a <= r.product.minStock ? ' — ' + I18N.t('kit.left', { n: a }) : '');
                          return `<option value="${v.size}"${r.size === v.size ? ' selected' : ''}${a < r.qty && r.size !== v.size ? ' disabled' : ''}>${v.size}${tail}</option>`;
                        }).join('')}
                      </select>`}
                </div>`;
              }).join('')}
            </div>
            ${short.length ? `<div class="err-msg show" style="margin-top:10px">${I18N.t('kit.shortMsg', { list: short.map(r => UI.esc(r.product.name) + ' ' + r.size).join(', ') })}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('shop.keepShopping')}</button>
        <button class="btn btn-brand" id="addKit" ${ready ? '' : 'disabled'}>
          ${ready ? I18N.t('kit.add', { price: UI.money(p.price) })
                  : (missing ? I18N.t(missing === 1 ? 'kit.missingOne' : 'kit.missing', { n: missing }) : I18N.t('kit.unavailable'))}
        </button>
      </div>`;
  },

  refreshKit() {
    const p = Store.product(this.kit.productId);
    UI.rerenderModal(this.kitHTML(p));
    this.bindKit();
  },

  bindKit() {
    const p = Store.product(this.kit.productId);
    const box = document.getElementById('modalBox');

    const player = document.getElementById('kitPlayer');
    const year = document.getElementById('kitYear');
    const team = document.getElementById('kitTeam');
    // El aviso desaparece en cuanto el dato queda completo.
    const clearErr = (el, errId, okNow) => { if (okNow) { el.classList.remove('error'); document.getElementById(errId).classList.remove('show'); } };
    player.oninput = () => { this.kit.player = player.value; clearErr(player, 'errKitPlayer', player.value.trim()); };
    year.onchange = () => { this.kit.birthYear = year.value; clearErr(year, 'errKitYear', year.value); };
    team.oninput = () => { this.kit.team = team.value; };

    box.querySelectorAll('[data-img]').forEach(b => b.onclick = () => { this.kit.img = b.dataset.img; this.refreshKit(); });

    box.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
      this.applyQuickSize(p, b.dataset.quick);
      this.refreshKit();
    });

    box.querySelectorAll('[data-comp]').forEach(sel => sel.onchange = () => {
      this.kit.sizes[sel.dataset.comp] = sel.value;
      this.refreshKit();
    });

    document.getElementById('addKit').onclick = () => {
      // Quien prepara la orden necesita saber para qué jugador es cada kit.
      const missName = !this.kit.player.trim(), missYear = !this.kit.birthYear;
      player.classList.toggle('error', missName);
      year.classList.toggle('error', missYear);
      document.getElementById('errKitPlayer').classList.toggle('show', missName);
      document.getElementById('errKitYear').classList.toggle('show', missYear);
      if (missName || missYear) { (missName ? player : year).focus(); return; }

      const rows = this.kitRows(p);
      const r = Store.addKit(p.id, rows.map(x => ({ productId: x.product.id, variantId: x.variant && x.variant.id })), 1,
        { name: this.kit.player, birthYear: this.kit.birthYear, team: this.kit.team });
      if (!r.ok) { UI.toast('danger', I18N.t('shop.notFoundTitle'), r.error); return; }
      UI.closeModal();
      this.afterAdd(I18N.t('kit.addedFor', { name: p.name, player: this.kit.player.trim() }));
    };
  },

  /** Años de nacimiento razonables para un jugador de 3 a 19 años. */
  birthYears() {
    const now = new Date().getFullYear();
    const out = [];
    for (let y = now - 3; y >= now - 19; y--) out.push(y);
    return out;
  },

  /** "Mateo Gómez · 2016 · U10 Blue" */
  playerLine(l) {
    return [l.player, l.birthYear, l.team].filter(Boolean).map(x => UI.esc(String(x))).join(' · ');
  },

  /* ============================================================
     CARRITO
     ============================================================ */
  bumpCart() {
    const el = document.getElementById('cartCount');
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  },

  openCart() {
    this.renderCart();
    document.getElementById('cartDrawer').classList.add('open');
    document.getElementById('cartOverlay').classList.add('open');
    document.body.classList.add('no-scroll');
  },

  closeCart() {
    document.getElementById('cartDrawer').classList.remove('open');
    document.getElementById('cartOverlay').classList.remove('open');
    document.body.classList.remove('no-scroll');
  },

  gateBannerHTML() {
    const g = Store.kitGate();
    if (!g.required || g.ok || !Store.cart.length) return '';
    return `
      <div class="alert alert-warn gate-banner">
        ${UI.infoIcon()}
        <div style="flex:1">
          <div class="alert-title">${I18N.t('gate.title')}</div>
          <div class="alert-body">${I18N.t(Store.session ? 'gate.bodyKnown' : 'gate.body')}</div>
          <div class="gate-actions">
            <button class="btn btn-sm btn-primary" id="gateKit">${I18N.t('gate.addKit')}</button>
            ${Store.session ? '' : `<button class="btn btn-sm" id="gateSign">${I18N.t('gate.signIn')}</button>`}
          </div>
        </div>
      </div>`;
  },

  renderCart() {
    document.getElementById('cartCount').textContent = Store.cartCount();
    document.getElementById('cartStoreName').textContent = this.store.name;

    const body = document.getElementById('cartBody');
    const foot = document.getElementById('cartFoot');
    const cart = Store.cart;
    const scrollTop = body.scrollTop;   // se conserva al cambiar cantidades
    // Se restaura en cuanto hay contenido nuevo y otra vez tras pintar, por si el diseño aún se movía.
    const keepScroll = () => { body.scrollTop = scrollTop; requestAnimationFrame(() => { body.scrollTop = scrollTop; }); };

    if (!cart.length) {
      body.innerHTML = UI.empty(
        I18N.t('cart.empty'), I18N.t('cart.emptyBody'),
        '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>');
      foot.innerHTML = `<button class="btn btn-block" onclick="Shop.closeCart()">${I18N.t('cart.keepShopping')}</button>`;
      return;
    }

    const stepper = l => `
      <div class="qty-stepper sm">
        <button data-dec="${l.lineId}" aria-label="${I18N.t('cart.decrease')}">−</button>
        <input value="${l.qty}" readonly aria-label="${I18N.t('shop.quantity')}">
        <button data-inc="${l.lineId}" aria-label="${I18N.t('cart.increase')}">+</button>
      </div>`;
    const trash = l => `
      <button class="icon-btn" data-del="${l.lineId}" aria-label="${I18N.t('cart.remove')}" style="width:26px;height:26px">
        <svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>`;

    body.innerHTML = this.gateBannerHTML() + cart.map(l => {
      const p = Store.product(l.productId) || { kind: 'jersey', name: l.name };
      const detail = l.kind === 'kit'
        ? `<div class="cart-variant">${l.player ? this.playerLine(l) + ' · ' : ''}${I18N.t('cart.kitLine')}</div>
           <ul class="cart-comps">${l.components.map(c => `<li>${c.qty > 1 ? c.qty + '× ' : ''}${UI.esc(c.name)} <b>${UI.esc(UI.sizeLabel(c.size))}</b></li>`).join('')}</ul>`
        : `<div class="cart-variant">${I18N.t('shop.size')} ${UI.esc(UI.sizeLabel(l.size))} · <span class="mono">${UI.esc(l.sku)}</span></div>`;
      return `
        <div class="cart-line">
          <div class="cart-thumb" style="background:${UI.mediaBg()}">${UI.media(p)}</div>
          <div class="cart-info">
            <div class="cart-name">${UI.esc(l.name)}</div>
            ${detail}
            <div class="cart-line-foot">
              ${stepper(l)}
              <div style="display:flex;align-items:center;gap:10px"><strong>${UI.money(l.price * l.qty)}</strong>${trash(l)}</div>
            </div>
          </div>
        </div>`;
    }).join('');
    keepScroll();

    const t = Store.cartTotals('pickup');
    const gate = Store.kitGate();
    foot.innerHTML = `
      <div class="sum-row"><span class="muted">${I18N.t('cart.subtotal')}</span><span>${UI.money(t.subtotal)}</span></div>
      ${t.savings ? `<div class="sum-row"><span class="muted">${I18N.t('cart.kitSavings')}</span><span style="color:var(--ok-600);font-weight:600">−${UI.money(t.savings)}</span></div>` : ''}
      <div class="sum-row"><span class="muted">${I18N.t('cart.tax', { tax: UI.pct(t.taxRate) })}</span><span>${UI.money(t.tax)}</span></div>
      <div class="sum-row"><span class="muted">${I18N.t('cart.shipping')}</span><span class="muted tiny">${I18N.t('cart.shippingLater')}</span></div>
      <div class="sum-row total"><span>${I18N.t('cart.total')}</span><span>${UI.money(t.total)}</span></div>
      <button class="btn btn-gold btn-block btn-lg" style="margin-top:14px" id="goCheckout">${I18N.t(gate.required && !gate.ok ? 'gate.checkoutBlocked' : 'cart.checkout')}</button>
      <button class="btn btn-ghost btn-block btn-sm" style="margin-top:6px" onclick="Shop.closeCart()">${I18N.t('cart.keepShopping')}</button>`;

    body.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => {
      const line = Store.cart.find(l => l.lineId === b.dataset.inc);
      const r = Store.updateLineQty(line.lineId, line.qty + 1);
      if (!r.ok && r.error) UI.toast('warn', I18N.t('shop.limitReached'), r.error);
      this.afterCartChange();
    });
    body.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
      const line = Store.cart.find(l => l.lineId === b.dataset.dec);
      Store.updateLineQty(line.lineId, line.qty - 1);
      this.afterCartChange();
    });
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      Store.removeLine(b.dataset.del);
      this.afterCartChange();
      UI.toast('info', I18N.t('cart.removedTitle'), I18N.t('cart.removedBody'));
    });

    const gk = document.getElementById('gateKit');
    if (gk) gk.onclick = () => this.goToKit();
    const gs = document.getElementById('gateSign');
    if (gs) gs.onclick = () => { this.closeCart(); this.accountForm(); };

    document.getElementById('goCheckout').onclick = () => this.checkout();
  },

  afterCartChange() {
    this.renderCart();
    this.renderGrid();
    this.renderKits();
  },

  goToKit() {
    this.closeCart();
    const kits = this.kits();
    if (kits.length === 1) return this.openKit(kits[0].id);
    const el = document.getElementById('shopKits');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  /* ============================================================
     CHECKOUT — datos → entrega → pago → confirmación
     ============================================================ */
  checkout() {
    if (!Store.cart.length) { UI.toast('warn', I18N.t('cart.emptyWarnTitle'), I18N.t('cart.emptyWarnBody')); return; }

    // Regla del kit: sin kit propio ni en el carrito no se llega al pago.
    const gate = Store.kitGate();
    if (gate.required && !gate.ok) {
      if (!Store.session) {
        this.closeCart();
        UI.toast('warn', I18N.t('gate.title'), I18N.t('gate.toastSignIn'));
        return this.accountForm('checkout');
      }
      this.openCart();
      UI.toast('warn', I18N.t('gate.title'), I18N.t('gate.bodyKnown'));
      return;
    }

    const st = this.store;
    const c = Store.session;
    // Lo ya escrito se conserva si el formulario se cierra y se vuelve a abrir.
    if (!this.form || this.form.store !== st.id) this.form = { store: st.id };
    const f = this.form;
    if (!f.email && c) f.email = c.email;
    if (!f.name && c) f.name = c.name;
    if (!f.phone && c && c.phone !== '—') f.phone = c.phone;
    if (!st[this.fulfill]) this.fulfill = st.pickup ? 'pickup' : 'shipping';
    this.closeCart();
    UI.modal(this.checkoutHTML(), '');
    this.bindCheckout();
  },

  pickupLabel() {
    const id = this.store.id;
    return I18N.t('fulfill.pickup.' + (I18N.has('fulfill.pickup.' + id) ? id : 'generic'));
  },

  summaryHTML() {
    const t = Store.cartTotals(this.fulfill);
    return `
      <div style="font-weight:640;margin-bottom:10px">${I18N.t('checkout.orderSummary')}</div>
      ${Store.cart.map(l => `
        <div class="row"><span>${UI.esc(l.name)}${l.kind === 'kit' ? (l.player ? ' · ' + this.playerLine(l) : '') : ' · ' + UI.esc(UI.sizeLabel(l.size))} × ${l.qty}</span><b>${UI.money(l.price * l.qty)}</b></div>
        ${l.kind === 'kit' ? `<div class="row sub"><span>${l.components.map(c => UI.esc(c.name) + ' ' + UI.esc(UI.sizeLabel(c.size))).join(' · ')}</span></div>` : ''}
      `).join('')}
      <div style="height:1px;background:#3a3f4a;margin:10px 0"></div>
      <div class="row"><span>${I18N.t('cart.subtotal')}</span><b>${UI.money(t.subtotal)}</b></div>
      <div class="row"><span>${I18N.t('cart.tax', { tax: UI.pct(t.taxRate) })}</span><b>${UI.money(t.tax)}</b></div>
      <div class="row"><span>${I18N.t(this.fulfill === 'shipping' ? 'fulfill.shipping' : 'cart.shipping')}</span><b>${this.fulfill === 'shipping' ? UI.money(t.shipping) : I18N.t('fulfill.noShipping')}</b></div>
      <div class="row" style="font-size:16px;margin-top:8px"><span style="color:#fff">${I18N.t('cart.total')}</span><b style="color:var(--gold-400)">${UI.money(t.total)}</b></div>`;
  },

  checkoutHTML() {
    const st = this.store;
    const t = Store.cartTotals(this.fulfill);
    const f = this.form;
    const opt = (val, title, sub, price) => `
      <label class="fulfill-opt ${this.fulfill === val ? 'sel' : ''}">
        <input type="radio" name="ckFulfill" value="${val}" ${this.fulfill === val ? 'checked' : ''}>
        <span class="fo-text"><span class="fo-title">${title}</span><span class="fo-sub">${sub}</span></span>
        <span class="fo-price">${price}</span>
      </label>`;

    return `
      <div class="modal-head">
        <div>
          <h2>${I18N.t('checkout.title')}</h2>
          <p class="muted tiny" style="margin-top:2px">${UI.esc(st.name)}</p>
        </div>
        ${UI.closeBtn()}
      </div>

      <div class="modal-body">
        <div class="steps">
          <div class="step active"><span class="n">1</span> ${I18N.t('checkout.step1')}</div>
          <div class="step-line"></div>
          <div class="step"><span class="n">2</span> ${I18N.t('checkout.step2')}</div>
          <div class="step-line"></div>
          <div class="step"><span class="n">3</span> ${I18N.t('checkout.step3')}</div>
        </div>

        <div class="demo-banner">${UI.infoIcon()} ${I18N.t('checkout.demoNote')}</div>

        <form id="checkoutForm" novalidate>
          <h3 class="form-h">${I18N.t('checkout.contact')}</h3>
          <div class="form-grid">
            <div class="field span-2">
              <label for="ckEmail">${I18N.t('checkout.email')} <span class="req">*</span></label>
              <input class="input" id="ckEmail" type="email" value="${UI.esc(f.email || '')}" placeholder="name@email.com" autocomplete="email" ${f.email ? '' : 'data-autofocus'}>
              <div class="hint">${I18N.t(st.kitRequired ? 'checkout.emailHintKit' : 'checkout.emailHint')}</div>
              <div class="err-msg" id="errEmail">${I18N.t('checkout.emailErr')}</div>
            </div>
            <div class="field">
              <label for="ckName">${I18N.t('checkout.fullName')} <span class="req">*</span></label>
              <input class="input" id="ckName" value="${UI.esc(f.name || '')}" autocomplete="name">
              <div class="err-msg" id="errName">${I18N.t('checkout.fullNameErr')}</div>
            </div>
            <div class="field">
              <label for="ckPhone">${I18N.t('checkout.phone')}</label>
              <input class="input" id="ckPhone" value="${UI.esc(f.phone || '')}" placeholder="(305) 555-0100" autocomplete="tel">
            </div>
          </div>

          <h3 class="form-h">${I18N.t('checkout.delivery')}</h3>
          <div class="fulfill-opts">
            ${st.pickup ? opt('pickup', this.pickupLabel(), I18N.t('fulfill.pickupSub'), I18N.t('cart.free')) : ''}
            ${st.shipping ? opt('shipping', I18N.t('fulfill.shipping'), I18N.t('fulfill.shippingSub'), UI.money(st.shippingFlat)) : ''}
          </div>

          <div id="ckAddress" style="${this.fulfill === 'shipping' ? '' : 'display:none'}">
            <div class="form-grid">
              <div class="field span-2">
                <label for="ckAddr">${I18N.t('checkout.address')} <span class="req">*</span></label>
                <input class="input" id="ckAddr" value="${UI.esc(f.addr || '')}" placeholder="${I18N.t('checkout.addressPh')}" autocomplete="street-address">
                <div class="err-msg" id="errAddr">${I18N.t('checkout.addressErr')}</div>
              </div>
              <div class="field">
                <label for="ckCity">${I18N.t('checkout.city')} <span class="req">*</span></label>
                <input class="input" id="ckCity" value="${UI.esc(f.city || '')}" autocomplete="address-level2">
                <div class="err-msg" id="errCity">${I18N.t('checkout.cityErr')}</div>
              </div>
              <div class="form-grid tight">
                <div class="field">
                  <label for="ckState">${I18N.t('checkout.state')}</label>
                  <input class="input" id="ckState" value="${UI.esc(f.state || (this.store.id === 'lasvegas' ? 'NV' : 'FL'))}" maxlength="2" autocomplete="address-level1" style="text-transform:uppercase">
                </div>
                <div class="field">
                  <label for="ckZip">${I18N.t('checkout.zip')} <span class="req">*</span></label>
                  <input class="input" id="ckZip" value="${UI.esc(f.zip || '')}" inputmode="numeric" placeholder="33131" autocomplete="postal-code">
                  <div class="err-msg" id="errZip">${I18N.t('checkout.zipErr')}</div>
                </div>
              </div>
            </div>
          </div>

          <h3 class="form-h">${I18N.t('checkout.paymentMethod')}</h3>
          <div class="pay-method">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
            <div>
              <div class="pm-title">${I18N.t('checkout.cardOption')}</div>
              <div class="pm-sub">${I18N.t('checkout.tokenizeNote')}</div>
            </div>
          </div>
          <p class="tiny muted" style="margin:8px 0 16px">${I18N.t('checkout.noCash')}</p>

          <div class="pay-card" id="ckSummary">${this.summaryHTML()}</div>
        </form>
      </div>

      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal();Shop.openCart()">${I18N.t('checkout.backToCart')}</button>
        <button class="btn btn-gold" id="payNow">${I18N.t('checkout.pay', { amount: UI.money(t.total) })}</button>
      </div>`;
  },

  bindCheckout() {
    const val = id => document.getElementById(id).value.trim();

    const form = document.getElementById('checkoutForm');
    // Borrador: lo escrito sobrevive a un cierre accidental del formulario.
    form.addEventListener('input', () => Object.assign(this.form, {
      email: val('ckEmail'), name: val('ckName'), phone: val('ckPhone'),
      addr: val('ckAddr'), city: val('ckCity'), state: val('ckState'), zip: val('ckZip')
    }));
    // Enter en cualquier campo equivale a pulsar Pagar.
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'radio') {
        e.preventDefault();
        document.getElementById('payNow').click();
      }
    });

    document.querySelectorAll('input[name="ckFulfill"]').forEach(r => r.onchange = () => {
      this.fulfill = r.value;
      document.querySelectorAll('.fulfill-opt').forEach(o => o.classList.toggle('sel', o.querySelector('input').checked));
      document.getElementById('ckAddress').style.display = this.fulfill === 'shipping' ? '' : 'none';
      document.getElementById('ckSummary').innerHTML = this.summaryHTML();
      document.getElementById('payNow').textContent = I18N.t('checkout.pay', { amount: UI.money(Store.cartTotals(this.fulfill).total) });
    });

    document.getElementById('payNow').onclick = () => {
      const name = val('ckName'), email = val('ckEmail');
      const ship = this.fulfill === 'shipping';

      let bad = false;
      const mark = (inputId, errId, cond) => {
        const i = document.getElementById(inputId), e = document.getElementById(errId);
        if (cond) { i.classList.add('error'); e.classList.add('show'); bad = true; }
        else { i.classList.remove('error'); e.classList.remove('show'); }
      };
      mark('ckName',  'errName',  !name);
      mark('ckEmail', 'errEmail', !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      if (ship) {
        mark('ckAddr', 'errAddr', !val('ckAddr'));
        mark('ckCity', 'errCity', !val('ckCity'));
        mark('ckZip',  'errZip',  !/^\d{5}(-\d{4})?$/.test(val('ckZip')));
      }
      if (bad) { UI.toast('danger', I18N.t('checkout.formErrTitle'), I18N.t('checkout.formErrBody')); return; }

      // El kit se comprueba contra el correo con el que realmente se paga.
      if (!Store.kitGate(email).ok) {
        UI.toast('warn', I18N.t('gate.title'), I18N.t('gate.emailNoKit', { email }));
        const i = document.getElementById('ckEmail');
        i.classList.add('error');
        i.focus();
        return;
      }

      this.processPayment({
        name, email, phone: val('ckPhone'),
        fulfillment: this.fulfill,
        address: ship ? { line: val('ckAddr'), city: val('ckCity'), state: val('ckState').toUpperCase(), zip: val('ckZip') } : null,
        paymentMethod: 'Stripe · Visa ···4242'
      });
    };
  },

  /** Simula la secuencia real: autorización → webhook → pedido → inventario. */
  processPayment(data) {
    UI.modal(`
      <div class="modal-body">
        <div class="processing">
          <div class="spinner"></div>
          <h2>${I18N.t('pay.processing')}</h2>
          <p class="muted" style="margin-top:6px;font-size:13.5px">${I18N.t('pay.dontClose')}</p>
          <div class="pay-steps" style="margin-top:26px">
            <div class="pay-step" id="ps1"><span class="tick"></span> ${I18N.t('pay.step1')}</div>
            <div class="pay-step" id="ps2"><span class="tick"></span> ${I18N.t('pay.step2')}</div>
            <div class="pay-step" id="ps3"><span class="tick"></span> ${I18N.t('pay.step3')}</div>
            <div class="pay-step" id="ps4"><span class="tick"></span> ${I18N.t('pay.step4')}</div>
          </div>
        </div>
      </div>`, 'narrow');

    const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    const on = id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('on');
      el.querySelector('.tick').innerHTML = tick;
    };
    setTimeout(() => on('ps1'), 450);
    setTimeout(() => on('ps2'), 950);
    setTimeout(() => on('ps3'), 1400);
    setTimeout(() => on('ps4'), 1850);

    setTimeout(() => {
      const r = Store.placeOrder(data);
      if (!r.ok && r.code === 'trial') {
        // Tienda pública durante la prueba: todo funciona menos el cobro, que llega con Stripe.
        UI.modal(`
          <div class="modal-head"><h2>${I18N.t('trial.title')}</h2></div>
          <div class="modal-body">
            <div class="alert alert-info">${UI.infoIcon()}<div><div class="alert-body">${I18N.t('trial.body')}</div></div></div>
          </div>
          <div class="modal-foot"><button class="btn btn-primary" onclick="UI.closeModal();Shop.openCart()">${I18N.t('pay.reviewCart')}</button></div>`, 'narrow');
        return;
      }
      if (!r.ok) {
        UI.modal(`
          <div class="modal-head"><h2>${I18N.t('pay.failedTitle')}</h2></div>
          <div class="modal-body">
            <div class="alert alert-danger">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <div><div class="alert-title">${I18N.t('pay.failedHead')}</div><div class="alert-body">${UI.esc(r.error)}</div></div>
            </div>
            <p class="muted" style="font-size:13px;line-height:1.6">${I18N.t(r.code === 'kit' ? 'pay.failedNoteKit' : 'pay.failedNote')}</p>
          </div>
          <div class="modal-foot">
            <button class="btn btn-primary" onclick="UI.closeModal();Shop.openCart()">${I18N.t('pay.reviewCart')}</button>
          </div>`, 'narrow');
        UI.toast('danger', I18N.t('pay.blockedToast'), r.error);
        return;
      }

      this.form = null;
      this.successHTML(r);
      this.render();
      this.renderCart();
      if (typeof Admin !== 'undefined') Admin.refresh();
      // Al cliente no se le habla de inventario: eso es información interna.
      UI.toast('ok', I18N.t('pay.confirmedTitle'), App.storefront ? r.order.number : I18N.t('pay.confirmedToast', { number: r.order.number }));
    }, 2350);
  },

  successHTML(r) {
    const o = r.order;
    const pickup = o.fulfillment === 'pickup';
    const a = o.address;
    UI.modal(`
      <div class="modal-body" style="text-align:center">
        <div class="success-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <h2>${I18N.t('confirm.title')}</h2>
        <p class="muted" style="margin-top:8px;font-size:13.5px">
          ${I18N.t('confirm.sentTo', { email: `<strong>${UI.esc(r.customer.email)}</strong>` })}
        </p>

        <div class="receipt">
          <div class="r-row"><span class="muted">${I18N.t('confirm.orderNumber')}</span><b class="mono">${o.number}</b></div>
          <div class="r-row"><span class="muted">${I18N.t('confirm.store')}</span><b>${UI.esc(UI.storeName(o.storeId))}</b></div>
          <div class="r-row"><span class="muted">${I18N.t('confirm.date')}</span><b>${UI.date(o.date, true)}</b></div>
          <div class="r-row"><span class="muted">${I18N.t('confirm.delivery')}</span><b style="text-align:right">${pickup ? this.pickupLabel() : UI.esc([a.line, a.city, a.state + ' ' + a.zip].join(', '))}</b></div>
          <div class="r-row"><span class="muted">${I18N.t('confirm.paymentMethod')}</span><b>${UI.esc(o.paymentMethod)}</b></div>
          <div style="height:1px;background:var(--border-strong);margin:8px 0"></div>
          ${o.items.map(i => `
            <div class="r-row"><span>${UI.esc(i.name)}${i.kind === 'kit' ? (i.player ? ' · ' + this.playerLine(i) : '') : ' · ' + UI.esc(UI.sizeLabel(i.size))} × ${i.qty}</span><b>${UI.money(i.price * i.qty)}</b></div>
            ${i.kind === 'kit' ? `<div class="r-row sub"><span>${i.components.map(c => UI.esc(c.name) + ' ' + UI.esc(UI.sizeLabel(c.size))).join(' · ')}</span></div>` : ''}`).join('')}
          <div style="height:1px;background:var(--border-strong);margin:8px 0"></div>
          <div class="r-row"><span class="muted">${I18N.t('cart.subtotal')}</span><b>${UI.money(o.subtotal)}</b></div>
          <div class="r-row"><span class="muted">${I18N.t('cart.tax', { tax: UI.pct(o.taxRate) })}</span><b>${UI.money(o.tax)}</b></div>
          ${o.shipping ? `<div class="r-row"><span class="muted">${I18N.t('fulfill.shipping')}</span><b>${UI.money(o.shipping)}</b></div>` : ''}
          <div class="r-row" style="font-size:15px;margin-top:6px"><span><b>${I18N.t('confirm.total')}</b></span><b>${UI.money(o.total)}</b></div>
        </div>

        <p class="tiny muted" style="line-height:1.6">${I18N.t(pickup ? 'confirm.pickupNote' : 'confirm.shipNote')}</p>

        ${App.storefront ? '' : `
        <div class="trace">
          <div class="trace-title">
            <svg style="width:13px;height:13px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            ${I18N.t('confirm.traceTitle')}
          </div>
          ${r.trace.map(m => `
            <div class="trace-line">
              <span>${UI.esc(m.product)}<br><span class="muted tiny">${UI.esc(UI.sizeLabel(m.variant))} · ${UI.esc(m.sku)}</span></span>
              <span class="nowrap"><span class="mono muted">${m.before}</span> → <b class="mono">${m.after}</b> <span class="trace-delta">(−${m.qty})</span></span>
            </div>`).join('')}
        </div>
        <p class="tiny muted" style="margin-top:12px;line-height:1.6">${I18N.t('confirm.traceFooter')}</p>`}
      </div>

      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('cart.keepShopping')}</button>
        ${App.storefront ? '' : `<button class="btn btn-primary" id="seeOrder">${I18N.t('confirm.seeAdmin')}</button>`}
      </div>`, '');

    const see = document.getElementById('seeOrder');
    if (see) see.onclick = () => {
      UI.closeModal();
      App.setMode('admin');
      Admin.go('orders');
    };
  }
};
