/* ============================================================
   SOCCER CAGE — Datos base del prototipo

   MODELO
   · Un solo inventario central, tres tiendas que lo consumen.
   · Producto → variantes por talla. El STOCK VIVE EN LA VARIANTE.
   · Un KIT no tiene stock propio: es una lista de piezas. Venderlo
     descuenta cada pieza en la talla elegida.

   QUÉ ES REAL Y QUÉ ES DE EJEMPLO
   · Real (importado de las tiendas actuales, ver catalog.js):
     nombres, precios, tallas, fotos y composición de los kits de
     Athletum y Las Vegas.
   · De ejemplo: cantidades en stock, costos, clientes, pedidos y
     los productos de campamento (modelo y precios por definir).
   ============================================================ */

const SEED = {};

/* ---------- Tiendas (canales de venta sobre el mismo inventario) ---------- */
/* Cada tienda tiene identidad propia (color, logo) y puede cobrar con su
   propia cuenta de Stripe, como los campamentos en la plataforma actual.
   Entrega (reunión 05-10): todo sale por USPS; solo en el campamento,
   quien compra allí mismo puede recibirlo en mano. */
SEED.stores = [
  {
    id: 'camps', name: 'Juventus Summer Camps', short: 'Summer Camps', phase: 1, active: true,
    kitRequired: true, taxRate: 0.07,
    pickup: true, shipping: true, shippingFlat: 9.00,
    brand: '#FF2850', logo: 'img/marcas/camps-marca.svg', stripeAccount: '', source: null
  },
  {
    id: 'athletum', name: 'Athletum FC', short: 'Athletum', phase: 2, active: false,
    kitRequired: true, taxRate: 0.07,
    pickup: false, shipping: true, shippingFlat: 9.00,
    brand: '#F9C349', logo: 'img/marcas/athletum-escudo.png', stripeAccount: '', source: 'https://shop.athletumfc.com'
  },
  {
    id: 'lasvegas', name: 'Juventus Academy Las Vegas', short: 'Las Vegas', phase: 3, active: false,
    kitRequired: true, taxRate: 0.07,
    pickup: false, shipping: true, shippingFlat: 9.00,
    brand: '#0b0b0c', logo: 'img/marcas/lasvegas-redondo.png', stripeAccount: '', source: 'https://jacademylasvegas.com/shop/'
  }
];

SEED.brandPalette = ['#111111', '#FF2850', '#F9C349', '#A87A2D', '#e8174b', '#c8102e', '#1e40af', '#0f7b52', '#c9a227', '#6d28d9', '#ea580c'];

/* ---------- Catálogos ---------- */
// Las etiquetas visibles salen de I18N ('cat.player', 'kind.jersey'…).
SEED.categories = ['player', 'goalkeeper', 'accessories'];
SEED.kinds = ['kit', 'jersey', 'short', 'socks', 'apparel', 'accessory'];

/* Peso aproximado por prenda en onzas, para calcular la etiqueta de USPS.
   Cada producto puede tener su propio peso; si no, se usa este. */
SEED.kindWeightOz = { jersey: 6, short: 5, socks: 3, apparel: 14, accessory: 10 };
SEED.lines = { camp: 'Summer Camp 2026', elite: 'Elite 2026-27', competitive: 'Competitive' };

SEED.sizeScale = ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L', 'XL', 'U'];
SEED.sizeNames = {
  YXS: 'Youth XS', YS: 'Youth S', YM: 'Youth M', YL: 'Youth L',
  S: 'Adult S', M: 'Adult M', L: 'Adult L', XL: 'Adult XL', U: ''
};
SEED.sizeSets = {
  apparel: ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L', 'XL'],
  socks: ['S', 'M', 'L'],
  one: ['U']
};
// Sugerencia de talla de medias a partir de la talla de ropa (el cliente puede cambiarla).
SEED.sockFor = { YXS: 'S', YS: 'S', YM: 'S', YL: 'M', S: 'M', M: 'L', L: 'L', XL: 'L' };

/* Usuarios del panel */
SEED.users = [
  { id: 'u1',  name: 'Eduardo',     role: 'admin',     initials: 'ED' },
  { id: 'u2',  name: 'David',       role: 'marketing', initials: 'DA' },
  { id: 'u3',  name: 'Staff Camps', role: 'delivery',  initials: 'SC' },
  { id: 'sys', name: 'Sistema',     role: 'system',    initials: 'SY' }
];

