"use client";

import { useEffect, useRef, useState } from "react";

import { DEFAULT_ATLAS_SRC, SCENE } from "@/components/hero-animation";

import { Segmented } from "./controls";
import styles from "./playground.module.css";

/**
 * The pre-baked light atlas, one channel at a time.
 *
 * This is the single biggest idea in the effect and the least obvious from the
 * code: only three of the ten lights were ever rendered. R, G and B each hold
 * one representative - a corner, an edge dot, the centre - and the remaining
 * seven are recovered in the shader by permuting the sample point's barycentric
 * coordinates inside the ▲. Alpha is an ambient-occlusion bake that only light
 * mode reads.
 *
 * Flipping between the channels here makes the reuse obvious: each one is a
 * single glow, and the finished image is ten weighted lookups into these three.
 */

type Channel = "rgb" | "r" | "g" | "b" | "a";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "rgb", label: "RGB" },
  { value: "r", label: "R" },
  { value: "g", label: "G" },
  { value: "b", label: "B" },
  { value: "a", label: "A" },
];

const CHANNEL_NOTES: Record<Channel, string> = {
  rgb: "All three baked lights at once - the packed atlas as it ships.",
  r: `Light ${SCENE.rgbAtlas.representativeLights[0]} - a base corner. Lights 6 and 9 reuse it.`,
  g: `Light ${SCENE.rgbAtlas.representativeLights[1]} - an edge dot. Six interior lights reuse it.`,
  b: `Light ${SCENE.rgbAtlas.representativeLights[2]} - the centre. Used by itself.`,
  a: "Ambient occlusion, not light. Read only in light mode, to ground the ▲.",
};

export function AtlasInspector() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<ImageData | null>(null);
  const [channel, setChannel] = useState<Channel>("rgb");
  const [decoded, setDecoded] = useState(false);
  const [error, setError] = useState(false);

  // Decode once; every channel view is derived from the cached pixels.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.decoding = "async";

    image.addEventListener("load", () => {
      if (cancelled) return;
      const scratch = document.createElement("canvas");
      scratch.width = image.naturalWidth;
      scratch.height = image.naturalHeight;
      const context = scratch.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setError(true);
        return;
      }
      context.drawImage(image, 0, 0);
      sourceRef.current = context.getImageData(0, 0, scratch.width, scratch.height);
      setDecoded(true);
    });

    image.addEventListener("error", () => {
      if (!cancelled) setError(true);
    });

    image.src = DEFAULT_ATLAS_SRC;
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (decoded) paint(canvasRef.current, sourceRef.current, channel);
  }, [channel, decoded]);

  return (
    <div className={styles.atlas}>
      <Segmented onChange={setChannel} options={CHANNELS} value={channel} />
      <div className={styles.atlasFrame}>
        {error ? (
          <p className={styles.note}>Could not load {DEFAULT_ATLAS_SRC}.</p>
        ) : (
          <canvas
            className={styles.atlasCanvas}
            height={SCENE.rgbAtlas.tileHeight}
            ref={canvasRef}
            width={SCENE.rgbAtlas.tileWidth}
          />
        )}
      </div>
      <p className={styles.note}>{CHANNEL_NOTES[channel]}</p>
      <p className={styles.noteQuiet}>
        {SCENE.rgbAtlas.tileWidth} × {SCENE.rgbAtlas.tileHeight} lossless WebP · encoded at gamma{" "}
        {SCENE.rgbAtlas.gamma}, peaking at {SCENE.rgbAtlas.maxIrradiance} linear irradiance
      </p>
    </div>
  );
}

/** Write one channel as greyscale, or the packed image untouched. */
function paint(canvas: HTMLCanvasElement | null, source: ImageData | null, channel: Channel) {
  if (!canvas || !source) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  if (channel === "rgb") {
    // Alpha would composite the AO bake over the glow; show colour only.
    const opaque = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
    context.putImageData(opaque, 0, 0);
    return;
  }

  const offset = { r: 0, g: 1, b: 2, a: 3 }[channel];
  const view = new ImageData(source.width, source.height);
  for (let i = 0; i < source.data.length; i += 4) {
    const value = source.data[i + offset];
    view.data[i] = value;
    view.data[i + 1] = value;
    view.data[i + 2] = value;
    view.data[i + 3] = 255;
  }
  context.putImageData(view, 0, 0);
}
