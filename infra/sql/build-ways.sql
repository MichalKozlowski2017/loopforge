-- Build loopforge.ways from osm2pgsql planet_osm_line (run after osm2pgsql import)
-- Requires: planet_osm_line table with highway column and tags hstore

truncate loopforge.ways restart identity cascade;

insert into loopforge.ways (osm_id, tags, geom, length_m, cost_road, cost_gravel, cost_mtb, cost_general)
select
  l.osm_id,
  coalesce(l.tags, ''::hstore),
  l.way as geom,
  extensions.st_length(extensions.st_transform(l.way, 3857)) as length_m,
  loopforge.segment_cost(extensions.st_length(extensions.st_transform(l.way, 3857)), coalesce(l.tags, ''::hstore), 'road'),
  loopforge.segment_cost(extensions.st_length(extensions.st_transform(l.way, 3857)), coalesce(l.tags, ''::hstore), 'gravel'),
  loopforge.segment_cost(extensions.st_length(extensions.st_transform(l.way, 3857)), coalesce(l.tags, ''::hstore), 'mtb'),
  loopforge.segment_cost(extensions.st_length(extensions.st_transform(l.way, 3857)), coalesce(l.tags, ''::hstore), 'general')
from planet_osm_line l
where
  l.way is not null
  and extensions.st_geometrytype(l.way) = 'ST_LineString'
  and l.highway in (
    'cycleway', 'path', 'track', 'bridleway', 'footway', 'pedestrian',
    'living_street', 'residential', 'unclassified', 'tertiary', 'tertiary_link',
    'secondary', 'secondary_link', 'primary', 'primary_link', 'service', 'road', 'corridor'
  )
  and l.highway not in ('motorway', 'motorway_link', 'steps', 'proposed', 'construction')
  and coalesce(l.route, '') <> 'ferry'
  and coalesce(l.bicycle, '') not in ('no', 'dismount')
  and not (l.highway = 'footway' and coalesce(l.bicycle, '') in ('no', 'dismount'))
  and not (l.highway = 'pedestrian' and coalesce(l.bicycle, '') = 'no')
  and coalesce(l.access, '') <> 'private'
  and extensions.st_length(extensions.st_transform(l.way, 3857)) > 5;

drop table if exists loopforge.ways_vertices_pgr cascade;
drop table if exists loopforge.ways_edges_pgr cascade;

select pgr_createTopology(
  'loopforge.ways',
  0.00005,
  'geom',
  'id',
  'source',
  'target',
  clean := true
);

analyze loopforge.ways;

create or replace function loopforge.nearest_vertex(lng double precision, lat double precision)
returns bigint
language sql
stable
as $$
  select id
  from loopforge.ways_vertices_pgr
  order by the_geom operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)
  limit 1;
$$;

grant execute on function loopforge.nearest_vertex(double precision, double precision) to postgres, service_role;

insert into loopforge.import_status (id, region, osm_file, ways_count, imported_at)
values (1, 'poland', 'poland-latest.osm.pbf', (select count(*) from loopforge.ways), now())
on conflict (id) do update set
  region = excluded.region,
  osm_file = excluded.osm_file,
  ways_count = excluded.ways_count,
  imported_at = excluded.imported_at;

select count(*) as ways_count from loopforge.ways;
