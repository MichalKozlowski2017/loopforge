"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { RouteFeature, RouteMapGeoJson } from "@loopforge/osm-types";
import { loadMapStyle } from "@/lib/map-style";

export interface StartPoint {
  lat: number;
  lng: number;
}

interface MapViewProps {
  center: [number, number];
  start: StartPoint;
  loopEntry?: StartPoint | null;
  route?: RouteFeature | null;
  mapGeojson?: RouteMapGeoJson | null;
  pickStart?: boolean;
  onStartChange?: (start: StartPoint) => void;
}

const ROUTE_SOURCE = "route";
const ROUTE_LAYER = "route-line";
const SEGMENTS_SOURCE = "route-segments";
const SEGMENTS_LAYER = "route-segments-line";

function normalizeCoords(coords: number[][]): [number, number][] {
  return coords
    .map((coord) => [coord[0], coord[1]] as [number, number])
    .filter(
      ([lng, lat]) =>
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        Math.abs(lat) <= 90 &&
        !(lng === 0 && lat === 0),
    );
}

function normalizeRoute(route: RouteFeature): RouteFeature {
  return {
    ...route,
    geometry: {
      ...route.geometry,
      coordinates: normalizeCoords(route.geometry.coordinates),
    },
  };
}

function normalizeMapGeojson(mapGeojson: RouteMapGeoJson): RouteMapGeoJson {
  return {
    type: "FeatureCollection",
    features: mapGeojson.features
      .map((feature) => ({
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: normalizeCoords(feature.geometry.coordinates),
        },
      }))
      .filter((feature) => feature.geometry.coordinates.length >= 2),
  };
}

function fitToCoordinates(
  map: maplibregl.Map,
  coords: [number, number][],
): void {
  const valid = normalizeCoords(coords);
  if (valid.length === 0) return;
  const bounds = valid.reduce(
    (b, coord) => b.extend(coord),
    new maplibregl.LngLatBounds(valid[0], valid[0]),
  );
  map.fitBounds(bounds, { padding: 48, maxZoom: 13 });
}

