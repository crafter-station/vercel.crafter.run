"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { createAgentShaderRenderer, type AgentShaderRenderer } from "./core/renderer";
import { BACKING_STORE, DEFAULT_ATLAS_SRC } from "./core/scene";
import type { AgentShaderSettings } from "./core/settings";
import type { ResolvedColorScheme } from "./hooks/use-color-scheme";
import { useBorderBoxHeight } from "./hooks/use-border-box-height";
import { useRenderActivity } from "./hooks/use-render-activity";

export interface AgentShaderCanvasProps {
  /**
   * Stable settings object. It keys the shader cache and rebuilds the renderer
   * when it changes, so create it once - see `createShaderSettings`.
   */
  settings: AgentShaderSettings;
  /** Resolved scheme for the shader's own light/dark output. */
  colorScheme: ResolvedColorScheme;
  /** Skips the intro and relight sequences. */
  reduceMotion: boolean;
  /** Drives the `data-visible` attribute the stylesheet cross-fades on. */
  visible: boolean;
  className?: string;
  /** Where the pre-baked light atlas is served from. */
  atlasSrc?: string;
  /** Attach the document-level hover and click handlers. */
  interactive?: boolean;
  /**
   * Element whose box limits pointer interaction. The canvas overhangs its
   * container by design, so this keeps the LEDs interactive only where they are
   * actually visible.
   */
  hitAreaRef?: RefObject<HTMLElement | null>;
  /** The atlas has landed and the first real frame is on screen. */
  onReady?: () => void;
  /** WebGL is gone (unsupported, or the context was lost). Show the fallback. */
  onUnavailable?: () => void;
  /**
   * Receives the live renderer when one is created, and `null` when it is torn
   * down. Only needed to inspect or script the animation - see the playground.
   */
  onRenderer?: (renderer: AgentShaderRenderer | null) => void;
}

/**
 * React binding for {@link createAgentShaderRenderer}.
 *
 * The split is deliberate: React owns mounting, sizing signals and theme, while
 * the renderer owns every frame. Nothing that happens at 60 fps passes through
 * a `setState`.
 *
 * The one piece of React state here is `contextKey`, bumped on
 * `webglcontextrestored` to force a full renderer rebuild - the old GL objects
 * are gone at that point and cannot be revived.
 */
export function AgentShaderCanvas({
  settings,
  colorScheme,
  reduceMotion,
  visible,
  className,
  atlasSrc = DEFAULT_ATLAS_SRC,
  interactive = true,
  hitAreaRef,
  onReady,
  onUnavailable,
  onRenderer,
}: AgentShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AgentShaderRenderer | null>(null);
  const [contextKey, setContextKey] = useState(0);

  // Callbacks are read through refs so an inline arrow from the caller never
  // tears down and rebuilds the GL context. The theme goes the same way: it is
  // pushed into the live renderer below, never used as a rebuild key.
  const onReadyRef = useRef(onReady);
  const onUnavailableRef = useRef(onUnavailable);
  const onRendererRef = useRef(onRenderer);
  const colorSchemeRef = useRef(colorScheme);
  useEffect(() => {
    onReadyRef.current = onReady;
    onUnavailableRef.current = onUnavailable;
    onRendererRef.current = onRenderer;
    colorSchemeRef.current = colorScheme;
  });

  const heightRef = useBorderBoxHeight(canvasRef, (height) => {
    rendererRef.current?.resize(height);
  });

  const activeRef = useRenderActivity(canvasRef, (active) => {
    rendererRef.current?.setActive(active);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleContextLost = (event: Event) => {
      // Preventing the default is what makes `webglcontextrestored` fire later.
      event.preventDefault();
      onUnavailableRef.current?.();
    };
    const handleContextRestored = () => setContextKey((key) => key + 1);

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);

    const renderer = createAgentShaderRenderer({
      canvas,
      atlasSrc,
      settings,
      active: activeRef.current,
      lightMode: colorSchemeRef.current === "light",
      reduceMotion,
      interactive,
      displayHeight: heightRef.current,
      getHitBounds: () => hitAreaRef?.current?.getBoundingClientRect() ?? null,
      onReady: () => onReadyRef.current?.(),
    });

    if (!renderer) {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      onUnavailableRef.current?.();
      return;
    }

    rendererRef.current = renderer;
    onRendererRef.current?.(renderer);

    return () => {
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      onRendererRef.current?.(null);
      renderer.destroy();
      if (rendererRef.current === renderer) rendererRef.current = null;
    };
  }, [activeRef, atlasSrc, contextKey, heightRef, hitAreaRef, interactive, reduceMotion, settings]);

  useEffect(() => {
    rendererRef.current?.setLightMode(colorScheme === "light");
  }, [colorScheme]);

  return (
    <canvas
      aria-hidden
      className={className}
      data-hero-animation-canvas=""
      data-visible={visible}
      // Sized up front so the browser never lays out the 300x150 default.
      height={BACKING_STORE.small.height}
      ref={canvasRef}
      width={BACKING_STORE.small.width}
    />
  );
}
