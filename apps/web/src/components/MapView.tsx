"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { RouteFeature, RouteMapGeoJson } from "@loopforge/osm-types";
import { loadMapStyle } from "@/lib/map-style";
import {
  ROUTE_FIT_MAX_ZOOM,
  ROUTE_FIT_PADDING,
  flattenLoopDrawPath,
  type LngLat,
} from "@/lib/route-draw-path";
import {
  POI_CATEGORIES,
  POI_CATEGORY_META,
  POI_MIN_ZOOM,
  googleMapsSearchUri,
  poiSearchRadiusM,
  type PoiCategory,
  type PoiDetails,
  type PoiFeatureCollection,
  type PoiFeatureProperties,
} from "@/lib/pois";
import {
  PoiDetailCard,
  type SelectedPoi,
} from "@/components/PoiDetailCard";
import { RouteDrawReveal } from "@/components/RouteDrawReveal";

export interface StartPoint {
  lat: number;
  lng: number;
}

export interface ViaMapPoint extends StartPoint {
  label?: string;
}

interface MapViewProps {
  center: [number, number];
  start: StartPoint;
  loopEntry?: StartPoint | null;
  viaPoints?: ViaMapPoint[];
  route?: RouteFeature | null;
  mapGeojson?: RouteMapGeoJson | null;
  approachEnabled?: boolean;
  approachDistanceKm?: number | null;
  returnApproachDistanceKm?: number | null;
  pickStart?: boolean;
  /** When true, map clicks append a via/waypoint pin (not start). */
  pickVia?: boolean;
  onStartChange?: (start: StartPoint) => void;
  onViaAdd?: (point: StartPoint) => void;
  /** Hide the map under a dark veil and suppress route layers (during loading/reveal). */
  mapVeiled?: boolean;
  /** When true, the route is drawn over a dark mask before the map is unveiled. */
  routeRevealActive?: boolean;
  onRouteRevealComplete?: () => void;
}

const ROUTE_SOURCE = "route";
const ROUTE_LAYER = "route-line";
const SEGMENTS_SOURCE = "route-segments";
const SEGMENTS_LAYER = "route-segments-line";
const POI_SOURCE = "loopforge-pois";
const POI_CIRCLE_LAYER = "loopforge-pois-circle";
const POI_LABEL_LAYER = "loopforge-pois-label";

const EMPTY_POIS: PoiFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

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

function viewportFitCoords(
  route: RouteFeature | null,
  mapGeojson: RouteMapGeoJson | null,
  loopEntry: StartPoint | null,
  approachEnabled?: boolean | null,
  distanceHints?: {
    approachDistanceKm?: number | null;
    returnApproachDistanceKm?: number | null;
  },
): [number, number][] {
  return flattenLoopDrawPath(
    route,
    mapGeojson,
    loopEntry,
    approachEnabled,
    distanceHints,
  );
}

function fitRouteToView(map: maplibregl.Map, coords: [number, number][]): void {
  const valid = normalizeCoords(coords);
  if (valid.length === 0) return;

  const bounds = valid.reduce(
    (b, coord) => b.extend(coord),
    new maplibregl.LngLatBounds(valid[0], valid[0]),
  );

  map.fitBounds(bounds, {
    padding: ROUTE_FIT_PADDING,
    maxZoom: ROUTE_FIT_MAX_ZOOM,
    duration: 0,
  });
}

function waitForMapSettled(map: maplibregl.Map): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off("idle", finish);
      window.clearTimeout(fallbackId);
      resolve();
    };

    map.once("idle", finish);
    const fallbackId = window.setTimeout(finish, 180);
  });
}