export function MapView({
  center,
  start,
  loopEntry = null,
  route,
  mapGeojson,
  pickStart = false,
  onStartChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const loopEntryMarkerRef = useRef<maplibregl.Marker | null>(null);
  const onStartChangeRef = useRef(onStartChange);
  const routeHandlersRef = useRef<{
    enter?: () => void;
    leave?: () => void;
    move?: (event: maplibregl.MapLayerMouseEvent) => void;
  }>({});
  const routeDataRef = useRef({ route, mapGeojson, pickStart });

  const [mapReady, setMapReady] = useState(false);
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);

  onStartChangeRef.current = onStartChange;
  routeDataRef.current = { route, mapGeojson, pickStart };

  useEffect(() => {
    let cancelled = false;
    loadMapStyle().then((style) => {
      if (!cancelled) setMapStyle(style);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearRouteLayers = useCallback((map: maplibregl.Map) => {
    const prev = routeHandlersRef.current;
    if (prev.enter && map.getLayer(SEGMENTS_LAYER)) {
      map.off("mouseenter", SEGMENTS_LAYER, prev.enter);
      map.off("mouseleave", SEGMENTS_LAYER, prev.leave!);
      map.off("mousemove", SEGMENTS_LAYER, prev.move!);
    }
    routeHandlersRef.current = {};

    if (map.getLayer(SEGMENTS_LAYER)) map.removeLayer(SEGMENTS_LAYER);
    if (map.getSource(SEGMENTS_SOURCE)) map.removeSource(SEGMENTS_SOURCE);
    if (map.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
    if (map.getSource(ROUTE_SOURCE)) map.removeSource(ROUTE_SOURCE);
  }, []);

  const syncRouteLayers = useCallback((): boolean => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return false;

    const {
      route: routeData,
      mapGeojson: segmentData,
      pickStart: picking,
    } = routeDataRef.current;

    clearRouteLayers(map);

    const normalizedRoute = routeData ? normalizeRoute(routeData) : null;
    const normalizedSegments =
      segmentData?.features.length ? normalizeMapGeojson(segmentData) : null;

    if (
      !normalizedRoute?.geometry.coordinates.length &&
      !normalizedSegments?.features.length
    ) {
      return true;
    }

    if (normalizedRoute?.geometry.coordinates.length) {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: normalizedRoute,
      });

      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": "#0f766e",
          "line-width": 6,
          "line-opacity": 0.35,
        },
      });
    }

    if (normalizedSegments?.features.length) {
      map.addSource(SEGMENTS_SOURCE, {
        type: "geojson",
        data: normalizedSegments,
      });

      map.addLayer({
        id: SEGMENTS_LAYER,
        type: "line",
        source: SEGMENTS_SOURCE,
        paint: {
          "line-color": ["get", "color"],
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      const onMouseEnter = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const onMouseLeave = () => {
        map.getCanvas().style.cursor = picking ? "crosshair" : "";
        popupRef.current?.remove();
      };
      const onMouseMove = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature?.properties) return;
        const props = feature.properties as Record<string, unknown>;
        const label = String(
          props.label ?? props.surface ?? props.highway ?? "Nawierzchnia",
        );
        popupRef.current
          ?.setLngLat(event.lngLat)
          .setHTML(
            `<div style="color:#fafafa;font:12px/1.4 system-ui,sans-serif">${label}</div>`,
          )
          .addTo(map);
      };

      map.on("mouseenter", SEGMENTS_LAYER, onMouseEnter);
      map.on("mouseleave", SEGMENTS_LAYER, onMouseLeave);
      map.on("mousemove", SEGMENTS_LAYER, onMouseMove);
      routeHandlersRef.current = {
        enter: onMouseEnter,
        leave: onMouseLeave,
        move: onMouseMove,
      };
    }

    const allCoords =
      normalizedRoute?.geometry.coordinates ??
      normalizedSegments?.features.flatMap(
        (feature) => feature.geometry.coordinates,
      ) ??
      [];

    fitToCoordinates(map, allCoords);
    map.resize();
    map.triggerRepaint();
    return true;
  }, [clearRouteLayers]);

  const scheduleRouteSync = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (syncRouteLayers()) return;

    const retry = () => {
      syncRouteLayers();
    };

    map.once("load", retry);
    map.once("idle", retry);
  }, [syncRouteLayers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !mapStyle) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle,
      center,
      zoom: 13,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "loopforge-popup",
    });

    const onLoad = () => {
      setMapReady(true);
      scheduleRouteSync();
    };

    map.on("load", onLoad);
    if (map.isStyleLoaded()) {
      onLoad();
    }

    return () => {
      map.off("load", onLoad);
      markerRef.current?.remove();
      markerRef.current = null;
      loopEntryMarkerRef.current?.remove();
      loopEntryMarkerRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per style
  }, [mapStyle]);

  useEffect(() => {
    if (!mapReady) return;
    scheduleRouteSync();
  }, [mapReady, route, mapGeojson, scheduleRouteSync]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!markerRef.current) {
      const marker = new maplibregl.Marker({
        color: "#10b981",
        draggable: true,
      })
        .setLngLat([start.lng, start.lat])
        .addTo(map);

      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        onStartChangeRef.current?.({ lat, lng });
      });

      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([start.lng, start.lat]);
    }
  }, [start.lat, start.lng, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!loopEntry) {
      loopEntryMarkerRef.current?.remove();
      loopEntryMarkerRef.current = null;
      return;
    }

    if (!loopEntryMarkerRef.current) {
      const marker = new maplibregl.Marker({
        color: "#f59e0b",
      })
        .setLngLat([loopEntry.lng, loopEntry.lat])
        .addTo(map);
      loopEntryMarkerRef.current = marker;
    } else {
      loopEntryMarkerRef.current.setLngLat([loopEntry.lng, loopEntry.lat]);
    }
  }, [loopEntry?.lat, loopEntry?.lng, mapReady, loopEntry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = pickStart ? "crosshair" : "";

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (!pickStart) return;
      const { lat, lng } = event.lngLat;
      onStartChangeRef.current?.({ lat, lng });
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      canvas.style.cursor = "";
    };
  }, [pickStart, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || route || mapGeojson?.features.length) return;

    map.flyTo({
      center: [start.lng, start.lat],
      zoom: Math.max(map.getZoom(), 12),
    });
  }, [start.lng, start.lat, route, mapGeojson, mapReady]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-xl" />
      {pickStart ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-emerald-500/50 bg-zinc-950/90 px-4 py-1.5 text-xs text-emerald-300 shadow-lg">
          Kliknij mapę, aby ustawić punkt startu
        </div>
      ) : null}
    </div>
  );
}