/* Motivos de movimiento. En el libro se guarda el código; la etiqueta sale de I18N. */
SEED.reasons = {
  entrada: ['purchase', 'initial', 'return', 'count', 'fix'],
  salida:  ['damage', 'courtesy', 'count', 'loss', 'fix']
};

/* ---------- Productos de campamento ----------
   Eduardo: el kit de campamento es 1 short + 1 medias + 1 camisa, y se
   venden las mismas piezas sueltas. El modelo de este año está en
   definición y la base de precios llega aparte: salvo los $50 del kit
   (precio del año pasado), los precios de las piezas son provisionales. */
SEED.campProducts = [
  {
    id: 'camp-kit', sku: 'CAMP-KIT', name: 'Summer Camp Kit', kind: 'kit',
    categories: ['player'], line: 'camp', stores: ['camps'],
    price: 50, colorHex: '#16181d', image: null, images: [], featured: true,
    description: 'Everything your player needs for summer camp: jersey, short and socks. Required on the first purchase.',
    components: [
      { productId: 'camp-jersey', qty: 1 },
      { productId: 'camp-short',  qty: 1 },
      { productId: 'camp-socks',  qty: 1 }
    ]
  },
  {
    id: 'camp-jersey', sku: 'CAMP-JER', name: 'Camp Jersey', kind: 'jersey',
    categories: ['player'], line: 'camp', stores: ['camps'],
    price: 25, sizes: ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L'],
    colorHex: '#f2f3f5', image: null, images: [], provisional: true,
    description: 'Official camp jersey. Buy an extra one or replace a lost one.'
  },
  {
    id: 'camp-short', sku: 'CAMP-SHO', name: 'Camp Short', kind: 'short',
    categories: ['player'], line: 'camp', stores: ['camps'],
    price: 20, sizes: ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L'],
    colorHex: '#16181d', image: null, images: [], provisional: true,
    description: 'Official camp short.'
  },
  {
    id: 'camp-socks', sku: 'CAMP-SOC', name: 'Camp Socks', kind: 'socks',
    categories: ['player'], line: 'camp', stores: ['camps'],
    price: 12, sizes: ['S', 'M', 'L'],
    colorHex: '#16181d', image: null, images: [], provisional: true,
    description: 'Official camp socks.'
  },
  {
    // No se vende: la inscripción a la clínica incluye la camiseta.
    id: 'clinic-jersey', sku: 'CLINIC-JER', name: 'ID Camp Jersey', kind: 'jersey',
    categories: ['player'], line: 'camp', stores: [],
    price: 0, sizes: ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L'],
    colorHex: '#c9a227', image: null, images: [], internal: true,
    description: 'Included with the ID Camp registration. Not for sale: handed out from the roster.'
  }
];

/* ---------- Stock y costos de demostración ---------- */
SEED.demoStock = function (id, size, kind, boost) {
  let h = 2166136261;
  const s = id + ':' + size;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const r = ((h >>> 0) % 1000) / 1000;
  const curve = { YXS: .5, YS: .8, YM: 1, YL: 1, S: .8, M: .6, L: .45, XL: .3, U: 1 }[size] || 1;
  const base = { socks: 26, apparel: 9, accessory: 14 }[kind] || 16;
  return Math.max(1, Math.round(base * curve * (0.55 + r * 0.9) * (boost || 1)));
};

// Casos puestos a propósito para que la demo muestre alertas y bloqueos de venta.
SEED.stockOverrides = {
  'camp-short:YXS': 0, 'camp-jersey:L': 2, 'clinic-jersey:YM': 3,
  'ath-jer-red:YL': 0, 'ath-backpack:U': 2, 'ath-hoodie:YS': 0,
  'soc-black:M': 3, 'gk-soc-orange:S': 0, 'lv-jer-official:S': 0, 'lv-sho-black:YM': 2
};

SEED.minStockFor = { socks: 6, apparel: 2, accessory: 3 };