export function MapView({
  center,
  start,
  loopEntry = null,
  viaPoints = [],
  route,
  mapGeojson,
  approachEnabled = false,
  approachDistanceKm = null,
  returnApproachDistanceKm = null,
  pickStart = false,
  pickVia = false,
  onStartChange,
  onViaAdd,
  mapVeiled = false,
  routeRevealActive = false,
  onRouteRevealComplete,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const loopEntryMarkerRef = useRef<maplibregl.Marker | null>(null);
  const viaMarkerRefs = useRef<maplibregl.Marker[]>([]);
  const onStartChangeRef = useRef(onStartChange);
  const onViaAddRef = useRef(onViaAdd);
  const routeHandlersRef = useRef<{
    enter?: () => void;
    leave?: () => void;
    move?: (event: maplibregl.MapLayerMouseEvent) => void;
  }>({});
  const routeDataRef = useRef({
    route,
    mapGeojson,
    loopEntry: loopEntry ?? null,
    approachEnabled,
    distanceHints: {
      approachDistanceKm,
      returnApproachDistanceKm,
    },
    pickStart,
    showRouteLayers: true,
    mapVeiled: false,
  });
  const [showRouteLayers, setShowRouteLayers] = useState(true);
  const [drawRevealActive, setDrawRevealActive] = useState(false);
  const [lockedRevealPath, setLockedRevealPath] = useState<LngLat[]>([]);
  const lockedRevealPathRef = useRef<LngLat[]>([]);
  const routeLayersRevealedRef = useRef(false);
  const wasVeiledRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [mapStyle, setMapStyle] = useState<StyleSpecification | null>(null);
  const [poiCategories, setPoiCategories] = useState<Set<PoiCategory>>(
    () => new Set(),
  );
  const [poiStatus, setPoiStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [poiZoomHint, setPoiZoomHint] = useState(false);
  const [selectedPoi, setSelectedPoi] = useState<SelectedPoi | null>(null);
  const [poiDetails, setPoiDetails] = useState<PoiDetails | null>(null);
  const [poiDetailsLoading, setPoiDetailsLoading] = useState(false);
  const poiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onStartChangeRef.current = onStartChange;
  }, [onStartChange]);

  useEffect(() => {
    onViaAddRef.current = onViaAdd;
  }, [onViaAdd]);
  const distanceHints = useMemo(
    () => ({
      approachDistanceKm,
      returnApproachDistanceKm,
    }),
    [approachDistanceKm, returnApproachDistanceKm],
  );
  // Latest-props snapshot read synchronously by imperative maplibre sync/event
  // callbacks; intentionally written during render so callbacks never see stale
  // props. Moving this into an effect would reorder it after the sync effects.
  // eslint-disable-next-line react-hooks/refs -- intentional latest-props mirror for imperative map sync
  routeDataRef.current = {
    route,
    mapGeojson,
    loopEntry: loopEntry ?? null,
    approachEnabled,
    distanceHints,
    pickStart,
    showRouteLayers,
    mapVeiled,
  };

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
      loopEntry: entryPoint,
      approachEnabled: approachOn,
      distanceHints: fitDistanceHints,
      pickStart: picking,
      showRouteLayers: layersRequested,
      mapVeiled: veiled,
    } = routeDataRef.current;

    const layersVisible =
      layersRequested && (!veiled || routeLayersRevealedRef.current);

    clearRouteLayers(map);

    const normalizedRoute = routeData ? normalizeRoute(routeData) : null;
    const normalizedSegments =
      segmentData?.features.length ? normalizeMapGeojson(segmentData) : null;

    const fitCoords = viewportFitCoords(
      routeData ?? null,
      segmentData ?? null,
      entryPoint,
      approachOn,
      fitDistanceHints,
    );

    if (fitCoords.length >= 2) {
      fitRouteToView(map, fitCoords);
    }

    if (!layersVisible) {
      map.resize();
      map.triggerRepaint();
      return true;
    }

    if (
      !normalizedRoute?.geometry.coordinates.length &&
      !normalizedSegments?.features.length
    ) {
      return true;
    }

    // Always paint the full polyline. Colored segments are an overlay for
    // surface styling — never the sole continuity source (gap-skipping there
    // previously dashed rural loops).
    if (normalizedRoute?.geometry.coordinates.length) {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: normalizedRoute,
      });

      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#0f766e",
          "line-width": 6,
          // Strong enough to bridge any remaining segment gaps; segments sit on top.
          "line-opacity": normalizedSegments?.features.length ? 0.45 : 0.35,
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
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
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

    map.resize();
    map.triggerRepaint();
    return true;
  }, [clearRouteLayers]);

  const ensurePoiLayers = useCallback((map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource(POI_SOURCE)) {
      map.addSource(POI_SOURCE, {
        type: "geojson",
        data: EMPTY_POIS,
      });
    }

    if (!map.getLayer(POI_CIRCLE_LAYER)) {
      map.addLayer({
        id: POI_CIRCLE_LAYER,
        type: "circle",
        source: POI_SOURCE,
        minzoom: POI_MIN_ZOOM,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            3.5,
            11,
            6,
            15,
            8,
          ],
          "circle-color": [
            "match",
            ["get", "category"],
            "food",
            POI_CATEGORY_META.food.color,
            "fuel",
            POI_CATEGORY_META.fuel.color,
            "water",
            POI_CATEGORY_META.water.color,
            "toilets",
            POI_CATEGORY_META.toilets.color,
            "#a1a1aa",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#18181b",
          "circle-opacity": 0.92,
        },
      });
    }

    if (!map.getLayer(POI_LABEL_LAYER)) {
      map.addLayer({
        id: POI_LABEL_LAYER,
        type: "symbol",
        source: POI_SOURCE,
        minzoom: 11,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-max-width": 10,
          "text-optional": true,
        },
        paint: {
          "text-color": "#fafafa",
          "text-halo-color": "#18181b",
          "text-halo-width": 1.2,
        },
      });
    }

    if (map.getLayer(POI_CIRCLE_LAYER)) map.moveLayer(POI_CIRCLE_LAYER);
    if (map.getLayer(POI_LABEL_LAYER)) map.moveLayer(POI_LABEL_LAYER);
  }, []);

  const setPoiData = useCallback(
    (data: PoiFeatureCollection) => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;
      ensurePoiLayers(map);
      const source = map.getSource(POI_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(data);
    },
    [ensurePoiLayers],
  );

  const togglePoiCategory = useCallback((category: PoiCategory) => {
    setPoiCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const closePoiDetail = useCallback(() => {
    setSelectedPoi(null);
    setPoiDetails(null);
    setPoiDetailsLoading(false);
  }, []);

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
      const container = map.getContainer();
      container.style.width = "100%";
      container.style.height = "100%";
      const canvas = map.getCanvas();
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      setMapReady(true);
      setMapInstance(map);
      requestAnimationFrame(() => {
        map.resize();
        scheduleRouteSync();
      });
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
      for (const marker of viaMarkerRefs.current) marker.remove();
      viaMarkerRefs.current = [];
      popupRef.current?.remove();
      popupRef.current = null;
      poiAbortRef.current?.abort();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per style
  }, [mapStyle]);

  useEffect(() => {
    if (!mapReady) return;
    scheduleRouteSync();
  }, [mapReady, route, mapGeojson, showRouteLayers, mapVeiled, scheduleRouteSync]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map || !mapReady) return;

    const observer = new ResizeObserver(() => {
      map.resize();
      const coords = viewportFitCoords(
        routeDataRef.current.route ?? null,
        routeDataRef.current.mapGeojson ?? null,
        routeDataRef.current.loopEntry,
        routeDataRef.current.approachEnabled,
        routeDataRef.current.distanceHints,
      );
      if (coords.length >= 2) {
        fitRouteToView(map, coords);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [mapReady, route, mapGeojson, loopEntry, approachEnabled]);

  const drawPath = useMemo(
    () =>
      flattenLoopDrawPath(
        route ?? null,
        mapGeojson ?? null,
        loopEntry,
        approachEnabled,
        distanceHints,
      ),
    [route, mapGeojson, loopEntry, approachEnabled, distanceHints],
  );

  const handleDrawingComplete = useCallback(() => {
    routeLayersRevealedRef.current = true;
    routeDataRef.current.showRouteLayers = true;
    setShowRouteLayers(true);
    scheduleRouteSync();
  }, [scheduleRouteSync]);

  const handleRevealComplete = useCallback(() => {
    setDrawRevealActive(false);
    onRouteRevealComplete?.();
  }, [onRouteRevealComplete]);

  useEffect(() => {
    // Imperative reveal coordination: toggles route-layer visibility in sync
    // with the veil/reveal animation driven by refs. Intentional effect state.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (mapVeiled && !wasVeiledRef.current) {
      routeLayersRevealedRef.current = false;
    }
    wasVeiledRef.current = mapVeiled;

    if (!mapVeiled) {
      if (!routeRevealActive) {
        routeDataRef.current.showRouteLayers = true;
        setShowRouteLayers(true);
      }
      return;
    }

    if (!routeLayersRevealedRef.current) {
      routeDataRef.current.showRouteLayers = false;
      setShowRouteLayers(false);
      if (mapReady) scheduleRouteSync();
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [mapVeiled, mapReady, routeRevealActive, scheduleRouteSync]);

  useEffect(() => {
    // Drives the route-draw reveal state machine (locks path, hides layers,
    // starts the animation). Intentional effect state coordination.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!routeRevealActive) {
      setDrawRevealActive(false);
      lockedRevealPathRef.current = [];
      setLockedRevealPath([]);
      return;
    }

    if (!mapReady || !route || drawPath.length < 2) return;

    if (lockedRevealPathRef.current.length < 2) {
      lockedRevealPathRef.current = drawPath;
      setLockedRevealPath(drawPath);
    }

    const revealPath = lockedRevealPathRef.current;
    routeDataRef.current.showRouteLayers = false;
    setShowRouteLayers(false);
    scheduleRouteSync();

    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    const begin = async () => {
      fitRouteToView(map, revealPath);
      await waitForMapSettled(map);
      if (!cancelled) setDrawRevealActive(true);
    };

    void begin();

    return () => {
      cancelled = true;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    routeRevealActive,
    mapReady,
    route,
    drawPath,
    scheduleRouteSync,
  ]);

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

    for (const marker of viaMarkerRefs.current) marker.remove();
    viaMarkerRefs.current = [];

    viaPoints.forEach((point, index) => {
      if (
        !Number.isFinite(point.lat) ||
        !Number.isFinite(point.lng) ||
        (Math.abs(point.lat) < 0.0001 && Math.abs(point.lng) < 0.0001)
      ) {
        return;
      }

      const el = document.createElement("div");
      el.className =
        "flex h-7 w-7 items-center justify-center rounded-full border-2 border-violet-300 bg-violet-600 text-xs font-bold text-white shadow-md";
      el.textContent = String(index + 1);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      viaMarkerRefs.current.push(marker);
    });
  }, [viaPoints, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const picking = pickStart || pickVia;
    if (picking || mapVeiled || poiCategories.size === 0) {
      poiAbortRef.current?.abort();
      setPoiData(EMPTY_POIS);
      setPoiStatus("idle");
      setPoiZoomHint(false);
      closePoiDetail();
      return;
    }

    ensurePoiLayers(map);

    let debounceId: number | null = null;

    const loadPois = () => {
      const zoom = map.getZoom();
      if (zoom < POI_MIN_ZOOM) {
        setPoiZoomHint(true);
        setPoiData(EMPTY_POIS);
        setPoiStatus("idle");
        return;
      }
      setPoiZoomHint(false);

      const center = map.getCenter();
      const radiusM = poiSearchRadiusM(zoom);
      const categories = [...poiCategories].join(",");

      poiAbortRef.current?.abort();
      const controller = new AbortController();
      poiAbortRef.current = controller;
      setPoiStatus("loading");

      const url =
        `/api/pois?lat=${center.lat.toFixed(5)}` +
        `&lng=${center.lng.toFixed(5)}` +
        `&radiusM=${Math.round(radiusM)}` +
        `&categories=${categories}`;

      void fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`POI HTTP ${res.status}`);
          return (await res.json()) as PoiFeatureCollection;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setPoiData(data);
          setPoiStatus("idle");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("[loopforge] POI load failed:", error);
          setPoiStatus("error");
        });
    };

    const scheduleLoad = () => {
      if (debounceId != null) window.clearTimeout(debounceId);
      debounceId = window.setTimeout(loadPois, 500);
    };

    loadPois();
    map.on("moveend", scheduleLoad);
    map.on("zoomend", scheduleLoad);

    return () => {
      if (debounceId != null) window.clearTimeout(debounceId);
      map.off("moveend", scheduleLoad);
      map.off("zoomend", scheduleLoad);
      poiAbortRef.current?.abort();
    };
  }, [
    mapReady,
    poiCategories,
    pickStart,
    pickVia,
    mapVeiled,
    ensurePoiLayers,
    setPoiData,
    closePoiDetail,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;
      event.originalEvent.stopPropagation();

      const props = feature.properties as PoiFeatureProperties &
        Record<string, unknown>;
      const geometry = feature.geometry as
        | { type: string; coordinates?: [number, number] }
        | undefined;
      const coords = geometry?.type === "Point" ? geometry.coordinates : null;
      const lng = coords?.[0] ?? event.lngLat.lng;
      const lat = coords?.[1] ?? event.lngLat.lat;
      const category = props.category as PoiCategory;
      if (!POI_CATEGORIES.includes(category)) return;

      const selected: SelectedPoi = {
        id: String(props.id),
        name: String(props.name ?? "Punkt"),
        category,
        kind: String(props.kind ?? ""),
        lat,
        lng,
        cuisine: props.cuisine ? String(props.cuisine) : undefined,
        openingHours: props.openingHours
          ? String(props.openingHours)
          : undefined,
        phone: props.phone ? String(props.phone) : undefined,
        website: props.website ? String(props.website) : undefined,
        brand: props.brand ? String(props.brand) : undefined,
        wheelchair: props.wheelchair ? String(props.wheelchair) : undefined,
      };

      setSelectedPoi(selected);
      setPoiDetails({
        googleMapsUri: googleMapsSearchUri(selected.name, lat, lng),
        source: "maps-link",
      });
      setPoiDetailsLoading(true);

      void fetch(
        `/api/pois/details?name=${encodeURIComponent(selected.name)}` +
          `&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`,
      )
        .then(async (res) => {
          if (!res.ok) throw new Error(`details ${res.status}`);
          return (await res.json()) as PoiDetails;
        })
        .then((details) => {
          setPoiDetails(details);
        })
        .catch(() => {
          /* keep maps-link fallback */
        })
        .finally(() => setPoiDetailsLoading(false));
    };

    const onEnter = () => {
      if (!pickStart && !pickVia) map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor =
        pickStart || pickVia ? "crosshair" : "";
    };

    map.on("click", POI_CIRCLE_LAYER, onClick);
    map.on("mouseenter", POI_CIRCLE_LAYER, onEnter);
    map.on("mouseleave", POI_CIRCLE_LAYER, onLeave);

    return () => {
      map.off("click", POI_CIRCLE_LAYER, onClick);
      map.off("mouseenter", POI_CIRCLE_LAYER, onEnter);
      map.off("mouseleave", POI_CIRCLE_LAYER, onLeave);
    };
  }, [mapReady, pickStart, pickVia]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const picking = pickStart || pickVia;
    const canvas = map.getCanvas();
    canvas.style.cursor = picking ? "crosshair" : "";

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      const { lat, lng } = event.lngLat;
      if (pickVia) {
        onViaAddRef.current?.({ lat, lng });
        return;
      }
      if (pickStart) {
        onStartChangeRef.current?.({ lat, lng });
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      canvas.style.cursor = "";
    };
  }, [pickStart, pickVia, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || route || mapGeojson?.features.length) return;

    map.flyTo({
      center: [start.lng, start.lat],
      zoom: Math.max(map.getZoom(), 12),
    });
  }, [start.lng, start.lat, route, mapGeojson, mapReady]);

  return (
    <div className="relative h-full min-h-[240px] w-full">
      <div
        ref={containerRef}
        className="absolute inset-0 rounded-xl [&_.maplibregl-canvas]:!h-full [&_.maplibregl-canvas]:!w-full [&_.maplibregl-map]:!h-full [&_.maplibregl-map]:!w-full"
      />
      {mapVeiled && !drawRevealActive ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-xl bg-zinc-950"
          aria-hidden
        />
      ) : null}
      {mapReady && mapInstance && drawRevealActive && lockedRevealPath.length >= 2 ? (
        <RouteDrawReveal
          map={mapInstance}
          coordinates={lockedRevealPath}
          active={drawRevealActive}
          onDrawingComplete={handleDrawingComplete}
          onComplete={handleRevealComplete}
        />
      ) : null}
      {!mapVeiled && selectedPoi ? (
        <PoiDetailCard
          poi={selectedPoi}
          details={poiDetails}
          detailsLoading={poiDetailsLoading}
          onClose={closePoiDetail}
        />
      ) : null}
      {!mapVeiled ? (
        <div className="absolute bottom-3 left-3 z-10 flex max-w-[min(100%,18rem)] flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-1.5 shadow-lg backdrop-blur-sm">
            {POI_CATEGORIES.map((category) => {
              const meta = POI_CATEGORY_META[category];
              const active = poiCategories.has(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => togglePoiCategory(category)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    active
                      ? "text-zinc-950"
                      : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                  style={active ? { backgroundColor: meta.color } : undefined}
                  aria-pressed={active}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          {poiCategories.size > 0 ? (
            <p className="rounded-md bg-zinc-950/80 px-2 py-1 text-[10px] text-zinc-400">
              {poiZoomHint
                ? `Przybliż mapę (zoom ≥ ${POI_MIN_ZOOM}), żeby zobaczyć punkty.`
                : poiStatus === "loading"
                  ? "Ładuję punkty z OSM…"
                  : poiStatus === "error"
                    ? "Nie udało się pobrać punktów (Overpass)."
                    : "OSM · kliknij punkt po szczegóły / oceny"}
            </p>
          ) : null}
        </div>
      ) : null}
      {pickStart ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-amber-500/50 bg-zinc-950/90 px-4 py-1.5 text-xs text-amber-300 shadow-lg">
          Kliknij mapę, aby ustawić punkt startu
        </div>
      ) : null}
      {pickVia ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full border border-violet-400/50 bg-zinc-950/90 px-4 py-1.5 text-xs text-violet-200 shadow-lg">
          Kliknij mapę, aby dodać punkt do zaliczenia
        </div>
      ) : null}
    </div>
  );
}
