# Hero animation

For research and learning purposes only. Not affiliated with Vercel; the
original effect and the baked light atlas are their work.

A ▲ of ten LEDs lighting a dark room, rendered with raw WebGL2. Ported from the
vercel.com homepage hero - the animation only, no copy, no layout.

```tsx
import { HeroAnimation } from "@/components/hero-animation";

<div className="relative h-svh w-full">
  <HeroAnimation />
</div>
```

`HeroAnimation` fills its parent, so the parent needs a size. That is the whole
API for the common case.

To take it apart, run the app and open **`/playground`** - live shader controls,
geometry overlays drawn in the shader's own coordinate space, the choreography
curves, and the baked light atlas one channel at a time.

---

## What you are looking at

Ten dots arranged as the 1 + 2 + 3 + 4 triangular number, apex up. They are
emissive: each one throws light onto a floor behind the ▲, and the floor is what
you actually see most of. Interactions:

| input                | result                                                        |
| -------------------- | ------------------------------------------------------------ |
| page load            | LEDs sparkle, settle, then light from the centre outward       |
| mouse near an LED    | that LED brightens to 3×, the others fade to black             |
| click / tap          | palette flips white ↔ RGB and the ▲ relights from the clicked LED |
| off screen / hidden tab | rendering stops entirely                                    |
| `prefers-reduced-motion` | LEDs are simply lit; clicking still flips the palette      |
| no WebGL2            | the static SVG placeholder stays                               |

Everything visible is a function of exactly two animated values: a
`weights[10]` array of per-LED brightness and a scalar `colorMix`. There is no
per-frame geometry, no texture churn, and **no idle loop** - frames are
scheduled only while something is easing, so a settled hero costs nothing.

---

## Files

```
hero-animation/
├── index.ts                    public exports
├── hero-animation.tsx          <HeroAnimation> - composes the two layers
├── hero-animation.module.css   sizing, the cross-fade, light/dark
├── agent-shader-canvas.tsx     React ↔ renderer binding
├── fallback-triangle.tsx       server-rendered SVG placeholder
├── core/
│   ├── settings.ts             tunables + createShaderSettings()
│   ├── scene.ts                geometry, LED colours, backing-store sizes
│   ├── choreography.ts         the time axis: intro, sparkle, relight, hover
│   ├── shaders.ts              GLSL for all three passes
│   ├── renderer.ts             the WebGL2 engine and frame loop
│   ├── gl.ts                   program compilation + a uniform cache
│   ├── atlas.ts                de-duplicated light-atlas loader
│   └── math.ts                 smoothstep, frame-rate independent easing
└── hooks/
    ├── use-color-scheme.ts     resolves light/dark without a theme library
    ├── use-prefers-reduced-motion.ts
    ├── use-border-box-height.ts    ResizeObserver → renderer, no re-render
    └── use-render-activity.ts      IntersectionObserver + page visibility
```

`components/playground/` consumes all of this from the outside; it imports only
from `@/components/hero-animation` and never reaches into `core/`.

Nothing outside `core/` and `hooks/` knows about WebGL, and nothing inside
`core/` knows about React.

---

## How it renders

### The light atlas

`public/hero/agent-light-atlas-rgb.webp` (945 × 630, ~120 KB lossless) is a
**pre-baked HDR light map**, and it is the reason the whole effect is one
fragment shader instead of a light-transport solver.

Only three of the ten lights are actually baked - one corner, one edge dot and
the centre - packed into the R, G and B channels. The other seven are recovered
at sample time by permuting the sample point's barycentric coordinates inside
the ▲, which maps each light onto the representative that shares its symmetry.
Alpha carries an ambient-occlusion bake used only in light mode.

There is no code that produces this file. It is an asset.

### The three passes

1. **Grain bake** - once, at startup. An integer hash of `gl_FragCoord` into a
   400 × 400 texture. Drives both the ±13.5 px atlas-lookup jitter outside the
   colour triangle and a ±4 % multiplicative grain, so the light gradients never
   band.
2. **Main** - one fullscreen triangle. Reconstructs all ten lights in linear
   HDR, tints and sums them, draws the LED cores on top, and applies a single
   shared photographic grade. This is the image.
3. **Bloom** - ten instanced 11 px quads, additively blended, each shaded by an
   editable cubic-Bezier point-spread function. Sharper than a separable blur
   and it only touches about 1 % of the framebuffer.

### Coordinate spaces

The scene is authored in a fixed **1200 × 800 virtual space, y up**. That never
changes. What changes with viewport size is only the backing store - 2520 × 1680
below a displayed height of 892.5 px, 2835 × 1890 above - both 2× their CSS size,
which is where the antialiasing comes from (`antialias: false` on the context is
deliberate).

---

## Escape hatches

Four optional props, none of which are needed to display the animation. They
exist because the playground needed them, and they are the only supported way to
reach past the component.

| prop          | for                                                                    |
| ------------- | ---------------------------------------------------------------------- |
| `onRenderer`  | receives the live renderer, and `null` when it is torn down             |
| `overlay`     | content drawn in the stage's exact box, on top of the canvas            |
| `colorScheme` | force light or dark instead of following the page                       |
| `interactive` | detach the pointer handlers entirely                                    |

The renderer handle is mostly lifecycle (`resize`, `setActive`, `setLightMode`,
`applySettings`), plus a small surface for inspecting and scripting it:

```ts
renderer.getFrameState();
// → { weights, colorMix, hoverIndex, running, sequence, sequenceElapsedMs, framesRendered }

renderer.setPalette("color");   // cross-fade, no relight
renderer.playIntro();           // replay sparkle → settle → fade-in
renderer.relightFrom(4);        // wavefront from one LED, palette untouched
```

