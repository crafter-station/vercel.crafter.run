/**
 * Runtime tunables for the hero animation.
 *
 * ## Compile-time vs. runtime
 *
 * The GLSL bakes a handful of these values in as `const` literals for speed, so
 * they behave differently once a renderer exists:
 *
 * | group                          | when it applies                                  |
 * | ------------------------------ | ------------------------------------------------ |
 * | `photographic`                 | **compile time** - baked into the fragment shader |
 * | `bloom`, `lightMode`, `noise`  | **runtime uniforms** - `renderer.applySettings()` |
 * | `interaction`                  | **runtime** - read by the frame loop              |
 * | `layout`                       | **runtime** - CSS custom properties on the root   |
 *
 * Because `photographic` is baked, shaders are compiled per settings *object*
 * (see `getAgentShaders` in `./shaders`). Mutating `settings.photographic`
 * after mount has no effect; pass a new settings object instead.
 */

/** Film-emulation grade applied once, after all ten lights are summed in HDR. */
export interface PhotographicSettings {
  /** Subtracted from linear RGB before tone mapping, to crush near-black noise. */
  blackPoint: number;
  /** S-curve strength in the RGB (colour) palette. */
  colorContrast: number;
  /** Exposure offset in stops for the RGB palette. */
  colorExposureEv: number;
  /** Pivot around which contrast rotates. */
  midtonePivot: number;
  /** Highlight roll-off knee for the neutral tone mapper. */
  neutralCompressionStart: number;
  /** How much the roll-off desaturates highlights toward white. */
  neutralHighlightDesaturation: number;
  /** Final saturation multiplier. */
  saturation: number;
  /** S-curve strength in the white palette. */
  whiteContrast: number;
  /** Exposure offset in stops for the white palette. */
  whiteExposureEv: number;
}

/** Hover easing durations (time to visually arrive, not time constants). */
export interface InteractionSettings {
  hoverFadeInMs: number;
  hoverFadeOutMs: number;
}

/**
 * Bloom is a 10-instance quad pass, not a blur: each LED gets an 11 px quad
 * shaded by an editable cubic-Bezier point-spread function.
 */
export interface BloomSettings {
  enabled: boolean;
  /** Control points of the falloff curve: `(x1, y1)` and `(x2, y2)`. */
  falloffCurve: { x1: number; y1: number; x2: number; y2: number };
  /** Quad half-size beyond the LED radius, in virtual px. */
  radiusPx: number;
  whiteStrength: number;
  colorStrength: number;
}

/**
 * Light mode paints premultiplied alpha over the page instead of an opaque
 * frame, so it needs its own shadow model: an atlas-baked ambient occlusion
 * term plus a broad radial shadow that both fade out at the canvas edge.
 */
export interface LightModeChannelSettings {
  ambientOcclusionStrength: number;
  /** Fraction of the shadow that grain is allowed to erase (breaks up banding). */
  shadowGrainRemovalStrength: number;
  /** Multiplier on the emitted glow before it becomes alpha. */
  glowStrength: number;
  radialInnerRadiusPx: number;
  radialOuterRadiusPx: number;
  radialPower: number;
  radialShadowStrength: number;
}

export interface LightModeSettings {
  /** Colour of an LED that is powered but not yet lit, in light mode. */
  unlitDotColor: string;
  /** Parameters used while the RGB palette is showing. */
  color: LightModeChannelSettings;
  /** Parameters used while the white palette is showing. */
  white: LightModeChannelSettings;
}

/** Hashed 400×400 noise texture, baked once on the GPU at startup. */
export interface NoiseSettings {
  enabled: boolean;
  /** Apply ±4% multiplicative grain to the graded colour. */
  multiply: boolean;
  /** Jitter atlas lookups by up to ±13.5 px outside the colour triangle. */
  sampleOffset: boolean;
  /** Debug: render the distortion ramp instead of the scene. */
  showOffsetScale: boolean;
}

/** Transform applied to the whole stage, so the ▲ can sit off-centre. */
export interface LayoutSettings {
  scalePercent: number;
  offsetYPercent: number;
}

export interface AgentShaderSettings {
  /** Bumped by upstream whenever the tunable set changes shape. */
  version: number;
  layout: LayoutSettings;
  photographic: PhotographicSettings;
  interaction: InteractionSettings;
  bloom: BloomSettings;
  lightMode: LightModeSettings;
  noise: NoiseSettings;
}

/** The values the production hero ships with (upstream settings `version: 21`). */
export const DEFAULT_SHADER_SETTINGS: AgentShaderSettings = {
  version: 21,
  layout: { scalePercent: 120, offsetYPercent: 2.5 },
  photographic: {
    blackPoint: 0.003,
    colorContrast: 1.05,
    colorExposureEv: 0.15,
    midtonePivot: 0.05,
    neutralCompressionStart: 0.76,
    neutralHighlightDesaturation: 0.15,
    saturation: 1.31,
    whiteContrast: 0.96,
    whiteExposureEv: -1.2,
  },
  interaction: { hoverFadeInMs: 850, hoverFadeOutMs: 1650 },
  bloom: {
    enabled: true,
    falloffCurve: { x1: 0.602, y1: 1, x2: 0.612, y2: 0 },
    radiusPx: 3,
    whiteStrength: 1,
    colorStrength: 1,
  },
  lightMode: {
    unlitDotColor: "#757575",
    color: {
      ambientOcclusionStrength: 0.21,
      shadowGrainRemovalStrength: 0.06,
      glowStrength: 1.25,
      radialInnerRadiusPx: 27,
      radialOuterRadiusPx: 399,
      radialPower: 2.9,
      radialShadowStrength: 0.38,
    },
    white: {
      ambientOcclusionStrength: 0.31,
      shadowGrainRemovalStrength: 0.06,
      glowStrength: 1.41,
      radialInnerRadiusPx: 0,
      radialOuterRadiusPx: 545,
      radialPower: 2,
      radialShadowStrength: 0.42,
    },
  },
  noise: {
    enabled: true,
    multiply: true,
    sampleOffset: true,
    showOffsetScale: false,
  },
};

/** Timing shared between the shader and anything that wants to sync to it. */
export const AGENT_SHADER_TIMING = {
  /** Delay between the atlas landing and the first LED starting to glow. */
  fadeInMs: 160,
  /** Duration of a single LED's fade-in. */
  lightFadeMs: 300,
  /** When the upstream hero headline starts typing. Kept for parity. */
  typingStartMs: 950,
} as const;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build a settings object by deep-merging `overrides` onto the defaults.
 *
 * Call this **once** (e.g. in a `useState` initialiser or module scope) and
 * keep the identity stable: the renderer and the shader cache are both keyed on
 * object identity, so a fresh object every render would recompile the shaders.
 *
 * ```ts
 * const settings = useMemo(
 *   () => createShaderSettings({ bloom: { radiusPx: 6 }, layout: { scalePercent: 100 } }),
 *   [],
 * );
 * ```
 */
export function createShaderSettings(
  overrides: DeepPartial<AgentShaderSettings> = {},
  base: AgentShaderSettings = DEFAULT_SHADER_SETTINGS,
): AgentShaderSettings {
  const merge = (target: unknown, patch: unknown): unknown => {
    if (!isPlainObject(target) || !isPlainObject(patch)) return patch;
    const out: Record<string, unknown> = { ...target };
    for (const key of Object.keys(patch)) {
      if (patch[key] !== undefined) out[key] = merge(target[key], patch[key]);
    }
    return out;
  };
  return merge(structuredClone(base), overrides) as AgentShaderSettings;
}
