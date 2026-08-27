/**
 * Static geometry and colour data for the ▲ of ten LEDs.
 *
 * Everything is authored in a fixed **1200 × 800 virtual pixel** space with the
 * origin bottom-left (GL convention, y up). The canvas is rendered into a
 * larger backing store and then CSS-scaled, so these numbers never change with
 * viewport size - only {@link BACKING_STORE} does.
 *
 * Nothing in this module depends on WebGL or React.
 */

/**
 * Numbers baked into the offline light-atlas render. Only some are needed at
 * runtime; the rest are kept for provenance so the atlas can be re-baked.
 */
export const SCENE = {
  /** How the AO channel of the atlas was produced. Bake-time only. */
  ambientOcclusion: {
    broadRadiusPx: 52,
    broadStrength: 0.08,
    contactRadiusPx: 18,
    contactStrength: 0.22,
    coreStrength: 0.62,
  },
  /** HDR packing used when the atlas was rendered. Bake-time only. */
  bake: {
    intermediateMaxIrradiance: 16,
    packedValueMax: 65535,
    sourceTileHeight: 600,
    sourceTileWidth: 900,
  },
  canvasHeight: 800,
  canvasWidth: 1200,
  dotRadiusPx: 8,
  /**
   * Per-LED scaling of its colour contribution. Corner LEDs throw light
   * further than interior ones, so the bake is normalised back by hand.
   */
  colorReachCompensation: [0.25, 0.2, 0.27, 0.185, 0.285, 0.255, 0.25, 0.33, 0.3, 0.29],
  lightCount: 10,
  /** Peak linear radiance of a fully lit LED core. */
  peakRadiance: 8.5,
  /**
   * The pre-baked HDR light atlas.
   *
   * R/G/B each pack one *representative* light - index 0 (a corner), 1 (an edge
   * dot) and 4 (the centre). The remaining seven are reconstructed at sample
   * time by permuting barycentric coordinates inside the ▲, which is why the
   * whole effect fits in one 945 × 630 WebP. Alpha carries an ambient-occlusion
   * bake used only in light mode.
   */
  rgbAtlas: {
    /** Encoding gamma of the packed irradiance. */
    gamma: 2,
    tileHeight: 630,
    tileWidth: 945,
    /** Linear irradiance that maps to a packed value of 1.0. */
    maxIrradiance: 4.25,
    representativeLights: [0, 1, 4],
  },
} as const;

/** Where the atlas is served from. Override per-instance via `atlasSrc`. */
export const DEFAULT_ATLAS_SRC = "/hero/agent-light-atlas-rgb.webp";

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

export const CANVAS_WIDTH = SCENE.canvasWidth; // 1200
export const CANVAS_HEIGHT = SCENE.canvasHeight; // 800
export const LIGHT_COUNT = SCENE.lightCount; // 10
export const DOT_RADIUS = SCENE.dotRadiusPx; // 8
export const PEAK_RADIANCE = SCENE.peakRadiance; // 8.5

/** Horizontal gap between neighbouring LEDs, in virtual px. */
export const DOT_SPACING = 0.044 * CANVAS_HEIGHT; // 35.2
/** Vertical gap between LED rows. Slightly tighter than horizontal. */
export const DOT_VERTICAL_SPACING = 0.86 * DOT_SPACING; // 30.272
/** Highest value a weight may reach - the hovered LED is boosted to 3. */
export const MAX_LIGHT_WEIGHT = 4;
/** Edge length of the hashed noise texture baked at startup. */
export const GRAIN_SIZE = 400;
/** A pointer within this many virtual px of an LED counts as hovering it. */
export const HOVER_RADIUS_PX = 120;

/**
 * The ten LED centres, row-major from the apex down, in virtual px (y up).
 *
 * Rows hold 1, 2, 3 and 4 dots - the fourth triangular number. Index 0 is the
 * apex, 4 the centre, 6 and 9 the base corners.
 */
export const DOT_CENTERS: readonly (readonly [number, number])[] = Array.from(
  { length: 4 },
  (_, row) =>
    Array.from({ length: row + 1 }, (_, column): [number, number] => [
      0.5 * CANVAS_WIDTH + (column - 0.5 * row) * DOT_SPACING,
      0.5 * CANVAS_HEIGHT + (1.5 - row) * DOT_VERTICAL_SPACING,
    ]),
).flat();

/**
 * The *colour* triangle, which is deliberately larger than the dot triangle:
 * each of its three edges owns a primary, and every LED blends the three by
 * inverse-cube distance to the edge midpoints.
 */
export const TRIANGLE_BOTTOM_LEFT: readonly [number, number] = [526, 335];
export const TRIANGLE_BOTTOM_RIGHT: readonly [number, number] = [674, 335];
export const TRIANGLE_TOP: readonly [number, number] = [600, 468];

