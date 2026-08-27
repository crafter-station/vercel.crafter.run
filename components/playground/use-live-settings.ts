"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import {
  createShaderSettings,
  DEFAULT_SHADER_SETTINGS,
  type AgentShaderFrameState,
  type AgentShaderRenderer,
  type AgentShaderSettings,
  type PhotographicSettings,
} from "@/components/hero-animation";

/**
 * Editable shader settings, wired to a live renderer.
 *
 * This hook exists because the settings object is split down the middle, and
 * the two halves reach the GPU by completely different routes:
 *
 * - `bloom`, `noise`, `lightMode`, `interaction` are **uniforms**. They change
 *   on a running renderer by mutating the object and calling `applySettings()`.
 *   The object's identity must stay put, because the canvas uses it as an
 *   effect dependency - a new object would tear down the GL context.
 * - `photographic` is **baked into the GLSL** as constants. Changing it means
 *   new shader source, which means a new settings object (the shader cache is
 *   keyed on identity), which rebuilds the renderer and replays the intro.
 *   That is the correct, visible consequence of editing a baked constant.
 * - `layout` is neither - it is CSS, applied by the caller as custom properties.
 *
 * So the two halves are held as separate state, and the object handed to the
 * component is memoised on the compile-time half alone.
 */

/** The groups that are plain uniforms, plus `layout`, which is CSS. */
type EditableAtRuntime = Pick<
  AgentShaderSettings,
  "bloom" | "noise" | "lightMode" | "interaction" | "layout"
>;

/** Groups that are actually uniforms - `layout` never reaches the shader. */
const UNIFORM_KEYS = ["bloom", "noise", "lightMode", "interaction"] as const;

function pickRuntime(source: AgentShaderSettings): EditableAtRuntime {
  return structuredClone({
    bloom: source.bloom,
    noise: source.noise,
    lightMode: source.lightMode,
    interaction: source.interaction,
    layout: source.layout,
  });
}

export interface LiveSettings {
  /** The full, current values - what the controls read from. */
  draft: AgentShaderSettings;
  /** The identity-stable object to hand to `HeroAnimation`. */
  settings: AgentShaderSettings;
  /** Apply a mutation to a copy of the draft. */
  update: (patch: (draft: AgentShaderSettings) => void) => void;
  /** Restore every value to the shipped defaults. */
  reset: () => void;
}

export function useLiveSettings(
  rendererRef: RefObject<AgentShaderRenderer | null>,
): LiveSettings {
  const [photographic, setPhotographic] = useState<PhotographicSettings>(() =>
    structuredClone(DEFAULT_SHADER_SETTINGS.photographic),
  );
  const [runtime, setRuntime] = useState<EditableAtRuntime>(() =>
    pickRuntime(DEFAULT_SHADER_SETTINGS),
  );

  // Derived during render, not in an effect. The dependency list is the whole
  // point: this identity is the shader-cache key, so it must change when - and
  // only when - a baked constant changes.
  const settings = useMemo(() => createShaderSettings({ photographic }), [photographic]);

  const draft = useMemo<AgentShaderSettings>(
    () => ({ version: DEFAULT_SHADER_SETTINGS.version, photographic, ...runtime }),
    [photographic, runtime],
  );

  // Push the uniform half into the stable object and re-upload. This also runs
  // right after a recompile, where the fresh object still holds default
  // uniforms - the renderer is being rebuilt at that moment anyway.
  useEffect(() => {
    for (const key of UNIFORM_KEYS) {
      Object.assign(settings, { [key]: structuredClone(runtime[key]) });
    }
    rendererRef.current?.applySettings();
  }, [runtime, settings, rendererRef]);

  const update = useCallback(
    (patch: (next: AgentShaderSettings) => void) => {
      const next = structuredClone(draft);
      patch(next);

      if (JSON.stringify(next.photographic) !== JSON.stringify(draft.photographic)) {
        setPhotographic(next.photographic);
        return;
      }
      setRuntime(pickRuntime(next));
    },
    [draft],
  );

  const reset = useCallback(() => {
    setPhotographic(structuredClone(DEFAULT_SHADER_SETTINGS.photographic));
    setRuntime(pickRuntime(DEFAULT_SHADER_SETTINGS));
  }, []);

  return { draft, settings, update, reset };
}

/**
 * Poll the renderer's frame state.
 *
 * The inspector runs its own animation-frame loop but only commits to React
 * when a displayed value actually moves, so a settled hero re-renders nothing.
 * Note that this loop is *not* evidence of the hero being busy - the renderer's
 * own `framesRendered` counter is the honest measure, and it stops climbing
 * while this keeps ticking.
 */
export function useFrameState(
  rendererRef: RefObject<AgentShaderRenderer | null>,
): AgentShaderFrameState | null {
  const [state, setState] = useState<AgentShaderFrameState | null>(null);

  useEffect(() => {
    let raf = 0;
    let signature = "";

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next = rendererRef.current?.getFrameState();
      if (!next) return;

      // Quantise before comparing: sub-perceptual drift should not re-render.
      const nextSignature = [
        next.framesRendered,
        next.running,
        next.sequence,
        next.hoverIndex,
        next.colorMix.toFixed(3),
      ].join("|");

      if (nextSignature === signature) return;
      signature = nextSignature;
      setState(next);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rendererRef]);

  return state;
}
