"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Report an element's border-box height without re-rendering.
 *
 * The renderer only needs the height to decide between two backing-store sizes,
 * which is an imperative one-liner - routing it through React state would
 * re-render the tree on every resize frame for nothing. The returned ref also
 * carries the latest measurement, so a renderer created later can read the
 * current height synchronously.
 */
export function useBorderBoxHeight(
  ref: RefObject<Element | null>,
  onChange: (height: number) => void,
): RefObject<number | undefined> {
  const heightRef = useRef<number | undefined>(undefined);
  // Latest-callback ref, refreshed after every render so the observer below can
  // stay mounted across re-renders instead of being torn down and recreated.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      heightRef.current = height;
      onChangeRef.current(height);
    });
    observer.observe(element, { box: "border-box" });

    return () => observer.disconnect();
  }, [ref]);

  return heightRef;
}
