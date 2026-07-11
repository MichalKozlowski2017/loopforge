-- osm2pgsql tables must not be reachable via Supabase Data API (anon/authenticated).
-- Server-side routing uses DATABASE_URL (postgres role) — unaffected.

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'planet_osm_point',
    'planet_osm_line',
    'planet_osm_polygon',
    'planet_osm_roads',
    'planet_osm_nodes',
    'planet_osm_ways',
    'planet_osm_rels',
    'osm2pgsql_properties'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on table public.%I from anon, authenticated', tbl);
    end if;
  end loop;
end;
$$;

-- service_role bypasses RLS; explicit policy documents intent for audits
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'planet_osm_point',
    'planet_osm_line',
    'planet_osm_polygon',
    'planet_osm_roads',
    'planet_osm_nodes',
    'planet_osm_ways',
    'planet_osm_rels',
    'osm2pgsql_properties'
  ]
  loop
    if to_regclass('public.' || tbl) is not null then
      execute format(
        'drop policy if exists %I on public.%I',
        'osm_service_role_all',
        tbl
      );
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        'osm_service_role_all',
        tbl
      );
    end if;
  end loop;
end;
$$;
