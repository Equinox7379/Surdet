import { Filter, GlProgram, GpuProgram, UniformGroup, type Texture } from 'pixi.js';
import type { RuleTransitionOptions } from '@surdet/core';

// Pixi v8 filter coordinates: sampled input can occupy only part of a pooled
// texture. The rule image instead spans the whole output quad (aPosition).
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vRuleCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vRuleCoord = aPosition;
}`;
const fragment = `
in vec2 vTextureCoord;
in vec2 vRuleCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uRuleTexture;
uniform float uProgress;
uniform float uSoft;
uniform float uReverse;
void main() {
  float luminance = dot(texture(uRuleTexture, vRuleCoord).rgb, vec3(0.2126, 0.7152, 0.0722));
  luminance = mix(luminance, 1.0 - luminance, uReverse);
  float reveal = uSoft > 0.0 ? smoothstep(luminance - uSoft, luminance + uSoft, uProgress) : step(luminance, uProgress);
  if (uProgress <= 0.0) reveal = 0.0;
  if (uProgress >= 1.0) reveal = 1.0;
  finalColor = texture(uTexture, vTextureCoord) * (1.0 - reveal);
}`;
const source = `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>,
};
struct RuleUniforms { uProgress: f32, uSoft: f32, uReverse: f32 };
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> rules: RuleUniforms;
@group(1) @binding(1) var uRuleTexture: texture_2d<f32>;
@group(1) @binding(2) var uRuleSampler: sampler;
struct VSOutput {
  @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) ruleUv: vec2<f32>
};
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return VSOutput(vec4(position, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw), aPosition);
}
@fragment fn mainFragment(@location(0) uv: vec2<f32>, @location(1) ruleUv: vec2<f32>) -> @location(0) vec4<f32> {
  var luminance = dot(textureSample(uRuleTexture, uRuleSampler, ruleUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  luminance = mix(luminance, 1.0 - luminance, rules.uReverse);
  var reveal = step(luminance, rules.uProgress);
  if (rules.uSoft > 0.0) { reveal = smoothstep(luminance - rules.uSoft, luminance + rules.uSoft, rules.uProgress); }
  if (rules.uProgress <= 0.0) { reveal = 0.0; }
  if (rules.uProgress >= 1.0) { reveal = 1.0; }
  return textureSample(uTexture, uSampler, uv) * (1.0 - reveal);
}`;

/** Owns filter resources, not the registered rule texture or captured old image. */
export class RuleTransitionFilter extends Filter {
  readonly #uniforms: UniformGroup<{ uProgress: { value: number; type: 'f32' }; uSoft: { value: number; type: 'f32' }; uReverse: { value: number; type: 'f32' } }>;
  constructor(texture: Texture, options: RuleTransitionOptions) {
    const uniforms = new UniformGroup({ uProgress: { value: 0, type: 'f32' }, uSoft: { value: options.soft, type: 'f32' }, uReverse: { value: options.reverse ? 1 : 0, type: 'f32' } });
    super({ glProgram: GlProgram.from({ vertex, fragment, name: 'surdet-rule-transition' }),
      gpuProgram: GpuProgram.from({ vertex: { source, entryPoint: 'mainVertex' }, fragment: { source, entryPoint: 'mainFragment' } }),
      resources: { rules: uniforms, uRuleTexture: texture.source, uRuleSampler: texture.source.style } });
    this.#uniforms = uniforms;
  }
  setProgress(progress: number, texture: Texture): void {
    this.#uniforms.uniforms.uProgress = progress;
    this.resources.uRuleTexture = texture.source; this.resources.uRuleSampler = texture.source.style;
  }
}
