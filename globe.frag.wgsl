@fragment
fn main(
  @location(0) fragPosition: vec4<f32>
) -> @location(0) vec4<f32> {
//   return fragPosition;
  return vec4<f32>(0.0, 1.0, 0.0, 1.0);
}
