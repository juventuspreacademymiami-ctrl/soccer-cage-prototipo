/* ============================================================
   SOCCER CAGE — Arranque y conmutación Tienda ⇄ Panel ⇄ Análisis

   Enlaces:
   · Cada tienda en su ruta (/camps, /lasvegas, /athletum) o en su dominio
     propio: solo la tienda de ese canal, sin panel. ?store=camps sigue valiendo.
   · El panel en /panel, aparte de las tiendas.
   · En la base compartida la raíz muestra las tiendas para elegir (sin
     enlace al panel); en la demo local la raíz sigue siendo la demo
     completa (las tres tiendas y el panel juntos).

   Y dos lugares para los datos:
   · Demo local (js/config.js sin activar, o ?modo=demo): todo en
     este navegador, como siempre.
   · Base compartida (Supabase): el panel pide iniciar sesión y todo
     el equipo ve los mismos datos; la tienda pública lee el catálogo.
   ============================================================ */

const App = {
  mode: 'shop',
  storefront: null,
  adminReady: false,

  init() {
    I18N.init();
    this.route();
    const cloud = typeof Cloud !== 'undefined' && Cloud.init();
    // En la base compartida la raíz muestra las tiendas. Los enlaces viejos siguen
    // sirviendo: ?store= lleva a la tienda; ?panel= y los correos de invitación y
    // recuperación (#access_token…) llevan al panel, con la consulta y el #token.
    if (cloud && !this.path && !this.hostStore) {
      const q = new URLSearchParams(location.search), s = (q.get('store') || '').toLowerCase();
      q.delete('store');
      const rest = (q.toString() ? '?' + q : '') + location.hash;
      if (/^[a-z0-9-]+$/.test(s)) { location.replace('/' + s + rest); return; }
      if (q.has('panel') || /access_token|error_description/.test(location.hash)) { location.replace('/panel' + rest); return; }
      this.landing = true;
    }
    if (cloud) { this.bootCloud(); return; }
    Store.load();
    this.start();
  },

  /** Lee la ruta: /panel es el panel; /camps, la tienda camps; el dominio propio manda sobre todo. */
  route() {
    const seg = location.pathname.split('/').filter(Boolean).pop() || '';
    this.path = /^index\.html?$/i.test(seg) ? '' : decodeURIComponent(seg).toLowerCase();
    this.panelOnly = this.path === 'panel';
    this.hostStore = (window.SOCCERCAGE_HOSTS || {})[location.hostname.toLowerCase()] || null;
  },

  /* ---------- Arranque con base compartida ---------- */
  async bootCloud() {
    Store.cloudMode = true;
    document.body.classList.add('cloud');
    Cloud.onRemote = (data, rev, info) => {
      Store.adopt(data, rev);
      this.refreshAll();
      if (info.conflict) UI.toast('warn', I18N.t('cloud.conflictTitle'), I18N.t('cloud.conflictBody', { by: info.by || '—' }));
      else UI.toast('info', I18N.t('cloud.updatedTitle'), I18N.t('cloud.updatedBody', { by: info.by || '—' }));
    };
    Cloud.onStatus = (s, err) => this.syncChip(s, err);
    // La sesión venció con cambios sin guardar: se pide entrar de nuevo y se guardan.
    Cloud.onSessionLost = () => { if (!document.getElementById('lgGo')) this.loginForm(I18N.t('cloud.sessionLost'), { resume: true }); };
    this.boot(I18N.t('cloud.loading'));

    const redirect = Cloud.takeRedirect();
    try {
      if (Cloud.session) {
        try { await Cloud.loadMe(); }
        catch (e) { if (e.status) await Cloud.signOut(); else throw e; }   // sesión vencida: se entra como visitante
      }
      if (Cloud.signedIn) await this.loadShared();
      else await this.loadPublic();
    } catch (e) {
      this.boot(I18N.t('cloud.bootFail'), e);
      return;
    }
    this.boot(null);
    this.start();
    if (redirect) this.afterRedirect(redirect);
  },

  async loadShared() {
    const r = await Cloud.loadState();
    Store.readOnly = false;   // se entró como visitante y ahora hay sesión del equipo
    if (r.data) Store.adopt(r.data, Cloud.rev);
    else await this.firstRun();
    Cloud.startPolling();
    if (!Cloud.pending) this.syncChip('saved');
  },

  async loadPublic() {
    const cat = await Cloud.catalog();
    if (cat.empty) cat.stores = clone(SEED.stores).map(s => Object.assign(s, { active: false }));
    Store.adoptCatalog(cat);
  },

  /** Base recién creada: se elige con qué empezar. */
  firstRun() {
    return new Promise(resolve => {
      this.boot(null);
      UI.modal(`
        <div class="modal-head"><h2>${I18N.t('cloud.firstTitle')}</h2></div>
        <div class="modal-body">
          <p class="muted" style="font-size:13.5px;line-height:1.6;margin-bottom:14px">${I18N.t('cloud.firstBody')}</p>
          <div class="imp-mode">
            <button class="imp-opt" id="frDemo" type="button"><span><b>${I18N.t('cloud.firstDemo')}</b><small>${I18N.t('cloud.firstDemoHint')}</small></span></button>
            <button class="imp-opt" id="frClean" type="button"><span><b>${I18N.t('cloud.firstClean')}</b><small>${I18N.t('cloud.firstCleanHint')}</small></span></button>
          </div>
        </div>`, 'narrow');
      const pick = clean => {
        UI.closeModal();
        if (clean) Store.resetClean(); else Store.reset();
        resolve();
      };
      document.getElementById('frDemo').onclick = () => pick(false);
      document.getElementById('frClean').onclick = () => pick(true);
    });
  },

  /** Pantalla de carga o de error del arranque. null la quita. */
  boot(msg, err) {
    let el = document.getElementById('bootScreen');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'bootScreen';
      el.className = 'boot-screen';
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="boot-box">${err ? '' : '<div class="boot-spin"></div>'}<p>${UI.esc(msg)}</p>${err
      ? `<p class="muted tiny">${UI.esc(err.code === 'offline' ? I18N.t('cloud.offline') : (err.message || ''))}</p><button class="btn btn-primary" onclick="location.reload()">${I18N.t('cloud.retry')}</button>` : ''}</div>`;
  },

  /* ---------- Arranque común ---------- */
  start() {
    // Avisos del almacenamiento: lleno o no disponible, y conflicto entre pestañas.
    Store.onSaveError = () => UI.toast('danger', I18N.t('sys.saveFailTitle'), I18N.t('sys.saveFailBody'));
    Store.onConflict = () => { this.refreshAll(); UI.toast('warn', I18N.t('sys.conflictTitle'), I18N.t('sys.conflictBody')); };
    // Otra pestaña guardó: se adopta su estado para no trabajar sobre datos viejos.
    window.addEventListener('storage', e => {
      if (e.key === 'soccercage_rev' && Store.syncFromStorage()) this.refreshAll();
    });

    // La tienda se elige por el dominio (store.athletumfc.com → athletum), por la
    // ruta (/camps) o por ?store=. /panel es solo el panel, sin tiendas.
    const wanted = this.hostStore || (this.path && !this.panelOnly ? this.path : null) || new URLSearchParams(location.search).get('store');
    if (wanted && Store.storeCfg(wanted)) {
      this.storefront = wanted;
      Store.setStore(wanted);
      document.body.classList.add('storefront');
    } else if (this.path && !this.panelOnly) { this.notFound(); return; }
    if (this.panelOnly) document.body.classList.add('panel-only');
    if (this.landing) { this.home(); return; }

    this.medirScrollbar();
    this.applyStaticI18n();

    document.getElementById('btnShop').onclick    = () => this.setMode('shop');
    document.getElementById('btnAdmin').onclick   = () => this.setMode('admin');
    document.getElementById('btnCompare').onclick = () => this.setMode('compare');

    document.getElementById('sidebarToggle').onclick = () =>
      document.getElementById('sidebar').classList.toggle('open');

    document.getElementById('langBtn').onclick = () =>
      I18N.setLang(I18N.lang === 'es' ? 'en' : 'es');

    const chip = document.getElementById('userChip');
    if (Store.cloudMode && chip) {
      const open = () => (Cloud.signedIn ? this.accountMenu() : this.loginForm());
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      chip.classList.add('is-action');
      chip.onclick = open;
      chip.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    }

    Shop.init();
    if (!this.storefront) {
      this.initAdmin();
      Compare.init();
    }
    this.syncUser();
    // ?panel=settings abre el panel directo en esa sección (enlaces de la lista de pendientes).
    const ir = new URLSearchParams(location.search).get('panel');
    if (!this.storefront && ir && /^[a-z]+$/.test(ir) && document.getElementById('page-' + ir)) this.pendingPage = ir;
    this.setMode(this.panelOnly || this.pendingPage ? 'admin' : 'shop');

    // Atajos de teclado para la demostración en vivo
    document.addEventListener('keydown', e => {
      if (this.storefront || this.panelOnly || !e.altKey) return;
      // El análisis está oculto por ahora: sin atajo de teclado.
      const m = { '1': 'shop', '2': 'admin' }[e.key];
      if (m) { e.preventDefault(); this.setMode(m); }
    });
  },

  /** El panel solo se arma con los datos completos (en la nube, tras iniciar sesión). */
  initAdmin() {
    if (this.adminReady || (Store.cloudMode && !Cloud.signedIn)) return;
    Admin.init();
    this.adminReady = true;
  },

  setMode(mode) {
    if (this.storefront) mode = 'shop';
    if (this.panelOnly) mode = 'admin';
    if (mode === 'admin' && Store.cloudMode && !Cloud.signedIn) {
      if (this.panelOnly) this.panelGate(true);
      this.loginForm();
      return;
    }
    this.panelGate(false);
    this.mode = mode;

    const vistas = {
      shop:    { app: 'appShop',    btn: 'btnShop' },
      admin:   { app: 'appAdmin',   btn: 'btnAdmin' },
      compare: { app: 'appCompare', btn: 'btnCompare' }
    };

    Object.entries(vistas).forEach(([k, v]) => {
      const activa = k === mode;
      document.getElementById(v.app).classList.toggle('active', activa);
      const btn = document.getElementById(v.btn);
      btn.classList.toggle('active', activa);
      btn.setAttribute('aria-selected', activa);
    });

    // El carrito solo tiene sentido en la tienda. Se atenúa en su sitio en
    // vez de ocultarlo: así la barra no salta al cambiar de pestaña.
    ['cartBtn', 'acctBtn'].forEach(id => {
      const b = document.getElementById(id);
      b.classList.toggle('is-inactive', mode !== 'shop');
      b.setAttribute('aria-hidden', mode !== 'shop');
      b.tabIndex = mode === 'shop' ? 0 : -1;
    });
    document.getElementById('sidebarToggle').classList.toggle('is-hidden', mode !== 'admin');
    document.getElementById('sidebar').classList.remove('open');

    if (mode === 'shop') { Shop.render(); Shop.renderCart(); }
    else if (mode === 'admin') {
      // ?panel=settings abre el panel directo en esa sección (enlaces de la lista de pendientes).
      if (this.pendingPage && document.getElementById('page-' + this.pendingPage)) { Admin.go(this.pendingPage); Admin.updateBadge(); }
      else Admin.refresh();
      this.pendingPage = null;
    }
    else Compare.render();

    // Al arrancar no hay nada que desplazar: evita un salto visible.
    if (this._arrancado) window.scrollTo({ top: 0 });
    this._arrancado = true;
  },

  /** /panel sin sesión: solo la entrada del panel, nunca la tienda detrás. */
  panelGate(show) {
    let el = document.getElementById('panelGate');
    if (!show) { if (el) el.remove(); return; }
    document.querySelectorAll('.app').forEach(a => a.classList.remove('active'));
    if (el) return;
    el = document.createElement('main');
    el.id = 'panelGate';
    el.className = 'panel-gate';
    el.innerHTML = `<div class="panel-gate-box">
        <div class="brand-mark">SC</div>
        <h1>${I18N.t('panel.gateTitle')}</h1>
        <p class="muted">${I18N.t('panel.gateBody')}</p>
        <button class="btn btn-primary btn-lg" type="button">${I18N.t('cloud.loginBtn')}</button>
      </div>`;
    el.querySelector('button').onclick = () => this.loginForm();
    document.querySelector('.topbar').after(el);
  },

  /** Raíz del dominio de las tiendas: las tiendas para elegir. El panel no se enlaza. */
  home() {
    document.body.classList.add('storefront', 'sf-home');
    Shop.loadFonts();
    this.applyStaticI18n();
    document.getElementById('brandName').textContent = I18N.t('home.brand');
    document.getElementById('brandSub').textContent = I18N.t('home.brandSub');
    document.title = I18N.t('home.brand') + ' — ' + I18N.t('home.title');
    ['cartBtn', 'acctBtn'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById('langBtn').onclick = () => I18N.setLang(I18N.lang === 'es' ? 'en' : 'es');
    const card = s => `
      <a class="home-store home-${Shop.theme(s)}" href="/${UI.esc(s.id)}" style="${UI.brandVars(s)}">
        <span class="home-store-top">
          ${UI.storeMark(s, 44)}
          <span class="home-badge ${s.active ? 'is-open' : ''}">${I18N.t(s.active ? 'home.open' : 'home.soon')}</span>
        </span>
        <span class="home-store-name">${UI.esc(s.name)}</span>
        <span class="home-store-go">${I18N.t('home.enter')}${UI.icon('arrowRight')}</span>
      </a>`;
    document.getElementById('shopRoot').innerHTML = `
      <section class="home-hero">
        <h1>${I18N.t('home.title')}</h1>
        <p>${I18N.t('home.body')}</p>
      </section>
      <div class="home-stores">${Store.stores.map(card).join('')}</div>
      <p class="home-foot muted tiny">${I18N.t('home.foot')}</p>`;
  },

  /** Ruta que no es ninguna tienda (/tienda-que-no-existe). */
  notFound() {
    document.body.classList.add('storefront');
    this.applyStaticI18n();
    ['cartBtn', 'acctBtn'].forEach(id => { document.getElementById(id).style.display = 'none'; });
    document.getElementById('shopRoot').innerHTML = `
      <section class="sf-missing">
        <h1>${I18N.t('shop.notFoundTitle')}</h1>
        <p>${I18N.t('shop.notFoundBody')}</p>
      </section>`;
  },

  /* ---------- Sesión del equipo (base compartida) ---------- */
  loginForm(msg, opts = {}) {
    UI.modal(`
      <div class="modal-head">
        <div><h2>${I18N.t('cloud.loginTitle')}</h2><p class="muted tiny" style="margin-top:2px">${I18N.t('cloud.loginSub')}</p></div>
        ${UI.closeBtn()}
      </div>
      <div class="modal-body">
        ${msg ? `<div class="alert alert-info" style="margin-bottom:14px">${UI.infoIcon()}<div><div class="alert-body">${UI.esc(msg)}</div></div></div>` : ''}
        <div class="field">
          <label for="lgEmail">${I18N.t('checkout.email')}</label>
          <input class="input" id="lgEmail" type="email" autocomplete="username" data-autofocus>
        </div>
        <div class="field">
          <label for="lgPass">${I18N.t('cloud.password')}</label>
          <input class="input" id="lgPass" type="password" autocomplete="current-password">
        </div>
        <div class="err-msg" id="lgErr"></div>
        <button class="link-btn" id="lgForgot" type="button">${I18N.t('cloud.forgot')}</button>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('ui.cancel')}</button>
        <button class="btn btn-primary" id="lgGo">${I18N.t('cloud.loginBtn')}</button>
      </div>`, 'narrow');

    UI.passwordEyes();
    const err = t => { const e = document.getElementById('lgErr'); e.textContent = t; e.classList.add('show'); };
    const go = async () => {
      const email = document.getElementById('lgEmail').value.trim(), pass = document.getElementById('lgPass').value;
      if (!email || !pass) return err(I18N.t('cloud.loginMissing'));
      const btn = document.getElementById('lgGo');
      btn.disabled = true;
      try {
        const me = await Cloud.signIn(email, pass);
        if (!me) { await Cloud.signOut(); btn.disabled = false; return err(I18N.t('cloud.notStaff')); }
        if (opts.resume) {
          // Se conservan los cambios hechos en esta pestaña y se guardan ahora.
          UI.closeModal();
          this.syncUser();
          Cloud.flush();
          UI.toast('ok', I18N.t('cloud.resumed'), I18N.t('cloud.resumedBody'));
          return;
        }
        await this.loadShared();
        UI.closeModal();
        this.initAdmin();
        this.refreshAll();
        this.setMode('admin');
        UI.toast('ok', I18N.t('cloud.welcome', { name: me.name || me.email }), I18N.t('cloud.welcomeBody'));
      } catch (e) {
        btn.disabled = false;
        err(e.code === 'offline' ? I18N.t('cloud.offline') : (e.status === 400 ? I18N.t('cloud.badLogin') : e.message));
      }
    };
    document.getElementById('lgGo').onclick = go;
    ['lgEmail', 'lgPass'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
    document.getElementById('lgForgot').onclick = async () => {
      const email = document.getElementById('lgEmail').value.trim();
      if (!email) return err(I18N.t('cloud.forgotNeedEmail'));
      try { await Cloud.recover(email); UI.toast('info', I18N.t('cloud.forgotSent'), I18N.t('cloud.forgotSentBody', { email })); }
      catch (e) { err(e.message); }
    };
  },

  accountMenu() {
    const s = Cloud.staff;
    UI.modal(`
      <div class="modal-head"><div><h2>${UI.esc(s.name || s.email)}</h2><p class="muted tiny" style="margin-top:2px">${UI.esc(s.email)} · ${I18N.t('cloud.role.' + s.role)}</p></div>${UI.closeBtn()}</div>
      <div class="modal-body">
        <p class="muted" style="font-size:13.5px;line-height:1.6">${I18N.t('cloud.accountBody')}</p>
      </div>
      <div class="modal-foot">
        <button class="btn" id="amPass">${I18N.t('cloud.changePass')}</button>
        <button class="btn btn-danger" id="amOut">${I18N.t('cloud.signOut')}</button>
      </div>`, 'narrow');
    document.getElementById('amPass').onclick = () => this.passwordForm(false);
    document.getElementById('amOut').onclick = async () => {
      if (Cloud.pending && !confirm(I18N.t('cloud.pendingOut'))) return;
      await Cloud.signOut();
      location.reload();
    };
  },

  /** Nueva contraseña: desde la cuenta, o al llegar desde el correo de invitación o recuperación. */
  passwordForm(fromEmail) {
    UI.modal(`
      <div class="modal-head"><h2>${I18N.t(fromEmail ? 'cloud.setPassTitle' : 'cloud.changePass')}</h2>${UI.closeBtn()}</div>
      <div class="modal-body">
        <div class="field"><label for="pwNew">${I18N.t('cloud.newPass')}</label><input class="input" id="pwNew" type="password" autocomplete="new-password" data-autofocus><div class="hint">${I18N.t('cloud.passHint')}</div></div>
        <div class="field"><label for="pwNew2">${I18N.t('cloud.newPass2')}</label><input class="input" id="pwNew2" type="password" autocomplete="new-password"></div>
        <div class="err-msg" id="pwErr"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('ui.cancel')}</button>
        <button class="btn btn-primary" id="pwGo">${I18N.t('cloud.savePass')}</button>
      </div>`, 'narrow');
    UI.passwordEyes();
    document.getElementById('pwGo').onclick = async () => {
      const a = document.getElementById('pwNew').value, b = document.getElementById('pwNew2').value;
      const e = document.getElementById('pwErr');
      const fail = t => { e.textContent = t; e.classList.add('show'); };
      if (a.length < 10) return fail(I18N.t('cloud.passShort'));
      if (a !== b) return fail(I18N.t('cloud.passMismatch'));
      try {
        await Cloud.updatePassword(a);
        UI.closeModal();
        UI.toast('ok', I18N.t('cloud.passSaved'), '');
      } catch (err) { fail(err.message); }
    };
  },

  afterRedirect(r) {
    if (r.error) { UI.toast('warn', I18N.t('cloud.linkFail'), r.error); return; }
    if (!Cloud.signedIn) { this.loginForm(I18N.t('cloud.notStaff')); return; }
    if (r.type === 'recovery' || r.type === 'invite') this.passwordForm(true);
  },

  /** Indicador de guardado en la barra superior. */
  syncChip(s, err) {
    const el = document.getElementById('syncChip');
    if (!el) return;
    el.hidden = false;
    el.className = 'sync-chip sync-' + s;
    el.textContent = I18N.t('cloud.sync.' + s);
    el.title = err && err.message ? err.message : '';
  },

  /** Traduce el shell estático del HTML (data-i18n / data-i18n-aria) y la marca. */
  applyStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = I18N.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', I18N.t(el.dataset.i18nAria));
    });
    document.getElementById('langBtnLabel').textContent = I18N.lang === 'es' ? 'EN' : 'ES';

    // En la tienda pública la marca es la de la tienda, no la de la plataforma.
    const st = this.storefront ? Store.storeCfg(this.storefront) : null;
    document.getElementById('brandName').textContent = st ? st.name : Store.settings.company;
    document.getElementById('brandSub').textContent = I18N.t(st ? 'shop.official' : 'nav.brandSub');
    document.title = (st ? st.name : Store.settings.company) + ' — ' + I18N.t(st ? 'shop.official' : this.panelOnly ? 'nav.admin' : 'nav.brandSub');
    const mark = document.getElementById('brandMark');
    if (st) mark.outerHTML = UI.storeMark(st, 30).replace('class="store-mark"', 'class="store-mark brand-mark" id="brandMark"');
    if (st) document.body.style.cssText = UI.brandVars(st);
  },

  /** Mide la barra de scroll para compensarla al bloquear el fondo. */
  medirScrollbar() {
    const w = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--scrollbar-w', Math.max(0, w) + 'px');
  },

  syncUser() {
    if (Store.cloudMode && !Cloud.signedIn) {
      document.getElementById('userAvatar').innerHTML = UI.icon('user');
      document.getElementById('userName').textContent = I18N.t('cloud.staffLogin');
      return;
    }
    const u = Store.user();
    document.getElementById('userAvatar').textContent = u.initials;
    document.getElementById('userName').textContent = u.name;
  },

  /** Repinta todo lo visible tras una mutación de datos o un cambio de idioma. */
  refreshAll() {
    if (this.landing) { this.home(); return; }
    this.applyStaticI18n();
    Shop.render();
    Shop.renderCart();
    if (!this.storefront && this.adminReady) Admin.refresh();
    this.syncUser();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
