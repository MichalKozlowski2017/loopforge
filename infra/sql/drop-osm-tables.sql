-- Remove osm2pgsql data from Supabase (routing moves to BRouter).
-- Keeps loopforge schema shell + public.routes; drops OSM tables and routing graph.

truncate loopforge.ways restart identity cascade;

drop table if exists loopforge.ways_vertices_pgr cascade;
drop table if exists loopforge.ways_edges_pgr cascade;

drop table if exists public.planet_osm_point cascade;
drop table if exists public.planet_osm_line cascade;
drop table if exists public.planet_osm_polygon cascade;
drop table if exists public.planet_osm_roads cascade;
drop table if exists public.planet_osm_nodes cascade;
drop table if exists public.planet_osm_ways cascade;
drop table if exists public.planet_osm_rels cascade;
drop table if exists public.osm2pgsql_properties cascade;

update loopforge.import_status
set ways_count = 0, imported_at = null, region = null, osm_file = null
where id = 1;

select pg_size_pretty(pg_database_size(current_database())) as db_size_after;
