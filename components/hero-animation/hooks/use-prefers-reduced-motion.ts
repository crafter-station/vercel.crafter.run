"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/** Assume motion is fine on the server; the client corrects it before paint. */
const getServerSnapshot = () => false;

/**
 * Track the user's reduced-motion preference, live.
 *
 * When it is on the hero skips the intro and relight sequences entirely - the
 * LEDs are simply lit - but clicking still toggles the palette, because that is
 * a direct response to input rather than ambient motion.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