`framesRendered` is the honest cost measure: it stops climbing the instant
everything settles.

For `overlay`, an `<svg viewBox="0 0 1200 800">` child lands in the same virtual
space the shader is authored in - but that space is y-up while SVG is y-down, so
mirror with `800 - y`. `components/playground/guide-overlay.tsx` is a worked
example.

---

## Pointer behaviour

The canvas is `pointer-events: none` so whatever sits on top of the hero stays
clickable, which means hit-testing happens on `document`. Two rules keep that
from being antisocial:

- **Hit-testing is clipped to the component's own box.** The stage is
  deliberately wider than its container and clipped by it, so without this the
  LEDs would react across a band of the page where they are not even visible.
- **Controls own their own clicks.** A `pointerdown` whose target is inside an
  `a`, `button`, `input`, `label`, `select`, `textarea`, `[role="button"]` or
  `[contenteditable]` is ignored - pressing a call-to-action laid over the hero
  should not relight the ▲.

---

## Tuning

```tsx
import { HeroAnimation, createShaderSettings } from "@/components/hero-animation";

// Build it once - the object identity keys the shader cache.
const settings = createShaderSettings({
  layout: { scalePercent: 100 },
  bloom: { radiusPx: 6 },
  interaction: { hoverFadeInMs: 400 },
});

export function Hero() {
  return <HeroAnimation settings={settings} />;
}
```

`settings.photographic` is **baked into the GLSL** rather than passed as
uniforms, so changing it requires a new settings object (which recompiles the
shaders); mutating the object in place does nothing. Everything else in
`settings` is a live uniform.

CSS knobs, set on the root element:

| custom property                         | default   | effect                          |
| --------------------------------------- | --------- | ------------------------------- |
| `--hero-animation-scale`                | `1.2`     | zoom of the stage               |
| `--hero-animation-offset-y`             | `2.5%`    | vertical nudge                  |
| `--hero-animation-fade-ms`              | `300ms`   | canvas ↔ placeholder cross-fade |
| `--hero-animation-dot-light`            | `#9e9e9e` | placeholder dot, light mode     |
| `--hero-animation-dot-loading-dark`     | `#000`    | placeholder dot, dark, pre-load |
| `--hero-animation-dot-unavailable-dark` | `#2e2e2e` | placeholder dot, dark, no WebGL |

The first two are written from `settings.layout`; overriding them via `style`
wins, since the inline style is merged last.

---

## Light and dark

The component has no theme dependency. `hooks/use-color-scheme.ts` resolves the
scheme itself, checking in order:

1. `<html data-theme="light|dark">` - `next-themes` with `attribute="data-theme"`
2. `<html class="light-theme|dark-theme">` - Geist / vercel.com
3. `<html class="light|dark">` - `next-themes` default, Tailwind's `dark:`
4. `prefers-color-scheme`

A `<HeroAnimation colorScheme="light" />` prop overrides all of it.

The two modes are genuinely different renders, not a palette swap:

- **dark** - the shader emits an opaque frame that is screen-blended into the
  page. The page background must be `#000`.
- **light** - the shader emits premultiplied alpha, with an atlas-baked ambient
  occlusion term and a broad radial shadow so the glow reads against a near-white
  page. The page background must be `#fafafa`.

Those two grounds are defined as `--page-background` in `app/globals.css`. The
visible light/dark split is done in CSS, not React, so first paint is already
correct - the hook's value only ever reaches the shader, which does not exist
until well after hydration.

---

## Performance notes

- **On-demand rendering.** `requestAnimationFrame` is scheduled only while a
  weight or the colour mix is still moving (threshold 0.002). Hovering costs a
  few hundred milliseconds of frames; a settled hero costs zero.
- **Nothing at 60 fps goes through React.** Resize and visibility are pushed
  straight into the renderer through refs. The only `setState` in the whole
  component is the ready flag and a WebGL-context-restore counter.
- **The uniform cache** in `core/gl.ts` skips redundant `uniform*` calls; only
  the two that actually animate are re-uploaded per frame.
- **The atlas request is de-duplicated per URL**, so Strict Mode's double effect,
  a context restore and multiple mounts all share one decode.
- Context options are `powerPreference: "low-power"`, no depth, no stencil, no
  MSAA - the supersampled backing store does that job better.

---

## Failure modes

All of these end in the same place: the SVG placeholder stays and nothing
throws. The root then carries `data-unavailable="true"`, which is how the
stylesheet tells "still loading" from "never coming" - in dark mode the
placeholder is invisible while loading (no flash before the LEDs light) but
becomes a visible grey once the shader is ruled out, so the ▲ is still there.

| cause                        | detection                                |
| ---------------------------- | ---------------------------------------- |
| no WebGL2                    | `getContext` returns null                |
| shader will not compile/link | `createProgram` returns null (logs in dev) |
| incomplete framebuffer       | `checkFramebufferStatus`                 |
| atlas 404 or decode failure  | rejected image promise                   |
| GPU context lost             | `webglcontextlost`, rebuilt on restore   |

---

## Provenance

Reconstructed from the vercel.com production bundle (Turbopack module `305834`,
settings module `283591` version 21). The GLSL is reproduced verbatim; the
geometry, timing curves and uniform wiring match the original. What differs:

- the in-house `useSize` / `useLifecycle` / `usePrefersReducedMotion` hooks are
  replaced with the local equivalents in `hooks/`
- `next-themes` is replaced by `use-color-scheme.ts`, so there are no runtime
  dependencies beyond React
- Tailwind utility classes are replaced by a CSS Module
- the `?debug` settings panel is not ported - `/playground` covers the same
  ground and more
- shaders are cached per settings object, so a custom photographic grade
  actually takes effect (upstream bakes the defaults unconditionally)
