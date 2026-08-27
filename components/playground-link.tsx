"use client";

import { usePathname } from "next/navigation";

import { CornerPill, trailingIconClass } from "@/components/corner-pill";

/**
 * Persistent way into the playground.
 *
 * Lives in the root layout so it is present on every route, but hides itself on
 * the playground - which has its own way back to the bare animation.
 */
export function PlaygroundLink() {
  const pathname = usePathname();
  if (pathname?.startsWith("/playground")) return null;

  return (
    <CornerPill corner="bottom-end" href="/playground">
      Play with it
      <svg
        aria-hidden
        className={trailingIconClass}
        height="12"
        viewBox="0 0 16 16"
        width="12"
      >
        <path
          d="M6 3l5 5-5 5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.75"
        />
      </svg>
    </CornerPill>
  );
}
