"use client";

import { useSyncExternalStore } from "react";

/** What the caller asked for. `"system"` defers to the page and the OS. */
export type ColorSchemePreference = "system" | "light" | "dark";

/** What we actually render with. */
export type ResolvedColorScheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Resolve the page's colour scheme without taking a dependency on a theme
 * library, while staying compatible with the common ones.
 *
 * Checked in order, first match wins:
 *
 * 1. `<html data-theme="light|dark">` - `next-themes` with `attribute="data-theme"`
 * 2. `<html class="light-theme|dark-theme">` - Geist / vercel.com
 * 3. `<html class="light|dark">` - `next-themes` default, Tailwind's `dark:`
 * 4. the `prefers-color-scheme` media query
 */
function readDocumentScheme(): ResolvedColorScheme {
  const root = document.documentElement;

  const attribute = root.getAttribute("data-theme");
  if (attribute === "light" || attribute === "dark") return attribute;

  const classes = root.classList;
  if (classes.contains("light-theme") || classes.contains("light")) return "light";
  if (classes.contains("dark-theme") || classes.contains("dark")) return "dark";

  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onStoreChange);

  // A theme toggle flips a class or attribute on <html> rather than firing an
  // event, so the only reliable signal is to watch the element itself.
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });

  return () => {
    media.removeEventListener("change", onStoreChange);
    observer.disconnect();
  };
}

/**
 * Server render assumes dark. The stylesheet handles the visible light/dark
 * split on its own, so this value only reaches the shader - which does not
 * exist until well after hydration.
 */
const getServerSnapshot = (): ResolvedColorScheme => "dark";

/**
 * The colour scheme the shader should render for.
 *
 * @param preference `"system"` follows the page, anything else forces it.
 */
export function useColorScheme(preference: ColorSchemePreference = "system"): ResolvedColorScheme {
  const documentScheme = useSyncExternalStore(subscribe, readDocumentScheme, getServerSnapshot);
  return preference === "system" ? documentScheme : preference;
}
