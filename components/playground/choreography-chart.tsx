"use client";

import { useMemo } from "react";

import {
  INTRO_DELAYS_MS,
  LIGHT_COUNT,
  SPARKLE_DURATION_MS,
  SPARKLE_END_MS,
  writeRelightDelays,
  writeSequenceWeights,
} from "@/components/hero-animation";

import styles from "./playground.module.css";

/**
 * The time axis of the animation, plotted straight from `core/choreography.ts`.
 *
 * No canvas and no renderer are involved: the choreography is pure functions of
 * (elapsed, delays), so the exact curves the GPU will follow can be sampled
 * ahead of time. That is the argument for keeping it separable in the first
 * place - the schedule is inspectable without a GPU.
 */

const WIDTH = 520;
const HEIGHT = 168;
const PAD_LEFT = 26;
const PAD_BOTTOM = 20;
const PAD_TOP = 10;
const SAMPLE_MS = 8;

/** Distinguishable hues for ten overlapping lines. */
const LED_COLORS = [
  "#e5484d", "#f76b15", "#ffb224", "#99d52a", "#30a46c",
  "#12a594", "#00a2c7", "#0090ff", "#8e4ec6", "#e93d82",
];

export interface ChoreographyMode {
  /** `null` plots the intro; a number plots a relight radiating from that LED. */
  originIndex: number | null;
}

export function ChoreographyChart({
  originIndex,
  playheadMs,
  highlightIndex,
}: ChoreographyMode & {
  /** Live position of the running sequence, or `null` when idle. */
  playheadMs: number | null;
  /** LED to emphasise, usually the hovered one. */
  highlightIndex: number;
}) {
  const { series, durationMs } = useMemo(() => buildSeries(originIndex), [originIndex]);

  const x = (ms: number) => PAD_LEFT + (ms / durationMs) * (WIDTH - PAD_LEFT - 8);
  const y = (weight: number) => PAD_TOP + (1 - weight) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const isIntro = originIndex === null;

  return (
    <figure className={styles.chartFigure}>
      <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {/* Phase bands. The intro is the only sequence with a sparkle. */}
        {isIntro ? (
          <>
            <rect
              className={styles.chartBand}
              height={HEIGHT - PAD_TOP - PAD_BOTTOM}
              width={x(SPARKLE_DURATION_MS) - x(0)}
              x={x(0)}
              y={PAD_TOP}
            />
            <rect
              className={styles.chartBandAlt}
              height={HEIGHT - PAD_TOP - PAD_BOTTOM}
              width={x(SPARKLE_END_MS) - x(SPARKLE_DURATION_MS)}
              x={x(SPARKLE_DURATION_MS)}
              y={PAD_TOP}
            />
          </>
        ) : null}

        {/* Axes */}
        <line className={styles.chartAxis} x1={PAD_LEFT} x2={WIDTH - 8} y1={y(0)} y2={y(0)} />
        <line className={styles.chartAxis} x1={PAD_LEFT} x2={PAD_LEFT} y1={y(1)} y2={y(0)} />
        <text className={styles.chartTick} x={PAD_LEFT - 6} y={y(1) + 4}>1</text>
        <text className={styles.chartTick} x={PAD_LEFT - 6} y={y(0) + 4}>0</text>

        {/* One line per LED. */}
        {series.map((points, index) => (
          <polyline
            className={styles.chartLine}
            data-dim={highlightIndex !== -1 && highlightIndex !== index}
            key={index}
            points={points.map((weight, step) => `${x(step * SAMPLE_MS)},${y(weight)}`).join(" ")}
            stroke={LED_COLORS[index]}
          />
        ))}

        {playheadMs !== null && playheadMs >= 0 && playheadMs <= durationMs ? (
          <line
            className={styles.chartPlayhead}
            x1={x(playheadMs)}
            x2={x(playheadMs)}
            y1={PAD_TOP}
            y2={y(0)}
          />
        ) : null}

        {isIntro ? (
          <>
            <text className={styles.chartPhase} x={x(SPARKLE_DURATION_MS / 2)} y={HEIGHT - 6}>
              sparkle
            </text>
            <text
              className={styles.chartPhase}
              x={x((SPARKLE_DURATION_MS + SPARKLE_END_MS) / 2)}
              y={HEIGHT - 6}
            >
              settle
            </text>
          </>
        ) : null}
        <text className={styles.chartPhase} x={x((SPARKLE_END_MS + durationMs) / 2)} y={HEIGHT - 6}>
          staggered fade-in
        </text>
        {/* Top-right: the bottom edge belongs to the phase labels. */}
        <text className={styles.chartTick} x={WIDTH - 8} y={PAD_TOP + 2}>
          {Math.round(durationMs)}ms
        </text>
      </svg>
      <figcaption className={styles.chartLegend}>
        {LED_COLORS.map((color, index) => (
          <span
            className={styles.chartLegendItem}
            data-dim={highlightIndex !== -1 && highlightIndex !== index}
            key={index}
          >
            <i style={{ background: color }} />
            {index}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/**
 * Sample the sequence by calling the same function the frame loop calls.
 *
 * These are not approximations of the animation - they are the animation,
 * evaluated on a fixed time grid instead of on animation frames.
 */
function buildSeries(originIndex: number | null) {
  const delays = new Float32Array(LIGHT_COUNT);
  let maxDelayMs: number;

  if (originIndex === null) {
    delays.set(INTRO_DELAYS_MS);
    maxDelayMs = Math.max(...INTRO_DELAYS_MS);
  } else {
    maxDelayMs = writeRelightDelays(delays, originIndex);
  }

  const tailMs = maxDelayMs + 300;
  const durationMs = (originIndex === null ? SPARKLE_END_MS : 0) + tailMs;

  const targetWeights = new Float32Array(LIGHT_COUNT);
  const series: number[][] = Array.from({ length: LIGHT_COUNT }, () => []);

  for (let ms = 0; ms <= durationMs; ms += SAMPLE_MS) {
    writeSequenceWeights({
      targetWeights,
      delays,
      maxDelayMs,
      elapsedMs: ms,
      isRelight: originIndex !== null,
    });
    for (let index = 0; index < LIGHT_COUNT; index++) {
      series[index].push(targetWeights[index]);
    }
  }

  return { series, durationMs };
}
