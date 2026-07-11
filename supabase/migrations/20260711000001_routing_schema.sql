-- Routing graph (populated by infra/scripts/import-osm.sh)
create table loopforge.ways (
  id bigserial primary key,
  osm_id bigint,
  tags hstore not null default ''::hstore,
  geom extensions.geometry(LineString, 4326) not null,
  length_m double precision not null,
  cost_road double precision not null,
  cost_gravel double precision not null,
  cost_mtb double precision not null,
  cost_general double precision not null,
  source integer,
  target integer,
  constraint ways_geom_srid check (st_srid(geom) = 4326)
);

create index ways_geom_gix on loopforge.ways using gist (geom);
create index ways_source_idx on loopforge.ways (source);
create index ways_target_idx on loopforge.ways (target);
create index ways_tags_gix on loopforge.ways using gin (tags);

comment on table loopforge.ways is
  'Bike-routable OSM ways with precomputed costs per bike type. Built from planet_osm_line.';

create or replace function loopforge.weight_gravel(tags hstore)
returns double precision
language sql
immutable
as $$
  select greatest(
    coalesce(
      case when tags -> 'surface' = 'gravel' then 1.0 end,
      case when tags -> 'surface' = 'compacted' then 0.9 end,
      case when tags -> 'surface' = 'unpaved' then 0.7 end,
      case when tags -> 'surface' = 'dirt' then 0.6 end,
      case when tags -> 'highway' = 'track' then 0.85 end,
      case when tags -> 'highway' = 'cycleway' then 0.95 end,
      case when tags -> 'highway' = 'residential' then 0.5 end,
      case when tags -> 'highway' = 'primary' then 0.1 end,
      0.3
    ),
    0.05
  );
$$;

create or replace function loopforge.weight_road(tags hstore)
returns double precision
language sql
immutable
as $$
  select greatest(
    coalesce(
      case
        when tags -> 'highway' in ('primary', 'secondary')
          and coalesce(tags -> 'surface', 'asphalt') = 'asphalt'
        then 1.0
      end,
      case when tags -> 'highway' = 'cycleway' then 0.95 end,
      case when tags -> 'highway' = 'tertiary' then 0.8 end,
      case when tags -> 'surface' in ('gravel', 'unpaved') then 0.2 end,
      case when tags -> 'highway' = 'track' then 0.1 end,
      0.3
    ),
    0.05
  );
$$;

create or replace function loopforge.weight_mtb(tags hstore)
returns double precision
language sql
immutable
as $$
  select greatest(
    coalesce(
      case when tags -> 'highway' = 'path' then 0.95 end,
      case when tags -> 'highway' = 'track' then 0.9 end,
      case when tags -> 'surface' in ('ground', 'dirt') then 0.85 end,
      case when tags -> 'highway' = 'bridleway' then 0.7 end,
      case when tags -> 'highway' = 'primary' then 0.05 end,
      0.3
    ),
    0.05
  );
$$;

create or replace function loopforge.weight_general(tags hstore)
returns double precision
language sql
immutable
as $$
  select greatest(
    coalesce(
      case when tags -> 'highway' = 'cycleway' then 0.95 end,
      case when tags -> 'surface' = 'gravel' then 0.75 end,
      case when tags -> 'highway' = 'tertiary' then 0.7 end,
      case when tags -> 'highway' = 'residential' then 0.6 end,
      case when tags -> 'highway' = 'primary' then 0.2 end,
      case when tags -> 'highway' = 'track' then 0.5 end,
      0.3
    ),
    0.05
  );
$$;

-- Weight helper: higher = more preferred (mirrors packages/scoring weights)
create or replace function loopforge.bike_weight(tags hstore, bike_type text)
returns double precision
language sql
immutable
as $$
  select greatest(
    0.05,
    case bike_type
      when 'road' then loopforge.weight_road(tags)
      when 'gravel' then loopforge.weight_gravel(tags)
      when 'mtb' then loopforge.weight_mtb(tags)
      else loopforge.weight_general(tags)
    end
  );
$$;

-- Cost = length / weight (lower cost = preferred segment)
create or replace function loopforge.segment_cost(
  length_m double precision,
  tags hstore,
  bike_type text
)
returns double precision
language sql
immutable
as $$
  select length_m / loopforge.bike_weight(tags, bike_type);
$$;

-- Snap lat/lng to nearest routing vertex
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

grant select on loopforge.ways to postgres, service_role;
grant execute on all functions in schema loopforge to postgres, service_role;
