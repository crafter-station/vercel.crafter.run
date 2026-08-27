"use client";

import Link from "next/link";
import { useCallback, useRef, useState, type CSSProperties } from "react";

import {
  HeroAnimation,
  LIGHT_COUNT,
  type AgentShaderRenderer,
  type ColorSchemePreference,
} from "@/components/hero-animation";

import { AtlasInspector } from "./atlas-inspector";
import { ChoreographyChart } from "./choreography-chart";
import { ActionButton, Section, Segmented, Slider, Toggle, formatNumber } from "./controls";
import { DEFAULT_GUIDES, GUIDE_LABELS, GuideOverlay, type GuideFlags } from "./guide-overlay";
import styles from "./playground.module.css";
import { useFrameState, useLiveSettings } from "./use-live-settings";

const SCHEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { value: ColorSchemePreference; label: string }[];

const LED_OPTIONS = Array.from({ length: LIGHT_COUNT }, (_, index) => index);

export function Playground() {
  const rendererRef = useRef<AgentShaderRenderer | null>(null);
  const [guides, setGuides] = useState<GuideFlags>(DEFAULT_GUIDES);
  const [scheme, setScheme] = useState<ColorSchemePreference>("system");
  const [relightOrigin, setRelightOrigin] = useState(4);
  const [chartMode, setChartMode] = useState<"intro" | "relight">("intro");

  const { draft, settings, update, reset } = useLiveSettings(rendererRef);
  const frame = useFrameState(rendererRef);

  const handleRenderer = useCallback((renderer: AgentShaderRenderer | null) => {
    rendererRef.current = renderer;
  }, []);

  const toggleGuide = (key: keyof GuideFlags, value: boolean) =>
    setGuides((current) => ({ ...current, [key]: value }));

  // `layout` is CSS, not a uniform, so it is applied here rather than through
  // the renderer. See `useLiveSettings` for why the split exists.
  const stageStyle = {
    "--hero-animation-scale": String(draft.layout.scalePercent / 100),
    "--hero-animation-offset-y": `${draft.layout.offsetYPercent}%`,
  } as CSSProperties;

  const hoverIndex = frame?.hoverIndex ?? -1;

  return (
    <div className={styles.root}>
      <section className={styles.stage}>
        <HeroAnimation
          colorScheme={scheme}
          onRenderer={handleRenderer}
          overlay={
            <GuideOverlay
              bloomRadiusPx={draft.bloom.radiusPx}
              guides={guides}
              hoverIndex={hoverIndex}
            />
          }
          settings={settings}
          style={stageStyle}
        />
        <Telemetry frame={frame} />
      </section>

      <aside className={styles.panel}>
        <header className={styles.panelHeader}>
          <h1 className={styles.title}>Hero animation</h1>
          <p className={styles.subtitle}>
            Ten LEDs, one fragment shader, two animated numbers. Move the pointer over the ▲ to
            light one; click to flip the palette and relight from where you clicked.
          </p>
          <div className={styles.headerActions}>
            <ActionButton onClick={() => rendererRef.current?.playIntro()}>Replay intro</ActionButton>
            <ActionButton onClick={reset}>Reset settings</ActionButton>
            <Link className={styles.action} href="/">
              View bare
            </Link>
          </div>
        </header>

        <Section
          note="Per-LED weight is shown live over the stage. The dashed line is rest (1.0); hovering boosts one LED to 3 and pushes the rest to 0. The draw counter stops the moment everything settles - there is no idle loop."
          title="Scene"
        >
          <Segmented
            label="Colour scheme"
            onChange={setScheme}
            options={SCHEME_OPTIONS}
            value={scheme}
          />
          <Segmented
            label="Palette"
            onChange={(value) => rendererRef.current?.setPalette(value)}
            options={[
              { value: "white", label: "White" },
              { value: "color", label: "RGB" },
            ]}
            value={(frame?.colorMix ?? 0) > 0.5 ? "color" : "white"}
          />
          <div className={styles.control}>
            <span className={styles.controlLabel}>Relight from LED</span>
            <div className={styles.ledPicker}>
              {LED_OPTIONS.map((index) => (
                <button
                  aria-pressed={index === relightOrigin}
                  className={styles.led}
                  key={index}
                  onClick={() => {
                    setRelightOrigin(index);
                    rendererRef.current?.relightFrom(index);
                  }}
                  type="button"
                >
                  {index}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section
          note="Overlays drawn in the shader's own 1200 × 800 space, so they land exactly on what the GPU is doing."
          title="Guides"
        >
          {GUIDE_LABELS.map(({ key, label, note }) => (
            <Toggle
              checked={guides[key]}
              key={key}
              label={label}
              note={note}
              onChange={(value) => toggleGuide(key, value)}
            />
          ))}
        </Section>

        <Section
          note="Ten instanced quads, additively blended. Not a blur - each LED gets one small quad shaded by an editable falloff curve, which is why it costs almost nothing."
          title="Bloom"
        >
          <Toggle
            checked={draft.bloom.enabled}
            label="Enabled"
            onChange={(value) => update((next) => void (next.bloom.enabled = value))}
          />
          <Slider
            label="Quad radius"
            max={40}
            min={0}
            onChange={(value) => update((next) => void (next.bloom.radiusPx = value))}
            step={0.5}
            unit="px"
            value={draft.bloom.radiusPx}
          />
          <Slider
            label="White strength"
            max={4}
            min={0}
            onChange={(value) => update((next) => void (next.bloom.whiteStrength = value))}
            step={0.05}
            value={draft.bloom.whiteStrength}
          />
          <Slider
            label="RGB strength"
            max={4}
            min={0}
            onChange={(value) => update((next) => void (next.bloom.colorStrength = value))}
            step={0.05}
            value={draft.bloom.colorStrength}
          />
          <p className={styles.noteQuiet}>
            Turn on <strong>Bloom quads</strong> under Guides to see the actual geometry - the
            entire second pass is those ten squares.
          </p>
        </Section>

        <Section
          note="A 400 × 400 hash baked once on the GPU at startup. It jitters atlas lookups outside the ▲ and adds a little multiplicative grain, which is what stops the huge soft gradients from banding."
          title="Noise"
        >
          <Toggle
            checked={draft.noise.enabled}
            label="Enabled"
            onChange={(value) => update((next) => void (next.noise.enabled = value))}
          />
          <Toggle
            checked={draft.noise.sampleOffset}
            label="Sample offset"
            note="±13.5px lookup jitter"
            onChange={(value) => update((next) => void (next.noise.sampleOffset = value))}
          />
          <Toggle
            checked={draft.noise.multiply}
            label="Multiplicative grain"
            note="±4% on the graded colour"
            onChange={(value) => update((next) => void (next.noise.multiply = value))}
          />
          <Toggle
            checked={draft.noise.showOffsetScale}
            label="Show the distortion buffer"
            note="renders the ramp instead of the scene"
            onChange={(value) => update((next) => void (next.noise.showOffsetScale = value))}
          />
        </Section>

        <Section
          note="Hover easing is authored as time-to-arrive, not as a time constant - the curve is tuned to cover 99.8% of the distance in exactly this long."
          title="Interaction"
        >
          <Slider
            label="Brighten"
            max={3000}
            min={50}
            onChange={(value) => update((next) => void (next.interaction.hoverFadeInMs = value))}
            step={25}
            unit="ms"
            value={draft.interaction.hoverFadeInMs}
          />
          <Slider
            label="Dim"
            max={4000}
            min={50}
            onChange={(value) => update((next) => void (next.interaction.hoverFadeOutMs = value))}
            step={25}
            unit="ms"
            value={draft.interaction.hoverFadeOutMs}
          />
        </Section>

        <Section
          defaultOpen={false}
          note="Light mode is a different render, not a palette swap: the shader emits premultiplied alpha plus a shadow model so the glow reads on a near-white page. Switch the scheme to Light to see these do anything."
          title="Light mode"
        >
          {(["white", "color"] as const).map((channel) => (
            <div className={styles.subGroup} key={channel}>
              <h3 className={styles.subGroupTitle}>
                {channel === "white" ? "White palette" : "RGB palette"}
              </h3>
              <Slider
                label="Glow strength"
                max={3}
                min={0}
                onChange={(value) =>
                  update((next) => void (next.lightMode[channel].glowStrength = value))
                }
                step={0.01}
                value={draft.lightMode[channel].glowStrength}
              />
              <Slider
                label="Ambient occlusion"
                max={1}
                min={0}
                onChange={(value) =>
                  update((next) => void (next.lightMode[channel].ambientOcclusionStrength = value))
                }
                step={0.01}
                value={draft.lightMode[channel].ambientOcclusionStrength}
              />
              <Slider
                label="Radial shadow"
                max={1}
                min={0}
                onChange={(value) =>
                  update((next) => void (next.lightMode[channel].radialShadowStrength = value))
                }
                step={0.01}
                value={draft.lightMode[channel].radialShadowStrength}
              />
              <Slider
                label="Shadow outer radius"
                max={900}
                min={1}
                onChange={(value) =>
                  update((next) => void (next.lightMode[channel].radialOuterRadiusPx = value))
                }
                step={1}
                unit="px"
                value={draft.lightMode[channel].radialOuterRadiusPx}
              />
            </div>
          ))}
        </Section>

        <Section defaultOpen={false} note="Pure CSS - a transform on the stage, not a uniform." title="Layout">
          <Slider
            label="Scale"
            max={200}
            min={40}
            onChange={(value) => update((next) => void (next.layout.scalePercent = value))}
            step={1}
            unit="%"
            value={draft.layout.scalePercent}
          />
          <Slider
            label="Vertical offset"
            max={25}
            min={-25}
            onChange={(value) => update((next) => void (next.layout.offsetYPercent = value))}
            step={0.5}
            unit="%"
            value={draft.layout.offsetYPercent}
          />
        </Section>

        <Section
          defaultOpen={false}
          note={
            <>
              These are <strong>baked into the GLSL</strong> as constants, not passed as uniforms.
              Moving one compiles new shader source and rebuilds the renderer, so the intro replays
              every time. Everything above is a live uniform and does not.
            </>
          }
          title="Photographic grade · recompiles"
        >
          <Slider
            label="White exposure"
            max={2}
            min={-4}
            onChange={(value) => update((next) => void (next.photographic.whiteExposureEv = value))}
            step={0.05}
            unit="EV"
            value={draft.photographic.whiteExposureEv}
          />
          <Slider
            label="RGB exposure"
            max={2}
            min={-4}
            onChange={(value) => update((next) => void (next.photographic.colorExposureEv = value))}
            step={0.05}
            unit="EV"
            value={draft.photographic.colorExposureEv}
          />
          <Slider
            label="Saturation"
            max={3}
            min={0}
            onChange={(value) => update((next) => void (next.photographic.saturation = value))}
            step={0.01}
            value={draft.photographic.saturation}
          />
          <Slider
            label="Black point"
            max={0.05}
            min={0}
            onChange={(value) => update((next) => void (next.photographic.blackPoint = value))}
            step={0.001}
            value={draft.photographic.blackPoint}
          />
        </Section>

        <Section
          note="Sampled from the same pure functions the frame loop calls - no GPU involved. The playhead tracks the live sequence."
          title="Choreography"
        >
          <Segmented
            onChange={setChartMode}
            options={[
              { value: "intro", label: "Intro" },
              { value: "relight", label: `Relight from ${relightOrigin}` },
            ]}
            value={chartMode}
          />
          <ChoreographyChart
            highlightIndex={hoverIndex}
            originIndex={chartMode === "intro" ? null : relightOrigin}
            playheadMs={
              frame && frame.sequence === (chartMode === "intro" ? "intro" : "relight")
                ? frame.sequenceElapsedMs
                : null
            }
          />
        </Section>

        <Section note="Three lights were baked. Seven are recovered by symmetry." title="Light atlas">
          <AtlasInspector />
        </Section>

        <Section defaultOpen={false} title="Pipeline">
          <PipelineStrip />
        </Section>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Hover boosts a resting LED from 1 to 3, so 3 is the practical ceiling. */
const METER_FULL_SCALE = 3;

/** Live readout of the two values the entire effect is a function of. */
function Telemetry({ frame }: { frame: ReturnType<typeof useFrameState> }) {
  const weights = frame?.weights;

  return (
    <div className={styles.telemetry}>
      <div className={styles.telemetryRow}>
        <span className={styles.chip} data-running={frame?.running ?? false}>
          {frame?.running ? "drawing" : "idle"}
        </span>
        <span className={styles.telemetryStat}>
          <em>sequence</em>
          {frame?.sequence ?? "-"}
        </span>
        <span className={styles.telemetryStat}>
          <em>draws</em>
          {frame?.framesRendered ?? 0}
        </span>
        <span className={styles.telemetryStat}>
          <em>colorMix</em>
          {formatNumber(frame?.colorMix ?? 0)}
        </span>
        <span className={styles.telemetryStat}>
          <em>hover</em>
          {frame?.hoverIndex === undefined || frame.hoverIndex < 0 ? "-" : frame.hoverIndex}
        </span>
      </div>

      <div className={styles.meters}>
        {/* Rest is weight 1; the hovered LED is boosted to 3, which is full scale. */}
        <span className={styles.meterRestLine} />
        {Array.from({ length: LIGHT_COUNT }, (_, index) => {
          const weight = weights?.[index] ?? 0;
          return (
            <div
              className={styles.meter}
              data-hovered={frame?.hoverIndex === index}
              key={index}
              title={`LED ${index}: ${weight.toFixed(3)}`}
            >
              <span
                className={styles.meterFill}
                style={{ height: `${Math.min(weight / METER_FULL_SCALE, 1) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className={styles.meterLabels}>
        {Array.from({ length: LIGHT_COUNT }, (_, index) => (
          <em data-hovered={frame?.hoverIndex === index} key={index}>
            {index}
          </em>
        ))}
      </div>
      <p className={styles.telemetryCaption}>
        Per-LED weight. The dashed line is rest (1.0); hovering boosts one LED to 3 and pushes the
        rest to 0. <strong>draws</strong> stops climbing the moment everything settles - there is no
        idle loop.
      </p>
    </div>
  );
}

const PASSES = [
  {
    name: "Grain bake",
    when: "once, at startup",
    detail: "An integer hash of gl_FragCoord into a 400 × 400 texture. Never runs again.",
  },
  {
    name: "Main",
    when: "1 draw call / frame",
    detail:
      "One fullscreen triangle. Reconstructs all ten lights from the atlas in linear HDR, sums them, draws the LED cores, then a single shared tone map.",
  },
  {
    name: "Bloom",
    when: "1 instanced draw / frame",
    detail:
      "Ten 11px quads, additively blended, each shaded by a cubic-Bezier point-spread function. Touches about 1% of the framebuffer.",
  },
];

function PipelineStrip() {
  return (
    <ol className={styles.pipeline}>
      {PASSES.map((pass, index) => (
        <li className={styles.pass} key={pass.name}>
          <span className={styles.passIndex}>{index + 1}</span>
          <div>
            <h3 className={styles.passName}>
              {pass.name}
              <em>{pass.when}</em>
            </h3>
            <p className={styles.noteQuiet}>{pass.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
