"use client";

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { AgentShaderCanvas } from "./agent-shader-canvas";
import type { AgentShaderRenderer } from "./core/renderer";
import { FallbackTriangle } from "./fallback-triangle";
import { createShaderSettings, type AgentShaderSettings } from "./core/settings";
import { useColorScheme, type ColorSchemePreference } from "./hooks/use-color-scheme";
import { usePrefersReducedMotion } from "./hooks/use-prefers-reduced-motion";
import styles from "./hero-animation.module.css";

export interface HeroAnimationProps {
  /** Appended to the root element's class list. */
  className?: string;
  /** Inline styles on the root - handy for the `--hero-animation-*` knobs. */
  style?: CSSProperties;
  /**
   * Force a colour scheme instead of following the page.
   *
   * @default "system"
   */
  colorScheme?: ColorSchemePreference;
  /**
   * Hover and click interaction. Turn it off for a purely decorative hero, or
   * where a document-level pointer listener would be unwelcome.
   *
   * @default true
   */
  interactive?: boolean;
  /**
   * Where the pre-baked light atlas lives.
   *
   * @default "/hero/agent-light-atlas-rgb.webp"
   */
  atlasSrc?: string;
  /**
   * Shader tunables. Must be referentially stable - build it once with
   * `createShaderSettings()`. Omit it to use the shipped defaults.
   */
  settings?: AgentShaderSettings;
  /**
   * Receives the live renderer when one is created, and `null` when it is torn
   * down. Only needed to inspect or script the animation - see the playground.
   */
  onRenderer?: (renderer: AgentShaderRenderer | null) => void;
  /**
   * Rendered on top of the canvas, in the stage's exact box.
   *
   * Use it to align annotations with the LEDs: an `<svg viewBox="0 0 1200 800">`
   * child lands in the same virtual space the shader is authored in - but note
   * that space is y-up while SVG is y-down, so mirror with `800 - y`.
   */
  overlay?: ReactNode;
}

/**
 * The vercel.com hero animation: a ▲ of ten LEDs lighting a dark room.
 *
 * Fills its parent, so give the parent a size:
 *
 * ```tsx
 * <div className="relative h-svh w-full">
 *   <HeroAnimation />
 * </div>
 * ```
 *
 * ## What it does
 *
 * - Fades in from a server-rendered SVG of the same ▲, so there is no layout
 *   shift and no blank frame.
 * - Lights the LEDs from the centre outward once the light atlas has decoded.
 * - Brightens whichever LED the mouse is nearest and dims the rest.
 * - On click, toggles between the white and RGB palettes and relights the ▲ in
 *   a wave radiating from the LED you clicked.
 * - Renders on demand: when nothing is easing, no frames are scheduled at all.
 *   It also stops entirely while off screen or in a background tab.
 * - Falls back to the static SVG on anything without WebGL2, and honours
 *   `prefers-reduced-motion` by lighting the LEDs without the sequences.
 *
 * @see ./README.md for the architecture and the tuning knobs.
 */
export function HeroAnimation({
  className,
  style,
  colorScheme = "system",
  interactive = true,
  atlasSrc,
  settings,
  onRenderer,
  overlay,
}: HeroAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Distinct from `!ready`: this means the shader will never arrive, not that
  // it has not arrived yet. The placeholder becomes visible rather than staying
  // invisible, so a device without WebGL2 still sees the ▲.
  const [unavailable, setUnavailable] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  const resolvedColorScheme = useColorScheme(colorScheme);

  // Only used when the caller does not supply their own; the initialiser keeps
  // the identity stable across renders, which the shader cache relies on.
  const [defaultSettings] = useState(createShaderSettings);
  const activeSettings = settings ?? defaultSettings;

  const handleReady = useCallback(() => {
    setReady(true);
    setUnavailable(false);
  }, []);
  const handleUnavailable = useCallback(() => {
    setReady(false);
    setUnavailable(true);
  }, []);

  const rootStyle: CSSProperties = {
    "--hero-animation-scale": String(activeSettings.layout.scalePercent / 100),
    "--hero-animation-offset-y": `${activeSettings.layout.offsetYPercent}%`,
    ...style,
  } as CSSProperties;

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      data-hero-animation=""
      // Omitted for "system" so the stylesheet's own media and theme queries win.
      data-color-scheme={colorScheme === "system" ? undefined : colorScheme}
      data-unavailable={unavailable || undefined}
      ref={rootRef}
      style={rootStyle}
    >
      <div className={styles.layout}>
        <FallbackTriangle
          className={`${styles.stage} ${styles.fallbackDots}`}
          visible={!ready}
        />
        <AgentShaderCanvas
          atlasSrc={atlasSrc}
          className={`${styles.stage} ${styles.canvas}`}
          colorScheme={resolvedColorScheme}
          hitAreaRef={rootRef}
          interactive={interactive}
          onReady={handleReady}
          onRenderer={onRenderer}
          onUnavailable={handleUnavailable}
          reduceMotion={reduceMotion}
          settings={activeSettings}
          visible={ready}
        />
        {overlay ? (
          <div className={styles.stage} data-hero-animation-overlay="" data-visible="true">
            {overlay}
          </div>
        ) : null}
      </div>
    </div>
  );
}
