/* ============================================================
   SOCCER CAGE — Utilidades de interfaz
   Formato, etiquetas, toasts, modales, imagen de producto y QR.
   ============================================================ */

const UI = {

  /* ---------- Formato ---------- */
  money(n) {
    return '$' + (Number(n) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  },

  money0(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  },

  num(n) { return (Number(n) || 0).toLocaleString('en-US'); },

  /** Peso legible: onzas hasta 1 libra, luego libras con onzas. */
  weight(oz) {
    const n = Math.round((Number(oz) || 0) * 10) / 10;
    if (n < 16) return n + ' oz';
    const lb = Math.floor(n / 16), rest = Math.round((n - lb * 16) * 10) / 10;
    return lb + ' lb' + (rest ? ' ' + rest + ' oz' : '');
  },

  pct(rate) {
    const v = (Number(rate) || 0) * 100;
    return (Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + '%';
  },

  locale() { return I18N.lang === 'en' ? 'en-US' : 'es-ES'; },

  date(iso, withTime) {
    // "YYYY-MM-DD" a secas se interpreta como UTC y puede retroceder un día
    // al mostrarla en husos negativos (Miami es UTC−4/−5). Se fuerza local.
    const plain = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = plain ? new Date(iso + 'T00:00:00') : new Date(iso);
    if (isNaN(d)) return iso;
    const f = d.toLocaleDateString(UI.locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (!withTime) return f;
    return f + ' · ' + UI.time(iso);
  },

  time(iso) {
    return new Date(iso).toLocaleTimeString(UI.locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  },

  relative(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return I18N.t('time.now');
    if (min < 60) return I18N.t('time.min', { n: min });
    const h = Math.floor(min / 60);
    if (h < 24) return I18N.t('time.hours', { n: h });
    const d = Math.floor(h / 24);
    if (d < 30) return I18N.t('time.days', { n: d });
    return UI.date(iso);
  },

  /** Escapa texto antes de inyectarlo en HTML. */
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  /* ---------- Tallas, categorías y motivos ---------- */
  sizeLabel(code) { return code === 'U' ? I18N.t('size.one') : (code || '—'); },
  sizeTitle(code) { return SEED.sizeNames[code] || UI.sizeLabel(code); },

  catNames(p) { return (p.categories || []).map(c => I18N.t('cat.' + c)).join(' · '); },
  kindName(kind) { return I18N.t('kind.' + kind); },
  lineName(p) { return SEED.lines[p.line] || ''; },

  /** Motivo de un movimiento: código conocido → etiqueta; texto libre → tal cual. */
  reason(code) { return I18N.has('reason.' + code) ? I18N.t('reason.' + code) : code; },

  storeName(id) {
    const s = Store.storeCfg(id);
    return s ? s.name : id;
  },

  storeTags(p) {
    if (!p.stores || !p.stores.length) return `<span class="badge badge-neutral">${I18N.t('store.internal')}</span>`;
    return p.stores.map(id => {
      const s = Store.storeCfg(id);
      return `<span class="tag">${UI.esc(s ? s.short : id)}</span>`;
    }).join('');
  },

  /* ---------- Imagen de producto ----------
     Foto real cuando existe (catálogo importado o subida desde el panel);
     si no, se dibuja la prenda en SVG según su tipo y color. */
  mediaBg() { return 'linear-gradient(160deg, #f7f8fa, #e9ebef)'; },

  shade(hex, pct) {
    const h = (hex || '#6b7280').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const num = parseInt(full, 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const amt = Math.round(2.55 * pct);
    r = Math.min(255, Math.max(0, r + amt));
    g = Math.min(255, Math.max(0, g + amt));
    b = Math.min(255, Math.max(0, b + amt));
    return `rgb(${r},${g},${b})`;
  },

  garment(kind, hex) {
    const c = UI.esc(hex || '#6b7280');
    const dark = UI.shade(hex, -26);
    const light = UI.shade(hex, 16);

    const shapes = {
      jersey: `
        <path d="M32 18 L48 10 L58 16 L72 10 L88 18 L94 40 L82 45 L82 96 Q60 101 38 96 L38 45 L26 40 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M48 10 L60 22 L72 10 L60 16 Z" fill="${dark}" opacity=".5"/>
        <path d="M38 45 L38 96 Q49 99 60 99 L60 45 Z" fill="${light}" opacity=".28"/>`,
      short: `
        <path d="M30 26 L90 26 L94 60 Q94 88 86 92 L72 92 L60 56 L48 92 L34 92 Q26 88 26 60 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M30 26 L90 26 L91 34 L29 34 Z" fill="${dark}" opacity=".45"/>`,
      socks: `
        <path d="M40 12 L58 12 L58 62 Q58 82 72 84 L72 98 L44 98 Q38 84 38 62 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>
        <rect x="38" y="12" width="20" height="11" fill="${dark}" opacity=".5"/>
        <path d="M44 86 L72 86 L72 98 L44 98 Z" fill="${dark}" opacity=".3"/>`,
      apparel: `
        <path d="M30 18 L46 10 L60 16 L74 10 L90 18 L96 44 L84 48 L84 98 L36 98 L36 48 L24 44 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.5" stroke-linejoin="round"/>
        <rect x="57" y="16" width="6" height="82" fill="${dark}" opacity=".55"/>
        <path d="M46 10 L60 16 L74 10 L60 24 Z" fill="${dark}" opacity=".4"/>`,
      accessory: `
        <rect x="18" y="38" width="84" height="48" rx="12" fill="${c}" stroke="${dark}" stroke-width="1.5"/>
        <path d="M46 38 V30 a14 14 0 0128 0 v8" fill="none" stroke="${dark}" stroke-width="3.5"/>
        <rect x="18" y="55" width="84" height="9" fill="${dark}" opacity=".45"/>`,
      // Kit completo: camiseta, short y medias.
      kit: `
        <path d="M8 16 L21 9 L31 14 L41 9 L54 16 L58 34 L48 38 L48 72 Q31 76 14 72 L14 38 L4 34 Z"
              fill="#f2f3f5" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M24 9 L31 17 L38 9 L31 13 Z" fill="${dark}" opacity=".35"/>
        <path d="M60 46 L98 46 L100 66 Q100 82 95 85 L86 85 L79 64 L72 85 L63 85 Q58 82 58 66 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M60 46 L98 46 L99 52 L59 52 Z" fill="${dark}" opacity=".4"/>
        <path d="M100 18 L112 18 L112 56 Q112 70 120 72 L120 82 L102 82 Q99 72 99 56 Z"
              fill="${c}" stroke="${dark}" stroke-width="1.4" stroke-linejoin="round" transform="translate(-6 0)"/>
        <rect x="93" y="18" width="13" height="7" fill="${dark}" opacity=".45"/>`
    };

    return `<svg class="jersey" viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${shapes[kind] || shapes.jersey}</svg>`;
  },

  /* ---------- Identidad de cada tienda ---------- */
  /** Texto blanco o negro según lo claro que sea el color de la marca. */
  inkFor(hex) {
    const h = String(hex || '#111111').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#111111' : '#ffffff';
  },

  brandVars(st) {
    const b = /^#[0-9a-f]{6}$/i.test(st && st.brand || '') ? st.brand : '#111111';
    return `--brand:${b};--brand-ink:${UI.inkFor(b)};--brand-soft:${b}14;`;
  },

  initials(name) {
    return String(name || '').split(/\s+/).filter(w => /^[A-Za-zÁÉÍÓÚÑ0-9]/.test(w) && !/^(de|del|la|las|el|los|fc|y)$/i.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·';
  },

  /** Logo de la tienda, o sus iniciales sobre el color de la marca. */
  storeMark(st, px) {
    const size = px || 32;
    if (st.logo) return `<span class="store-mark" style="width:${size}px;height:${size}px"><img src="${UI.esc(st.logo)}" alt=""></span>`;
    const b = st.brand || '#111111';
    return `<span class="store-mark" style="width:${size}px;height:${size}px;background:${UI.esc(b)};color:${UI.inkFor(b)};font-size:${Math.round(size * 0.38)}px">${UI.esc(UI.initials(st.name))}</span>`;
  },

  icon(name) {
    const p = {
      shirt: '<path d="M20.4 6.6 16 4a4 4 0 0 1-8 0L3.6 6.6a1 1 0 0 0-.5 1.2l1 3a1 1 0 0 0 1.2.6L7 11v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-9l1.7.4a1 1 0 0 0 1.2-.6l1-3a1 1 0 0 0-.5-1.2z"/>',
      arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
      lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
      pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
      truck: '<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
      card: '<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
      user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
      label: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5"/>',
      upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
      printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      x: '<path d="M18 6L6 18M6 6l12 12"/>',
      eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
      eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><path d="M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/>'
    }[name] || '';
    return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },

  /** Foto o dibujo del producto, listo para meter en un contenedor cuadrado. */
  media(p, src) {
    const img = src || p.image;
    if (img) return `<img class="p-photo" src="${UI.esc(img)}" alt="${UI.esc(p.name)}" loading="lazy">`;
    return UI.garment(p.kind, p.colorHex);
  },

  thumb(p) {
    return `<div class="thumb thumb-media">${UI.media(p)}</div>`;
  },

  /* ---------- Etiquetas de estado ---------- */
  stockBadge(status, qty) {
    const cls = { ok: 'badge-ok', bajo: 'badge-warn', agotado: 'badge-danger', inactivo: 'badge-neutral', sincargar: 'badge-neutral' }[status] || 'badge-ok';
    const q = qty !== undefined ? ` · ${qty}` : '';
    return `<span class="badge ${cls}"><span class="dot"></span>${I18N.t('stock.' + (status in { ok: 1, bajo: 1, agotado: 1, inactivo: 1, sincargar: 1 } ? status : 'ok'))}${q}</span>`;
  },

  /** El mismo estado se nombra distinto si el pedido se envía o se entrega en mano. */
  orderStatusLabel(status, fulfillment) {
    if (fulfillment === 'pickup' && (status === 'enviado' || status === 'completado')) {
      return I18N.t('order.statusPickup.' + status);
    }
    return I18N.t('adm.orders.status.' + status);
  },

  orderBadge(status, fulfillment) {
    const cls = {
      pendiente: 'badge-warn', procesando: 'badge-info', enviado: 'badge-gold',
      completado: 'badge-ok', cancelado: 'badge-danger'
    }[status] || 'badge-neutral';
    return `<span class="badge ${cls}"><span class="dot"></span>${UI.orderStatusLabel(status, fulfillment)}</span>`;
  },

  payBadge(s) {
    const cls = { pagado: 'badge-ok', pendiente: 'badge-warn', fallido: 'badge-danger', reembolsado: 'badge-neutral' }[s] || 'badge-neutral';
    return `<span class="badge ${cls}">${I18N.has('pay.status.' + s) ? I18N.t('pay.status.' + s) : UI.esc(s)}</span>`;
  },

  fulfillBadge(f) {
    return `<span class="badge badge-neutral">${I18N.t(f === 'shipping' ? 'fulfill.shippingShort' : 'fulfill.pickupShort')}</span>`;
  },

  stockBar(qty, min) {
    const target = Math.max(min * 3, 10);
    const pct = Math.min(100, (qty / target) * 100);
    const cls = qty <= 0 ? 'danger' : (qty <= min ? 'warn' : 'ok');
    return `<div class="stock-bar"><div class="stock-fill ${cls}" style="width:${pct}%"></div></div>`;
  },

  /* ---------- Código QR (enlace público de cada tienda) ---------- */
  qr(text, px) {
    if (typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let path = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + 2} ${r + 2}h1v1h-1z`;
    const size = n + 4;
    return `<svg class="qr" viewBox="0 0 ${size} ${size}" width="${px || 180}" height="${px || 180}" role="img" aria-label="QR" shape-rendering="crispEdges">
      <rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0b0c0e"/></svg>`;
  },

  /* ---------- Toasts ---------- */
  toast(kind, title, msg) {
    const icons = {
      ok:     '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
      danger: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
      warn:   '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
      info:   '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
    };
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">${icons[kind] || icons.info}</svg>
      <div style="flex:1">
        <div class="toast-title">${UI.esc(title)}</div>
        ${msg ? `<div class="toast-msg">${UI.esc(msg)}</div>` : ''}
      </div>`;
    document.getElementById('toastZone').appendChild(el);
    const close = () => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 260);
    };
    el.onclick = close;   // un toque lo descarta
    setTimeout(close, 3800);
  },

  /* ---------- Modal ---------- */
  modal(html, size) {
    const ov = document.getElementById('modalOverlay');
    const box = document.getElementById('modalBox');
    box.className = 'modal' + (size ? ' ' + size : '');
    box.innerHTML = html;
    box.dataset.dirty = '';
    UI._escAt = 0;
    ov.classList.add('open');
    document.body.classList.add('no-scroll');
    const f = box.querySelector('[data-autofocus]');
    if (f) setTimeout(() => f.focus(), 60);
  },

  /** Repinta un modal abierto conservando el desplazamiento y el foco:
      sin esto, cada clic en una talla devolvía la ventana al inicio. */
  rerenderModal(html) {
    const box = document.getElementById('modalBox');
    const body = box.querySelector('.modal-body');
    const top = body ? body.scrollTop : 0;
    // El elemento con foco se identifica por id o por su primer atributo data-*
    // (los botones de talla no tienen id).
    const a = document.activeElement;
    let sel = '';
    if (a && box.contains(a)) {
      if (a.id) sel = '#' + a.id;
      else {
        const k = Object.keys(a.dataset || {})[0];
        if (k) sel = `[data-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${String(a.dataset[k]).replace(/"/g, '\\"')}"]`;
      }
    }
    box.innerHTML = html;
    if (sel) {
      const el = box.querySelector(sel);
      if (el) el.focus({ preventScroll: true });
    }
    // Después de enfocar: algunos navegadores desplazan igualmente al elemento.
    const nb = box.querySelector('.modal-body');
    if (nb) {
      nb.scrollTop = top;
      requestAnimationFrame(() => { nb.scrollTop = top; });
    }
  },

  closeModal() {
    const box = document.getElementById('modalBox');
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.classList.remove('no-scroll');
    box.innerHTML = '';
    box.dataset.dirty = '';
    UI._escAt = 0;
  },

  /**
   * Cierre pedido por un clic fuera o por Escape. Si el usuario ya escribió
   * algo, un clic fuera no cierra, y Escape pide pulsarse dos veces: así un
   * gesto accidental no borra un formulario a medio llenar. Los botones
   * Cancelar y X cierran siempre (llaman a closeModal directamente).
   */
  requestClose(reason) {
    if (!document.getElementById('modalOverlay').classList.contains('open')) return;
    const box = document.getElementById('modalBox');
    if (box.dataset.dirty === '1') {
      if (reason === 'overlay') {
        UI.toast('info', I18N.t('ui.unsavedTitle'), I18N.t('ui.unsavedClick'));
        return;
      }
      const now = Date.now();
      if (!UI._escAt || now - UI._escAt > 3500) {
        UI._escAt = now;
        UI.toast('info', I18N.t('ui.unsavedTitle'), I18N.t('ui.unsavedEsc'));
        return;
      }
    }
    UI.closeModal();
  },

  /** Botón de ojo en cada contraseña del modal: mostrar u ocultar lo escrito. */
  passwordEyes(root) {
    (root || document.getElementById('modalBox')).querySelectorAll('input[type="password"]').forEach(inp => {
      if (inp.parentElement.classList.contains('pw-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'pw-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pw-eye';
      const show = on => {
        inp.type = on ? 'text' : 'password';
        btn.innerHTML = UI.icon(on ? 'eyeOff' : 'eye');
        btn.setAttribute('aria-label', I18N.t(on ? 'ui.hidePassword' : 'ui.showPassword'));
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      };
      btn.onclick = () => { show(inp.type === 'password'); inp.focus({ preventScroll: true }); };
      show(false);
      wrap.appendChild(btn);
    });
  },

  closeBtn() {
    return `<button class="icon-btn" onclick="UI.closeModal()" aria-label="${I18N.t('ui.close')}"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
  },

  confirm(title, message, onYes, danger) {
    UI.modal(`
      <div class="modal-head"><h2>${UI.esc(title)}</h2></div>
      <div class="modal-body"><p style="color:var(--ink-600);line-height:1.6">${message}</p></div>
      <div class="modal-foot">
        <button class="btn" onclick="UI.closeModal()">${I18N.t('ui.cancel')}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmYes" data-autofocus>${I18N.t('ui.confirm')}</button>
      </div>`, 'narrow');
    document.getElementById('confirmYes').onclick = () => { UI.closeModal(); onYes(); };
  },

  empty(title, msg, icon) {
    return `
      <div class="empty">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round">
          ${icon || '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/>'}
        </svg>
        <h3>${UI.esc(title)}</h3>
        <p>${UI.esc(msg || '')}</p>
      </div>`;
  },

  infoIcon() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';
  },

  download(filename, text, type) {
    const blob = new Blob(['﻿' + text], { type: (type || 'text/csv') + ';charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

/* Un modal con texto escrito queda "sucio": no se cierra por accidente. */
document.addEventListener('input', e => {
  const box = document.getElementById('modalBox');
  const t = e.target;
  if (!box || !box.contains(t)) return;
  const typed = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(t.type));
  if (typed) box.dataset.dirty = '1';
});

/* Cierre de modal por clic fuera y tecla Escape */
document.addEventListener('click', e => {
  if (e.target.id === 'modalOverlay') UI.requestClose('overlay');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    UI.requestClose('esc');
    if (typeof Shop !== 'undefined') Shop.closeCart();
    document.getElementById('sidebar').classList.remove('open');
  }
});
