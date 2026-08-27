"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface RenderActivityOptions {
  /** Start rendering this far before the element scrolls into view. */
  rootMargin?: string;
}

/**
 * Track whether an element is worth rendering: on (or near) screen, in a tab
 * that is actually visible.
 *
 * Like {@link useBorderBoxHeight} this deliberately avoids state - the answer
 * goes straight to `renderer.setActive`, and the returned ref lets a renderer
 * constructed later start in the right phase.
 */
export function useRenderActivity(
  ref: RefObject<Element | null>,
  onChange: (active: boolean) => void,
  { rootMargin = "100px" }: RenderActivityOptions = {},
): RefObject<boolean> {
  const activeRef = useRef(true);
  // Latest-callback ref, refreshed after every render. See useBorderBoxHeight.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let intersecting = false;

    const update = () => {
      const active = intersecting && document.visibilityState === "visible";
      if (active === activeRef.current) return;
      activeRef.current = active;
      onChangeRef.current(active);
    };

    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      update();
    }, { rootMargin });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref, rootMargin]);

  return activeRef;
}
