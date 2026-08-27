"use client";

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOT_CENTERS,
  DOT_RADIUS,
} from "@/components/hero-animation";

import styles from "./playground.module.css";

/** Everything the overlay can draw. Each maps to one thing in `core/scene.ts`. */
export interface GuideFlags {
  grid: boolean;
  dots: boolean;
  hoverRadius: boolean;
  colorTriangle: boolean;
  bloomQuads: boolean;
  distortionRamp: boolean;
}

export const DEFAULT_GUIDES: GuideFlags = {
  grid: false,
  dots: true,
  hoverRadius: false,
  colorTriangle: false,
  bloomQuads: false,
  distortionRamp: false,
};

export const GUIDE_LABELS: { key: keyof GuideFlags; label: string; note: string }[] = [
  { key: "dots", label: "LED centres", note: "the ten lights, in draw order" },
  { key: "hoverRadius", label: "Hover radius", note: "120px - the pointer hit test" },
  { key: "colorTriangle", label: "Colour triangle", note: "one RGB primary per edge" },
  { key: "bloomQuads", label: "Bloom quads", note: "the entire second pass" },
  { key: "distortionRamp", label: "Distortion ramp", note: "420px, where grain jitters lookups" },
  { key: "grid", label: "Virtual grid", note: "the fixed 1200 × 800 space" },
];

/* The scene is authored y-up for GL; SVG is y-down. */
const flipY = (y: number) => CANVAS_HEIGHT - y;

/** Colour-triangle vertices from `core/scene.ts`, mirrored into SVG space. */
const TRIANGLE = [
  [526, flipY(335)],
  [674, flipY(335)],
  [600, flipY(468)],
] as const;
const TRIANGLE_POINTS = TRIANGLE.map(([x, y]) => `${x},${y}`).join(" ");

const CENTROID = [
  TRIANGLE.reduce((sum, [x]) => sum + x, 0) / 3,
  TRIANGLE.reduce((sum, [, y]) => sum + y, 0) / 3,
] as const;

/**
 * Midpoint of each edge, where that edge's primary is strongest.
 *
 * The letter is pushed radially outward from the centroid so it never lands on
 * an LED - the triangle is small and crowded.
 */
const LABEL_OFFSET = 30;

const EDGE_LABELS = [
  { from: 2, to: 0, fill: "#e5484d", text: "R" },
  { from: 0, to: 1, fill: "#30a46c", text: "G" },
  { from: 1, to: 2, fill: "#0090ff", text: "B" },
].map(({ from, to, fill, text }) => {
  const x = (TRIANGLE[from][0] + TRIANGLE[to][0]) / 2;
  const y = (TRIANGLE[from][1] + TRIANGLE[to][1]) / 2;
  const dx = x - CENTROID[0];
  const dy = y - CENTROID[1];
  const length = Math.hypot(dx, dy) || 1;
  return {
    fill,
    text,
    x,
    y,
    labelX: x + (dx / length) * LABEL_OFFSET,
    labelY: y + (dy / length) * LABEL_OFFSET,
  };
});

const HOVER_RADIUS = 120;
const DISTORTION_RAMP = 420;
const GRID_STEP = 100;

export function GuideOverlay({
  guides,
  hoverIndex,
  bloomRadiusPx,
}: {
  guides: GuideFlags;
  /** Highlighted LED, from the renderer's live frame state. */
  hoverIndex: number;
  /** Live `bloom.radiusPx`, so the quads track the slider. */
  bloomRadiusPx: number;
}) {
  const dots = DOT_CENTERS.map(([x, y]) => [x, flipY(y)] as const);
  const quadHalf = DOT_RADIUS + bloomRadiusPx;

  return (
    <svg
      aria-hidden
      className={styles.guides}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
    >
      <defs>
        {/*
          The ramp is measured *outside* the triangle only. Stroking the polygon
          at twice the ramp width gives a band on both sides, so the interior is
          masked back out.
        */}
        {/*
          `maskUnits` must be userSpaceOnUse: the default is the *object*
          bounding box, which would clip the band to the triangle's own extent
          plus 10% - a hard rectangle right through the middle of the ramp.
        */}
        <mask
          height={CANVAS_HEIGHT}
          id="outside-triangle"
          maskUnits="userSpaceOnUse"
          width={CANVAS_WIDTH}
          x="0"
          y="0"
        >
          <rect fill="white" height={CANVAS_HEIGHT} width={CANVAS_WIDTH} x="0" y="0" />
          <polygon fill="black" points={TRIANGLE_POINTS} />
        </mask>
      </defs>

      {guides.grid ? (
        <g className={styles.guideGrid}>
          {range(GRID_STEP, CANVAS_WIDTH, GRID_STEP).map((x) => (
            <line key={`vx${x}`} x1={x} x2={x} y1={0} y2={CANVAS_HEIGHT} />
          ))}
          {range(GRID_STEP, CANVAS_HEIGHT, GRID_STEP).map((y) => (
            <line key={`hz${y}`} x1={0} x2={CANVAS_WIDTH} y1={y} y2={y} />
          ))}
          <text className={styles.guideCaption} x={12} y={CANVAS_HEIGHT - 12}>
            {CANVAS_WIDTH} × {CANVAS_HEIGHT} virtual px · origin bottom-left
          </text>
        </g>
      ) : null}

      {guides.distortionRamp ? (
        <g mask="url(#outside-triangle)">
          <polygon
            className={styles.guideRamp}
            points={TRIANGLE_POINTS}
            strokeWidth={DISTORTION_RAMP * 2}
          />
        </g>
      ) : null}

      {guides.colorTriangle ? (
        <g>
          <polygon className={styles.guideTriangle} points={TRIANGLE_POINTS} />
          {EDGE_LABELS.map((edge) => (
            <g key={edge.text}>
              <circle cx={edge.x} cy={edge.y} fill={edge.fill} r={7} />
              <text className={styles.guideEdgeLabel} x={edge.labelX} y={edge.labelY + 5}>
                {edge.text}
              </text>
            </g>
          ))}
        </g>
      ) : null}

      {guides.hoverRadius
        ? dots.map(([x, y], index) => (
            <circle
              className={styles.guideHoverRadius}
              cx={x}
              cy={y}
              data-active={index === hoverIndex}
              key={`hr${index}`}
              r={HOVER_RADIUS}
            />
          ))
        : null}

      {guides.bloomQuads
        ? dots.map(([x, y], index) => (
            <rect
              className={styles.guideQuad}
              height={quadHalf * 2}
              key={`bq${index}`}
              width={quadHalf * 2}
              x={x - quadHalf}
              y={y - quadHalf}
            />
          ))
        : null}

      {guides.dots
        ? dots.map(([x, y], index) => (
            <g data-active={index === hoverIndex} key={`dot${index}`}>
              <circle className={styles.guideDot} cx={x} cy={y} r={DOT_RADIUS + 6} />
              <text className={styles.guideDotLabel} x={x + DOT_RADIUS + 9} y={y - DOT_RADIUS - 5}>
                {index}
              </text>
            </g>
          ))
        : null}
    </svg>
  );
}

function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let value = start; value < end; value += step) out.push(value);
  return out;
}
