-- PostGIS + pgRouting for Loopforge routing
create extension if not exists postgis with schema extensions;
create extension if not exists pgrouting with schema extensions;
create extension if not exists hstore with schema extensions;

create schema if not exists loopforge;

grant usage on schema loopforge to postgres, anon, authenticated, service_role;
