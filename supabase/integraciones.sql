-- ============================================================
-- SOCCER CAGE — Receptor de listas de jugadores (PlayMetrics, camps)
--
-- Cómo aplicarlo: Supabase → SQL Editor → pegar → Run. Requiere
-- supabase/schema.sql. Se puede volver a ejecutar sin problema.
--
-- Un script externo (Google Apps Script) manda cada hora la lista de
-- jugadores con derecho a uniforme. Entra por la función
-- import_roster, protegida con una clave propia (no la de Supabase):
--   · la clave se guarda aquí como huella (sha256), nunca en claro;
--   · la función combina la lista con los datos compartidos sin
--     pisar lo que el panel guardó: usa la misma revisión que
--     save_state, así cualquier guardado paralelo recibe "conflicto"
--     y se recarga, como hoy entre dos personas;
--   · jugadores ya entregados no se tocan; los demás se actualizan;
--   · nunca borra: si alguien deja de estar en la lista, se conserva.
-- ============================================================

create table if not exists public.integration_keys (
  name       text primary key,
  key_hash   text not null,            -- sha256 hex de la clave
  created_at timestamptz not null default now(),
  last_used  timestamptz
);
alter table public.integration_keys enable row level security;
revoke all on table public.integration_keys from public, anon, authenticated;

-- Crear o rotar la clave de una integración (solo administradores). Devuelve la clave UNA sola vez.
create or replace function public.rotate_integration_key(p_name text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare k text;
begin
  perform public.require_admin();
  k := 'sc_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.integration_keys (name, key_hash) values (p_name, encode(extensions.digest(k, 'sha256'), 'hex'))
  on conflict (name) do update set key_hash = excluded.key_hash, created_at = now();
  return k;
end $$;

create or replace function public.check_integration_key(p_name text, p_key text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare ok boolean;
begin
  select (k.key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex')) into ok
  from public.integration_keys k where k.name = p_name;
  if coalesce(ok, false) then update public.integration_keys set last_used = now() where name = p_name; end if;
  return coalesce(ok, false);
end $$;

-- p_rows: [{ "player": "...", "email": "...", "team": "...", "role": "player|goalkeeper",
--            "size": "YM", "sockSize": "S", "external_id": "pm-9332148" }, ...]
-- Identidad de cada jugador dentro del programa: external_id si viene; si no, nombre + correo.
create or replace function public.import_roster(p_key text, p_program text, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  st public.app_state;
  roster jsonb;
  row_in jsonb;
  existing jsonb;
  idx int;
  added int := 0; updated int := 0; kept int := 0; skipped int := 0;
  counters jsonb;
  next_n int;
  ident text;
  sizes text[] := array['YXS','YS','YM','YL','S','M','L','XL'];
begin
  if not public.check_integration_key('roster', p_key) then raise exception 'invalid_key' using errcode = '42501'; end if;
  if coalesce(jsonb_typeof(p_rows), '') <> 'array' then raise exception 'invalid_rows' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too_many_rows' using errcode = '22023'; end if;

  select * into st from public.app_state where id = 1 for update;
  if st.data is null then raise exception 'no_state' using errcode = 'P0002'; end if;
  if not exists (select 1 from jsonb_array_elements(st.data -> 'programs') pr where pr ->> 'id' = p_program) then
    raise exception 'unknown_program' using errcode = '22023';
  end if;

  roster := coalesce(st.data -> 'roster', '[]'::jsonb);
  counters := coalesce(st.data -> 'counters', '{}'::jsonb);
  next_n := coalesce((counters ->> 'roster')::int, 100);

  for row_in in select * from jsonb_array_elements(p_rows) loop
    if coalesce(trim(row_in ->> 'player'), '') = '' then skipped := skipped + 1; continue; end if;
    ident := coalesce(nullif(row_in ->> 'external_id', ''), lower(trim(row_in ->> 'player')) || '|' || lower(coalesce(row_in ->> 'email', '')));

    select e.value, e.ordinality - 1 into existing, idx
    from jsonb_array_elements(roster) with ordinality e
    where e.value ->> 'program' = p_program
      and coalesce(nullif(e.value ->> 'external_id', ''), lower(trim(e.value ->> 'player')) || '|' || lower(coalesce(e.value ->> 'email', ''))) = ident
    limit 1;

    if existing is null then
      next_n := next_n + 1;
      roster := roster || jsonb_build_array(jsonb_build_object(
        'id', 'r' || next_n, 'program', p_program, 'status', 'pendiente',
        'player', trim(row_in ->> 'player'), 'email', lower(coalesce(row_in ->> 'email', '')),
        'team', coalesce(row_in ->> 'team', ''), 'role', case when row_in ->> 'role' = 'goalkeeper' then 'goalkeeper' else 'player' end,
        'size', case when (row_in ->> 'size') = any(sizes) then row_in ->> 'size' else '' end,
        'sockSize', case when (row_in ->> 'sockSize') = any(sizes) then row_in ->> 'sockSize' else '' end,
        'external_id', coalesce(row_in ->> 'external_id', ''), 'source', 'sync', 'syncedAt', now()));
      added := added + 1;
    elsif existing ->> 'status' = 'pendiente' then
      -- Se actualiza lo que viene; una talla puesta a mano en el panel no se pisa con una vacía.
      roster := jsonb_set(roster, array[idx::text], existing || jsonb_build_object(
        'player', trim(row_in ->> 'player'), 'email', lower(coalesce(row_in ->> 'email', existing ->> 'email')),
        'team', coalesce(nullif(row_in ->> 'team', ''), existing ->> 'team'),
        'role', case when row_in ->> 'role' = 'goalkeeper' then 'goalkeeper' else 'player' end,
        'size', case when (row_in ->> 'size') = any(sizes) then row_in ->> 'size' else coalesce(existing ->> 'size', '') end,
        'sockSize', case when (row_in ->> 'sockSize') = any(sizes) then row_in ->> 'sockSize' else coalesce(existing ->> 'sockSize', '') end,
        'external_id', coalesce(nullif(row_in ->> 'external_id', ''), existing ->> 'external_id', ''), 'syncedAt', now()));
      updated := updated + 1;
    else
      kept := kept + 1;   -- ya entregado: no se toca
    end if;
  end loop;

  if added > 0 or updated > 0 then
    counters := counters || jsonb_build_object('roster', next_n);
    insert into public.app_state_history (rev, data, saved_by) values (st.rev, st.data, st.updated_by);
    delete from public.app_state_history h where h.id in (select x.id from public.app_state_history x order by x.id desc offset 100);
    update public.app_state
       set rev = st.rev + 1,
           data = st.data || jsonb_build_object('roster', roster, 'counters', counters),
           updated_at = now(), updated_by = 'sync:' || p_program
     where id = 1;
  end if;
  return jsonb_build_object('ok', true, 'added', added, 'updated', updated, 'kept', kept, 'skipped', skipped, 'rev', st.rev + (case when added > 0 or updated > 0 then 1 else 0 end));
end $$;

revoke execute on function public.rotate_integration_key(text), public.check_integration_key(text, text), public.import_roster(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rotate_integration_key(text) to authenticated;
grant execute on function public.import_roster(text, text, jsonb) to anon, authenticated;   -- la protege su propia clave
