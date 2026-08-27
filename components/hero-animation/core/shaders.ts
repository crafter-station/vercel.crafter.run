/**
 * GLSL ES 3.00 sources for the three passes.
 *
 * The shader text is reproduced verbatim from the production bundle; the only
 * JavaScript involvement is interpolating scene geometry and the photographic
 * grade in as `const` literals, which lets the compiler fold them.
 *
 * ## The three passes
 *
 * 1. **Grain bake** - runs once into a 400 × 400 texture. A pure integer hash
 *    of `gl_FragCoord`, so the noise is stable and costs nothing per frame.
 * 2. **Main** - one fullscreen triangle. Reconstructs all ten lights from the
 *    atlas in linear HDR, sums them, draws the LED cores on top, then applies a
 *    single shared tone map. This is the whole image.
 * 3. **Bloom** - ten instanced 11 px quads, additively blended, each shaded by
 *    an editable cubic-Bezier point-spread function. Cheaper and sharper than a
 *    separable blur, and it only touches ~1% of the framebuffer.
 */

import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DOT_CENTERS,
  DOT_RADIUS,
  DOT_SPACING,
  DOT_VERTICAL_SPACING,
  GRAIN_SIZE,
  LIGHT_COUNT,
  MAX_LIGHT_WEIGHT,
  PEAK_RADIANCE,
  SCENE,
} from "./scene";
import type { AgentShaderSettings, PhotographicSettings } from "./settings";

export interface AgentShaderSources {
  /** Fullscreen triangle from `gl_VertexID`. Shared by the main and grain passes. */
  vertexShader: string;
  /** The scene. */
  fragmentShader: string;
  /** Per-LED quad placement for the bloom pass. */
  bloomVertexShader: string;
  /** The point-spread function. */
  bloomFragmentShader: string;
  /** One-off hashed noise bake. */
  grainBakeFragmentShader: string;
}

/**
 * Build the GLSL for one photographic grade.
 *
 * Geometry comes from `./scene` and never varies. Exposure, contrast and
 * saturation are baked rather than passed as uniforms because they sit in the
 * innermost loop of the tone mapper.
 */
