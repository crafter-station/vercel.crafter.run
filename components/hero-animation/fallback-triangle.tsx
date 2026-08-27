import { CANVAS_HEIGHT, CANVAS_WIDTH, DOT_CENTERS, DOT_RADIUS } from "./core/scene";

/**
 * The ten dot centres in SVG's y-down space. The scene is authored y-up for
 * WebGL, so the rows have to be mirrored to land in the same place.
 */
const SVG_DOTS = DOT_CENTERS.map(([x, y]) => [x, CANVAS_HEIGHT - y] as const);

export interface FallbackTriangleProps {
  className?: string;
  /** Drives the `data-visible` attribute the stylesheet cross-fades on. */
  visible: boolean;
}

/**
 * The ▲ with its LEDs switched off.
 *
 * Rendered on the server and shown until the shader takes over - which may be
 * never, on hardware without WebGL2 or if the atlas fails to load. It is
 * geometrically identical to the shader's output, so the hand-off is a pure
 * cross-fade with nothing shifting.
 *
 * Colour comes from `currentColor` so the stylesheet owns the light/dark split.
 */
export function FallbackTriangle({ className, visible }: FallbackTriangleProps) {
  return (
    <svg
      aria-hidden
      className={className}
      data-hero-animation-fallback=""
      data-visible={visible}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
    >
      {SVG_DOTS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} fill="currentColor" r={DOT_RADIUS} />
      ))}
    </svg>
  );
}
