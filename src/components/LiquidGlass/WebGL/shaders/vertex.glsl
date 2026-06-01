#version 300 es

in vec4 a_position;
out vec2 v_uv;
// in vec4 a_color;

// out vec4 v_color;

void main() {
  v_uv = (a_position.xy + 1.0) * 0.5;
  gl_Position = a_position;
  // v_color = a_color;
}
