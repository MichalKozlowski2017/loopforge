"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

import type { RouteFeature } from "@loopforge/osm-types";

interface MapViewProps {
  center: [number, number];
  route?: RouteFeature | null;
}

export function MapView({ center, route }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center,
      zoom: 11,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = "route";
    const layerId = "route-line";

    const syncRoute = () => {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

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

      const coords = route.geometry.coordinates;
      if (coords.length > 0) {
        const bounds = coords.reduce(
          (b, coord) => b.extend(coord as [number, number]),
          new maplibregl.LngLatBounds(
            coords[0] as [number, number],
            coords[0] as [number, number],
          ),
        );
        map.fitBounds(bounds, { padding: 48, maxZoom: 13 });
      }
    };

    if (map.isStyleLoaded()) {
      syncRoute();
    } else {
      map.once("load", syncRoute);
    }
  }, [route]);

  return <div ref={containerRef} className="h-full w-full rounded-xl" />;
}