export function buildAgentShaders(photographic: PhotographicSettings): AgentShaderSources {
  const {
    blackPoint,
    colorContrast,
    colorExposureEv,
    midtonePivot,
    neutralCompressionStart,
    neutralHighlightDesaturation,
    saturation,
    whiteContrast,
    whiteExposureEv,
  } = photographic;

  const atlas = SCENE.rgbAtlas;
  const colorReachCompensation = SCENE.colorReachCompensation
    .map((value, index) => `if (index == ${index}) return ${value.toFixed(6)};`)
    .join("\n    ");

  const vertexShader = `#version 300 es
  out vec2 vUv;

  void main() {
    vec2 position = vec2(
      gl_VertexID == 1 ? 3.0 : -1.0,
      gl_VertexID == 2 ? 3.0 : -1.0
    );
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
  `;

  const grainBakeFragmentShader = `#version 300 es
  precision highp float;
  precision highp int;

  out vec4 outColor;

  uint hash(uvec2 value) {
    uint result = value.x * 374761393u + value.y * 668265263u;
    result = (result ^ (result >> 13u)) * 1274126177u;
    return result ^ (result >> 16u);
  }

  void main() {
    uint value = hash(uvec2(gl_FragCoord.xy));
    float grain = float(value & 65535u) / 65535.0;
    outColor = vec4(vec3(grain), 1.0);
  }
  `;

  const bloomVertexShader = `#version 300 es
  precision highp float;

  uniform vec2 uResolution;
  uniform float uWeights[${LIGHT_COUNT}];
  uniform vec3 uColorLight[${LIGHT_COUNT}];
  uniform float uColorMix;
  uniform float uBloomRadiusPx;
  uniform float uWhiteBloomStrength;
  uniform float uColorBloomStrength;
  uniform float uLightMode;
  uniform float uWhiteLightGlowStrength;
  uniform float uColorLightGlowStrength;

  out vec2 vLocalPosition;
  flat out vec3 vBloomColor;
  flat out float vBloomAmplitude;

  const float DOT_RADIUS = ${DOT_RADIUS.toFixed(1)};
  const float DOT_SPACING = ${DOT_SPACING.toFixed(4)};
  const float DOT_VERTICAL_SPACING = ${DOT_VERTICAL_SPACING.toFixed(4)};
  const float MAX_LIGHT_WEIGHT = ${MAX_LIGHT_WEIGHT.toFixed(1)};

  vec2 dotCentre(int index) {
    int row;
    int column;
    if (index < 1) {
      row = 0;
      column = index;
    } else if (index < 3) {
      row = 1;
      column = index - 1;
    } else if (index < 6) {
      row = 2;
      column = index - 3;
    } else {
      row = 3;
      column = index - 6;
    }

    return uResolution * 0.5 + vec2(
      (float(column) - float(row) * 0.5) * DOT_SPACING,
      (1.5 - float(row)) * DOT_VERTICAL_SPACING
    );
  }

  void main() {
    const vec2 positions[4] = vec2[4](
      vec2(-1.0, -1.0),
      vec2(1.0, -1.0),
      vec2(-1.0, 1.0),
      vec2(1.0, 1.0)
    );
    int lightIndex = gl_InstanceID;
    vec2 localPosition = positions[gl_VertexID];
    float weight = clamp(uWeights[lightIndex], 0.0, MAX_LIGHT_WEIGHT);
    float strength = mix(uWhiteBloomStrength, uColorBloomStrength, uColorMix);
    float lightModeStrength = mix(
      uWhiteLightGlowStrength,
      uColorLightGlowStrength,
      uColorMix
    );
    vLocalPosition = localPosition;
    vBloomColor = mix(vec3(0.96, 0.985, 1.0), uColorLight[lightIndex], uColorMix);
    vBloomAmplitude = weight * strength * mix(1.0, lightModeStrength, uLightMode);

    if (vBloomAmplitude <= 0.0 || uBloomRadiusPx <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      return;
    }

    float halfSize = DOT_RADIUS + uBloomRadiusPx;
    vec2 pixel = dotCentre(lightIndex) + localPosition * halfSize;
    gl_Position = vec4(pixel / uResolution * 2.0 - 1.0, 0.0, 1.0);
  }
  `;

  const bloomFragmentShader = `#version 300 es
  precision highp float;

  uniform float uLightMode;
  uniform vec4 uBloomFalloffCurve;

  in vec2 vLocalPosition;
  flat in vec3 vBloomColor;
  flat in float vBloomAmplitude;
  out vec4 outColor;

  float cubicBezier(float t, float point1, float point2) {
    float inverse = 1.0 - t;
    return
      3.0 * inverse * inverse * t * point1 +
      3.0 * inverse * t * t * point2 +
      t * t * t;
  }

  float cubicBezierDerivative(float t, float point1, float point2) {
    float inverse = 1.0 - t;
    return
      3.0 * inverse * inverse * point1 +
      6.0 * inverse * t * (point2 - point1) +
      3.0 * t * t * (1.0 - point2);
  }

  float bloomFalloff(float distanceFromCentre) {
    float t = distanceFromCentre;
    for (int iteration = 0; iteration < 4; iteration++) {
      float curveX = cubicBezier(t, uBloomFalloffCurve.x, uBloomFalloffCurve.z);
      float derivative = cubicBezierDerivative(
        t,
        uBloomFalloffCurve.x,
        uBloomFalloffCurve.z
      );
      t = clamp(
        t - (curveX - distanceFromCentre) / max(derivative, 0.0001),
        0.0,
        1.0
      );
    }
    // Y is authored from one at the LED centre to zero at the quad edge.
    return 1.0 - cubicBezier(
      t,
      1.0 - uBloomFalloffCurve.y,
      1.0 - uBloomFalloffCurve.w
    );
  }

  void main() {
    float radialDistance = length(vLocalPosition);
    if (radialDistance >= 1.0) discard;

    // The editable point-spread function is only evaluated inside these ten
    // tiny quads, never across the fullscreen pass.
    float falloff = bloomFalloff(radialDistance);
    vec3 bloom = vBloomColor * vBloomAmplitude * falloff;
    float alpha = uLightMode > 0.5
      ? max(bloom.r, max(bloom.g, bloom.b))
      : 0.0;
    outColor = vec4(bloom, alpha);
  }
  `;

  const fragmentShader = `#version 300 es
  precision highp float;

  uniform sampler2D uAtlas;
  uniform sampler2D uGrain;
  uniform vec2 uResolution;
  uniform vec2 uTriangleBottomLeft;
  uniform vec2 uTriangleBottomRight;
  uniform vec2 uTriangleTop;
  uniform float uWeights[${LIGHT_COUNT}];
  uniform float uGrainMultiplyStrength;
  uniform float uMaxDistortionPx;
  uniform float uDistortionRampPx;
  uniform float uEdgeFeatherPx;
  uniform float uShowOffsetScale;
  uniform float uColorMix;
  uniform float uLightMode;
  uniform vec3 uLightModeUnlitDotColor;
  uniform float uWhiteLightGlowStrength;
  uniform float uWhiteLightAmbientOcclusionStrength;
  uniform float uWhiteLightShadowGrainRemovalStrength;
  uniform float uWhiteLightRadialInnerRadiusPx;
  uniform float uWhiteLightRadialOuterRadiusPx;
  uniform float uWhiteLightRadialPower;
  uniform float uWhiteLightRadialShadowStrength;
  uniform float uColorLightGlowStrength;
  uniform float uColorLightAmbientOcclusionStrength;
  uniform float uColorLightShadowGrainRemovalStrength;
  uniform float uColorLightRadialInnerRadiusPx;
  uniform float uColorLightRadialOuterRadiusPx;
  uniform float uColorLightRadialPower;
  uniform float uColorLightRadialShadowStrength;

  in vec2 vUv;
  out vec4 outColor;

  const float BACKDROP_ALBEDO = 0.075;
  const float AMBIENT = 0.004;
  const float PEAK_RADIANCE = ${PEAK_RADIANCE.toFixed(1)};
  const float DOT_SPACING = ${DOT_SPACING.toFixed(4)};
  const float DOT_VERTICAL_SPACING = ${DOT_VERTICAL_SPACING.toFixed(4)};
  const float DOT_RADIUS = ${DOT_RADIUS.toFixed(4)};
  const float WHITE_EXPOSURE_EV = ${whiteExposureEv.toFixed(6)};
  const float COLOR_EXPOSURE_EV = ${colorExposureEv.toFixed(6)};
  const float WHITE_CONTRAST = ${whiteContrast.toFixed(6)};
  const float COLOR_CONTRAST = ${colorContrast.toFixed(6)};
  const float MIDTONE_PIVOT = ${midtonePivot.toFixed(6)};
  const float BLACK_POINT = ${blackPoint.toFixed(6)};
  const float SATURATION = ${saturation.toFixed(6)};
  const float NEUTRAL_COMPRESSION_START = ${neutralCompressionStart.toFixed(6)};
  const float NEUTRAL_HIGHLIGHT_DESATURATION = ${neutralHighlightDesaturation.toFixed(6)};
  const float RGB_ATLAS_GAMMA = ${atlas.gamma.toFixed(6)};
  const float RGB_ATLAS_MAX_IRRADIANCE = ${atlas.maxIrradiance.toFixed(6)};
  const float GRAIN_TEXTURE_SIZE = ${GRAIN_SIZE.toFixed(1)};
  const vec2 TILE_HALF_TEXEL = vec2(
    ${(0.5 / atlas.tileWidth).toFixed(10)},
    ${(0.5 / atlas.tileHeight).toFixed(10)}
  );

  float signedEdgeDistance(vec2 start, vec2 end, vec2 point) {
    vec2 edge = end - start;
    vec2 relative = point - start;
    return (edge.x * relative.y - edge.y * relative.x) / length(edge);
  }

  float distanceOutsideTriangle(vec2 point) {
    float bottom = signedEdgeDistance(
      uTriangleBottomLeft,
      uTriangleBottomRight,
      point
    );
    float right = signedEdgeDistance(
      uTriangleBottomRight,
      uTriangleTop,
      point
    );
    float left = signedEdgeDistance(
      uTriangleTop,
      uTriangleBottomLeft,
      point
    );
    return max(0.0, -min(bottom, min(right, left)));
  }

  float decodeGrain(float value) {
    return value * 2.0 - 1.0;
  }

  // Only three of the ten lights are actually baked (R, G and B of the atlas).
  // The other seven are recovered by permuting the barycentric coordinates of
  // the sample point inside the dot triangle, which maps each light onto the
  // representative that shares its symmetry.
  float sampleLight(int index, vec2 uv) {
    const vec2 vertexA = vec2(${DOT_CENTERS[0][0].toFixed(6)}, ${DOT_CENTERS[0][1].toFixed(6)});
    const vec2 vertexB = vec2(${DOT_CENTERS[6][0].toFixed(6)}, ${DOT_CENTERS[6][1].toFixed(6)});
    const vec2 vertexC = vec2(${DOT_CENTERS[9][0].toFixed(6)}, ${DOT_CENTERS[9][1].toFixed(6)});
    vec2 point = uv * uResolution;
    vec2 edgeB = vertexB - vertexA;
    vec2 edgeC = vertexC - vertexA;
    vec2 relative = point - vertexA;
    float inverseDeterminant = 1.0 / (
      edgeB.x * edgeC.y - edgeC.x * edgeB.y
    );
    float baryB = (
      relative.x * edgeC.y - edgeC.x * relative.y
    ) * inverseDeterminant;
    float baryC = (
      edgeB.x * relative.y - relative.x * edgeB.y
    ) * inverseDeterminant;
    vec3 bary = vec3(1.0 - baryB - baryC, baryB, baryC);
    vec3 representativeBary = bary;
    if (index == 2) representativeBary = bary.xzy;
    if (index == 3 || index == 6) representativeBary = bary.yxz;
    if (index == 5) representativeBary = bary.zxy;
    if (index == 7) representativeBary = bary.yzx;
    if (index == 8 || index == 9) representativeBary = bary.zyx;
    vec2 representativePoint =
      vertexA * representativeBary.x +
      vertexB * representativeBary.y +
      vertexC * representativeBary.z;
    vec2 sampleUv = clamp(
      representativePoint / uResolution,
      TILE_HALF_TEXEL,
      vec2(1.0) - TILE_HALF_TEXEL
    );
    vec3 packedLights = texture(uAtlas, sampleUv).rgb;
    bool isCorner = index == 0 || index == 6 || index == 9;
    float encoded = isCorner
      ? packedLights.r
      : (index == 4 ? packedLights.b : packedLights.g);
    return pow(encoded, RGB_ATLAS_GAMMA) * RGB_ATLAS_MAX_IRRADIANCE;
  }

  vec3 tonemapNeutral(vec3 color) {
    float darkestChannel = min(color.r, min(color.g, color.b));
    float offset = darkestChannel < 0.08
      ? darkestChannel - 6.25 * darkestChannel * darkestChannel
      : 0.04;
    color -= offset;

    float peak = max(color.r, max(color.g, color.b));
    if (peak < NEUTRAL_COMPRESSION_START) return color;

    float compressionRange = 1.0 - NEUTRAL_COMPRESSION_START;
    float compressedPeak = 1.0 - (
      compressionRange * compressionRange /
      (peak + compressionRange - NEUTRAL_COMPRESSION_START)
    );
    color *= compressedPeak / peak;
    float desaturationMix = 1.0 - 1.0 / (
      NEUTRAL_HIGHLIGHT_DESATURATION * (peak - compressedPeak) + 1.0
    );
    return mix(color, vec3(compressedPeak), desaturationMix);
  }

  vec3 applyPhotographicGrade(vec3 color) {
    float exposureEv = mix(
      WHITE_EXPOSURE_EV,
      COLOR_EXPOSURE_EV,
      clamp(uColorMix, 0.0, 1.0)
    );
    float contrast = mix(
      WHITE_CONTRAST,
      COLOR_CONTRAST,
      clamp(uColorMix, 0.0, 1.0)
    );
    color *= exp2(exposureEv);
    color = max(color - vec3(BLACK_POINT), vec3(0.0));
    color = clamp(tonemapNeutral(color), 0.0, 1.0);
    color = (color - vec3(MIDTONE_PIVOT)) * contrast + MIDTONE_PIVOT;
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luminance), color, SATURATION);
    return clamp(color, vec3(0.0), vec3(1.0));
  }

  vec3 linearToSrgb(vec3 color) {
    vec3 low = color * 12.92;
    vec3 high = 1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(color, vec3(0.0031308)));
  }

  vec2 dotCentre(int index) {
    int row;
    int column;
    if (index < 1) {
      row = 0;
      column = index;
    } else if (index < 3) {
      row = 1;
      column = index - 1;
    } else if (index < 6) {
      row = 2;
      column = index - 3;
    } else {
      row = 3;
      column = index - 6;
    }

    return uResolution * 0.5 + vec2(
      (float(column) - float(row) * 0.5) * DOT_SPACING,
      (1.5 - float(row)) * DOT_VERTICAL_SPACING
    );
  }

  float edgeWeight(vec2 point, vec2 edgeCentre, float radius) {
    return pow(1.0 / (1.0 + distance(point, edgeCentre) / radius), 3.0);
  }

  vec3 normalizeLightLuminance(vec3 color) {
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return luminance > 0.0001 ? color / luminance : color;
  }

  float lightReachCompensation(int index) {
    ${colorReachCompensation}
    return 1.0;
  }

  vec3 linearLightColor(int index) {
    const vec3 edgeRed = vec3(0.896269, 0.027321, 0.051269);
    const vec3 edgeGreen = vec3(0.0, 0.40724, 0.048172);
    const vec3 edgeBlue = vec3(0.0, 0.278894, 1.0);

    vec2 redCentre = (uTriangleTop + uTriangleBottomLeft) * 0.5;
    vec2 greenCentre = (uTriangleBottomLeft + uTriangleBottomRight) * 0.5;
    vec2 blueCentre = (uTriangleBottomRight + uTriangleTop) * 0.5;
    float triangleHeight = uTriangleTop.y - greenCentre.y;
    // Radius 173 for a roughly 214px triangle: about 0.8h.
    float radius = triangleHeight * 0.8;
    vec2 centre = dotCentre(index);
    float redWeight = edgeWeight(centre, redCentre, radius);
    float greenWeight = edgeWeight(centre, greenCentre, radius);
    float blueWeight = edgeWeight(centre, blueCentre, radius);
    float weightSum = max(redWeight + greenWeight + blueWeight, 0.0001);
    vec3 blended = (
      edgeRed * redWeight +
      edgeGreen * greenWeight +
      edgeBlue * blueWeight
    ) / weightSum;
    return normalizeLightLuminance(blended) * lightReachCompensation(index);
  }

  void compositeDot(
    inout float mask,
    inout float unlitMask,
    inout vec3 emission,
    vec2 pixel,
    int index
  ) {
    vec2 centre = dotCentre(index);
    float signedDistance = distance(pixel, centre) - DOT_RADIUS;
    float softness = max(fwidth(signedDistance), 0.8);
    float dotMask = 1.0 - smoothstep(-softness, softness, signedDistance);
    float perceptualWeight = pow(
      clamp(uWeights[index], 0.0, ${MAX_LIGHT_WEIGHT.toFixed(1)}),
      2.7
    );
    float radiance = PEAK_RADIANCE * perceptualWeight;
    vec3 lightColor = mix(
      vec3(0.96, 0.985, 1.0),
      linearLightColor(index),
      uColorMix
    );
    mask = max(mask, dotMask);
    unlitMask = max(
      unlitMask,
      dotMask * (1.0 - clamp(uWeights[index], 0.0, 1.0))
    );
    emission = max(emission, lightColor * radiance * dotMask);
  }

  void main() {
    // The hash texture stays 400x400 and repeats once per render texel. At the
    // fixed 2x output density this gives each supersample its own distortion.
    vec2 grainUv = gl_FragCoord.xy / GRAIN_TEXTURE_SIZE;
    float grainX = decodeGrain(texture(uGrain, grainUv).r);
    float grainY = decodeGrain(
      texture(uGrain, grainUv + vec2(0.37, 0.61)).r
    );
    float shadowRemovalNoise = texture(
      uGrain,
      grainUv + vec2(0.19, 0.83)
    ).r;

    float outsidePx = distanceOutsideTriangle(vUv * uResolution);
    float distortionWeight = pow(
      smoothstep(0.0, uDistortionRampPx, outsidePx),
      0.5
    );
    if (uShowOffsetScale > 0.5) {
      outColor = vec4(vec3(distortionWeight), 1.0);
      return;
    }
    vec2 sampleOffsetPx = vec2(grainX, grainY) * uMaxDistortionPx;
    sampleOffsetPx *= distortionWeight;

    // Reconstruct every independently baked light in linear HDR, tint it, then
    // add all ten contributions before the single shared tonemapping pass. Each
    // light rotates the same hash vector by an even slice of a full turn so its
    // compression breakup is decorrelated from the other atlas samples.
    vec3 irradiance = vec3(0.0);
    for (int index = 0; index < ${LIGHT_COUNT}; index += 1) {
      float sampleAngle = 6.28318530718 * float(index) / ${LIGHT_COUNT.toFixed(1)};
      float sampleCos = cos(sampleAngle);
      float sampleSin = sin(sampleAngle);
      vec2 rotatedSampleOffsetPx = vec2(
        sampleCos * sampleOffsetPx.x - sampleSin * sampleOffsetPx.y,
        sampleSin * sampleOffsetPx.x + sampleCos * sampleOffsetPx.y
      );
      vec2 sampleUv = clamp(
        vUv + rotatedSampleOffsetPx / uResolution,
        vec2(0.0),
        vec2(1.0)
      );
      vec3 lightColor = mix(
        vec3(1.0),
        linearLightColor(index),
        uColorMix
      );
      irradiance += sampleLight(index, sampleUv) * uWeights[index] * lightColor;
    }

    float vignette = 1.0 - 0.42 * smoothstep(
      0.16,
      0.72,
      distance(vUv, vec2(0.5))
    );
    vec3 color = BACKDROP_ALBEDO * vignette * (irradiance + vec3(AMBIENT));

    float emitterMask = 0.0;
    float unlitEmitterMask = 0.0;
    vec3 emitter = vec3(0.0);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 0);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 1);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 2);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 3);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 4);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 5);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 6);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 7);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 8);
    compositeDot(emitterMask, unlitEmitterMask, emitter, vUv * uResolution, 9);
    color = mix(color, emitter, clamp(emitterMask, 0.0, 1.0));

    color = linearToSrgb(applyPhotographicGrade(color));
    float grainMultiplier = 1.0 + grainX * uGrainMultiplyStrength;
    color *= grainMultiplier;

    vec2 edgeDistancePx = min(vUv, 1.0 - vUv) * uResolution;
    float edgeFade = smoothstep(
      0.0,
      uEdgeFeatherPx,
      min(edgeDistancePx.x, edgeDistancePx.y)
    );
    color *= edgeFade;
    color = max(color, vec3(0.0));

    // Dark mode keeps the established opaque screen-blended output.
    if (uLightMode < 0.5) {
      outColor = vec4(color, 1.0);
      return;
    }

    vec3 baseColor = color;

    // Light mode uses the atlas alpha as a static AO bake. A broad radial
    // shadow creates enough local contrast for the existing HDR light to read
    // on the near-white page. Both shadows become fully transparent at the
    // canvas boundary, so the DOM's #fafafa ground remains the exact edge.
    float lightGlowStrength = mix(
      uWhiteLightGlowStrength,
      uColorLightGlowStrength,
      uColorMix
    );
    float lightAmbientOcclusionStrength = mix(
      uWhiteLightAmbientOcclusionStrength,
      uColorLightAmbientOcclusionStrength,
      uColorMix
    );
    float lightShadowGrainRemovalStrength = mix(
      uWhiteLightShadowGrainRemovalStrength,
      uColorLightShadowGrainRemovalStrength,
      uColorMix
    );
    float lightRadialInnerRadiusPx = mix(
      uWhiteLightRadialInnerRadiusPx,
      uColorLightRadialInnerRadiusPx,
      uColorMix
    );
    float lightRadialOuterRadiusPx = mix(
      uWhiteLightRadialOuterRadiusPx,
      uColorLightRadialOuterRadiusPx,
      uColorMix
    );
    float lightRadialPower = mix(
      uWhiteLightRadialPower,
      uColorLightRadialPower,
      uColorMix
    );
    float lightRadialShadowStrength = mix(
      uWhiteLightRadialShadowStrength,
      uColorLightRadialShadowStrength,
      uColorMix
    );
    float radialDistance = distance(vUv * uResolution, uResolution * 0.5);
    float radialInnerRadius = min(
      lightRadialInnerRadiusPx,
      lightRadialOuterRadiusPx - 1.0
    );
    float radialOuterRadius = max(
      lightRadialOuterRadiusPx,
      radialInnerRadius + 1.0
    );
    float radialEnvelope = 1.0 - smoothstep(
      radialInnerRadius,
      radialOuterRadius,
      radialDistance
    );
    float radialShadow = pow(
      max(radialEnvelope, 0.0),
      max(lightRadialPower, 0.01)
    ) * lightRadialShadowStrength;
    float ambientOcclusion = (
      max(texture(uAtlas, vUv).a * 255.0 - 1.0, 0.0) / 254.0
    ) * lightAmbientOcclusionStrength;
    float shadowRetention = 1.0 - clamp(
      shadowRemovalNoise * lightShadowGrainRemovalStrength,
      0.0,
      1.0
    );
    shadowRetention = pow(shadowRetention, 2.0);
    radialShadow *= shadowRetention;
    ambientOcclusion *= shadowRetention;
    float shadowAlpha = 1.0 -
      (1.0 - radialShadow * edgeFade) *
      (1.0 - ambientOcclusion * edgeFade);

    vec3 glowPremultiplied = clamp(
      baseColor * lightGlowStrength,
      0.0,
      1.0
    );
    float glowAlpha = max(
      glowPremultiplied.r,
      max(glowPremultiplied.g, glowPremultiplied.b)
    );
    float finalAlpha = glowAlpha + shadowAlpha * (1.0 - glowAlpha);
    // AO describes only the floor. An unlit LED masks the local floor shadow,
    // then yields as it illuminates.
    float unlitDotAlpha = clamp(unlitEmitterMask, 0.0, 1.0);
    glowPremultiplied =
      uLightModeUnlitDotColor * unlitDotAlpha +
      glowPremultiplied * (1.0 - unlitDotAlpha);
    finalAlpha = unlitDotAlpha + finalAlpha * (1.0 - unlitDotAlpha);
    finalAlpha = max(
      finalAlpha,
      max(
        glowPremultiplied.r,
        max(glowPremultiplied.g, glowPremultiplied.b)
      )
    );
    outColor = vec4(glowPremultiplied, finalAlpha);
  }
  `;

  return {
    vertexShader,
    fragmentShader,
    bloomVertexShader,
    bloomFragmentShader,
    grainBakeFragmentShader,
  };
}

/**
 * Shader sources memoised per settings object.
 *
 * Compiling the GLSL string is cheap, but `gl.compileShader` is not, and the
 * renderer is torn down and rebuilt on context loss. Keying on the settings
 * object identity means a stable `settings` prop compiles exactly once.
 */
const shaderCache = new WeakMap<AgentShaderSettings, AgentShaderSources>();

export function getAgentShaders(settings: AgentShaderSettings): AgentShaderSources {
  let sources = shaderCache.get(settings);
  if (!sources) {
    sources = buildAgentShaders(settings.photographic);
    shaderCache.set(settings, sources);
  }
  return sources;
}

/** Virtual resolution the shaders expect in `uResolution`. */
export const SHADER_RESOLUTION: readonly [number, number] = [CANVAS_WIDTH, CANVAS_HEIGHT];
