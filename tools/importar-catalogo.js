/* ============================================================
   Importa el catálogo público de las tiendas actuales (WooCommerce)
   y genera docs/js/catalog.js + docs/img/catalogo/.

   Uso:  node tools/importar-catalogo.js
   Las tiendas viejas se van a reemplazar: de ellas solo se rescatan
   nombres, precios, tallas y fotos. Stock y costos NO son públicos,
   se cargan aparte en el panel.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_JS = path.join(ROOT, 'docs', 'js', 'catalog.js');
const OUT_IMG = path.join(ROOT, 'docs', 'img', 'catalogo');
const SNAP = path.join(__dirname, 'catalogo-origen');

const SOURCES = {
  athletum: { name: 'Athletum FC', api: 'https://shop.athletumfc.com/wp-json/wc/store/v1/products?per_page=100', site: 'https://shop.athletumfc.com' },
  lasvegas: { name: 'Juventus Academy Las Vegas', api: 'https://jacademylasvegas.com/wp-json/wc/store/v1/products?per_page=100', site: 'https://jacademylasvegas.com/shop/' }
};

const SCALE = ['YXS', 'YS', 'YM', 'YL', 'S', 'M', 'L', 'XL', 'U'];
const SIZE_ALIAS = {
  'youth xs': 'YXS', 'youth small': 'YS', 'youth medium': 'YM', 'youth large': 'YL',
  'adult small': 'S', 'adult medium': 'M', 'adult large': 'L', 'adult xl': 'XL',
  'small': 'S', 'medium': 'M', 'large': 'L',
  'ys': 'YS', 'ym': 'YM', 'yl': 'YL', 's': 'S', 'm': 'M', 'l': 'L', 'xl': 'XL'
};

/* Cada producto de origen se asigna a una referencia propia.
   Dos productos de tiendas distintas con la MISMA clave son la misma
   referencia física: comparten inventario (usan la misma foto en origen). */
