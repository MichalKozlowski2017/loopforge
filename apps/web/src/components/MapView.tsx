"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { RouteFeature, RouteMapGeoJson } from "@loopforge/osm-types";

interface MapViewProps {
  center: [number, number];
  route?: RouteFeature | null;
  mapGeojson?: RouteMapGeoJson | null;
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

export function MapView({ center, route, mapGeojson }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

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
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "loopforge-popup",
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [center]);

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

        map.on("mouseenter", segmentsLayerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", segmentsLayerId, () => {
          map.getCanvas().style.cursor = "";
          popupRef.current?.remove();
        });
        map.on("mousemove", segmentsLayerId, (event) => {
          const feature = event.features?.[0];
          if (!feature?.properties) return;
          const label = String(feature.properties.label ?? "Nawierzchnia");
          popupRef.current
            ?.setLngLat(event.lngLat)
            .setHTML(`<span style="font:12px system-ui">${label}</span>`)
            .addTo(map);
        });

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
  }, [route, mapGeojson]);

  return <div ref={containerRef} className="h-full w-full rounded-xl" />;
}
