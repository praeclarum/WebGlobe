struct Uniforms {
  modelViewMatrix : mat4x4<f32>,
  projectionMatrix : mat4x4<f32>,
  normModelViewMatrix : mat4x4<f32>,
}
@binding(0) @group(0) var<uniform> uniforms : Uniforms;

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) modelPosition: vec4<f32>,
  @location(1) color: vec4<f32>,
}

@vertex
fn main(
  @location(0) position : vec4<f32>,
  @location(1) color : vec4<f32>
) -> VertexOutput {
  var output : VertexOutput;
  var modelViewProjectionMatrix : mat4x4<f32> = uniforms.projectionMatrix * uniforms.modelViewMatrix;
  // var modelViewProjectionMatrix : mat4x4<f32> = uniforms.modelViewMatrix;
  // var modelViewProjectionMatrix : mat4x4<f32> = uniforms.projectionMatrix;
  output.Position = modelViewProjectionMatrix * position;
  output.modelPosition = position;
  output.color = color;
  // output.viewMatrix = uniforms.modelViewMatrix;
  return output;
}