const MAP = {
  athletum: {
    7546: { key: 'ath-jer-home',     sku: 'ATH-JER-HOME',  kind: 'jersey',    cats: ['player'],               line: 'elite',       hex: '#f2f3f5' },
    7538: { key: 'ath-jer-practice', sku: 'ATH-JER-PRAC',  kind: 'jersey',    cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#e2c21a' },
    7530: { key: 'ath-jer-away',     sku: 'ATH-JER-AWAY',  kind: 'jersey',    cats: ['player'],               line: 'elite',       hex: '#16181d' },
    7522: { key: 'ath-sho-home',     sku: 'ATH-SHO-HOME',  kind: 'short',     cats: ['player'],               line: 'elite',       hex: '#f2f3f5' },
    7514: { key: 'ath-sho-away',     sku: 'ATH-SHO-AWAY',  kind: 'short',     cats: ['player'],               line: 'elite',       hex: '#16181d' },
    7642: { key: 'ath-polo',         sku: 'ATH-POLO',      kind: 'apparel',   cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#16181d' },
    7562: { key: 'ath-rain-jacket',  sku: 'ATH-RAIN',      kind: 'apparel',   cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#16181d' },
    7554: { key: 'ath-hoodie',       sku: 'ATH-HOOD',      kind: 'apparel',   cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#16181d' },
    7570: { key: 'ath-pant',         sku: 'ATH-PANT',      kind: 'apparel',   cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#16181d' },
    7578: { key: 'ath-backpack',     sku: 'ATH-BACKPACK',  kind: 'accessory', cats: ['player', 'goalkeeper'], line: 'elite',       hex: '#16181d' },
    7595: { key: 'ath-gk-jer-green', sku: 'ATH-GK-JER-GRN', kind: 'jersey',   cats: ['goalkeeper'],           line: 'elite',       hex: '#14532d' },
    7603: { key: 'ath-gk-jer-blue',  sku: 'ATH-GK-JER-BLU', kind: 'jersey',   cats: ['goalkeeper'],           line: 'elite',       hex: '#1e40af' },
    7611: { key: 'ath-gk-sho-green', sku: 'ATH-GK-SHO-GRN', kind: 'short',    cats: ['goalkeeper'],           line: 'elite',       hex: '#14532d' },
    7619: { key: 'ath-gk-sho-blue',  sku: 'ATH-GK-SHO-BLU', kind: 'short',    cats: ['goalkeeper'],           line: 'elite',       hex: '#1e40af' },
    7627: { key: 'ath-gk-soc-green', sku: 'ATH-GK-SOC-GRN', kind: 'socks',    cats: ['goalkeeper'],           line: 'elite',       hex: '#14532d' },
    7633: { key: 'ath-gk-soc-blue',  sku: 'ATH-GK-SOC-BLU', kind: 'socks',    cats: ['goalkeeper'],           line: 'elite',       hex: '#1e40af' },
    7715: { key: 'ath-jer-red',      sku: 'ATH-JER-RED',   kind: 'jersey',    cats: ['player'],               line: 'competitive', hex: '#b3261e' },
    7723: { key: 'ath-jer-blue',     sku: 'ATH-JER-BLUE',  kind: 'jersey',    cats: ['player', 'goalkeeper'], line: 'competitive', hex: '#1e40af' },
    7731: { key: 'ath-sho-white',    sku: 'ATH-SHO-WHT',   kind: 'short',     cats: ['player'],               line: 'competitive', hex: '#f2f3f5' },
    7748: { key: 'ath-gk-jer-orange', sku: 'ATH-GK-JER-ORG',  kind: 'jersey', cats: ['goalkeeper'],           line: 'competitive', hex: '#ea580c' },
    7756: { key: 'ath-gk-jer-cgreen', sku: 'ATH-GK-JER-CGRN', kind: 'jersey', cats: ['goalkeeper'],           line: 'competitive', hex: '#15803d' },
    // Compartidos con Las Vegas (misma foto en ambas tiendas)
    7494: { key: 'soc-white',        sku: 'SOC-WHT',       kind: 'socks',     cats: ['player'],               line: 'competitive', hex: '#f2f3f5' },
    7510: { key: 'soc-black',        sku: 'SOC-BLK',       kind: 'socks',     cats: ['player'],               line: 'competitive', hex: '#16181d' },
    7744: { key: 'gk-soc-orange',    sku: 'GK-SOC-ORG',    kind: 'socks',     cats: ['goalkeeper'],           line: 'competitive', hex: '#ea580c' },
    7740: { key: 'gk-soc-green',     sku: 'GK-SOC-GRN',    kind: 'socks',     cats: ['goalkeeper'],           line: 'competitive', hex: '#15803d' },
    7764: { key: 'gk-sho-orange',    sku: 'GK-SHO-ORG',    kind: 'short',     cats: ['goalkeeper'],           line: 'competitive', hex: '#ea580c' },
    7772: { key: 'gk-sho-green',     sku: 'GK-SHO-GRN',    kind: 'short',     cats: ['goalkeeper'],           line: 'competitive', hex: '#15803d' },
    // Kits
    7842: { key: 'ath-kit-competitive',    sku: 'ATH-KIT-COMP',    kind: 'kit', cats: ['player'],     line: 'competitive', hex: '#16181d',
            components: [[7530, 1], [7715, 1], [7723, 1], [7514, 1], [7731, 1], [7510, 1], [7494, 1]] },
    7826: { key: 'ath-kit-competitive-gk', sku: 'ATH-KIT-COMP-GK', kind: 'kit', cats: ['goalkeeper'], line: 'competitive', hex: '#ea580c',
            components: [[7748, 1], [7764, 1], [7744, 1], [7756, 1], [7772, 1], [7740, 1], [7723, 1]] },
    7640: { key: 'ath-kit-elite',          sku: 'ATH-KIT-ELITE',    kind: 'kit', cats: ['player'],     line: 'elite', hex: '#e2c21a',
            components: [[7538, 1], [7546, 1], [7530, 1], [7642, 1], [7522, 1], [7514, 1], [7494, 1], [7510, 1], [7562, 1], [7554, 1], [7570, 1], [7578, 1]] },
    7650: { key: 'ath-kit-elite-gk',       sku: 'ATH-KIT-ELITE-GK', kind: 'kit', cats: ['goalkeeper'], line: 'elite', hex: '#14532d',
            components: [[7595, 1], [7611, 1], [7627, 1], [7603, 1], [7619, 1], [7633, 1], [7538, 1], [7642, 1], [7562, 1], [7554, 1], [7570, 1], [7578, 1]] }
  },
  lasvegas: {
    7811: { key: 'lv-jer-official',  sku: 'LV-JER-OFFICIAL', kind: 'jersey', cats: ['player'],               line: 'competitive', hex: '#f2f3f5' },
    7800: { key: 'lv-jer-blue',      sku: 'LV-JER-BLUE',     kind: 'jersey', cats: ['player', 'goalkeeper'], line: 'competitive', hex: '#1e40af' },
    7782: { key: 'lv-jer-red',       sku: 'LV-JER-RED',      kind: 'jersey', cats: ['player'],               line: 'competitive', hex: '#b3261e' },
    7822: { key: 'lv-sho-white',     sku: 'LV-SHO-WHT',      kind: 'short',  cats: ['player'],               line: 'competitive', hex: '#f2f3f5' },
    7830: { key: 'lv-sho-black',     sku: 'LV-SHO-BLK',      kind: 'short',  cats: ['player'],               line: 'competitive', hex: '#16181d' },
    7873: { key: 'lv-gk-jer-green',  sku: 'LV-GK-JER-GRN',   kind: 'jersey', cats: ['goalkeeper'],           line: 'competitive', hex: '#15803d' },
    7853: { key: 'lv-gk-jer-orange', sku: 'LV-GK-JER-ORG',   kind: 'jersey', cats: ['goalkeeper'],           line: 'competitive', hex: '#ea580c' },
    7838: { key: 'soc-white' }, 7843: { key: 'soc-black' },
    7908: { key: 'gk-soc-orange' }, 7912: { key: 'gk-soc-green' },
    7892: { key: 'gk-sho-orange' }, 7900: { key: 'gk-sho-green' },
    7937: { key: 'lv-kit-competitive',    sku: 'LV-KIT-COMP',    kind: 'kit', cats: ['player'],     line: 'competitive', hex: '#16181d',
            components: [[7811, 1], [7782, 1], [7800, 1], [7822, 1], [7830, 1], [7838, 1], [7843, 1]] },
    7945: { key: 'lv-kit-competitive-gk', sku: 'LV-KIT-COMP-GK', kind: 'kit', cats: ['goalkeeper'], line: 'competitive', hex: '#ea580c',
            components: [[7853, 1], [7873, 1], [7800, 1], [7892, 1], [7900, 1], [7908, 1], [7912, 1]] }
  }
};

/* Nombres limpios para la tienda nueva (2026-11-06): algunos de WordPress
   vienen repetidos o en minúsculas. El nombre original queda en source[].name. */
const NAMES = {
  'ath-kit-competitive': 'Athletum Competitive Player Kit',
  'ath-kit-competitive-gk': 'Athletum Competitive GK Kit',
  'ath-kit-elite': 'Athletum Elite Player Kit 2026-27',
  'ath-kit-elite-gk': 'Athletum Elite GK Kit 2026-27',
  'ath-jer-away': 'Away Jersey',
  'ath-sho-away': 'Away Short',
  'ath-gk-jer-green': 'Green GK Jersey',
  'ath-gk-jer-blue': 'Blue GK Jersey',
  'ath-gk-sho-green': 'Green GK Short',
  'ath-gk-sho-blue': 'Blue GK Short',
  'ath-gk-soc-green': 'Green GK Socks',
  'ath-gk-soc-blue': 'Blue GK Socks',
  'ath-polo': 'Black Polo',
  'ath-gk-jer-orange': 'Competition Orange GK Jersey',
  'ath-gk-jer-cgreen': 'Competition Green GK Jersey',
  'gk-sho-orange': 'Competition Orange GK Short',
  'gk-sho-green': 'Competition Green GK Short',
  'gk-soc-orange': 'Competition Orange GK Socks',
  'gk-soc-green': 'Competition Green GK Socks',
  'lv-jer-official': 'Juventus Official Jersey',
  'lv-jer-red': 'Away Competitive Red Jersey',
  'lv-sho-white': 'Competitive White Short',
  'lv-sho-black': 'Competitive Black Short',
  'lv-gk-jer-green': 'Competition Green GK Jersey',
  'lv-gk-jer-orange': 'Competition Orange GK Jersey'
};

/* Sube cuando se cambian NAMES u otros datos a mano: el equipo los recibe al abrir el panel. */
const REVISION = 2;

const strip = s => (s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const normSize = raw => SIZE_ALIAS[String(raw).trim().toLowerCase()] || null;

async function getJSON(store) {
  const file = path.join(SNAP, store + '.json');
  try {
    const res = await fetch(SOURCES[store].api, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    fs.mkdirSync(SNAP, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
    return data;
  } catch (e) {
    if (fs.existsSync(file)) {
      console.warn(`! ${store}: sin conexión (${e.message}); se usa la copia guardada`);
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    throw e;
  }
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Cada tienda genera miniaturas de distinto tamaño; se busca siempre la de 600 px. */
function pick600(im) {
  const hit = (im.srcset || '').split(',').map(s => s.trim().split(/\s+/)).find(([, w]) => w === '600w');
  return hit ? hit[0] : (im.thumbnail || im.src);
}

const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);

(async () => {
  const products = new Map();     // key -> producto
  const report = [];

  for (const store of Object.keys(SOURCES)) {
    const data = await getJSON(store);
    const byId = new Map(data.map(p => [p.id, p]));
    const map = MAP[store];

    for (const src of data) {
      const m = map[src.id];
      if (!m) { report.push(`! ${store} #${src.id} "${src.name}" sin asignar: se omite`); continue; }

      const minor = Math.pow(10, src.prices.currency_minor_unit || 2);
      const price = Number(src.prices.price) / minor;
      const sizes = [];
      (src.attributes || []).forEach(a => (a.terms || []).forEach(t => {
        const n = normSize(t.name);
        if (n && !sizes.includes(n)) sizes.push(n);
        if (!n) report.push(`! ${store} #${src.id}: talla no reconocida "${t.name}"`);
      }));
      if (src.type === 'simple' && !sizes.length) sizes.push('U');

      const images = [];
      for (const im of (src.images || [])) {
        const url = pick600(im);
        const file = path.basename(new URL(url).pathname);
        const rel = `img/catalogo/${store}/${file}`;
        await download(url, path.join(ROOT, 'docs', rel));
        images.push(rel);
      }

      const existing = products.get(m.key);
      if (existing) {
        // Referencia compartida: se suma la tienda y se unen las tallas.
        existing.stores.push(store);
        sizes.forEach(s => { if (!existing.sizes.includes(s)) existing.sizes.push(s); });
        existing.sizes.sort((a, b) => SCALE.indexOf(a) - SCALE.indexOf(b));
        existing.source.push({ store, id: src.id, url: src.permalink, name: src.name });
        const a = path.join(ROOT, 'docs', existing.image), b = path.join(ROOT, 'docs', images[0]);
        report.push(`= compartido ${m.key}: "${existing.name}" / "${src.name}" · precio ${existing.price} vs ${price} · foto ${sha(a) === sha(b) ? 'IDÉNTICA' : 'distinta'}`);
        continue;
      }

      const p = {
        id: m.key, sku: m.sku, name: NAMES[m.key] || src.name.trim(), kind: m.kind,
        categories: m.cats, line: m.line, stores: [store],
        price, sizes: sizes.sort((a, b) => SCALE.indexOf(a) - SCALE.indexOf(b)),
        colorHex: m.hex, image: images[0] || null, images,
        description: strip(src.short_description) || strip(src.description),
        source: [{ store, id: src.id, url: src.permalink, name: src.name }]
      };

      if (m.kind === 'kit') {
        p.components = m.components.map(([sid, qty]) => {
          const cm = map[sid];
          if (!cm || !byId.has(sid)) throw new Error(`Kit ${m.key}: componente ${sid} no existe en ${store}`);
          return { productId: cm.key, qty };
        });
        delete p.sizes;
        // WooCommerce calcula al vuelo el precio de un kit compuesto y publica 0.
        const sum = m.components.reduce((s, [sid, qty]) => s + qty * Number(byId.get(sid).prices.price) / minor, 0);
        p.componentsTotal = sum;
        if (!price) { p.price = sum; report.push(`· ${m.key}: precio 0 en origen, se usa la suma de sus piezas (${sum})`); }
        else if (Math.abs(sum - price) > 0.005) report.push(`· ${m.key}: precio ${price} ≠ suma de piezas ${sum}`);
        else report.push(`· ${m.key}: precio ${price} = suma de piezas`);
      }
      products.set(m.key, p);
    }
  }

  const list = [...products.values()];
  const out = {
    importedAt: new Date().toISOString().slice(0, 10),
    revision: REVISION,
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { name: v.name, site: v.site }])),
    products: list
  };
  fs.mkdirSync(path.dirname(OUT_JS), { recursive: true });
  fs.writeFileSync(OUT_JS,
    '/* GENERADO por tools/importar-catalogo.js — no editar a mano.\n' +
    '   Catálogo real de las tiendas actuales: nombres, precios, tallas y fotos.\n' +
    '   El stock y los costos NO vienen de aquí (no son públicos). */\n' +
    'const CATALOG = ' + JSON.stringify(out, null, 2) + ';\n');

  report.forEach(r => console.log(r));
  const kits = list.filter(p => p.kind === 'kit').length;
  console.log(`\nOK · ${list.length} referencias (${kits} kits, ${list.length - kits} piezas) · ${list.filter(p => p.stores.length > 1).length} compartidas entre tiendas`);
  const imgs = fs.readdirSync(OUT_IMG, { recursive: true }).filter(f => /\.(jpe?g|png|webp)$/i.test(String(f)));
  const bytes = imgs.reduce((s, f) => s + fs.statSync(path.join(OUT_IMG, String(f))).size, 0);
  console.log(`   ${imgs.length} fotos · ${(bytes / 1024).toFixed(0)} KB`);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
