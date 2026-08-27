import { ImageResponse } from "next/og";

/*
 * Dynamic Open Graph images.
 *
 * The ten LED positions come from `core/scene`, the same table the shader is
 * built from, so the card can never drift out of sync with the animation. That
 * module is imported directly rather than through the package barrel because
 * the barrel also re-exports client components, and none of that belongs in an
 * image route.
 *
 * Satori (which renders these) supports a subset of CSS: no blend modes, no
 * filters. The glow is therefore faked the way it would have been before
 * shaders existed - layered radial gradients plus a box-shadow per dot.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOT_CENTERS,
  DOT_RADIUS,
} from "@/components/hero-animation/core/scene";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** Virtual px to OG px. The ▲ is only ~106 virtual px wide, so it needs help. */
const SCALE = 2.6;
/** Centre of the cluster in virtual space, by construction of the rows. */
const ORIGIN = { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
/** Sits above centre, leaving the lower third clear for the caption. */
const STAGE = { x: OG_SIZE.width / 2, y: 248 };

const DOT_DIAMETER = DOT_RADIUS * 2 * SCALE;

const DOTS = DOT_CENTERS.map(([x, y]) => ({
  // Virtual space is y-up; CSS is y-down.
  left: STAGE.x + (x - ORIGIN.x) * SCALE - DOT_DIAMETER / 2,
  top: STAGE.y - (y - ORIGIN.y) * SCALE - DOT_DIAMETER / 2,
}));

export interface HeroOgOptions {
  /** Small label above the wordmark. */
  eyebrow: string;
  /** The line that carries the meaning. */
  caption: string;
}

export function renderHeroOg({ eyebrow, caption }: HeroOgOptions) {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          position: "relative",
          width: "100%",
          height: "100%",
          background: "#000",
          fontFamily: "sans-serif",
        }}
      >
        {/* Ambient bounce off the back wall. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `radial-gradient(circle at 50% ${Math.round(
              (STAGE.y / OG_SIZE.height) * 100,
            )}%, rgba(255,255,255,0.20), rgba(255,255,255,0.05) 24%, rgba(0,0,0,0) 55%)`,
          }}
        />
        {/*
          The pool of light the ▲ throws onto the floor. Full-bleed on purpose:
          Satori clips a gradient to its element box, so a smaller box would
          show its own rectangular edge instead of fading out.
        */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `radial-gradient(circle at 50% ${Math.round(
              ((STAGE.y + 120) / OG_SIZE.height) * 100,
            )}%, rgba(255,255,255,0.11), rgba(0,0,0,0) 34%)`,
          }}
        />

        {DOTS.map((dot, index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              left: dot.left,
              top: dot.top,
              width: DOT_DIAMETER,
              height: DOT_DIAMETER,
              borderRadius: DOT_DIAMETER,
              background: "#fff",
              boxShadow: "0 0 28px 7px rgba(255,255,255,0.30)",
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            left: 72,
            bottom: 64,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.42)",
            }}
          >
            {eyebrow}
          </div>
          <div style={{ display: "flex", fontSize: 40, color: "#ededed" }}>{caption}</div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 72,
            bottom: 64,
            display: "flex",
            fontSize: 24,
            color: "rgba(255,255,255,0.42)",
          }}
        >
          ▲.crafter.run
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
