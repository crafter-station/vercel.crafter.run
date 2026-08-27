/**
 * The time axis of the animation: which LED lights when.
 *
 * The renderer only ever animates two things - a `weights[10]` array (per-LED
 * brightness, 0…4) and a scalar `colorMix` (white ↔ RGB). Every routine here
 * writes *target* weights for a moment in time; the frame loop then eases the
 * live weights toward those targets. Keeping the schedule pure like this means
 * the whole choreography is inspectable without a GPU.
 *
 * There are two sequences:
 *
 * - **Intro** - plays once after the atlas loads. A fast sparkle pass, a short
 *   settle to near-black, then a staggered fade-in from the centre outward.
 * - **Relight** - plays on every click. Skips straight to the staggered
 *   fade-in, but with delays radiating outward from the clicked LED.
 */

import { smoothstep01 } from "./math";
import { AGENT_SHADER_TIMING } from "./settings";
import { DOT_CENTERS, DOT_SPACING, LIGHT_COUNT } from "./scene";

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

/**
 * Per-LED delay before its fade-in starts, in ms. The centre LED (index 4)
 * leads at 0 and the three corners trail at 205, so the ▲ blooms outward.
 */
export const INTRO_DELAYS_MS: readonly number[] = [
  410, 300, 300, 160, 0, 160, 410, 300, 300, 410,
].map((delay) => delay / 2);

export const INTRO_MAX_DELAY_MS = Math.max(...INTRO_DELAYS_MS); // 205

// ---------------------------------------------------------------------------
// Sparkle (intro only)
// ---------------------------------------------------------------------------

/** Per-LED offset into the sparkle pass, in ms. Deliberately non-monotonic. */
export const SPARKLE_STAGGER: readonly number[] = [0, 800, 100, 700, 0, 200, 600, 500, 400, 300];

/** Duration of a single LED's flash within the sparkle pass. */
const SPARKLE_FLASH_MS = 900;
/** Full authored length of the sparkle pass. */
const SPARKLE_TOTAL_MS = Math.max(...SPARKLE_STAGGER) + SPARKLE_FLASH_MS; // 1700
/** The intro plays the sparkle at double speed, so it occupies half the time. */
export const SPARKLE_DURATION_MS = SPARKLE_TOTAL_MS / 2; // 850
/** Fade to near-black between the sparkle and the real fade-in. */
export const SPARKLE_SETTLE_MS = 240;
/** Elapsed time at which the staggered fade-in takes over. */
export const SPARKLE_END_MS = SPARKLE_DURATION_MS + SPARKLE_SETTLE_MS; // 1090

/** Floor brightness the sparkle never drops below, so the ▲ stays readable. */
const SPARKLE_BASELINE = 0.015;
/** The centre LED sits out the sparkle at an even lower floor. */
const SPARKLE_CENTRE_BASELINE = 0.003;
const CENTRE_INDEX = 4;

/** Brightness of one LED at `elapsedMs` into the (unscaled) sparkle pass. */
export function sparkleWeight(elapsedMs: number, index: number): number {
  if (index === CENTRE_INDEX) return SPARKLE_CENTRE_BASELINE;

  // Normalised progress through this LED's own flash: rise over the first 40%,
  // fall over the next 40%, dark for the remainder.
  const progress = (elapsedMs - SPARKLE_STAGGER[index]) / SPARKLE_FLASH_MS;
  let flash = 0;
  if (progress >= 0 && progress < 0.4) flash = smoothstep01(progress / 0.4);
  else if (progress >= 0.4 && progress < 0.8) flash = 1 - smoothstep01((progress - 0.4) / 0.4);

  return SPARKLE_BASELINE + (1 - SPARKLE_BASELINE) * flash;
}

// ---------------------------------------------------------------------------
// Relight (click)
// ---------------------------------------------------------------------------

/** Delay added per LED-spacing of distance from the clicked LED. */
const RELIGHT_MS_PER_SPACING = 70;

/**
 * Fill `delays` with a wavefront radiating out from `originIndex` and return
 * the largest delay written (the frame loop needs it to know when it is done).
 */
