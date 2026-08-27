/**
 * Small numeric helpers shared by the renderer and the choreography module.
 *
 * Everything here is pure and framework-free so it can be unit tested without a
 * WebGL context.
 */

/** Clamp to the unit interval. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** `smoothstep(0, 1, value)` - the classic 3t² − 2t³ ease used by the intro fades. */
export function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/**
 * Frame-rate independent lerp factor for an exponential approach with time
 * constant `timeConstantMs`: after one time constant the value has covered
 * ~63% of the remaining distance.
 *
 * Used for the white ↔ colour cross-fade (τ = 70 ms).
 */
export function approachRate(deltaMs: number, timeConstantMs: number): number {
  return 1 - Math.exp(-deltaMs / timeConstantMs);
}

/**
 * `Math.log(0.002)` - the settle threshold behind {@link settleRate}.
 *
 * The hover fade durations in the settings are authored as "time to visually
 * arrive", not as a time constant. Feeding this constant into the exponent
 * makes the easing cover 99.8% of the distance in exactly `durationMs`.
 */
const LN_SETTLE = Math.log(0.002);

/**
 * Frame-rate independent lerp factor that reaches 99.8% of the target after
 * `durationMs`. Used for the per-dot hover brighten/dim easing.
 */
export function settleRate(deltaMs: number, durationMs: number): number {
  return 1 - Math.exp((LN_SETTLE * deltaMs) / durationMs);
}

/** `#rrggbb` → linear-ish 0..1 RGB triple. Falls back to white on bad input. */
export function hexToRgb01(hex: string): [number, number, number] {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return [r, g, b].every(Number.isFinite) ? [r / 255, g / 255, b / 255] : [1, 1, 1];
}
