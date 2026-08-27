/**
 * Thin WebGL2 helpers. No abstraction layer, no scene graph - just the three
 * things this effect needs more than once: compiling a program, uploading a
 * uniform without redundant driver calls, and failing loudly in development.
 */

const isDev = process.env.NODE_ENV !== "production";

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  if (isDev) {
    console.error(`[hero-animation] ${label} failed to compile:\n${gl.getShaderInfoLog(shader)}`);
  }
  gl.deleteShader(shader);
  return null;
}

/**
 * Compile and link a program, cleaning up after itself on any failure.
 *
 * Returns `null` rather than throwing: a missing program means "fall back to
 * the static SVG", which is a normal outcome on constrained hardware.
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex shader`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment shader`);

  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  // Shaders are reference-counted by the program; drop our handles immediately.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;

  if (isDev) {
    console.error(`[hero-animation] ${label} failed to link:\n${gl.getProgramInfoLog(program)}`);
  }
  gl.deleteProgram(program);
  return null;
}

// ---------------------------------------------------------------------------
// Uniforms
// ---------------------------------------------------------------------------

/** The uniform setter variants this effect uses. */
export type UniformKind = "1f" | "1fv" | "1i" | "2f" | "3fv" | "4f";

/** Maps a friendly JS key to `[setter kind, GLSL uniform name]`. */
export type UniformSpec = Record<string, readonly [UniformKind, string]>;

export type UniformValue = number | Float32Array | readonly number[];

/** Coerce to something the `*fv` setters accept, without copying typed arrays. */
function asFloatList(value: UniformValue): Float32Array | number[] {
  if (typeof value === "number") return [value];
  if (value instanceof Float32Array) return value;
  return Array.from(value);
}

const SETTERS: Record<
  UniformKind,
  (gl: WebGL2RenderingContext, location: WebGLUniformLocation | null, value: UniformValue) => void
> = {
  "1f": (gl, location, value) => gl.uniform1f(location, value as number),
  "1fv": (gl, location, value) => gl.uniform1fv(location, asFloatList(value)),
  "1i": (gl, location, value) => gl.uniform1i(location, value as number),
  "2f": (gl, location, value) => {
    const v = value as readonly number[];
    gl.uniform2f(location, v[0], v[1]);
  },
  "3fv": (gl, location, value) => gl.uniform3fv(location, asFloatList(value)),
  "4f": (gl, location, value) => {
    const v = value as readonly number[];
    gl.uniform4f(location, v[0], v[1], v[2], v[3]);
  },
};

export interface UniformBinder<S extends UniformSpec> {
  /** `gl.useProgram` for this program. */
  bind(): void;
  /** Bind the program, then upload every changed value in `values`. */
  set(values: Partial<Record<keyof S, UniformValue>>): void;
  /**
   * Upload one uniform, assuming the program is already bound.
   *
   * @param useCache pass `false` for values that are mutated in place (typed
   * arrays such as `weights`), where the cache cannot detect the change.
   */
  setBound(key: keyof S, value: UniformValue, useCache?: boolean): void;
}

/**
 * Resolve every uniform location up front and memoise the last value written.
 *
 * `uniform*` calls are cheap individually but this effect re-uploads ~30 of
 * them on every settings change and two per frame; skipping the unchanged ones
 * keeps the per-frame cost to the two that actually animate.
 */
export function createUniforms<S extends UniformSpec>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  spec: S,
): UniformBinder<S> {
  const locations = {} as Record<keyof S, WebGLUniformLocation | null>;
  for (const key of Object.keys(spec) as (keyof S)[]) {
    locations[key] = gl.getUniformLocation(program, spec[key][1]);
  }

  const cache = new Map<keyof S, number | number[]>();

  /** Record `value` and report whether it differs from the last write. */
  const hasChanged = (key: keyof S, value: UniformValue): boolean => {
    const previous = cache.get(key);
    if (typeof value === "number") {
      if (Object.is(previous, value)) return false;
      cache.set(key, value);
      return true;
    }
    const next = Array.from(value);
    if (
      Array.isArray(previous) &&
      previous.length === next.length &&
      previous.every((entry, index) => Object.is(entry, next[index]))
    ) {
      return false;
    }
    cache.set(key, next);
    return true;
  };

  const setBound: UniformBinder<S>["setBound"] = (key, value, useCache = true) => {
    if (useCache && !hasChanged(key, value)) return;
    SETTERS[spec[key][0]](gl, locations[key], value);
  };

  return {
    bind: () => gl.useProgram(program),
    set(values) {
      gl.useProgram(program);
      for (const key of Object.keys(values) as (keyof S)[]) {
        const value = values[key];
        if (value !== undefined) setBound(key, value);
      }
    },
    setBound,
  };
}