export function writeRelightDelays(delays: Float32Array, originIndex: number): number {
  const [originX, originY] = DOT_CENTERS[originIndex];
  let maxDelay = 0;
  for (let index = 0; index < LIGHT_COUNT; index++) {
    const [x, y] = DOT_CENTERS[index];
    const delay = (Math.hypot(x - originX, y - originY) / DOT_SPACING) * RELIGHT_MS_PER_SPACING;
    delays[index] = delay;
    maxDelay = Math.max(maxDelay, delay);
  }
  return maxDelay;
}

// ---------------------------------------------------------------------------
// Sequence evaluation
// ---------------------------------------------------------------------------

export interface SequenceFrame {
  /** Destination for this frame's target weights. Mutated in place. */
  targetWeights: Float32Array;
  /** Per-LED fade-in delays - intro delays, or a relight wavefront. */
  delays: Float32Array;
  /** Largest value in `delays`. */
  maxDelayMs: number;
  /** ms since the sequence started. Negative while the lead-in is still running. */
  elapsedMs: number;
  /** `true` for a click relight (fade-in only), `false` for the full intro. */
  isRelight: boolean;
}

/**
 * Write the target weights for one instant of a sequence.
 *
 * @returns `true` once the sequence has fully resolved (all weights at 1), at
 * which point the caller should stop evaluating it and hand control back to the
 * hover state machine.
 */
export function writeSequenceWeights({
  targetWeights,
  delays,
  maxDelayMs,
  elapsedMs,
  isRelight,
}: SequenceFrame): boolean {
  // A relight has no sparkle - it is only the staggered fade-in.
  if (isRelight) return writeFadeIn(targetWeights, delays, maxDelayMs, elapsedMs);

  // Lead-in: the atlas has landed but nothing should be visible yet.
  if (elapsedMs < 0) {
    targetWeights.fill(0);
    return false;
  }

  // Sparkle, at double speed.
  if (elapsedMs < SPARKLE_DURATION_MS) {
    const sparkleTime = 2 * elapsedMs;
    // Ramp the whole pass in over its first 300 ms so it does not pop.
    const ramp = smoothstep01(sparkleTime / 300);
    for (let index = 0; index < LIGHT_COUNT; index++) {
      targetWeights[index] = sparkleWeight(sparkleTime, index) * ramp;
    }
    return false;
  }

  // Settle: everything decays from its baseline to black.
  if (elapsedMs < SPARKLE_END_MS) {
    const decay = 1 - smoothstep01((elapsedMs - SPARKLE_DURATION_MS) / SPARKLE_SETTLE_MS);
    for (let index = 0; index < LIGHT_COUNT; index++) {
      targetWeights[index] =
        (index === CENTRE_INDEX ? SPARKLE_CENTRE_BASELINE : SPARKLE_BASELINE) * decay;
    }
    return false;
  }

  return writeFadeIn(targetWeights, delays, maxDelayMs, elapsedMs - SPARKLE_END_MS);
}

/** The staggered fade-in shared by the intro tail and every relight. */
function writeFadeIn(
  targetWeights: Float32Array,
  delays: Float32Array,
  maxDelayMs: number,
  elapsedMs: number,
): boolean {
  for (let index = 0; index < LIGHT_COUNT; index++) {
    targetWeights[index] = smoothstep01(
      (elapsedMs - delays[index]) / AGENT_SHADER_TIMING.lightFadeMs,
    );
  }
  if (elapsedMs < maxDelayMs + AGENT_SHADER_TIMING.lightFadeMs) return false;
  targetWeights.fill(1);
  return true;
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

/** Brightness multiplier applied to the hovered LED (others go to zero). */
export const HOVER_BOOST = 3;
/** After a click, hover is suppressed this long before re-arming. */
export const HOVER_REARM_MS = 1000;
/** Time constant of the white ↔ RGB cross-fade. */
export const COLOR_MIX_TIME_CONSTANT_MS = 70;
/** Longest frame delta the easing will honour, to survive tab stalls. */
export const MAX_FRAME_DELTA_MS = 50;
/** A weight this close to its target counts as arrived. */
export const SETTLED_EPSILON = 0.002;
