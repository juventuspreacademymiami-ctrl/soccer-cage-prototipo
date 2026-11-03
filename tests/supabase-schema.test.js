// Prueba del esquema de Supabase (supabase/schema.sql) en un Postgres real (PGlite).
// Simula lo que Supabase pone alrededor: los roles anon y authenticated, y auth.jwt()
// con el correo de quien inició sesión.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');

let fails = 0;
const ok = (cond, label, extra) => {
  if (!cond) fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema extensions; create extension pgcrypto schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  await db.exec(schema);
  await db.exec(schema);   // se puede ejecutar dos veces sin romper ni duplicar
  ok(true, 'el esquema se aplica y se puede volver a ejecutar');

  // Ejecuta una consulta como un rol, con el correo de la sesión.
  const as = async (role, email, sql, params = []) => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [email ? JSON.stringify({ email, role }) : '']);
    await db.exec(`set role ${role}`);
    try { return (await db.query(sql, params)).rows; }
    finally { await db.exec('reset role'); }
  };
  const fails_ = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  const admin = 'juventuspreacademymiami@gmail.com';

  console.log('\n== Acceso directo a las tablas ==');
  ok(!!(await fails_(() => as('anon', null, 'select * from public.app_state'))), 'un visitante no puede leer la tabla de estado');
  ok(!!(await fails_(() => as('authenticated', admin, 'select * from public.app_state'))), 'ni siquiera el equipo lee la tabla directo: solo por funciones');
  ok(!!(await fails_(() => as('anon', null, `insert into public.staff values ('x@y.com','x','admin')`))), 'nadie se agrega al equipo por su cuenta');

  console.log('\n== Quién puede qué ==');
  ok(!!(await fails_(() => as('anon', null, 'select public.load_state()'))), 'un visitante no puede cargar el estado completo');
  ok(!!(await fails_(() => as('authenticated', 'intruso@gmail.com', 'select public.load_state()'))), 'una cuenta que no está en el equipo tampoco');
  const me = (await as('authenticated', admin, 'select public.whoami() as w'))[0].w;
  ok(me && me.role === 'admin', 'la cuenta de la empresa es administradora', me);
  ok((await as('authenticated', 'intruso@gmail.com', 'select public.whoami() as w'))[0].w === null, 'whoami de alguien ajeno: nulo');

  console.log('\n== Guardar con control de conflictos ==');
  let st = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  ok(st.rev === 0 && st.data === null, 'arranca vacío en la revisión 0', st);
  const state = {
    version: '6:x', settings: { company: 'Soccer Cage', city: 'Miami, FL', currency: 'USD', orderNotifyEmails: 'rudy@x.com' },
    stores: [{ id: 'camps', name: 'Summer Camp', stripeAccount: 'acct_123456789' }],
    products: [
      { id: 'p1', name: 'Camp Jersey', active: true, cost: 12, minStock: 4, reorderPoint: 10, weightOz: 6, price: 25, variants: [{ id: 'p1-M', stock: 5 }] },
      { id: 'p2', name: 'Inactiva', active: false, cost: 1, price: 2, variants: [] }
    ],
    customers: [{ email: 'mama@example.com', name: 'Mamá' }],
    orders: [{ number: 'SC-1', total: 50 }]
  };
  let r = (await as('authenticated', admin, 'select public.save_state(0, $1::jsonb) as r', [JSON.stringify(state)]))[0].r;
  ok(r.ok && r.rev === 1, 'primer guardado: revisión 1', r);
  r = (await as('authenticated', admin, 'select public.save_state(0, $1::jsonb) as r', [JSON.stringify(state)]))[0].r;
  ok(!r.ok && r.conflict && r.rev === 1, 'guardar sobre una versión vieja da conflicto y no pisa', r);
  ok(!!(await fails_(() => as('authenticated', admin, `select public.save_state(1, '{"x":1}'::jsonb)`))), 'rechaza un estado sin productos');
  ok(!!(await fails_(() => as('authenticated', 'intruso@gmail.com', 'select public.save_state(1, $1::jsonb)', [JSON.stringify(state)]))), 'alguien ajeno no puede guardar');
  ok((await as('authenticated', admin, 'select public.load_state_if_newer(1) as s'))[0].s === null, 'sondeo sin cambios: nulo (barato)');

  console.log('\n== Tienda pública ==');
  const cat = (await as('anon', null, 'select public.public_catalog() as c'))[0].c;
  const p1 = cat.products[0];
  ok(cat.products.length === 1, 'solo productos activos', cat.products.map(p => p.name));
  ok(p1.cost === undefined && p1.minStock === undefined && p1.reorderPoint === undefined && p1.weightOz === undefined, 'sin costo, mínimos ni punto de reposición', Object.keys(p1));
  ok(p1.variants[0].stock === 5 && p1.price === 25, 'con precio y stock');
  ok(cat.stores[0].stripeAccount === undefined, 'sin la cuenta de Stripe de la tienda');
  ok(cat.customers === undefined && cat.orders === undefined && cat.settings.orderNotifyEmails === undefined, 'sin clientes, pedidos ni correos internos');

  console.log('\n== Equipo y copias de seguridad ==');
  ok(!!(await fails_(() => as('authenticated', 'intruso@gmail.com', 'select public.list_staff()'))), 'alguien ajeno no ve el equipo');
  let team = (await as('authenticated', admin, `select public.upsert_staff('Eduardo@SoccerCage.com', 'Eduardo', 'staff') as t`))[0].t;
  ok(team.some(m => m.email === 'eduardo@soccercage.com' && m.role === 'staff'), 'el admin agrega a Eduardo (el correo se guarda en minúsculas)', team.map(m => m.email));
  ok(((await as('authenticated', 'eduardo@soccercage.com', 'select public.load_state() as s'))[0].s.rev) === 1, 'Eduardo ya puede leer los datos');
  ok(!!(await fails_(() => as('authenticated', 'eduardo@soccercage.com', `select public.upsert_staff('otro@x.com','Otro','admin')`))), 'pero no puede agregar gente (no es admin)');
  ok(!!(await fails_(() => as('authenticated', admin, `select public.upsert_staff('${admin}', 'Soccer Cage', 'staff')`))), 'no se puede quitar el rol al último administrador');
  ok(!!(await fails_(() => as('authenticated', admin, `select public.remove_staff('${admin}')`))), 'el admin no se puede borrar a sí mismo');
  ok(!!(await fails_(() => as('authenticated', admin, `select public.upsert_staff('no-es-correo', 'X', 'staff')`))), 'rechaza un correo inválido');

  // Varios guardados: el historial guarda la versión anterior de cada uno.
  for (let i = 0; i < 3; i++) {
    const cur = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
    cur.data.settings.city = 'Ciudad ' + i;
    await as('authenticated', 'eduardo@soccercage.com', 'select public.save_state($1, $2::jsonb)', [cur.rev, JSON.stringify(cur.data)]);
  }
  const hist = (await as('authenticated', admin, 'select public.list_history() as h'))[0].h;
  ok(hist.length === 3 && hist[0].saved_by === 'eduardo@soccercage.com', 'cada guardado deja copia de la versión anterior, con quién la hizo', hist.map(h => h.rev + ':' + h.saved_by));
  const target = hist.find(h => h.rev === 1);
  r = (await as('authenticated', admin, 'select public.restore_state($1) as r', [target.id]))[0].r;
  const now = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  ok(r.ok && now.data.settings.city === 'Miami, FL' && now.updated_by === admin, 'restaurar vuelve a la versión elegida como un guardado nuevo', { rev: now.rev, city: now.data.settings.city });
  ok(!!(await fails_(() => as('authenticated', 'eduardo@soccercage.com', 'select public.restore_state(1)'))), 'solo un admin puede restaurar');

  console.log('\n== Concurrencia ==');
  const base = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  const a = (await as('authenticated', admin, 'select public.save_state($1, $2::jsonb) as r', [base.rev, JSON.stringify(base.data)]))[0].r;
  const b = (await as('authenticated', 'eduardo@soccercage.com', 'select public.save_state($1, $2::jsonb) as r', [base.rev, JSON.stringify(base.data)]))[0].r;
  ok(a.ok && !b.ok && b.conflict && b.updated_by === admin, 'dos personas guardan sobre la misma versión: la segunda recibe conflicto y sabe quién guardó', b);

  console.log('\n== Fotos (supabase/storage.sql) ==');
  // Lo mínimo del esquema de archivos de Supabase para probar las reglas.
  await db.exec(`
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id bigserial primary key, bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, delete on storage.objects to anon, authenticated;
    grant usage, select on sequence storage.objects_id_seq to anon, authenticated;
  `);
  const storageSql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'storage.sql'), 'utf8');
  await db.exec(storageSql);
  await db.exec(storageSql);
  const bucket = (await db.query(`select * from storage.buckets where id = 'fotos'`)).rows[0];
  ok(bucket && bucket.public === true && Number(bucket.file_size_limit) === 2097152, 'carpeta "fotos" pública, máximo 2 MB, se puede aplicar dos veces', bucket);
  const up = (role, email) => fails_(() => as(role, email, `insert into storage.objects (bucket_id, name) values ('fotos', 'productos/x.jpg')`));
  ok((await up('authenticated', 'eduardo@soccercage.com')) === null, 'alguien del equipo puede subir una foto');
  ok(!!(await up('authenticated', 'intruso@gmail.com')), 'una cuenta ajena no puede subir');
  ok(!!(await up('anon', null)), 'un visitante no puede subir');
  ok(!!(await fails_(() => as('authenticated', 'eduardo@soccercage.com', `insert into storage.objects (bucket_id, name) values ('otra', 'x.jpg')`))), 'ni siquiera el equipo sube a otra carpeta');

  console.log('\n== Receptor de listas (supabase/integraciones.sql) ==');
  const integ = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'integraciones.sql'), 'utf8');
  await db.exec(integ); await db.exec(integ);
  ok(true, 'el receptor se aplica y se puede volver a ejecutar');
  ok(!!(await fails_(() => as('authenticated', 'eduardo@soccercage.com', "select public.rotate_integration_key('roster')"))), 'crear la clave del script: solo administradores');
  const key = (await as('authenticated', admin, "select public.rotate_integration_key('roster') as k"))[0].k;
  ok(/^sc_[0-9a-f]{48}$/.test(key), 'el admin recibe una clave propia para el script (una sola vez)');
  ok(!!(await fails_(() => as('anon', null, "select public.import_roster('sc_mala', 'academy', '[]'::jsonb)"))), 'con una clave equivocada no entra nada');
  // Estado con un programa "academy" y una entrega ya hecha
  let cur = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  cur.data.programs = [{ id: 'academy', storeId: 'athletum' }];
  cur.data.roster = [{ id: 'r1', program: 'academy', player: 'Ana Vieja', email: 'mama@x.com', team: 'U10', role: 'player', size: 'YS', sockSize: 'S', status: 'entregado' }];
  cur.data.counters = { roster: 100 };
  await as('authenticated', admin, 'select public.save_state($1, $2::jsonb)', [cur.rev, JSON.stringify(cur.data)]);
  const rows = [
    { player: 'Leo Nuevo', email: 'Papa@X.com', team: 'U12 Red', role: 'goalkeeper', size: 'YM', sockSize: 'S', external_id: 'pm-1' },
    { player: 'Ana Vieja', email: 'mama@x.com', team: 'U10', role: 'player', size: 'YL', external_id: '' },
    { player: '', email: 'sin@nombre.com' },
    { player: 'Talla Rara', email: 'r@x.com', size: 'Adult S', external_id: 'pm-3' }
  ];
  let rr = (await as('anon', null, 'select public.import_roster($1, $2, $3::jsonb) as r', [key, 'academy', JSON.stringify(rows)]))[0].r;
  ok(rr.ok && rr.added === 2 && rr.kept === 1 && rr.skipped === 1, 'primera sincronización: agrega 2, respeta 1 entregado, salta 1 sin nombre', rr);
  let st2 = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  const leo = st2.data.roster.find(x => x.external_id === 'pm-1');
  ok(leo && leo.id === 'r101' && leo.email === 'papa@x.com' && leo.role === 'goalkeeper' && leo.status === 'pendiente' && leo.source === 'sync', 'el nuevo queda pendiente, con correo en minúsculas y como portero', leo);
  ok(st2.data.roster.find(x => x.external_id === 'pm-3').size === '', 'una talla no reconocida queda vacía para corregir a mano');
  ok(st2.data.roster.find(x => x.player === 'Ana Vieja').size === 'YS', 'lo ya entregado no se modifica');
  ok(st2.rev === cur.rev + 2 && st2.updated_by === 'sync:academy', 'el guardado del script sube la revisión y firma como sync', { rev: st2.rev, by: st2.updated_by });
  // Segunda pasada: mismo jugador con cambio de equipo; talla vacía no pisa la existente
  rr = (await as('anon', null, 'select public.import_roster($1, $2, $3::jsonb) as r', [key, 'academy', JSON.stringify([{ player: 'Leo Nuevo', email: 'papa@x.com', team: 'U12 Blue', role: 'goalkeeper', size: '', external_id: 'pm-1' }])]))[0].r;
  const st3 = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  const leo2 = st3.data.roster.find(x => x.external_id === 'pm-1');
  ok(rr.added === 0 && rr.updated === 1 && leo2.team === 'U12 Blue' && leo2.size === 'YM', 'segunda pasada: actualiza el equipo sin duplicar ni borrar la talla', { team: leo2.team, size: leo2.size });
  // Tercera pasada idéntica: nada cambia, así que no se guarda (ni revisión nueva ni copia en el historial)
  const hist3 = (await db.query('select count(*)::int as n from public.app_state_history')).rows[0].n;
  rr = (await as('anon', null, 'select public.import_roster($1, $2, $3::jsonb) as r', [key, 'academy', JSON.stringify([{ player: 'Leo Nuevo', email: 'papa@x.com', team: 'U12 Blue', role: 'goalkeeper', size: '', external_id: 'pm-1' }])]))[0].r;
  const st4 = (await as('authenticated', admin, 'select public.load_state() as s'))[0].s;
  const hist4 = (await db.query('select count(*)::int as n from public.app_state_history')).rows[0].n;
  ok(rr.updated === 0 && rr.unchanged === 1 && st4.rev === st3.rev && hist4 === hist3, 'sin cambios: no sube la revisión ni llena el historial', { rr, rev: [st3.rev, st4.rev], hist: [hist3, hist4] });
  // Un guardado del panel hecho con la revisión anterior recibe conflicto (no pisa la lista)
  const stale = (await as('authenticated', admin, 'select public.save_state($1, $2::jsonb) as r', [st2.rev, JSON.stringify(st2.data)]))[0].r;
  ok(!stale.ok && stale.conflict, 'el panel con datos viejos recibe conflicto en vez de pisar la lista sincronizada');
  ok(!!(await fails_(() => as('anon', null, 'select public.import_roster($1, $2, $3::jsonb)', [key, 'inexistente', '[]']))), 'programa desconocido: rechazado');

  await db.close();
  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
