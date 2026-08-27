/**
 * The imperative WebGL2 renderer.
 *
 * This module owns everything that must not go through React: the GL context,
 * the animation state machine, the pointer hit-testing and the `requestAnimation
 * Frame` loop. `AgentShaderCanvas` creates one of these, forwards four
 * lifecycle signals to it (`resize`, `setActive`, `setLightMode`,
 * `applySettings`) and otherwise stays out of the way.
 *
 * ## Design notes
 *
 * - **No idle loop.** Frames are scheduled only while something is easing. Once
 *   the weights settle the RAF chain stops and the GPU goes quiet, which is why
 *   the effect can sit on a marketing page without costing battery.
 * - **Two animated values.** Everything visible is a function of `weights[10]`
 *   and `colorMix`. There is no per-frame geometry or texture work.
 * - **Failure is a `null` return.** No WebGL2, a shader that will not compile,
 *   an incomplete framebuffer - all of them mean "the caller should keep the
 *   static SVG on screen", not "throw".
 */

import { loadLightAtlas } from "./atlas";
import {
  COLOR_MIX_TIME_CONSTANT_MS,
  HOVER_BOOST,
  HOVER_REARM_MS,
  INTRO_DELAYS_MS,
  INTRO_MAX_DELAY_MS,
  MAX_FRAME_DELTA_MS,
  SETTLED_EPSILON,
  writeRelightDelays,
  writeSequenceWeights,
} from "./choreography";
import { createProgram, createUniforms } from "./gl";
import { approachRate, hexToRgb01, settleRate } from "./math";
import {
  backingStoreFor,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  COLOR_LIGHT,
  GRAIN_SIZE,
  HOVER_RADIUS_PX,
  LIGHT_COUNT,
  nearestDot,
  TRIANGLE_BOTTOM_LEFT,
  TRIANGLE_BOTTOM_RIGHT,
  TRIANGLE_TOP,
} from "./scene";
import { getAgentShaders, SHADER_RESOLUTION } from "./shaders";
import { AGENT_SHADER_TIMING, type AgentShaderSettings } from "./settings";

/** How far the atlas lookup may drift outside the colour triangle, in px. */
const MAX_DISTORTION_PX = 13.5;
/** Distance over which that drift ramps in. */
const DISTORTION_RAMP_PX = 420;
/** Width of the transparent border that hides the canvas edge. */
const EDGE_FEATHER_PX = 160;
/** Amplitude of the multiplicative grain. */
const GRAIN_MULTIPLY_STRENGTH = 0.04;

export interface AgentShaderRendererOptions {
  /** The canvas to take a WebGL2 context on. Owned by the renderer once passed. */
  canvas: HTMLCanvasElement;
  /** Where to fetch the pre-baked light atlas from. */
  atlasSrc: string;
  /** Stable settings object; also the key of the shader cache. */
  settings: AgentShaderSettings;
  /** Whether the canvas is on screen and the tab is visible. */
  active: boolean;
  /** `true` renders premultiplied alpha for a light page, `false` opaque. */
  lightMode: boolean;
  /** Skip the intro and relight sequences; clicks still toggle the palette. */
  reduceMotion: boolean;
  /** Attach the document-level pointer listeners for hover and click. */
  interactive: boolean;
  /** Displayed canvas height in CSS px, used to pick the backing store. */
  displayHeight?: number;
  /**
   * Restrict pointer hit-testing to this rect, in client coordinates.
   *
   * The stage is deliberately larger than its container and clipped by it, so
   * without this the LEDs stay interactive across a band of the page where they
   * are not even visible. Defaults to the canvas box.
   */
  getHitBounds?: () => DOMRect | null;
  /** Fired once the atlas has been uploaded and the first real frame drawn. */
  onReady: () => void;
}

/** Which sequence, if any, currently owns the weights. */
export type AgentShaderSequence = "idle" | "intro" | "relight";

/**
 * A read-only snapshot of what the renderer is animating right now.
 *
 * Exists so tooling can watch the two values that drive the whole effect
 * without reaching into the closure. Nothing in the animation depends on it.
 */