SEED.buildProducts = function () {
  const fromCatalog = (typeof CATALOG !== 'undefined' ? CATALOG.products : []).map(p => JSON.parse(JSON.stringify(p)));
  const all = SEED.campProducts.map(p => JSON.parse(JSON.stringify(p))).concat(fromCatalog);

  return all.map(p => {
    const boost = p.line === 'camp' ? 2.4 : 1;
    const out = Object.assign({
      active: true, featured: false, images: [], image: null,
      cost: p.kind === 'kit' ? 0 : Math.round(p.price * 0.55 * 100) / 100,
      minStock: p.kind === 'kit' ? 0 : (SEED.minStockFor[p.kind] || 4)
    }, p);
    if (p.internal) out.cost = 6.5;

    out.variants = (p.kind === 'kit' ? [] : p.sizes).map(size => {
      const key = p.id + ':' + size;
      const stock = key in SEED.stockOverrides ? SEED.stockOverrides[key] : SEED.demoStock(p.id, size, p.kind, boost);
      return { id: p.id + '-' + size, sku: p.sku + (size === 'U' ? '' : '-' + size), size, stock, reserved: 0 };
    });
    delete out.sizes;
    return out;
  });
};

/* ---------- Programas de entrega (salidas que NO son venta) ----------
   · Academia: el uniforme no se compra; se entrega según la talla que
     cada jugador reporta en PlayMetrics.
   · Clínica: la inscripción incluye una camiseta.
   Ambos descuentan del mismo inventario que las tiendas. */
SEED.programs = [
  {
    id: 'academy', storeId: 'athletum', grantsKit: true, source: 'PlayMetrics',
    packages: { player: 'ath-kit-competitive', goalkeeper: 'ath-kit-competitive-gk' }
  },
  {
    id: 'clinic', storeId: 'camps', grantsKit: false, source: 'Inscripciones',
    packages: { player: 'clinic-jersey', goalkeeper: 'clinic-jersey' }
  }
];

/* Lista de jugadores. Las 12 primeras inscripciones de la clínica se
   hicieron antes de que el formulario pidiera la talla del jersey:
   llegan sin talla y hay que completarla antes de entregar. */
SEED.roster = [
  // Academia (Athletum) — origen PlayMetrics
  { id: 'r1',  program: 'academy', player: 'Mateo Gómez',     email: 'laura.gomez@example.com',    team: 'U10 Blue',  role: 'player',     size: 'YM', sockSize: 'S' },
  { id: 'r2',  program: 'academy', player: 'Lucas Torres',    email: 'michael.torres@example.com', team: 'U10 Blue',  role: 'player',     size: 'YM', sockSize: 'S' },
  { id: 'r3',  program: 'academy', player: 'Emma Ruiz',       email: 'ana.ruiz@example.com',       team: 'U12 Red',   role: 'player',     size: 'YL', sockSize: 'M' },
  { id: 'r4',  program: 'academy', player: 'Noah Carter',     email: 'james.carter@example.com',   team: 'U12 Red',   role: 'goalkeeper', size: 'YL', sockSize: 'M' },
  { id: 'r5',  program: 'academy', player: 'Valentina Herrera', email: 'sofia.herrera@example.com', team: 'U12 Red',  role: 'player',     size: 'YL', sockSize: 'M' },
  { id: 'r6',  program: 'academy', player: 'Ethan Kim',       email: 'daniel.kim@example.com',     team: 'U14 Black', role: 'player',     size: 'S',  sockSize: 'M' },
  { id: 'r7',  program: 'academy', player: 'Santiago Molina', email: 'paula.molina@example.com',   team: 'U14 Black', role: 'player',     size: 'S',  sockSize: 'M' },
  { id: 'r8',  program: 'academy', player: 'Liam Brooks',     email: 'sarah.brooks@example.com',   team: 'U14 Black', role: 'goalkeeper', size: 'M',  sockSize: 'L' },
  { id: 'r9',  program: 'academy', player: 'Isabella Peña',   email: 'carlos.pena@example.com',    team: 'U10 Blue',  role: 'player',     size: 'YS', sockSize: 'S' },
  { id: 'r10', program: 'academy', player: 'Oliver Reyes',    email: 'marta.reyes@example.com',    team: 'U12 Red',   role: 'player',     size: 'YL', sockSize: 'M' },

  // ID Camp (clínica): 12 inscripciones sin talla + 3 posteriores con talla
  { id: 'r11', program: 'clinic', player: 'Diego Vargas',     email: 'elena.vargas@example.com',   team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r12', program: 'clinic', player: 'Mia Johnson',      email: 'kate.johnson@example.com',   team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r13', program: 'clinic', player: 'Thiago Silva',     email: 'renata.silva@example.com',   team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r14', program: 'clinic', player: 'Ava Miller',       email: 'tom.miller@example.com',     team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r15', program: 'clinic', player: 'Samuel Ortiz',     email: 'lucia.ortiz@example.com',    team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r16', program: 'clinic', player: 'Chloe Davis',      email: 'mark.davis@example.com',     team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r17', program: 'clinic', player: 'Nicolás Castro',   email: 'andrea.castro@example.com',  team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r18', program: 'clinic', player: 'Zoe Wilson',       email: 'amy.wilson@example.com',     team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r19', program: 'clinic', player: 'Emilio Navarro',   email: 'jorge.navarro@example.com',  team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r20', program: 'clinic', player: 'Lily Anderson',    email: 'beth.anderson@example.com',  team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r21', program: 'clinic', player: 'Martín Rojas',     email: 'diana.rojas@example.com',    team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r22', program: 'clinic', player: 'Ella Thompson',    email: 'ryan.thompson@example.com',  team: 'ID Camp · Session 1', role: 'player', size: '', sockSize: '' },
  { id: 'r23', program: 'clinic', player: 'Gabriel Mendoza',  email: 'laura.gomez@example.com',    team: 'ID Camp · Session 2', role: 'player', size: 'YM', sockSize: '' },
  { id: 'r24', program: 'clinic', player: 'Sophia Clark',     email: 'nina.clark@example.com',     team: 'ID Camp · Session 2', role: 'player', size: 'YL', sockSize: '' },
  { id: 'r25', program: 'clinic', player: 'Adrián Fuentes',   email: 'rosa.fuentes@example.com',   team: 'ID Camp · Session 2', role: 'player', size: 'YS', sockSize: '' }
];

/* ---------- Fechas relativas: la demo siempre se ve "de esta semana" ---------- */
SEED.ago = function (days, h, m) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(h == null ? 10 : h, m || 0, 0, 0);
  if (d.getTime() > Date.now()) return new Date(Date.now() - 25 * 60000).toISOString();
  return d.toISOString();
};