/** Linear-RGB primaries assigned to the three edges of the colour triangle. */
export const EDGE_RED = [0.896269, 0.027321, 0.051269] as const;
export const EDGE_GREEN = [0.0, 0.40724, 0.048172] as const;
export const EDGE_BLUE = [0.0, 0.278894, 1.0] as const;

/**
 * Per-LED linear light colour for the bloom pass, flattened to `vec3[10]`.
 *
 * The main fragment shader recomputes the identical blend on the GPU (it needs
 * the resolution uniform anyway); the bloom vertex shader takes it as a uniform
 * because a vertex shader would otherwise redo the work per corner.
 */
export const COLOR_LIGHT: Float32Array = (() => {
  const midpoint = (a: readonly [number, number], b: readonly [number, number]) =>
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5] as const;

  const redCentre = midpoint(TRIANGLE_TOP, TRIANGLE_BOTTOM_LEFT);
  const greenCentre = midpoint(TRIANGLE_BOTTOM_LEFT, TRIANGLE_BOTTOM_RIGHT);
  const blueCentre = midpoint(TRIANGLE_BOTTOM_RIGHT, TRIANGLE_TOP);
  /** ~0.8 × the triangle height - tuned so adjacent LEDs read as distinct hues. */
  const radius = (TRIANGLE_TOP[1] - greenCentre[1]) * 0.8; // 106.4

  const weightOf = (point: readonly [number, number], centre: readonly [number, number]) =>
    (1 / (1 + Math.hypot(point[0] - centre[0], point[1] - centre[1]) / radius)) ** 3;

  const out = new Float32Array(3 * LIGHT_COUNT);
  DOT_CENTERS.forEach((centre, index) => {
    const wRed = weightOf(centre, redCentre);
    const wGreen = weightOf(centre, greenCentre);
    const wBlue = weightOf(centre, blueCentre);
    const total = Math.max(wRed + wGreen + wBlue, 1e-4);

    const blended = EDGE_RED.map(
      (red, channel) =>
        (red * wRed + EDGE_GREEN[channel] * wGreen + EDGE_BLUE[channel] * wBlue) / total,
    );

    // Normalise to unit luminance so hue changes never change brightness, then
    // reapply this LED's authored reach.
    const luminance =
      blended[0] * 0.2126 + blended[1] * 0.7152 + blended[2] * 0.0722;
    const reach = SCENE.colorReachCompensation[index];
    for (let channel = 0; channel < 3; channel++) {
      out[3 * index + channel] = (blended[channel] / Math.max(luminance, 1e-4)) * reach;
    }
  });
  return out;
})();

// ---------------------------------------------------------------------------
// Backing store
// ---------------------------------------------------------------------------

/**
 * Two fixed backing-store sizes, both 2× the CSS size of their breakpoint so
 * the render is supersampled. Swapping between them is the only thing a resize
 * does - the virtual coordinate space never changes.
 */
export const BACKING_STORE = (() => {
  const smallHeight = SCENE.rgbAtlas.tileHeight * (4 / 3); // 840
  const smallWidth = SCENE.rgbAtlas.tileWidth * (4 / 3); // 1260
  const largeHeight = SCENE.rgbAtlas.tileHeight * 1.5; // 945
  const largeWidth = SCENE.rgbAtlas.tileWidth * 1.5; // 1417.5
  return {
    /** CSS size at the two breakpoints, exported for the stylesheet's benefit. */
    cssSize: {
      small: { width: smallWidth, height: smallHeight },
      large: { width: largeWidth, height: largeHeight },
    },
    small: { width: 2 * smallWidth, height: 2 * smallHeight }, // 2520 × 1680
    large: { width: 2 * largeWidth, height: 2 * largeHeight }, // 2835 × 1890
    /** Displayed height above which the large backing store is used. */
    thresholdPx: (smallHeight + largeHeight) / 2, // 892.5
  };
})();

/** Pick the backing store for a displayed canvas height in CSS px. */
export function backingStoreFor(displayHeight: number | undefined) {
  return displayHeight !== undefined && displayHeight > BACKING_STORE.thresholdPx
    ? BACKING_STORE.large
    : BACKING_STORE.small;
}

/**
 * Index of the LED nearest to a point in virtual space, or `-1` when nothing is
 * within `maxDistance`.
 */
export function nearestDot(x: number, y: number, maxDistance: number): number {
  let best = -1;
  let bestDistance = maxDistance;
  for (let index = 0; index < LIGHT_COUNT; index++) {
    const [cx, cy] = DOT_CENTERS[index];
    const distance = Math.hypot(x - cx, y - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}
