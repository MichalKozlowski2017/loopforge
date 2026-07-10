"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type GeolocationStatus =
  | "loading"
  | "ready"
  | "denied"
  | "unavailable";

interface GeolocationState {
  status: GeolocationStatus;
  refresh: () => void;
}

export function useGeolocation(
  onPosition: (lat: number, lng: number) => void,
  enabled = true,
): GeolocationState {
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  const [status, setStatus] = useState<GeolocationStatus>(
    enabled ? "loading" : "unavailable",
  );

  const refresh = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("unavailable");
      return;
    }

    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onPositionRef.current(
          position.coords.latitude,
          position.coords.longitude,
        );
        setStatus("ready");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  return { status, refresh };
}
