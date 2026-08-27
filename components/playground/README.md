# Playground

For research and learning purposes only. Not affiliated with Vercel; the
original effect and the baked light atlas are their work.

`/playground` - the hero animation with the lid off.

The animation is not complicated so much as it is *unfamiliar*: a pre-baked
light atlas, a fragment shader that only ever animates ten floats, and a
schedule that never runs when nothing is moving. None of that is visible from
the outside, which is what this page is for.

It is a strict consumer of the public API. Everything here imports from
`@/components/hero-animation`; nothing reaches into `core/`. If the playground
needs something, the component gets a proper prop - that is how `onRenderer`,
`overlay` and `getFrameState()` came to exist.

## What each part demonstrates

| Part | The claim it makes visible |
| --- | --- |
| **Telemetry** (over the stage) | Everything is a function of `weights[10]` and `colorMix`. The **draws** counter freezes the moment the scene settles - proof there is no idle loop, even while this page keeps polling. |
| **Guides** | Overlays drawn in the shader's own 1200 × 800 space, so LED indices, the 120px hover radius, the colour triangle, the bloom quads and the 420px distortion ramp land exactly on what the GPU is doing. |
| **Bloom** | Turn on *Bloom quads* and drag the radius: the entire second pass is ten small squares, not a blur. |
| **Noise** | *Show the distortion buffer* renders the ramp instead of the scene - the hidden term that stops the huge soft gradients from banding. |
| **Interaction** | Hover easing is authored as time-to-arrive. Drag Brighten to 3s and watch a hovered LED crawl. |
| **Photographic grade** | The one group baked into the GLSL. Moving it recompiles the shader and replays the intro; everything above it is a live uniform and does not. |
| **Choreography** | The intro and relight curves, sampled from the same pure functions the frame loop calls - no GPU involved - with a playhead tracking the live sequence. |
| **Light atlas** | Only three of the ten lights were ever rendered. Step through R / G / B / A to see the three baked lobes and the ambient-occlusion channel. |

## Files

```
playground/
├── playground.tsx            page composition, controls, telemetry, pipeline
├── playground.module.css     all of the chrome
├── controls.tsx              Section / Slider / Toggle / Segmented primitives
├── use-live-settings.ts      the compile-time vs. runtime settings split, and
│                             the frame-state poll
├── guide-overlay.tsx         the SVG diagnostics
├── choreography-chart.tsx    the time axis, plotted
└── atlas-inspector.tsx       the baked atlas, per channel
```

## The one genuinely awkward bit

`use-live-settings.ts` exists because the settings object is split in half and
the halves reach the GPU by different routes:

- `bloom`, `noise`, `lightMode`, `interaction` are **uniforms** - mutate the
  object, call `applySettings()`. The object's *identity* must not change, or
  the canvas effect tears down the GL context.
- `photographic` is **baked into the GLSL** - changing it requires a new object,
  because that identity is the shader cache key.

So the hook holds the two halves as separate state and memoises the object it
hands to the component on the compile-time half alone. The visible consequence
is the point: uniform edits are instant, grade edits replay the intro.
