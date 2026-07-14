"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
  place: string;
}

interface LocationSearchProps {
  lat: number;
  lng: number;
  onSelect: (location: { lat: number; lng: number; label: string }) => void;
  inputId?: string;
  compact?: boolean;
}

export function LocationSearch({
  lat,
  lng,
  onSelect,
  inputId = "location-search",
  compact = false,
}: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const fromSearchRef = useRef(false);

  useEffect(() => {
    if (fromSearchRef.current) {
      fromSearchRef.current = false;
      return;
    }
    setSelectedLabel(null);
    setQuery("");
  }, [lat, lng]);

  const search = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(text.trim())}`,
      );
      if (!response.ok) {
        setResults([]);
        return;
      }
      const data = (await response.json()) as GeocodeResult[];
      setResults(data);
      setOpen(data.length > 0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    setSelectedLabel(null);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void search(value);
    }, 350);
  }

  function handleSelect(result: GeocodeResult) {
    fromSearchRef.current = true;
    setQuery(result.place);
    setSelectedLabel(result.label);
    setOpen(false);
    setResults([]);
    onSelect({ lat: result.lat, lng: result.lng, label: result.label });
  }

  return (
    <div ref={containerRef} className="relative">
      {!compact ? (
        <label
          htmlFor={inputId}
          className="mb-2 block text-xs font-medium text-zinc-400"
        >
          Szukaj miejsca
        </label>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => handleInputChange(event.target.value)}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={compact ? "Szukaj adresu…" : "np. Warszawa, Kraków, Biskupice…"}
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-3 pr-9 text-sm placeholder:text-zinc-600"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
          {loading ? "…" : "⌕"}
        </span>
      </div>

      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {results.map((result) => (
            <li key={`${result.lat}-${result.lng}-${result.label}`}>
              <button
                type="button"
                onClick={() => handleSelect(result)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-800"
              >
                <span className="font-medium text-zinc-200">{result.place}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {result.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selectedLabel ? (
        <p className="mt-1.5 truncate text-[11px] text-amber-400/80">
          {selectedLabel}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Wybrany punkt: {lat.toFixed(4)}°, {lng.toFixed(4)}°
        </p>
      )}
    </div>
  );
}
