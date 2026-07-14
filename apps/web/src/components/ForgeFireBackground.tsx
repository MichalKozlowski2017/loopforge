"use client";

import { useEffect, useRef } from "react";

const FIRE_VIDEO_SRC = "/branding/fire-background-1.mp4";

/**
 * Subtle looping fire video behind the generation overlay.
 * Kept low-opacity and decorative (aria-hidden); disabled when the user
 * prefers reduced motion.
 */
export function ForgeFireBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      // Autoplay may be blocked; overlay still works without the video.
    });
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden"
      aria-hidden
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full scale-105 object-cover opacity-[0.12]"
        src={FIRE_VIDEO_SRC}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
      {/* Dark wash so flames stay atmospheric, not distracting */}
      <div className="absolute inset-0 bg-zinc-950/72" />
    </div>
  );
}