export interface AgentShaderFrameState {
  /** Live per-LED brightness, 0…4. A fresh copy; safe to keep. */
  weights: Float32Array;
  /** 0 = white palette, 1 = RGB palette. */
  colorMix: number;
  /** LED under the pointer, or -1. */
  hoverIndex: number;
  /** `true` while a frame is scheduled - i.e. something is still easing. */
  running: boolean;
  sequence: AgentShaderSequence;
  /** ms into the running sequence; negative during its lead-in, `null` if idle. */
  sequenceElapsedMs: number | null;
  /**
   * Total draws since the renderer was created.
   *
   * The honest measure of what this effect costs: watch it stop climbing the
   * moment everything settles.
   */
  framesRendered: number;
}

export interface AgentShaderRenderer {
  /** Re-upload every runtime uniform from the settings object and redraw. */
  applySettings(): void;
  /** Release the context's resources and detach all listeners. */
  destroy(): void;
  /** Swap the backing store if the displayed height crossed the threshold. */
  resize(displayHeight: number): void;
  /** Start or stop the frame loop. */
  setActive(active: boolean): void;
  /** Switch between the opaque (dark) and premultiplied (light) output. */
  setLightMode(lightMode: boolean): void;

  // --- Introspection and scripted control ---------------------------------
  // Not needed to display the animation. These exist so a debug UI can observe
  // and drive the state machine that pointer input normally drives.

  /** Snapshot the two animated values, plus what is driving them. */
  getFrameState(): AgentShaderFrameState;
  /** Cross-fade to a palette without the click's relight sequence. */
  setPalette(palette: "white" | "color"): void;
  /** Replay the full intro: sparkle, settle, then light from the centre out. */
  playIntro(): void;
  /**
   * Run a relight wavefront outward from one LED, exactly as a click there
   * would - but without toggling the palette.
   */
  relightFrom(index: number): void;
}

