import Link from "next/link";
import type { ComponentProps } from "react";

import styles from "./corner-pill.module.css";

/** Which corner the pill is pinned to. Add corners here as they are needed. */
export type PillCorner = "top-end" | "bottom-start" | "bottom-end";

const CORNER_CLASS: Record<PillCorner, string> = {
  "top-end": styles.topEnd,
  "bottom-start": styles.bottomStart,
  "bottom-end": styles.bottomEnd,
};

export interface CornerPillProps
  extends Omit<ComponentProps<typeof Link>, "className"> {
  /** Where on the viewport it lives. */
  corner: PillCorner;
}

/**
 * A link styled as a solid pill and pinned to a corner of the viewport.
 *
 * It is always an `<a>`, which matters: the hero's pointer handling deliberately
 * ignores clicks on interactive elements, so pressing a pill does not also
 * relight the ▲ underneath. External hrefs are fine - `next/link` renders them
 * as plain anchors and does not try to prefetch them.
 *
 * Trailing icons that should nudge on hover take {@link trailingIconClass}.
 */
export function CornerPill({ corner, children, ...props }: CornerPillProps) {
  return (
    <Link className={`${styles.pill} ${CORNER_CLASS[corner]}`} {...props}>
      {children}
    </Link>
  );
}

/** Class for an icon that should slide outward when the pill is hovered. */
export const trailingIconClass = styles.trailingIcon;
