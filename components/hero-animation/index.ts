/**
 * Public surface of the hero animation.
 *
 * Most callers need only `HeroAnimation`. The rest is exported for the two
 * cases that come up in practice: tuning the look (`createShaderSettings`) and
 * reusing the geometry elsewhere (`DOT_CENTERS`, `FallbackTriangle`).
 */

export { HeroAnimation, type HeroAnimationProps } from "./hero-animation";
export { AgentShaderCanvas, type AgentShaderCanvasProps } from "./agent-shader-canvas";
export { FallbackTriangle, type FallbackTriangleProps } from "./fallback-triangle";

export {
  AGENT_SHADER_TIMING,
  createShaderSettings,
  DEFAULT_SHADER_SETTINGS,
  type AgentShaderSettings,
  type BloomSettings,
  type InteractionSettings,
  type LayoutSettings,
  type LightModeChannelSettings,
  type LightModeSettings,
  type NoiseSettings,
  type PhotographicSettings,
} from "./core/settings";

export {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_ATLAS_SRC,
  DOT_CENTERS,
  DOT_RADIUS,
  LIGHT_COUNT,
  SCENE,
} from "./core/scene";

export {
  createAgentShaderRenderer,
  type AgentShaderFrameState,
  type AgentShaderRenderer,
  type AgentShaderRendererOptions,
  type AgentShaderSequence,
} from "./core/renderer";

export {
  INTRO_DELAYS_MS,
  SPARKLE_DURATION_MS,
  SPARKLE_END_MS,
  SPARKLE_STAGGER,
  writeRelightDelays,
  writeSequenceWeights,
} from "./core/choreography";

export {
  useColorScheme,
  type ColorSchemePreference,
  type ResolvedColorScheme,
} from "./hooks/use-color-scheme";
export { usePrefersReducedMotion } from "./hooks/use-prefers-reduced-motion";
