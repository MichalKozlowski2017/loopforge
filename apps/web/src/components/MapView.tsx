"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { RouteFeature, RouteMapGeoJson } from "@loopforge/osm-types";

export interface StartPoint {
  lat: number;
  lng: number;
}

interface MapViewProps {
  center: [number, number];
  start: StartPoint;
  route?: RouteFeature | null;
  mapGeojson?: RouteMapGeoJson | null;
  pickStart?: boolean;
  onStartChange?: (start: StartPoint) => void;
}

function fitToCoordinates(
  map: maplibregl.Map,
  coords: [number, number][],
): void {
  if (coords.length === 0) return;
  const bounds = coords.reduce(
    (b, coord) => b.extend(coord),
    new maplibregl.LngLatBounds(coords[0], coords[0]),
  );
  map.fitBounds(bounds, { padding: 48, maxZoom: 13 });
}

export function MapView({
  center,
  start,
  route,
  mapGeojson,
  pickStart = false,
  onStartChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onStartChangeRef = useRef(onStartChange);
  onStartChangeRef.current = onStartChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
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

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
  }, [start.lat, start.lng]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
  }, [pickStart]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || route || mapGeojson?.features.length) return;

    map.flyTo({ center: [start.lng, start.lat], zoom: Math.max(map.getZoom(), 12) });
  }, [start.lng, start.lat, route, mapGeojson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "route";
    const layerId = "route-line";
    const segmentsSourceId = "route-segments";
    const segmentsLayerId = "route-segments-line";

    const syncRoute = () => {
      if (map.getLayer(segmentsLayerId)) map.removeLayer(segmentsLayerId);
      if (map.getSource(segmentsSourceId)) map.removeSource(segmentsSourceId);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      if (mapGeojson?.features.length) {
        map.addSource(segmentsSourceId, {
          type: "geojson",
          data: mapGeojson,
        });

        map.addLayer({
          id: segmentsLayerId,
          type: "line",
          source: segmentsSourceId,
          paint: {
            "line-color": ["get", "color"],
            "line-width": 5,
            "line-opacity": 0.92,
            "line-dasharray": [
              "match",
              ["get", "category"],
              "gravel",
              ["literal", [2.5, 1.5]],
              "compacted",
              ["literal", [4, 2]],
              "dirt",
              ["literal", [1, 2]],
              "path",
              ["literal", [1.5, 2]],
              "forest",
              ["literal", [3, 2, 1, 2]],
              "unknown",
              ["literal", [2, 2]],
              ["literal", [1, 0]],
            ],
          },
        });

        const onMouseEnter = () => {
          map.getCanvas().style.cursor = "pointer";
        };
        const onMouseLeave = () => {
          map.getCanvas().style.cursor = pickStart ? "crosshair" : "";
          popupRef.current?.remove();
        };
        const onMouseMove = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          if (!feature?.properties) return;
          const label = String(feature.properties.label ?? "Nawierzchnia");
          popupRef.current
            ?.setLngLat(event.lngLat)
            .setHTML(`<span style="font:12px system-ui">${label}</span>`)
            .addTo(map);
        };

        map.on("mouseenter", segmentsLayerId, onMouseEnter);
        map.on("mouseleave", segmentsLayerId, onMouseLeave);
        map.on("mousemove", segmentsLayerId, onMouseMove);

        const allCoords = mapGeojson.features.flatMap(
          (feature) => feature.geometry.coordinates,
        );
        fitToCoordinates(map, allCoords);
        return;
      }

      if (!route) return;

      map.addSource(sourceId, {
        type: "geojson",
        data: route,
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#22c55e",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      fitToCoordinates(map, route.geometry.coordinates);
    };

    if (map.isStyleLoaded()) {
      syncRoute();
    } else {
      map.once("load", syncRoute);
    }
  }, [route, mapGeojson, pickStart]);

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
