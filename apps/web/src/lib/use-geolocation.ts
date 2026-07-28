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
  useEffect(() => {
    onPositionRef.current = onPosition;
  }, [onPosition]);

  const [status, setStatus] = useState<GeolocationStatus>(
    enabled ? "loading" : "unavailable",
  );

  const requestPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setStatus("unavailable");
      return;
    }

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

  const refresh = useCallback(() => {
    setStatus("loading");
    requestPosition();
  }, [requestPosition]);

  useEffect(() => {
    if (!enabled) return;
    // Kicks off a browser geolocation request on mount; status updates arrive
    // via async callbacks (only the no-support fallback sets state synchronously).
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    requestPosition();
  }, [enabled, requestPosition]);

  return { status, refresh };
}