export function createAgentShaderRenderer({
  canvas,
  atlasSrc,
  settings,
  active,
  lightMode,
  reduceMotion,
  interactive,
  displayHeight,
  getHitBounds,
  onReady,
}: AgentShaderRendererOptions): AgentShaderRenderer | null {
  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    // The 2x backing store is the antialiasing; MSAA on top would be wasted.
    antialias: false,
    depth: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
    stencil: false,
  });
  if (!gl) return null;

  const shaders = getAgentShaders(settings);

  let backing = backingStoreFor(displayHeight);
  canvas.width = backing.width;
  canvas.height = backing.height;

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------
  const mainProgram = createProgram(gl, shaders.vertexShader, shaders.fragmentShader, "main");
  const grainProgram = createProgram(
    gl,
    shaders.vertexShader,
    shaders.grainBakeFragmentShader,
    "grain bake",
  );
  const bloomProgram = createProgram(
    gl,
    shaders.bloomVertexShader,
    shaders.bloomFragmentShader,
    "bloom",
  );
  // Every draw is generated from gl_VertexID / gl_InstanceID, so the VAO exists
  // purely because WebGL2 requires one to be bound.
  const vao = gl.createVertexArray();
  const atlasTexture = gl.createTexture();
  const grainTexture = gl.createTexture();
  const grainFramebuffer = gl.createFramebuffer();

  /** Delete everything allocated so far. Safe to call at any point. */
  const releaseResources = () => {
    if (grainFramebuffer) gl.deleteFramebuffer(grainFramebuffer);
    if (grainProgram) gl.deleteProgram(grainProgram);
    if (bloomProgram) gl.deleteProgram(bloomProgram);
    if (mainProgram) gl.deleteProgram(mainProgram);
    if (atlasTexture) gl.deleteTexture(atlasTexture);
    if (grainTexture) gl.deleteTexture(grainTexture);
    if (vao) gl.deleteVertexArray(vao);
  };

  if (!mainProgram || !grainProgram || !bloomProgram || !vao || !atlasTexture || !grainTexture || !grainFramebuffer) {
    releaseResources();
    return null;
  }

  // -------------------------------------------------------------------------
  // Textures, and the one-off grain bake
  // -------------------------------------------------------------------------
  gl.viewport(0, 0, backing.width, backing.height);
  gl.bindVertexArray(vao);

  // TEXTURE0 - the light atlas. A 1x1 transparent texel stands in until the
  // WebP decodes, so the first frames are simply empty rather than undefined.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  // TEXTURE1 - hashed noise. NEAREST + REPEAT so it tiles one texel per render
  // texel and never interpolates into mush.
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, grainTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRAIN_SIZE, GRAIN_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, grainFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, grainTexture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    releaseResources();
    return null;
  }
  gl.viewport(0, 0, GRAIN_SIZE, GRAIN_SIZE);
  gl.useProgram(grainProgram);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  // The bake happens exactly once; neither the FBO nor its program is needed again.
  gl.deleteFramebuffer(grainFramebuffer);
  gl.deleteProgram(grainProgram);
  gl.viewport(0, 0, backing.width, backing.height);

  // -------------------------------------------------------------------------
  // Uniforms
  // -------------------------------------------------------------------------
  const main = createUniforms(gl, mainProgram, {
    atlas: ["1i", "uAtlas"],
    colorAmbientOcclusionStrength: ["1f", "uColorLightAmbientOcclusionStrength"],
    colorGlowStrength: ["1f", "uColorLightGlowStrength"],
    colorGrainRemovalStrength: ["1f", "uColorLightShadowGrainRemovalStrength"],
    colorMix: ["1f", "uColorMix"],
    colorRadialInnerRadius: ["1f", "uColorLightRadialInnerRadiusPx"],
    colorRadialOuterRadius: ["1f", "uColorLightRadialOuterRadiusPx"],
    colorRadialPower: ["1f", "uColorLightRadialPower"],
    colorRadialShadowStrength: ["1f", "uColorLightRadialShadowStrength"],
    distortionRamp: ["1f", "uDistortionRampPx"],
    edgeFeather: ["1f", "uEdgeFeatherPx"],
    grain: ["1i", "uGrain"],
    grainMultiplyStrength: ["1f", "uGrainMultiplyStrength"],
    lightMode: ["1f", "uLightMode"],
    lightModeUnlitDotColor: ["3fv", "uLightModeUnlitDotColor"],
    maxDistortion: ["1f", "uMaxDistortionPx"],
    resolution: ["2f", "uResolution"],
    showOffsetScale: ["1f", "uShowOffsetScale"],
    triangleBottomLeft: ["2f", "uTriangleBottomLeft"],
    triangleBottomRight: ["2f", "uTriangleBottomRight"],
    triangleTop: ["2f", "uTriangleTop"],
    weights: ["1fv", "uWeights[0]"],
    whiteAmbientOcclusionStrength: ["1f", "uWhiteLightAmbientOcclusionStrength"],
    whiteGlowStrength: ["1f", "uWhiteLightGlowStrength"],
    whiteGrainRemovalStrength: ["1f", "uWhiteLightShadowGrainRemovalStrength"],
    whiteRadialInnerRadius: ["1f", "uWhiteLightRadialInnerRadiusPx"],
    whiteRadialOuterRadius: ["1f", "uWhiteLightRadialOuterRadiusPx"],
    whiteRadialPower: ["1f", "uWhiteLightRadialPower"],
    whiteRadialShadowStrength: ["1f", "uWhiteLightRadialShadowStrength"],
  } as const);

  const bloom = createUniforms(gl, bloomProgram, {
    colorLight: ["3fv", "uColorLight[0]"],
    colorGlowStrength: ["1f", "uColorLightGlowStrength"],
    colorMix: ["1f", "uColorMix"],
    colorStrength: ["1f", "uColorBloomStrength"],
    falloffCurve: ["4f", "uBloomFalloffCurve"],
    lightMode: ["1f", "uLightMode"],
    radius: ["1f", "uBloomRadiusPx"],
    resolution: ["2f", "uResolution"],
    weights: ["1fv", "uWeights[0]"],
    whiteGlowStrength: ["1f", "uWhiteLightGlowStrength"],
    whiteStrength: ["1f", "uWhiteBloomStrength"],
  } as const);

  main.set({
    atlas: 0,
    grain: 1,
    distortionRamp: DISTORTION_RAMP_PX,
    edgeFeather: EDGE_FEATHER_PX,
    lightMode: Number(lightMode),
    resolution: SHADER_RESOLUTION,
    triangleBottomLeft: TRIANGLE_BOTTOM_LEFT,
    triangleBottomRight: TRIANGLE_BOTTOM_RIGHT,
    triangleTop: TRIANGLE_TOP,
  });
  bloom.set({
    colorLight: COLOR_LIGHT,
    lightMode: Number(lightMode),
    resolution: SHADER_RESOLUTION,
  });

  // Additive colour, standard alpha - the bloom quads add light to the scene
  // while still compositing correctly against the page in light mode.
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // -------------------------------------------------------------------------
  // Animation state
  // -------------------------------------------------------------------------
  let destroyed = false;
  let isActive = active;

  /** Live per-LED brightness, uploaded every frame. */
  const weights = new Float32Array(LIGHT_COUNT);
  /** Where the choreography wants each LED to be right now. */
  const targetWeights = new Float32Array(LIGHT_COUNT);
  /** Per-LED fade-in delay: the intro schedule, or a relight wavefront. */
  const delays = new Float32Array(INTRO_DELAYS_MS);
  let maxDelayMs = INTRO_MAX_DELAY_MS;

  /** `performance.now()` the current sequence started, or `null` when idle. */
  let sequenceStart: number | null = null;
  /** `true` while the running sequence is a click relight rather than the intro. */
  let isRelight = false;
  /** `false` while a sequence owns the weights; hover is suppressed until then. */
  let sequenceDone = reduceMotion;

  let frameRaf = 0;
  let hoverRaf = 0;
  let framesRendered = 0;
  let lastFrameTime = 0;
  /** Set for one frame after `setActive(true)` so the delta is not clamped. */
  let justActivated = false;

  /** 0 = white LEDs, 1 = RGB LEDs. */
  let colorMix = 0;
  let wantsColor = false;

  let hoverIndex = -1;
  /** Hover target held back during the post-click re-arm window. */
  let pendingHoverIndex = -1;
  let rearmTimeout = 0;
  let pointerType = "";
  let pointerX = 0;
  let pointerY = 0;
  let pointerDirty = false;

  let fadeInMs = Math.max(settings.interaction.hoverFadeInMs, 1);
  let fadeOutMs = Math.max(settings.interaction.hoverFadeOutMs, 1);

  if (reduceMotion) {
    targetWeights.fill(1);
    weights.fill(1);
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------
  const render = () => {
    if (destroyed || !isActive) return;
    framesRendered++;

    // Pass 1 - the scene, opaque.
    gl.disable(gl.BLEND);
    main.bind();
    main.setBound("colorMix", colorMix);
    // `weights` is mutated in place, so the uniform cache cannot see the change.
    main.setBound("weights", weights, false);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 2 - ten additive bloom quads.
    gl.enable(gl.BLEND);
    bloom.bind();
    bloom.setBound("colorMix", colorMix);
    bloom.setBound("weights", weights, false);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, LIGHT_COUNT);
    gl.disable(gl.BLEND);
  };

  const scheduleFrame = () => {
    if (isActive && !frameRaf) frameRaf = requestAnimationFrame(frame);
  };

  /**
   * Arm a sequence and wake the frame loop.
   *
   * The only difference between the intro and a relight is which delay table
   * the staggered fade-in reads: the authored centre-out schedule, or a
   * wavefront measured from one LED.
   *
   * @param originIndex `null` uses the authored intro delays.
   * @param leadInMs delay before t=0, during which every LED stays dark.
   */
  function startSequence({
    relight,
    originIndex,
    leadInMs,
  }: {
    relight: boolean;
    originIndex: number | null;
    leadInMs: number;
  }) {
    isRelight = relight;
    if (originIndex === null) {
      delays.set(INTRO_DELAYS_MS);
      maxDelayMs = INTRO_MAX_DELAY_MS;
    } else {
      maxDelayMs = writeRelightDelays(delays, originIndex);
    }
    sequenceStart = performance.now() + leadInMs;
    sequenceDone = false;
    lastFrameTime = 0;
    scheduleFrame();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------
  function frame(now: number) {
    frameRaf = 0;
    if (destroyed || !isActive) return;

    // Clamp the delta so a stalled tab does not teleport the easing - except on
    // the frame right after reactivation, where the jump is intentional.
    const elapsed = now - lastFrameTime;
    const deltaMs =
      lastFrameTime > 0 ? (justActivated ? elapsed : Math.min(elapsed, MAX_FRAME_DELTA_MS)) : 16;
    justActivated = false;
    lastFrameTime = now;

    // 1. Let the running sequence, if any, write this instant's targets.
    if (sequenceStart !== null) {
      const finished = writeSequenceWeights({
        targetWeights,
        delays,
        maxDelayMs,
        elapsedMs: now - sequenceStart,
        isRelight,
      });
      if (finished) {
        sequenceStart = null;
        sequenceDone = true;
      }
    }

    let moving = false;

    // 2. Cross-fade the palette.
    const colorGoal = Number(wantsColor);
    colorMix += (colorGoal - colorMix) * approachRate(deltaMs, COLOR_MIX_TIME_CONSTANT_MS);
    moving ||= Math.abs(colorMix - colorGoal) > SETTLED_EPSILON;

    // 3. Ease each weight toward its goal. Hover overrides the sequence: the
    //    pointed-at LED is boosted and every other one is pushed to black.
    const hovering = hoverIndex !== -1 && (sequenceDone || (isRelight && rearmTimeout === 0));
    const brightenRate = settleRate(deltaMs, fadeInMs);
    const dimRate = settleRate(deltaMs, fadeOutMs);

    for (let index = 0; index < LIGHT_COUNT; index++) {
      const dim = hovering && index !== hoverIndex ? 0 : 1;
      const boost = hovering && index === hoverIndex ? HOVER_BOOST : 1;
      const goal = targetWeights[index] * dim * boost;
      const rate = goal < weights[index] ? dimRate : brightenRate;
      // While a sequence is running and nothing is hovered, follow the
      // choreography exactly - easing would smear the sparkle.
      weights[index] =
        sequenceDone || hovering ? weights[index] + (goal - weights[index]) * rate : goal;
      moving ||= Math.abs(weights[index] - goal) > SETTLED_EPSILON;
    }

    render();

    // 4. Keep going only while there is something left to animate.
    if (!sequenceDone || moving) frameRaf = requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------------
  // Atlas upload
  // -------------------------------------------------------------------------
  loadLightAtlas(atlasSrc)
    .then((image) => {
      if (destroyed) return;
      // The atlas is authored bottom-up and is already in the working space, so
      // flip on upload and suppress any colour management.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);

      if (!reduceMotion) {
        // The lead-in keeps every LED dark long enough for the canvas opacity
        // transition to finish first.
        startSequence({
          relight: false,
          originIndex: null,
          leadInMs: AGENT_SHADER_TIMING.fadeInMs,
        });
      }

      onReady();
      render();
      scheduleFrame();
    })
    .catch(() => {
      // The static SVG stays visible; nothing else to do.
    });

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  const applySettings = () => {
    const { bloom: bloomSettings, lightMode: lightModeSettings, noise } = settings;
    fadeInMs = Math.max(settings.interaction.hoverFadeInMs, 1);
    fadeOutMs = Math.max(settings.interaction.hoverFadeOutMs, 1);

    main.set({
      colorAmbientOcclusionStrength: lightModeSettings.color.ambientOcclusionStrength,
      colorGlowStrength: lightModeSettings.color.glowStrength,
      colorGrainRemovalStrength: noise.enabled ? lightModeSettings.color.shadowGrainRemovalStrength : 0,
      colorRadialInnerRadius: lightModeSettings.color.radialInnerRadiusPx,
      colorRadialOuterRadius: lightModeSettings.color.radialOuterRadiusPx,
      colorRadialPower: lightModeSettings.color.radialPower,
      colorRadialShadowStrength: lightModeSettings.color.radialShadowStrength,
      grainMultiplyStrength: noise.enabled && noise.multiply ? GRAIN_MULTIPLY_STRENGTH : 0,
      maxDistortion: noise.enabled && noise.sampleOffset ? MAX_DISTORTION_PX : 0,
      lightModeUnlitDotColor: hexToRgb01(lightModeSettings.unlitDotColor),
      showOffsetScale: Number(noise.showOffsetScale),
      whiteAmbientOcclusionStrength: lightModeSettings.white.ambientOcclusionStrength,
      whiteGlowStrength: lightModeSettings.white.glowStrength,
      whiteGrainRemovalStrength: noise.enabled ? lightModeSettings.white.shadowGrainRemovalStrength : 0,
      whiteRadialInnerRadius: lightModeSettings.white.radialInnerRadiusPx,
      whiteRadialOuterRadius: lightModeSettings.white.radialOuterRadiusPx,
      whiteRadialPower: lightModeSettings.white.radialPower,
      whiteRadialShadowStrength: lightModeSettings.white.radialShadowStrength,
    });

    bloom.set({
      colorGlowStrength: lightModeSettings.color.glowStrength,
      colorStrength: bloomSettings.enabled ? bloomSettings.colorStrength : 0,
      falloffCurve: [
        bloomSettings.falloffCurve.x1,
        bloomSettings.falloffCurve.y1,
        bloomSettings.falloffCurve.x2,
        bloomSettings.falloffCurve.y2,
      ],
      radius: bloomSettings.radiusPx,
      whiteGlowStrength: lightModeSettings.white.glowStrength,
      whiteStrength: bloomSettings.enabled ? bloomSettings.whiteStrength : 0,
    });

    render();
  };
  applySettings();

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------
  /** Scratch vector for `toVirtual`, reused to keep the hover path allocation-free. */
  const virtualPoint = new Float32Array(2);

  /**
   * Convert client coordinates into the 1200 × 800 virtual space (y up).
   *
   * @returns `false` when the point is outside the canvas, in which case
   * `virtualPoint` is left untouched.
   */
  const contains = (rect: DOMRect, x: number, y: number) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  const toVirtual = (clientX: number, clientY: number): boolean => {
    const rect = canvas.getBoundingClientRect();
    if (!contains(rect, clientX, clientY)) return false;

    // The canvas overhangs its container on purpose; only the visible part of
    // it should respond to the pointer.
    const clip = getHitBounds?.();
    if (clip && !contains(clip, clientX, clientY)) return false;

    virtualPoint[0] = ((clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    virtualPoint[1] = ((rect.bottom - clientY) / rect.height) * CANVAS_HEIGHT;
    return true;
  };

  /**
   * Controls layered over the hero own their own clicks.
   *
   * The canvas is `pointer-events: none`, so a click on a button above it still
   * reaches the document listener. Relighting the ▲ because someone pressed
   * "Deploy" would be surprising.
   */
  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element &&
    target.closest("a, button, input, label, select, textarea, [role='button'], [contenteditable]") !==
      null;

  const hoverFrame = (now: number) => {
    hoverRaf = 0;
    if (destroyed || !isActive || !pointerDirty) return;
    pointerDirty = false;

    const index = toVirtual(pointerX, pointerY)
      ? nearestDot(virtualPoint[0], virtualPoint[1], HOVER_RADIUS_PX)
      : -1;

    // During the post-click re-arm window the new target is parked instead of
    // applied, so the relight wavefront is not immediately overridden.
    let changed = false;
    if (rearmTimeout) {
      if (pendingHoverIndex !== index) {
        pendingHoverIndex = index;
        changed = true;
      }
    } else if (hoverIndex !== index) {
      hoverIndex = index;
      changed = true;
    }

    if (changed && !frameRaf) frame(now);
  };

  const scheduleHover = () => {
    if (isActive && !hoverRaf) hoverRaf = requestAnimationFrame(hoverFrame);
  };

  const clearHover = () => {
    pointerDirty = false;
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    hoverRaf = 0;
    if (rearmTimeout) {
      window.clearTimeout(rearmTimeout);
      rearmTimeout = 0;
    }
    pendingHoverIndex = -1;
    if (hoverIndex !== -1) {
      hoverIndex = -1;
      scheduleFrame();
    }
  };

  /** Click or tap: flip the palette and relight outward from the nearest LED. */
  const relight = (clientX: number, clientY: number, isMouse: boolean) => {
    if (!sequenceDone || !toVirtual(clientX, clientY)) return;
    const index = nearestDot(virtualPoint[0], virtualPoint[1], HOVER_RADIUS_PX);

    if (rearmTimeout) window.clearTimeout(rearmTimeout);
    hoverIndex = -1;
    pendingHoverIndex = isMouse ? index : -1;
    rearmTimeout =
      isMouse && index !== -1
        ? window.setTimeout(() => {
            rearmTimeout = 0;
            hoverIndex = pendingHoverIndex;
            scheduleFrame();
          }, HOVER_REARM_MS)
        : 0;

    wantsColor = !wantsColor;

    if (reduceMotion) {
      colorMix = Number(wantsColor);
      render();
      return;
    }

    // A click outside every LED still relights, radiating from the centre.
    startSequence({ relight: true, originIndex: clampDotIndex(index), leadInMs: 0 });
  };

  const onPointerDown = (event: PointerEvent) => {
    pointerType = event.pointerType;
    if (event.pointerType === "mouse" && event.button === 0 && !isInteractiveTarget(event.target)) {
      relight(event.clientX, event.clientY, true);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerType = event.pointerType;
    // Touch and pen have no hover state; a stray move must not strand a
    // highlighted LED.
    if (event.pointerType !== "mouse") {
      clearHover();
      return;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerDirty = true;
    scheduleHover();
  };

  // Touch fires `click` without a usable `pointerdown`, so it relights here.
  const onClick = (event: MouseEvent) => {
    if (pointerType !== "mouse" && !isInteractiveTarget(event.target)) {
      relight(event.clientX, event.clientY, false);
    }
  };

  const onBlur = () => clearHover();

  // The canvas is `pointer-events: none` so the hero stays clickable through
  // it; hit-testing therefore has to happen at the document level.
  if (interactive) {
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("click", onClick);
    window.addEventListener("blur", onBlur);
  }

  // -------------------------------------------------------------------------
  // Public handle
  // -------------------------------------------------------------------------
  return {
    applySettings,

    destroy() {
      destroyed = true;
      if (frameRaf) cancelAnimationFrame(frameRaf);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      if (rearmTimeout) window.clearTimeout(rearmTimeout);
      if (interactive) {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("click", onClick);
        window.removeEventListener("blur", onBlur);
      }
      gl.deleteTexture(atlasTexture);
      gl.deleteTexture(grainTexture);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(bloomProgram);
      gl.deleteProgram(mainProgram);
    },

    resize(nextDisplayHeight: number) {
      if (destroyed) return;
      const next = backingStoreFor(nextDisplayHeight);
      if (next.width === backing.width && next.height === backing.height) return;
      backing = next;
      canvas.width = next.width;
      canvas.height = next.height;
      gl.viewport(0, 0, next.width, next.height);
      render();
    },

    setActive(next: boolean) {
      if (destroyed || isActive === next) return;
      isActive = next;
      if (!next) {
        if (frameRaf) cancelAnimationFrame(frameRaf);
        if (hoverRaf) cancelAnimationFrame(hoverRaf);
        frameRaf = 0;
        hoverRaf = 0;
        return;
      }
      justActivated = true;
      if (pointerDirty) scheduleHover();
      scheduleFrame();
    },

    setLightMode(next: boolean) {
      if (destroyed) return;
      const value = Number(next);
      main.set({ lightMode: value });
      bloom.set({ lightMode: value });
      render();
    },

    getFrameState() {
      return {
        weights: weights.slice(),
        colorMix,
        hoverIndex,
        running: frameRaf !== 0,
        sequence: sequenceStart === null ? "idle" : isRelight ? "relight" : "intro",
        sequenceElapsedMs: sequenceStart === null ? null : performance.now() - sequenceStart,
        framesRendered,
      };
    },

    setPalette(palette: "white" | "color") {
      if (destroyed) return;
      wantsColor = palette === "color";
      if (reduceMotion) {
        colorMix = Number(wantsColor);
        render();
        return;
      }
      // The cross-fade is eased in the frame loop, so it just needs waking up.
      lastFrameTime = 0;
      scheduleFrame();
    },

    playIntro() {
      if (destroyed || reduceMotion) return;
      startSequence({ relight: false, originIndex: null, leadInMs: AGENT_SHADER_TIMING.fadeInMs });
    },

    relightFrom(index: number) {
      if (destroyed || reduceMotion) return;
      startSequence({ relight: true, originIndex: clampDotIndex(index), leadInMs: 0 });
    },
  };
}

/** Keep a caller-supplied LED index in range, defaulting to the centre. */
function clampDotIndex(index: number): number {
  return Number.isInteger(index) && index >= 0 && index < LIGHT_COUNT ? index : 4;
}