/* ---------- Historial de demostración ----------
   En vez de escribir pedidos y movimientos a mano, se "reproduce" una
   semana de operación usando las mismas funciones que usa la plataforma.
   Así el stock, los pedidos y el libro de movimientos cuadran siempre. */
SEED.history = function (S) {
  const at = (d, h, m) => { S._clock = SEED.ago(d, h, m); };
  const variant = (pid, size) => S.variantOf(pid, size).id;

  // Carga inicial de inventario
  at(12, 9, 0);
  // La demo simula una tienda en marcha: todas las tallas ya tuvieron inventario.
  S.products.forEach(p => p.variants.forEach(v => {
    v.loaded = true;
    const q = v.stock;
    if (!q) return;
    v.stock = 0;
    S.applyMovement({ variantId: v.id, type: 'entrada', qty: q, reason: 'initial', ref: 'INV-INICIAL', user: 'Eduardo' });
  }));

  const buy = (who, lines, opts, d, h, m) => {
    at(d, h, m);
    S.setStore('camps');
    S.clearCart();
    lines.forEach(l => {
      if (l.kit) {
        S.addKit('camp-kit', [
          { productId: 'camp-jersey', variantId: variant('camp-jersey', l.kit[0]) },
          { productId: 'camp-short',  variantId: variant('camp-short',  l.kit[0]) },
          { productId: 'camp-socks',  variantId: variant('camp-socks',  l.kit[1]) }
        ], 1, l.player);
      } else {
        S.addItem(l.item[0], variant(l.item[0], l.item[1]), l.qty || 1);
      }
    });
    const r = S.placeOrder(Object.assign({ name: who[0], email: who[1], phone: who[2], paymentMethod: 'Stripe · Visa ···4242' }, opts));
    if (!r.ok) console.warn('Historial de demo: pedido no creado →', r.error);
    return r.order;
  };

  const pickup = { fulfillment: 'pickup' };
  const ship = (line, city, zip) => ({ fulfillment: 'shipping', address: { line, city, state: 'FL', zip } });

  const laura   = ['Laura Gómez',    'laura.gomez@example.com',    '(305) 555-0142'];
  const michael = ['Michael Torres', 'michael.torres@example.com', '(786) 555-0198'];
  const ana     = ['Ana Ruiz',       'ana.ruiz@example.com',       '(305) 555-0177'];
  const james   = ['James Carter',   'james.carter@example.com',   '(954) 555-0163'];
  const sofia   = ['Sofía Herrera',  'sofia.herrera@example.com',  '(305) 555-0121'];
  const daniel  = ['Daniel Kim',     'daniel.kim@example.com',     '(786) 555-0155'];

  const kid = (name, birthYear, team) => ({ name, birthYear, team });

  let o;
  o = buy(laura, [{ kit: ['YM', 'S'], player: kid('Mateo Gómez', 2016, 'U10 Blue') }], pickup, 6, 9, 14);
  at(6, 15, 0); S.setOrderStatus(o.id, 'procesando'); S.setOrderStatus(o.id, 'enviado');
  at(5, 8, 30); S.setOrderStatus(o.id, 'completado');

  o = buy(michael, [
    { kit: ['YS', 'S'], player: kid('Lucas Torres', 2017, 'U9 White') },
    { kit: ['YL', 'M'], player: kid('Nico Torres', 2014, 'U12 Red') },
    { item: ['camp-socks', 'S'], qty: 2 }
  ], ship('8421 SW 124th Ave', 'Miami', '33183'), 5, 11, 2);
  at(4, 10, 0); S.createLabels([o.id]);

  o = buy(james, [{ kit: ['YL', 'M'], player: kid('Noah Carter', 2014, 'U12 Red') }], pickup, 4, 16, 40);
  at(3, 9, 0); S.setOrderStatus(o.id, 'cancelado');

  o = buy(ana, [{ kit: ['YL', 'M'], player: kid('Emma Ruiz', 2014, 'U12 Red') }], pickup, 2, 13, 25);
  at(2, 17, 0); S.setOrderStatus(o.id, 'procesando');

  // Segunda compra de Laura: ya tiene el kit, compra solo una camiseta extra.
  buy(laura, [{ item: ['camp-jersey', 'YM'] }], pickup, 1, 18, 5);

  // Pedidos con envío pendientes: aparecen en "Envíos" listos para la etiqueta.
  buy(['Kevin Brown', 'kevin.brown@example.com', '(407) 555-0110'],
      [{ kit: ['YS', 'S'], player: kid('Leo Brown', 2017, 'U9 Blue') }],
      ship('77 Lake Ave', 'Orlando', '32801'), 1, 11, 30);
  buy(sofia, [{ kit: ['S', 'M'], player: kid('Valentina Herrera', 2012, 'U14 Black') }, { item: ['camp-short', 'S'] }],
      ship('1200 Brickell Ave, Apt 804', 'Miami', '33131'), 0, 9, 40);

  // Entregas de academia y clínica (no son ventas)
  S.state.currentUser = 'u3';
  at(3, 16, 30); ['r1', 'r2', 'r6'].forEach(id => S.deliver(id));
  at(1, 16, 45); S.deliver('r4');
  at(1, 17, 10); ['r23', 'r24'].forEach(id => S.deliver(id));

  // Ajustes manuales
  S.state.currentUser = 'u1';
  at(2, 12, 0);
  S.applyMovement({ variantId: variant('camp-jersey', 'YS'), type: 'salida', qty: 2, reason: 'damage', ref: 'AJ-0001' });

  // Compras a proveedor: una recibida completa, una a medias y una en camino.
  const po = (supplier, pid, qtys, extra) => S.createPurchase(Object.assign({
    supplier, lines: Object.entries(qtys).map(([size, qty]) => ({ variantId: variant(pid, size), qty }))
  }, extra || {})).purchase;
  const supplier = 'Proveedor de uniformes (demo)';
  at(10, 10, 0);
  const po1 = po(supplier, 'camp-jersey', { YXS: 10, YS: 20, YM: 25, YL: 20, S: 15, M: 10 }, { note: 'Temporada Summer Camp 2026' });
  at(8, 14, 0);
  S.receivePurchase(po1.id, Object.fromEntries(po1.lines.map(l => [l.variantId, l.qty])));
  at(4, 9, 0);
  const po2 = po(supplier, 'camp-socks', { S: 20, M: 24, L: 16 });
  at(1, 9, 20);
  S.receivePurchase(po2.id, { [variant('camp-socks', 'M')]: 24 });
  at(1, 11, 0);
  po(supplier, 'camp-short', { YS: 15, YM: 15, YL: 10, S: 10 }, { expected: S.dayKey(new Date(Date.now() + 6 * 864e5)) });

  // Daniel creó su cuenta pero aún no ha comprado.
  at(1, 20, 0);
  S.signIn({ name: daniel[0], email: daniel[1], phone: daniel[2] });

  S._clock = null;
  S.state.session = null;
  S.state.currentUser = 'u1';
  S.setStore('camps');
  S.clearCart();
};
