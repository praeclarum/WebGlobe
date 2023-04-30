struct Uniforms {
  modelViewMatrix : mat4x4<f32>,
  projectionMatrix : mat4x4<f32>,
  normModelViewMatrix : mat4x4<f32>,
}
@binding(0) @group(0) var<uniform> uniforms : Uniforms;

@fragment
fn main(
  @location(0) modelPosition: vec4<f32>,
  @location(1) color: vec4<f32>
) -> @location(0) vec4<f32> {
  var viewPosition: vec3<f32> = (uniforms.modelViewMatrix * modelPosition).xyz;
  var modelNormal: vec4<f32> = normalize(modelPosition);
  var viewNormal: vec3<f32> = (uniforms.normModelViewMatrix * modelNormal).xyz;
  var dirToCamera: vec3<f32> = normalize(vec3<f32>(0.0, 0.0, 0.0) - viewPosition);
  
  var brightness: f32 = clamp(dot(viewNormal, dirToCamera), 0, 1);
  brightness = pow(brightness, 0.75);
  var ambient: f32 = 0.333;
  brightness = mix(ambient, 1.0, brightness);
  // fragPosition is world coordinates
  // camera is at 0, 0, 0
  // need a vector from 
  return vec4<f32>(color.xyz * brightness, 1.0);
}
