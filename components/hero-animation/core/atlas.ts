/**
 * Loader for the pre-baked HDR light atlas.
 *
 * The atlas is the whole reason this effect renders in one pass: instead of
 * evaluating ten area lights per pixel, the fragment shader looks up an offline
 * bake. It is ~120 KB of lossless WebP and there is exactly one per page, so the
 * in-flight promise is shared across every mount (including React Strict Mode's
 * double-invoked effects and a WebGL context restore).
 */

const inFlight = new Map<string, Promise<HTMLImageElement>>();

/**
 * Load and decode the atlas at `src`, de-duplicated per URL.
 *
 * A rejected load is evicted from the cache so a later mount can retry - the
 * caller treats failure as "stay on the SVG fallback".
 */
export function loadLightAtlas(src: string): Promise<HTMLImageElement> {
  const cached = inFlight.get(src);
  if (cached) return cached;

  const request = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => {
        inFlight.delete(src);
        reject(new Error(`[hero-animation] unable to load the light atlas at ${src}`));
      },
      { once: true },
    );
    image.src = src;
  });

  inFlight.set(src, request);
  return request;
}
